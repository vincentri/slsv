import { envKey } from '../../env-key.js'
import type { Provider, FunctionOutput } from '../types.js'
import type { AppConfig } from '../../config.js'
import { makeClients, type Clients } from './clients.js'
import { ensureExecRole, deleteExecRole } from './iam.js'
import { ensureLogGroup, deleteLogGroup } from './logs.js'
import { ensureDynamoTables } from './dynamodb.js'
import { ensureBuckets } from './s3.js'
import { ensureQueues, type QueueOutput } from './sqs.js'
import { ensureSecrets } from './secrets.js'
import { deployFunctions } from './functions.js'
import { ensureApiGateway, deleteHttpApi } from './apigw.js'
import { ensureCronTriggers, ensureEventTriggers } from './eventbridge.js'
import { ensureEventSourceMappings } from './eventsource.js'
import { tailLogs } from './logs-tail.js'
import { ensureCacheClusters } from './redis.js'
import { ensureDbInstances } from './databases.js'
import { deployFrontendLocal, deployFrontendAws, destroyDistribution } from './frontend.js'
import {
  UpdateFunctionCodeCommand,
  DeleteFunctionCommand,
  ListFunctionsCommand,
} from '@aws-sdk/client-lambda'
import { DeleteTableCommand, ListTablesCommand } from '@aws-sdk/client-dynamodb'
import {
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteBucketCommand,
  ListBucketsCommand,
} from '@aws-sdk/client-s3'
import { GetQueueUrlCommand, DeleteQueueCommand } from '@aws-sdk/client-sqs'
import { DeleteSecretCommand } from '@aws-sdk/client-secrets-manager'
import {
  ListRulesCommand,
  ListTargetsByRuleCommand,
  RemoveTargetsCommand,
  DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge'
import {
  DeleteReplicationGroupCommand,
  DescribeReplicationGroupsCommand,
} from '@aws-sdk/client-elasticache'
import { DeleteDBInstanceCommand, DescribeDBInstancesCommand } from '@aws-sdk/client-rds'

const LOCAL_ENDPOINT = 'http://localhost:4566'
// A Lambda runs INSIDE the Floci container, where `localhost` is the container itself.
// It must reach Floci's AWS APIs via the docker host (same trick as the redis endpoint).
const LAMBDA_LOCAL_ENDPOINT = 'http://host.docker.internal:4566'

// Drain a token-paginated AWS list call. Each SDK uses a different token field, so the
// caller adapts request/response tokens; this just loops until there's no next token.
async function paginate<T>(
  fetchPage: (token?: string) => Promise<{ items: T[]; next?: string }>,
): Promise<T[]> {
  const out: T[] = []
  let token: string | undefined
  do {
    const { items, next } = await fetchPage(token)
    out.push(...items)
    token = next
  } while (token)
  return out
}

export class AwsProvider implements Provider {
  private target: 'local' | 'aws'
  private clients: Clients
  private roleArn?: string
  private appName = ''
  private tags: Record<string, string> = {}
  private queueOutputs: Record<string, QueueOutput> = {}

  constructor(target: 'local' | 'aws' = 'local') {
    this.target = target
    this.clients = makeClients(target)
  }

  async startLocalEmulator(_cwd: string, _cfg: AppConfig) {
    await ensureFlociAvailable()
  }

  stopLocalEmulator(cwd: string) {
  }

  // ponytail: deletes only what slsv.yml DECLARES for this repo (Lambda/Dynamo/S3/SQS/secrets).
  // Derived wiring (API GW, EventBridge cron, event source mappings, IAM role, log groups) left behind —
  // re-created on next deploy, harmless locally. Add cleanup if Floci clutter ever matters.
  async destroyResources(cfg: AppConfig, stage: string) {
    const appName = `${cfg.app}-${stage}`
    // Destroy is idempotent: swallow any "already gone" error so a partial/re-run destroy
    // never fails. Each service names its not-found error differently
    // (ResourceNotFoundException / NoSuchBucket / NoSuchEntity / QueueDoesNotExist /
    // ReplicationGroupNotFoundFault / DBInstanceNotFound / NonExistentQueue / ...), so match
    // the common shapes instead of maintaining a per-call list. `swallow()` ignores an
    // optional list arg for call sites that still pass one.
    const gone = /(NotFound|NoSuch|DoesNotExist|NonExistent)/i
    const swallow = (_ok?: string[]) => (e: any) => {
      if (!gone.test(e?.name ?? '')) throw e
    }

    // API Gateway (deletes its routes/integrations/stages too)
    await deleteHttpApi(this.clients.apigw, appName).catch(swallow(['NotFoundException']))

    // Lambda
    for (const name of Object.keys(cfg.functions ?? {})) {
      await this.clients.lambda
        .send(new DeleteFunctionCommand({ FunctionName: `${appName}-${name}` }))
        .catch(swallow(['ResourceNotFoundException']))
      // Delete the function's log group too, else logs linger and bill after teardown.
      await deleteLogGroup(this.clients.logs, `${appName}-${name}`)
    }

    // DynamoDB (databases of type dynamodb)
    for (const [name, d] of Object.entries(cfg.databases ?? {})) {
      if (d.type !== 'dynamodb') continue
      await this.clients.dynamo
        .send(new DeleteTableCommand({ TableName: `${appName}-${name}` }))
        .catch(swallow(['ResourceNotFoundException']))
    }

    // S3 (empty first, AWS refuses non-empty delete). Includes the frontend hosting bucket,
    // which is created by deployFrontend (not declared under `buckets:`) — else it orphans.
    const bucketNames = Object.keys(cfg.buckets ?? {}).map((n) => `${appName}-${n}`.toLowerCase())
    if (cfg.frontend) bucketNames.push(`${appName}-frontend`.toLowerCase())
    for (const bucket of bucketNames) {
      try {
        const listed = await this.clients.s3.send(new ListObjectsV2Command({ Bucket: bucket }))
        if (listed.Contents?.length) {
          await this.clients.s3.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: listed.Contents.map((o) => ({ Key: o.Key! })) },
            }),
          )
        }
        await this.clients.s3.send(new DeleteBucketCommand({ Bucket: bucket }))
      } catch (e: any) {
        if (!gone.test(e?.name ?? '')) throw e
      }
    }

    // SQS
    for (const name of Object.keys(cfg.queues ?? {})) {
      try {
        const r = await this.clients.sqs.send(
          new GetQueueUrlCommand({ QueueName: `${appName}-${name}` }),
        )
        await this.clients.sqs.send(new DeleteQueueCommand({ QueueUrl: r.QueueUrl }))
      } catch (e: any) {
        if (!gone.test(e?.name ?? '')) throw e
      }
    }

    // Secrets (no app prefix — named by env var directly)
    for (const name of cfg.secrets ?? []) {
      // Secrets are created stage-namespaced (`${appName}-${name}`) — delete by the same id.
      await this.clients.secrets
        .send(
          new DeleteSecretCommand({
            SecretId: `${appName}-${name}`,
            ForceDeleteWithoutRecovery: true,
          }),
        )
        .catch(swallow(['ResourceNotFoundException']))
    }

    // ElastiCache (one replication group per caches.<name>)
    for (const name of Object.keys(cfg.caches ?? {})) {
      await this.clients.elasticache
        .send(new DeleteReplicationGroupCommand({ ReplicationGroupId: `${appName}-${name}` }))
        .catch(swallow(['ReplicationGroupNotFoundFault']))
    }

    // RDS (one instance per postgres/mysql databases.<name>)
    for (const [name, d] of Object.entries(cfg.databases ?? {})) {
      if (d.type !== 'postgres' && d.type !== 'mysql') continue
      // Real AWS requires a final-snapshot decision. Default skip (slsv DBs are manifest-
      // managed). Set `skipFinalSnapshot: false` in slsv.yml to take a timestamped snapshot.
      const skip = d.skipFinalSnapshot ?? true
      await this.clients.rds
        .send(
          new DeleteDBInstanceCommand({
            DBInstanceIdentifier: `${appName}-${name}`,
            SkipFinalSnapshot: skip,
            DeleteAutomatedBackups: skip,
            ...(skip
              ? {}
              : { FinalDBSnapshotIdentifier: `${appName}-${name}-final-${Date.now()}` }),
          }),
        )
        .catch(swallow(['DBInstanceNotFound']))
    }

    // CloudFront (only exists if frontend.cloudfront was set). Disable → wait → delete: a
    // distribution can't be deleted while enabled, and both transitions take ~10-20 min each.
    if (cfg.frontend?.cloudfront) {
      await destroyDistribution(this.clients.cloudfront, appName).catch(swallow())
    }

    // IAM exec role (per app+stage)
    await deleteExecRole(this.clients.iam, appName)
  }

  /**
   * Prune resources that were deployed under this app+stage but are no longer in the
   * manifest (e.g. a renamed/removed function). Keeps `slsv.yml` the source of truth.
   *
   * Safety split: Lambda functions are auto-deleted (stateless, exact-named, the common
   * case). Data stores (DynamoDB / S3 / RDS) are NEVER auto-deleted — orphans are only
   * reported, so a table/bucket/db dropped from the yml can't silently take its data with
   * it. Use `slsv destroy` (or delete manually) to remove those on purpose.
   */
  async reconcile(cfg: AppConfig, stage: string) {
    const prefix = `${cfg.app}-${stage}-`
    const owned = (n?: string): n is string => !!n && n.startsWith(prefix)
    const logical = (n: string) => n.slice(prefix.length)

    // --- Lambda: auto-prune orphans ---
    const wantFns = new Set(Object.keys(cfg.functions ?? {}))
    const allFns = await paginate((Marker) =>
      this.clients.lambda
        .send(new ListFunctionsCommand({ Marker }))
        .then((r) => ({ items: r.Functions ?? [], next: r.NextMarker })),
    )
    for (const fn of allFns) {
      if (owned(fn.FunctionName) && !wantFns.has(logical(fn.FunctionName))) {
        await this.clients.lambda
          .send(new DeleteFunctionCommand({ FunctionName: fn.FunctionName }))
          .catch(() => {}) // gone already / racing another prune — fine
        console.log(`  pruned function ${fn.FunctionName}`)
      }
    }

    // --- EventBridge rules: auto-prune orphans ---
    // Rule names written by eventbridge.ts: `<prefix>-<fn>` (cron) and `<prefix>-<fn>-evt`
    // (event). A dropped cron/event trigger — or a removed function — leaves its rule live
    // and still firing (cron) or matched (event), invoking nothing / erroring. Unlike a
    // dangling API-GW integration (inert), an active rule is wrong behavior, so prune it.
    const EVT_SUFFIX = '-evt'
    const wantCron = new Set(
      Object.entries(cfg.functions ?? {})
        .filter(([, f]) => f.cron)
        .map(([k]) => k),
    )
    const wantEvent = new Set(
      Object.entries(cfg.functions ?? {})
        .filter(([, f]) => f.event)
        .map(([k]) => k),
    )
    const allRules = await paginate((NextToken) =>
      this.clients.events
        .send(new ListRulesCommand({ NextToken }))
        .then((r) => ({ items: r.Rules ?? [], next: r.NextToken })),
    )
    for (const r of allRules) {
      const name = r.Name ?? ''
      if (!owned(name)) continue
      const isEvt = name.endsWith(EVT_SUFFIX)
      const fnLogical = isEvt ? logical(name.slice(0, -EVT_SUFFIX.length)) : logical(name)
      if ((isEvt ? wantEvent : wantCron).has(fnLogical)) continue
      // AWS refuses DeleteRule while targets exist; remove them first.
      const tgts = await this.clients.events.send(new ListTargetsByRuleCommand({ Rule: name }))
      const ids = (tgts.Targets ?? []).map((t) => t.Id!)
      if (ids.length) {
        await this.clients.events
          .send(new RemoveTargetsCommand({ Rule: name, Ids: ids }))
          .catch(() => {}) // racing prune — fine, delete below still attempted
      }
      await this.clients.events
        .send(new DeleteRuleCommand({ Name: name }))
        .catch(() => {}) // gone already / racing another prune — fine
      console.log(`  pruned event rule ${name}`)
    }

    // --- Data stores: report only, never auto-delete (data loss) ---
    const dbEntries = Object.entries(cfg.databases ?? {})
    const wantTables = new Set(dbEntries.filter(([, d]) => d.type === 'dynamodb').map(([k]) => k))
    const wantDbs = new Set(
      dbEntries.filter(([, d]) => d.type === 'postgres' || d.type === 'mysql').map(([k]) => k),
    )
    const wantBuckets = new Set(Object.keys(cfg.buckets ?? {}))
    const orphans: string[] = []

    const allTables = await paginate((ExclusiveStartTableName) =>
      this.clients.dynamo
        .send(new ListTablesCommand({ ExclusiveStartTableName }))
        .then((r) => ({ items: r.TableNames ?? [], next: r.LastEvaluatedTableName })),
    )
    for (const t of allTables)
      if (owned(t) && !wantTables.has(logical(t))) orphans.push(`table ${t}`)

    // S3 bucket names are lowercased at create — compare against a lowercased prefix.
    const lcPrefix = prefix.toLowerCase()
    const buckets = await this.clients.s3.send(new ListBucketsCommand({}))
    for (const b of buckets.Buckets ?? [])
      if (b.Name?.startsWith(lcPrefix) && !wantBuckets.has(b.Name.slice(lcPrefix.length)))
        orphans.push(`bucket ${b.Name}`)

    const allDbs = await paginate((Marker) =>
      this.clients.rds
        .send(new DescribeDBInstancesCommand({ Marker }))
        .then((r) => ({ items: r.DBInstances ?? [], next: r.Marker })),
    )
    for (const d of allDbs)
      if (owned(d.DBInstanceIdentifier) && !wantDbs.has(logical(d.DBInstanceIdentifier)))
        orphans.push(`database ${d.DBInstanceIdentifier}`)

    if (orphans.length) {
      console.warn(
        `\n⚠ ${orphans.length} data resource(s) no longer in slsv.yml but still deployed:`,
      )
      for (const o of orphans) console.warn(`    ${o}`)
      console.warn(`  Not auto-deleted (would lose data). Remove with \`slsv destroy\` if intended.\n`)
    }
  }

  async setup(
    appName: string,
    functionNames: string[],
    tags: Record<string, string>,
    logRetentionDays: number,
  ) {
    this.appName = appName
    this.tags = tags
    console.log('→ IAM exec role')
    this.roleArn = await ensureExecRole(this.clients.iam, appName, tags)

    console.log('→ CloudWatch log groups')
    await Promise.all(
      functionNames.map((name) =>
        ensureLogGroup(this.clients.logs, `${appName}-${name}`, logRetentionDays),
      ),
    )
  }

  async ensureBuckets(buckets: AppConfig['buckets'], appName: string) {
    return ensureBuckets(this.clients.s3, buckets, appName, this.tags)
  }

  async ensureQueues(
    queues: AppConfig['queues'],
    appName: string,
  ): Promise<Record<string, string>> {
    this.queueOutputs = await ensureQueues(this.clients.sqs, queues, appName, this.tags)
    const envVars: Record<string, string> = {}
    for (const [name, q] of Object.entries(this.queueOutputs)) {
      envVars[envKey('QUEUE', name)] = q.url
    }
    return envVars
  }

  async ensureSecrets(secrets: string[], env: Record<string, string | undefined>, prefix: string) {
    return ensureSecrets(this.clients.secrets, secrets, env, prefix, this.tags)
  }

  async ensureCaches(
    caches: AppConfig['caches'],
    appName: string,
  ): Promise<Record<string, string>> {
    // Each caches.<name> → ElastiCache Redis/Valkey group (Floci locally, real AWS for --target aws).
    // Reachability differs by target — redis.ts handles both (aws uses the API endpoint; local
    // reads the valkey container's floci-network IP, since Floci's API returns an unreachable
    // localhost). Pass `local` so it picks the branch.
    return ensureCacheClusters(
      this.clients.elasticache,
      caches,
      appName,
      this.tags,
      this.target === 'local',
    )
  }

  async ensureDatabases(
    databases: AppConfig['databases'],
    appName: string,
    cwd: string,
  ): Promise<Record<string, string>> {
    // DynamoDB entries: provision tables, inject DATABASE_<NAME>=table-name
    const dynamoEntries = Object.fromEntries(
      Object.entries(databases ?? {}).filter(([, v]) => v.type === 'dynamodb'),
    ) as Record<string, import('../../config.js').DynamoDbDef>
    const dynamoEnvs = await ensureDynamoTables(this.clients.dynamo, dynamoEntries, appName, this.tags)

    // Postgres/MySQL: provisioned via the RDS API (Floci locally, real AWS for --target aws).
    // init_sql runs once on first creation. Target-agnostic — the client endpoint decides where.
    const rdsEnvs = await ensureDbInstances(
      this.clients.rds,
      databases,
      appName,
      cwd,
      this.tags,
      this.target === 'local',
    )

    return { ...dynamoEnvs, ...rdsEnvs }
  }

  async deployFunctions(
    functions: AppConfig['functions'],
    appName: string,
    envVars: Record<string, string>,
    cwd: string,
  ): Promise<Record<string, FunctionOutput>> {
    // Injected URLs (e.g. a QUEUE_<NAME> QueueUrl) come back from Floci with a `localhost`
    // host — unreachable from inside the Lambda container. Rewrite to the docker host, same
    // as AWS_ENDPOINT_URL. SQS uses the QueueUrl's host directly, ignoring AWS_ENDPOINT_URL.
    const localizedEnv =
      this.target === 'local'
        ? Object.fromEntries(
            Object.entries(envVars).map(([k, v]) => [
              k,
              v.replaceAll('localhost:4566', 'host.docker.internal:4566'),
            ]),
          )
        : envVars

    const outputs = await deployFunctions(
      this.clients.lambda,
      functions,
      appName,
      this.roleArn!,
      localizedEnv,
      cwd,
      { localEndpoint: this.target === 'local' ? LAMBDA_LOCAL_ENDPOINT : undefined },
      this.tags,
    )
    return outputs
  }

  async updateFunctionCode(fnName: string, zip: Uint8Array) {
    await this.clients.lambda.send(
      new UpdateFunctionCodeCommand({
        FunctionName: fnName,
        ZipFile: zip,
      }),
    )
  }

  async wireHttp(
    functions: AppConfig['functions'],
    fnOutputs: Record<string, FunctionOutput>,
    appName: string,
  ): Promise<string | undefined> {
    if (!functions || !Object.values(functions).some((f) => f.http?.length)) return undefined
    console.log('→ API Gateway')
    return ensureApiGateway(
      this.clients.apigw,
      this.clients.lambda,
      functions,
      fnOutputs,
      appName,
      this.target === 'local',
    )
  }

  async wireQueues(functions: AppConfig['functions'], fnOutputs: Record<string, FunctionOutput>) {
    if (!functions || !Object.values(functions).some((f) => f.queue)) return
    console.log('→ SQS event source mappings')
    await ensureEventSourceMappings(
      this.clients.lambda,
      functions,
      fnOutputs,
      this.queueOutputs,
    )
  }

  async wireCron(
    functions: AppConfig['functions'],
    fnOutputs: Record<string, FunctionOutput>,
    appName: string,
  ) {
    if (!functions || !Object.values(functions).some((f) => f.cron || f.event)) return
    console.log('→ EventBridge rules')
    await ensureCronTriggers(
      this.clients.events,
      this.clients.lambda,
      functions,
      fnOutputs,
      appName,
      this.tags,
    )
    await ensureEventTriggers(
      this.clients.events,
      this.clients.lambda,
      functions,
      fnOutputs,
      appName,
      this.tags,
    )
  }

  async deployFrontend(
    frontend: AppConfig['frontend'],
    appName: string,
    cwd: string,
    apiUrl?: string,
  ): Promise<string | undefined> {
    if (!frontend) return undefined
    console.log('\nFrontend:')
    if (this.target === 'local') return deployFrontendLocal(frontend, cwd, apiUrl)
    // Resolve region from the S3 client's own config (full AWS chain: AWS_REGION,
    // AWS_DEFAULT_REGION, profile, ...) so the website URL matches where the bucket was
    // actually created. `process.env.AWS_REGION ?? 'us-east-1'` mismatched when the region
    // came from a profile / AWS_DEFAULT_REGION.
    const regionCfg = this.clients.s3.config.region
    const region = typeof regionCfg === 'function' ? await regionCfg() : regionCfg
    return deployFrontendAws(
      this.clients.s3,
      this.clients.cloudfront,
      frontend,
      appName,
      cwd,
      region,
      this.tags,
      apiUrl,
    )
  }

  async tailLogs(fnName: string, follow: boolean) {
    await tailLogs(this.clients.logs, fnName, follow)
  }
}

async function ensureFlociAvailable() {
  try {
    const res = await fetch('http://localhost:4566/')
    if (!res.ok) throw new Error(String(res.status))
  } catch {
    throw new Error('Floci is not reachable at http://localhost:4566. Start Floci before running slsv.')
  }
}

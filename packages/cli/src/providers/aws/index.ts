import { envKey } from '../../env-key.js'
import type { Provider, FunctionOutput } from '../types.js'
import type { AppConfig } from '../../config.js'
import { makeClients, type Clients } from './clients.js'
import { ensureExecRole } from './iam.js'
import { ensureLogGroup } from './logs.js'
import { ensureDynamoTables } from './dynamodb.js'
import { ensureBuckets } from './s3.js'
import { ensureQueues, type QueueOutput } from './sqs.js'
import { ensureSecrets } from './secrets.js'
import { deployFunctions } from './functions.js'
import { ensureApiGateway } from './apigw.js'
import { ensureCronTriggers } from './eventbridge.js'
import { ensureEventSourceMappings } from './eventsource.js'
import { tailLogs } from './logs-tail.js'
import { ensureCacheClusters } from './redis.js'
import { ensureDbInstances, collectExternalDatabaseEnvs } from './databases.js'
import { deployFrontendLocal, deployFrontendAws } from './frontend.js'
import { UpdateFunctionCodeCommand, DeleteFunctionCommand } from '@aws-sdk/client-lambda'
import { DeleteTableCommand } from '@aws-sdk/client-dynamodb'
import { ListObjectsV2Command, DeleteObjectsCommand, DeleteBucketCommand } from '@aws-sdk/client-s3'
import { GetQueueUrlCommand, DeleteQueueCommand } from '@aws-sdk/client-sqs'
import { DeleteSecretCommand } from '@aws-sdk/client-secrets-manager'
import { DeleteCacheClusterCommand } from '@aws-sdk/client-elasticache'
import { DeleteDBInstanceCommand } from '@aws-sdk/client-rds'

const LOCAL_ENDPOINT = 'http://localhost:4566'

// ponytail: adapter — wire* helpers expect {name,arn}, deployFunctions returns {name,ref}.
const toAwsOutputs = (
  fnOutputs: Record<string, FunctionOutput>,
): Record<string, { name: string; arn: string }> =>
  Object.fromEntries(Object.entries(fnOutputs).map(([k, v]) => [k, { name: v.name, arn: v.ref }]))

export class AwsProvider implements Provider {
  private target: 'local' | 'aws'
  private clients: Clients
  private roleArn?: string
  private appName = ''
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
  async destroyResources(cfg: AppConfig) {
    const appName = cfg.app
    const swallow = (ok: string[]) => (e: any) => {
      if (!ok.includes(e.name)) throw e
    }

    // Lambda
    for (const name of Object.keys(cfg.functions ?? {})) {
      await this.clients.lambda
        .send(new DeleteFunctionCommand({ FunctionName: `${appName}-${name}` }))
        .catch(swallow(['ResourceNotFoundException']))
    }

    // DynamoDB (databases of type dynamodb)
    for (const [name, d] of Object.entries(cfg.databases ?? {})) {
      if (d.type !== 'dynamodb') continue
      await this.clients.dynamo
        .send(new DeleteTableCommand({ TableName: `${appName}-${name}` }))
        .catch(swallow(['ResourceNotFoundException']))
    }

    // S3 (empty first, AWS refuses non-empty delete)
    for (const name of Object.keys(cfg.buckets ?? {})) {
      const bucket = `${appName}-${name}`.toLowerCase()
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
        if (!['NoSuchBucket', 'NotFound'].includes(e.name)) throw e
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
        if (!['AWS.SimpleQueueService.NonExistentQueue'].includes(e.name)) throw e
      }
    }

    // Secrets (no app prefix — named by env var directly)
    for (const name of cfg.secrets ?? []) {
      await this.clients.secrets
        .send(new DeleteSecretCommand({ SecretId: name, ForceDeleteWithoutRecovery: true }))
        .catch(swallow(['ResourceNotFoundException']))
    }

    // ElastiCache (one cluster per caches.<name>)
    for (const name of Object.keys(cfg.caches ?? {})) {
      await this.clients.elasticache
        .send(new DeleteCacheClusterCommand({ CacheClusterId: `${appName}-${name}` }))
        .catch(swallow(['CacheClusterNotFound', 'CacheClusterNotFoundFault']))
    }

    // RDS (one instance per postgres/mysql databases.<name>)
    for (const [name, d] of Object.entries(cfg.databases ?? {})) {
      if (d.type !== 'postgres' && d.type !== 'mysql') continue
      await this.clients.rds
        .send(new DeleteDBInstanceCommand({ DBInstanceIdentifier: `${appName}-${name}` }))
        .catch(swallow(['DBInstanceNotFound']))
    }
  }

  async setup(appName: string, functionNames: string[]) {
    this.appName = appName
    console.log('→ IAM exec role')
    this.roleArn = await ensureExecRole(this.clients.iam)

    console.log('→ CloudWatch log groups')
    await Promise.all(
      functionNames.map((name) => ensureLogGroup(this.clients.logs, `${appName}-${name}`)),
    )
  }

  async ensureBuckets(buckets: AppConfig['buckets'], appName: string) {
    return ensureBuckets(this.clients.s3, buckets, appName)
  }

  async ensureQueues(
    queues: AppConfig['queues'],
    appName: string,
  ): Promise<Record<string, string>> {
    this.queueOutputs = await ensureQueues(this.clients.sqs, queues, appName)
    const envVars: Record<string, string> = {}
    for (const [name, q] of Object.entries(this.queueOutputs)) {
      envVars[envKey('QUEUE', name)] = q.url
    }
    return envVars
  }

  async ensureSecrets(secrets: string[], env: Record<string, string | undefined>) {
    return ensureSecrets(this.clients.secrets, secrets, env)
  }

  async ensureCaches(
    caches: AppConfig['caches'],
    appName: string,
  ): Promise<Record<string, string>> {
    // Each caches.<name> → ElastiCache Redis cluster (Floci locally, real AWS for --target aws).
    // Floci spins up a real redis process per cluster; the endpoint comes back from the API.
    // Local: override host→host.docker.internal so Lambda (inside the floci container) reaches
    // the host-published cluster ports. AWS: use the real endpoint address as-is.
    const hostOverride = this.target === 'local' ? 'host.docker.internal' : undefined
    return ensureCacheClusters(this.clients.elasticache, caches, appName, hostOverride)
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
    const dynamoEnvs = await ensureDynamoTables(this.clients.dynamo, dynamoEntries, appName)

    // Postgres/MySQL: provisioned via the RDS API (Floci locally, real AWS for --target aws).
    // init_sql runs once on first creation. Target-agnostic — the client endpoint decides where.
    const rdsEnvs = await ensureDbInstances(this.clients.rds, databases, appName, cwd)

    // External: BYO connection string from process.env (DATABASE_<NAME>).
    const externalEnvs = collectExternalDatabaseEnvs(
      databases,
      process.env as Record<string, string | undefined>,
    )

    return { ...dynamoEnvs, ...rdsEnvs, ...externalEnvs }
  }

  async deployFunctions(
    functions: AppConfig['functions'],
    appName: string,
    envVars: Record<string, string>,
    cwd: string,
  ): Promise<Record<string, FunctionOutput>> {
    const outputs = await deployFunctions(
      this.clients.lambda,
      functions,
      appName,
      this.roleArn!,
      envVars,
      cwd,
      { localEndpoint: this.target === 'local' ? LOCAL_ENDPOINT : undefined },
    )
    return Object.fromEntries(
      Object.entries(outputs).map(([k, v]) => [k, { name: v.name, ref: v.arn }]),
    )
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
      toAwsOutputs(fnOutputs),
      appName,
    )
  }

  async wireQueues(functions: AppConfig['functions'], fnOutputs: Record<string, FunctionOutput>) {
    console.log('→ SQS event source mappings')
    await ensureEventSourceMappings(
      this.clients.lambda,
      functions,
      toAwsOutputs(fnOutputs),
      this.queueOutputs,
    )
  }

  async wireCron(
    functions: AppConfig['functions'],
    fnOutputs: Record<string, FunctionOutput>,
    appName: string,
  ) {
    console.log('→ EventBridge cron rules')
    await ensureCronTriggers(
      this.clients.events,
      this.clients.lambda,
      functions,
      toAwsOutputs(fnOutputs),
      appName,
    )
  }

  async deployFrontend(
    frontend: AppConfig['frontend'],
    appName: string,
    cwd: string,
  ): Promise<string | undefined> {
    if (!frontend) return undefined
    console.log('\nFrontend:')
    if (this.target === 'local') return deployFrontendLocal(frontend, cwd)
    const region = process.env.AWS_REGION ?? 'us-east-1'
    return deployFrontendAws(this.clients.s3, frontend, appName, cwd, region)
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

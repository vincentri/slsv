import {
  ListTablesCommand,
  DescribeTableCommand,
  ScanCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import {
  ListQueuesCommand,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs'
import {
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  GetBucketVersioningCommand,
  GetBucketEncryptionCommand,
  GetBucketLocationCommand,
  GetBucketTaggingCommand,
  GetBucketAclCommand,
  GetBucketPolicyCommand,
  GetBucketWebsiteCommand,
  GetBucketRequestPaymentCommand,
  GetBucketNotificationConfigurationCommand,
  GetBucketLoggingCommand,
  GetBucketAccelerateConfigurationCommand,
  GetObjectLockConfigurationCommand,
  GetBucketCorsCommand,
  GetPublicAccessBlockCommand,
  GetBucketOwnershipControlsCommand,
  GetObjectAclCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { FilterLogEventsCommand, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs'
import {
  GetRestApisCommand,
  GetResourcesCommand,
  GetStagesCommand,
} from '@aws-sdk/client-api-gateway'
import { ListSecretsCommand, DescribeSecretCommand } from '@aws-sdk/client-secrets-manager'
import { ListFunctionsCommand, GetFunctionConfigurationCommand } from '@aws-sdk/client-lambda'
import {
  ListEventBusesCommand,
  ListRulesCommand,
  DescribeRuleCommand,
  ListTargetsByRuleCommand,
} from '@aws-sdk/client-eventbridge'
import { DescribeCacheClustersCommand } from '@aws-sdk/client-elasticache'
import { DescribeDBInstancesCommand } from '@aws-sdk/client-rds'
import Redis from 'ioredis'
import { listTables, type SqlConn } from './sql.js'
import type { Clients } from './clients.js'
import type { Account } from './config.js'

const b64 = {
  enc: (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64'),
  dec: (s: string) => JSON.parse(Buffer.from(s, 'base64').toString()),
}

// Discover everything in the account — no slsv.yml, no name prefix.
export async function overview(clients: Clients, acct: Account) {
  const region = acct.region ?? 'us-east-1'

  const databases = await safe([], async () => {
    const t = await clients.dynamo.send(new ListTablesCommand({}))
    return Promise.all(
      (t.TableNames ?? []).map(async (name) => {
        let count = 0
        try {
          const d = await clients.dynamo.send(new DescribeTableCommand({ TableName: name }))
          count = d.Table?.ItemCount ?? 0 // approximate, free (no scan)
        } catch {}
        return { name, count }
      }),
    )
  })

  const queues = await safe([], async () => {
    const q = await clients.sqs.send(new ListQueuesCommand({}))
    return Promise.all(
      (q.QueueUrls ?? []).map(async (url) => {
        const name = url.split('/').pop()!
        let depth = '0'
        try {
          const a = await clients.sqs.send(
            new GetQueueAttributesCommand({
              QueueUrl: url,
              AttributeNames: ['ApproximateNumberOfMessages'],
            }),
          )
          depth = a.Attributes?.ApproximateNumberOfMessages ?? '0'
        } catch {}
        return { name, depth }
      }),
    )
  })

  const buckets = await safe([], async () => {
    const r = await clients.s3.send(new ListBucketsCommand({}))
    return (r.Buckets ?? []).map((x) => ({ name: x.Name!, created: x.CreationDate?.toISOString() }))
  })

  const functions = await safe([], async () => {
    const r = await clients.lambda.send(new ListFunctionsCommand({}))
    return (r.Functions ?? []).map((x) => ({
      name: x.FunctionName!,
      runtime: x.Runtime,
      memory: x.MemorySize,
      timeout: x.Timeout,
      lastModified: x.LastModified,
    }))
  })

  const logGroups = await safe([], async () => {
    const r = await clients.logs.send(new DescribeLogGroupsCommand({ limit: 50 }))
    return (r.logGroups ?? []).map((g) => ({
      name: g.logGroupName!,
      storedBytes: g.storedBytes ?? 0,
    }))
  })

  const apis = await safe([], async () => {
    const r = await clients.apigw.send(new GetRestApisCommand({}))
    return (r.items ?? []).map((x) => ({
      id: x.id!,
      name: x.name!,
      url: acct.endpoint
        ? `${acct.endpoint}/restapis/${x.id}/local/_user_request_`
        : `https://${x.id}.execute-api.${region}.amazonaws.com`,
    }))
  })

  const secrets = await safe([], async () => {
    const r = await clients.secrets.send(new ListSecretsCommand({}))
    return (r.SecretList ?? []).map((x) => x.Name!) // NAMES ONLY — never values
  })

  const buses = await safe([], async () => {
    const r = await clients.eb.send(new ListEventBusesCommand({}))
    return (r.EventBuses ?? []).filter((b) => b.Name !== 'default').map((b) => ({ name: b.Name! }))
  })

  // Caches: discovered live via the ElastiCache API (one cluster per caches.<name>).
  // MiniStack emulates ElastiCache and spins up a real redis process per cluster.
  const caches = await safe([], async () => {
    const r = await clients.elasticache.send(
      new DescribeCacheClustersCommand({ ShowCacheNodeInfo: true }),
    )
    return (r.CacheClusters ?? []).flatMap((c) => {
      const node = c?.CacheNodes?.[0]?.Endpoint
      if (!node?.Address || !node.Port) return []
      return [{ name: c.CacheClusterId!, url: `redis://${node.Address}:${node.Port}` }]
    })
  })
  // SQL databases: postgres/mysql discovered live via the RDS API (MiniStack spins up a
  // real DB process per instance). `external` entries come from acct.sqlDatabases (BYO URL).
  const rdsDbs = await safe([], async () => {
    const r = await clients.rds.send(new DescribeDBInstancesCommand({}))
    return (r.DBInstances ?? []).flatMap((i) => {
      const url = buildSqlUrl(i)
      if (!url) return []
      const engine = i.Engine as 'postgres' | 'mysql'
      return { name: i.DBInstanceIdentifier!, type: engine, url }
    })
  })
  const allSql = [
    ...rdsDbs,
    ...(acct.sqlDatabases ?? []).map((s) => ({
      name: s.name,
      type: s.type as 'postgres' | 'mysql',
      url: s.url,
    })),
  ]
  const sqlDatabases = await Promise.all(
    allSql.map(async (s) => {
      const tables = await safe([], () => listTables({ type: s.type, url: s.url }))
      return { name: s.name, type: s.type, tables: tables.length }
    }),
  )

  return {
    account: acct.name,
    region,
    databases,
    queues,
    buckets,
    functions,
    logGroups,
    apis,
    secrets,
    caches,
    buses,
    sqlDatabases,
    topology: acct.topology,
  }
}

export type LambdaConfig = {
  name: string
  arn: string
  state?: string
  lastUpdateStatus?: string
  version: string
  packageType: string
  architectures: string[]
  runtime?: string
  handler?: string
  memory: number
  timeout: number
  ephemeralStorage: number
  codeSize: number
  codeSha256: string
  lastModified?: string
  role: string
  layers: string[]
  tracingMode?: string
  dlqTarget?: string
  logGroup?: string
  env: Record<string, string>
}

export async function getFunction(clients: Clients, name: string): Promise<LambdaConfig> {
  const r = await clients.lambda.send(new GetFunctionConfigurationCommand({ FunctionName: name }))
  return {
    name: r.FunctionName!,
    arn: r.FunctionArn!,
    state: r.State,
    lastUpdateStatus: r.LastUpdateStatus,
    version: r.Version ?? '$LATEST',
    packageType: r.PackageType ?? 'Zip',
    architectures: r.Architectures ?? ['x86_64'],
    runtime: r.Runtime,
    handler: r.Handler,
    memory: r.MemorySize ?? 128,
    timeout: r.Timeout ?? 3,
    ephemeralStorage: r.EphemeralStorage?.Size ?? 512,
    codeSize: r.CodeSize ?? 0,
    codeSha256: r.CodeSha256 ?? '',
    lastModified: r.LastModified,
    role: r.Role ?? '',
    layers: (r.Layers ?? []).map((l) => l.Arn ?? '').filter(Boolean),
    tracingMode: r.TracingConfig?.Mode,
    dlqTarget: r.DeadLetterConfig?.TargetArn,
    logGroup: r.LoggingConfig?.LogGroup,
    env: r.Environment?.Variables ?? {},
  }
}

export async function getApi(clients: Clients, acct: Account, id: string) {
  const region = acct.region ?? 'us-east-1'
  const [resources, stages] = await Promise.all([
    clients.apigw.send(new GetResourcesCommand({ restApiId: id, embed: ['methods'] })),
    clients.apigw.send(new GetStagesCommand({ restApiId: id })),
  ])

  const routes = (resources.items ?? [])
    .flatMap((r) => {
      const path = r.path ?? '/'
      const methods = Object.keys(r.resourceMethods ?? {})
      if (methods.length === 0) return []
      return methods.map((method) => ({
        method,
        path,
        integration: (r.resourceMethods?.[method] as any)?.methodIntegration?.type,
      }))
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))

  const stageList = (stages.item ?? []).map((s) => ({
    name: s.stageName!,
    url: acct.endpoint
      ? `${acct.endpoint}/restapis/${id}/${s.stageName}/_user_request_`
      : `https://${id}.execute-api.${region}.amazonaws.com/${s.stageName}`,
    createdDate: s.createdDate?.toISOString(),
    lastUpdated: s.lastUpdatedDate?.toISOString(),
  }))

  return { id, routes, stages: stageList }
}

export async function getSecret(clients: Clients, name: string) {
  const r = await clients.secrets.send(new DescribeSecretCommand({ SecretId: name }))
  // NEVER call GetSecretValue — metadata only
  return {
    name: r.Name!,
    arn: r.ARN,
    createdDate: r.CreatedDate?.toISOString(),
    lastChangedDate: r.LastChangedDate?.toISOString(),
    lastAccessedDate: r.LastAccessedDate?.toISOString(),
    rotationEnabled: r.RotationEnabled ?? false,
    rotationRules: r.RotationRules ?? null,
    tags: Object.fromEntries((r.Tags ?? []).map((t) => [t.Key!, t.Value ?? ''])),
  }
}

export async function getBus(clients: Clients, busName: string) {
  const r = await clients.eb.send(new ListRulesCommand({ EventBusName: busName }))
  return (r.Rules ?? []).map((rule) => ({
    name: rule.Name!,
    state: rule.State,
    scheduleExpression: rule.ScheduleExpression,
    eventPattern: rule.EventPattern,
    description: rule.Description,
    arn: rule.Arn,
  }))
}

export async function getRule(clients: Clients, busName: string, ruleName: string) {
  const [desc, targets] = await Promise.all([
    clients.eb.send(new DescribeRuleCommand({ Name: ruleName, EventBusName: busName })),
    clients.eb.send(new ListTargetsByRuleCommand({ Rule: ruleName, EventBusName: busName })),
  ])
  return {
    name: desc.Name!,
    arn: desc.Arn,
    state: desc.State,
    scheduleExpression: desc.ScheduleExpression,
    eventPattern: desc.EventPattern,
    description: desc.Description,
    targets: (targets.Targets ?? []).map((t) => ({ id: t.Id!, arn: t.Arn! })),
  }
}

export async function scanTable(
  clients: Clients,
  name: string,
  opts: { cursor?: string; index?: string; limit?: number } = {},
) {
  const r = await clients.dynamo.send(
    new ScanCommand({
      TableName: name,
      Limit: opts.limit ?? 100,
      ExclusiveStartKey: opts.cursor ? b64.dec(opts.cursor) : undefined,
      IndexName: opts.index,
    }),
  )
  return {
    items: (r.Items ?? []).map((i) => unmarshall(i)),
    cursor: r.LastEvaluatedKey ? b64.enc(r.LastEvaluatedKey) : undefined,
  }
}

export async function queryTable(
  clients: Clients,
  name: string,
  opts: {
    pk: string
    pkName: string
    sk?: string
    op?: string
    index?: string
    limit?: number
    cursor?: string
  },
) {
  let KeyConditionExpression = '#pk = :pk'
  const names: Record<string, string> = { '#pk': opts.pkName }
  const values: Record<string, any> = { ':pk': { S: opts.pk } }
  if (opts.sk && opts.op) {
    KeyConditionExpression += ` AND #sk ${opts.op} :sk`
    names['#sk'] = 'sk'
    values[':sk'] = { S: opts.sk }
  }
  const r = await clients.dynamo.send(
    new QueryCommand({
      TableName: name,
      IndexName: opts.index,
      KeyConditionExpression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      Limit: opts.limit ?? 100,
      ExclusiveStartKey: opts.cursor ? b64.dec(opts.cursor) : undefined,
    }),
  )
  return {
    items: (r.Items ?? []).map((i) => unmarshall(i)),
    cursor: r.LastEvaluatedKey ? b64.enc(r.LastEvaluatedKey) : undefined,
  }
}

export async function peekQueue(clients: Clients, name: string, max = 10) {
  const { QueueUrl } = await clients.sqs.send(new GetQueueUrlCommand({ QueueName: name }))
  const r = await clients.sqs.send(
    new ReceiveMessageCommand({
      QueueUrl,
      MaxNumberOfMessages: Math.min(max, 10),
      VisibilityTimeout: 0,
      WaitTimeSeconds: 0,
    }),
  )
  return (r.Messages ?? []).map((m) => ({ id: m.MessageId, body: m.Body }))
}

export async function listObjects(
  clients: Clients,
  bucket: string,
  prefix?: string,
  token?: string,
  search?: string,
  limit = 200,
) {
  const effectivePrefix = search ? (prefix ?? '') + search : prefix || undefined
  const r = await clients.s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: effectivePrefix,
      Delimiter: '/',
      MaxKeys: limit,
      ContinuationToken: token || undefined,
    }),
  )
  const folders = (r.CommonPrefixes ?? []).map((p) => p.Prefix!)
  const objects = (r.Contents ?? [])
    .filter((o) => o.Key !== (prefix || undefined))
    .map((o) => ({ key: o.Key!, size: o.Size ?? 0, modified: o.LastModified?.toISOString() }))
  return { prefix: prefix ?? '', folders, objects, nextToken: r.NextContinuationToken }
}

export async function getBucket(clients: Clients, acct: Account, bucket: string) {
  // ponytail: best-effort calls; MiniStack may not support all S3 control-plane APIs
  const safe = <T>(p: Promise<T>) => p.catch(() => undefined)
  const [
    bucketsList,
    versioning,
    encryption,
    location,
    tags,
    acl,
    policy,
    website,
    reqPay,
    notifications,
    logging,
    accelerate,
    objectLock,
    cors,
    pab,
    ownership,
    objs,
  ] = await Promise.all([
    clients.s3.send(new ListBucketsCommand({})).catch(() => null),
    safe(clients.s3.send(new GetBucketVersioningCommand({ Bucket: bucket }))),
    safe(clients.s3.send(new GetBucketEncryptionCommand({ Bucket: bucket }))),
    safe(clients.s3.send(new GetBucketLocationCommand({ Bucket: bucket }))),
    safe(clients.s3.send(new GetBucketTaggingCommand({ Bucket: bucket }))),
    safe(clients.s3.send(new GetBucketAclCommand({ Bucket: bucket }))),
    safe(clients.s3.send(new GetBucketPolicyCommand({ Bucket: bucket }))),
    safe(clients.s3.send(new GetBucketWebsiteCommand({ Bucket: bucket }))),
    safe(clients.s3.send(new GetBucketRequestPaymentCommand({ Bucket: bucket }))),
    safe(clients.s3.send(new GetBucketNotificationConfigurationCommand({ Bucket: bucket }))),
    safe(clients.s3.send(new GetBucketLoggingCommand({ Bucket: bucket }))),
    safe(clients.s3.send(new GetBucketAccelerateConfigurationCommand({ Bucket: bucket }))),
    safe(clients.s3.send(new GetObjectLockConfigurationCommand({ Bucket: bucket }))),
    safe(clients.s3.send(new GetBucketCorsCommand({ Bucket: bucket }))),
    safe(clients.s3.send(new GetPublicAccessBlockCommand({ Bucket: bucket }))),
    safe(clients.s3.send(new GetBucketOwnershipControlsCommand({ Bucket: bucket }))),
    // ponytail: counts first 1000 keys only; paginate if buckets grow large
    clients.s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000 })).catch(() => null),
  ])
  const b = bucketsList?.Buckets?.find((b) => b.Name === bucket)
  const tagMap = Object.fromEntries((tags?.TagSet ?? []).map((t) => [t.Key!, t.Value!]))
  const notifCount =
    (notifications?.LambdaFunctionConfigurations?.length ?? 0) +
    (notifications?.QueueConfigurations?.length ?? 0) +
    (notifications?.TopicConfigurations?.length ?? 0)
  const websiteVal = website?.IndexDocument?.Suffix
    ? `Enabled (index: ${website.IndexDocument.Suffix})`
    : website
      ? 'Enabled'
      : undefined
  return {
    name: bucket,
    arn: `arn:aws:s3:::${bucket}`,
    region: location?.LocationConstraint ?? acct.region ?? 'us-east-1',
    created: b?.CreationDate?.toISOString(),
    owner: acl?.Owner?.DisplayName ?? acl?.Owner?.ID,
    versioning: versioning?.Status,
    encryption:
      encryption?.ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault
        ?.SSEAlgorithm,
    tags: Object.keys(tagMap).length ? tagMap : undefined,
    serverAccessLogging: logging?.LoggingEnabled?.TargetBucket,
    eventNotifications: notifCount || undefined,
    eventBridge: (notifications as any)?.EventBridgeConfiguration !== undefined ? true : undefined,
    transferAcceleration: accelerate?.Status,
    objectLock: objectLock?.ObjectLockConfiguration?.ObjectLockEnabled,
    requesterPays: reqPay?.Payer,
    website: websiteVal,
    policy: policy?.Policy,
    cors: cors?.CORSRules?.length ? `${cors.CORSRules.length} rule(s)` : undefined,
    publicAccessBlock: pab
      ? {
          blockPublicAcls: pab.PublicAccessBlockConfiguration?.BlockPublicAcls ?? false,
          ignorePublicAcls: pab.PublicAccessBlockConfiguration?.IgnorePublicAcls ?? false,
          blockPublicPolicy: pab.PublicAccessBlockConfiguration?.BlockPublicPolicy ?? false,
          restrictPublicBuckets: pab.PublicAccessBlockConfiguration?.RestrictPublicBuckets ?? false,
        }
      : undefined,
    ownershipControls: ownership?.OwnershipControls?.Rules?.[0]?.ObjectOwnership,
    aclGrants: acl?.Grants?.map((g) => ({
      grantee: g.Grantee?.DisplayName ?? g.Grantee?.URI ?? g.Grantee?.ID ?? 'Unknown',
      permission: g.Permission ?? '',
    })),
    objectCount: objs?.KeyCount ?? 0,
    totalSize: (objs?.Contents ?? []).reduce((s, o) => s + (o.Size ?? 0), 0),
  }
}

export async function getObject(clients: Clients, bucket: string, key: string) {
  const r = await clients.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  return {
    contentType: r.ContentType ?? 'application/octet-stream',
    body: await r.Body!.transformToString(),
  }
}

export async function headObject(clients: Clients, bucket: string, key: string) {
  const r = await clients.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  return {
    key,
    size: r.ContentLength ?? 0,
    modified: r.LastModified?.toISOString(),
    contentType: r.ContentType ?? 'application/octet-stream',
    etag: r.ETag?.replace(/"/g, ''),
    storageClass: r.StorageClass ?? 'STANDARD',
    metadata: r.Metadata ?? {},
    versionId: r.VersionId,
    serverSideEncryption: r.ServerSideEncryption,
    expires: r.Expires?.toISOString(),
    cacheControl: r.CacheControl,
    contentEncoding: r.ContentEncoding,
    contentDisposition: r.ContentDisposition,
    checksumAlgorithm: r.ChecksumAlgorithm?.[0],
  }
}

// ponytail: LocalStack + ownership-controls gating can 403/404 on object ACL. Swallow → empty grants; UI shows "No grants".
export async function getObjectAcl(clients: Clients, bucket: string, key: string) {
  try {
    const r = await clients.s3.send(new GetObjectAclCommand({ Bucket: bucket, Key: key }))
    return {
      key,
      owner: r.Owner?.DisplayName ?? r.Owner?.ID ?? null,
      grants: (r.Grants ?? []).map((g) => ({
        grantee: g.Grantee?.DisplayName ?? g.Grantee?.URI ?? g.Grantee?.ID ?? 'Unknown',
        permission: g.Permission ?? '',
      })),
    }
  } catch {
    return { key, owner: null, grants: [] }
  }
}

export async function deleteObject(clients: Clients, bucket: string, key: string) {
  await clients.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

// group = full log group name e.g. /aws/lambda/my-fn or any custom group
export async function tailLogs(
  clients: Clients,
  group: string,
  opts: { since?: number; limit?: number; filter?: string } = {},
) {
  const r = await clients.logs.send(
    new FilterLogEventsCommand({
      logGroupName: group,
      startTime: opts.since,
      limit: opts.limit ?? 100,
      filterPattern: opts.filter,
    }),
  )
  return (r.events ?? []).map((e) => ({ time: e.timestamp, msg: e.message }))
}

// ponytail: Redis read = SCAN (cursor + COUNT cap) w/ value inlined. Never KEYS *.
export async function scanCache(
  clients: Clients,
  name: string,
  opts: { cursor?: string; match?: string; limit?: number } = {},
) {
  const r = await clients.elasticache.send(
    new DescribeCacheClustersCommand({ CacheClusterId: name, ShowCacheNodeInfo: true }),
  )
  const node = r.CacheClusters?.[0]?.CacheNodes?.[0]?.Endpoint
  if (!node?.Address || !node.Port) throw new Error(`Unknown cache: ${name}`)
  const redis = new Redis(`redis://${node.Address}:${node.Port}`, { lazyConnect: true })
  try {
    const [next, keys] = await redis.scan(
      opts.cursor ?? '0',
      'MATCH',
      opts.match ?? '*',
      'COUNT',
      opts.limit ?? 100,
    )
    const result = await Promise.all(
      keys.map(async (key) => {
        const [type, ttl, value] = await Promise.all([
          redis.type(key),
          redis.ttl(key),
          redis.get(key),
        ])
        return { key, type, ttl, value }
      }),
    )
    return { keys: result, cursor: next === '0' ? undefined : next }
  } finally {
    redis.disconnect()
  }
}

// Must match packages/cli/src/providers/aws/databases.ts ENGINE_CFG.
// ponytail: duplicated 2-engine table rather than a shared package — both are fixed local-dev creds.
const SQL_ENGINE_CFG = {
  postgres: { user: 'postgres', pass: 'postgres', scheme: 'postgres' },
  mysql: { user: 'admin', pass: 'adminadmin', scheme: 'mysql' },
} as const

function buildSqlUrl(i: any): string | undefined {
  const ec = i?.Engine ? SQL_ENGINE_CFG[i.Engine as keyof typeof SQL_ENGINE_CFG] : undefined
  const addr = i?.Endpoint?.Address,
    port = i?.Endpoint?.Port,
    db = i?.DBName
  if (!ec || !addr || !port || !db) return undefined
  return `${ec.scheme}://${ec.user}:${ec.pass}@${addr}:${port}/${db}`
}

// Resolve a SQL connection for the browse routes: RDS-managed instances (query live)
// first, then `external` entries from the account config (BYO URL).
export async function resolveSqlConn(
  clients: Clients,
  acct: Account,
  name: string,
): Promise<SqlConn | undefined> {
  try {
    const r = await clients.rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: name }))
    const inst = r.DBInstances?.[0]
    const url = inst ? buildSqlUrl(inst) : undefined
    if (inst && url) return { type: inst.Engine as 'postgres' | 'mysql', url }
  } catch {}
  const s = acct.sqlDatabases?.find((d) => d.name === name)
  return s ? { type: s.type as 'postgres' | 'mysql', url: s.url } : undefined
}

async function safe<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

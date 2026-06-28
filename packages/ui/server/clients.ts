import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { ElastiCacheClient } from '@aws-sdk/client-elasticache'
import { RDSClient } from '@aws-sdk/client-rds'
import { SQSClient } from '@aws-sdk/client-sqs'
import { S3Client } from '@aws-sdk/client-s3'
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs'
import { APIGatewayClient } from '@aws-sdk/client-api-gateway'
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { LambdaClient } from '@aws-sdk/client-lambda'
import { EventBridgeClient } from '@aws-sdk/client-eventbridge'
import { fromIni } from '@aws-sdk/credential-providers'
import type { Account } from './config.js'

export type Clients = ReturnType<typeof makeClients>

// endpoint set (local emulator) → dummy creds. profile set → resolve from ~/.aws
// (fromIni handles SSO profiles too). neither → default provider chain.
export function makeClients(acct: Account) {
  const credentials = acct.endpoint
    ? { accessKeyId: 'test', secretAccessKey: 'test' }
    : acct.profile
      ? fromIni({ profile: acct.profile })
      : undefined

  const cfg = {
    region: acct.region ?? 'us-east-1',
    endpoint: acct.endpoint,
    credentials,
  }

  return {
    dynamo: new DynamoDBClient(cfg),
    elasticache: new ElastiCacheClient(cfg),
    rds: new RDSClient(cfg),
    sqs: new SQSClient(cfg),
    s3: new S3Client({ ...cfg, forcePathStyle: !!acct.endpoint }),
    logs: new CloudWatchLogsClient(cfg),
    apigw: new APIGatewayClient(cfg),
    secrets: new SecretsManagerClient(cfg),
    lambda: new LambdaClient(cfg),
    eb: new EventBridgeClient(cfg),
  }
}

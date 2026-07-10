import { LambdaClient } from "@aws-sdk/client-lambda";
import { ApiGatewayV2Client } from "@aws-sdk/client-apigatewayv2";
import { SQSClient } from "@aws-sdk/client-sqs";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ElastiCacheClient } from "@aws-sdk/client-elasticache";
import { RDSClient } from "@aws-sdk/client-rds";
import { S3Client } from "@aws-sdk/client-s3";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { IAMClient } from "@aws-sdk/client-iam";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";

const LOCAL_CFG = {
  endpoint: "http://localhost:4566",
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
};

export type Clients = ReturnType<typeof makeClients>;

export function makeClients(target: "local" | "aws" = "local") {
  const cfg = target === "local" ? LOCAL_CFG : { region: process.env.AWS_REGION };
  return {
    lambda: new LambdaClient(cfg),
    apigw: new ApiGatewayV2Client(cfg),
    sqs: new SQSClient(cfg),
    events: new EventBridgeClient(cfg),
    dynamo: new DynamoDBClient(cfg),
    elasticache: new ElastiCacheClient(cfg),
    rds: new RDSClient(cfg),
    s3: new S3Client(cfg),
    secrets: new SecretsManagerClient(cfg),
    iam: new IAMClient(cfg),
    logs: new CloudWatchLogsClient(cfg),
    // CloudFront is a global service reachable only via its us-east-1 endpoint.
    cloudfront: new CloudFrontClient(target === "local" ? LOCAL_CFG : { region: "us-east-1" }),
  };
}

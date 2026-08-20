import { envKey } from "../../env-key.js";
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketTaggingCommand,
  PutPublicAccessBlockCommand,
  PutBucketPolicyCommand,
  PutBucketCorsCommand,
  PutBucketNotificationConfigurationCommand,
  type Event,
  type LambdaFunctionConfiguration,
} from "@aws-sdk/client-s3";
import { LambdaClient, AddPermissionCommand } from "@aws-sdk/client-lambda";
import { asTagArray } from "./tags.js";
import { arnRegionAccount } from "./eventbridge.js";
import { bucketTriggers, type AppConfig } from "../../config.js";
import { resourceName } from "../../utils/names.js";

export async function ensureBucketExists(
  s3: S3Client,
  bucket: string,
  tags: Record<string, string>,
  opts: { publicRead?: boolean; cors?: string[] } = {},
): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await s3.send(
    new PutBucketTaggingCommand({ Bucket: bucket, Tagging: { TagSet: asTagArray(tags) } }),
  );
  if (opts.publicRead) {
    await s3.send(
      new PutPublicAccessBlockCommand({
        Bucket: bucket,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: false,
          IgnorePublicAcls: false,
          BlockPublicPolicy: false,
          RestrictPublicBuckets: false,
        },
      }),
    );
    await s3.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: "*",
              Action: "s3:GetObject",
              Resource: `arn:aws:s3:::${bucket}/*`,
            },
          ],
        }),
      }),
    );
  }
  if (opts.cors && opts.cors.length > 0) {
    // ponytail: GET/PUT/HEAD cover read + presigned-upload. POST is required for the
    // legacy form-upload flow most browsers use when JS SDKs aren't available.
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: opts.cors,
              AllowedMethods: ["GET", "PUT", "POST", "HEAD"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3000,
            },
          ],
        },
      }),
    );
  }
}

export async function ensureBuckets(
  s3: S3Client,
  buckets: AppConfig["buckets"],
  appName: string,
  tags: Record<string, string>,
): Promise<Record<string, string>> {
  const envVars: Record<string, string> = {};
  if (!buckets) return envVars;

  for (const [name, cfg] of Object.entries(buckets)) {
    const bucketName = resourceName(appName, name).toLowerCase();
    await ensureBucketExists(s3, bucketName, tags, {
      publicRead: cfg.publicRead,
      cors: cfg.cors,
    });
    envVars[envKey("BUCKET", name)] = bucketName;
  }

  return envVars;
}

// --- S3 event trigger (`functions.<fn>.bucket`) ---
// Wires `bucket: { name, events?, prefix?, suffix? }` to Lambda via bucket notifications.
// PutBucketNotificationConfiguration REPLACES the bucket's whole config, so this runs once
// per DECLARED bucket with the full desired set (all fns triggering on it, merged) — which
// also converges removal: dropping the trigger from the yml clears it on the next deploy.
// AddPermission must land BEFORE the Put — real AWS validates the destination and rejects
// the config if S3 can't invoke the fn. ponytail: a manually-added notification on an
// slsv-managed bucket is overwritten every deploy (slsv owns its buckets' config).
export async function ensureBucketTriggers(
  s3: S3Client,
  lambda: LambdaClient,
  functions: AppConfig["functions"],
  fnOutputs: Record<string, { name: string; arn: string }>,
  buckets: AppConfig["buckets"],
  appName: string,
) {
  const S3_EVENTS: Record<string, Event> = {
    created: "s3:ObjectCreated:*",
    removed: "s3:ObjectRemoved:*",
  };

  for (const logical of Object.keys(buckets ?? {})) {
    const bucketName = resourceName(appName, logical).toLowerCase();
    const configs: LambdaFunctionConfiguration[] = [];

    for (const [fnName, fn] of Object.entries(functions ?? {})) {
      const triggers = bucketTriggers(fn).filter((t) => t.name === logical);
      if (!triggers.length) continue;
      const fnOutput = fnOutputs[fnName];
      const { account } = arnRegionAccount(fnOutput.arn);

      try {
        await lambda.send(
          new AddPermissionCommand({
            FunctionName: fnOutput.name,
            StatementId: `s3-${bucketName}`,
            Action: "lambda:InvokeFunction",
            Principal: "s3.amazonaws.com",
            SourceArn: `arn:aws:s3:::${bucketName}`,
            SourceAccount: account, // confused-deputy guard: bucket ARNs carry no account
          }),
        );
      } catch (e: any) {
        if (e.name !== "ResourceConflictException") throw e;
      }

      triggers.forEach((t, i) => {
        const rules = [
          ...(t.prefix ? [{ Name: "prefix" as const, Value: t.prefix }] : []),
          ...(t.suffix ? [{ Name: "suffix" as const, Value: t.suffix }] : []),
        ];
        configs.push({
          // `-<i>` keeps Ids unique when one fn has several filter blocks on the same bucket.
          Id: `slsv-${fnOutput.name}-${i}`,
          LambdaFunctionArn: fnOutput.arn,
          Events: (t.events ?? ["created"]).map((e) => S3_EVENTS[e]),
          ...(rules.length && { Filter: { Key: { FilterRules: rules } } }),
        });
      });
    }

    await s3.send(
      new PutBucketNotificationConfigurationCommand({
        Bucket: bucketName,
        // Empty config when no fn triggers on this bucket — clears a dropped trigger.
        NotificationConfiguration: configs.length ? { LambdaFunctionConfigurations: configs } : {},
      }),
    );
  }
}

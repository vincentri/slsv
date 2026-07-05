import { envKey } from '../../env-key.js'
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketTaggingCommand,
  PutPublicAccessBlockCommand,
  PutBucketPolicyCommand,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3'
import { asTagArray } from './tags.js'
import type { AppConfig } from '../../config.js'

export async function ensureBuckets(
  s3: S3Client,
  buckets: AppConfig['buckets'],
  appName: string,
  tags: Record<string, string>,
): Promise<Record<string, string>> {
  const envVars: Record<string, string> = {}
  if (!buckets) return envVars

  for (const [name, cfg] of Object.entries(buckets)) {
    const bucketName = `${appName}-${name}`.toLowerCase()
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucketName }))
      console.log(`  ✓ bucket ${bucketName} exists`)
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: bucketName }))
      console.log(`  + created bucket ${bucketName}`)
    }
    await s3.send(
      new PutBucketTaggingCommand({ Bucket: bucketName, Tagging: { TagSet: asTagArray(tags) } }),
    )

    if (cfg.publicRead) {
      // Same 3-call shape as frontend.ts: disable the public-access blocks, then attach
      // an s3:GetObject policy. Idempotent — safe to re-run on every deploy.
      await s3.send(
        new PutPublicAccessBlockCommand({
          Bucket: bucketName,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: false,
            IgnorePublicAcls: false,
            BlockPublicPolicy: false,
            RestrictPublicBuckets: false,
          },
        }),
      )
      await s3.send(
        new PutBucketPolicyCommand({
          Bucket: bucketName,
          Policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: '*',
                Action: 's3:GetObject',
                Resource: `arn:aws:s3:::${bucketName}/*`,
              },
            ],
          }),
        }),
      )
    }

    if (cfg.cors && cfg.cors.length > 0) {
      // ponytail: GET/PUT/HEAD cover read + presigned-upload. POST is required for the
      // legacy form-upload flow most browsers use when JS SDKs aren't available.
      await s3.send(
        new PutBucketCorsCommand({
          Bucket: bucketName,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: cfg.cors,
                AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3000,
              },
            ],
          },
        }),
      )
    }

    envVars[envKey('BUCKET', name)] = bucketName
  }

  return envVars
}
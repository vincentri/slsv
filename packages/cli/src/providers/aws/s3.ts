import { envKey } from '../../env-key.js'
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3'
import type { AppConfig } from '../../config.js'

export async function ensureBuckets(
  s3: S3Client,
  buckets: AppConfig['buckets'],
  appName: string,
): Promise<Record<string, string>> {
  const envVars: Record<string, string> = {}
  if (!buckets) return envVars

  for (const name of Object.keys(buckets)) {
    const bucketName = `${appName}-${name}`.toLowerCase()
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucketName }))
    } catch (e: any) {
      if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(e.name)) throw e
    }
    envVars[envKey('BUCKET', name)] = bucketName
  }

  return envVars
}

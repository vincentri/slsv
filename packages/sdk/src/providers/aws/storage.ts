import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import type { StorageClient } from '../../types.js'

const s3 = new S3Client({ forcePathStyle: true })

export function makeStorage(bucket: string): StorageClient {
  return {
    async put(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      )
    },

    async get(key) {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        return r.Body ? await r.Body.transformToByteArray() : undefined
      } catch (e: any) {
        if (e.name === 'NoSuchKey') return undefined
        throw e
      }
    },

    async getText(key) {
      const bytes = await this.get(key)
      return bytes ? new TextDecoder().decode(bytes) : undefined
    },

    async list(prefix) {
      const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }))
      return (r.Contents ?? []).map((o) => o.Key!).filter(Boolean)
    },

    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
}

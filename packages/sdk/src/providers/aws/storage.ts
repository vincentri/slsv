import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageClient } from "../../types.js";

const s3 = new S3Client({ forcePathStyle: true });

const DEFAULT_EXPIRES = 900;

function buildSignedUrl(cmd: any, opts?: { expiresIn?: number }) {
  // ponytail: presigner and client-s3 ship different Client<> generics when
  // their @smithy/types versions drift; the runtime shape is identical, so cast.
  return getSignedUrl(s3 as any, cmd, { expiresIn: opts?.expiresIn ?? DEFAULT_EXPIRES });
}

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
      );
    },

    async get(key) {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return r.Body ? await r.Body.transformToByteArray() : undefined;
      } catch (e: any) {
        if (e.name === "NoSuchKey") return undefined;
        throw e;
      }
    },

    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const r = await s3.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const o of r.Contents ?? []) if (o.Key) keys.push(o.Key);
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },

    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async getSignedUrl(key, opts) {
      return buildSignedUrl(new GetObjectCommand({ Bucket: bucket, Key: key }), opts);
    },

    async putSignedUrl(key, opts) {
      return buildSignedUrl(
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: opts?.contentType }),
        opts,
      );
    },
  };
}

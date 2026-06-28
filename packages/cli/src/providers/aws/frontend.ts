import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketWebsiteCommand,
  PutBucketPolicyCommand,
  PutPublicAccessBlockCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import {
  CloudFrontClient,
  CreateDistributionCommand,
  ListDistributionsCommand,
  CreateInvalidationCommand,
} from '@aws-sdk/client-cloudfront'
import { readdirSync, readFileSync } from 'fs'
import { execSync, spawn } from 'child_process'
import path from 'path'
import type { FrontendDef } from '../../config.js'

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
}

function walkDir(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join((e as any).parentPath ?? (e as any).path, e.name))
}

function runBuild(frontend: FrontendDef, cwd: string) {
  if (!frontend.build) return
  console.log(`  Building: ${frontend.build}`)
  execSync(frontend.build, { cwd, stdio: 'inherit' })
}

export async function deployFrontendLocal(frontend: FrontendDef, cwd: string): Promise<string> {
  runBuild(frontend, cwd)
  const src = path.resolve(cwd, frontend.src)
  // ponytail: detached npx serve, dies when parent exits
  const child = spawn('npx', ['--yes', 'serve', '-s', src, '-l', '3000'], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return 'http://localhost:3000'
}

export async function deployFrontendAws(
  s3: S3Client,
  frontend: FrontendDef,
  appName: string,
  cwd: string,
  region: string,
): Promise<string> {
  const bucket = `${appName}-frontend`
  const src = path.resolve(cwd, frontend.src)
  runBuild(frontend, cwd)

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }))
  }

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
  )

  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: 's3:GetObject',
            Resource: `arn:aws:s3:::${bucket}/*`,
          },
        ],
      }),
    }),
  )

  await s3.send(
    new PutBucketWebsiteCommand({
      Bucket: bucket,
      WebsiteConfiguration: {
        IndexDocument: { Suffix: 'index.html' },
        ErrorDocument: { Key: 'index.html' },
      },
    }),
  )

  const files = walkDir(src)
  console.log(`  Uploading ${files.length} files → s3://${bucket}`)
  await Promise.all(
    files.map((file) => {
      const key = path.relative(src, file).replace(/\\/g, '/')
      const ext = path.extname(file).toLowerCase()
      return s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: readFileSync(file),
          ContentType: MIME[ext] ?? 'application/octet-stream',
        }),
      )
    }),
  )

  const s3Url = `http://${bucket}.s3-website-${region}.amazonaws.com`
  if (!frontend.cloudfront) return s3Url

  // CloudFront always hits real AWS — not MiniStack
  const cf = new CloudFrontClient({ region: 'us-east-1' })
  const origin = `${bucket}.s3-website-${region}.amazonaws.com`

  const list = await cf.send(new ListDistributionsCommand({}))
  const existing = list.DistributionList?.Items?.find((d) =>
    d.Origins?.Items?.some((o) => o.DomainName === origin),
  )

  if (existing) {
    await cf.send(
      new CreateInvalidationCommand({
        DistributionId: existing.Id,
        InvalidationBatch: {
          CallerReference: Date.now().toString(),
          Paths: { Quantity: 1, Items: ['/*'] },
        },
      }),
    )
    return `https://${existing.DomainName}`
  }

  const dist = await cf.send(
    new CreateDistributionCommand({
      DistributionConfig: {
        CallerReference: `${appName}-${Date.now()}`,
        Comment: `slsv ${appName}`,
        Enabled: true,
        DefaultRootObject: 'index.html',
        Origins: {
          Quantity: 1,
          Items: [
            {
              Id: 'S3Origin',
              DomainName: origin,
              CustomOriginConfig: {
                HTTPPort: 80,
                HTTPSPort: 443,
                OriginProtocolPolicy: 'http-only',
              },
            },
          ],
        },
        DefaultCacheBehavior: {
          TargetOriginId: 'S3Origin',
          ViewerProtocolPolicy: 'redirect-to-https',
          ForwardedValues: { QueryString: false, Cookies: { Forward: 'none' } },
          MinTTL: 0,
        },
        CustomErrorResponses: {
          Quantity: 1,
          Items: [
            {
              ErrorCode: 404,
              ResponseCode: '200',
              ResponsePagePath: '/index.html',
              ErrorCachingMinTTL: 0,
            },
          ],
        },
      },
    }),
  )
  console.log('  CloudFront provisioning (~15 min)…')
  return `https://${dist.Distribution?.DomainName ?? ''}`
}

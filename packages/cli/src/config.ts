import { readFileSync, existsSync } from "fs";
import { parse } from "yaml";
import { z, ZodError } from "zod";
import path from "path";

const HttpRoute = z.object({
  method: z.string(),
  path: z.string(),
  // When `api.auth` is set, every route is protected by default. Set `auth: false` to leave
  // this one route public (e.g. a health check or a login endpoint).
  auth: z.boolean().optional(),
});

const FunctionConfig = z.object({
  runtime: z.enum(["nodejs22", "nodejs24"]),
  handler: z.string(),
  http: z.array(HttpRoute).optional(),
  queue: z.object({ name: z.string() }).optional(),
  cron: z.object({ schedule: z.string() }).optional(),
  event: z.object({ pattern: z.record(z.string(), z.any()) }).optional(), // EventBridge event-pattern trigger
  timeout: z.number().int().min(1).max(900).optional(), // seconds (Lambda hard limit 900)
  memory: z.number().int().min(128).max(10240).optional(), // MB, 1MB steps
  environment: z.record(z.string(), z.string()).optional(), // custom env vars (bindings still win)
  architecture: z.enum(["x86_64", "arm64"]).optional(), // default arm64 (cheaper + faster)
  ephemeralStorage: z.number().int().min(512).max(10240).optional(), // /tmp size MB (default 512)
  tracing: z.boolean().optional(), // X-Ray active tracing
  reservedConcurrency: z.number().int().min(0).optional(), // cap concurrent executions
  provisionedConcurrency: z.number().int().min(1).optional(), // pre-warmed instances (aws only, via `live` alias)
}).strict(); // reject unknown keys — else a misplaced field (e.g. top-level `api.domain` put here) is silently dropped

const QueueConfig = z.object({
  type: z.enum(["sqs"]),
  fifo: z.boolean().optional(),
  visibilityTimeout: z.number().int().positive().max(43200).optional(),
  // `true` → auto-provision `<name>Failed` (matching fifo); a string names a custom DLQ,
  // auto-provisioned if not declared as its own queue. Either way slsv creates the queue.
  dlq: z.union([z.boolean(), z.string()]).optional(),
  maxReceiveCount: z.number().int().min(1).max(1000).optional(), // deliveries before DLQ (default 5)
});

const KeyAttr = z.object({
  name: z.string(),
  type: z.enum(["S", "N", "B"]),
});

const DynamoDbConfig = z.object({
  type: z.literal("dynamodb"),
  partitionKey: KeyAttr,
  sortKey: KeyAttr.optional(),
  gsi: z
    .array(
      z.object({
        name: z.string(),
        partitionKey: KeyAttr,
        sortKey: KeyAttr.optional(),
      }),
    )
    .optional(),
});

const SqlConfig = z.object({
  type: z.enum(["postgres", "mysql"]),
  name: z.string().optional(), // actual DB name for local container; defaults to logical key
  init_sql: z.string().optional(), // path to SQL file run once on local container init
  instanceClass: z.string().optional(), // RDS instance class, default 'db.t3.micro'
  storage: z.number().int().min(20).max(65536).optional(), // GB, default 20
  multiAz: z.boolean().optional(), // default false
  skipFinalSnapshot: z.boolean().optional(), // on destroy: skip final snapshot (default true)
});

const DatabaseConfig = z.discriminatedUnion("type", [DynamoDbConfig, SqlConfig]);

const CacheConfig = z.object({
  type: z.enum(["redis", "valkey"]),
  nodeType: z.string().optional(), // ElastiCache node type, default 'cache.t3.micro'
  nodes: z.number().int().min(1).max(5).optional(), // NumCacheNodes, default 1
  serverless: z.boolean().optional(), // --target aws only: CreateServerlessCache (auto-scale, TLS-only) instead of node group; ignored locally
});

const FrontendConfig = z.object({
  src: z.string(),
  build: z.string().optional(),
  // Serve the frontend + /api/* through one HTTPS CloudFront domain instead of the
  // HTTP-only S3 website endpoint. aws-only; ~15-20 min to deploy/destroy. Default false.
  cloudfront: z.boolean().optional(),
});

const BucketConfig = z
  .object({
    // Browser/users fetch objects directly via the bucket URL without a Lambda hop.
    // Applies a bucket policy granting s3:GetObject to Principal '*' and disables
    // the four public-access blocks. Skip for private data.
    publicRead: z.boolean().optional(),
    // Origins allowed to call this bucket from a browser (presigned PUT/GET, direct fetch).
    // Empty/omitted = no CORS rules. '*' is allowed but only pair it with publicRead,
    // never with private buckets.
    cors: z.array(z.string()).optional(),
  })
  .strict();

const ApiConfig = z.object({
  // Origins allowed to call the HTTP API from a browser (CORS AllowOrigins). Omit → '*' (open,
  // today's default — needed for the S3-hosted frontend on a different origin). Set to your
  // site(s) to lock it down, e.g. ['https://myapp.com']. Methods/headers stay '*'.
  cors: z.array(z.string()).optional(),
  // Custom domain for the HTTP API (aws-only; ignored on --target local). slsv provisions it
  // end-to-end: ACM cert (DNS-validated) + regional custom domain + API mapping + the public
  // CNAME — no manual DNS. slsv writes the DNS via Cloudflare (token from env
  // CLOUDFLARE_API_TOKEN) and finds the owning zone from the domain itself. Cert lives in the
  // API's deploy region (regional endpoint). Set `certArn` to reuse a cert you already have in
  // ACM (e.g. a wildcard) instead of slsv minting one.
  domain: z.string().optional(),
  certArn: z.string().optional(),
  // Lambda REQUEST authorizer. When set, EVERY http route is protected (opt a route out with
  // `auth: false`). `function` names a function (declared in `functions:`, no trigger of its
  // own) that API Gateway invokes before the route handler; it returns `{ isAuthorized: bool,
  // context? }` — deny → 403, the route fn is never invoked. The lookup (DB/secret/JWT/…) is
  // entirely the handler's; slsv only wires the authorizer + invoke permission. `identitySource`
  // is what API GW reads + caches on (default the Authorization header); `ttl` caches the
  // allow/deny that many seconds (0 = check every request).
  auth: z
    .object({
      function: z.string(),
      identitySource: z.array(z.string()).optional(),
      ttl: z.number().int().min(0).max(3600).optional(),
    })
    .optional(),
}).strict();

const AppConfig = z
  .object({
  app: z.string(),
  functions: z.record(z.string(), FunctionConfig).optional(),
  api: ApiConfig.optional(),
  queues: z.record(z.string(), QueueConfig).optional(),
  buckets: z.record(z.string(), BucketConfig).optional(),
  databases: z.record(z.string(), DatabaseConfig).optional(),
  caches: z.record(z.string(), CacheConfig).optional(),
  secrets: z.array(z.string()).optional(),
  frontend: FrontendConfig.optional(),
  tags: z.record(z.string(), z.string()).optional(), // custom tags merged onto every resource
  // On deploy, reconcile prunes resources dropped from the yml. Default FALSE (safe): data
  // stores (DynamoDB/S3/RDS) orphaned by a yml edit are REPORTED and left until `slsv destroy`.
  // Set true to DELETE them (with their data) on deploy — destructive, opt-in. (Lambda/
  // EventBridge/frontend are always pruned regardless; they're stateless.)
  autoRemove: z.boolean().optional(),
  // CloudWatch log retention in days (default 14). 0 = never expire. Must be a value
  // CloudWatch accepts, else the log group would reject the retention policy.
  logRetentionDays: z
    .union(
      [
        0, 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557,
        2922, 3288, 3653,
      ].map((n) => z.literal(n)) as [
        z.ZodLiteral<number>,
        z.ZodLiteral<number>,
        ...z.ZodLiteral<number>[],
      ],
    )
    .optional(),
  })
  .strict(); // top-level: catch misspelled blocks (`function:` vs `functions:`). `stages` is stripped before parse.

export type AppConfig = z.infer<typeof AppConfig>;
export type DynamoDbDef = z.infer<typeof DynamoDbConfig>;
export type FrontendDef = z.infer<typeof FrontendConfig>;

// Resolve a queue's DLQ logical name. `true` → `${queue}Failed`; a string is returned as-is;
// absent → undefined. Callers (sqs.ts create, lint.ts unused-check) share this so the derived
// name stays consistent.
export function dlqName(queue: string, dlq: boolean | string | undefined): string | undefined {
  if (dlq === true) return `${queue}Failed`;
  return typeof dlq === "string" ? dlq : undefined;
}

// Deep-merge an overlay onto a base: objects merge recursively, arrays/scalars replace,
// and an explicit `null` in the overlay removes the key (needed to swap e.g. a queue
// trigger for an event trigger between stages).
function deepMerge(base: any, over: any): any {
  if (over === null || typeof over !== "object" || Array.isArray(over)) return over;
  if (base === null || typeof base !== "object" || Array.isArray(base)) return { ...over };
  const out: any = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete out[k];
    else out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function loadConfig(cwd: string = process.cwd(), stage = "dev"): AppConfig {
  const cfgPath = path.join(cwd, "slsv.yml");
  if (!existsSync(cfgPath)) {
    throw new ConfigError(`No slsv.yml found in ${cwd}`);
  }
  const raw = readFileSync(cfgPath, "utf-8");
  let parsed: Record<string, any>;
  try {
    parsed = (parse(raw) ?? {}) as Record<string, any>;
  } catch (e: any) {
    // yaml lib embeds line/column in the message already.
    throw new ConfigError(`slsv.yml is not valid YAML:\n  ${e.message}`);
  }
  // `stages.<stage>` overlays the base config; the `stages` key itself is dropped before
  // validation (zod strips it anyway, but be explicit) and the merged result is validated.
  const { stages, ...base } = parsed;
  const overlay = stages?.[stage];
  const merged = overlay ? deepMerge(base, overlay) : base;
  // Allow bare `uploads:` (YAML null) to mean `uploads: {}`. Stage overlays still use
  // `uploads: null` to REMOVE a bucket — deepMerge runs first, so the key is already
  // gone by the time we normalize here.
  if (merged.buckets && typeof merged.buckets === "object") {
    for (const [k, v] of Object.entries(merged.buckets)) {
      if (v === null) merged.buckets[k] = {};
    }
  }
  try {
    return AppConfig.parse(merged);
  } catch (e) {
    if (e instanceof ZodError) {
      // ponytail: zod's default messages are generic ("Expected number", "Invalid enum
      // value"). Path prefix tells WHERE; message tells WHAT. For truly bespoke copy
      // ("timeout must be ≤ 900"), override per-rule via zod's `{ message: ... }` arg.
      const lines = e.issues.map((i) => {
        const p = i.path.length ? i.path.join(".") : "(root)";
        return `  ${p}: ${i.message}`;
      });
      throw new ConfigError(`Invalid slsv.yml:\n${lines.join("\n")}`);
    }
    throw e;
  }
}

// Friendly, catchable config-load failure. cli.ts catches this once and prints without
// a stack trace; other thrown errors surface normally (genuine bugs).
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

import { execFileSync } from "node:child_process";
import { envKey } from "../../env-key.js";
import type { AppConfig } from "../../config.js";
import { makeClients, type Clients } from "./clients.js";

export type FunctionOutput = { name: string; arn: string };
import { ensureExecRole, deleteExecRole } from "./iam.js";
import { ensureLogGroup, deleteLogGroup } from "./logs.js";
import { ensureDynamoTables } from "./dynamodb.js";
import { ensureBuckets } from "./s3.js";
import { ensureQueues, type QueueOutput } from "./sqs.js";
import { ensureSecrets } from "./secrets.js";
import { deployFunctions } from "./functions.js";
import { ensureApiGateway, deleteHttpApi } from "./apigw.js";
import { ensureCronTriggers, ensureEventTriggers } from "./eventbridge.js";
import { ensureEventSourceMappings } from "./eventsource.js";
import { tailLogs } from "./logs-tail.js";
import { ensureCacheClusters } from "./redis.js";
import { ensureDbInstances } from "./databases.js";
import { deployFrontendLocal, deployFrontendAws, destroyDistribution } from "./frontend.js";
import {
  UpdateFunctionCodeCommand,
  DeleteFunctionCommand,
  ListFunctionsCommand,
} from "@aws-sdk/client-lambda";
import { DeleteTableCommand, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import {
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteBucketCommand,
  ListBucketsCommand,
} from "@aws-sdk/client-s3";
import { DeleteQueueCommand, ListQueuesCommand } from "@aws-sdk/client-sqs";
import { DeleteSecretCommand, ListSecretsCommand } from "@aws-sdk/client-secrets-manager";
import {
  ListRulesCommand,
  ListTargetsByRuleCommand,
  RemoveTargetsCommand,
  DeleteRuleCommand,
} from "@aws-sdk/client-eventbridge";
import {
  DeleteReplicationGroupCommand,
  DeleteServerlessCacheCommand,
  DescribeReplicationGroupsCommand,
  DescribeServerlessCachesCommand,
} from "@aws-sdk/client-elasticache";
import { DeleteDBInstanceCommand, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";

// A Lambda runs INSIDE the Floci container, where `localhost` is the container itself.
// It must reach Floci's AWS APIs via the docker host (same trick as the redis endpoint).
const LAMBDA_LOCAL_ENDPOINT = "http://host.docker.internal:4566";

// ponytail: Docker CLI + floci-<prefix><fn> naming; drop once Floci stops the container
// on DeleteFunction.
function killFlociContainers(prefix: string) {
  const ids = execFileSync("docker", ["ps", "-aq", "--filter", `name=floci-${prefix}`], {
    encoding: "utf8",
  }).trim();
  if (ids) execFileSync("docker", ["rm", "-f", ...ids.split("\n")], { stdio: "ignore" });
}

// Drain a token-paginated AWS list call. Each SDK uses a different token field, so the
// caller adapts request/response tokens; this just loops until there's no next token.
export async function paginate<T>(
  fetchPage: (token?: string) => Promise<{ items: T[]; next?: string }>,
): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;
  do {
    const { items, next } = await fetchPage(token);
    out.push(...items);
    token = next;
  } while (token);
  return out;
}

// Every service names its not-found error differently (ResourceNotFoundException / NoSuchBucket
// / NoSuchEntity / QueueDoesNotExist / ReplicationGroupNotFoundFault / DBInstanceNotFound /
// NonExistentQueue / ...) — match the common shapes instead of a per-call list. Used by destroy
// (already-gone = success) and reconcile's frontend teardown.
const GONE = /(NotFound|NoSuch|DoesNotExist|NonExistent)/i;

export class AwsProvider {
  private target: "local" | "aws";
  private clients: Clients;
  private roleArn?: string;
  private tags: Record<string, string> = {};
  private queueOutputs: Record<string, QueueOutput> = {};

  constructor(target: "local" | "aws" = "local") {
    this.target = target;
    this.clients = makeClients(target);
  }

  async startLocalEmulator(_cwd: string, _cfg: AppConfig) {
    await ensureFlociAvailable();
  }

  // Deletes everything deployed under `<app>-<stage>-` — DISCOVERED by listing each service, NOT
  // read from the yml, so resources the user already dropped from slsv.yml are still torn down.
  // Covers Lambda/Dynamo/S3/SQS/secrets/caches/RDS + derived EventBridge rules, the IAM exec
  // role, CloudFront (by Comment), and (locally) Floci's Lambda containers.
  // ponytail: still left behind — dangling API-GW integrations, SQS event-source-mappings; inert,
  // re-created on next deploy. Add cleanup if Floci clutter ever matters.
  async destroyResources(cfg: AppConfig, stage: string) {
    const appName = `${cfg.app}-${stage}`;
    console.log(`\n→ Destroy ${appName} (target ${this.target})`);

    // Each delete is its own step: logs progress like deploy, treats an already-gone resource
    // as success (idempotent re-run), and — crucially — a REAL failure is recorded and the
    // sweep CONTINUES instead of aborting. (Before: one non-"gone" error, e.g. RDS
    // InvalidDBInstanceState, threw and skipped every later step — CloudFront/IAM/EventBridge/
    // container sweep never ran, leaving billable resources.) Failures are reported at the end
    // and the command exits non-zero so partial teardown is never silently "done".
    const failures: { label: string; err: string }[] = [];
    const step = async (label: string, fn: () => void | Promise<void>) => {
      process.stdout.write(`    ${label} … `);
      try {
        await fn();
        console.log("✓");
      } catch (e: any) {
        if (GONE.test(e?.name ?? "")) {
          console.log("· already gone");
          return;
        }
        console.log(`✗ ${e?.name ?? e}`);
        failures.push({ label, err: String(e?.message ?? e?.name ?? e) });
      }
    };

    // Destroy is DISCOVERY-based, NOT yml-driven: it enumerates everything actually deployed
    // under the `<app>-<stage>-` prefix and deletes it — so a resource the user already removed
    // from slsv.yml (the yml drifted from AWS) is STILL torn down. (Before: destroy iterated
    // `cfg.functions`/`cfg.databases`/… so anything dropped from the yml was invisible to destroy
    // and survived on real AWS — "my lambda and dynamodb not removed".) EventBridge already
    // discovered by prefix; now every service does.
    // ponytail: prefix match, not tag match — a sibling stack whose name extends this prefix
    // (`myapp-dev-` vs stage `dev-2` → `myapp-dev-2-*`) could be swept. Same ceiling reconcile's
    // prune already accepts; switch to the Resource Groups Tagging API (slsv:app+slsv:stage) if
    // stacks ever share a name prefix.
    const pfx = `${appName}-`;
    const lcPfx = pfx.toLowerCase();

    // API Gateway (deletes its routes/integrations/stages too)
    await step("API Gateway", () =>
      deleteHttpApi(this.clients.apigw, appName).then(() => undefined),
    );

    // Lambda (+ each function's log group, else logs linger and bill after teardown)
    const fns = await paginate((Marker) =>
      this.clients.lambda
        .send(new ListFunctionsCommand({ Marker }))
        .then((r) => ({ items: r.Functions ?? [], next: r.NextMarker })),
    );
    for (const fn of fns) {
      const fnName = fn.FunctionName;
      if (!fnName?.startsWith(pfx)) continue;
      await step(`Lambda ${fnName}`, () =>
        this.clients.lambda
          .send(new DeleteFunctionCommand({ FunctionName: fnName }))
          .then(() => undefined),
      );
      await step(`Log group ${fnName}`, () =>
        deleteLogGroup(this.clients.logs, fnName).then(() => undefined),
      );
    }

    // DynamoDB
    const tables = await paginate((ExclusiveStartTableName) =>
      this.clients.dynamo
        .send(new ListTablesCommand({ ExclusiveStartTableName }))
        .then((r) => ({ items: r.TableNames ?? [], next: r.LastEvaluatedTableName })),
    );
    for (const t of tables)
      if (t.startsWith(pfx))
        await step(`DynamoDB ${t}`, () =>
          this.clients.dynamo.send(new DeleteTableCommand({ TableName: t })).then(() => undefined),
        );

    // S3 (empty first, AWS refuses non-empty delete). Prefix discovery catches the frontend
    // hosting bucket too (created by deployFrontend, not declared under `buckets:`).
    const s3 = await this.clients.s3.send(new ListBucketsCommand({}));
    for (const b of s3.Buckets ?? [])
      if (b.Name?.startsWith(lcPfx))
        await step(`S3 ${b.Name}`, () => this.emptyAndDeleteBucket(b.Name!).then(() => undefined));

    // SQS
    const queues = await paginate((NextToken) =>
      this.clients.sqs
        .send(new ListQueuesCommand({ QueueNamePrefix: pfx, NextToken }))
        .then((r) => ({ items: r.QueueUrls ?? [], next: r.NextToken })),
    );
    for (const url of queues)
      await step(`SQS ${url.split("/").pop()}`, () =>
        this.clients.sqs.send(new DeleteQueueCommand({ QueueUrl: url })).then(() => undefined),
      );

    // Secrets (created stage-namespaced `${appName}-${name}`)
    const secrets = await paginate((NextToken) =>
      this.clients.secrets
        .send(new ListSecretsCommand({ NextToken }))
        .then((r) => ({ items: r.SecretList ?? [], next: r.NextToken })),
    );
    for (const s of secrets)
      if (s.Name?.startsWith(pfx))
        await step(`Secret ${s.Name}`, () =>
          this.clients.secrets
            .send(new DeleteSecretCommand({ SecretId: s.Name!, ForceDeleteWithoutRecovery: true }))
            .then(() => undefined),
        );

    // ElastiCache — node groups (DescribeReplicationGroups) and serverless caches
    // (DescribeServerlessCaches) are separate APIs; sweep both by id prefix so we don't need the
    // yml's serverless flag.
    const rgs = await this.clients.elasticache
      .send(new DescribeReplicationGroupsCommand({}))
      .catch(() => null);
    for (const g of rgs?.ReplicationGroups ?? [])
      if (g.ReplicationGroupId?.startsWith(pfx))
        await step(`Cache ${g.ReplicationGroupId}`, () =>
          this.clients.elasticache
            .send(new DeleteReplicationGroupCommand({ ReplicationGroupId: g.ReplicationGroupId! }))
            .then(() => undefined),
        );
    if (this.target === "aws") {
      const scs = await this.clients.elasticache
        .send(new DescribeServerlessCachesCommand({}))
        .catch(() => null);
      for (const c of scs?.ServerlessCaches ?? [])
        if (c.ServerlessCacheName?.startsWith(pfx))
          await step(`Cache ${c.ServerlessCacheName}`, () =>
            this.clients.elasticache
              .send(
                new DeleteServerlessCacheCommand({ ServerlessCacheName: c.ServerlessCacheName! }),
              )
              .then(() => undefined),
          );
    }

    // RDS (postgres/mysql). Discovery has no yml, so always skip the final snapshot (matches the
    // yml default). Set skipFinalSnapshot: false + `slsv destroy` while it's still in the yml if
    // you need a snapshot — a drifted destroy can't know to take one.
    const dbs = await paginate((Marker) =>
      this.clients.rds
        .send(new DescribeDBInstancesCommand({ Marker }))
        .then((r) => ({ items: r.DBInstances ?? [], next: r.Marker })),
    );
    for (const d of dbs) {
      const id = d.DBInstanceIdentifier;
      if (!id?.startsWith(pfx)) continue;
      await step(`RDS ${id}`, () =>
        this.clients.rds
          .send(
            new DeleteDBInstanceCommand({
              DBInstanceIdentifier: id,
              SkipFinalSnapshot: true,
              DeleteAutomatedBackups: true,
            }),
          )
          .then(() => undefined),
      );
    }

    // CloudFront — discovery-based like the rest: destroyDistribution finds it by Comment
    // (`slsv:<appName>`), so a distribution deployed then dropped from the yml is still torn down.
    // Idempotent fast no-op when none exists. Disable → wait → delete: a distribution can't be
    // deleted while enabled, and both transitions take ~10-20 min each (aws only).
    if (this.target === "aws") {
      const result = await destroyDistribution(this.clients.cloudfront, appName);
      console.log(`    CloudFront … ${result === "deleted" ? "✓" : "· none to delete"}`);
    }

    // IAM exec role (per app+stage)
    await step("IAM exec role", () =>
      deleteExecRole(this.clients.iam, appName).then(() => undefined),
    );

    // EventBridge cron/event rules (<app>-<stage>-<fn>[-evt]). MUST delete on destroy: reconcile
    // only prunes rules for REMOVED functions, so a plain destroy left every rule live. On Floci
    // a live cron rule keeps firing and RESPAWNS the Lambda container even after DeleteFunction —
    // so removing containers below isn't enough without this. (Clutter on real AWS too.) AWS
    // refuses DeleteRule while targets exist, so clear targets first.
    const rules = await paginate((NextToken) =>
      this.clients.events
        .send(new ListRulesCommand({ NamePrefix: appName, NextToken }))
        .then((r) => ({ items: r.Rules ?? [], next: r.NextToken })),
    );
    for (const rule of rules) {
      const name = rule.Name;
      if (!name) continue;
      await step(`EventBridge rule ${name}`, async () => {
        const tgts = await this.clients.events
          .send(new ListTargetsByRuleCommand({ Rule: name }))
          .catch(() => null);
        const ids = (tgts?.Targets ?? []).map((t) => t.Id).filter((id): id is string => !!id);
        if (ids.length)
          await this.clients.events.send(new RemoveTargetsCommand({ Rule: name, Ids: ids }));
        await this.clients.events.send(new DeleteRuleCommand({ Name: name }));
      });
    }

    // Floci leaves Lambda execution containers running after DeleteFunction — its container
    // lifecycle isn't tied to its API (same registry-vs-container desync as RDS/valkey). Sweep
    // them by name so `slsv destroy --target local` actually stops them. `name=floci-<app>-
    // <stage>-` matches only this stack's lambda containers (rds/valkey use floci-rds-/
    // floci-valkey- prefixes).
    if (this.target === "local") {
      await step("Floci containers", () => {
        killFlociContainers(`${appName}-`);
      });
    }

    if (failures.length) {
      console.error(`\n✗ Destroy incomplete — ${failures.length} resource(s) failed:`);
      for (const f of failures) console.error(`    ${f.label}: ${f.err}`);
      throw new Error(
        `destroy left ${failures.length} resource(s) — re-run \`slsv destroy\` or delete manually`,
      );
    }
    console.log("\n✓ Destroy complete — all resources deleted");
  }

  // Empty + delete an S3 bucket (AWS refuses a non-empty delete). Idempotent: an already-gone
  // bucket is treated as success. Shared by destroy and reconcile's frontend teardown.
  // ponytail: ListObjectsV2 returns one page (≤1000 keys) — fine for the frontend build + small
  // buckets; page the listing if a bucket ever holds more.
  private async emptyAndDeleteBucket(bucket: string) {
    try {
      const listed = await this.clients.s3.send(new ListObjectsV2Command({ Bucket: bucket }));
      if (listed.Contents?.length)
        await this.clients.s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: listed.Contents.map((o) => ({ Key: o.Key! })) },
          }),
        );
      await this.clients.s3.send(new DeleteBucketCommand({ Bucket: bucket }));
      return true;
    } catch (e: any) {
      if (GONE.test(e?.name ?? "")) return false;
      throw e;
    }
  }

  /**
   * Prune resources that were deployed under this app+stage but are no longer in the
   * manifest (e.g. a renamed/removed function). Keeps `slsv.yml` the source of truth.
   *
   * Safety split: Lambda functions are auto-deleted (stateless, exact-named, the common
   * case). Data stores (DynamoDB / S3 / RDS) are NEVER auto-deleted — orphans are only
   * reported, so a table/bucket/db dropped from the yml can't silently take its data with
   * it. Use `slsv destroy` (or delete manually) to remove those on purpose.
   */
  async reconcile(cfg: AppConfig, stage: string) {
    const prefix = `${cfg.app}-${stage}-`;
    const owned = (n?: string): n is string => !!n && n.startsWith(prefix);
    const logical = (n: string) => n.slice(prefix.length);

    // --- Lambda: auto-prune orphans ---
    const wantFns = new Set(Object.keys(cfg.functions ?? {}));
    const allFns = await paginate((Marker) =>
      this.clients.lambda
        .send(new ListFunctionsCommand({ Marker }))
        .then((r) => ({ items: r.Functions ?? [], next: r.NextMarker })),
    );
    for (const fn of allFns) {
      if (owned(fn.FunctionName) && !wantFns.has(logical(fn.FunctionName))) {
        try {
          await this.clients.lambda.send(
            new DeleteFunctionCommand({ FunctionName: fn.FunctionName }),
          );
          console.log(`  pruned function ${fn.FunctionName}`);
        } catch (e: any) {
          // Only an already-gone function is a no-op success. A REAL failure (IAM denial, AWS
          // throttle, function stuck) was previously swallowed AND still printed "pruned" — so
          // the fn survived while the log claimed removal ("lambda not removed"). Surface it
          // instead; keep going so one stuck fn doesn't block the rest of reconcile.
          if (!GONE.test(e?.name ?? "")) {
            console.warn(`  ⚠ could not prune function ${fn.FunctionName}: ${e?.name ?? e}`);
            continue;
          }
        }
        // Delete the pruned function's log group too, else logs linger and bill after removal
        // (destroy already does this; reconcile didn't).
        await deleteLogGroup(this.clients.logs, fn.FunctionName);
        // --target local: Floci leaves the Lambda CONTAINER running after DeleteFunction (its
        // container lifecycle isn't tied to its API — same desync destroy sweeps). Without this
        // the API "removed" the fn but the container keeps executing (a pruned cron/queue fn
        // still fires) → "lambda not removed". Sweep its container by name.
        if (this.target === "local") {
          try {
            killFlociContainers(fn.FunctionName);
          } catch {
            // docker missing / nothing to remove — best-effort, never fail reconcile
          }
        }
      }
    }

    // --- EventBridge rules: auto-prune orphans ---
    // Rule names written by eventbridge.ts: `<prefix>-<fn>` (cron) and `<prefix>-<fn>-evt`
    // (event). A dropped cron/event trigger — or a removed function — leaves its rule live
    // and still firing (cron) or matched (event), invoking nothing / erroring. Unlike a
    // dangling API-GW integration (inert), an active rule is wrong behavior, so prune it.
    const EVT_SUFFIX = "-evt";
    const wantCron = new Set(
      Object.entries(cfg.functions ?? {})
        .filter(([, f]) => f.cron)
        .map(([k]) => k),
    );
    const wantEvent = new Set(
      Object.entries(cfg.functions ?? {})
        .filter(([, f]) => f.event)
        .map(([k]) => k),
    );
    const allRules = await paginate((NextToken) =>
      this.clients.events
        .send(new ListRulesCommand({ NextToken }))
        .then((r) => ({ items: r.Rules ?? [], next: r.NextToken })),
    );
    for (const r of allRules) {
      const name = r.Name ?? "";
      if (!owned(name)) continue;
      const isEvt = name.endsWith(EVT_SUFFIX);
      const fnLogical = isEvt ? logical(name.slice(0, -EVT_SUFFIX.length)) : logical(name);
      if ((isEvt ? wantEvent : wantCron).has(fnLogical)) continue;
      // AWS refuses DeleteRule while targets exist; remove them first.
      const tgts = await this.clients.events.send(new ListTargetsByRuleCommand({ Rule: name }));
      const ids = (tgts.Targets ?? []).map((t) => t.Id!);
      if (ids.length) {
        await this.clients.events
          .send(new RemoveTargetsCommand({ Rule: name, Ids: ids }))
          .catch(() => {}); // racing prune — fine, delete below still attempted
      }
      await this.clients.events.send(new DeleteRuleCommand({ Name: name })).catch(() => {}); // gone already / racing another prune — fine
      console.log(`  pruned event rule ${name}`);
    }

    // --- Data stores (DynamoDB / S3 buckets / RDS) ---
    // Default `autoRemove: true` — an orphan (dropped from the yml) is DELETED here so the
    // manifest is the full source of truth. Set `autoRemove: false` to keep the old safe
    // behavior: orphans are reported and left until `slsv destroy`. This is destructive by
    // design — a store removed from slsv.yml takes its data with it on the next deploy.
    const autoRemove = cfg.autoRemove ?? true;
    const dbEntries = Object.entries(cfg.databases ?? {});
    const wantTables = new Set(dbEntries.filter(([, d]) => d.type === "dynamodb").map(([k]) => k));
    const wantDbs = new Set(
      dbEntries.filter(([, d]) => d.type === "postgres" || d.type === "mysql").map(([k]) => k),
    );
    const wantBuckets = new Set(Object.keys(cfg.buckets ?? {}));
    const orphans: string[] = [];
    // autoRemove ? delete now (swallow already-gone) : collect for the end-of-run warning.
    const handleOrphan = async (label: string, del: () => Promise<void>) => {
      if (!autoRemove) {
        orphans.push(label);
        return;
      }
      try {
        await del();
        console.log(`→ Reconcile: removed ${label}`);
      } catch (e: any) {
        if (!GONE.test(e?.name ?? "")) throw e;
      }
    };

    const allTables = await paginate((ExclusiveStartTableName) =>
      this.clients.dynamo
        .send(new ListTablesCommand({ ExclusiveStartTableName }))
        .then((r) => ({ items: r.TableNames ?? [], next: r.LastEvaluatedTableName })),
    );
    for (const t of allTables)
      if (owned(t) && !wantTables.has(logical(t)))
        await handleOrphan(`table ${t}`, () =>
          this.clients.dynamo.send(new DeleteTableCommand({ TableName: t })).then(() => undefined),
        );

    // S3 bucket names are lowercased at create — compare against a lowercased prefix.
    const lcPrefix = prefix.toLowerCase();
    // The frontend hosting bucket (<prefix>frontend) + CloudFront are slsv-managed BUILD
    // ARTIFACTS (created by deployFrontend, not declared under buckets:) — not user data, they
    // hold only the last build output and are re-created every deploy. So unlike data stores
    // (report-only), dropping `frontend:` from the yml TEARS THEM DOWN here, like a stateless
    // Lambda/EventBridge orphan. While a frontend IS configured they're excluded from the
    // orphan scan below (slsv owns them).
    const frontendBucket = `${lcPrefix}frontend`;
    if (!cfg.frontend) {
      if (await this.emptyAndDeleteBucket(frontendBucket))
        console.log(`→ Reconcile: pruned frontend bucket ${frontendBucket}`);
      // ponytail: destroyDistribution disables→waits→deletes (~15-20 min), but only on the one
      // redeploy that drops frontend; idempotent by Comment (fast no-op when none exists).
      await destroyDistribution(this.clients.cloudfront, `${cfg.app}-${stage}`).catch((e) => {
        if (!GONE.test(e?.name ?? "")) throw e;
      });
    }
    const buckets = await this.clients.s3.send(new ListBucketsCommand({}));
    for (const b of buckets.Buckets ?? [])
      if (
        b.Name?.startsWith(lcPrefix) &&
        b.Name !== frontendBucket &&
        !wantBuckets.has(b.Name.slice(lcPrefix.length))
      )
        await handleOrphan(`bucket ${b.Name}`, () =>
          this.emptyAndDeleteBucket(b.Name!).then(() => undefined),
        );

    const allDbs = await paginate((Marker) =>
      this.clients.rds
        .send(new DescribeDBInstancesCommand({ Marker }))
        .then((r) => ({ items: r.DBInstances ?? [], next: r.Marker })),
    );
    for (const d of allDbs)
      if (owned(d.DBInstanceIdentifier) && !wantDbs.has(logical(d.DBInstanceIdentifier)))
        await handleOrphan(`database ${d.DBInstanceIdentifier}`, () =>
          this.clients.rds
            // Orphan is gone from the yml, so its skipFinalSnapshot is gone too — default skip
            // (matches destroy's default; no snapshot).
            .send(
              new DeleteDBInstanceCommand({
                DBInstanceIdentifier: d.DBInstanceIdentifier,
                SkipFinalSnapshot: true,
                DeleteAutomatedBackups: true,
              }),
            )
            .then(() => undefined),
        );

    // autoRemove=false: orphans were collected, not deleted — warn and leave them for `slsv destroy`.
    if (orphans.length) {
      console.warn(
        `\n⚠ ${orphans.length} data resource(s) no longer in slsv.yml but still deployed:`,
      );
      for (const o of orphans) console.warn(`    ${o}`);
      console.warn(
        `  Kept (autoRemove: false). Remove with \`slsv destroy\`, or set autoRemove: true (default) to prune on deploy.\n`,
      );
    }
  }

  async setup(
    appName: string,
    functionNames: string[],
    tags: Record<string, string>,
    logRetentionDays: number,
  ) {
    this.tags = tags;
    if (functionNames.length) console.log("→ IAM exec role");
    this.roleArn = await ensureExecRole(this.clients.iam, appName, tags);

    if (functionNames.length) console.log("→ CloudWatch log groups");
    await Promise.all(
      functionNames.map((name) =>
        ensureLogGroup(this.clients.logs, `${appName}-${name}`, logRetentionDays),
      ),
    );
  }

  async ensureBuckets(buckets: AppConfig["buckets"], appName: string) {
    return ensureBuckets(this.clients.s3, buckets, appName, this.tags);
  }

  async ensureQueues(
    queues: AppConfig["queues"],
    appName: string,
  ): Promise<Record<string, string>> {
    this.queueOutputs = await ensureQueues(this.clients.sqs, queues, appName, this.tags);
    const envVars: Record<string, string> = {};
    for (const [name, q] of Object.entries(this.queueOutputs)) {
      envVars[envKey("QUEUE", name)] = q.url;
    }
    return envVars;
  }

  async ensureSecrets(secrets: string[], env: Record<string, string | undefined>, prefix: string) {
    return ensureSecrets(this.clients.secrets, secrets, env, prefix, this.tags);
  }

  async ensureCaches(
    caches: AppConfig["caches"],
    appName: string,
  ): Promise<Record<string, string>> {
    // Each caches.<name> → ElastiCache Redis/Valkey group (Floci locally, real AWS for --target aws).
    // Reachability differs by target — redis.ts handles both (aws uses the API endpoint; local
    // reads the valkey container's floci-network IP, since Floci's API returns an unreachable
    // localhost). Pass `local` so it picks the branch.
    return ensureCacheClusters(
      this.clients.elasticache,
      caches,
      appName,
      this.tags,
      this.target === "local",
    );
  }

  async ensureDatabases(
    databases: AppConfig["databases"],
    appName: string,
    cwd: string,
  ): Promise<Record<string, string>> {
    // DynamoDB entries: provision tables, inject DATABASE_<NAME>=table-name
    const dynamoEntries = Object.fromEntries(
      Object.entries(databases ?? {}).filter(([, v]) => v.type === "dynamodb"),
    ) as Record<string, import("../../config.js").DynamoDbDef>;
    const dynamoEnvs = await ensureDynamoTables(
      this.clients.dynamo,
      dynamoEntries,
      appName,
      this.tags,
    );

    // Postgres/MySQL: provisioned via the RDS API (Floci locally, real AWS for --target aws).
    // init_sql runs once on first creation. Target-agnostic — the client endpoint decides where.
    const rdsEnvs = await ensureDbInstances(
      this.clients.rds,
      databases,
      appName,
      cwd,
      this.tags,
      this.target === "local",
    );

    return { ...dynamoEnvs, ...rdsEnvs };
  }

  async deployFunctions(
    functions: AppConfig["functions"],
    appName: string,
    envVars: Record<string, string>,
    cwd: string,
  ): Promise<Record<string, FunctionOutput>> {
    // Injected URLs (e.g. a QUEUE_<NAME> QueueUrl) come back from Floci with a `localhost`
    // host — unreachable from inside the Lambda container. Rewrite to the docker host, same
    // as AWS_ENDPOINT_URL. SQS uses the QueueUrl's host directly, ignoring AWS_ENDPOINT_URL.
    const localizedEnv =
      this.target === "local"
        ? Object.fromEntries(
            Object.entries(envVars).map(([k, v]) => [
              k,
              v.replaceAll("localhost:4566", "host.docker.internal:4566"),
            ]),
          )
        : envVars;

    const outputs = await deployFunctions(
      this.clients.lambda,
      functions,
      appName,
      this.roleArn!,
      localizedEnv,
      cwd,
      { localEndpoint: this.target === "local" ? LAMBDA_LOCAL_ENDPOINT : undefined },
      this.tags,
    );
    return outputs;
  }

  async updateFunctionCode(fnName: string, zip: Uint8Array) {
    await this.clients.lambda.send(
      new UpdateFunctionCodeCommand({
        FunctionName: fnName,
        ZipFile: zip,
      }),
    );
  }

  async wireHttp(
    functions: AppConfig["functions"],
    fnOutputs: Record<string, FunctionOutput>,
    appName: string,
    corsOrigins?: string[],
  ): Promise<string | undefined> {
    if (!functions || !Object.values(functions).some((f) => f.http?.length)) return undefined;
    console.log("→ API Gateway");
    return ensureApiGateway(
      this.clients.apigw,
      this.clients.lambda,
      functions,
      fnOutputs,
      appName,
      this.target === "local",
      corsOrigins,
    );
  }

  async wireQueues(functions: AppConfig["functions"], fnOutputs: Record<string, FunctionOutput>) {
    if (!functions || !Object.values(functions).some((f) => f.queue)) return;
    console.log("→ SQS event source mappings");
    await ensureEventSourceMappings(this.clients.lambda, functions, fnOutputs, this.queueOutputs);
  }

  async wireCron(
    functions: AppConfig["functions"],
    fnOutputs: Record<string, FunctionOutput>,
    appName: string,
  ) {
    if (!functions || !Object.values(functions).some((f) => f.cron || f.event)) return;
    console.log("→ EventBridge rules");
    await ensureCronTriggers(
      this.clients.events,
      this.clients.lambda,
      functions,
      fnOutputs,
      appName,
      this.tags,
    );
    await ensureEventTriggers(
      this.clients.events,
      this.clients.lambda,
      functions,
      fnOutputs,
      appName,
      this.tags,
    );
  }

  async deployFrontend(
    frontend: AppConfig["frontend"],
    appName: string,
    cwd: string,
    apiUrl?: string,
  ): Promise<string | undefined> {
    if (!frontend) return undefined;
    console.log("\nFrontend:");
    if (this.target === "local") return deployFrontendLocal(frontend, cwd, apiUrl);
    // Resolve region from the S3 client's own config (full AWS chain: AWS_REGION,
    // AWS_DEFAULT_REGION, profile, ...) so the website URL matches where the bucket was
    // actually created. `process.env.AWS_REGION ?? 'us-east-1'` mismatched when the region
    // came from a profile / AWS_DEFAULT_REGION.
    const regionCfg = this.clients.s3.config.region;
    const region = typeof regionCfg === "function" ? await regionCfg() : regionCfg;
    return deployFrontendAws(
      this.clients.s3,
      this.clients.cloudfront,
      frontend,
      appName,
      cwd,
      region,
      this.tags,
      apiUrl,
    );
  }

  async tailLogs(fnName: string, follow: boolean) {
    await tailLogs(this.clients.logs, fnName, follow);
  }
}

async function ensureFlociAvailable() {
  try {
    const res = await fetch("http://localhost:4566/");
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    throw new Error(
      "Floci is not reachable at http://localhost:4566. Start Floci before running slsv.",
    );
  }
}

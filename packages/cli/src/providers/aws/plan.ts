import { ListFunctionsCommand } from "@aws-sdk/client-lambda";
import {
  ListTablesCommand,
  DescribeTableCommand,
  type KeySchemaElement,
} from "@aws-sdk/client-dynamodb";
import { ListBucketsCommand } from "@aws-sdk/client-s3";
import { ListQueuesCommand } from "@aws-sdk/client-sqs";
import { ListSecretsCommand } from "@aws-sdk/client-secrets-manager";
import { DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { DescribeReplicationGroupsCommand } from "@aws-sdk/client-elasticache";
import type { AppConfig } from "../../config.js";
import { dlqName } from "../../config.js";
import type { Clients } from "./clients.js";
import { paginate } from "./index.js";

// `slsv plan`: two-way diff (yml desired vs AWS actual — slsv keeps no state file). Read-only;
// classifies each resource as create / update (a mutable field differs) / replace (an IMMUTABLE
// field differs — deploy can't fix it in place) / delete (owned by this app+stage, gone from
// yml). v1 field-diffs only what's cheap to read from the List*/Describe* responses; the rest is
// presence-only. ponytail: extend the field diffs alongside the deploy-side converge (SQS/S3/
// cache Update* coverage) — plan already reports what it can read.

// "orphan" = exists under this app+stage but absent from the yml AND deploy won't touch it
// (SQS/secrets/caches — reconcile only auto-prunes Lambda + data stores). Reported so the user
// can `slsv destroy` it; never deleted by a deploy.
export type ChangeAction = "create" | "update" | "replace" | "delete" | "orphan";

export interface Change {
  action: ChangeAction;
  kind: string; // function | table | database | bucket | queue | secret | cache
  name: string; // logical name
  detail?: string; // e.g. "memory 256→512" or "architecture arm64→x86_64"
  destructive?: boolean; // delete of a data store (carries data away)
}

export interface PlanResult {
  changes: Change[];
}

// Live AWS state, normalized so classify() is a pure function testable without SDK mocks.
export interface LiveState {
  functions: { name: string; memory?: number; timeout?: number; ephemeral?: number; arch?: string }[];
  tables: { name: string; partitionKey?: string; sortKey?: string }[];
  databases: {
    name: string;
    instanceClass?: string;
    storage?: number;
    multiAz?: boolean;
    engine?: string;
  }[];
  buckets: string[]; // full lowercased names (frontend bucket already excluded)
  queues: string[]; // full names incl any .fifo suffix
  secrets: string[]; // full names
  caches: string[]; // full names (replication group ids)
}

const DEFAULTS = {
  memory: 256,
  timeout: 30,
  ephemeral: 512,
  arch: "arm64",
  instanceClass: "db.t3.micro",
  storage: 20,
  multiAz: false,
};

// What a deploy does with a live resource that's no longer in the yml:
//   "prune" — always deleted on deploy (Lambda). Non-destructive (stateless).
//   "data"  — data store: DELETED only if autoRemove, else reported and kept.
//   "keep"  — deploy never prunes it (SQS/secrets/caches); reported as orphan.
type OrphanPolicy = "prune" | "data" | "keep";

// Pure diff: desired (cfg) vs actual (live). No IO — the test target.
export function classify(
  cfg: AppConfig,
  stage: string,
  live: LiveState,
  autoRemove = cfg.autoRemove ?? false,
): PlanResult {
  const pfx = `${cfg.app}-${stage}-`;
  const lcPfx = pfx.toLowerCase();
  const changes: Change[] = [];

  // Generic presence diff over a set of expected full names ↔ owned live full names.
  // `compare` (optional) runs for a resource present on both sides and returns an update/replace
  // Change (or null for no drift).
  const diff = (
    kind: string,
    expected: Map<string, string>, // fullName -> logical
    liveNames: Iterable<string>,
    compare?: (fullName: string, logical: string) => Change | null,
    orphan: OrphanPolicy = "keep",
  ) => {
    const liveSet = new Set(liveNames);
    for (const [full, logical] of expected) {
      if (!liveSet.has(full)) changes.push({ action: "create", kind, name: logical });
      else if (compare) {
        const c = compare(full, logical);
        if (c) changes.push(c);
      }
    }
    const wantFull = new Set(expected.keys());
    for (const full of liveSet) {
      if (wantFull.has(full)) continue;
      const name = full.startsWith(pfx) ? full.slice(pfx.length) : full;
      const del = orphan === "prune" || (orphan === "data" && autoRemove);
      changes.push(
        del
          ? { action: "delete", kind, name, destructive: orphan === "data" }
          : {
              action: "orphan",
              kind,
              name,
              detail:
                orphan === "data"
                  ? "not in slsv.yml — kept (autoRemove: false); remove with `slsv destroy`"
                  : "not in slsv.yml — remove with `slsv destroy`",
            },
      );
    }
  };

  // --- Functions ---
  const fnLive = new Map(live.functions.map((f) => [f.name, f]));
  diff(
    "function",
    new Map(Object.keys(cfg.functions ?? {}).map((n) => [`${pfx}${n}`, n])),
    fnLive.keys(),
    (full, logical) => {
      const l = fnLive.get(full)!;
      const want = cfg.functions![logical];
      const arch = want.architecture ?? DEFAULTS.arch;
      if (l.arch && l.arch !== arch)
        return { action: "replace", kind: "function", name: logical, detail: `architecture ${l.arch}→${arch}` };
      const diffs: string[] = [];
      const wMem = want.memory ?? DEFAULTS.memory;
      const wTo = want.timeout ?? DEFAULTS.timeout;
      const wEph = want.ephemeralStorage ?? DEFAULTS.ephemeral;
      if (l.memory !== undefined && l.memory !== wMem) diffs.push(`memory ${l.memory}→${wMem}`);
      if (l.timeout !== undefined && l.timeout !== wTo) diffs.push(`timeout ${l.timeout}→${wTo}`);
      if (l.ephemeral !== undefined && l.ephemeral !== wEph)
        diffs.push(`ephemeralStorage ${l.ephemeral}→${wEph}`);
      return diffs.length
        ? { action: "update", kind: "function", name: logical, detail: diffs.join(", ") }
        : null;
    },
    "prune", // Lambda orphans are always pruned on deploy
  );

  // --- DynamoDB tables (partition/sort key immutable → replace) ---
  const tblLive = new Map(live.tables.map((t) => [t.name, t]));
  const wantTables = Object.entries(cfg.databases ?? {}).filter(([, d]) => d.type === "dynamodb");
  diff(
    "table",
    new Map(wantTables.map(([n]) => [`${pfx}${n}`, n])),
    tblLive.keys(),
    (full, logical) => {
      const l = tblLive.get(full)!;
      const d = cfg.databases![logical];
      if (d.type !== "dynamodb") return null;
      const wantPk = d.partitionKey.name;
      const wantSk = d.sortKey?.name;
      if ((l.partitionKey ?? wantPk) !== wantPk || (l.sortKey ?? "") !== (wantSk ?? ""))
        return {
          action: "replace",
          kind: "table",
          name: logical,
          detail: `key schema ${l.partitionKey}${l.sortKey ? "/" + l.sortKey : ""}→${wantPk}${wantSk ? "/" + wantSk : ""}`,
        };
      return null;
    },
    "data",
  );

  // --- RDS (postgres/mysql): engine immutable → replace; class/storage/multiAz mutable ---
  const dbLive = new Map(live.databases.map((d) => [d.name, d]));
  const wantDbs = Object.entries(cfg.databases ?? {}).filter(
    ([, d]) => d.type === "postgres" || d.type === "mysql",
  );
  diff(
    "database",
    new Map(wantDbs.map(([n]) => [`${pfx}${n}`, n])),
    dbLive.keys(),
    (full, logical) => {
      const l = dbLive.get(full)!;
      const d = cfg.databases![logical];
      if (d.type !== "postgres" && d.type !== "mysql") return null;
      if (l.engine && l.engine !== d.type)
        return { action: "replace", kind: "database", name: logical, detail: `engine ${l.engine}→${d.type}` };
      const diffs: string[] = [];
      const wCls = d.instanceClass ?? DEFAULTS.instanceClass;
      const wSto = d.storage ?? DEFAULTS.storage;
      const wMz = d.multiAz ?? DEFAULTS.multiAz;
      if (l.instanceClass && l.instanceClass !== wCls)
        diffs.push(`instanceClass ${l.instanceClass}→${wCls}`);
      if (l.storage !== undefined && l.storage !== wSto) diffs.push(`storage ${l.storage}→${wSto}`);
      if (l.multiAz !== undefined && l.multiAz !== wMz) diffs.push(`multiAz ${l.multiAz}→${wMz}`);
      return diffs.length
        ? { action: "update", kind: "database", name: logical, detail: diffs.join(", ") }
        : null;
    },
    "data",
  );

  // --- S3 buckets (presence only in v1; config diff is follow-up). Data → destructive delete. ---
  diff(
    "bucket",
    new Map(Object.keys(cfg.buckets ?? {}).map((n) => [`${lcPfx}${n}`, n])),
    live.buckets,
    undefined,
    "data",
  );

  // --- SQS (presence; fifo flips the name so a fifo change surfaces as delete+create) ---
  // Auto-provisioned DLQs (`dlq: true` → `<name>Failed`, or any named `dlq:` not declared as its
  // own queue) are added to the expected set so plan doesn't flag a queue slsv itself created as
  // an orphan. FIFO suffix mirrored from the source (AWS requires main + DLQ to match on FIFO).
  const wantQueues = new Map<string, string>();
  for (const [n, q] of Object.entries(cfg.queues ?? {})) {
    const suffix = q.fifo ? ".fifo" : "";
    wantQueues.set(`${pfx}${n}${suffix}`, n);
    const dlq = dlqName(n, q.dlq);
    if (dlq && !(dlq in (cfg.queues ?? {})))
      wantQueues.set(`${pfx}${dlq}${suffix}`, `${n} (auto-DLQ)`);
  }
  diff("queue", wantQueues, live.queues);

  // --- Secrets (presence) ---
  diff(
    "secret",
    new Map((cfg.secrets ?? []).map((n) => [`${pfx}${n}`, n])),
    live.secrets,
  );

  // --- Caches (presence; nodeType diff is follow-up) ---
  diff(
    "cache",
    new Map(Object.keys(cfg.caches ?? {}).map((n) => [`${pfx}${n}`, n])),
    live.caches,
  );

  return { changes };
}

// Enumerate live AWS state, then classify. Read-only.
export async function computePlan(
  clients: Clients,
  cfg: AppConfig,
  stage: string,
): Promise<PlanResult> {
  const pfx = `${cfg.app}-${stage}-`;
  const lcPfx = pfx.toLowerCase();
  const owned = (n?: string): n is string => !!n && n.startsWith(pfx);
  const frontendBucket = `${lcPfx}frontend`;

  const [fnList, tableNames, dbList, bucketList, queueUrls, secretList, cacheList] =
    await Promise.all([
      paginate((Marker) =>
        clients.lambda
          .send(new ListFunctionsCommand({ Marker }))
          .then((r) => ({ items: r.Functions ?? [], next: r.NextMarker })),
      ),
      paginate((ExclusiveStartTableName) =>
        clients.dynamo
          .send(new ListTablesCommand({ ExclusiveStartTableName }))
          .then((r) => ({ items: r.TableNames ?? [], next: r.LastEvaluatedTableName })),
      ),
      paginate((Marker) =>
        clients.rds
          .send(new DescribeDBInstancesCommand({ Marker }))
          .then((r) => ({ items: r.DBInstances ?? [], next: r.Marker })),
      ),
      clients.s3.send(new ListBucketsCommand({})).then((r) => r.Buckets ?? []),
      paginate((NextToken) =>
        clients.sqs
          .send(new ListQueuesCommand({ QueueNamePrefix: pfx, NextToken }))
          .then((r) => ({ items: r.QueueUrls ?? [], next: r.NextToken })),
      ),
      paginate((NextToken) =>
        clients.secrets
          .send(new ListSecretsCommand({ NextToken }))
          .then((r) => ({ items: r.SecretList ?? [], next: r.NextToken })),
      ),
      clients.elasticache
        .send(new DescribeReplicationGroupsCommand({}))
        .then((r) => r.ReplicationGroups ?? [])
        .catch(() => []),
    ]);

  const functions = fnList
    .filter((f) => owned(f.FunctionName))
    .map((f) => ({
      name: f.FunctionName!,
      memory: f.MemorySize,
      timeout: f.Timeout,
      ephemeral: f.EphemeralStorage?.Size,
      arch: f.Architectures?.[0],
    }));

  const ownedTables = tableNames.filter(owned);
  const tables = await Promise.all(
    ownedTables.map(async (name) => {
      const d = await clients.dynamo.send(new DescribeTableCommand({ TableName: name }));
      const ks = (d.Table?.KeySchema ?? []) as KeySchemaElement[];
      return {
        name,
        partitionKey: ks.find((k) => k.KeyType === "HASH")?.AttributeName,
        sortKey: ks.find((k) => k.KeyType === "RANGE")?.AttributeName,
      };
    }),
  );

  const databases = dbList
    .filter((d) => owned(d.DBInstanceIdentifier))
    .map((d) => ({
      name: d.DBInstanceIdentifier!,
      instanceClass: d.DBInstanceClass,
      storage: d.AllocatedStorage,
      multiAz: d.MultiAZ,
      engine: d.Engine,
    }));

  const buckets = bucketList
    .map((b) => b.Name!)
    .filter((n) => n.startsWith(lcPfx) && n !== frontendBucket);

  const queues = queueUrls.map((u) => u.split("/").pop()!).filter(owned);
  const secrets = secretList.map((s) => s.Name!).filter(owned);
  const caches = cacheList.map((c) => c.ReplicationGroupId!).filter(owned);

  return classify(cfg, stage, {
    functions,
    tables,
    databases,
    buckets,
    queues,
    secrets,
    caches,
  });
}

const C: Record<ChangeAction | "dim" | "reset", string> = {
  create: "\x1b[32m", // green
  update: "\x1b[33m", // yellow
  replace: "\x1b[35m", // magenta
  delete: "\x1b[31m", // red
  orphan: "\x1b[2m", // dim — deploy leaves it
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};
const SIGIL: Record<ChangeAction, string> = {
  create: "+",
  update: "~",
  replace: "!",
  delete: "-",
  orphan: "?",
};
const VERB: Record<ChangeAction, string> = {
  create: "to create",
  update: "to update",
  replace: "to replace",
  delete: "to delete",
  orphan: "orphaned",
};
const ORDER: ChangeAction[] = ["create", "update", "replace", "delete", "orphan"];

export function renderPlan(result: PlanResult): string {
  const { changes } = result;
  if (!changes.length) return "No changes. Live AWS state matches slsv.yml.";

  const lines: string[] = [];
  for (const action of ORDER) {
    for (const c of changes.filter((x) => x.action === action)) {
      const tag =
        c.action === "replace" ? " (requires replace)" : c.destructive ? " (destructive)" : "";
      const detail = c.detail ? `  ${C.dim}${c.detail}${C.reset}` : "";
      lines.push(`  ${C[action]}${SIGIL[action]} ${c.kind} ${c.name}${tag}${C.reset}${detail}`);
    }
  }

  const count = (a: ChangeAction) => changes.filter((c) => c.action === a).length;
  const parts = ORDER.map((a) => [count(a), a] as const)
    .filter(([n]) => n > 0)
    .map(([n, a]) => `${n} ${VERB[a]}`);
  lines.push("", `Plan: ${parts.join(", ")}.`);
  const replaces = count("replace");
  const destroys = changes.filter((c) => c.action === "delete" && c.destructive).length;
  if (replaces)
    lines.push(
      `${C.replace}! ${replaces} require replace — deploy will NOT auto-apply; run \`slsv destroy\` + redeploy or accept drift.${C.reset}`,
    );
  if (destroys)
    lines.push(
      `${C.delete}- ${destroys} data store(s) will be DELETED with their data (autoRemove: true).${C.reset}`,
    );
  return lines.join("\n");
}

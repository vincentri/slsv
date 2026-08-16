import { execFileSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  ECSClient,
  CreateClusterCommand,
  RegisterTaskDefinitionCommand,
  DeregisterTaskDefinitionCommand,
  DeleteClusterCommand,
  ListTaskDefinitionsCommand,
  ListTasksCommand,
  DescribeClustersCommand,
  StopTaskCommand,
} from "@aws-sdk/client-ecs";
import {
  ECRClient,
  CreateRepositoryCommand,
  DeleteRepositoryCommand,
  PutLifecyclePolicyCommand,
  DescribeRepositoriesCommand,
  GetAuthorizationTokenCommand,
} from "@aws-sdk/client-ecr";
import {
  EC2Client,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
  CreateSecurityGroupCommand,
  DeleteSecurityGroupCommand,
} from "@aws-sdk/client-ec2";
import { envKey } from "../../env-key.js";
import { ConfigError, fargateDefaultMemory, type AppConfig } from "../../config.js";
import { asTagArray } from "./tags.js";

// Every worker task in an app+stage shares one cluster; it holds no config and costs nothing.
export const clusterName = (appName: string) => appName;

// The single container inside each task definition. Fixed — nothing needs to configure it,
// but RunTask overrides address it by name, so the SDK gets it via the injected spec.
const CONTAINER = "app";

// What `worker('name').run()` needs at runtime to call RunTask, injected as WORKER_<NAME>.
// ponytail: a JSON blob in one env var rather than five parallel env vars — same shape as every
// other binding (one logical name → one env key) and the SDK is the only reader.
export type WorkerSpec = {
  cluster: string;
  taskDefinition: string;
  container: string;
  subnets?: string[];
  securityGroups?: string[];
  assignPublicIp?: boolean;
};

// ECS is the odd one out: its Tag shape is lowercase {key,value}, not the {Key,Value} every
// other service (and asTagArray) uses.
const ecsTags = (tags: Record<string, string>) =>
  Object.entries(tags).map(([key, value]) => ({ key, value }));

const docker = (args: string[], cwd?: string) =>
  execFileSync("docker", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

// Build the image, push it to ECR, return the pushed reference.
//
// The registry host comes from GetAuthorizationToken's proxyEndpoint, NOT the repository's
// `repositoryUri`: on Floci that URI is `000000000000.dkr.ecr.us-east-1.localhost:5100/<repo>`,
// whose host does not resolve. proxyEndpoint is `http://localhost:5100` locally and
// `https://<acct>.dkr.ecr.<region>.amazonaws.com` on AWS — so one code path covers both.
async function buildAndPush(
  ecr: ECRClient,
  repo: string,
  context: string,
  arch: "x86_64" | "arm64",
): Promise<string> {
  const auth = await ecr.send(new GetAuthorizationTokenCommand({}));
  const data = auth.authorizationData?.[0];
  if (!data?.authorizationToken || !data.proxyEndpoint)
    throw new Error("ECR GetAuthorizationToken returned no credentials");
  const [user, pass] = Buffer.from(data.authorizationToken, "base64").toString().split(":");
  const registry = new URL(data.proxyEndpoint).host;

  execFileSync("docker", ["login", "-u", user!, "--password-stdin", registry], {
    input: pass,
    stdio: ["pipe", "ignore", "inherit"],
  });

  // A Mac builds arm64 natively; Fargate defaults to x86_64. Mismatched, the task starts and
  // dies with `exec format error` — and only on AWS, since local docker runs the native build
  // happily. So the platform is always explicit and always matches runtimePlatform below.
  const platform = `linux/${arch === "x86_64" ? "amd64" : "arm64"}`;
  // -q prints only the image id; tagging by its digest means an unchanged build pushes nothing
  // but layer-existence checks. (ListImages can't be used to skip the push — Floci's ECR API
  // returns [] even for images its registry is serving.)
  const imageId = docker(["build", "--platform", platform, "-q", "."], context).trim();
  const tag = imageId.replace(/^sha256:/, "").slice(0, 12);
  const ref = `${registry}/${repo}:${tag}`;
  docker(["tag", imageId, ref]);
  docker(["push", ref]);
  return ref;
}

export async function ensureWorkers(
  ecs: ECSClient,
  ecr: ECRClient,
  ec2: EC2Client,
  workers: AppConfig["workers"],
  appName: string,
  cwd: string,
  roleArn: string | undefined,
  envVars: Record<string, string>,
  tags: Record<string, string>,
  local: boolean,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!workers || !Object.keys(workers).length) return out;

  const cluster = clusterName(appName);
  await ecs.send(
    new CreateClusterCommand({ clusterName: cluster, tags: ecsTags(tags) }),
  );

  // Discovered once per deploy, and only if some worker needs it — Floci ignores networking, so
  // this never runs (and never needs an EC2 API) on --target local.
  let discovered: { subnets: string[]; securityGroups: string[] } | undefined;
  const network = async (w: { vpc?: NonNullable<AppConfig["workers"]>[string]["vpc"] }) => {
    if (local) return undefined;
    if (w.vpc) return { subnets: w.vpc.subnets, securityGroups: w.vpc.securityGroups ?? [] };
    return (discovered ??= await resolveDefaultVpc(ec2, appName, tags));
  };

  for (const [name, w] of Object.entries(workers)) {
    const context = path.resolve(cwd, w.image);
    if (!existsSync(path.join(context, "Dockerfile")))
      throw new ConfigError(`workers.${name}.image: no Dockerfile in ${context}`);

    const repo = `${appName}-${name}`.toLowerCase();
    try {
      await ecr.send(new DescribeRepositoriesCommand({ repositoryNames: [repo] }));
    } catch {
      await ecr.send(
        new CreateRepositoryCommand({
          repositoryName: repo,
          tags: asTagArray(tags),
        }),
      );
      // Each deploy pushes a new digest-tagged image and nothing overwrites the old one, so
      // without this the repo grows forever and bills forever. Set at create only (it's the
      // repo's own policy, not per-image state).
      await ecr
        .send(
          new PutLifecyclePolicyCommand({
            repositoryName: repo,
            lifecyclePolicyText: JSON.stringify({
              rules: [
                {
                  rulePriority: 1,
                  description: "slsv: keep the last 5 worker images",
                  selection: { tagStatus: "any", countType: "imageCountMoreThan", countNumber: 5 },
                  action: { type: "expire" },
                },
              ],
            }),
          }),
        )
        // ponytail: Floci's ECR has no lifecycle-policy API — the local repo is deleted wholesale
        // by destroy/prune anyway, so a miss here costs nothing.
        .catch(() => {});
      console.log(`  + created ECR repo ${repo}`);
    }

    const arch = w.architecture ?? "arm64";
    const image = await buildAndPush(ecr, repo, context, arch);

    const family = `${appName}-${name}`;
    const cpu = w.cpu ?? 1024;
    await ecs.send(
      new RegisterTaskDefinitionCommand({
        family,
        requiresCompatibilities: ["FARGATE"],
        networkMode: "awsvpc",
        cpu: String(cpu),
        memory: String(w.memory ?? fargateDefaultMemory(cpu)),
        runtimePlatform: {
          cpuArchitecture: arch === "x86_64" ? "X86_64" : "ARM64",
          operatingSystemFamily: "LINUX",
        },
        ...(w.ephemeralStorage ? { ephemeralStorage: { sizeInGiB: w.ephemeralStorage } } : {}),
        // Fargate needs the execution role to pull from ECR and write logs; the task role is what
        // the worker's own AWS calls assume. Floci ignores both, so this is aws-shaped only.
        ...(roleArn ? { executionRoleArn: roleArn, taskRoleArn: roleArn } : {}),
        containerDefinitions: [
          {
            name: CONTAINER,
            image,
            essential: true,
            // w.environment FIRST so slsv bindings win — same precedence as functions.ts. The
            // other way round, a user key could clobber BUCKET_*/AWS_ENDPOINT_URL and break the
            // worker in ways that only show up at runtime.
            environment: Object.entries({
              ...(w.environment ?? {}),
              ...envVars,
              SLSV_MAX_RUNTIME: String(w.maxRuntime ?? 3600),
            }).map(([n, value]) => ({ name: n, value })),
            // ponytail: Floci's awslogs driver is a no-op (the group is never created), so local
            // output is only in `docker logs floci-ecs-*`. Real CloudWatch on AWS.
            ...(local
              ? {}
              : {
                  logConfiguration: {
                    logDriver: "awslogs",
                    options: {
                      "awslogs-group": `/aws/ecs/${family}`,
                      "awslogs-region": process.env.AWS_REGION ?? "us-east-1",
                      "awslogs-stream-prefix": CONTAINER,
                      "awslogs-create-group": "true",
                    },
                  },
                }),
          },
        ],
        tags: ecsTags(tags),
      }),
    );
    console.log(`  ✓ worker ${family} (${cpu} cpu, ${arch})`);

    const net = await network(w);
    const spec: WorkerSpec = {
      cluster,
      taskDefinition: family,
      container: CONTAINER,
      ...(net
        ? {
            subnets: net.subnets,
            securityGroups: net.securityGroups,
            assignPublicIp: w.vpc?.assignPublicIp ?? true,
          }
        : {}),
    };
    out[envKey("WORKER", name)] = JSON.stringify(spec);
  }

  return out;
}

// ── teardown ────────────────────────────────────────────────────────────────────────────────
// Task definitions and ECR repos are BUILD ARTIFACTS, not data stores: rebuilt and re-pushed on
// every deploy, holding nothing the user authored. So a worker dropped from the yml prunes like a
// Lambda (always), not like a bucket (report-only) — same reasoning as the frontend hosting bucket.

// Live worker families under this app+stage.
//
// Derived from ACTIVE task DEFINITIONS, not ListTaskDefinitionFamilies: Floci keeps reporting a
// family as ACTIVE after every one of its revisions is deregistered (real AWS flips the family to
// INACTIVE). Trusting it made prune re-fire on each deploy, printing "pruned worker" for something
// already gone and leaving `slsv plan` showing a phantom delete forever. A family with no ACTIVE
// revision can't launch anything, so "has an ACTIVE revision" is the honest liveness test on both.
//
// familyPrefix is a prefix match — intended here (every family under `<app>-<stage>-`), but it
// means callers matching ONE worker must compare the family name exactly.
export async function listWorkerFamilies(ecs: ECSClient, prefix: string): Promise<string[]> {
  const families = new Set<string>();
  let nextToken: string | undefined;
  do {
    const r = await ecs.send(
      new ListTaskDefinitionsCommand({ familyPrefix: prefix, status: "ACTIVE", nextToken }),
    );
    for (const arn of r.taskDefinitionArns ?? [])
      families.add(arn.split("/").pop()!.split(":")[0]!);
    nextToken = r.nextToken;
  } while (nextToken);
  return [...families];
}

export async function listWorkerRepos(ecr: ECRClient, lcPrefix: string): Promise<string[]> {
  const out: string[] = [];
  let nextToken: string | undefined;
  do {
    const r = await ecr.send(new DescribeRepositoriesCommand({ nextToken }));
    out.push(...(r.repositories ?? []).map((x) => x.repositoryName!).filter(Boolean));
    nextToken = r.nextToken;
  } while (nextToken);
  return out.filter((n) => n.startsWith(lcPrefix));
}

// Stop everything this family still has running, then deregister every revision.
//
// StopTask first for a local reason: Floci removes a task's container when the task stops, so
// stopping is what actually kills the process. It matters on AWS too — a deregistered task
// definition does NOT stop tasks already running from it.
export async function destroyWorkerFamily(ecs: ECSClient, cluster: string, family: string) {
  const tasks = await ecs
    .send(new ListTasksCommand({ cluster, family }))
    .then((r) => r.taskArns ?? [])
    // ponytail: Floci's ListTasks ignores desiredStatus and returns STOPPED tasks too, so this
    // re-stops already-stopped ones. Harmless (StopTask on a stopped task is a no-op) and cheaper
    // than a DescribeTasks round-trip to filter.
    .catch(() => [] as string[]);
  for (const task of tasks)
    await ecs.send(new StopTaskCommand({ cluster, task, reason: "slsv teardown" })).catch(() => {});

  let nextToken: string | undefined;
  do {
    const r = await ecs.send(
      new ListTaskDefinitionsCommand({ familyPrefix: family, status: "ACTIVE", nextToken }),
    );
    for (const arn of r.taskDefinitionArns ?? []) {
      // arn:…:task-definition/<family>:<revision> — prefix-match would catch sibling families.
      const [f] = arn.split("/").pop()!.split(":");
      if (f !== family) continue;
      await ecs.send(new DeregisterTaskDefinitionCommand({ taskDefinition: arn }));
    }
    nextToken = r.nextToken;
  } while (nextToken);
}

// force: the repo still holds every image tag slsv pushed; they're build output, not data.
export const deleteWorkerRepo = (ecr: ECRClient, repositoryName: string) =>
  ecr.send(new DeleteRepositoryCommand({ repositoryName, force: true }));

export const deleteWorkerCluster = (ecs: ECSClient, cluster: string) =>
  ecs.send(new DeleteClusterCommand({ cluster }));

// Does this app+stage still have a cluster? Destroy can't key cluster teardown off "found some
// task definitions": add a worker, remove it from the yml (reconcile prunes the families but
// leaves the cluster), then destroy — zero families found, and the cluster leaks forever.
export const clusterExists = (ecs: ECSClient, cluster: string) =>
  ecs
    .send(new DescribeClustersCommand({ clusters: [cluster] }))
    .then((r) => r.clusters?.some((c) => c.status === "ACTIVE") ?? false)
    .catch(() => false);

// ── default-VPC discovery (aws only) ────────────────────────────────────────────────────────
// Fargate RunTask REQUIRES subnets + security groups. Floci ignores networking entirely, so a
// worker runs locally with none of this — which makes an unresolved VPC the single most likely
// first-real-deploy failure. Rather than make every user hand-write subnet ids, slsv finds the
// account's default VPC and owns one egress-only security group in it.
//
// PUBLIC subnets + assignPublicIp is deliberate: the task must reach ECR/S3/DynamoDB, and a
// private subnet would need a NAT gateway (~$32/mo standing) or a pile of VPC endpoints. The
// security group opens NOTHING inbound, so the public IP is outbound-only.
//
// ponytail: default VPC only. An account whose default VPC was deleted (common in orgs) gets a
// ConfigError pointing at `workers.<name>.vpc`, which overrides discovery entirely.
export async function resolveDefaultVpc(
  ec2: EC2Client,
  appName: string,
  tags: Record<string, string>,
): Promise<{ subnets: string[]; securityGroups: string[] }> {
  const subnetList = await ec2.send(
    new DescribeSubnetsCommand({ Filters: [{ Name: "default-for-az", Values: ["true"] }] }),
  );
  const subnets = subnetList.Subnets ?? [];
  const vpcId = subnets[0]?.VpcId;
  if (!vpcId)
    throw new ConfigError(
      `No default VPC found — Fargate needs subnets to run a worker task.\n` +
        `  Set it explicitly:  workers.<name>.vpc: { subnets: [subnet-…], securityGroups: [sg-…] }`,
    );

  const groupName = `${appName}-worker`;
  const found = await ec2
    .send(
      new DescribeSecurityGroupsCommand({
        Filters: [
          { Name: "group-name", Values: [groupName] },
          { Name: "vpc-id", Values: [vpcId] },
        ],
      }),
    )
    .then((r) => r.SecurityGroups?.[0]?.GroupId);

  // A new security group starts with no ingress and allow-all egress — exactly what a worker
  // wants, so there are no rule calls to make.
  const groupId =
    found ??
    (await ec2
      .send(
        new CreateSecurityGroupCommand({
          GroupName: groupName,
          Description: `slsv worker tasks for ${appName} (egress only)`,
          VpcId: vpcId,
          TagSpecifications: [{ ResourceType: "security-group", Tags: asTagArray(tags) }],
        }),
      )
      .then((r) => r.GroupId!));
  if (!found) console.log(`  + created security group ${groupName}`);
  if (!groupId) throw new Error(`could not resolve security group ${groupName}`);

  return { subnets: subnets.map((s) => s.SubnetId).filter((x): x is string => !!x), securityGroups: [groupId] };
}

export async function deleteWorkerSecurityGroup(ec2: EC2Client, appName: string) {
  const g = await ec2
    .send(
      new DescribeSecurityGroupsCommand({
        Filters: [{ Name: "group-name", Values: [`${appName}-worker`] }],
      }),
    )
    .then((r) => r.SecurityGroups?.[0]?.GroupId);
  if (!g) return;
  // A just-stopped task's ENI takes ~30-60s to detach, and AWS refuses to delete a security group
  // still attached to one (DependencyViolation) — destroy stops tasks moments earlier, so a
  // one-shot delete would fail nearly every time. Same retry shape as deleteCertWhenFree.
  for (let i = 0; i < 12; i++) {
    try {
      await ec2.send(new DeleteSecurityGroupCommand({ GroupId: g }));
      return;
    } catch (e) {
      if (!/DependencyViolation/i.test(String((e as Error).name)) || i === 11) throw e;
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

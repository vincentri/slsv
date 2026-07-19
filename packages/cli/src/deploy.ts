import type { AppConfig } from "./config.js";
import type { AwsProvider } from "./providers/aws/index.js";
import { config as dotenv } from "dotenv";
import { slsvTags } from "./providers/aws/tags.js";
import { lintApp } from "./lint.js";
import path from "path";

export type DeployOutputs = {
  apiUrl?: string;
  frontendUrl?: string;
};

// Load env/secret values in precedence order:
//   1. .env.local  — local-machine overrides, ONLY on --target local (e.g. `slsv dev`). Never
//      sent to the cloud; git-ignore it. Mirrors Vite/Next `.env.local`.
//   2. .env.<stage> — per-stage values.
//   3. .env         — shared defaults.
// Default (override=false): dotenv never overwrites an already-set key, so first-in wins — load
// highest-precedence first. override=true (dev hot-reload of an edited .env): last-in wins, so
// load in reverse to keep the SAME precedence while picking up changed values.
export function loadEnv(cwd: string, stage: string, target: string, override = false) {
  const files = [
    ...(target === "local" ? [".env.local"] : []),
    `.env.${stage}`,
    ".env",
  ];
  for (const f of override ? [...files].reverse() : files) {
    dotenv({ path: path.join(cwd, f), override });
  }
}

const hasResources = (cfg: AppConfig) =>
  Object.keys(cfg.functions ?? {}).length > 0 ||
  Object.keys(cfg.databases ?? {}).length > 0 ||
  Object.keys(cfg.queues ?? {}).length > 0 ||
  Object.keys(cfg.buckets ?? {}).length > 0 ||
  Object.keys(cfg.caches ?? {}).length > 0 ||
  (cfg.secrets?.length ?? 0) > 0;

export async function deploy(
  cfg: AppConfig,
  provider: AwsProvider,
  cwd: string,
  mode: "deploy" | "dev" = "deploy",
  stage = "dev",
): Promise<DeployOutputs> {
  loadEnv(cwd, stage, provider.target);
  // Every resource is namespaced by stage so dev/prod stacks coexist in one account.
  const prefix = `${cfg.app}-${stage}`;
  console.log(`\nDeploying ${cfg.app} (stage: ${stage})...`);

  // Preflight: fail fast if slsv.yml doesn't match the code (missing handler/export, an SDK
  // call naming an undeclared resource, a queue trigger with no queue) — a clear message here
  // beats a cryptic esbuild failure or a runtime 500. Throws ConfigError → printed sans stack.
  lintApp(cfg, cwd);

  const functions = cfg.functions ?? {};
  const hasBackend = hasResources(cfg);

  let apiUrl: string | undefined;
  if (hasBackend) {
    const tags = slsvTags(cfg.app, stage, cfg.tags);
    await provider.setup(prefix, Object.keys(functions), tags, cfg.logRetentionDays ?? 14);

    if (hasResources(cfg)) console.log("→ Storage, messaging & caches");
    const [bucketEnvs, queueEnvs, secretEnvs, cacheEnvs, dbEnvs] = await Promise.all([
      provider.ensureBuckets(cfg.buckets, prefix),
      provider.ensureQueues(cfg.queues, prefix),
      provider.ensureSecrets(
        cfg.secrets ?? [],
        process.env as Record<string, string | undefined>,
        prefix,
      ),
      provider.ensureCaches(cfg.caches, prefix),
      provider.ensureDatabases(cfg.databases, prefix, cwd),
    ]);

    const allEnvs = {
      ...bucketEnvs,
      ...queueEnvs,
      ...secretEnvs,
      ...cacheEnvs,
      ...dbEnvs,
      SLSV_STAGE: stage,
    };

    if (Object.keys(functions).length) console.log("→ Functions");
    const fnOutputs = await provider.deployFunctions(functions, prefix, allEnvs, cwd);
    [apiUrl] = await Promise.all([
      provider.wireHttp(functions, fnOutputs, prefix, cfg.api?.cors, cfg.api?.auth),
      provider.wireQueues(functions, fnOutputs),
      provider.wireCron(functions, fnOutputs, prefix),
    ]);

    // Custom API domain (aws-only). If set, it becomes the API's public URL — so the frontend
    // build gets injected with it (below) instead of the raw execute-api URL.
    const customApiUrl = await provider.wireApiDomain(cfg.api, prefix);
    if (customApiUrl) {
      console.log(`   API: ${customApiUrl}`);
      apiUrl = customApiUrl;
    }

    console.log("→ Reconcile (prune orphans)");
    await provider.reconcile(cfg, stage);
  }

  // In dev mode, Vite handles the frontend — skip static file server
  const frontendUrl =
    mode === "dev" ? undefined : await provider.deployFrontend(cfg.frontend, prefix, cwd, apiUrl);

  console.log("\nDone.");
  return { apiUrl, frontendUrl };
}

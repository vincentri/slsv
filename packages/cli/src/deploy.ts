import type { AppConfig } from './config.js'
import type { Provider } from './providers/types.js'
import { config as dotenv } from 'dotenv'
import { slsvTags } from './providers/aws/tags.js'
import path from 'path'

export type DeployOutputs = {
  apiUrl?: string
  frontendUrl?: string
}

export async function deploy(
  cfg: AppConfig,
  provider: Provider,
  cwd: string,
  mode: 'deploy' | 'dev' = 'deploy',
  stage = 'dev',
): Promise<DeployOutputs> {
  // Stage-specific .env wins; dotenv never overwrites already-set keys, so load it first.
  dotenv({ path: path.join(cwd, `.env.${stage}`) })
  dotenv({ path: path.join(cwd, '.env') })
  // Every resource is namespaced by stage so dev/prod stacks coexist in one account.
  const prefix = `${cfg.app}-${stage}`
  console.log(`\nDeploying ${cfg.app} (stage: ${stage})...`)

  const functions = cfg.functions ?? {}
  const hasBackend =
    Object.keys(functions).length > 0 ||
    !!cfg.databases ||
    !!cfg.queues ||
    !!cfg.buckets ||
    !!cfg.caches ||
    (cfg.secrets?.length ?? 0) > 0

  let apiUrl: string | undefined
  if (hasBackend) {
    const tags = slsvTags(cfg.app, stage, cfg.tags)
    await provider.setup(prefix, Object.keys(functions), tags, cfg.logRetentionDays ?? 14)

    console.log('→ Storage, messaging & caches')
    const [bucketEnvs, queueEnvs, secretEnvs, cacheEnvs, dbEnvs] = await Promise.all([
      provider.ensureBuckets(cfg.buckets, prefix),
      provider.ensureQueues(cfg.queues, prefix),
      provider.ensureSecrets(cfg.secrets ?? [], process.env as Record<string, string | undefined>, prefix),
      provider.ensureCaches(cfg.caches, prefix),
      provider.ensureDatabases(cfg.databases, prefix, cwd),
    ])

    const allEnvs = { ...bucketEnvs, ...queueEnvs, ...secretEnvs, ...cacheEnvs, ...dbEnvs, SLSV_STAGE: stage }

    console.log('→ Functions')
    const fnOutputs = await provider.deployFunctions(functions, prefix, allEnvs, cwd)
    ;[apiUrl] = await Promise.all([
      provider.wireHttp(functions, fnOutputs, prefix),
      provider.wireQueues(functions, fnOutputs),
      provider.wireCron(functions, fnOutputs, prefix),
    ])

    console.log('→ Reconcile (prune orphans)')
    await provider.reconcile(cfg, stage)
  }

  // In dev mode, Vite handles the frontend — skip static file server
  const frontendUrl =
    mode === 'dev' ? undefined : await provider.deployFrontend(cfg.frontend, prefix, cwd, apiUrl)

  console.log('\nDone.')
  return { apiUrl, frontendUrl }
}

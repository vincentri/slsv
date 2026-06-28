import type { AppConfig } from './config.js'
import type { Provider } from './providers/types.js'
import { config as dotenv } from 'dotenv'
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
): Promise<DeployOutputs> {
  dotenv({ path: path.join(cwd, '.env') })
  console.log(`\nDeploying ${cfg.app}...`)

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
    await provider.setup(cfg.app, Object.keys(functions))

    console.log('→ Storage, messaging & caches')
    const [bucketEnvs, queueEnvs, secretEnvs, cacheEnvs, dbEnvs] = await Promise.all([
      provider.ensureBuckets(cfg.buckets, cfg.app),
      provider.ensureQueues(cfg.queues, cfg.app),
      provider.ensureSecrets(cfg.secrets ?? [], process.env as Record<string, string | undefined>),
      provider.ensureCaches(cfg.caches, cfg.app),
      provider.ensureDatabases(cfg.databases, cfg.app, cwd),
    ])

    const allEnvs = { ...bucketEnvs, ...queueEnvs, ...secretEnvs, ...cacheEnvs, ...dbEnvs }

    console.log('→ Functions')
    const fnOutputs = await provider.deployFunctions(functions, cfg.app, allEnvs, cwd)
    ;[apiUrl] = await Promise.all([
      provider.wireHttp(functions, fnOutputs, cfg.app),
      provider.wireQueues(functions, fnOutputs),
      provider.wireCron(functions, fnOutputs, cfg.app),
    ])
  }

  // In dev mode, Vite handles the frontend — skip static file server
  const frontendUrl =
    mode === 'dev' ? undefined : await provider.deployFrontend(cfg.frontend, cfg.app, cwd)

  console.log('\nDone.')
  return { apiUrl, frontendUrl }
}

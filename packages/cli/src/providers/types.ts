import type { AppConfig } from '../config.js'

export interface FunctionOutput {
  name: string
  ref: string // ARN on AWS, resource name on GCP, etc.
}

export interface Provider {
  // Local emulator lifecycle
  startLocalEmulator(cwd: string, cfg: AppConfig): Promise<void>
  stopLocalEmulator(cwd: string): void

  // Pre-deploy infra (IAM role, log groups, etc.)
  setup(appName: string, functionNames: string[]): Promise<void>

  // Resources → env vars injected into functions
  ensureBuckets(buckets: AppConfig['buckets'], appName: string): Promise<Record<string, string>>
  ensureQueues(queues: AppConfig['queues'], appName: string): Promise<Record<string, string>>
  ensureSecrets(
    secrets: string[],
    env: Record<string, string | undefined>,
  ): Promise<Record<string, string>>
  ensureCaches(caches: AppConfig['caches'], appName: string): Promise<Record<string, string>>
  ensureDatabases(
    databases: AppConfig['databases'],
    appName: string,
    cwd: string,
  ): Promise<Record<string, string>>

  // Deploy function code
  deployFunctions(
    functions: AppConfig['functions'],
    appName: string,
    envVars: Record<string, string>,
    cwd: string,
  ): Promise<Record<string, FunctionOutput>>

  // Update a single function's code (used by dev hot-reload)
  updateFunctionCode(fnName: string, zip: Uint8Array): Promise<void>

  // Wire triggers
  wireHttp(
    functions: AppConfig['functions'],
    fnOutputs: Record<string, FunctionOutput>,
    appName: string,
  ): Promise<string | undefined>
  wireQueues(
    functions: AppConfig['functions'],
    fnOutputs: Record<string, FunctionOutput>,
  ): Promise<void>
  wireCron(
    functions: AppConfig['functions'],
    fnOutputs: Record<string, FunctionOutput>,
    appName: string,
  ): Promise<void>

  // Frontend hosting
  deployFrontend(
    frontend: AppConfig['frontend'],
    appName: string,
    cwd: string,
  ): Promise<string | undefined>

  // Observability
  tailLogs(fnName: string, follow: boolean): Promise<void>
}

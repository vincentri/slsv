import {
  LambdaClient,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  GetFunctionCommand,
  waitUntilFunctionUpdatedV2,
  PutFunctionConcurrencyCommand,
  PublishVersionCommand,
  CreateAliasCommand,
  UpdateAliasCommand,
  PutProvisionedConcurrencyConfigCommand,
  ListVersionsByFunctionCommand,
  DeleteFunctionCommand,
} from '@aws-sdk/client-lambda'
import type { AppConfig } from '../../config.js'
import { bundleHandler } from '../../bundle.js'

export type AwsFnOutput = { arn: string; name: string }

// Lambda rejects a role it can't yet assume (IAM eventual consistency after CreateRole)
// with InvalidParameterValueException. Retry with linear backoff — real AWS usually settles
// within a few seconds; Floci never hits this.
async function withRoleRetry<T>(fn: () => Promise<T>, attempts = 6, delayMs = 2000): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e: any) {
      const assumeError =
        e?.name === 'InvalidParameterValueException' && /assume|role/i.test(e?.message ?? '')
      if (!assumeError || i >= attempts - 1) throw e
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
}

// Bounded-concurrency map: run `worker` over `items` with at most `limit` in flight.
// ponytail: inline pool, no p-limit dep. limit=8 stays well under Lambda's API rate; raise
// if deploys of huge apps still bottleneck (or drop to a real limiter if backpressure matters).
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

export async function deployFunctions(
  lambda: LambdaClient,
  functions: AppConfig['functions'],
  appName: string,
  roleArn: string,
  envVars: Record<string, string>,
  cwd: string,
  opts: { localEndpoint?: string } = {},
  tags: Record<string, string> = {},
): Promise<Record<string, AwsFnOutput>> {
  const outputs: Record<string, AwsFnOutput> = {}

  // Deploy functions with bounded concurrency — each fn blocks on waitUntilFunctionUpdatedV2
  // (up to 120s on real AWS), so a serial loop makes deploy time scale linearly with fn count.
  const entries = Object.entries(functions ?? {})
  const pairs = await mapLimit(entries, 8, async ([name, fn]) => {
    const fnName = `${appName}-${name}`
    console.log(`  Deploying function: ${fnName}`)

    const { zip, handlerRef } = await bundleHandler(fn.handler, cwd)
    const overrides: Record<string, string> = {}
    // ponytail: only inject AWS_ENDPOINT_URL locally; real AWS uses default endpoint resolution
    if (opts.localEndpoint) overrides.AWS_ENDPOINT_URL = opts.localEndpoint
    // fn.environment first so slsv bindings + overrides win — user can't clobber a binding
    const environment = {
      Variables: { ...fn.environment, ...envVars, ...overrides },
    }
    const timeout = fn.timeout ?? 30
    const memory = fn.memory ?? 256
    const ephemeralStorage = fn.ephemeralStorage ? { Size: fn.ephemeralStorage } : undefined
    const tracingConfig = fn.tracing ? { Mode: 'Active' as const } : undefined

    let fnArn: string
    try {
      const existing = await lambda.send(new GetFunctionCommand({ FunctionName: fnName }))
      await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: fnName, ZipFile: zip }))
      // Real AWS makes a code update async (LastUpdateStatus=InProgress); the config update
      // below 409s until it settles. Wait for it. (Floci returns Successful immediately.)
      await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: fnName })
      // Architecture is immutable on an existing function — only set at create.
      await lambda.send(
        new UpdateFunctionConfigurationCommand({
          FunctionName: fnName,
          Environment: environment,
          Timeout: timeout,
          MemorySize: memory,
          EphemeralStorage: ephemeralStorage,
          TracingConfig: tracingConfig,
        }),
      )
      fnArn = existing.Configuration!.FunctionArn!
    } catch (e: any) {
      if (e.name !== 'ResourceNotFoundException') throw e
      const create = new CreateFunctionCommand({
        FunctionName: fnName,
        Runtime: 'nodejs22.x',
        Role: roleArn,
        Handler: handlerRef,
        Code: { ZipFile: zip },
        Environment: environment,
        Timeout: timeout,
        MemorySize: memory,
        Architectures: [fn.architecture ?? 'arm64'],
        EphemeralStorage: ephemeralStorage,
        TracingConfig: tracingConfig,
        Tags: tags,
      })
      // A freshly-created IAM role isn't instantly assumable by Lambda (IAM is eventually
      // consistent). Retry with backoff on the assume-role error instead of failing deploy.
      const r = await withRoleRetry(() => lambda.send(create))
      fnArn = r.FunctionArn!
    }

    // Reserved concurrency is a separate call (not a CreateFunction param). Apply/refresh
    // on every deploy so a changed value takes effect; only when the user set it.
    if (fn.reservedConcurrency !== undefined) {
      await lambda.send(
        new PutFunctionConcurrencyCommand({
          FunctionName: fnName,
          ReservedConcurrentExecutions: fn.reservedConcurrency,
        }),
      )
    }

    // Provisioned concurrency (warm instances) — aws only; can't attach to $LATEST, so
    // publish a version, point the `live` alias at it, provision on the alias, and expose
    // the alias ARN so all triggers wire to the warm alias. Local stays on $LATEST.
    const isLocal = !!opts.localEndpoint
    if (fn.provisionedConcurrency !== undefined && !isLocal) {
      // Code just updated — must settle before publishing a version.
      await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: fnName })
      const published = await lambda.send(new PublishVersionCommand({ FunctionName: fnName }))
      const version = published.Version!

      try {
        await lambda.send(
          new CreateAliasCommand({ FunctionName: fnName, Name: 'live', FunctionVersion: version }),
        )
      } catch (e: any) {
        if (e.name !== 'ResourceConflictException') throw e
        await lambda.send(
          new UpdateAliasCommand({ FunctionName: fnName, Name: 'live', FunctionVersion: version }),
        )
      }

      await lambda.send(
        new PutProvisionedConcurrencyConfigCommand({
          FunctionName: fnName,
          Qualifier: 'live',
          ProvisionedConcurrentExecutions: fn.provisionedConcurrency,
        }),
      )

      // Triggers point at the warm alias, not $LATEST.
      fnArn = `${fnArn}:live`

      // GC: drop published versions the alias no longer points at (never $LATEST).
      const versions = await lambda.send(new ListVersionsByFunctionCommand({ FunctionName: fnName }))
      for (const v of versions.Versions ?? []) {
        if (v.Version && v.Version !== '$LATEST' && v.Version !== version) {
          await lambda
            .send(new DeleteFunctionCommand({ FunctionName: fnName, Qualifier: v.Version }))
            .catch(() => {}) // in use / already gone — leave it
        }
      }
    }

    return [name, { arn: fnArn, name: fnName }] as const
  })

  for (const [name, out] of pairs) outputs[name] = out
  return outputs
}

import {
  LambdaClient,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  GetFunctionCommand,
} from '@aws-sdk/client-lambda'
import type { AppConfig } from '../../config.js'
import { bundleHandler } from '../../bundle.js'

export type AwsFnOutput = { arn: string; name: string }

export async function deployFunctions(
  lambda: LambdaClient,
  functions: AppConfig['functions'],
  appName: string,
  roleArn: string,
  envVars: Record<string, string>,
  cwd: string,
  opts: { localEndpoint?: string } = {},
): Promise<Record<string, AwsFnOutput>> {
  const outputs: Record<string, AwsFnOutput> = {}

  for (const [name, fn] of Object.entries(functions ?? {})) {
    const fnName = `${appName}-${name}`
    console.log(`  Deploying function: ${fnName}`)

    const { zip, handlerRef } = await bundleHandler(fn.handler, cwd)
    const overrides: Record<string, string> = { SLSV_PROVIDER: 'aws' }
    // ponytail: only inject AWS_ENDPOINT_URL locally; real AWS uses default endpoint resolution
    if (opts.localEndpoint) overrides.AWS_ENDPOINT_URL = opts.localEndpoint
    const environment = {
      Variables: { ...envVars, ...overrides },
    }

    let fnArn: string
    try {
      const existing = await lambda.send(new GetFunctionCommand({ FunctionName: fnName }))
      await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: fnName, ZipFile: zip }))
      await lambda.send(
        new UpdateFunctionConfigurationCommand({ FunctionName: fnName, Environment: environment }),
      )
      fnArn = existing.Configuration!.FunctionArn!
    } catch (e: any) {
      if (e.name !== 'ResourceNotFoundException') throw e
      const r = await lambda.send(
        new CreateFunctionCommand({
          FunctionName: fnName,
          Runtime: 'nodejs22.x',
          Role: roleArn,
          Handler: handlerRef,
          Code: { ZipFile: zip },
          Environment: environment,
          Timeout: 30,
          MemorySize: 256,
        }),
      )
      fnArn = r.FunctionArn!
    }

    outputs[name] = { arn: fnArn, name: fnName }
  }

  return outputs
}

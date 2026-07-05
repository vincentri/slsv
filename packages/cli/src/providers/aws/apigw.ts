import {
  ApiGatewayV2Client,
  CreateApiCommand,
  UpdateApiCommand,
  CreateIntegrationCommand,
  CreateRouteCommand,
  CreateStageCommand,
  GetApisCommand,
  GetIntegrationsCommand,
  GetRoutesCommand,
  GetStagesCommand,
  UpdateIntegrationCommand,
  UpdateRouteCommand,
  DeleteApiCommand,
} from '@aws-sdk/client-apigatewayv2'
import { AddPermissionCommand, LambdaClient } from '@aws-sdk/client-lambda'
import type { AppConfig } from '../../config.js'
import type { AwsFnOutput } from './functions.js'

const FLOCI_ENDPOINT = 'http://localhost:4566'

// Delete the HTTP API for this app+stage (the API is named `appName`). Deleting the API
// cascades its routes, integrations and stages. No-op if it doesn't exist.
export async function deleteHttpApi(apigw: ApiGatewayV2Client, appName: string): Promise<void> {
  const apis = await apigw.send(new GetApisCommand({}))
  const api = apis.Items?.find((a) => a.Name === appName)
  if (api?.ApiId) await apigw.send(new DeleteApiCommand({ ApiId: api.ApiId }))
}

export async function ensureApiGateway(
  apigw: ApiGatewayV2Client,
  lambda: LambdaClient,
  functions: NonNullable<AppConfig['functions']>,
  outputs: Record<string, AwsFnOutput>,
  appName: string,
  isLocal: boolean,
): Promise<string | undefined> {
  const httpFunctions = Object.entries(functions).filter(([, fn]) => fn.http?.length)
  if (httpFunctions.length === 0) return undefined

  const api = await ensureHttpApi(apigw, appName)
  if (!api.ApiId) throw new Error(`API Gateway HTTP API for ${appName} is missing an id`)

  await ensureStage(apigw, api.ApiId)

  const integrations = await listIntegrations(apigw, api.ApiId)
  const routes = await listRoutes(apigw, api.ApiId)

  for (const [name, fn] of httpFunctions) {
    const fnOutput = outputs[name]
    if (!fnOutput) continue

    const integration = await ensureLambdaIntegration(
      apigw,
      api.ApiId,
      fnOutput.arn,
      integrations,
    )

    if (!integration.IntegrationId) {
      throw new Error(`API Gateway integration for ${fnOutput.arn} is missing an id`)
    }

    for (const route of fn.http ?? []) {
      const routeKey = toRouteKey(route.method, route.path)
      await ensureRoute(apigw, api.ApiId, routeKey, integration.IntegrationId, routes)
      await allowApiGatewayInvoke(lambda, appName, api.ApiId, routeKey, fnOutput.arn)
    }
  }

  // Floci and real AWS both return `<id>.execute-api.<region>.amazonaws.com` ApiEndpoints,
  // so the endpoint string can't tell them apart — use the target. Real AWS: the ApiEndpoint
  // works directly. Floci: it doesn't resolve from the host, so use the Floci path.
  if (!isLocal) return api.ApiEndpoint
  return `${FLOCI_ENDPOINT}/execute-api/${api.ApiId}/$default`
}

async function ensureHttpApi(apigw: ApiGatewayV2Client, appName: string) {
  // CORS so the S3-hosted frontend (different origin) can call the API. `*` is permissive;
  // tighten to the frontend origin later if needed.
  const cors = { AllowOrigins: ['*'], AllowMethods: ['*'], AllowHeaders: ['*'] }

  const existing = await apigw.send(new GetApisCommand({}))
  const found = existing.Items?.find((api) => api.Name === appName)
  if (found) {
    // Ensure CORS on an API created before this was added.
    await apigw.send(new UpdateApiCommand({ ApiId: found.ApiId, CorsConfiguration: cors }))
    return found
  }

  return apigw.send(
    new CreateApiCommand({
      Name: appName,
      ProtocolType: 'HTTP',
      CorsConfiguration: cors,
    }),
  )
}

async function ensureStage(apigw: ApiGatewayV2Client, apiId: string) {
  const existing = await apigw.send(new GetStagesCommand({ ApiId: apiId }))
  const found = existing.Items?.find((stage) => stage.StageName === '$default')
  if (found) return found

  return apigw.send(
    new CreateStageCommand({
      ApiId: apiId,
      StageName: '$default',
      AutoDeploy: true,
    }),
  )
}

async function ensureLambdaIntegration(
  apigw: ApiGatewayV2Client,
  apiId: string,
  functionArn: string,
  integrations: Awaited<ReturnType<typeof listIntegrations>>,
) {
  const found = integrations.find((integration) => integration.IntegrationUri === functionArn)
  if (found) return found

  return apigw.send(
    new CreateIntegrationCommand({
      ApiId: apiId,
      IntegrationType: 'AWS_PROXY',
      IntegrationMethod: 'POST',
      IntegrationUri: functionArn,
      PayloadFormatVersion: '2.0',
    }),
  )
}

async function ensureRoute(
  apigw: ApiGatewayV2Client,
  apiId: string,
  routeKey: string,
  integrationId: string,
  routes: Awaited<ReturnType<typeof listRoutes>>,
) {
  const target = `integrations/${integrationId}`
  const found = routes.find((route) => route.RouteKey === routeKey)

  if (!found) {
    const created = await apigw.send(
      new CreateRouteCommand({
        ApiId: apiId,
        RouteKey: routeKey,
        Target: target,
      }),
    )
    return created
  }

  if (found.Target !== target && found.RouteId) {
    const updated = await apigw.send(
      new UpdateRouteCommand({
        ApiId: apiId,
        RouteId: found.RouteId,
        Target: target,
      }),
    )
    found.Target = updated.Target
    return updated
  }

  return found
}

async function allowApiGatewayInvoke(
  lambda: LambdaClient,
  appName: string,
  apiId: string,
  routeKey: string,
  functionArn: string,
) {
  const statementId = `${appName}-${apiId}-${routeKey}`.replace(/[^A-Za-z0-9-_]/g, '-')
  // Derive region + account from the function ARN so the permission matches the REAL API on
  // any account/region — a hardcoded us-east-1:000000000000 only matches Floci, so on real
  // AWS API Gateway can't invoke the Lambda (→ 500, no invocation log).
  // arn:aws:lambda:<region>:<account>:function:<name>
  const [, , , region, account] = functionArn.split(':')
  const sourceArn = `arn:aws:execute-api:${region}:${account}:${apiId}/*/*`

  try {
    await lambda.send(
      new AddPermissionCommand({
        FunctionName: functionArn,
        StatementId: statementId,
        Action: 'lambda:InvokeFunction',
        Principal: 'apigateway.amazonaws.com',
        SourceArn: sourceArn,
      }),
    )
  } catch (e: any) {
    if (e?.name !== 'ResourceConflictException') throw e
  }
}

async function listIntegrations(apigw: ApiGatewayV2Client, apiId: string) {
  const integrations = await apigw.send(new GetIntegrationsCommand({ ApiId: apiId }))
  return integrations.Items ?? []
}

async function listRoutes(apigw: ApiGatewayV2Client, apiId: string) {
  const routes = await apigw.send(new GetRoutesCommand({ ApiId: apiId }))
  return routes.Items ?? []
}

function toRouteKey(method: string | undefined, path: string) {
  return `${(method ?? 'ANY').toUpperCase()} ${path}`
}

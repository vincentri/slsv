import {
  ApiGatewayV2Client,
  CreateApiCommand,
  CreateIntegrationCommand,
  CreateRouteCommand,
  CreateStageCommand,
  GetApisCommand,
  GetIntegrationsCommand,
  GetRoutesCommand,
  GetStagesCommand,
  UpdateIntegrationCommand,
  UpdateRouteCommand,
} from '@aws-sdk/client-apigatewayv2'
import { AddPermissionCommand, LambdaClient } from '@aws-sdk/client-lambda'
import type { AppConfig } from '../../config.js'
import type { AwsFnOutput } from './functions.js'

const FLOCI_ENDPOINT = 'http://localhost:4566'

export async function ensureApiGateway(
  apigw: ApiGatewayV2Client,
  lambda: LambdaClient,
  functions: NonNullable<AppConfig['functions']>,
  outputs: Record<string, AwsFnOutput>,
  appName: string,
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

  return localApiEndpoint(api.ApiId, api.ApiEndpoint)
}

async function ensureHttpApi(apigw: ApiGatewayV2Client, appName: string) {
  const existing = await apigw.send(new GetApisCommand({}))
  const found = existing.Items?.find((api) => api.Name === appName)
  if (found) return found

  return apigw.send(
    new CreateApiCommand({
      Name: appName,
      ProtocolType: 'HTTP',
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
  const statementId = permissionStatementId(appName, apiId, routeKey)
  const sourceArn = `arn:aws:execute-api:us-east-1:000000000000:${apiId}/*/*`

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
  } catch (e) {
    if (!isAlreadyExists(e)) throw e
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

function permissionStatementId(appName: string, apiId: string, routeKey: string) {
  return `${appName}-${apiId}-${routeKey}`.replace(/[^A-Za-z0-9-_]/g, '-').slice(0, 100)
}

function isAlreadyExists(e: unknown) {
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    (e as { name?: string }).name === 'ResourceConflictException'
  )
}

function localHttpApiUrl(apiId: string) {
  return `${FLOCI_ENDPOINT}/execute-api/${apiId}/$default`
}

function localApiEndpoint(apiId: string, endpoint: string | undefined) {
  if (endpoint?.includes('localhost')) return endpoint
  return localHttpApiUrl(apiId)
}

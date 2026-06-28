import {
  APIGatewayClient,
  CreateRestApiCommand,
  GetRestApisCommand,
  GetResourcesCommand,
  CreateResourceCommand,
  PutMethodCommand,
  PutIntegrationCommand,
  CreateDeploymentCommand,
} from '@aws-sdk/client-api-gateway'
import { LambdaClient, AddPermissionCommand } from '@aws-sdk/client-lambda'
import type { AppConfig } from '../../config.js'

export type AwsFnOutput = { arn: string; name: string }

export async function ensureApiGateway(
  apigw: APIGatewayClient,
  lambda: LambdaClient,
  functions: AppConfig['functions'],
  fnOutputs: Record<string, AwsFnOutput>,
  appName: string,
): Promise<string> {
  const region = 'us-east-1'

  const apis = await apigw.send(new GetRestApisCommand({}))
  let apiId = apis.items?.find((a) => a.name === appName)?.id

  if (!apiId) {
    const api = await apigw.send(new CreateRestApiCommand({ name: appName }))
    apiId = api.id!
  }

  const resources = await apigw.send(new GetResourcesCommand({ restApiId: apiId }))
  const rootId = resources.items?.find((r) => r.path === '/')!.id!
  // Seed with ALL existing resources so re-deploy is idempotent (no duplicate CreateResource)
  const resourceMap: Record<string, string> = {}
  for (const r of resources.items ?? []) {
    if (r.path && r.id) resourceMap[r.path] = r.id
  }

  for (const [fnName, fn] of Object.entries(functions ?? {})) {
    if (!fn.http) continue
    const fnOutput = fnOutputs[fnName]

    for (const route of fn.http) {
      const parts = route.path.split('/').filter(Boolean)
      let parentId = rootId
      let currentPath = ''

      for (const part of parts) {
        currentPath += `/${part}`
        if (!resourceMap[currentPath]) {
          const res = await apigw.send(
            new CreateResourceCommand({
              restApiId: apiId,
              parentId,
              pathPart: part,
            }),
          )
          resourceMap[currentPath] = res.id!
        }
        parentId = resourceMap[currentPath]
      }

      const resourceId = parts.length ? resourceMap[currentPath] : rootId

      try {
        await apigw.send(
          new PutMethodCommand({
            restApiId: apiId,
            resourceId,
            httpMethod: route.method,
            authorizationType: 'NONE',
          }),
        )
      } catch (e: any) {
        if (e.name !== 'ConflictException') throw e
      }

      const uri = `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${fnOutput.arn}/invocations`

      try {
        await apigw.send(
          new PutIntegrationCommand({
            restApiId: apiId,
            resourceId,
            httpMethod: route.method,
            type: 'AWS_PROXY',
            integrationHttpMethod: 'POST',
            uri,
          }),
        )
      } catch (e: any) {
        if (e.name !== 'ConflictException') throw e
      }

      try {
        await lambda.send(
          new AddPermissionCommand({
            FunctionName: fnOutput.name,
            StatementId: `apigw-${apiId}-${fnOutput.name}-${route.method}`.replace(
              /[^a-zA-Z0-9-_]/g,
              '-',
            ),
            Action: 'lambda:InvokeFunction',
            Principal: 'apigateway.amazonaws.com',
            SourceArn: `arn:aws:execute-api:${region}:000000000000:${apiId}/*/*`,
          }),
        )
      } catch (e: any) {
        if (e.name !== 'ResourceConflictException') throw e
      }
    }
  }

  await apigw.send(new CreateDeploymentCommand({ restApiId: apiId, stageName: 'local' }))

  return `http://localhost:4566/restapis/${apiId}/local/_user_request_`
}

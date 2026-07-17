import {
  ApiGatewayV2Client,
  CreateApiCommand,
  UpdateApiCommand,
  DeleteCorsConfigurationCommand,
  CreateIntegrationCommand,
  CreateRouteCommand,
  CreateStageCommand,
  GetApisCommand,
  GetIntegrationsCommand,
  GetRoutesCommand,
  GetStagesCommand,
  UpdateRouteCommand,
  DeleteApiCommand,
  CreateAuthorizerCommand,
  GetAuthorizersCommand,
  DeleteAuthorizerCommand,
} from "@aws-sdk/client-apigatewayv2";
import { AddPermissionCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { AppConfig } from "../../config.js";
import { ConfigError } from "../../config.js";
import type { AwsFnOutput } from "./functions.js";
import { arnRegionAccount } from "./eventbridge.js";

const FLOCI_ENDPOINT = "http://localhost:4566";

// Delete the HTTP API for this app+stage (the API is named `appName`). Deleting the API
// cascades its routes, integrations and stages. No-op if it doesn't exist.
export async function deleteHttpApi(apigw: ApiGatewayV2Client, appName: string): Promise<void> {
  const apis = await apigw.send(new GetApisCommand({}));
  const api = apis.Items?.find((a) => a.Name === appName);
  if (api?.ApiId) await apigw.send(new DeleteApiCommand({ ApiId: api.ApiId }));
}

type AuthConfig = NonNullable<AppConfig["api"]>["auth"];
type CorsConfig = NonNullable<AppConfig["api"]>["cors"];

export async function ensureApiGateway(
  apigw: ApiGatewayV2Client,
  lambda: LambdaClient,
  functions: NonNullable<AppConfig["functions"]>,
  outputs: Record<string, AwsFnOutput>,
  appName: string,
  isLocal: boolean,
  cors?: CorsConfig,
  auth?: AuthConfig,
): Promise<string | undefined> {
  const httpFunctions = Object.entries(functions).filter(([, fn]) => fn.http?.length);
  if (httpFunctions.length === 0) return undefined;

  const api = await ensureHttpApi(apigw, appName, cors);
  if (!api.ApiId) throw new Error(`API Gateway HTTP API for ${appName} is missing an id`);

  await ensureStage(apigw, api.ApiId);

  // Whole-API default: when `api.auth` is set, protect every route with the Lambda authorizer
  // (a route opts out with `auth: false`). No auth → routes fall back to NONE below, then the
  // now-unreferenced authorizer is pruned after the loop (AWS refuses to delete an in-use one).
  const authorizerId = auth
    ? await ensureAuthorizer(apigw, lambda, api.ApiId, appName, auth, outputs)
    : undefined;

  const integrations = await listIntegrations(apigw, api.ApiId);
  const routes = await listRoutes(apigw, api.ApiId);

  for (const [name, fn] of httpFunctions) {
    const fnOutput = outputs[name];
    if (!fnOutput) continue;

    const integration = await ensureLambdaIntegration(apigw, api.ApiId, fnOutput.arn, integrations);

    if (!integration.IntegrationId) {
      throw new Error(`API Gateway integration for ${fnOutput.arn} is missing an id`);
    }

    for (const route of fn.http ?? []) {
      const routeKey = toRouteKey(route.method, route.path);
      const routeAuthorizerId = authorizerId && route.auth !== false ? authorizerId : undefined;
      await ensureRoute(apigw, api.ApiId, routeKey, integration.IntegrationId, routes, routeAuthorizerId);
      await allowApiGatewayInvoke(lambda, appName, api.ApiId, routeKey, fnOutput.arn);
    }
  }

  // auth dropped from the yml → routes are now NONE, so prune the leftover authorizer.
  if (!auth) await deleteAuthorizer(apigw, api.ApiId, appName);

  // Floci and real AWS both return `<id>.execute-api.<region>.amazonaws.com` ApiEndpoints,
  // so the endpoint string can't tell them apart — use the target. Real AWS: the ApiEndpoint
  // works directly. Floci: it doesn't resolve from the host, so use the Floci path.
  if (!isLocal) return api.ApiEndpoint;
  return `${FLOCI_ENDPOINT}/execute-api/${api.ApiId}/$default`;
}

// Normalize `api.cors` (false | origins array | full object | undefined) into an API Gateway
// CorsConfiguration. Default `*` (permissive — the S3-hosted frontend is a different origin).
// `false` → null: no gateway CORS at all (handler owns it). `credentials: true` is incompatible
// with `*` on origin/methods/headers (browsers reject it), so it forces explicit origins and
// swaps `*` methods/headers for concrete defaults.
function buildCors(cors?: CorsConfig) {
  if (cors === false) return null;
  if (!cors) return { AllowOrigins: ["*"], AllowMethods: ["*"], AllowHeaders: ["*"] };
  if (Array.isArray(cors)) return { AllowOrigins: cors, AllowMethods: ["*"], AllowHeaders: ["*"] };

  const credentials = cors.credentials ?? false;
  if (credentials && cors.origins.includes("*")) {
    throw new ConfigError(
      "api.cors.credentials requires explicit origins — browsers reject 'Access-Control-Allow-Origin: *' on credentialed requests. List your site(s) in api.cors.origins.",
    );
  }
  return {
    AllowOrigins: cors.origins,
    AllowMethods: cors.methods ?? (credentials ? ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] : ["*"]),
    AllowHeaders: cors.headers ?? (credentials ? ["content-type", "authorization"] : ["*"]),
    ...(cors.exposeHeaders ? { ExposeHeaders: cors.exposeHeaders } : {}),
    // Only set when true — `AllowCredentials: false` + no field are equivalent, keeps the diff clean.
    ...(credentials ? { AllowCredentials: true } : {}),
  };
}

async function ensureHttpApi(apigw: ApiGatewayV2Client, appName: string, corsConfig?: CorsConfig) {
  const cors = buildCors(corsConfig);

  const existing = await apigw.send(new GetApisCommand({}));
  const found = existing.Items?.find((api) => api.Name === appName);
  if (found) {
    // Converge CORS every deploy. `cors === null` means disabled (`api.cors: false`) — that
    // needs DeleteCorsConfiguration: an empty CorsConfiguration {} does NOT clear it, it sets
    // "enabled with nothing allowed" and the gateway then strips the handler's CORS headers.
    if (cors) {
      await apigw.send(new UpdateApiCommand({ ApiId: found.ApiId, CorsConfiguration: cors }));
    } else {
      await apigw.send(new DeleteCorsConfigurationCommand({ ApiId: found.ApiId }));
    }
    return found;
  }

  return apigw.send(
    new CreateApiCommand({
      Name: appName,
      ProtocolType: "HTTP",
      // Omit entirely when disabled so the API is created without CORS.
      ...(cors ? { CorsConfiguration: cors } : {}),
    }),
  );
}

async function ensureStage(apigw: ApiGatewayV2Client, apiId: string) {
  const existing = await apigw.send(new GetStagesCommand({ ApiId: apiId }));
  const found = existing.Items?.find((stage) => stage.StageName === "$default");
  if (found) return found;

  return apigw.send(
    new CreateStageCommand({
      ApiId: apiId,
      StageName: "$default",
      AutoDeploy: true,
    }),
  );
}

async function ensureLambdaIntegration(
  apigw: ApiGatewayV2Client,
  apiId: string,
  functionArn: string,
  integrations: Awaited<ReturnType<typeof listIntegrations>>,
) {
  const found = integrations.find((integration) => integration.IntegrationUri === functionArn);
  if (found) return found;

  return apigw.send(
    new CreateIntegrationCommand({
      ApiId: apiId,
      IntegrationType: "AWS_PROXY",
      IntegrationMethod: "POST",
      IntegrationUri: functionArn,
      PayloadFormatVersion: "2.0",
    }),
  );
}

async function ensureRoute(
  apigw: ApiGatewayV2Client,
  apiId: string,
  routeKey: string,
  integrationId: string,
  routes: Awaited<ReturnType<typeof listRoutes>>,
  authorizerId?: string,
) {
  const target = `integrations/${integrationId}`;
  // authorizerId set → protect (CUSTOM); unset → public (NONE). Converged both ways so adding
  // OR removing auth takes effect on redeploy.
  const authType = authorizerId ? "CUSTOM" : "NONE";
  const found = routes.find((route) => route.RouteKey === routeKey);

  if (!found) {
    const created = await apigw.send(
      new CreateRouteCommand({
        ApiId: apiId,
        RouteKey: routeKey,
        Target: target,
        AuthorizationType: authType,
        AuthorizerId: authorizerId,
      }),
    );
    return created;
  }

  const drift =
    found.Target !== target ||
    (found.AuthorizationType ?? "NONE") !== authType ||
    (found.AuthorizerId ?? undefined) !== authorizerId;
  if (drift && found.RouteId) {
    const updated = await apigw.send(
      new UpdateRouteCommand({
        ApiId: apiId,
        RouteId: found.RouteId,
        Target: target,
        AuthorizationType: authType,
        // Clearing an authorizer needs an explicit empty string; AuthorizerId: undefined is ignored.
        AuthorizerId: authorizerId ?? "",
      }),
    );
    found.Target = updated.Target;
    found.AuthorizationType = updated.AuthorizationType;
    found.AuthorizerId = updated.AuthorizerId;
    return updated;
  }

  return found;
}

async function allowApiGatewayInvoke(
  lambda: LambdaClient,
  appName: string,
  apiId: string,
  routeKey: string,
  functionArn: string,
) {
  const statementId = `${appName}-${apiId}-${routeKey}`.replace(/[^A-Za-z0-9-_]/g, "-");
  // Derive region + account from the function ARN so the permission matches the REAL API on
  // any account/region — a hardcoded us-east-1:000000000000 only matches Floci, so on real
  // AWS API Gateway can't invoke the Lambda (→ 500, no invocation log).
  const { region, account } = arnRegionAccount(functionArn);
  const sourceArn = `arn:aws:execute-api:${region}:${account}:${apiId}/*/*`;

  try {
    await lambda.send(
      new AddPermissionCommand({
        FunctionName: functionArn,
        StatementId: statementId,
        Action: "lambda:InvokeFunction",
        Principal: "apigateway.amazonaws.com",
        SourceArn: sourceArn,
      }),
    );
  } catch (e: any) {
    if (e?.name !== "ResourceConflictException") throw e;
  }
}

// Get-or-create the app's Lambda REQUEST authorizer (named `<appName>-authz`) and grant API
// Gateway permission to invoke the authorizer function. Returns the AuthorizerId to attach to
// protected routes. ponytail: create-only — a changed identitySource/ttl on an existing
// authorizer isn't converged (destroy+redeploy, same as the custom domain). Add UpdateAuthorizer
// if that drift matters.
async function ensureAuthorizer(
  apigw: ApiGatewayV2Client,
  lambda: LambdaClient,
  apiId: string,
  appName: string,
  auth: NonNullable<AuthConfig>,
  outputs: Record<string, AwsFnOutput>,
): Promise<string> {
  const fnOutput = outputs[auth.function];
  if (!fnOutput) {
    throw new Error(`api.auth.function "${auth.function}" is not a declared function`);
  }

  const name = `${appName}-authz`;
  const { region, account } = arnRegionAccount(fnOutput.arn);
  const identitySource = auth.identitySource ?? ["$request.header.Authorization"];

  const existing = await apigw.send(new GetAuthorizersCommand({ ApiId: apiId }));
  const found = existing.Items?.find((a) => a.Name === name);
  const authorizerId =
    found?.AuthorizerId ??
    (
      await apigw.send(
        new CreateAuthorizerCommand({
          ApiId: apiId,
          Name: name,
          AuthorizerType: "REQUEST",
          AuthorizerPayloadFormatVersion: "2.0",
          EnableSimpleResponses: true,
          IdentitySource: identitySource,
          AuthorizerResultTtlInSeconds: auth.ttl ?? 300,
          // API Gateway calls the authorizer fn via the same lambda:path invoke URI as an integration.
          AuthorizerUri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${fnOutput.arn}/invocations`,
        }),
      )
    ).AuthorizerId;

  if (!authorizerId) throw new Error(`API Gateway authorizer for ${appName} is missing an id`);

  // Let API Gateway invoke the authorizer fn. Source arn is scoped to this authorizer, mirroring
  // allowApiGatewayInvoke's route scoping.
  const statementId = `${appName}-${apiId}-authz`.replace(/[^A-Za-z0-9-_]/g, "-");
  const sourceArn = `arn:aws:execute-api:${region}:${account}:${apiId}/authorizers/${authorizerId}`;
  try {
    await lambda.send(
      new AddPermissionCommand({
        FunctionName: fnOutput.arn,
        StatementId: statementId,
        Action: "lambda:InvokeFunction",
        Principal: "apigateway.amazonaws.com",
        SourceArn: sourceArn,
      }),
    );
  } catch (e: any) {
    if (e?.name !== "ResourceConflictException") throw e;
  }

  return authorizerId;
}

// Remove the app's authorizer if it exists (auth was dropped from the yml). Routes are set back
// to NONE in the loop above, so the authorizer is safe to delete. No-op if absent.
async function deleteAuthorizer(apigw: ApiGatewayV2Client, apiId: string, appName: string): Promise<void> {
  const name = `${appName}-authz`;
  const existing = await apigw.send(new GetAuthorizersCommand({ ApiId: apiId }));
  const found = existing.Items?.find((a) => a.Name === name);
  if (found?.AuthorizerId) {
    await apigw.send(new DeleteAuthorizerCommand({ ApiId: apiId, AuthorizerId: found.AuthorizerId }));
  }
}

async function listIntegrations(apigw: ApiGatewayV2Client, apiId: string) {
  const integrations = await apigw.send(new GetIntegrationsCommand({ ApiId: apiId }));
  return integrations.Items ?? [];
}

async function listRoutes(apigw: ApiGatewayV2Client, apiId: string) {
  const routes = await apigw.send(new GetRoutesCommand({ ApiId: apiId }));
  return routes.Items ?? [];
}

function toRouteKey(method: string | undefined, path: string) {
  return `${(method ?? "ANY").toUpperCase()} ${path}`;
}

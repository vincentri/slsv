export type LambdaEvent = {
  rawPath?: string;
  path?: string;
  routeKey?: string;
  rawQueryString?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
  pathParameters?: Record<string, string | undefined> | null;
  headers?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
  httpMethod?: string;
  requestContext?: {
    http?: {
      method?: string;
      path?: string;
    };
  };
};

export type ApiRequest<TBody = unknown> = {
  event: LambdaEvent;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  params: Record<string, string>;
  body: TBody | undefined;
  rawBody: string | undefined;
};

export type ApiResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export type ApiHandler<TBody = unknown> = (
  req: ApiRequest<TBody>,
) => ApiResponse | Promise<ApiResponse>;

// Onion-model middleware: call `next()` to continue the chain, or return a response to
// short-circuit (e.g. `return json({ error: 'unauthorized' }, 401)` without calling next).
// Runs only for a matched route — a 404 never enters the chain.
export type Middleware<TBody = unknown> = (
  req: ApiRequest<TBody>,
  next: () => Promise<ApiResponse>,
) => ApiResponse | Promise<ApiResponse>;

export type Route<TBody = unknown> = {
  method?: string;
  path: string;
  handler: ApiHandler<TBody>;
  /** Per-route middleware, run after the router's global chain. */
  middleware?: Middleware<TBody>[];
};

/** Extra per-route options for the method helpers (currently just middleware). */
export type RouteOptions<TBody = unknown> = Pick<Route<TBody>, "middleware">;

// Method helpers: terser than a `{ method, path, handler }` literal, same Route shape so
// router(Route[]) is unchanged. get(path, handler) or get(path, { middleware }, handler).
function route<TBody = unknown>(
  method: string,
  path: string,
  a: ApiHandler<TBody> | RouteOptions<TBody>,
  b?: ApiHandler<TBody>,
): Route<TBody> {
  return b
    ? { method, path, ...(a as RouteOptions<TBody>), handler: b }
    : { method, path, handler: a as ApiHandler<TBody> };
}

export const get = <TBody = unknown>(...args: [string, ApiHandler<TBody> | RouteOptions<TBody>, ApiHandler<TBody>?]) => route<TBody>("GET", ...args);
export const post = <TBody = unknown>(...args: [string, ApiHandler<TBody> | RouteOptions<TBody>, ApiHandler<TBody>?]) => route<TBody>("POST", ...args);
export const put = <TBody = unknown>(...args: [string, ApiHandler<TBody> | RouteOptions<TBody>, ApiHandler<TBody>?]) => route<TBody>("PUT", ...args);
export const patch = <TBody = unknown>(...args: [string, ApiHandler<TBody> | RouteOptions<TBody>, ApiHandler<TBody>?]) => route<TBody>("PATCH", ...args);
export const del = <TBody = unknown>(...args: [string, ApiHandler<TBody> | RouteOptions<TBody>, ApiHandler<TBody>?]) => route<TBody>("DELETE", ...args);

// Prefix every route's path with a basePath, and optionally prepend shared middleware to the
// whole group. Compose feature folders by spreading into router():
//   router([...group('/api/links', linkRoutes), ...group('/api/users', userRoutes)])
// Inside a group, a route uses '/' for the group root and '/{id}' for subpaths.
export function group(prefix: string, routes: Route[], middleware: Middleware[] = []): Route[] {
  return routes.map((r) => ({
    ...r,
    path: (prefix + r.path).replace(/\/$/, "") || "/",
    middleware: middleware.length ? [...middleware, ...(r.middleware ?? [])] : r.middleware,
  }));
}

function parseEvent(event: LambdaEvent): { path: string; method: string } {
  const proxy = event.pathParameters?.proxy;
  // slsv mounts a function under `path: /<prefix>/{proxy+}` — prefer pathParameters.proxy
  // (routes stay prefix-free; explicit per-route http: entries have no proxy → full match).
  // ponytail: keyed on literal `proxy` ({proxy+} convention); a route param named {proxy} collides.
  const path = proxy != null ? "/" + proxy : (event.rawPath ?? event.path ?? event.requestContext?.http?.path ?? "/");
  const method = (event.requestContext?.http?.method ?? event.httpMethod ?? "GET").toUpperCase();
  return { path, method };
}

export function request<TBody = unknown>(
  event: LambdaEvent,
  routePath?: string,
): ApiRequest<TBody> {
  const { path, method } = parseEvent(event);
  const headers = normalizeHeaders(event.headers);
  const rawBody = decodeBody(event);

  return {
    event,
    method,
    path,
    headers,
    query: normalizeQuery(event),
    params: routePath ? (matchPath(routePath, path) ?? {}) : normalizeParams(event),
    body: parseJsonBody<TBody>(rawBody),
    rawBody,
  };
}

export function router(routes: Route[], middleware: Middleware[] = []) {
  return async (event: LambdaEvent): Promise<ApiResponse> => {
    const { path, method } = parseEvent(event);

    for (const route of routes) {
      if (!methodMatches(route.method, method)) continue;
      if (matchPath(route.path, path) === undefined) continue;

      try {
        // ponytail: request() parses the body eagerly, so bad JSON → 400 before middleware
        // runs (auth can't see it). Fine until an endpoint needs auth-before-parse.
        const req = request(event, route.path);
        const chain = route.middleware ? [...middleware, ...route.middleware] : middleware;
        return await compose(chain, req, () => route.handler(req));
      } catch (error) {
        if (error instanceof InvalidJsonError) return json({ error: "Invalid JSON body" }, 400);
        // Surface the real error: log it (dev tail + CloudWatch) and return it in the body.
        // ponytail: detail is always returned, incl. real AWS — leaks internals to callers.
        // Gate on process.env.AWS_ENDPOINT_URL (local-only) if you need prod to stay generic.
        console.error(error);
        const detail = error instanceof Error ? error.message : String(error);
        return json({ error: "Internal Server Error", detail }, 500);
      }
    }

    return json({ error: "not found" }, 404);
  };
}

// Run middleware in onion order, then the handler. Each middleware gets `next` to continue;
// not calling it short-circuits with whatever it returns. Guards against a middleware calling
// next() twice (would run the rest of the chain more than once).
function compose(
  middleware: Middleware[],
  req: ApiRequest,
  final: () => ApiResponse | Promise<ApiResponse>,
): Promise<ApiResponse> {
  let last = -1;
  function dispatch(i: number): Promise<ApiResponse> {
    if (i <= last) return Promise.reject(new Error("next() called multiple times"));
    last = i;
    const mw = middleware[i];
    if (!mw) return Promise.resolve(final());
    return Promise.resolve(mw(req, () => dispatch(i + 1)));
  }
  return dispatch(0);
}

export function json(
  body: unknown,
  statusCode = 200,
  headers: Record<string, string> = {},
): ApiResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

export function redirect(location: string, statusCode = 302): ApiResponse {
  return {
    statusCode,
    headers: {
      location,
    },
    body: "",
  };
}

function normalizeHeaders(headers: LambdaEvent["headers"]) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value ?? ""]),
  );
}

function normalizeQuery(event: LambdaEvent) {
  if (event.queryStringParameters) {
    return Object.fromEntries(
      Object.entries(event.queryStringParameters).map(([key, value]) => [key, value ?? ""]),
    );
  }

  return Object.fromEntries(new URLSearchParams(event.rawQueryString ?? ""));
}

function normalizeParams(event: LambdaEvent) {
  return Object.fromEntries(
    Object.entries(event.pathParameters ?? {}).map(([key, value]) => [key, value ?? ""]),
  );
}

function decodeBody(event: LambdaEvent) {
  if (event.body == null) return undefined;
  if (!event.isBase64Encoded) return event.body;
  return Buffer.from(event.body, "base64").toString("utf8");
}

class InvalidJsonError extends Error {
  constructor() {
    super("Invalid JSON body");
    this.name = "InvalidJsonError";
  }
}

function parseJsonBody<TBody>(rawBody: string | undefined): TBody | undefined {
  if (!rawBody) return undefined;
  try {
    return JSON.parse(rawBody) as TBody;
  } catch {
    throw new InvalidJsonError();
  }
}

function methodMatches(routeMethod: string | undefined, method: string) {
  const expected = (routeMethod ?? "ANY").toUpperCase();
  return expected === "ANY" || expected === method;
}

function matchPath(pattern: string, path: string): Record<string, string> | undefined {
  const patternParts = splitPath(pattern);
  const pathParts = splitPath(path);
  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];

    if (patternPart?.startsWith("{") && patternPart.endsWith("+}")) {
      const name = patternPart.slice(1, -2);
      params[name] = pathParts.slice(i).map(decodeURIComponent).join("/");
      return params;
    }

    if (pathPart === undefined) return undefined;

    if (patternPart?.startsWith("{") && patternPart.endsWith("}")) {
      const name = patternPart.slice(1, -1);
      params[name] = decodeURIComponent(pathPart);
      continue;
    }

    if (patternPart !== pathPart) return undefined;
  }

  if (patternParts.length !== pathParts.length) return undefined;
  return params;
}

function splitPath(path: string) {
  return path.split("/").filter(Boolean);
}

import { build } from "esbuild";
import AdmZip from "adm-zip";
import path from "path";

// ponytail: fallback so esbuild finds @slsv/sdk from CLI's own node_modules
// when the user's project hasn't installed it (before npm publish)
const CLI_NODE_MODULES = [path.resolve(import.meta.dirname, "..", "node_modules")];

// For HTTP functions, wrap the real handler so a module-load crash (e.g. a `gettt` typo →
// ReferenceError at init) or any uncaught throw returns a 500 with the error instead of
// crashing init — which real Lambda reports as Runtime.InitError and Floci surfaces as a
// silent HANG. The user module is `require`d lazily INSIDE the handler (CJS factories run on
// first require, not at bundle top), so its top-level throw lands in our try/catch.
// HTTP-only on purpose: SQS/EventBridge/cron handlers must let a throw propagate (that's how
// retry/DLQ works) — swallowing it into a 200/500 return would break queue semantics.
function httpWrapper(entryAbs: string, exportName: string): string {
  const ENTRY = JSON.stringify(entryAbs);
  const EXPORT = JSON.stringify(exportName);
  return `
let __mod, __err;
function __load() {
  if (__mod || __err) return;
  try { __mod = require(${ENTRY}); } catch (e) { __err = e; }
}
function __fail(err) {
  console.error(err);
  const detail = err instanceof Error ? err.message : String(err);
  return {
    statusCode: 500,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: "Internal Server Error", detail }),
  };
}
exports[${EXPORT}] = async (event, context) => {
  __load();
  if (__err) return __fail(__err);
  try {
    return await __mod[${EXPORT}](event, context);
  } catch (e) {
    return __fail(e);
  }
};
`;
}

export async function bundleHandler(
  handlerPath: string,
  cwd: string,
  isHttp = false,
): Promise<{ zip: Uint8Array; handlerRef: string }> {
  // handlerPath: ./src/api.handler → file=./src/api, export=handler
  const lastDot = handlerPath.lastIndexOf(".");
  const filePart = handlerPath.slice(0, lastDot);
  const exportName = handlerPath.slice(lastDot + 1);

  const entryPoint = path.resolve(cwd, filePart + ".ts");

  const result = await build({
    // HTTP: bundle a wrapper (via stdin) that lazy-loads the real handler in a try/catch.
    // Non-HTTP: bundle the handler directly so throws propagate for retry/DLQ semantics.
    ...(isHttp
      ? {
          stdin: {
            contents: httpWrapper(entryPoint, exportName),
            resolveDir: cwd,
            sourcefile: "handler-wrapper.js",
            loader: "js" as const,
          },
        }
      : { entryPoints: [entryPoint] }),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    write: false,
    // ponytail: bundle everything (incl @aws-sdk). Floci/Lambda base image
    // doesn't ship lib-dynamodb, so don't externalize. Bigger zip, always works.
    // minify halves the bundle (~4.8M → 2.4M) — aws-sdk+drizzle dominate, so the win
    // is real; node20 runs minified JS unchanged and stack traces stay usable via names.
    minify: true,
    keepNames: true,
    sourcemap: false,
    nodePaths: CLI_NODE_MODULES,
  });

  const zip = new AdmZip();
  zip.addFile("handler.js", Buffer.from(result.outputFiles![0].contents));
  return { zip: zip.toBuffer(), handlerRef: `handler.${exportName}` };
}

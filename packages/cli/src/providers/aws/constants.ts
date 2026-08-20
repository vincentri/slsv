export const FLOCI_ENDPOINT = "http://localhost:4566";
export const LAMBDA_LOCAL_ENDPOINT = "http://host.docker.internal:4566";

export function rewriteForLambdaEnv(envs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(envs).map(([k, v]) => [k, v.replaceAll("localhost:4566", "host.docker.internal:4566")]),
  );
}

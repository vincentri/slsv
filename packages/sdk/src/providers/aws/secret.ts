import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// AWS_ENDPOINT_URL (injected by slsv) makes this hit Floci locally and real Secrets
// Manager in prod, with zero code change.
const sm = new SecretsManagerClient({});
const cache = new Map<string, string>();

// Fetch a secret's value by its physical SM id, cached for the container's lifetime.
// ponytail: no TTL — a rotated secret is picked up on the next cold start. Add a TTL +
// refetch only if sub-cold-start rotation is ever required.
export async function getSecret(secretId: string): Promise<string> {
  const hit = cache.get(secretId);
  if (hit !== undefined) return hit;
  const r = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  const value = r.SecretString ?? "";
  cache.set(secretId, value);
  return value;
}

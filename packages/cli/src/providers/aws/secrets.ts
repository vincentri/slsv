import {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'
import { envKey } from '../../env-key.js'
import { asTagArray } from './tags.js'

// Stores each secret's value in Secrets Manager (stage-namespaced so dev/prod don't
// collide) and injects only the SM *id* into functions as SECRET_<NAME>. The value is
// NEVER put in the function env — handlers fetch it at runtime via @slsv/sdk `secret()`.
// `.env.<stage>` is the source of truth: the value is upserted on every deploy.
export async function ensureSecrets(
  sm: SecretsManagerClient,
  secretNames: string[],
  envValues: Record<string, string | undefined>,
  prefix: string,
  tags: Record<string, string>,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}

  for (const name of secretNames) {
    const value = envValues[name]
    if (!value) continue

    const secretId = `${prefix}-${name}`
    try {
      await sm.send(
        new CreateSecretCommand({ Name: secretId, SecretString: value, Tags: asTagArray(tags) }),
      )
    } catch (e: any) {
      if (e.name !== 'ResourceExistsException') throw e
      await sm.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: value }))
    }

    result[envKey('SECRET', name)] = secretId
  }

  return result
}

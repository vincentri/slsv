import {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'

export async function ensureSecrets(
  sm: SecretsManagerClient,
  secretNames: string[],
  envValues: Record<string, string | undefined>,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}

  for (const name of secretNames) {
    const value = envValues[name]
    if (!value) continue

    try {
      const r = await sm.send(new GetSecretValueCommand({ SecretId: name }))
      result[name] = r.SecretString ?? value
    } catch (e: any) {
      if (e.name !== 'ResourceNotFoundException') throw e
      await sm.send(new CreateSecretCommand({ Name: name, SecretString: value }))
      result[name] = value
    }
  }

  return result
}

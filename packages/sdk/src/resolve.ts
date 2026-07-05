// Maps a logical resource name (what the user writes) to the env var slsv injects
// at deploy time. `db('invoices')` reads `process.env.DATABASE_INVOICES`.

export function resolve(
  prefix: 'DATABASE' | 'QUEUE' | 'BUCKET' | 'REDIS' | 'SECRET',
  logicalName: string,
): string {
  const key = `${prefix}_${logicalName.toUpperCase().replace(/-/g, '_')}`
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `slsv: resource "${logicalName}" not found (expected env ${key}). ` +
        `Is it declared in slsv.yml and deployed?`,
    )
  }
  return value
}

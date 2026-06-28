// Maps a logical resource name (what the user writes) to the physical resource
// injected as an env var by slsv at deploy time.
//
//   db('invoices')        -> DATABASE_INVOICES
//   queue('emailQueue')   -> QUEUE_EMAILQUEUE
//   storage('receipts')   -> BUCKET_RECEIPTS
//   cache('session')      -> REDIS_SESSION
//
// Same env-var contract holds on every cloud — handler code never changes.

export function resolve(
  prefix: 'DATABASE' | 'QUEUE' | 'BUCKET' | 'REDIS',
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

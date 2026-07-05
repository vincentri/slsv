// Canonical slsv tag set applied to every provisioned resource. The `slsv:` keys go LAST
// so a user's custom tags can never clobber managed-by/app/stage.
export function slsvTags(
  app: string,
  stage: string,
  custom?: Record<string, string>,
): Record<string, string> {
  return {
    ...custom,
    'slsv:managed-by': 'slsv',
    'slsv:app': app,
    'slsv:stage': stage,
  }
}

// Most AWS APIs want [{Key,Value}]; Lambda/SQS want the plain {k:v} map (use the Record directly).
export const asTagArray = (tags: Record<string, string>) =>
  Object.entries(tags).map(([Key, Value]) => ({ Key, Value }))

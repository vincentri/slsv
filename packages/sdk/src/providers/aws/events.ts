import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

const events = new EventBridgeClient({});

/**
 * Publish a domain event onto the default EventBridge bus. Consumers subscribe in their own
 * slsv.yml with `event: { pattern: { source: [...], "detail-type": [...] } }` — including
 * consumers in a DIFFERENT slsv app (same account/bus), which is the cross-app fan-out story.
 * `source` defaults to this app's name (SLSV_APP, injected at deploy).
 */
export async function emit(
  detailType: string,
  detail: unknown = {},
  opts: { source?: string } = {},
): Promise<void> {
  const r = await events.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: opts.source ?? process.env.SLSV_APP ?? "app",
          DetailType: detailType,
          Detail: JSON.stringify(detail),
        },
      ],
    }),
  );
  // PutEvents reports per-entry failure WITHOUT throwing — surface it or events vanish silently.
  if (r.FailedEntryCount) {
    const e = r.Entries?.[0];
    throw new Error(`emit('${detailType}') failed: ${e?.ErrorCode} ${e?.ErrorMessage}`);
  }
}

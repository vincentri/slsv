import {
  LambdaClient,
  CreateEventSourceMappingCommand,
  ListEventSourceMappingsCommand,
  DeleteEventSourceMappingCommand,
  UpdateEventSourceMappingCommand,
} from "@aws-sdk/client-lambda";
import type { AppConfig } from "../../config.js";
import type { AwsFnOutput } from "./functions.js";
import type { QueueOutput } from "./sqs.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function ensureEventSourceMappings(
  lambda: LambdaClient,
  functions: AppConfig["functions"],
  fnOutputs: Record<string, AwsFnOutput>,
  queueOutputs: Record<string, QueueOutput>,
) {
  for (const [fnName, fn] of Object.entries(functions ?? {})) {
    if (!fn.queue) continue;
    const fnOutput = fnOutputs[fnName];
    const queue = queueOutputs[fn.queue.name];
    if (!queue) throw new Error(`Queue "${fn.queue.name}" not found in queues config`);

    // AWS quirk: recreate a queue (delete + create, same name → same ARN) and any existing
    // event source mapping goes silently dead — still Enabled, zero errors, never polls again.
    // A blind get-or-create keeps that dead mapping forever. So: a mapping last modified BEFORE
    // the queue was created predates a queue recreate → delete it and wire a fresh one.
    const existing = await lambda.send(
      new ListEventSourceMappingsCommand({
        FunctionName: fnOutput.name,
        EventSourceArn: queue.arn,
      }),
    );
    let live = null;
    for (const m of existing.EventSourceMappings ?? []) {
      const stale =
        queue.createdAt && m.LastModified && m.LastModified.getTime() / 1000 < queue.createdAt;
      if (stale && m.UUID) {
        console.log(`    ↻ event source mapping for ${fnOutput.name} predates queue recreate — rewiring`);
        await lambda.send(new DeleteEventSourceMappingCommand({ UUID: m.UUID }));
      } else {
        live = m;
      }
    }

    const desired = fn.queue.maxConcurrency;
    if (live) {
      // Converge ScalingConfig on the live mapping (create-only left maxConcurrency unapplied).
      if ((live.ScalingConfig?.MaximumConcurrency ?? undefined) !== desired && live.UUID) {
        await lambda.send(
          new UpdateEventSourceMappingCommand({
            UUID: live.UUID,
            // Empty ScalingConfig clears MaximumConcurrency (dropping maxConcurrency from the yml).
            ScalingConfig: desired ? { MaximumConcurrency: desired } : {},
          }),
        );
      }
      continue;
    }

    // Deleting is async (state "Deleting" still conflicts) — retry create until it lands.
    for (let i = 0; ; i++) {
      try {
        await lambda.send(
          new CreateEventSourceMappingCommand({
            FunctionName: fnOutput.name,
            EventSourceArn: queue.arn,
            BatchSize: 1,
            ...(desired && { ScalingConfig: { MaximumConcurrency: desired } }),
          }),
        );
        break;
      } catch (e: any) {
        if (e.name !== "ResourceConflictException" || i >= 12) throw e;
        await sleep(5000);
      }
    }
  }
}

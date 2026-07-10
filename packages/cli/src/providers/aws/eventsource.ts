import { LambdaClient, CreateEventSourceMappingCommand } from "@aws-sdk/client-lambda";
import type { AppConfig } from "../../config.js";
import type { AwsFnOutput } from "./functions.js";
import type { QueueOutput } from "./sqs.js";

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

    try {
      await lambda.send(
        new CreateEventSourceMappingCommand({
          FunctionName: fnOutput.name,
          EventSourceArn: queue.arn,
          BatchSize: 1,
        }),
      );
    } catch (e: any) {
      if (e.name !== "ResourceConflictException") throw e;
    }
  }
}

import {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import type { AppConfig } from "../../config.js";
import { dlqName } from "../../config.js";

export type QueueOutput = { url: string; arn: string };

const DEFAULT_MAX_RECEIVE_COUNT = 5;

export async function ensureQueues(
  sqs: SQSClient,
  queues: AppConfig["queues"],
  appName: string,
  tags: Record<string, string>,
): Promise<Record<string, QueueOutput>> {
  const outputs: Record<string, QueueOutput> = {};
  if (!queues) return outputs;

  // ponytail: FIFO + RedrivePolicy are AWS-side knobs; floci ignores them.
  // Resolve every DLQ name first and auto-provision any not declared as a queue, so users
  // never write a DLQ entry separately. Auto-provisioned DLQs inherit the source's `fifo`
  // (AWS requires main + DLQ to match on FIFO). Then create all, then attach RedrivePolicy.
  type Q = { fifo: boolean; visibilityTimeout?: number; maxReceiveCount?: number; dlqName?: string };
  const working: Record<string, Q> = {};
  for (const [name, cfg] of Object.entries(queues)) {
    working[name] = {
      fifo: !!cfg.fifo,
      visibilityTimeout: cfg.visibilityTimeout,
      maxReceiveCount: cfg.maxReceiveCount,
      dlqName: dlqName(name, cfg.dlq),
    };
  }
  // Inject auto-provisioned DLQs that weren't explicitly declared.
  for (const [name, q] of Object.entries(working)) {
    if (q.dlqName && !working[q.dlqName]) working[q.dlqName] = { fifo: q.fifo };
  }

  type Created = QueueOutput & Q;
  const created: Record<string, Created> = {};

  for (const [name, q] of Object.entries(working)) {
    const queueName = `${appName}-${name}${q.fifo ? ".fifo" : ""}`;
    const attrs: Record<string, string> = {};
    if (q.fifo) {
      attrs.FifoQueue = "true";
      attrs.ContentBasedDeduplication = "true";
    }
    if (q.visibilityTimeout !== undefined) {
      attrs.VisibilityTimeout = String(q.visibilityTimeout);
    }

    // ponytail: CreateQueue is idempotent on same name + attributes — no GetQueueUrl needed
    const r = await sqs.send(
      new CreateQueueCommand({ QueueName: queueName, Attributes: attrs, tags }),
    );
    const queueUrl = r.QueueUrl!;

    const a = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ["QueueArn"],
      }),
    );
    const arn = a.Attributes!.QueueArn!;

    created[name] = { url: queueUrl, arn, ...q };
  }

  // Pass 2: attach RedrivePolicy now that every queue (incl. DLQ targets) exists.
  for (const [name, q] of Object.entries(created)) {
    if (!q.dlqName) continue;
    const dlq = created[q.dlqName];
    if (!dlq) throw new Error(`queues.${name}.dlq "${q.dlqName}" not found in queues config`);
    if (q.fifo !== dlq.fifo)
      throw new Error(`queues.${name}: FIFO queue cannot use non-FIFO DLQ "${q.dlqName}" (AWS rule)`);
    await sqs.send(
      new SetQueueAttributesCommand({
        QueueUrl: q.url,
        Attributes: {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: dlq.arn,
            maxReceiveCount: String(q.maxReceiveCount ?? DEFAULT_MAX_RECEIVE_COUNT),
          }),
        },
      }),
    );
  }

  for (const [name, q] of Object.entries(created)) {
    outputs[name] = { url: q.url, arn: q.arn };
  }
  return outputs;
}

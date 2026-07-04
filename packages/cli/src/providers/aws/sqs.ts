import {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs'
import type { AppConfig } from '../../config.js'

export type QueueOutput = { url: string; arn: string }

const MAX_RECEIVE_COUNT = '5'

export async function ensureQueues(
  sqs: SQSClient,
  queues: AppConfig['queues'],
  appName: string,
): Promise<Record<string, QueueOutput>> {
  const outputs: Record<string, QueueOutput> = {}
  if (!queues) return outputs

  // ponytail: FIFO + RedrivePolicy are AWS-side knobs; floci ignores them.
  // Two passes: create all first (DLQ target must exist before RedrivePolicy attaches).
  type Created = QueueOutput & { fifo: boolean; dlq?: string }
  const created: Record<string, Created> = {}

  for (const [name, cfg] of Object.entries(queues)) {
    const queueName = `${appName}-${name}${cfg.fifo ? '.fifo' : ''}`
    const attrs: Record<string, string> = {}
    if (cfg.fifo) {
      attrs.FifoQueue = 'true'
      attrs.ContentBasedDeduplication = 'true'
    }
    if (cfg.visibilityTimeout !== undefined) {
      attrs.VisibilityTimeout = String(cfg.visibilityTimeout)
    }

    // ponytail: CreateQueue is idempotent on same name + attributes — no GetQueueUrl needed
    const r = await sqs.send(
      new CreateQueueCommand({ QueueName: queueName, Attributes: attrs }),
    )
    const queueUrl = r.QueueUrl!

    const a = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['QueueArn'],
      }),
    )
    const arn = a.Attributes!.QueueArn!

    created[name] = { url: queueUrl, arn, fifo: !!cfg.fifo, dlq: cfg.dlq }
  }

  // Pass 2: attach RedrivePolicy now that every queue (incl. DLQ targets) exists.
  for (const [name, q] of Object.entries(created)) {
    if (!q.dlq) continue
    const dlq = created[q.dlq]
    if (!dlq) throw new Error(`queues.${name}.dlq "${q.dlq}" not found in queues config`)
    if (q.fifo !== dlq.fifo)
      throw new Error(
        `queues.${name}: FIFO queue cannot use non-FIFO DLQ "${q.dlq}" (AWS rule)`,
      )
    await sqs.send(
      new SetQueueAttributesCommand({
        QueueUrl: q.url,
        Attributes: {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: dlq.arn,
            maxReceiveCount: MAX_RECEIVE_COUNT,
          }),
        },
      }),
    )
  }

  for (const [name, q] of Object.entries(created)) {
    outputs[name] = { url: q.url, arn: q.arn }
  }
  return outputs
}

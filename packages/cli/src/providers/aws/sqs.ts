import { SQSClient, CreateQueueCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import type { AppConfig } from '../../config.js'

export type QueueOutput = { url: string; arn: string }

export async function ensureQueues(
  sqs: SQSClient,
  queues: AppConfig['queues'],
  appName: string,
): Promise<Record<string, QueueOutput>> {
  const outputs: Record<string, QueueOutput> = {}
  if (!queues) return outputs

  for (const name of Object.keys(queues)) {
    // ponytail: CreateQueue is idempotent on same name — no GetQueueUrl needed
    const queueName = `${appName}-${name}`
    const r = await sqs.send(new CreateQueueCommand({ QueueName: queueName }))
    const queueUrl = r.QueueUrl!

    const attrs = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['QueueArn'],
      }),
    )

    outputs[name] = { url: queueUrl, arn: attrs.Attributes!.QueueArn! }
  }

  return outputs
}

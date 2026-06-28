import {
  SQSClient,
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs'
import type { QueueClient, ReceivedMessage } from '../../types.js'

const sqs = new SQSClient({})

export function makeQueue(queueUrl: string): QueueClient {
  return {
    async send(body: any) {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: typeof body === 'string' ? body : JSON.stringify(body),
        }),
      )
    },

    async sendBatch(bodies: any[]) {
      for (let i = 0; i < bodies.length; i += 10) {
        const chunk = bodies.slice(i, i + 10)
        await sqs.send(
          new SendMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: chunk.map((b, idx) => ({
              Id: String(i + idx),
              MessageBody: typeof b === 'string' ? b : JSON.stringify(b),
            })),
          }),
        )
      }
    },

    async receive(opts = {}): Promise<ReceivedMessage[]> {
      const r = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: opts.max ?? 1,
          WaitTimeSeconds: opts.waitSeconds ?? 0,
        }),
      )
      return (r.Messages ?? []).map((m) => ({
        body: tryParse(m.Body),
        receiptHandle: m.ReceiptHandle!,
      }))
    },

    async delete(receiptHandle: string) {
      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: receiptHandle,
        }),
      )
    },
  }
}

function tryParse(s?: string): any {
  if (s == null) return s
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

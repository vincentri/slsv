import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock is hoisted above normal consts, so the mocked send must be too (vi.hoisted).
const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(() => ({ send })),
  SendMessageCommand: vi.fn((input) => ({ input })),
  SendMessageBatchCommand: vi.fn((input) => ({ input })),
  ReceiveMessageCommand: vi.fn((input) => ({ input })),
  DeleteMessageCommand: vi.fn((input) => ({ input })),
}))

import { makeQueue } from './queue.js'

describe('makeQueue send', () => {
  beforeEach(() => {
    send.mockReset()
    send.mockResolvedValue({})
  })

  it('omits DelaySeconds when not given', async () => {
    await makeQueue('url').send({ a: 1 })
    const input = send.mock.calls[0][0].input
    expect(input.MessageBody).toBe('{"a":1}')
    expect('DelaySeconds' in input).toBe(false)
  })

  it('sets DelaySeconds when given', async () => {
    await makeQueue('url').send({ a: 1 }, { delaySeconds: 5 })
    expect(send.mock.calls[0][0].input.DelaySeconds).toBe(5)
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { resolve } from '../src/resolve.js'

describe('resolve', () => {
  afterEach(() => {
    delete process.env.DATABASE_INVOICES
    delete process.env.QUEUE_EMAIL_QUEUE
  })

  it('maps logical name to injected env var', () => {
    process.env.DATABASE_INVOICES = 'invoice-app-invoices'
    expect(resolve('DATABASE', 'invoices')).toBe('invoice-app-invoices')
  })

  it('uppercases and replaces dashes', () => {
    process.env.QUEUE_EMAIL_QUEUE = 'http://localhost:4566/q'
    expect(resolve('QUEUE', 'email-queue')).toBe('http://localhost:4566/q')
  })

  it('throws a helpful error when the resource is not deployed', () => {
    expect(() => resolve('BUCKET', 'missing')).toThrow(/BUCKET_MISSING/)
  })
})

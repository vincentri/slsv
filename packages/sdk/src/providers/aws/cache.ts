import Redis from 'ioredis'
import type { CacheClient } from '../../types.js'

// ponytail: one ioredis client per URL, shared across calls in the same Lambda invocation
const clients = new Map<string, Redis>()
const client = (url: string) => {
  if (!clients.has(url)) clients.set(url, new Redis(url, { lazyConnect: true }))
  return clients.get(url)!
}

export function makeCache(redisUrl: string): CacheClient {
  return {
    async get(key) {
      return (await client(redisUrl).get(key)) ?? undefined
    },
    async set(key, value, opts) {
      opts?.ttl
        ? await client(redisUrl).set(key, value, 'EX', opts.ttl)
        : await client(redisUrl).set(key, value)
    },
    async del(key) {
      await client(redisUrl).del(key)
    },
    async incr(key) {
      return client(redisUrl).incr(key)
    },
    async exists(key) {
      return (await client(redisUrl).exists(key)) > 0
    },
  }
}

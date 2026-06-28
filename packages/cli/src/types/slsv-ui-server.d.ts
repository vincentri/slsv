declare module '@slsv/ui/server' {
  export type Account = {
    name: string
    profile?: string
    region?: string
    endpoint?: string
    caches?: { name: string; url: string }[]
    sqlDatabases?: { name: string; type: string; url: string }[]
    topology?: {
      routes?: { method: string; path: string; functionName: string; handler?: string }[]
      webhooks?: { method: string; path: string; functionName: string; handler?: string }[]
      cronJobs?: { name: string; functionName: string; schedule: string; handler?: string }[]
      queueConsumers?: { queueName: string; functionName: string; handler?: string }[]
      frontend?: { src?: string; build?: string; devUrl?: string }
      relationships?: {
        fromKind: string
        from: string
        toKind: string
        to: string
        label: string
      }[]
    }
  }

  export function startServer(opts: { accounts: Account[]; port?: number }): void
}

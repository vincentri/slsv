import { readFileSync } from 'fs'
import { parse } from 'yaml'
import { z } from 'zod'

// An account = a connection target. profile → AWS SSO/INI; endpoint → custom base URL
// (MiniStack/any emulator). caches → optional Redis URLs (no AWS discovery for those).
const TopologyRoute = z.object({
  method: z.string(),
  path: z.string(),
  functionName: z.string(),
  handler: z.string().optional(),
})

const AppTopology = z.object({
  routes: z.array(TopologyRoute).optional(),
  webhooks: z.array(TopologyRoute).optional(),
  cronJobs: z
    .array(
      z.object({
        name: z.string(),
        functionName: z.string(),
        schedule: z.string(),
        handler: z.string().optional(),
      }),
    )
    .optional(),
  queueConsumers: z
    .array(
      z.object({
        queueName: z.string(),
        functionName: z.string(),
        handler: z.string().optional(),
      }),
    )
    .optional(),
  frontend: z
    .object({
      src: z.string().optional(),
      build: z.string().optional(),
      devUrl: z.string().optional(),
    })
    .optional(),
  relationships: z
    .array(
      z.object({
        fromKind: z.string(),
        from: z.string(),
        toKind: z.string(),
        to: z.string(),
        label: z.string(),
      }),
    )
    .optional(),
})

export const Account = z.object({
  name: z.string(),
  profile: z.string().optional(),
  region: z.string().optional(),
  endpoint: z.string().optional(),
  caches: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  sqlDatabases: z
    .array(z.object({ name: z.string(), type: z.string(), url: z.string() }))
    .optional(),
  topology: AppTopology.optional(),
})
export type Account = z.infer<typeof Account>

export const InspectorConfig = z.object({
  accounts: z.array(Account).min(1, 'inspector.yaml needs at least one account'),
})
export type InspectorConfig = z.infer<typeof InspectorConfig>

export function loadInspectorConfig(filePath: string): InspectorConfig {
  const raw = parse(readFileSync(filePath, 'utf-8'))
  return InspectorConfig.parse(raw)
}

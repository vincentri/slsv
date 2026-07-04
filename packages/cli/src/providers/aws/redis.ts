import {
  CreateReplicationGroupCommand,
  DescribeReplicationGroupsCommand,
  type ElastiCacheClient,
} from '@aws-sdk/client-elasticache'
import { envKey } from '../../env-key.js'
import type { AppConfig } from '../../config.js'

// Each caches.<name> → its own ElastiCache Redis/Valkey replication group (one port each).
// Redis/Valkey MUST use CreateReplicationGroup — CreateCacheCluster only supports memcached.
// Floci emulates ElastiCache: CreateReplicationGroup spins up a real valkey process
// (in its own container) and returns its endpoint (localhost:16379, 16380, ...).
// Target-agnostic: the client endpoint decides where the API call goes.
//
// hostOverride: Floci publishes each cluster's port to the HOST, but Lambda runs
// INSIDE the floci container where `localhost` = the container, not the host.
// So for --target local we pass hostOverride='host.docker.internal' (Docker Desktop
// host gateway) so Lambda can reach the host-published ports. The UI inspector runs
// on the host and uses the raw `localhost` address from DescribeCacheClusters.
// ponytail: Linux needs floci container launched with --add-host=host.docker.internal:host-gateway.
export async function ensureCacheClusters(
  client: ElastiCacheClient,
  caches: AppConfig['caches'],
  appName: string,
  hostOverride?: string,
): Promise<Record<string, string>> {
  const envVars: Record<string, string> = {}
  if (!caches) return envVars
  for (const [name, cfg] of Object.entries(caches)) {
    const clusterId = `${appName}-${name}`
    let endpoint = await describeEndpoint(client, clusterId)
    if (!endpoint) {
      try {
        const r = await client.send(
          new CreateReplicationGroupCommand({
            ReplicationGroupId: clusterId,
            ReplicationGroupDescription: `slsv cache ${name}`,
            Engine: 'valkey',
            // ponytail: knobs apply on --target aws; floci runs single-instance regardless.
            CacheNodeType: cfg.nodeType ?? 'cache.t3.micro',
            NumCacheClusters: cfg.nodes ?? 1,
          }),
        )
        endpoint = extractEndpoint(r.ReplicationGroup)
      } catch (e: any) {
        // Already exists (prior deploy) — describe to recover its endpoint.
        if (e.name !== 'ReplicationGroupAlreadyExistsFault') throw e
        endpoint = await describeEndpoint(client, clusterId)
      }
    }
    if (!endpoint)
      throw new Error(`caches.${name}: could not resolve ElastiCache endpoint for ${clusterId}`)
    const host = hostOverride ?? endpoint.address
    envVars[envKey('REDIS', name)] = `redis://${host}:${endpoint.port}`
  }
  return envVars
}

async function describeEndpoint(client: ElastiCacheClient, clusterId: string) {
  const r = await client
    .send(new DescribeReplicationGroupsCommand({ ReplicationGroupId: clusterId }))
    .catch(() => null)
  return r?.ReplicationGroups?.[0] ? extractEndpoint(r.ReplicationGroups[0]) : undefined
}

function extractEndpoint(rg: any): { address: string; port: number } | undefined {
  // Floci exposes it as ConfigurationEndpoint; real AWS (non-cluster) uses the node
  // group's PrimaryEndpoint. Prefer whichever is present.
  const ep = rg?.ConfigurationEndpoint ?? rg?.NodeGroups?.[0]?.PrimaryEndpoint
  if (!ep?.Address || !ep.Port) return undefined
  return { address: ep.Address, port: ep.Port }
}

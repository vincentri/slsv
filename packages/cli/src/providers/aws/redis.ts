import {
  CreateCacheClusterCommand,
  DescribeCacheClustersCommand,
  type ElastiCacheClient,
} from '@aws-sdk/client-elasticache'
import { envKey } from '../../env-key.js'
import type { AppConfig } from '../../config.js'

// Each caches.<name> → its own ElastiCache Redis cluster (one port per cache).
// Floci emulates ElastiCache: CreateCacheCluster spins up a real redis process
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
          new CreateCacheClusterCommand({
            CacheClusterId: clusterId,
            Engine: 'valkey',
            // ponytail: knobs apply on --target aws; floci runs single-instance regardless.
            CacheNodeType: cfg.nodeType ?? 'cache.t3.micro',
            NumCacheNodes: cfg.nodes ?? 1,
          }),
        )
        endpoint = extractEndpoint(r.CacheCluster)
      } catch (e: any) {
        // Already exists (prior deploy) — describe to recover its endpoint.
        if (e.name !== 'CacheClusterAlreadyExists') throw e
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
    .send(
      new DescribeCacheClustersCommand({
        CacheClusterId: clusterId,
        ShowCacheNodeInfo: true,
      }),
    )
    .catch(() => null)
  return r?.CacheClusters?.[0] ? extractEndpoint(r.CacheClusters[0]) : undefined
}

function extractEndpoint(cluster: any): { address: string; port: number } | undefined {
  const node = cluster?.CacheNodes?.[0]?.Endpoint
  if (!node?.Address || !node.Port) return undefined
  return { address: node.Address, port: node.Port }
}

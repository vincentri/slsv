import {
  CreateReplicationGroupCommand,
  DeleteReplicationGroupCommand,
  DescribeReplicationGroupsCommand,
  type CreateReplicationGroupCommandInput,
  type ElastiCacheClient,
} from '@aws-sdk/client-elasticache'
import { execFileSync } from 'node:child_process'
import { envKey } from '../../env-key.js'
import { asTagArray } from './tags.js'
import type { AppConfig } from '../../config.js'

// Each caches.<name> → its own ElastiCache Redis/Valkey replication group.
// Redis/Valkey MUST use CreateReplicationGroup — CreateCacheCluster only supports memcached.
// Floci emulates ElastiCache: CreateReplicationGroup spins up a real valkey process in its
// own container. Target-agnostic: the client endpoint decides where the API call goes.
//
// Reachability differs by target:
//   --target aws:   real ElastiCache returns a routable ConfigurationEndpoint — use it as-is.
//   --target local: Floci's ElastiCache API returns an UNREACHABLE `localhost:6379` for every
//     group and does NOT publish the valkey port to the host. The only address that reaches
//     the container is its floci-network IP (192.168.107.x), which the API never exposes — so
//     we read it out-of-band via `docker inspect`. See ensureLocalCache.
export async function ensureCacheClusters(
  client: ElastiCacheClient,
  caches: AppConfig['caches'],
  appName: string,
  tags: Record<string, string>,
  local: boolean,
): Promise<Record<string, string>> {
  const envVars: Record<string, string> = {}
  if (!caches) return envVars
  for (const [name, cfg] of Object.entries(caches)) {
    const clusterId = `${appName}-${name}`
    const createInput: CreateReplicationGroupCommandInput = {
      ReplicationGroupId: clusterId,
      ReplicationGroupDescription: `slsv cache ${name}`,
      Engine: 'valkey',
      // ponytail: knobs apply on --target aws; floci runs single-instance regardless.
      // t4g (Graviton): cheaper AND better AZ capacity than t3 (t3.micro often stalls
      // "creating" in capacity-tight regions like ap-southeast-1). Override via nodeType.
      CacheNodeType: cfg.nodeType ?? 'cache.t4g.micro',
      NumCacheClusters: cfg.nodes ?? 1,
      // Real AWS requires this explicitly; false keeps the plain redis:// connection
      // string the SDK builds working (rediss:// TLS would need client changes).
      TransitEncryptionEnabled: false,
      Tags: asTagArray(tags),
    }

    if (local) {
      const ip = await ensureLocalCache(client, clusterId, createInput)
      envVars[envKey('REDIS', name)] = `redis://${ip}:6379`
      continue
    }

    // --- aws path (real ElastiCache; unchanged) ---
    let endpoint = await describeEndpoint(client, clusterId)
    if (!endpoint) {
      try {
        const r = await client.send(new CreateReplicationGroupCommand(createInput))
        endpoint = extractEndpoint(r.ReplicationGroup)
      } catch (e: any) {
        // Already exists (prior deploy) — describe to recover its endpoint.
        if (e.name !== 'ReplicationGroupAlreadyExistsFault') throw e
        endpoint = await describeEndpoint(client, clusterId)
      }
    }
    // Real AWS provisions ElastiCache asynchronously (~5-10 min) — the endpoint isn't
    // populated until the group is `available`. Poll until it is.
    if (!endpoint) {
      console.log(`  waiting for cache ${name} to become available (can take several minutes)...`)
      endpoint = await waitForCacheEndpoint(client, clusterId)
    }
    envVars[envKey('REDIS', name)] = `redis://${endpoint.address}:${endpoint.port}`
  }
  return envVars
}

// ponytail: --target local only. Floci's ElastiCache API is unreliable in two ways this
// bridges: (1) the endpoint it returns (`localhost:6379`) is unreachable from the Lambda
// (which runs inside the floci container), so we read the valkey container's floci-network IP
// via `docker inspect` instead; (2) its group registry desyncs from container lifecycle —
// a group can read `available` with no container behind it (e.g. after a Floci restart). The
// docker inspect doubles as the liveness check: no container IP ⇒ stale group ⇒ delete +
// recreate so Floci respawns the container. Remove this whole branch once Floci returns the
// container IP in ConfigurationEndpoint (like it already does for RDS).
// Ceiling: assumes the Docker CLI is present and Floci names containers `floci-valkey-<id>`.
async function ensureLocalCache(
  client: ElastiCacheClient,
  clusterId: string,
  createInput: CreateReplicationGroupCommandInput,
): Promise<string> {
  const swallowExists = (e: any) => {
    if (e?.name !== 'ReplicationGroupAlreadyExistsFault') throw e
  }

  // Register the group if Floci doesn't know it (idempotent).
  if (!(await describeEndpoint(client, clusterId))) {
    await client.send(new CreateReplicationGroupCommand(createInput)).catch(swallowExists)
  }

  let ip = dockerContainerIp(clusterId)
  if (!ip) {
    // Registry desync: group registered but its valkey container is gone. Force a clean
    // recreate so Floci respawns it.
    await client
      .send(new DeleteReplicationGroupCommand({ ReplicationGroupId: clusterId }))
      .catch(() => {})
    await client.send(new CreateReplicationGroupCommand(createInput)).catch(swallowExists)
    ip = await waitForDockerIp(clusterId)
  }
  return ip
}

// Read the valkey container's IP on Floci's docker network. undefined = container absent
// (never created, or Floci registry is stale) — the caller treats that as "recreate".
function dockerContainerIp(clusterId: string): string | undefined {
  try {
    const out = execFileSync(
      'docker',
      [
        'inspect',
        `floci-valkey-${clusterId}`,
        '--format',
        '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return out.trim().split(/\s+/).find((s) => s.length > 0) || undefined
  } catch {
    return undefined
  }
}

// Poll for the valkey container to come up after a (re)create. Floci spawns it in a few
// seconds locally, so a short poll suffices.
async function waitForDockerIp(clusterId: string, maxMs = 30_000): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const ip = dockerContainerIp(clusterId)
    if (ip) return ip
    await new Promise((r) => setTimeout(r, 1_000))
  }
  throw new Error(
    `caches: valkey container floci-valkey-${clusterId} never came up (${Math.round(
      maxMs / 1000,
    )}s). Is Floci running?`,
  )
}

// Poll DescribeReplicationGroups until the endpoint is populated (group `available`),
// printing status + elapsed each tick so a multi-minute wait shows progress instead of
// looking hung. Throws on timeout with how long it waited. (aws path)
async function waitForCacheEndpoint(
  client: ElastiCacheClient,
  clusterId: string,
  maxMs = 900_000,
): Promise<{ address: string; port: number }> {
  const start = Date.now()
  let lastStatus = ''
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 10_000))
    const r = await client
      .send(new DescribeReplicationGroupsCommand({ ReplicationGroupId: clusterId }))
      .catch(() => null)
    const rg = r?.ReplicationGroups?.[0]
    const status = rg?.Status ?? 'unknown'
    const mins = Math.round((Date.now() - start) / 60_000)
    if (status !== lastStatus) {
      console.log(`    ${clusterId}: ${status} (${mins}m elapsed)`)
      lastStatus = status
    }
    const ep = rg ? extractEndpoint(rg) : undefined
    if (ep) return ep
  }
  throw new Error(
    `caches: ${clusterId} not available after ${Math.round(maxMs / 60_000)}m (last status: ${lastStatus}). ` +
      `ElastiCache can be slow; re-run deploy to resume, or check the AWS console.`,
  )
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

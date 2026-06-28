import { execSync } from 'child_process'
import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'

// slsv-local is the shared Docker network. MiniStack provisions all resources
// (Lambda/Dynamo/SQS/S3/Redis/Postgres/MySQL) via their AWS APIs against port 4566 —
// no sibling containers. The network exists so Lambda, running inside the ministack
// container, can reach the resource containers ministack spins up (ElastiCache/RDS).
const SHARED_NETWORK = 'slsv-local'

const ministackService = () => `  ministack:
    container_name: slsv-ministack
    image: ministackorg/ministack:latest
    ports:
      - "4566:4566"
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock"
      - "ministack-data:/var/lib/ministack"
    networks:
      - ${SHARED_NETWORK}`

const composeFile = () => `services:
${ministackService()}

networks:
  ${SHARED_NETWORK}:
    external: true
    name: ${SHARED_NETWORK}

volumes:
  ministack-data:
`

export async function ministackUp(cwd: string, appName: string) {
  const dir = path.join(cwd, '.slsv')
  mkdirSync(dir, { recursive: true })

  // Ensure shared network exists (idempotent)
  execSync(`docker network create ${SHARED_NETWORK} 2>/dev/null || true`, { stdio: 'pipe' })

  writeFileSync(path.join(dir, 'docker-compose.yml'), composeFile())

  // Always run compose up — idempotent, ensures ministack is running.
  const alreadyHealthy = await isHealthy()
  console.log(
    alreadyHealthy
      ? 'MiniStack already running — ensuring all services up...'
      : 'Starting MiniStack...',
  )
  execSync(`docker compose -f ${path.join(dir, 'docker-compose.yml')} up -d --remove-orphans`, {
    stdio: 'inherit',
  })
  if (!alreadyHealthy) {
    process.stdout.write('Waiting for MiniStack')
    await waitHealthy()
    process.stdout.write('\n')
  }
  console.log('Ready.')
}

export function ministackDown(cwd: string) {
  execSync(`docker compose -f ${path.join(cwd, '.slsv', 'docker-compose.yml')} down`, {
    stdio: 'inherit',
  })
}

// ponytail: GLOBAL reset — nukes ALL apps in the shared MiniStack container, not just this repo. No per-app isolation in MiniStack.
export async function ministackReset() {
  const res = await fetch('http://localhost:4566/_ministack/reset', { method: 'POST' })
  if (!res.ok)
    throw new Error(`MiniStack reset failed: ${res.status} ${await res.text().catch(() => '')}`)
}

async function isHealthy(): Promise<boolean> {
  try {
    await fetch('http://localhost:4566/')
    return true
  } catch {
    return false
  }
}

async function waitHealthy(maxMs = 60_000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    if (await isHealthy()) return
    process.stdout.write('.')
    await sleep(1500)
  }
  throw new Error('MiniStack did not become healthy within 60s')
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

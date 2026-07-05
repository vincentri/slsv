import chokidar from 'chokidar'
import path from 'path'
import { spawn, spawnSync } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import type { AppConfig } from './config.js'
import type { AwsProvider } from './providers/aws/index.js'
import { bundleHandler } from './bundle.js'

// Get the frontend deps ready before starting its dev server (pnpm-only). pnpm gates native
// build scripts (vite's esbuild) and exits non-zero — and pnpm 11 ignores the
// onlyBuiltDependencies allowlist — so we drop a pnpm-workspace.yaml with
// `dangerouslyAllowAllBuilds` (the only setting pnpm 11 honors from a file), then install if
// node_modules is missing. Writing the file also fixes apps scaffolded before it shipped.
function ensureFrontendDeps(dir: string) {
  const ws = path.join(dir, 'pnpm-workspace.yaml')
  if (!existsSync(ws)) writeFileSync(ws, 'dangerouslyAllowAllBuilds: true\n')
  if (!existsSync(path.join(dir, 'node_modules'))) {
    console.log('  installing frontend deps...')
    spawnSync('pnpm', ['install'], { cwd: dir, stdio: 'inherit', shell: true })
  }
}

export async function startDev(cfg: AppConfig, provider: AwsProvider, cwd: string, stage = 'dev', apiUrl?: string) {
  if (cfg.frontend) {
    // Frontend dev server via the frontend's own package manager (detected from its lockfile).
    const frontendSrcDir = path.resolve(cwd, cfg.frontend.src)
    const frontendDir = existsSync(path.join(frontendSrcDir, 'package.json'))
      ? frontendSrcDir
      : path.dirname(frontendSrcDir)
    if (existsSync(frontendDir)) {
      const env = { ...process.env, ...(apiUrl ? { SLSV_API_URL: apiUrl } : {}) }
      ensureFrontendDeps(frontendDir)
      const vite = spawn('pnpm', ['run', 'dev'], {
        cwd: frontendDir,
        env,
        stdio: 'inherit',
        shell: true,
      })
      vite.on('error', (e) => console.error('[frontend]', e.message))
      process.on('exit', () => vite.kill())
    }
  }

  if (!cfg.functions || Object.keys(cfg.functions).length === 0) return

  const srcDir = path.join(cwd, 'src')

  for (const name of Object.keys(cfg.functions)) {
    provider.tailLogs(`${cfg.app}-${stage}-${name}`, true).catch(() => {})
  }

  console.log(`\nWatching ${srcDir}...`)

  const watcher = chokidar.watch(srcDir, { ignoreInitial: true }).on('change', async () => {
    console.log('\nChange detected — rebundling...')
    for (const [name, fn] of Object.entries(cfg.functions!)) {
      const fnName = `${cfg.app}-${stage}-${name}`
      try {
        const { zip } = await bundleHandler(fn.handler, cwd)
        await provider.updateFunctionCode(fnName, zip)
        console.log(`  ✓ ${fnName}`)
      } catch (e) {
        console.error(`  ✗ ${fnName}:`, (e as Error).message)
      }
    }
  })

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      void watcher.close().finally(() => {
        resolve()
        process.exit(0)
      })
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}

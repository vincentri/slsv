import chokidar from 'chokidar'
import path from 'path'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import type { AppConfig } from './config.js'
import type { Provider } from './providers/types.js'
import { bundleHandler } from './bundle.js'

export async function startDev(cfg: AppConfig, provider: Provider, cwd: string, apiUrl?: string) {
  if (cfg.frontend) {
    const frontendSrcDir = path.resolve(cwd, cfg.frontend.src)
    const frontendDir = existsSync(path.join(frontendSrcDir, 'package.json'))
      ? frontendSrcDir
      : path.dirname(frontendSrcDir)
    if (existsSync(frontendDir)) {
      const env = { ...process.env, ...(apiUrl ? { SLSV_API_URL: apiUrl } : {}) }
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
    provider.tailLogs(`${cfg.app}-${name}`, true).catch(() => {})
  }

  console.log(`\nWatching ${srcDir}...`)

  const watcher = chokidar.watch(srcDir, { ignoreInitial: true }).on('change', async () => {
    console.log('\nChange detected — rebundling...')
    for (const [name, fn] of Object.entries(cfg.functions!)) {
      const fnName = `${cfg.app}-${name}`
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

import { Command } from 'commander'
import path from 'path'
import { existsSync } from 'fs'
import { loadConfig } from './config.js'
import { AwsProvider } from './providers/aws/index.js'
import { ministackReset } from './providers/aws/ministack.js'
import { deploy } from './deploy.js'
import { startDev } from './dev.js'
import { initScaffold, initOutroMessage, type Template, type Stack } from './init.js'
import { startUi } from './ui.js'

const program = new Command()

program.name('slsv').description('Simple local-AWS serverless framework').version('0.1.0')

program
  .command('init [name]')
  .description('Scaffold a new slsv app')
  .option('--demo', 'Scaffold the full demo (HTTP + queue + cron + webhook)', false)
  .option('--yes', 'Skip prompts, use current directory name (CI-friendly)', false)
  .action(async (name: string | undefined, opts: { demo: boolean; yes: boolean }) => {
    const template: Template = opts.demo ? 'demo' : 'minimal'
    const cwd = process.cwd()

    if (name) {
      runScaffold(name, cwd, template, 'fullstack')
      return
    }

    if (opts.yes || !process.stdout.isTTY) {
      runScaffold(path.basename(cwd), cwd, template, 'fullstack')
      return
    }

    const { intro, text, select, isCancel, cancel, spinner, outro } = await import('@clack/prompts')

    intro('slsv')

    const result = await text({
      message: 'App name',
      placeholder: path.basename(cwd),
      defaultValue: path.basename(cwd),
      validate(value) {
        if (!value) return 'Name is required'
        if (!/^[a-z0-9-]+$/.test(value)) return 'Lowercase letters, numbers, dashes only'
        if (existsSync(path.join(cwd, value))) return `Directory "${value}" already exists`
      },
    })

    if (isCancel(result)) {
      cancel('Cancelled.')
      process.exit(0)
    }

    const stackResult = await select({
      message: 'What are you building?',
      options: [
        { value: 'fullstack', label: 'Fullstack', hint: 'API + frontend (Vite)' },
        { value: 'backend', label: 'Backend only', hint: 'API + database, no frontend' },
        { value: 'frontend', label: 'Frontend only', hint: 'Static site (Vite), no API' },
      ],
    })

    if (isCancel(stackResult)) {
      cancel('Cancelled.')
      process.exit(0)
    }

    const stack = stackResult as Stack
    const appName = result as string

    const s = spinner()
    s.start('Scaffolding...')
    initScaffold(appName, cwd, template, stack)
    s.stop('Done')

    outro(`Created ./${appName}  →  ${initOutroMessage(appName, stack, template)}`)
  })

function runScaffold(name: string, cwd: string, template: Template, stack: Stack) {
  initScaffold(name, cwd, template, stack)
  console.log(`Created ${name}/`)
  console.log(`Next: ${initOutroMessage(name, stack, template)}`)
}

program
  .command('dev')
  .description('Start MiniStack, deploy, then watch for changes')
  .action(async () => {
    const cwd = process.cwd()
    const cfg = loadConfig(cwd)
    const provider = new AwsProvider('local')

    await provider.startLocalEmulator(cwd, cfg)
    const outputs = await deploy(cfg, provider, cwd, 'dev')

    if (outputs.apiUrl) console.log(`\nAPI → ${outputs.apiUrl}`)
    if (outputs.frontendUrl) console.log(`Frontend → ${outputs.frontendUrl}`)

    await startDev(cfg, provider, cwd, outputs.apiUrl)
  })

program
  .command('deploy')
  .description('Deploy (default: local, --target aws for real AWS)')
  .option('--target <target>', 'local or aws', 'local')
  .action(async (opts: { target: 'local' | 'aws' }) => {
    const cwd = process.cwd()
    const cfg = loadConfig(cwd)
    const provider = new AwsProvider(opts.target)

    if (opts.target === 'local') await provider.startLocalEmulator(cwd, cfg)

    const outputs = await deploy(cfg, provider, cwd)

    if (outputs.apiUrl) console.log(`\nAPI → ${outputs.apiUrl}`)
    if (outputs.frontendUrl) console.log(`Frontend → ${outputs.frontendUrl}`)
  })

program
  .command('logs <function>')
  .description('Tail CloudWatch logs for a function')
  .option('-f, --follow', 'Follow log output', false)
  .action(async (fnName: string, opts: { follow: boolean }) => {
    const cfg = loadConfig(process.cwd())
    const provider = new AwsProvider('local')
    await provider.tailLogs(`${cfg.app}-${fnName}`, opts.follow)
  })

program
  .command('ui')
  .description('Launch local dashboard UI')
  .option('--target <target>', 'local or aws', 'local')
  .option('--port <port>', 'UI server port', '4567')
  .action(async (opts) => {
    await startUi({ target: opts.target, port: Number(opts.port), cwd: process.cwd() })
  })

program
  .command('destroy')
  .description(
    "Delete this app's slsv.yml resources (Lambda/Dynamo/S3/SQS/secrets) and stop MiniStack.",
  )
  .action(async () => {
    const cwd = process.cwd()
    const cfg = loadConfig(cwd)
    const provider = new AwsProvider('local')
    console.log(`Deleting resources for app "${cfg.app}"...`)
    await provider.destroyResources(cfg)
    console.log('Resources deleted.')
    provider.stopLocalEmulator(cwd)
    console.log('MiniStack stopped.')
  })

program
  .command('reset')
  .description(
    'Wipe ALL resources inside the shared MiniStack container (every repo on host). Containers stay up.',
  )
  .action(async () => {
    await ministackReset()
    console.log('MiniStack resources wiped (all apps). Container still running.')
  })

program.parseAsync(process.argv)

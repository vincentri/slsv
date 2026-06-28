#!/usr/bin/env node
import { Command } from 'commander'
import path from 'path'
import { existsSync } from 'fs'
import { loadInspectorConfig } from './config.js'
import { startServer } from './server.js'

new Command()
  .name('slui')
  .description('Multi-account AWS resource inspector')
  .option('-c, --config <path>', 'path to slui.yaml')
  .option('-p, --port <port>', 'port', '4567')
  .action((opts) => {
    const configPath = path.resolve(opts.config ?? 'slui.yaml')
    const accounts = existsSync(configPath) ? loadInspectorConfig(configPath).accounts : []
    startServer({ accounts, port: Number(opts.port) })
  })
  .parse()

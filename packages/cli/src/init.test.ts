import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, existsSync, readFileSync, mkdirSync } from 'fs'
import path from 'path'
import os from 'os'
import { initScaffold } from './init.js'

describe('initScaffold', () => {
  let tmp: string

  beforeEach(() => {
    tmp = path.join(os.tmpdir(), `slsv-init-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmp, { recursive: true })
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('writes slsv.yml for backend stack', () => {
    initScaffold('myapp', tmp, 'minimal', 'backend')
    const yml = readFileSync(path.join(tmp, 'myapp', 'slsv.yml'), 'utf-8')
    expect(yml).toMatch(/app: myapp/)
    expect(yml).toMatch(/functions:/)
    expect(existsSync(path.join(tmp, 'myapp', 'backend', 'api.ts'))).toBe(true)
  })

  it('writes slsv.yml for frontend stack without functions', () => {
    initScaffold('fe', tmp, 'minimal', 'frontend')
    const yml = readFileSync(path.join(tmp, 'fe', 'slsv.yml'), 'utf-8')
    expect(yml).toMatch(/app: fe/)
    expect(yml).not.toMatch(/functions:/)
    expect(existsSync(path.join(tmp, 'fe', 'frontend', 'index.html'))).toBe(true)
  })
})

/**
 * @file Apps/typescript-tools/package.scripts.mts
 * @description Lightweight TypeScript tools task runner replacing legacy Hereby build pipelines.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const rootDir = import.meta.dirname || process.cwd()
const tscPath = path.resolve(rootDir, 'lib/tsc.js')
const isWin = os.platform() === 'win32'

export function tsc(...args: string[]) {
  console.log(`[TypeScript Tools] Executing: node ${tscPath} ${args.join(' ')}`)
  const res = spawnSync(process.execPath, [tscPath, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env
  })
  if (res.status !== 0) {
    process.exit(res.status || 1)
  }
}

export function test() {
  console.log('[TypeScript Tools] Running native in-memory test suite...')
  const testFiles = [
    path.resolve(rootDir, 'test/simple-compiler.test.mjs'),
    path.resolve(rootDir, 'test/stealify-project.test.mjs'),
    path.resolve(rootDir, 'test/stealify-index.test.mjs'),
    path.resolve(rootDir, 'test/stealify-loader.test.mjs'),
    path.resolve(rootDir, 'test/stealify-transpiler.test.mjs')
  ]
  const res = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env
  })
  if (res.status !== 0) process.exit(res.status || 1)
}

export function bench() {
  console.log('[TypeScript Tools] Running resolution benchmark...')
  const benchFile = path.resolve(rootDir, 'benchmark/resolution-benchmark.mjs')
  const res = spawnSync(process.execPath, [benchFile], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env
  })
  if (res.status !== 0) process.exit(res.status || 1)
}

// Direct CLI invocation
const isDirect = process.argv[1] && (
  process.argv[1].endsWith('package.scripts.mts') ||
  process.argv[1].endsWith('package.scripts.mjs')
)

if (isDirect) {
  const cmd = process.argv[2] || 'version'
  if (cmd === 'version' || cmd === '-v' || cmd === '--version') {
    tsc('-v')
  } else if (cmd === 'test') {
    test()
  } else if (cmd === 'bench' || cmd === 'benchmark') {
    bench()
  } else {
    tsc(...process.argv.slice(2))
  }
}


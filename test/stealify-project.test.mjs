/**
 * @file Apps/typescript-tools/test/stealify-project.test.mjs
 * @description Validates Stealify project discovery and configuration support (stealify-config.mts / stealify-config.ts).
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('../lib/typescript.js')

test('findConfigFile discovers stealify-config.mts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stealify-test-'))
  const configFile = path.join(tmpDir, 'stealify-config.mts')
  fs.writeFileSync(configFile, JSON.stringify({
    compilerOptions: {
      target: "ES2024",
      module: "NodeNext"
    }
  }))

  const files = new Set([path.normalize(configFile).toLowerCase()])
  const fileExists = (f) => files.has(path.normalize(f).toLowerCase())

  // When searching with default tsconfig.json, Stealify config is preferred
  const found = ts.findConfigFile(tmpDir, fileExists)
  assert.ok(found, 'Should find config file')
  assert.match(found, /stealify-config\.mts$/)

  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('findConfigFile discovers stealify-config.ts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stealify-test-ts-'))
  const configFile = path.join(tmpDir, 'stealify-config.ts')
  fs.writeFileSync(configFile, JSON.stringify({
    compilerOptions: {
      target: "ES2024",
      module: "NodeNext"
    }
  }))

  const files = new Set([path.normalize(configFile).toLowerCase()])
  const fileExists = (f) => files.has(path.normalize(f).toLowerCase())

  const found = ts.findConfigFile(tmpDir, fileExists)
  assert.ok(found, 'Should find config file')
  assert.match(found, /stealify-config\.ts$/)

  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('parseConfigFileTextToJson parses Stealify export default object', () => {
  const content = `export default {
    compilerOptions: {
      module: "NodeNext",
      target: "ES2024"
    }
  };`

  const parsed = ts.parseConfigFileTextToJson("stealify-config.mts", content)
  assert.equal(parsed.error, undefined)
  assert.equal(parsed.config.compilerOptions.module, "NodeNext")
  assert.equal(parsed.config.compilerOptions.target, "ES2024")
})

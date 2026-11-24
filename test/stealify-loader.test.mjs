import test from 'node:test'
import assert from 'node:assert/strict'
import ts from '../lib/typescript.js'

test('StealifyLoader: createLoaderRegistry registers builtins and custom stealify-config loaders', () => {
  const customConfig = {
    compilerOptions: { target: "ES2024" },
    loaders: {
      client: async (ctx) => ({ default: `client-rendered:${ctx.specifier}` }),
      sql: async (ctx) => ({ default: `SELECT * FROM ${ctx.specifier}` })
    }
  }

  const registry = ts.createLoaderRegistry(customConfig)
  assert.ok(registry.has('raw'))
  assert.ok(registry.has('wasm'))
  assert.ok(registry.has('worker'))
  assert.ok(registry.has('client'))
  assert.ok(registry.has('sql'))
})

test('StealifyLoader: importWithLoader polyfill dispatches directly to targeted loader', async () => {
  // 1. Built-in 'raw' loader
  const rawResult = await ts.importWithLoader('hello world', {
    with: { loader: 'raw' }
  })
  assert.equal(rawResult.default, 'hello world')

  // 2. Custom loader provided in options
  const customResult = await ts.importWithLoader('./compute.wasm', {
    with: { loader: 'wasm-sim' },
    loaders: {
      'wasm-sim': async (ctx) => ({
        exports: { add: (a, b) => a + b },
        path: ctx.specifier
      })
    }
  })
  assert.equal(customResult.path, './compute.wasm')
  assert.equal(customResult.exports.add(2, 3), 5)

  // 3. Fallback execution when loader attribute is not matched
  const fallbackResult = await ts.importWithLoader('./unregistered.js', {
    fallback: async () => ({ status: 'handled-by-fallback' })
  })
  assert.equal(fallbackResult.status, 'handled-by-fallback')
})

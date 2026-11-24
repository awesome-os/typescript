import test from 'node:test'
import assert from 'node:assert/strict'
import ts from '../lib/typescript.js'

test('StealifyTranspiler: transpiles static imports with loader into importWithLoader calls', () => {
  const source = `
import worker, { spawnWorker as startJob } from "./worker.mts" with { loader: "wasm" };
import * as Tool from "./tool.js" with { loader: "native" };
import "./styles.css" with { loader: "style" };
import standard from "./normal.js";
`

  const result = ts.transpileLoaderImports(source, {
    polyfillImportSpecifier: '@awesome-os/typescript-tools',
    loadersObjectName: 'myLoaders'
  })

  assert.equal(result.transformedCount, 3)
  assert.equal(result.hasLoaderImports, true)

  // Verify polyfill import injection
  assert.ok(result.code.includes('import { importWithLoader } from "@awesome-os/typescript-tools";'))

  // Verify default + named destructuring
  assert.ok(result.code.includes('const { default: worker, spawnWorker: startJob } = await importWithLoader("./worker.mts", { with: {"loader":"wasm"}, loaders: myLoaders });'))

  // Verify namespace import
  assert.ok(result.code.includes('const Tool = await importWithLoader("./tool.js", { with: {"loader":"native"}, loaders: myLoaders });'))

  // Verify bare import
  assert.ok(result.code.includes('await importWithLoader("./styles.css", { with: {"loader":"style"}, loaders: myLoaders });'))

  // Standard import unchanged
  assert.ok(result.code.includes('import standard from "./normal.js";'))
})

test('StealifyTranspiler: transpiles dynamic imports with loader', () => {
  const source = `
async function run() {
  const mod = await import("./compute.wasm", { with: { loader: "wasm" } });
  const normal = await import("./normal.js");
  return mod;
}
`

  const result = ts.transpileLoaderImports(source)
  assert.equal(result.transformedCount, 1)

  assert.ok(result.code.includes('importWithLoader("./compute.wasm", { with: {"loader":"wasm"} })'))
  assert.ok(result.code.includes('await import("./normal.js");'))
})

test('StealifyTranspiler: stealifyLoaderPlugin hooks into Rollup/Vite/Babel pipelines', () => {
  const plugin = ts.stealifyLoaderPlugin({
    loadersObjectName: 'customRegistry'
  })

  // Fast bailout on code without loader
  const noMatch = plugin.transform('const a = 1;', 'index.js')
  assert.equal(noMatch, null)

  // Transforms code with loader attributes
  const match = plugin.transform('import wasm from "./math.wasm" with { loader: "wasm" };', 'index.js')
  assert.ok(match)
  assert.ok(match.code.includes('importWithLoader'))
  assert.ok(match.code.includes('loaders: customRegistry'))
})

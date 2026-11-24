import test from 'node:test'
import assert from 'node:assert/strict'
import ts from '../lib/typescript.js'

test('StealifyProjectIndex: extracts imports, exports and dynamic imports without AST allocations', () => {
  const sourceCode = `
import { foo } from "./foo.mts";
import bar from './bar.js';
export { baz } from "./nested/baz.ts";
export const x = 10;
export default function() {
  const mod = import("./dynamic-worker.mts");
  return mod;
}
`
  const records = ts.extractModuleSpecifiers(sourceCode)
  assert.equal(records.length, 4)

  assert.equal(records[0].type, 'import')
  assert.equal(records[0].specifier, './foo.mts')
  assert.equal(records[0].line, 2)

  assert.equal(records[1].type, 'import')
  assert.equal(records[1].specifier, './bar.js')
  assert.equal(records[1].line, 3)

  assert.equal(records[2].type, 'export')
  assert.equal(records[2].specifier, './nested/baz.ts')
  assert.equal(records[2].line, 4)

  assert.equal(records[3].type, 'dynamic-import')
  assert.equal(records[3].specifier, './dynamic-worker.mts')
  assert.equal(records[3].line, 7)
})

test('StealifyProjectIndex: builds pre-computed project entity with O(1) lookup map and extension guessing', () => {
  const rootDir = '/project'
  const files = [
    {
      path: '/project/src/index.mts',
      content: `
import { helper } from "./utils/helper.js";
import { store } from "./store";
import worker from "./workers/job.mjs";
`
    },
    {
      path: '/project/src/utils/helper.ts',
      content: `export const helper = 42;`
    },
    {
      path: '/project/src/store.mts',
      content: `export const store = { active: true };`
    },
    {
      path: '/project/src/workers/job.mts',
      content: `export default function job() {}`
    }
  ]

  const index = ts.createStealifyProjectIndex(rootDir, files)

  // Verify O(1) fileExists and directoryExists
  assert.equal(index.fileExists('/project/src/index.mts'), true)
  assert.equal(index.fileExists('/project/src/utils/helper.ts'), true)
  assert.equal(index.fileExists('/project/src/does-not-exist.ts'), false)
  assert.equal(index.directoryExists('/project/src/utils'), true)
  assert.equal(index.directoryExists('/project/src/not-a-dir'), false)

  // Verify specifier resolution with extension mapping:
  // 1. "./utils/helper.js" -> maps directly to helper.ts without disk stat
  const resolvedHelper = index.resolveSpecifier('/project/src/index.mts', './utils/helper.js')
  assert.equal(resolvedHelper, '/project/src/utils/helper.ts')

  // 2. "./store" (extensionless) -> guesses and resolves to store.mts
  const resolvedStore = index.resolveSpecifier('/project/src/index.mts', './store')
  assert.equal(resolvedStore, '/project/src/store.mts')

  // 3. "./workers/job.mjs" -> maps to job.mts
  const resolvedJob = index.resolveSpecifier('/project/src/index.mts', './workers/job.mjs')
  assert.equal(resolvedJob, '/project/src/workers/job.mts')

  // Verify entity module record pre-computation
  const indexMod = index.modules.get('/project/src/index.mts')
  assert.ok(indexMod)
  assert.equal(indexMod.specifiers.length, 3)
  assert.equal(indexMod.resolvedMap.get('./utils/helper.js'), '/project/src/utils/helper.ts')
  assert.equal(indexMod.resolvedMap.get('./store'), '/project/src/store.mts')
  assert.equal(indexMod.resolvedMap.get('./workers/job.mjs'), '/project/src/workers/job.mts')
})

test('StealifyProjectIndex: extracts Rollup-style ModuleSymbolTree with named, default, star re-exports and import attributes', () => {
  const sourceCode = `
import worker, { spawnWorker as startJob } from "./worker.mts" with { loader: "wasm", type: "module" };
import type { Config } from "./config.ts";
import * as Logger from "./logger.mts";

export { startJob as run } from "./worker.mts";
export * as Tools from "./tools.mts";
export * from "./external.mts";

export const VERSION = "1.0.0";
export function calculate(x: number) { return x * 2; }
export class Engine {}
export type Mode = 'fast' | 'safe';

export default function main() {
  const dyn = import("./lazy-component.mts", { with: { loader: "client" } });
  return dyn;
}
`

  const symbols = ts.extractModuleSymbols(sourceCode)

  // 1. Verify Imports
  assert.equal(symbols.imports.length, 4) // default worker, named startJob, type Config, namespace Logger

  const impWorker = symbols.imports.find(i => i.name === 'default')
  assert.ok(impWorker)
  assert.equal(impWorker.localName, 'worker')
  assert.equal(impWorker.sourceModule, './worker.mts')
  assert.equal(impWorker.attributes?.loader, 'wasm')
  assert.equal(impWorker.attributes?.type, 'module')

  const impNamed = symbols.imports.find(i => i.name === 'spawnWorker')
  assert.ok(impNamed)
  assert.equal(impNamed.localName, 'startJob')

  const impType = symbols.imports.find(i => i.name === 'Config')
  assert.ok(impType)
  assert.equal(impType.isTypeOnly, true)

  const impNs = symbols.imports.find(i => i.name === '*')
  assert.ok(impNs)
  assert.equal(impNs.localName, 'Logger')

  // 2. Verify Exports (Rollup-style named and unnamed exports map)
  assert.ok(symbols.exports.has('default'), 'Should have default export')
  assert.equal(symbols.exports.get('default').isDefault, true)

  assert.ok(symbols.exports.has('run'), 'Should have aliased re-export run')
  assert.equal(symbols.exports.get('run').localName, 'startJob')
  assert.equal(symbols.exports.get('run').sourceModule, './worker.mts')

  assert.ok(symbols.exports.has('Tools'), 'Should have export * as Tools')
  assert.equal(symbols.exports.get('Tools').isStar, true)
  assert.equal(symbols.exports.get('Tools').sourceModule, './tools.mts')

  assert.ok(symbols.exports.has('VERSION'))
  assert.ok(symbols.exports.has('calculate'))
  assert.ok(symbols.exports.has('Engine'))
  assert.ok(symbols.exports.has('Mode'))
  assert.equal(symbols.exports.get('Mode').isTypeOnly, true)

  // 3. Verify Star Re-exports
  assert.equal(symbols.starReexports.length, 1)
  assert.equal(symbols.starReexports[0].sourceModule, './external.mts')

  // 4. Verify Dynamic Imports
  assert.equal(symbols.dynamicImports.length, 1)
  assert.equal(symbols.dynamicImports[0].specifier, './lazy-component.mts')
  assert.equal(symbols.dynamicImports[0].attributes?.loader, 'client')
})

test('StealifyProjectIndex: project entity exposes symbolTree for bundle recomposition', () => {
  const index = ts.createStealifyProjectIndex('/app', [
    {
      path: '/app/index.ts',
      content: `
import { add } from "./math.js" with { loader: "native" };
export const total = add(1, 2);
`
    },
    {
      path: '/app/math.ts',
      content: `export function add(a, b) { return a + b; }`
    }
  ])

  const indexTree = index.getSymbolTree('/app/index.ts')
  assert.ok(indexTree)
  assert.equal(indexTree.imports[0].name, 'add')
  assert.equal(indexTree.imports[0].attributes?.loader, 'native')
  assert.ok(indexTree.exports.has('total'))

  const mathTree = index.getSymbolTree('/app/math.ts')
  assert.ok(mathTree)
  assert.ok(mathTree.exports.has('add'))
})

test('StealifyProjectIndex: scans and resolves CSS imports, @import, and asset targets', () => {
  const index = ts.createStealifyProjectIndex('/workspace', [
    {
      path: '/workspace/src/app.tsx',
      content: `
import './theme.css';
import style from './component.module.css' with { loader: 'css' };
export function App() { return <div className={style.root}>Hello</div>; }
`
    },
    {
      path: '/workspace/src/theme.css',
      content: `@import "./base.css";
@import url("./tokens.css");
body { background: #000; }
`
    },
    {
      path: '/workspace/src/base.css',
      content: `* { box-sizing: border-box; }`
    },
    {
      path: '/workspace/src/tokens.css',
      content: `:root { --primary: #3b82f6; }`
    },
    {
      path: '/workspace/src/component.module.css',
      content: `.root { color: var(--primary); }`
    }
  ])

  // Verify specifiers extracted from TSX and CSS files
  const appTree = index.getSymbolTree('/workspace/src/app.tsx')
  assert.ok(appTree)
  assert.equal(appTree.imports.length, 2)
  assert.equal(appTree.imports[0].sourceModule, './theme.css')
  assert.equal(appTree.imports[0].attributes?.loader, 'css') // inferred loader
  assert.equal(appTree.imports[1].sourceModule, './component.module.css')
  assert.equal(appTree.imports[1].attributes?.loader, 'css')

  const themeTree = index.getSymbolTree('/workspace/src/theme.css')
  assert.ok(themeTree)
  assert.equal(themeTree.imports.length, 2)
  assert.equal(themeTree.imports[0].sourceModule, './base.css')
  assert.equal(themeTree.imports[1].sourceModule, './tokens.css')

  // Verify O(1) resolution across assets and extension guessing
  assert.equal(index.resolveSpecifier('/workspace/src/app.tsx', './theme.css'), '/workspace/src/theme.css')
  assert.equal(index.resolveSpecifier('/workspace/src/app.tsx', './base'), '/workspace/src/base.css')
  assert.equal(index.resolveSpecifier('/workspace/src/theme.css', './tokens.css'), '/workspace/src/tokens.css')
})

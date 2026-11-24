/**
 * @file resolution-benchmark.mjs
 * @description Benchmark comparing traditional TypeScript module resolution (ts.resolveModuleName
 * hitting file existence checks and extension probes) against the pre-computed Stealify Project Entity index (O(1) memory lookup).
 */

import { performance } from 'node:perf_hooks'
import ts from '../lib/typescript.js'

// Setup simulated project graph with 1,000 module files, each importing 5 dependencies
const FILE_COUNT = 1000
const IMPORTS_PER_FILE = 5
const projectFiles = []
const importQueries = []

console.log(`Generating simulated codebase: ${FILE_COUNT} modules, ${FILE_COUNT * IMPORTS_PER_FILE} import resolutions...\n`)

for (let i = 0; i < FILE_COUNT; i++) {
  const filePath = `C:/project/src/module_${i}.ts`
  const imports = []
  for (let j = 1; j <= IMPORTS_PER_FILE; j++) {
    const targetIdx = (i + j) % FILE_COUNT
    // In NodeNext/ESM, TypeScript imports write .js or .mjs which map to .ts or .mts on disk
    const specifier = `./module_${targetIdx}.js`
    imports.push(`import { fn_${targetIdx} } from "${specifier}";`)
    importQueries.push({ containingFile: filePath, specifier, expectedTarget: `C:/project/src/module_${targetIdx}.ts` })
  }
  projectFiles.push({
    path: filePath,
    content: imports.join('\n') + `\nexport function fn_${i}() { return ${i}; }`
  })
}

// -------------------------------------------------------------
// Benchmark 1: Traditional TypeScript Resolution (ts.resolveModuleName)
// -------------------------------------------------------------
const knownFilesSet = new Set(projectFiles.map(f => f.path.toLowerCase()))
let diskProbesCount = 0

const mockFsHost = {
  fileExists(fileName) {
    diskProbesCount++
    return knownFilesSet.has(fileName.replace(/\\/g, '/').toLowerCase())
  },
  readFile(fileName) {
    return ''
  },
  useCaseSensitiveFileNames: false,
  directoryExists(dir) {
    diskProbesCount++
    return true
  },
  getCurrentDirectory() {
    return 'C:/project'
  }
}

const compilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ESNext
}

// Warm up V8 JIT
for (let i = 0; i < 50; i++) {
  ts.resolveModuleName(importQueries[i].specifier, importQueries[i].containingFile, compilerOptions, mockFsHost)
}
diskProbesCount = 0

const startTraditional = performance.now()
let traditionalResolvedCount = 0

for (let i = 0; i < importQueries.length; i++) {
  const q = importQueries[i]
  const res = ts.resolveModuleName(q.specifier, q.containingFile, compilerOptions, mockFsHost)
  if (res && res.resolvedModule) {
    traditionalResolvedCount++
  }
}

const durationTraditional = performance.now() - startTraditional

// -------------------------------------------------------------
// Benchmark 2: Stealify Project Entity (Pre-computed Index)
// -------------------------------------------------------------
const startBuildIndex = performance.now()
const stealifyIndex = ts.createStealifyProjectIndex('C:/project', projectFiles)
const durationBuildIndex = performance.now() - startBuildIndex

// Warm up V8 JIT
for (let i = 0; i < 50; i++) {
  stealifyIndex.resolveSpecifier(importQueries[i].containingFile, importQueries[i].specifier)
}

const startStealify = performance.now()
let stealifyResolvedCount = 0

for (let i = 0; i < importQueries.length; i++) {
  const q = importQueries[i]
  const resolved = stealifyIndex.resolveSpecifier(q.containingFile, q.specifier)
  if (resolved) {
    stealifyResolvedCount++
  }
}

const durationStealify = performance.now() - startStealify

// -------------------------------------------------------------
// Results & Summary
// -------------------------------------------------------------
console.log('======================================================================')
console.log('              BENCHMARK RESULTS: MODULE RESOLUTION SPEED              ')
console.log('======================================================================')
console.log(`Total Resolutions:        ${importQueries.length.toLocaleString()}`)
console.log(`Simulated Modules:        ${FILE_COUNT.toLocaleString()}`)
console.log('----------------------------------------------------------------------')
console.log(`Traditional tsc resolve:  ${durationTraditional.toFixed(2)} ms`)
console.log(`  - File/Dir probes:      ${diskProbesCount.toLocaleString()} calls`)
console.log(`  - Throughput:           ${Math.round(importQueries.length / (durationTraditional / 1000)).toLocaleString()} ops/sec`)
console.log('----------------------------------------------------------------------')
console.log(`Stealify Entity resolve:  ${durationStealify.toFixed(2)} ms`)
console.log(`  - Index Build time:     ${durationBuildIndex.toFixed(2)} ms (one-time pre-computation)`)
console.log(`  - Disk probes:          0 (Zero synchronous I/O)`)
console.log(`  - Throughput:           ${Math.round(importQueries.length / (durationStealify / 1000)).toLocaleString()} ops/sec`)
console.log('----------------------------------------------------------------------')
const speedup = (durationTraditional / durationStealify).toFixed(1)
console.log(`⚡ Stealify Resolution is ${speedup}x faster than traditional tsc module resolution!`)
console.log('======================================================================')

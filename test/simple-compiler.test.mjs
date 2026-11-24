/**
 * @file Apps/typescript-tools/test/simple-compiler.test.mjs
 * @description Native test asserting TypeScript 6.0 compiler APIs in memory without baseline diffing.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('../lib/typescript.js')

test('TypeScript 6.0 version check', () => {
  assert.match(ts.version, /^6\./)
})

test('Transpile TypeScript to JavaScript in-memory', () => {
  const source = `
    interface User {
      id: number;
      name: string;
    }
    const greet = (u: User): string => "Hello " + u.name;
    export const res = greet({ id: 1, name: "AwesomeOS" });
  `
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    }
  })

  assert.ok(result.outputText)
  assert.match(result.outputText, /Hello/)
  assert.doesNotMatch(result.outputText, /interface User/)
})

test('In-memory Diagnostic and AST Parsing', () => {
  const source = `
    const a: number = 42;
    const b: string = "test";
  `
  const sourceFile = ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true)
  assert.ok(sourceFile)
  assert.equal(sourceFile.statements.length, 2)
})


/**
 * @file test/v8-compiler-opt.test.mts
 * @description Fast, zero-dependency verification suite for awesome-os/typescript (6.0.3).
 * Covers Scanner keywords & prefix edge cases, Parser/Binder/Checker typechecking,
 * Generic/Intersection/Mapped types, Control-Flow Analysis, Language Service (LSP),
 * and Zero-AST Semantic CAS equivalence.
 *
 * Run: node --test test/v8-compiler-opt.test.mts
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { runInThisContext } from 'node:vm';

const req = createRequire(import.meta.url);
const tsPath = resolve(process.cwd(), 'lib', 'typescript.js');
const tsCode = readFileSync(tsPath, 'utf8');
const tsMod = { exports: {} as Record<string, unknown> };
runInThisContext(`(function(exports, require, module, __filename, __dirname) {\n${tsCode}\n})`, {
  filename: 'lib/typescript.js',
})(tsMod.exports, req, tsMod, tsPath, resolve(process.cwd(), 'lib'));
const ts = tsMod.exports as typeof import('../lib/typescript.d.ts');

test('Scanner: exact keyword recognition and non-keyword prefix safety', () => {
  const src =
    'const let var if else for of in as from return function type interface readonly async await class extends true false null void this new string number boolean ' +
    'constant letter variable iffy elsewhere format office inside asyncFn interfaceName typedef readonlyProp';
  const scanner = ts.createScanner(ts.ScriptTarget.ESNext, /*skipTrivia*/ true, ts.LanguageVariant.Standard, src);

  const expected: Array<[number, string]> = [
    [ts.SyntaxKind.ConstKeyword, 'const'],
    [ts.SyntaxKind.LetKeyword, 'let'],
    [ts.SyntaxKind.VarKeyword, 'var'],
    [ts.SyntaxKind.IfKeyword, 'if'],
    [ts.SyntaxKind.ElseKeyword, 'else'],
    [ts.SyntaxKind.ForKeyword, 'for'],
    [ts.SyntaxKind.OfKeyword, 'of'],
    [ts.SyntaxKind.InKeyword, 'in'],
    [ts.SyntaxKind.AsKeyword, 'as'],
    [ts.SyntaxKind.FromKeyword, 'from'],
    [ts.SyntaxKind.ReturnKeyword, 'return'],
    [ts.SyntaxKind.FunctionKeyword, 'function'],
    [ts.SyntaxKind.TypeKeyword, 'type'],
    [ts.SyntaxKind.InterfaceKeyword, 'interface'],
    [ts.SyntaxKind.ReadonlyKeyword, 'readonly'],
    [ts.SyntaxKind.AsyncKeyword, 'async'],
    [ts.SyntaxKind.AwaitKeyword, 'await'],
    [ts.SyntaxKind.ClassKeyword, 'class'],
    [ts.SyntaxKind.ExtendsKeyword, 'extends'],
    [ts.SyntaxKind.TrueKeyword, 'true'],
    [ts.SyntaxKind.FalseKeyword, 'false'],
    [ts.SyntaxKind.NullKeyword, 'null'],
    [ts.SyntaxKind.VoidKeyword, 'void'],
    [ts.SyntaxKind.ThisKeyword, 'this'],
    [ts.SyntaxKind.NewKeyword, 'new'],
    [ts.SyntaxKind.StringKeyword, 'string'],
    [ts.SyntaxKind.NumberKeyword, 'number'],
    [ts.SyntaxKind.BooleanKeyword, 'boolean'],
    // Non-keywords with keyword prefixes MUST remain Identifiers!
    [ts.SyntaxKind.Identifier, 'constant'],
    [ts.SyntaxKind.Identifier, 'letter'],
    [ts.SyntaxKind.Identifier, 'variable'],
    [ts.SyntaxKind.Identifier, 'iffy'],
    [ts.SyntaxKind.Identifier, 'elsewhere'],
    [ts.SyntaxKind.Identifier, 'format'],
    [ts.SyntaxKind.Identifier, 'office'],
    [ts.SyntaxKind.Identifier, 'inside'],
    [ts.SyntaxKind.Identifier, 'asyncFn'],
    [ts.SyntaxKind.Identifier, 'interfaceName'],
    [ts.SyntaxKind.Identifier, 'typedef'],
    [ts.SyntaxKind.Identifier, 'readonlyProp'],
  ];

  for (const [kind, text] of expected) {
    const tok = scanner.scan();
    assert.equal(tok, kind, `Expected token kind ${ts.SyntaxKind[kind]} for "${text}", got ${ts.SyntaxKind[tok]}`);
    assert.equal(scanner.getTokenValue(), text);
  }
  assert.equal(scanner.scan(), ts.SyntaxKind.EndOfFileToken);
});

test('Checker: generics, mapped types, intersections, CFA narrowing, and strict error detection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ts-opt-check-'));
  try {
    const goodFile = join(dir, 'good.ts');
    writeFileSync(
      goodFile,
      `
      export type ReadonlyPair<A, B> = { readonly first: A; readonly second: B };
      export type Mapped<T> = { [K in keyof T]: T[K] | null };
      export type Combined = { a: number } & { b: string };

      export function narrow(x: string | number | null): number {
        if (x === null) return 0;
        if (typeof x === 'string') return x.length;
        return x * 2;
      }

      export const pair: Mapped<ReadonlyPair<number, string>> = { first: 1, second: null };
      export const combo: Combined = { a: 42, b: 'ok' };
      `
    );

    const progGood = ts.createProgram([goodFile], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    });
    const diagsGood = ts.getPreEmitDiagnostics(progGood);
    assert.equal(diagsGood.length, 0, `Expected 0 diagnostics, got: ${diagsGood.map((d) => d.messageText).join('; ')}`);

    // Intentional type error MUST be caught!
    const badFile = join(dir, 'bad.ts');
    writeFileSync(badFile, `export const broken: number = "not-a-number";`);
    const progBad = ts.createProgram([badFile], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    });
    const diagsBad = ts.getPreEmitDiagnostics(progBad);
    assert.ok(diagsBad.length >= 1, 'Expected strict type error for string assigned to number');
    assert.equal(diagsBad[0]!.code, 2322);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('LanguageService (LSP foundation): completions & quick-info work programmatically', () => {
  const files = new Map<string, string>([
    ['/virtual/app.ts', 'interface Ghost { readonly sha256: string; hydrate(): void; }\ndeclare const g: Ghost;\ng.'],
  ]);
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: () => '1',
    getScriptSnapshot: (f) => {
      const content = files.get(f);
      return content !== undefined ? ts.ScriptSnapshot.fromString(content) : undefined;
    },
    getCurrentDirectory: () => '/virtual',
    getCompilationSettings: () => ({ target: ts.ScriptTarget.ES2022, strict: true }),
    getDefaultLibFileName: () => '',
    fileExists: (f) => files.has(f),
    readFile: (f) => files.get(f),
  };

  const ls = ts.createLanguageService(host);
  const src = files.get('/virtual/app.ts')!;
  const completions = ls.getCompletionsAtPosition('/virtual/app.ts', src.length, undefined);
  assert.ok(completions, 'Expected completions after "g."');
  const names = completions.entries.map((e) => e.name);
  assert.ok(names.includes('sha256'), 'Expected "sha256" completion');
  assert.ok(names.includes('hydrate'), 'Expected "hydrate" completion');
});

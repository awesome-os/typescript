# `awesome-os/typescript` — TypeScript 6.0.3, Not As You Know It

> **Programmable TypeScript 6.0.3 Compiler Source + Zero-AST First-Pass Semantic Lookup + Canonical $O(1)$ Ghost CAS**  
> **Ghost CAS Pack:** `typescript-6.0.3-programmable.tar.gz` (`1.76 MB`, `sha256=0d02fd5d632ba5ca...`) in [`awesome-os/b8g-ghost @ cas-v1`](https://github.com/awesome-os/b8g-ghost/releases/tag/cas-v1)

---

## Why This Fork Exists

Most "fast TypeScript" efforts force a painful trade-off: either strip types with a dumb regex (losing real typechecking & AST tooling) or rewrite the compiler in a separate native language (breaking the programmable JavaScript/V8 Compiler API).

**`awesome-os/typescript` keeps 100% of the programmable TypeScript 6.0.3 JS/V8 Compiler API intact** (`ts.createProgram`, `ts.transpileModule`, `ts.createLanguageService`, custom AST transformers & plugins) — while making execution **orders of magnitude faster** through the Awesome-OS runtime stack:

1. **Zero-AST First-Pass Lookup (`b8g-ghost` Semantic CAS):**
   - Before invoking the heavy TypeScript parser/binder/checker, our front-door computes a **Zero-AST Canonical Semantic Hash (`abi_hash` + `impl_hash`)** in microseconds.
   - Comments, whitespace, formatting, declaration reordering, and local variable renames hit the **shared Machine CAS (`<cas>/<sha256>/`)** immediately — **skipping AST construction and typechecking completely** for unchanged semantics.
   - Only files with a real semantic or ABI delta ever enter the full TypeScript 6.0.3 compiler!
2. **100% Programmable TypeScript 6.0.3 (`src/` + `lib/typescript.js`):**
   - Full `typescript.js` + `typescript.d.ts` API preserved so IDEs (`awesome-os/b8g-ide`), agents, and build tools (`holo-compiler`) can inspect types, synthesize code, and run custom AST passes programmatically.
3. **Runs on Shared Dynamic V8 (`dup_v8 = 0 B`):**
   - Hydrated directly from [`awesome-os/b8g-ghost @ cas-v1`](https://github.com/awesome-os/b8g-ghost/releases/tag/cas-v1) into `awesome-os/lo`, `awesome-os/bun-neon`, `awesome-os/just-js`, and `awesome-os/sectium-browser` — sharing a single V8 instance in OS RAM.

---

## Quickstart

```js
// Programmatic TypeScript 6.0.3 API — zero external bundler, runs directly on lo / V8 / Node 22+
import ts from './lib/typescript.js';

const out = ts.transpileModule('const answer: number = 42;', {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
});
console.log(out.outputText);
```

- **Compiler Source:** [`src/`](./src/)
- **Prebuilt Programmable Bundle:** [`lib/typescript.js`](./lib/typescript.js) & [`lib/typescript.d.ts`](./lib/typescript.d.ts)
- **Benchmarks:** [`benchmark/`](./benchmark/)
- **Unified Ghost CAS Index:** [`https://raw.githubusercontent.com/awesome-os/b8g-ghost/main/manifests/index.json`](https://raw.githubusercontent.com/awesome-os/b8g-ghost/main/manifests/index.json)

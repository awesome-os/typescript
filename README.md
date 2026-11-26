# `awesome-os/typescript` — TypeScript 6.0.3, Not As You Know It

> **Programmable TypeScript 6.0.3 Compiler Source + Zero-AST First-Pass Semantic Lookup + Unified Holo `v11` CAS (`awesome-os/holo-v11`)**  
> **Registry Lockfile:** `index/holo-compiler-lockfile.json` in [`awesome-os/holo-v11`](https://github.com/awesome-os/holo-v11) (`B8G_ABI_MAGIC_V3 = 0x33564742`, `~/.b8g/cas/v11`)

---

## Why This Fork Exists

Most "fast TypeScript" efforts force a painful trade-off: either strip types with a dumb regex (losing real typechecking & AST tooling) or rewrite the compiler in a separate native language (breaking the programmable JavaScript/V8 Compiler API).

**`awesome-os/typescript` keeps 100% of the programmable TypeScript 6.0.3 JS/V8 Compiler API intact** (`ts.createProgram`, `ts.transpileModule`, `ts.createLanguageService`, custom AST transformers & plugins) — while making execution **orders of magnitude faster** through the Awesome-OS Holo `v11` runtime stack:

1. **Zero-AST First-Pass Lookup (`Holo v11` Semantic CAS):**
   - Before invoking the heavy TypeScript parser/binder/checker, our front-door computes a **Zero-AST Canonical Semantic Hash (`abi_hash` + `impl_hash`)** in microseconds.
   - Comments, whitespace, formatting, declaration reordering, and local variable renames hit the **unified `v11` CAS (`~/.b8g/cas/v11/files/<aa>/<sha512>`)** immediately — **skipping AST construction and typechecking completely** for unchanged semantics.
   - Only files with a real semantic or ABI delta ever enter the full TypeScript 6.0.3 compiler!
2. **100% Programmable TypeScript 6.0.3 (`src/` + `lib/typescript.js`):**
   - Full `typescript.js` + `typescript.d.ts` API preserved so IDEs ([`awesome-os/devtools`](https://github.com/awesome-os/devtools) — `ide/code-oss`, `ide/b8g-ide`), agents ([`awesome-os/agent-platform`](https://github.com/awesome-os/agent-platform)), and build tools ([`awesome-os/holo-compiler`](https://github.com/awesome-os/holo-compiler)) can inspect types, synthesize code, and run custom AST passes programmatically.
3. **Runs on Shared Dynamic V8 (`dup_v8 = 0 B`):**
   - Hydrated directly from [`awesome-os/holo-v11`](https://github.com/awesome-os/holo-v11) into [`awesome-os/chromium-baseline`](https://github.com/awesome-os/chromium-baseline) (`lo`, `just-js`, `node`, `deno`, `bun-neon`) and [`awesome-os/sectium-browser`](https://github.com/awesome-os/sectium-browser) — sharing a single V8 instance in OS RAM.

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
- **Live Benchmark (`node benchmark/zero-ast-vs-tsc.mts` — 60 TS modules):**
  - Full TS 6.0.3 `createProgram` + typecheck (cold): **`209.4 ms`** | after comment/whitespace edits: **`142.8 ms`**
  - In-process `ts.transpileModule`: **`86.2 ms`**
  - **Zero-AST Semantic Lookup + Holo `v11` CAS (warm, 60/60 hits):** **`5.58 ms`** (**`25.6×` faster** than warm typecheck / **`37.5×` faster** than cold on 60 modules; scales linearly to **100×+** on large monorepos)
- **Unified Holo `v11` Lockfile:** [`https://raw.githubusercontent.com/awesome-os/holo-v11/main/index/holo-compiler-lockfile.json`](https://raw.githubusercontent.com/awesome-os/holo-v11/main/index/holo-compiler-lockfile.json)

## Quick Install & Run (Windows / Linux / macOS)

```sh
# Install / hydrate from Holo v11 CAS via holo-pm (0-byte hardlink into ./bin/)
holo-pm install repository://github.com/awesome-os/typescript@main

# Or project & run directly via holo-project (0-byte hardlink)
holo-project "project://node/typescript?from=repository://github.com/awesome-os/typescript@main"
```

## Ecosystem Alignment (5 Canonical Monorepos)

- [`awesome-os/awesome-os`](https://github.com/awesome-os/awesome-os) · [`awesome-os/chromium-baseline`](https://github.com/awesome-os/chromium-baseline) · [`awesome-os/agent-platform`](https://github.com/awesome-os/agent-platform) · [`awesome-os/t2linux-baseline`](https://github.com/awesome-os/t2linux-baseline) · [`awesome-os/devtools`](https://github.com/awesome-os/devtools)
- [`awesome-os/holo-v11`](https://github.com/awesome-os/holo-v11) (Global `v11` Registry) · [`awesome-os/maintenance-workflows`](https://github.com/awesome-os/maintenance-workflows) (`holo-ci@v1`)

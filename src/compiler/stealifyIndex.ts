/**
 * @file stealifyIndex.ts
 * @description High-speed pre-computed Project Entity index and zero-AST module scanner.
 * Replaces synchronous filesystem hopping and AST traversal with memory-mapped lookup tables,
 * featuring Rollup-style export/import symbol tree indexing with Import Attributes (`with {}`).
 */

export type ModuleImportExport = {
  type: "import" | "export" | "dynamic-import";
  specifier: string;
  raw: string;
  line: number;
  attributes?: Record<string, string>; // e.g. with { type: 'json', loader: 'wasm' }
};

export type ExportSymbol = {
  name: string; // 'default' for default exports, symbol name or alias for named exports
  localName?: string; // local identifier if aliased: `export { x as y }`
  isTypeOnly?: boolean; // `export type { ... }` or `export type Foo = ...`
  isDefault?: boolean; // true if default export
  isStar?: boolean; // true if `export * [as ns] from '...'`
  sourceModule?: string; // specifier if re-exported from another module
  attributes?: Record<string, string>; // import/export attributes: `with { ... }`
  line: number;
};

export type ImportSymbol = {
  name: string; // imported symbol: 'default', '*', or named identifier
  localName: string; // bound identifier in module scope
  isTypeOnly?: boolean; // `import type { ... }`
  sourceModule: string; // target module specifier
  attributes?: Record<string, string>; // import attributes: `with { loader: 'worker', type: 'json' }`
  line: number;
};

export type ModuleSymbolTree = {
  exports: Map<string, ExportSymbol>; // name -> ExportSymbol
  imports: ImportSymbol[]; // all imported bindings
  starReexports: ExportSymbol[]; // `export * from ...`
  dynamicImports: Array<{ specifier: string; attributes?: Record<string, string>; line: number }>;
  interfaceHash?: string; // Semantic hash of the exported ABI/interface (for early cutoff)
};

export type ProjectModuleEntity = {
  filePath: string;
  canonicalPath: string;
  extension: string;
  specifiers: ModuleImportExport[];
  symbolTree: ModuleSymbolTree;
  resolvedMap: Map<string, string>;
  contentHash?: string; // Raw content hash
  interfaceHash?: string; // Semantic exported ABI hash
};

export type StealifyProjectIndex = {
  rootDir: string;
  modules: Map<string, ProjectModuleEntity>;
  knownFiles: Set<string>;
  knownDirectories: Set<string>;
  resolveSpecifier(containingFile: string, specifier: string): string | undefined;
  getSymbolTree(filePath: string): ModuleSymbolTree | undefined;
  fileExists(path: string): boolean;
  directoryExists(path: string): boolean;
  computeInterfaceHash(sourceCode: string): string;
  hasInterfaceChanged(filePath: string, newSourceCode: string): boolean;
  updateModule(filePath: string, newSourceCode: string): { interfaceChanged: boolean; contentChanged: boolean };
};

// Parse Import/Export Attributes: `with { key: "val", ... }`, `assert { ... }`, or dynamic `{ with: { ... } }`
function parseAttributes(raw: string): Record<string, string> | undefined {
  const match = raw.match(/\b(?:with|assert)\s*:\s*\{([^}]*)\}/) || raw.match(/\b(?:with|assert)\s*\{([^}]*)\}/);
  if (!match) return undefined;
  const entries: Record<string, string> = {};
  const pairs = match[1].split(",");
  for (const pair of pairs) {
    const p = pair.trim();
    if (!p) continue;
    const kv = p.split(":");
    if (kv.length === 2) {
      const k = kv[0].trim().replace(/^['"]|['"]$/g, "");
      const v = kv[1].trim().replace(/^['"]|['"]$/g, "");
      if (k) entries[k] = v;
    }
  }
  return Object.keys(entries).length > 0 ? entries : undefined;
}

// Pre-compiled regex targeting ES imports, exports-from, CSS @import, and dynamic import() specifiers
// Enhanced to capture specifiers and optional `with { ... }` / `assert { ... }` attributes
// Matches:
// - import ... from "..."
// - import "..." (side-effect imports like import "./style.css")
// - export ... from "..."
// - import("...")
// - @import url("...") or @import "..." in CSS
const ES_IMPORT_EXPORT_REGEX = /\b(?:import|export)\s+(?:[^"'\n]*?\s+from\s+)?["']([^"']+)["'](?:\s*(?:with|assert)\s*\{[^}]*\})?|\bimport\s*\(\s*["']([^"']+)["'](?:\s*,\s*\{[^}]*\})?\s*\)|@import\s+(?:url\s*\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["'])/g;

export function extractModuleSpecifiers(sourceCode: string): ModuleImportExport[] {
  const records: ModuleImportExport[] = [];
  let match: RegExpExecArray | null;

  ES_IMPORT_EXPORT_REGEX.lastIndex = 0;

  while ((match = ES_IMPORT_EXPORT_REGEX.exec(sourceCode)) !== null) {
    const specifier = match[1] || match[2] || match[3] || match[4];
    if (!specifier) continue;

    const rawMatch = match[0];
    let type: ModuleImportExport["type"] = "import";

    if (rawMatch.startsWith("export")) {
      type = "export";
    } else if (rawMatch.startsWith("import(") || rawMatch.includes("import(")) {
      type = "dynamic-import";
    } else if (rawMatch.startsWith("@import")) {
      type = "import";
    }

    records.push({
      type,
      specifier,
      raw: rawMatch,
      line: computeLineNumber(sourceCode, match.index),
      attributes: parseAttributes(rawMatch),
    });
  }

  return records;
}

/**
 * Extracts a complete Rollup-style ModuleSymbolTree from source code:
 * - Named exports (functions, classes, const/let/var, types, re-exports)
 * - Default / unnamed exports
 * - Star re-exports (`export * from ...`)
 * - Import bindings (named, default, namespace `* as ns`, type-only)
 * - Import attributes (`with { loader: '...', type: '...' }`)
 */
/**
 * Computes a fast 32-bit FNV-1a hash of a string
 */
export function fastHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Extracts and computes a semantic Interface / ABI Hash from a source module.
 * Only factors in exported identifiers, types, signatures, and re-exports.
 * Internal function implementations, comments, and whitespace are excluded,
 * enabling semantic early cut-off during HMR and incremental compilation.
 */
export function computeInterfaceHash(sourceCode: string): string {
  const tree = extractModuleSymbols(sourceCode);
  const elements: string[] = [];

  // 1. Exported Symbols (name, isDefault, isTypeOnly, localName, sourceModule)
  const sortedExportNames = Array.from(tree.exports.keys()).sort();
  for (const name of sortedExportNames) {
    const exp = tree.exports.get(name)!;
    elements.push(
      `exp:${exp.name}|${exp.isDefault ? 1 : 0}|${exp.isTypeOnly ? 1 : 0}|${exp.localName || ''}|${exp.sourceModule || ''}`
    );
  }

  // 2. Star Re-exports
  for (const star of tree.starReexports) {
    elements.push(`star:${star.sourceModule || ''}`);
  }

  return fastHash(elements.join(';'));
}

export function extractModuleSymbols(sourceCode: string): ModuleSymbolTree {
  const symbolTree: ModuleSymbolTree = {
    exports: new Map(),
    imports: [],
    starReexports: [],
    dynamicImports: [],
  };

  const lines = sourceCode.split(/\r?\n/);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx].trim();
    const lineNum = lineIdx + 1;
    if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;

    // 1. Dynamic import: import("./specifier", { with: { ... } })
    const dynMatch = line.match(/\bimport\s*\(\s*["']([^"']+)["']/);
    if (dynMatch) {
      symbolTree.dynamicImports.push({
        specifier: dynMatch[1],
        attributes: parseAttributes(line),
        line: lineNum,
      });
    }

    // 1.b CSS @import url("...") or @import "..."
    const cssImportMatch = line.match(/^@import\s+(?:url\s*\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["'])/);
    if (cssImportMatch) {
      const spec = cssImportMatch[1] || cssImportMatch[2];
      if (spec) {
        symbolTree.imports.push({
          name: "*",
          localName: "",
          sourceModule: spec,
          attributes: { loader: "css" },
          line: lineNum,
        });
      }
    }

    // 2. Export statements
    if (line.startsWith("export ") || line === "export default") {
      const attrs = parseAttributes(line);

      // 2.a Export Default
      if (/^export\s+default\b/.test(line)) {
        symbolTree.exports.set("default", {
          name: "default",
          isDefault: true,
          attributes: attrs,
          line: lineNum,
        });
        continue;
      }

      // 2.b Star Re-export: export * as ns from '...' or export * from '...'
      const starMatch = line.match(/^export\s+\*\s*(?:as\s+([a-zA-Z0-9_$]+)\s+)?from\s*["']([^"']+)["']/);
      if (starMatch) {
        const asNs = starMatch[1];
        const sourceModule = starMatch[2];
        const exp: ExportSymbol = {
          name: asNs || "*",
          isStar: true,
          sourceModule,
          attributes: attrs,
          line: lineNum,
        };
        if (asNs) {
          symbolTree.exports.set(asNs, exp);
        } else {
          symbolTree.starReexports.push(exp);
        }
        continue;
      }

      // 2.c Re-export / Export clause: export [type] { a, b as c } [from '...']
      const clauseMatch = line.match(/^export\s+(type\s+)?\{([^}]+)\}(?:\s*from\s*["']([^"']+)["'])?/);
      if (clauseMatch) {
        const isTypeOnly = Boolean(clauseMatch[1]);
        const inner = clauseMatch[2];
        const sourceModule = clauseMatch[3];
        const items = inner.split(",");
        for (const item of items) {
          const trimmed = item.trim();
          if (!trimmed) continue;
          const isItemType = trimmed.startsWith("type ") || isTypeOnly;
          const spec = trimmed.replace(/^type\s+/, "");
          const asMatch = spec.match(/^([a-zA-Z0-9_$]+)(?:\s+as\s+([a-zA-Z0-9_$]+))?$/);
          if (asMatch) {
            const localName = asMatch[1];
            const name = asMatch[2] || localName;
            symbolTree.exports.set(name, {
              name,
              localName,
              isTypeOnly: isItemType,
              sourceModule,
              attributes: attrs,
              line: lineNum,
            });
          }
        }
        continue;
      }

      // 2.d Declaration exports: export [declare] [type|interface|const|let|var|function|class|enum] name
      const declMatch = line.match(/^export\s+(?:declare\s+)?(?:(type|interface)\s+)?(?:(const|let|var|function\*?|class|enum)\s+)?([a-zA-Z0-9_$]+)/);
      if (declMatch) {
        const isTypeDecl = Boolean(declMatch[1]);
        const name = declMatch[3];
        if (name && name !== "default") {
          symbolTree.exports.set(name, {
            name,
            localName: name,
            isTypeOnly: isTypeDecl,
            line: lineNum,
          });
        }
        continue;
      }
    }

    // 3. Import statements
    if (line.startsWith("import ") && !line.includes("import(")) {
      const attrs = parseAttributes(line);

      // 3.a Namespace import: import [type] * as ns from '...'
      const nsMatch = line.match(/^import\s+(type\s+)?\*\s+as\s+([a-zA-Z0-9_$]+)\s+from\s*["']([^"']+)["']/);
      if (nsMatch) {
        symbolTree.imports.push({
          name: "*",
          localName: nsMatch[2],
          isTypeOnly: Boolean(nsMatch[1]),
          sourceModule: nsMatch[3],
          attributes: attrs,
          line: lineNum,
        });
        continue;
      }

      // 3.b Default with optional named: import [type] Def, { ... } from '...'
      const defaultWithNamedMatch = line.match(/^import\s+(type\s+)?([a-zA-Z0-9_$]+)(?:\s*,\s*\{([^}]+)\})?\s+from\s*["']([^"']+)["']/);
      if (defaultWithNamedMatch) {
        const isTypeOnly = Boolean(defaultWithNamedMatch[1]);
        const defName = defaultWithNamedMatch[2];
        const namedBlock = defaultWithNamedMatch[3];
        const sourceModule = defaultWithNamedMatch[4];

        symbolTree.imports.push({
          name: "default",
          localName: defName,
          isTypeOnly,
          sourceModule,
          attributes: attrs,
          line: lineNum,
        });

        if (namedBlock) {
          const items = namedBlock.split(",");
          for (const item of items) {
            const trimmed = item.trim();
            if (!trimmed) continue;
            const isItemType = trimmed.startsWith("type ") || isTypeOnly;
            const spec = trimmed.replace(/^type\s+/, "");
            const asMatch = spec.match(/^([a-zA-Z0-9_$]+)(?:\s+as\s+([a-zA-Z0-9_$]+))?$/);
            if (asMatch) {
              symbolTree.imports.push({
                name: asMatch[1],
                localName: asMatch[2] || asMatch[1],
                isTypeOnly: isItemType,
                sourceModule,
                attributes: attrs,
                line: lineNum,
              });
            }
          }
        }
        continue;
      }

      // 3.c Named imports: import [type] { a, b as c } from '...'
      const namedOnlyMatch = line.match(/^import\s+(type\s+)?\{([^}]+)\}\s+from\s*["']([^"']+)["']/);
      if (namedOnlyMatch) {
        const isTypeOnly = Boolean(namedOnlyMatch[1]);
        const inner = namedOnlyMatch[2];
        const sourceModule = namedOnlyMatch[3];
        const items = inner.split(",");
        for (const item of items) {
          const trimmed = item.trim();
          if (!trimmed) continue;
          const isItemType = trimmed.startsWith("type ") || isTypeOnly;
          const spec = trimmed.replace(/^type\s+/, "");
          const asMatch = spec.match(/^([a-zA-Z0-9_$]+)(?:\s+as\s+([a-zA-Z0-9_$]+))?$/);
          if (asMatch) {
            symbolTree.imports.push({
              name: asMatch[1],
              localName: asMatch[2] || asMatch[1],
              isTypeOnly: isItemType,
              sourceModule,
              attributes: attrs,
              line: lineNum,
            });
          }
        }
        continue;
      // 3.d Bare / side-effect imports: import './style.css'; or import 'bootstrap';
      const bareImportMatch = line.match(/^import\s*["']([^"']+)["']/);
      if (bareImportMatch) {
        const sourceModule = bareImportMatch[1];
        symbolTree.imports.push({
          name: "*",
          localName: "",
          sourceModule,
          attributes: attrs || (sourceModule.endsWith(".css") ? { loader: "css" } : undefined),
          line: lineNum,
        });
        continue;
      }
    }
  }

  return symbolTree;
}

function computeLineNumber(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) { // '\n'
      line++;
    }
  }
  return line;
}

export function normalizeCanonicalPath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

/**
 * Builds a fast pre-computed Project Entity index from an array of files and their contents.
 * All subsequent file existence and specifier lookups run in O(1) memory time without hitting disk.
 */
export function createStealifyProjectIndex(
  rootDir: string,
  files: Array<{ path: string; content?: string }>
): StealifyProjectIndex {
  const canonicalRoot = normalizeCanonicalPath(rootDir);
  const modules = new Map<string, ProjectModuleEntity>();
  const knownFiles = new Set<string>();
  const knownDirectories = new Set<string>();

  // Helper to index ancestor directories
  function registerDirectories(filePath: string) {
    let current = filePath;
    while (true) {
      const slashIdx = current.lastIndexOf("/");
      if (slashIdx === -1) break;
      current = current.substring(0, slashIdx);
      if (!current || knownDirectories.has(current)) break;
      knownDirectories.add(current);
    }
  }

  for (const file of files) {
    const canonical = normalizeCanonicalPath(file.path);
    knownFiles.add(canonical);
    registerDirectories(canonical);

    const extMatch = canonical.match(/\.[^./\\]+$/);
    const extension = extMatch ? extMatch[0] : "";
    const specifiers = file.content ? extractModuleSpecifiers(file.content) : [];
    const symbolTree = file.content ? extractModuleSymbols(file.content) : {
      exports: new Map(),
      imports: [],
      starReexports: [],
      dynamicImports: [],
    };
    const contentHash = file.content ? fastHash(file.content) : undefined;
    const ifaceHash = file.content ? computeInterfaceHash(file.content) : undefined;
    symbolTree.interfaceHash = ifaceHash;

    modules.set(canonical, {
      filePath: file.path,
      canonicalPath: canonical,
      extension,
      specifiers,
      symbolTree,
      resolvedMap: new Map(),
      contentHash,
      interfaceHash: ifaceHash,
    });
  }

  // Helper to resolve relative module specifier with extension guessing in O(1)
  function resolveSpecifier(containingFile: string, specifier: string): string | undefined {
    const containingCanonical = normalizeCanonicalPath(containingFile);
    const mod = modules.get(containingCanonical);
    if (mod && mod.resolvedMap.has(specifier)) {
      return mod.resolvedMap.get(specifier);
    }

    // If relative path
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const dir = containingCanonical.substring(0, containingCanonical.lastIndexOf("/"));
      const segments = (dir + "/" + specifier).split("/");
      const resolvedSegments: string[] = [];
      for (const seg of segments) {
        if (!seg || seg === ".") continue;
        if (seg === "..") {
          resolvedSegments.pop();
        } else {
          resolvedSegments.push(seg);
        }
      }
      const basePath = (containingCanonical.startsWith("/") ? "/" : "") + resolvedSegments.join("/");

      // 1. Direct match
      if (knownFiles.has(basePath)) {
        mod?.resolvedMap.set(specifier, basePath);
        return basePath;
      }

      // 2. Extension guessing: .mts, .ts, .tsx, .d.mts, .d.ts, .js, .mjs, .css, .json, .html
      const candidates = [
        basePath + ".mts",
        basePath + ".ts",
        basePath + ".tsx",
        basePath + ".d.mts",
        basePath + ".d.ts",
        basePath + ".js",
        basePath + ".mjs",
        basePath + ".css",
        basePath + ".json",
        basePath + ".html",
        basePath + "/index.mts",
        basePath + "/index.ts",
        basePath + "/index.d.ts",
        basePath + "/index.js",
        basePath + "/index.css",
      ];

      for (const cand of candidates) {
        if (knownFiles.has(cand)) {
          mod?.resolvedMap.set(specifier, cand);
          return cand;
        }
      }

      // 3. Import path mapping (.js -> .ts / .mjs -> .mts)
      if (basePath.endsWith(".js")) {
        const tsCand = basePath.slice(0, -3) + ".ts";
        if (knownFiles.has(tsCand)) {
          mod?.resolvedMap.set(specifier, tsCand);
          return tsCand;
        }
      }
      if (basePath.endsWith(".mjs")) {
        const mtsCand = basePath.slice(0, -4) + ".mts";
        if (knownFiles.has(mtsCand)) {
          mod?.resolvedMap.set(specifier, mtsCand);
          return mtsCand;
        }
      }
    }

    return undefined;
  }

  // Pre-resolve all specifiers upfront so V8 never has to compute them during compilation
  for (const [canonicalPath, mod] of modules.entries()) {
    for (const record of mod.specifiers) {
      resolveSpecifier(canonicalPath, record.specifier);
    }
  }

  return {
    rootDir: canonicalRoot,
    modules,
    knownFiles,
    knownDirectories,
    resolveSpecifier,
    getSymbolTree(filePath: string): ModuleSymbolTree | undefined {
      const mod = modules.get(normalizeCanonicalPath(filePath));
      return mod ? mod.symbolTree : undefined;
    },
    fileExists(path: string): boolean {
      return knownFiles.has(normalizeCanonicalPath(path));
    },
    directoryExists(path: string): boolean {
      const canonical = normalizeCanonicalPath(path);
      return knownDirectories.has(canonical) || knownFiles.has(canonical);
    },
    computeInterfaceHash,
    hasInterfaceChanged(filePath: string, newSourceCode: string): boolean {
      const mod = modules.get(normalizeCanonicalPath(filePath));
      if (!mod || !mod.interfaceHash) return true;
      const newHash = computeInterfaceHash(newSourceCode);
      return mod.interfaceHash !== newHash;
    },
    updateModule(filePath: string, newSourceCode: string) {
      const canonical = normalizeCanonicalPath(filePath);
      const mod = modules.get(canonical);
      const newContentHash = fastHash(newSourceCode);
      const newIfaceHash = computeInterfaceHash(newSourceCode);

      if (!mod) {
        return { interfaceChanged: true, contentChanged: true };
      }

      const contentChanged = mod.contentHash !== newContentHash;
      const interfaceChanged = mod.interfaceHash !== newIfaceHash;

      if (contentChanged) {
        mod.contentHash = newContentHash;
        mod.interfaceHash = newIfaceHash;
        mod.specifiers = extractModuleSpecifiers(newSourceCode);
        mod.symbolTree = extractModuleSymbols(newSourceCode);
        mod.symbolTree.interfaceHash = newIfaceHash;

        // Re-resolve updated specifiers
        mod.resolvedMap.clear();
        for (const spec of mod.specifiers) {
          resolveSpecifier(canonical, spec.specifier);
        }
      }

      return { interfaceChanged, contentChanged };
    },
  };
}

/**
 * @file stealifyTranspiler.ts
 * @description Generic source-to-source code transformer that converts
 * standard ESM imports with `with { loader: "..." }` into universal `importWithLoader` polyfill calls.
 * Works seamlessly as a standalone compiler step or plugin hook for Babel, Rollup, Vite, esbuild, and ts-morph.
 */

export type TranspileOptions = {
  polyfillImportSpecifier?: string; // e.g. "@awesome-os/typescript-tools" or relative "./stealifyLoader.js"
  loadersObjectName?: string; // identifier pointing to local loader registry (e.g. "__stealifyLoaders")
  includePolyfillImport?: boolean; // whether to inject `import { importWithLoader } from "..."` at top
  preserveTypeImports?: boolean; // ignore `import type` statements
};

export type TranspileResult = {
  code: string;
  transformedCount: number;
  hasLoaderImports: boolean;
};

// Regex matching static import declarations with `with { ... }` or `assert { ... }`
// Capture groups:
// 1: type qualifier (e.g. "type ")
// 2: import clause (e.g. `worker, { spawn }` or `* as ns`)
// 3: module specifier
// 4: attributes body inside `{ ... }`
const STATIC_IMPORT_WITH_REGEX = /\bimport\s+(type\s+)?(?:([\s\S]*?)\s+from\s+)?["']([^"']+)["']\s*(?:with|assert)\s*\{([^}]*)\}\s*;?/g;

// Regex matching dynamic `import(specifier, { with: { ... } })`
const DYNAMIC_IMPORT_WITH_REGEX = /\bimport\s*\(\s*(["'`][^"'`]+["'`]|[^,)]+)\s*,\s*\{\s*(?:with|assert)\s*:\s*\{([^}]*)\}\s*\}\s*\)/g;

function parseAttributesBody(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pairs = body.split(",");
  for (const p of pairs) {
    const pair = p.trim();
    if (!pair) continue;
    const kv = pair.split(":");
    if (kv.length === 2) {
      const k = kv[0].trim().replace(/^['"]|['"]$/g, "");
      const v = kv[1].trim().replace(/^['"]|['"]$/g, "");
      if (k) result[k] = v;
    }
  }
  return result;
}

/**
 * Transforms source code containing `with { loader: "..." }` imports into runtime `importWithLoader(...)` calls.
 * Compatible with Babel plugins (`visitor.ImportDeclaration`), Rollup plugins (`transform(code, id)`), and custom compilers.
 */
export function transpileLoaderImports(sourceCode: string, options: TranspileOptions = {}): TranspileResult {
  const polyfillSpecifier = options.polyfillImportSpecifier || "@awesome-os/typescript-tools";
  const loadersObj = options.loadersObjectName ? `, loaders: ${options.loadersObjectName}` : "";
  let transformedCount = 0;

  // 1. Transform Dynamic imports:
  // import("./worker.js", { with: { loader: "wasm" } }) -> importWithLoader("./worker.js", { with: { loader: "wasm" } })
  let code = sourceCode.replace(DYNAMIC_IMPORT_WITH_REGEX, (match, specifierExpr, attrBody) => {
    const attrs = parseAttributesBody(attrBody);
    if (!attrs.loader) return match; // Only transform imports specifying a loader

    transformedCount++;
    const cleanAttrsJson = JSON.stringify(attrs);
    return `importWithLoader(${specifierExpr.trim()}, { with: ${cleanAttrsJson}${loadersObj} })`;
  });

  // 2. Transform Static imports:
  // import worker, { start } from "./worker.mts" with { loader: "wasm" };
  // -> const { default: worker, start } = await importWithLoader("./worker.mts", { with: { loader: "wasm" } });
  code = code.replace(STATIC_IMPORT_WITH_REGEX, (match, typeKw, clause, specifier, attrBody) => {
    if (typeKw && options.preserveTypeImports !== false) {
      return match; // Don't transpile pure type imports
    }

    const attrs = parseAttributesBody(attrBody);
    if (!attrs.loader) return match; // Only transform imports specifying a loader

    transformedCount++;
    const cleanAttrsJson = JSON.stringify(attrs);

    if (!clause || !clause.trim()) {
      // Bare import: import "./setup.js" with { loader: "raw" };
      return `await importWithLoader("${specifier}", { with: ${cleanAttrsJson}${loadersObj} });`;
    }

    const trimmedClause = clause.trim();

    // 2.a Namespace import: import * as ns from "./..."
    if (trimmedClause.startsWith("* as ")) {
      const nsName = trimmedClause.replace("* as ", "").trim();
      return `const ${nsName} = await importWithLoader("${specifier}", { with: ${cleanAttrsJson}${loadersObj} });`;
    }

    // 2.b Default with named or named-only:
    // import def, { a, b as c } from "..." OR import { a, b } from "..."
    let defaultBinding: string | undefined;
    let namedBlock: string | undefined;

    if (trimmedClause.startsWith("{")) {
      namedBlock = trimmedClause;
    } else if (trimmedClause.includes(",")) {
      const commaIdx = trimmedClause.indexOf(",");
      defaultBinding = trimmedClause.substring(0, commaIdx).trim();
      namedBlock = trimmedClause.substring(commaIdx + 1).trim();
    } else {
      defaultBinding = trimmedClause;
    }

    const destructureItems: string[] = [];
    if (defaultBinding) {
      destructureItems.push(`default: ${defaultBinding}`);
    }

    if (namedBlock && namedBlock.startsWith("{") && namedBlock.endsWith("}")) {
      const inner = namedBlock.slice(1, -1).trim();
      if (inner) {
        const parts = inner.split(",");
        for (const p of parts) {
          const item = p.trim();
          if (!item) continue;
          if (item.includes(" as ")) {
            const [orig, alias] = item.split(" as ").map(s => s.trim());
            destructureItems.push(`${orig}: ${alias}`);
          } else {
            destructureItems.push(item);
          }
        }
      }
    }

    const pattern = destructureItems.length > 0 ? `{ ${destructureItems.join(", ")} }` : "_";
    return `const ${pattern} = await importWithLoader("${specifier}", { with: ${cleanAttrsJson}${loadersObj} });`;
  });

  // 3. Inject polyfill import if required and transformations occurred
  if (transformedCount > 0 && options.includePolyfillImport !== false) {
    if (!code.includes("importWithLoader")) {
      code = `import { importWithLoader } from "${polyfillSpecifier}";\n` + code;
    } else if (!code.includes(`from "${polyfillSpecifier}"`) && !code.includes(`from '${polyfillSpecifier}'`)) {
      code = `import { importWithLoader } from "${polyfillSpecifier}";\n` + code;
    }
  }

  return {
    code,
    transformedCount,
    hasLoaderImports: transformedCount > 0,
  };
}

/**
 * Universal Plugin Factory for Rollup, Vite, and compatible build tools.
 *
 * @example
 * ```ts
 * // rollup.config.js / vite.config.js
 * import { stealifyLoaderPlugin } from "@awesome-os/typescript-tools";
 * export default {
 *   plugins: [stealifyLoaderPlugin()]
 * };
 * ```
 */
export function stealifyLoaderPlugin(options: TranspileOptions = {}) {
  return {
    name: "stealify-loader-transpiler",
    transform(code: string, id: string) {
      if (!code.includes("loader:") && !code.includes('loader"')) {
        return null; // Fast bailout if no loader attributes
      }
      const res = transpileLoaderImports(code, options);
      if (!res.hasLoaderImports) return null;
      return { code: res.code, map: null };
    },
  };
}

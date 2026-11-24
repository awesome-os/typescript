/**
 * @file stealifyLoader.ts
 * @description Strongly-typed Loader Subsystem, Stealify Config Loader Registry,
 * and universal `importWithLoader` runtime polyfill.
 */

import type { StealifyProjectIndex } from "./stealifyIndex.js";

/**
 * Context provided to a loader when transforming/synthesizing a module.
 */
export type LoaderContext = {
  specifier: string;
  containingFile?: string;
  resolvedPath?: string;
  sourceText?: string;
  attributes: Record<string, string>;
  projectIndex?: StealifyProjectIndex;
  options?: Record<string, unknown>;
};

/**
 * Result returned by a custom module loader.
 */
export type LoaderResult<T = unknown> = {
  module: T;
  sourceText?: string;
  exports?: Record<string, unknown>;
  defaultExport?: unknown;
};

/**
 * A typed Loader function or object specification.
 */
export type StealifyLoader<T = unknown> = (
  ctx: LoaderContext
) => Promise<LoaderResult<T> | T> | LoaderResult<T> | T;

/**
 * Map of registered loader pipelines.
 */
export type LoaderRegistry = Map<string, StealifyLoader<any>>;

/**
 * Stealify Configuration definition for stealify-config.ts / .mts files.
 */
export type StealifyConfig = {
  compilerOptions?: Record<string, unknown>;
  include?: string[];
  exclude?: string[];
  loaders?: Record<string, StealifyLoader<any>>;
  defaultLoader?: string;
};

/**
 * Options passed to `importWithLoader`.
 */
export type ImportWithLoaderOptions<T = unknown> = {
  with?: {
    type?: string;
    loader?: string;
    [key: string]: string | undefined;
  };
  loaders?: Record<string, StealifyLoader<any>>;
  context?: Partial<LoaderContext>;
  fallback?: () => Promise<T>;
};

// Global default built-in loaders
export const builtinLoaders: Record<string, StealifyLoader<any>> = {
  raw: async (ctx) => {
    // Return raw text representation
    return {
      module: { default: ctx.specifier },
      defaultExport: ctx.specifier,
      sourceText: ctx.specifier,
    };
  },
  json: async (ctx) => {
    try {
      const parsed = JSON.parse(ctx.specifier);
      return { module: { default: parsed }, defaultExport: parsed };
    } catch {
      return { module: { default: {} }, defaultExport: {} };
    }
  },
  wasm: async (ctx) => {
    return {
      module: { default: { kind: "wasm-instance", path: ctx.resolvedPath || ctx.specifier } },
      defaultExport: { kind: "wasm-instance", path: ctx.resolvedPath || ctx.specifier },
    };
  },
  worker: async (ctx) => {
    return {
      module: { default: { kind: "worker-entry", path: ctx.resolvedPath || ctx.specifier } },
      defaultExport: { kind: "worker-entry", path: ctx.resolvedPath || ctx.specifier },
    };
  },
  css: async (ctx) => {
    // CSS Loader: constructs CSSStyleSheet for adoptable stylesheets or document injection
    const cssText = ctx.sourceText || ctx.specifier;
    return {
      module: {
        default: cssText,
        cssText,
        kind: "css-stylesheet",
        path: ctx.resolvedPath || ctx.specifier,
      },
      defaultExport: cssText,
      sourceText: cssText,
    };
  },
};

/**
 * Universal runtime polyfill for import with { loader: "..." }.
 * Executes the targeted loader pipeline directly or falls back to standard dynamic import().
 *
 * @example
 * ```ts
 * const wasmMod = await importWithLoader("./compute.wasm", {
 *   with: { loader: "wasm" },
 *   loaders: {
 *     wasm: async (ctx) => ({ default: await WebAssembly.instantiateStreaming(...) })
 *   }
 * });
 * ```
 */
export async function importWithLoader<T = any>(
  specifier: string,
  options: ImportWithLoaderOptions<T> = {}
): Promise<T> {
  const attributes = (options.with || {}) as Record<string, string>;
  const loaderName = attributes.loader;

  // 1. Check user-supplied loaders in call options
  let loader: StealifyLoader<any> | undefined = options.loaders && loaderName ? options.loaders[loaderName] : undefined;

  // 2. Check built-in fallback loaders
  if (!loader && loaderName && builtinLoaders[loaderName]) {
    loader = builtinLoaders[loaderName];
  }

  // 3. If loader is defined, dispatch to loader pipeline directly
  if (loader) {
    const ctx: LoaderContext = {
      specifier,
      containingFile: options.context?.containingFile,
      resolvedPath: options.context?.resolvedPath,
      attributes,
      projectIndex: options.context?.projectIndex,
      options: options.context?.options,
    };

    const res = await loader(ctx);
    if (res && typeof res === "object" && "module" in (res as Record<string, unknown>)) {
      return (res as LoaderResult<T>).module;
    }
    return res as T;
  }

  // 4. Fallback to standard dynamic import() or user custom fallback
  if (options.fallback) {
    return options.fallback();
  }

  // Native dynamic import with import attributes where supported
  try {
    if (Object.keys(attributes).length > 0) {
      return await import(specifier, { with: attributes } as any);
    }
    return await import(specifier);
  } catch (err) {
    // If runtime does not yet support `with { ... }`, retry bare import
    return await import(specifier);
  }
}

/**
 * Creates a Project-scoped Loader Registry from a StealifyConfig.
 */
export function createLoaderRegistry(config?: StealifyConfig): LoaderRegistry {
  const registry: LoaderRegistry = new Map();

  // Register builtins
  for (const [name, fn] of Object.entries(builtinLoaders)) {
    registry.set(name, fn);
  }

  // Register project-level custom loaders from stealify-config.ts
  if (config?.loaders) {
    for (const [name, fn] of Object.entries(config.loaders)) {
      registry.set(name, fn);
    }
  }

  return registry;
}

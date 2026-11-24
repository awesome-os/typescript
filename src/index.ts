/**
 * @file Apps/typescript-tools/src/index.ts
 * @description Modern Top-Level Static ESM Facade for TypeScript.
 *              Unifies compiler, services, server, and language tooling without circular emulation barrels.
 */

// Core Compiler Layer
export * from "./compiler/corePublic.js";
export * from "./compiler/core.js";
export * from "./compiler/debug.js";
export * from "./compiler/semver.js";
export * from "./compiler/performanceCore.js";
export * from "./compiler/tracing.js";
export * from "./compiler/types.js";
export * from "./compiler/sys.js";
export * from "./compiler/path.js";
export * from "./compiler/scanner.js";
export * from "./compiler/utilitiesPublic.js";
export * from "./compiler/utilities.js";
export * from "./compiler/parser.js";
export * from "./compiler/commandLineParser.js";
export * from "./compiler/moduleNameResolver.js";
export * from "./compiler/binder.js";
export * from "./compiler/symbolWalker.js";
export * from "./compiler/checker.js";
export * from "./compiler/visitorPublic.js";
export * from "./compiler/sourcemap.js";
export * from "./compiler/transformer.js";
export * from "./compiler/emitter.js";
export * from "./compiler/program.js";
export * from "./compiler/builder.js";
export * from "./compiler/resolutionCache.js";
export * from "./compiler/watch.js";
export * from "./compiler/executeCommandLine.js";
export * from "./compiler/stealifyIndex.js";
export * from "./compiler/stealifyLoader.js";
export * from "./compiler/stealifyTranspiler.js";

// Factory Subsystem
export * from "./compiler/factory/baseNodeFactory.js";
export * from "./compiler/factory/nodeFactory.js";
export * from "./compiler/factory/nodeTests.js";
export * from "./compiler/factory/utilities.js";

// Language Services Layer
export * from "./services/types.js";
export * from "./services/utilities.js";
export * from "./services/services.js";

// Server & Typings Layer
export * from "./server/types.js";
export * from "./server/session.js";
export * from "./jsTyping/types.js";

// Default namespace export matching modern ESM conventions
import * as ts from "./index.js";
export default ts;


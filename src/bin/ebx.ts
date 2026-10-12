#!/usr/bin/env node
/**
 * `ebx` executable. The real entry point is `ebx_main.ts`; it is loaded dynamically so that this shim can first drop
 * Node's own `FORCE_COLOR` / `NO_COLOR` conflict warning. Node emits it while linking the ESM facade of `node:http`,
 * i.e. before any module of the CLI runs, and Python's `ebx` prints nothing in that situation.
 */

const emitWarning = process.emitWarning;
process.emitWarning = function patchedEmitWarning(this: unknown, warning: string | Error, ...rest: unknown[]): void {
  if (typeof warning === "string" && warning.startsWith("The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR'")) return;
  (emitWarning as (...a: unknown[]) => void).call(process, warning, ...rest);
} as typeof process.emitWarning;

// Not top-level await: the standalone binary is a CommonJS single-executable, which cannot
// carry a top-level await. The import promise keeps the process alive until the CLI exits.
void import("./ebx_main.js");

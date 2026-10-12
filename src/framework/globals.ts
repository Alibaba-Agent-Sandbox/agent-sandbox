/**
 * `click.globals`: the "current context" (`click.get_current_context()`).
 *
 * Click keeps a thread-local stack. In Node the equivalent that survives `await` boundaries is an
 * `AsyncLocalStorage`: every `Context.scope()` runs its body inside `als.run(ctx, ...)`, so code that executes
 * (synchronously or asynchronously) below a command invocation sees that invocation's context.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "./core.js";

export const contextStorage = new AsyncLocalStorage<Context>();

/** `click.get_current_context(silent=False)`: raises `RuntimeError` when there is no active context. */
export function getCurrentContext(silent: true): Context | undefined;
export function getCurrentContext(silent?: false): Context;
export function getCurrentContext(silent?: boolean): Context | undefined;
export function getCurrentContext(silent = false): Context | undefined {
  const ctx = contextStorage.getStore();
  if (ctx === undefined && !silent) throw new RuntimeError("There is no active click context.");
  return ctx;
}

/** `click.globals.resolve_color_default`. */
export function resolveColorDefault(color?: boolean | null): boolean | null {
  if (color !== undefined && color !== null) return color;
  const ctx = getCurrentContext(true);
  if (ctx !== undefined) return ctx.color;
  return null;
}

/** Python `RuntimeError`. */
export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

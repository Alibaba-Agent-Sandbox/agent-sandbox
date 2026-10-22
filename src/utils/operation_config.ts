/** Configuration values confined to one asynchronous host operation. No I/O or process environment mutation. */
import { AsyncLocalStorage } from "node:async_hooks";

const operations = new AsyncLocalStorage<Readonly<Record<string, unknown>>>();

/** Read the current operation's explicit configuration, without exposing it in diagnostics. */
export function getOperationConfig(): Readonly<Record<string, unknown>> | undefined {
  return operations.getStore();
}

/** Execute one operation with validated values; nested operations inherit without leaking to other invocations. */
export function withOperationConfig<T>(values: Readonly<Record<string, unknown>>, action: () => T): T {
  return operations.run(Object.freeze({ ...operations.getStore(), ...values }), action);
}

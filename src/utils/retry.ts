/** Async retry decorator with exponential backoff (port of `utils/retry.py`). */

import { getLogger } from "./logging.js";

const logger = getLogger("utils.retry");

type AsyncFn<A extends unknown[], R> = (...args: A) => Promise<R>;

/** Exception constructors to retry on (Python's `retry_on` tuple of exception types). */
export type RetryOn = ReadonlyArray<abstract new (...args: never[]) => unknown>;

export interface RetryOptions {
  /** Maximum number of retry attempts. */
  max_retries?: number;
  /** Base delay in seconds (doubles each retry). */
  base_delay?: number;
  /** Maximum delay cap in seconds. */
  max_delay?: number;
  /** Maximum random jitter in seconds. */
  jitter?: number;
  /** Exception types to retry on (default: every `Error`/thrown value, like Python's `(Exception,)`). */
  retry_on?: RetryOn;
}

/**
 * The sleep seam used between attempts (Python tests patch `asyncio.sleep`). Replace via {@link _setSleep}.
 */
let _sleep: (seconds: number) => Promise<void> = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));

export function _setSleep(fn: ((seconds: number) => Promise<void>) | null): void {
  _sleep = fn ?? ((seconds) => new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000)));
}

function matches(exc: unknown, retryOn: RetryOn | undefined): boolean {
  if (!retryOn) return exc instanceof Error;
  return retryOn.some((C) => exc instanceof (C as unknown as abstract new (...a: never[]) => object));
}

/**
 * Async retry wrapper with exponential backoff (Python `@retry(...)` decorator).
 *
 * @example
 *   const fetchData = retry({ max_retries: 3, retry_on: [NetworkError] })(async () => { ... });
 */
export function retry(options: RetryOptions = {}) {
  const { max_retries = 3, base_delay = 1.0, max_delay = 30.0, jitter = 0.5, retry_on } = options;

  return function decorator<A extends unknown[], R>(func: AsyncFn<A, R>): AsyncFn<A, R> {
    const wrapper = async function (this: unknown, ...args: A): Promise<R> {
      let lastException: unknown = null;
      for (let attempt = 0; attempt <= max_retries; attempt++) {
        try {
          return await func.apply(this, args);
        } catch (exc) {
          if (!matches(exc, retry_on)) throw exc;
          lastException = exc;
          if (attempt === max_retries) {
            logger.debug(
              "Retry exhausted for %s after %d attempts: %s",
              func.name,
              max_retries + 1,
              exc,
            );
            throw exc;
          }

          // Check for Retry-After header
          const retryAfter = (exc as { retry_after?: unknown } | null)?.retry_after;
          let delay: number;
          if (retryAfter !== null && retryAfter !== undefined && typeof retryAfter === "number") {
            delay = Number(retryAfter);
          } else {
            delay = Math.min(base_delay * 2 ** attempt, max_delay);
          }

          delay += Math.random() * jitter;

          logger.debug("Retry %d/%d for %s after %.2fs: %s", attempt + 1, max_retries, func.name, delay, exc);
          await _sleep(delay);
        }
      }

      // Should not reach here, but just in case
      if (lastException !== null) throw lastException;
      throw new Error("RuntimeError: Unexpected retry loop exit");
    };
    Object.defineProperty(wrapper, "name", { value: func.name });
    return wrapper;
  };
}

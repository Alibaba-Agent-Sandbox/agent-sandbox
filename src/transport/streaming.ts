/**
 * Connect protocol Server-Streaming response parser.
 *
 * Handles NDJSON streaming from Connect protocol endpoints.  Provides a typed async iterator backed by a simple async
 * generator — backpressure is naturally provided by the HTTP response streaming (no queue needed).
 */

import { pyStr } from "../utils/_pyformat.js";
import { getLogger } from "../utils/logging.js";

const logger = getLogger("transport.streaming");

/**
 * Typed async iterator over Connect streaming frames.
 *
 * Wraps a raw frame iterator and applies a transform function to convert raw dicts into typed objects.
 */
export class StreamReader<T> implements AsyncIterableIterator<T> {
  _raw_frames: AsyncIterable<Record<string, any>> | AsyncIterator<Record<string, any>>;
  _transform: (frame: Record<string, any>) => T;
  _iter: AsyncGenerator<T> | null = null;
  _exhausted = false;
  _error: unknown = null;

  constructor(
    raw_frames: AsyncIterable<Record<string, any>> | AsyncIterator<Record<string, any>>,
    transform: (frame: Record<string, any>) => T,
  ) {
    this._raw_frames = raw_frames;
    this._transform = transform;
  }

  // --- internal generator ---------------------------------------------------

  /** Yield transformed items from the raw frame stream. */
  async *_generate(): AsyncGenerator<T> {
    const source = this._raw_frames as any;
    const iterator: AsyncIterator<Record<string, any>> =
      typeof source[Symbol.asyncIterator] === "function" ? source[Symbol.asyncIterator]() : source;
    let finished = false;
    try {
      for (;;) {
        const step = await iterator.next();
        if (step.done) {
          finished = true;
          break;
        }
        let item: T;
        try {
          item = this._transform(step.value);
        } catch (exc) {
          logger.warning("Frame transform error: %s", pyStr(exc));
          continue;
        }
        yield item;
      }
    } catch (exc) {
      finished = true;
      this._error = exc;
      logger.debug("Stream error: %s", pyStr(exc));
      throw exc;
    } finally {
      this._exhausted = true;
      if (!finished && typeof iterator.return === "function") {
        try {
          await iterator.return();
        } catch {
          /* ignore */
        }
      }
    }
  }

  // --- public API -----------------------------------------------------------

  [Symbol.asyncIterator](): StreamReader<T> {
    if (this._iter === null) this._iter = this._generate();
    return this;
  }

  async next(): Promise<IteratorResult<T>> {
    if (this._iter === null) this._iter = this._generate();
    const r = await (this._iter as AsyncGenerator<T>).next();
    if (r.done && this._error) {
      const err = this._error;
      throw err;
    }
    return r;
  }

  /** Early exit from `for await ... break` closes the underlying generator. */
  async return(value?: unknown): Promise<IteratorResult<T>> {
    if (this._iter !== null) await this._iter.return(value as never);
    return { done: true, value: undefined } as IteratorResult<T>;
  }

  /** Collect all frames into a list. */
  async collect(): Promise<T[]> {
    const result: T[] = [];
    for await (const item of this) result.push(item);
    return result;
  }

  /** Cancel the stream by closing the underlying async generator. */
  async cancel(): Promise<void> {
    if (this._iter !== null) {
      await this._iter.return(undefined as never);
      this._exhausted = true;
    }
  }
}

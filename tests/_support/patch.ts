/** Python `unittest.mock` equivalents used by the ported tests. */

import { vi } from "vitest";

import { httpx } from "../../src/transport/_httpx.js";

type Fn = ReturnType<typeof vi.fn>;

/** A mock usable as an async context manager (`AsyncMock` with `__aenter__`/`__aexit__`). */
export interface AsyncContextClient {
  get: Fn;
  post: Fn;
  request: Fn;
  __aenter__: Fn;
  __aexit__: Fn;
  [key: string]: unknown;
}

export function patchedAsyncClient(resp: unknown): AsyncContextClient {
  const mock: AsyncContextClient = {
    get: vi.fn(async () => resp),
    post: vi.fn(async () => resp),
    request: vi.fn(async () => resp),
    __aenter__: vi.fn(),
    __aexit__: vi.fn(async () => false),
  };
  mock.__aenter__.mockImplementation(async () => mock);
  return mock;
}

const _originals = new Map<string, unknown>();

/** `patch("httpx.AsyncClient", return_value=client)`; undone by {@link restoreHttpx}. */
export function patchHttpxAsyncClient(client: unknown): Fn {
  if (!_originals.has("AsyncClient")) _originals.set("AsyncClient", httpx.AsyncClient);
  const ctor = vi.fn(function () {
    return client;
  });
  (httpx as unknown as Record<string, unknown>)["AsyncClient"] = ctor;
  return ctor;
}

/** `patch("httpx.AsyncClient", side_effect=factory)` / `patch("httpx.AsyncClient", new=...)`. */
export function patchHttpxAsyncClientWith(factory: (...args: unknown[]) => unknown): Fn {
  if (!_originals.has("AsyncClient")) _originals.set("AsyncClient", httpx.AsyncClient);
  const ctor = vi.fn(function (...args: unknown[]) {
    return factory(...args);
  });
  (httpx as unknown as Record<string, unknown>)["AsyncClient"] = ctor;
  return ctor;
}

export function restoreHttpx(): void {
  for (const [k, v] of _originals) (httpx as unknown as Record<string, unknown>)[k] = v;
  _originals.clear();
}

/**
 * `pytest-httpx` (`httpx_mock` fixture) shared by the ported transport/utils/protocol tests
 * (`useHttpxMock()`; the single httpx mock helper of the suite).
 *
 * Installs a default transport on every `httpx.AsyncClient` created without one (via `_setDefaultTransportFactory`),
 * so production code paths are exercised unchanged. Semantics mirror pytest-httpx: responses/exceptions are matched
 * by method + URL (query compared as an unordered multiset); each registered entry is consumed once in registration
 * order, then the last matching one is re-used; an unmatched request raises `httpx.TimeoutException`; at teardown
 * every registered entry must have been requested and every request must have matched.
 */

import { afterEach, beforeEach } from "vitest";

import {
  MockTransport,
  Request,
  Response,
  TimeoutException,
  _setDefaultTransportFactory,
  type HeadersInit,
} from "../../src/transport/_httpx.js";

export interface AddResponseOptions {
  url?: string | RegExp;
  method?: string;
  status_code?: number;
  json?: unknown;
  text?: string;
  content?: string | Uint8Array;
  headers?: HeadersInit;
}

interface Registered {
  opts: AddResponseOptions;
  exception: Error | null;
  used: boolean;
}

function splitUrl(u: string): { base: string; query: string[] } {
  const parsed = new globalThis.URL(u);
  const query = [...parsed.searchParams.entries()].map(([k, v]) => `${k}=${v}`).sort();
  parsed.search = "";
  parsed.hash = "";
  return { base: parsed.href, query };
}

export class HttpxMock {
  assert_all_responses_were_requested = true;
  private _responses: Registered[] = [];
  private _requests: Request[] = [];
  private _unmatched: Request[] = [];

  reset(): void {
    this._responses = [];
    this._requests = [];
    this._unmatched = [];
    this.assert_all_responses_were_requested = true;
  }

  add_response(opts: AddResponseOptions = {}): void {
    this._responses.push({ opts, exception: null, used: false });
  }

  add_exception(exception: Error, opts: { url?: string | RegExp; method?: string } = {}): void {
    this._responses.push({ opts, exception, used: false });
  }

  get_requests(filter: { url?: string; method?: string } = {}): Request[] {
    return this._requests.filter(
      (r) =>
        (filter.method === undefined || r.method === filter.method.toUpperCase()) &&
        (filter.url === undefined || r.url.toString() === filter.url),
    );
  }

  /** pytest-httpx `get_request()`: the single matching request (fails when there is none, or more than one). */
  get_request(filter: { url?: string; method?: string } = {}): Request {
    const requests = this.get_requests(filter);
    if (requests.length !== 1) {
      throw new Error(`One request was expected, got ${requests.length}`);
    }
    return requests[0]!;
  }

  private _matches(reg: Registered, request: Request): boolean {
    const { url, method } = reg.opts;
    if (method !== undefined && method.toUpperCase() !== request.method) return false;
    if (url === undefined) return true;
    const actual = request.url.toString();
    if (url instanceof RegExp) return url.test(actual);
    const a = splitUrl(actual);
    const b = splitUrl(url);
    return a.base === b.base && a.query.join("&") === b.query.join("&");
  }

  _handle(request: Request): Response {
    this._requests.push(request);
    const matching = this._responses.filter((r) => this._matches(r, request));
    if (matching.length === 0) {
      this._unmatched.push(request);
      throw new TimeoutException(`No response can be found for ${request.method} request on ${request.url.toString()}`);
    }
    const reg = matching.find((r) => !r.used) ?? matching[matching.length - 1]!;
    reg.used = true;
    if (reg.exception) throw reg.exception;
    const { status_code = 200, json, text, content, headers } = reg.opts;
    const init: Record<string, unknown> = { request };
    if (headers !== undefined) init["headers"] = headers;
    if (json !== undefined) init["json"] = json;
    else if (text !== undefined) init["text"] = text;
    else if (content !== undefined) init["content"] = content;
    return new Response(status_code, init);
  }

  install(): void {
    _setDefaultTransportFactory(() => new MockTransport((req) => this._handle(req)));
  }

  uninstall(): void {
    _setDefaultTransportFactory(null);
  }

  /** Teardown checks of the pytest-httpx fixture. */
  verify(): void {
    if (this._unmatched.length) {
      const r = this._unmatched[0]!;
      throw new Error(`The following requests were not expected: ${r.method} ${r.url.toString()}`);
    }
    if (this.assert_all_responses_were_requested) {
      const pending = this._responses.filter((r) => !r.used);
      if (pending.length) {
        const p = pending[0]!.opts;
        throw new Error(`The following responses are mocked but not requested: ${p.method ?? "*"} ${String(p.url)}`);
      }
    }
  }
}

/** Registers a fresh `HttpxMock` for each test of the enclosing `describe` (or the file when called at module level). */
export function useHttpxMock(): HttpxMock {
  const mock = new HttpxMock();
  beforeEach(() => {
    mock.reset();
    mock.install();
  });
  afterEach(() => {
    mock.uninstall();
    mock.verify();
  });
  return mock;
}

/** Tests for transport.http module. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectionError_, EnvdRpcError, ExecutionError } from "../../src/models/errors.js";
import {
  ConnectError,
  HTTPStatusError,
  Request,
  Response,
  Timeout,
  MockTransport,
  _setAsyncClientInitHook,
  type AsyncClient,
} from "../../src/transport/_httpx.js";
import { ApiKeyAuth, EnvdTokenManager, PLATFORM_AUTH_HEADER } from "../../src/transport/auth.js";
import { CONNECT_CONTENT_TYPE } from "../../src/transport/codec.js";
import { TransportConfig } from "../../src/transport/config.js";
import { HttpClient } from "../../src/transport/http.js";
import { pyJsonDumps } from "../../src/utils/_pyformat.js";
import { DEBUG, INFO } from "../../src/utils/logging.js";
import { useCaplog } from "../_support/caplog.js";
import { useIsolatedEnv, useTransportIsolation } from "../_support/env.js";
import { useHttpxMock } from "../helpers/httpxMock.js";

const iso = useIsolatedEnv();
useTransportIsolation(iso);
const httpx_mock = useHttpxMock();
const caplog = useCaplog();

afterEach(() => {
  _setAsyncClientInitHook(null);
});

/** Build a Connect binary envelope frame: flags(1) + length(4 BE) + JSON. */
function make_envd_frame(payload: Record<string, unknown>, flags = 0x00): Buffer {
  const body = Buffer.from(pyJsonDumps(payload), "utf-8");
  const header = Buffer.alloc(5);
  header.writeUInt8(flags, 0);
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
}

type ChunksFactory = () => AsyncIterable<Uint8Array>;

/**
 * Return an `AsyncClient.__init__` patch that injects `transport`.
 *
 * Injecting a mock transport keeps the real `client.stream()` code path under test (no network), while optionally
 * recording the timeout passed by `envd_stream` and the client instances it creates.
 */
function patched_async_client_init(
  transport: MockTransport,
  opts: { captured_timeouts?: unknown[]; created_clients?: AsyncClient[] } = {},
) {
  return {
    before(options: { timeout?: unknown; transport?: unknown }) {
      opts.captured_timeouts?.push(options.timeout);
      options.transport = transport;
    },
    after(client: AsyncClient) {
      opts.created_clients?.push(client);
    },
  };
}

/** Build an `httpx.MockTransport` whose responses stream `chunks_factory()`; each item is one network chunk. */
function mock_stream_transport(chunks_factory: ChunksFactory, status = 200): MockTransport {
  return new MockTransport(async () => new Response(status, { content: chunks_factory() }));
}

/** HttpClient instance for streaming tests (mock auth, HTTP/1.1). */
function make_stream_test_client(): HttpClient {
  const config = new TransportConfig({ api_url: "https://test.example.com", http2: false });
  return new HttpClient(config, mockAuth());
}

function mockAuth() {
  return { getHeaders: vi.fn(async () => ({})), refresh: vi.fn(async () => {}) };
}

/** Context manager patching `AsyncClient.__init__` to inject `transport`. */
function patch_stream_client_init(
  transport: MockTransport,
  opts: { captured_timeouts?: unknown[]; created_clients?: AsyncClient[] } = {},
): void {
  _setAsyncClientInitHook(patched_async_client_init(transport, opts));
}

// ---- fixtures ----

function transport_config(): TransportConfig {
  return new TransportConfig({
    api_url: "https://sandbox-test.example.com",
    http2: false, // Disable HTTP/2 for test mocking
  });
}

const api_key_auth = () => new ApiKeyAuth("test-api-key");
const envd_token = () => new EnvdTokenManager("test-envd-token");
const http_client = () => new HttpClient(transport_config(), api_key_auth());

/** `pytest.raises(cls)` for async callables. */
async function raises<E extends Error>(fn: () => Promise<unknown>, cls: new (...a: never[]) => E): Promise<E> {
  let caught: unknown;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, "DID NOT RAISE").toBeInstanceOf(cls);
  return caught as E;
}

/** Drain an async generator (`async for _ in gen: pass`). */
async function drain(gen: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of gen) {
    void _;
  }
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

/** `asyncio.Event`. */
class AsyncEvent {
  private _set = false;
  private _waiters: (() => void)[] = [];
  set(): void {
    this._set = true;
    for (const w of this._waiters.splice(0)) w();
  }
  wait(): Promise<void> {
    if (this._set) return Promise.resolve();
    return new Promise((resolve) => this._waiters.push(resolve));
  }
}

/** `asyncio.wait_for(coro, timeout)`. */
async function waitFor<T>(p: Promise<T>, timeoutSeconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("TimeoutError")), timeoutSeconds * 1000);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

describe("TestPlatformRequest", () => {
  // Test Platform API requests.

  it("test_sends_auth_headers", async () => {
    const client = http_client();
    httpx_mock.add_response({ url: "https://sandbox-test.example.com/v1/sandboxes", json: { sandboxes: [] } });
    const response = await client.platformRequest("GET", "/v1/sandboxes");
    expect(response.status_code).toBe(200);

    const request = httpx_mock.get_request();
    expect(request.headers.get(PLATFORM_AUTH_HEADER.toLowerCase())).toBe("Bearer test-api-key");
  });

  it("test_sends_json_body", async () => {
    const client = http_client();
    httpx_mock.add_response({ url: "https://sandbox-test.example.com/v1/sandboxes", json: { id: "sbx-123" } });
    await client.platformRequest("POST", "/v1/sandboxes", { json: { template: "python3" } });
    const request = httpx_mock.get_request();
    const body = JSON.parse(request.content.toString("utf-8"));
    expect(body).toEqual({ template: "python3" });
  });

  it("test_sends_query_params", async () => {
    const client = http_client();
    httpx_mock.add_response({ json: { sandboxes: [] } });
    await client.platformRequest("GET", "/v1/sandboxes", { params: { limit: "10" } });
    const request = httpx_mock.get_request();
    expect(request.url.toString()).toContain("limit=10");
  });

  it("test_custom_headers_merged", async () => {
    const client = http_client();
    httpx_mock.add_response({ json: {} });
    await client.platformRequest("GET", "/v1/sandboxes", { headers: { "X-Custom": "value" } });
    const request = httpx_mock.get_request();
    expect(request.headers.get("x-custom")).toBe("value");
  });

  it("test_http_status_error_propagated", async () => {
    const client = http_client();
    httpx_mock.add_response({ status_code: 404, json: { error: "not found" } });
    await raises(() => client.platformRequest("GET", "/v1/sandboxes/missing"), HTTPStatusError);
  });
});

describe("TestEnvdRequest", () => {
  // Test envd API requests.

  it("test_sends_connect_content_type", async () => {
    const client = http_client();
    httpx_mock.add_response({ url: "https://envd.example.com/process.Process/Start", json: { pid: 123 } });
    const result = await client.envdRequest("https://envd.example.com", "/process.Process/Start", {
      payload: { command: "ls" },
      envd_token: envd_token(),
    });
    const request = httpx_mock.get_request();
    expect(request.headers.get("content-type")).toBe(CONNECT_CONTENT_TYPE);
    expect(result).toEqual({ pid: 123 });
  });

  it("test_sends_envd_auth_header", async () => {
    const client = http_client();
    httpx_mock.add_response({ url: "https://envd.example.com/process.Process/Start", json: { pid: 123 } });
    await client.envdRequest("https://envd.example.com", "/process.Process/Start", { envd_token: envd_token() });
    const request = httpx_mock.get_request();
    expect(request.headers.get("x-access-token")).toBe("test-envd-token");
  });

  it("test_decode_response", async () => {
    const client = http_client();
    httpx_mock.add_response({
      url: "https://envd.example.com/filesystem.Filesystem/ReadFile",
      json: { content: "hello world" },
    });
    const result = await client.envdRequest("https://envd.example.com", "/filesystem.Filesystem/ReadFile", {
      payload: { path: "/tmp/test.txt" },
      envd_token: envd_token(),
    });
    expect(result).toEqual({ content: "hello world" });
  });

  it("test_empty_payload", async () => {
    const client = http_client();
    httpx_mock.add_response({ url: "https://envd.example.com/process.Process/List", json: { processes: [] } });
    const result = await client.envdRequest("https://envd.example.com", "/process.Process/List", {
      envd_token: envd_token(),
    });
    expect(result).toEqual({ processes: [] });
  });

  it("test_request_timeout_override", async () => {
    // request_timeout overrides the client-level default for a single call.
    const client = http_client();
    httpx_mock.add_response({ url: "https://envd.example.com/process.Process/List", json: { ok: true } });
    await client.envdRequest("https://envd.example.com", "/process.Process/List", {
      envd_token: envd_token(),
      request_timeout: 120.0,
    });
    const request = httpx_mock.get_request();
    // The request was sent successfully; the timeout was applied at the httpx level (not directly visible in the
    // request object, but we verify it via monkeypatch below).
    expect(request).not.toBeNull();
  });

  it("test_request_timeout_none_uses_default", async () => {
    // When request_timeout is None, the default http_timeout is used.
    const client = http_client();
    httpx_mock.add_response({ url: "https://envd.example.com/test", json: { ok: true } });
    await client.envdRequest("https://envd.example.com", "/test", {
      envd_token: envd_token(),
      request_timeout: null,
    });
    // Should not raise — default timeout from config is used.
    expect(httpx_mock.get_request()).not.toBeNull();
  });
});

describe("TestClose", () => {
  // Test client cleanup.

  it("test_close_platform_client", async () => {
    const client = http_client();
    httpx_mock.add_response({ json: {} });
    await client.platformRequest("GET", "/v1/health");
    await client.close();
    expect(client._platform_client).toBeNull();
  });

  it("test_close_envd_clients", async () => {
    const client = http_client();
    const token = new EnvdTokenManager("tok");
    httpx_mock.add_response({ url: "https://envd1.example.com/test", json: { ok: true } });
    await client.envdRequest("https://envd1.example.com", "/test", { envd_token: token });
    await client.close();
    expect(client._envd_clients.size).toBe(0);
  });

  it("test_close_idempotent", async () => {
    const client = http_client();
    await client.close();
    await client.close(); // Should not raise
  });

  it("test_context_manager", async () => {
    httpx_mock.add_response({ json: {} });
    const client = new HttpClient(transport_config(), api_key_auth());
    const entered = await client.__aenter__();
    try {
      await entered.platformRequest("GET", "/v1/health");
    } finally {
      await client.__aexit__();
    }
    expect(client._platform_client).toBeNull();
  });
});

describe("TestRequestTimeoutPropagation", () => {
  // Verify that request_timeout is forwarded to httpx correctly.

  it("test_envd_request_passes_timeout_to_httpx_post", async () => {
    // envd_request(request_timeout=120) should pass timeout=Timeout(120) to client.post().
    httpx_mock.add_response({ url: "https://envd.example.com/test", json: { ok: true } });
    const client = new HttpClient(transport_config(), api_key_auth());
    const envd_client = client._createEnvdClient("https://envd.example.com");

    const captured_kwargs: Record<string, any> = {};
    const original_post = envd_client.post.bind(envd_client);

    envd_client.post = async (...args: Parameters<typeof original_post>) => {
      Object.assign(captured_kwargs, args[1]);
      return original_post(...args);
    };

    await client.envdRequest("https://envd.example.com", "/test", {
      envd_token: envd_token(),
      request_timeout: 120.0,
    });

    expect("timeout" in captured_kwargs).toBe(true);
    expect(captured_kwargs["timeout"].read).toBe(120.0);
    await client.close();
  });

  it("test_envd_request_no_timeout_kwarg_when_none", async () => {
    // envd_request(request_timeout=None) should NOT pass timeout kwarg.
    httpx_mock.add_response({ url: "https://envd.example.com/test", json: { ok: true } });
    const client = new HttpClient(transport_config(), api_key_auth());
    const envd_client = client._createEnvdClient("https://envd.example.com");

    const captured_kwargs: Record<string, any> = {};
    const original_post = envd_client.post.bind(envd_client);

    envd_client.post = async (...args: Parameters<typeof original_post>) => {
      Object.assign(captured_kwargs, args[1]);
      return original_post(...args);
    };

    await client.envdRequest("https://envd.example.com", "/test", { envd_token: envd_token() });

    // No per-request timeout override — client-level default applies
    expect("timeout" in captured_kwargs).toBe(false);
    await client.close();
  });

  it("test_platform_request_passes_timeout_to_httpx_request", async () => {
    // platform_request(request_timeout=120) forwards timeout=Timeout(120) to request().
    httpx_mock.add_response({ url: "https://sandbox-test.example.com/sandboxes", json: { sandboxID: "sbx-1" } });
    const client = new HttpClient(transport_config(), api_key_auth());
    const platform_client = await client._getPlatformClient();

    const captured_kwargs: Record<string, any> = {};
    const original_request = platform_client.request.bind(platform_client);

    platform_client.request = async (...args: Parameters<typeof original_request>) => {
      Object.assign(captured_kwargs, args[2]);
      return original_request(...args);
    };

    await client.platformRequest("POST", "/sandboxes", { json: { templateID: "base" }, request_timeout: 120.0 });

    expect("timeout" in captured_kwargs).toBe(true);
    expect(captured_kwargs["timeout"]).toBeInstanceOf(Timeout);
    expect(captured_kwargs["timeout"].read).toBe(120.0);
    await client.close();
  });

  it("test_platform_request_no_timeout_kwarg_when_none", async () => {
    // platform_request(request_timeout=None) must NOT pass a timeout kwarg.
    httpx_mock.add_response({ url: "https://sandbox-test.example.com/sandboxes", json: { sandboxes: [] } });
    const client = new HttpClient(transport_config(), api_key_auth());
    const platform_client = await client._getPlatformClient();

    const captured_kwargs: Record<string, any> = {};
    const original_request = platform_client.request.bind(platform_client);

    platform_client.request = async (...args: Parameters<typeof original_request>) => {
      Object.assign(captured_kwargs, args[2]);
      return original_request(...args);
    };

    await client.platformRequest("GET", "/sandboxes");

    // Client-level default applies — no per-request override sent.
    expect("timeout" in captured_kwargs).toBe(false);
    await client.close();
  });

  it("test_envd_stream_uses_override_timeout", async () => {
    // envd_stream(request_timeout=180) should create httpx client with Timeout(180).
    const captured_timeouts: unknown[] = [];
    const transport = mock_stream_transport(() => _empty_chunks());

    const config = new TransportConfig({ api_url: "https://test.example.com", http2: false, http_timeout: 30.0 });
    const client = new HttpClient(config, mockAuth());

    patch_stream_client_init(transport, { captured_timeouts });
    await drain(
      client.envdStream("https://envd.example.com", "/process.Process/Start", {
        envd_token: envd_token(),
        request_timeout: 180.0,
      }),
    );

    expect(captured_timeouts.some((t) => t instanceof Timeout && t.read === 180.0)).toBe(true);
    await client.close();
  });

  it("test_envd_stream_default_timeout", async () => {
    // envd_stream without request_timeout uses config.http_timeout.
    const captured_timeouts: unknown[] = [];
    const transport = mock_stream_transport(() => _empty_chunks());

    const config = new TransportConfig({
      api_url: "https://test.example.com",
      http2: false,
      http_timeout: 42.0, // custom default
    });
    const client = new HttpClient(config, mockAuth());

    patch_stream_client_init(transport, { captured_timeouts });
    await drain(client.envdStream("https://envd.example.com", "/process.Process/Start", { envd_token: envd_token() }));

    // Should use config default, not an override
    expect(captured_timeouts.some((t) => t instanceof Timeout && t.read === 42.0)).toBe(true);
    await client.close();
  });
});

/** Async iterator producing no chunks (empty streaming response). */
async function* _empty_chunks(): AsyncGenerator<Uint8Array> {
  return;
}

describe("TestEnvdStreamStreaming", () => {
  // True-streaming behaviour of `envd_stream` (task 166).
  //
  // These tests use a mock transport whose response body is produced by a controlled async byte-chunk iterator, so
  // chunk arrival *timing* is observable and it can be proven that frames are yielded incrementally instead of after
  // the full body has been buffered.

  const _make_client = () => make_stream_test_client();
  const URL = "https://envd.example.com";
  const RPC = "/process.Process/Start";

  const stream = (client: HttpClient, extra: { payload?: Record<string, unknown> } = {}) =>
    client.envdStream(URL, RPC, { envd_token: envd_token(), ...extra });

  it("test_frames_yielded_incrementally_before_later_chunks_arrive", async () => {
    // The first frame must be yielded *before* the second chunk exists.
    //
    // The second network chunk is gated on an event that is only set after the consumer received the first frame. A
    // buffered implementation (read the whole body first) would deadlock on the gate and trip the `wait_for` timeout
    // instead of completing.
    const frame1 = make_envd_frame({ event: { data: { stdout: "bGluZTE=" } } });
    const frame2 = make_envd_frame({ event: { data: { stdout: "bGluZTI=" } } });
    const second_chunk_released = new AsyncEvent();

    async function* chunks() {
      yield frame1;
      await second_chunk_released.wait();
      yield frame2;
    }

    const transport = mock_stream_transport(chunks);
    const client = _make_client();

    const consume = async (): Promise<Record<string, unknown>[]> => {
      const received: Record<string, unknown>[] = [];
      for await (const frame of stream(client)) {
        received.push(frame);
        if (received.length === 1) {
          // Only reached if frame 1 was delivered while chunk 2 is still gated — i.e. truly incremental streaming.
          second_chunk_released.set();
        }
      }
      return received;
    };

    patch_stream_client_init(transport);
    const received = await waitFor(consume(), 5.0);

    expect(received).toEqual([
      { event: { data: { stdout: "bGluZTE=" } } },
      { event: { data: { stdout: "bGluZTI=" } } },
    ]);
    await client.close();
  });

  it("test_header_split_across_chunks", async () => {
    // A 5-byte frame header split 1+2+2 across network chunks.
    const raw = make_envd_frame({ event: { data: { stdout: "aGk=" } } });

    async function* chunks() {
      yield raw.subarray(0, 1);
      yield raw.subarray(1, 3);
      yield raw.subarray(3);
    }

    const transport = mock_stream_transport(chunks);
    const client = _make_client();
    patch_stream_client_init(transport);
    const frames = await collect(stream(client));
    expect(frames).toEqual([{ event: { data: { stdout: "aGk=" } } }]);
    await client.close();
  });

  it("test_payload_split_across_chunks", async () => {
    // A frame payload split across three network chunks.
    const raw = make_envd_frame({ event: { data: { stdout: "bGluZQ==" } } });
    const header = raw.subarray(0, 5);
    const payload = raw.subarray(5);

    async function* chunks() {
      yield header;
      yield payload.subarray(0, 2);
      yield payload.subarray(2, 5);
      yield payload.subarray(5);
    }

    const transport = mock_stream_transport(chunks);
    const client = _make_client();
    patch_stream_client_init(transport);
    const frames = await collect(stream(client));
    expect(frames).toEqual([{ event: { data: { stdout: "bGluZQ==" } } }]);
    await client.close();
  });

  it("test_multiple_frames_in_single_chunk", async () => {
    // Several complete frames packed into one network chunk.
    const blob = Buffer.concat([
      make_envd_frame({ event: { start: { pid: 7 } } }),
      make_envd_frame({ event: { data: { stdout: "MQ==" } } }),
      make_envd_frame({ event: { data: { stderr: "Mg==" } } }),
      make_envd_frame({ event: { end: { exitCode: 0 } } }),
    ]);

    async function* chunks() {
      yield blob;
    }

    const transport = mock_stream_transport(chunks);
    const client = _make_client();
    patch_stream_client_init(transport);
    const frames = await collect(stream(client));
    expect(frames).toEqual([
      { event: { start: { pid: 7 } } },
      { event: { data: { stdout: "MQ==" } } },
      { event: { data: { stderr: "Mg==" } } },
      { event: { end: { exitCode: 0 } } },
    ]);
    await client.close();
  });

  it("test_mixed_complete_and_partial_frames_across_chunks", async () => {
    // Chunk 1 = whole frame + start of next; chunk 2 = rest + another frame.
    const f1 = make_envd_frame({ event: { data: { stdout: "MQ==" } } });
    const f2 = make_envd_frame({ event: { data: { stdout: "Mg==" } } });
    const f3 = make_envd_frame({ event: { end: { exitCode: 0 } } });

    async function* chunks() {
      yield Buffer.concat([f1, f2.subarray(0, 6)]); // whole frame 1 + partial frame 2 (mid-header/payload)
      yield Buffer.concat([f2.subarray(6), f3]); // rest of frame 2 + whole frame 3
    }

    const transport = mock_stream_transport(chunks);
    const client = _make_client();
    patch_stream_client_init(transport);
    const frames = await collect(stream(client));
    expect(frames).toEqual([
      { event: { data: { stdout: "MQ==" } } },
      { event: { data: { stdout: "Mg==" } } },
      { event: { end: { exitCode: 0 } } },
    ]);
    await client.close();
  });

  it("test_trailer_and_error_frames_skipped", async () => {
    // End-of-stream (0x02) frames — empty or with error JSON — are skipped.
    async function* chunks() {
      yield make_envd_frame({ event: { data: { stdout: "MQ==" } } });
      // Trailer carrying a Connect error payload must not be yielded (matches parse_streaming_frames semantics).
      yield make_envd_frame({ error: { code: "internal", message: "boom" } }, 0x02);
      // Empty data frame is skipped too.
      yield make_envd_frame({}, 0x02);
    }

    const transport = mock_stream_transport(chunks);
    const client = _make_client();
    patch_stream_client_init(transport);
    const frames = await collect(stream(client));
    expect(frames).toEqual([{ event: { data: { stdout: "MQ==" } } }]);
    await client.close();
  });

  it("test_truncated_trailing_frame_dropped", async () => {
    // A final incomplete frame (header + partial payload) is dropped.
    const complete = make_envd_frame({ event: { data: { stdout: "MQ==" } } });
    const full = make_envd_frame({ event: { data: { stdout: "bG9uZw==" } } });
    const truncated = full.subarray(0, full.length - 3);

    async function* chunks() {
      yield complete;
      yield truncated;
    }

    const transport = mock_stream_transport(chunks);
    const client = _make_client();
    patch_stream_client_init(transport);
    const frames = await collect(stream(client));
    // The complete frame survives; the truncated tail is dropped silently.
    expect(frames).toEqual([{ event: { data: { stdout: "MQ==" } } }]);
    await client.close();
  });

  it("test_invalid_json_payload_skipped", async () => {
    // A data frame whose payload is not valid JSON is skipped.
    const bad_body = Buffer.from("{not json");
    const hdr = Buffer.alloc(5);
    hdr.writeUInt8(0x00, 0);
    hdr.writeUInt32BE(bad_body.length, 1);
    const bad = Buffer.concat([hdr, bad_body]);
    const good = make_envd_frame({ event: { end: { exitCode: 3 } } });

    async function* chunks() {
      yield bad;
      yield good;
    }

    const transport = mock_stream_transport(chunks);
    const client = _make_client();
    patch_stream_client_init(transport);
    const frames = await collect(stream(client));
    expect(frames).toEqual([{ event: { end: { exitCode: 3 } } }]);
    await client.close();
  });

  it("test_http_error_raises_envd_rpc_error_and_closes_client", async () => {
    // A 4xx streaming response raises EnvdRpcError and closes resources.
    async function* chunks() {
      yield Buffer.from('{"error": "not found"}');
    }

    const transport = mock_stream_transport(chunks, 404);
    const created: AsyncClient[] = [];
    const client = _make_client();
    patch_stream_client_init(transport, { created_clients: created });
    const exc = await raises(() => drain(stream(client)), EnvdRpcError);
    expect(exc.status_code).toBe(404);
    expect(exc.rpc_path).toBe("/process.Process/Start");
    expect(exc.envd_error).toEqual({ error: "not found" });
    // No full-URL / MDN leak in the exception text (task 166)
    expect(String(exc)).not.toContain("envd.example.com");
    expect(String(exc)).not.toContain("https://");
    expect(String(exc)).not.toContain("mozilla.org");
    // The streaming client was closed even though the error aborted iteration.
    expect(created.length > 0 && created[0]!.is_closed).toBe(true);
    await client.close();
  });

  it("test_http_500_envd_json_error_structured", async () => {
    // Command-not-found 500: envd JSON body is propagated structurally.
    //
    // Mirrors the real reproduction (`ebx connect` + typo'd command): envd answers /process.Process/Start with 500
    // and a JSON error body (e.g. "exec not found"). The transport must surface that body as structured data for
    // upper layers to map, instead of double-printing a WARNING followed by a raw httpx error with the full sandbox
    // URL.
    async function* chunks() {
      yield Buffer.from('{"error": {"code": "not_found", "message": "exec not found"}}');
    }

    const transport = mock_stream_transport(chunks, 500);
    const client = _make_client();
    patch_stream_client_init(transport);
    const exc = await raises(() => drain(stream(client)), EnvdRpcError);
    expect(exc).toBeInstanceOf(ExecutionError);
    expect(exc.code).toBe("E3006");
    expect(exc.status_code).toBe(500);
    expect(exc.rpc_path).toBe("/process.Process/Start");
    expect(exc.envd_error).toEqual({ error: { code: "not_found", message: "exec not found" } });
    // The human-readable detail from the JSON body reaches the message
    expect(exc.message).toContain("exec not found");
    // No URL / MDN leak anywhere in the exception text
    for (const leaked of ["envd.example.com", "https://", "mozilla.org"]) {
      expect(String(exc)).not.toContain(leaked);
      expect(exc.message).not.toContain(leaked);
    }
    await client.close();
  });

  it("test_http_500_flat_json_error_variants", async () => {
    // Flat / string / message-only JSON error shapes all yield a detail.
    const cases: [string, string][] = [
      ['{"code": "not_found", "message": "exec not found"}', "exec not found"],
      ['{"error": "exec not found"}', "exec not found"],
      ['{"message": "exec not found"}', "exec not found"],
    ];
    for (const [body, expected_detail] of cases) {
      async function* chunks() {
        yield Buffer.from(body);
      }

      const transport = mock_stream_transport(chunks, 500);
      const client = _make_client();
      patch_stream_client_init(transport);
      const exc = await raises(() => drain(stream(client)), EnvdRpcError);
      expect(exc.message, body).toContain(expected_detail);
      expect(exc.envd_error).not.toBeNull();
      await client.close();
    }
  });

  it("test_http_500_non_json_error_body", async () => {
    // Non-JSON error body still raises EnvdRpcError carrying the raw text.
    async function* chunks() {
      yield Buffer.from("exec: not found (plain text)");
    }

    const transport = mock_stream_transport(chunks, 500);
    const client = _make_client();
    patch_stream_client_init(transport);
    const exc = await raises(() => drain(stream(client)), EnvdRpcError);
    expect(exc.status_code).toBe(500);
    expect(exc.envd_error).toBeNull(); // unparseable body — no structured data
    expect(exc.body_text).toContain("plain text");
    expect(exc.message).toContain("exec: not found"); // raw text used as the detail
    expect(String(exc)).not.toContain("envd.example.com");
    await client.close();
  });

  it("test_http_500_empty_error_body", async () => {
    // A 500 with an empty body still raises a clean EnvdRpcError.
    //
    // Boundary case for the bounded-body reader: `raw` stays empty, so no JSON parse is attempted, no detail is
    // appended, and the message is just the RPC path + status.
    async function* chunks() {
      yield Buffer.alloc(0);
    }

    const transport = mock_stream_transport(chunks, 500);
    const client = _make_client();
    patch_stream_client_init(transport);
    const exc = await raises(() => drain(stream(client)), EnvdRpcError);
    expect(exc.status_code).toBe(500);
    expect(exc.envd_error).toBeNull();
    expect(exc.body_text).toBe("");
    // No dangling detail separator when the body is empty
    expect(exc.message).toBe("envd RPC /process.Process/Start failed (HTTP 500)");
    expect(String(exc)).not.toContain("envd.example.com");
    await client.close();
  });

  it("test_http_error_no_default_warning_and_no_url_in_logs", async () => {
    // Error responses emit no default WARNING; DEBUG diagnostics carry no URL.
    //
    // The old behaviour printed the error body as a standalone WARNING and then raised an httpx error containing the
    // full sandbox URL. Now the details live on the exception; the diagnostic log line is DEBUG-only and contains
    // only the RPC path + status + body.
    async function* chunks() {
      yield Buffer.from('{"error": {"code": "not_found", "message": "exec not found"}}');
    }

    const transport = mock_stream_transport(chunks, 500);
    const client = _make_client();
    // 1) At INFO level (>= default WARNING visibility): zero records.
    patch_stream_client_init(transport);
    let restore = caplog.set_level(INFO, "easy_sandbox.transport.http");
    try {
      await raises(() => drain(stream(client)), EnvdRpcError);
    } finally {
      restore();
    }
    expect(caplog.records.filter((r) => r.levelno >= INFO)).toEqual([]);

    // 2) At DEBUG level the diagnostic line exists but has no URL.
    patch_stream_client_init(transport);
    restore = caplog.set_level(DEBUG, "easy_sandbox.transport.http");
    try {
      await raises(() => drain(stream(client)), EnvdRpcError);
    } finally {
      restore();
    }
    const error_records = caplog.records.filter((r) => r.getMessage().includes("failed"));
    expect(error_records.length > 0, "expected a DEBUG diagnostic record for the failure").toBe(true);
    for (const record of error_records) {
      expect(record.getMessage()).not.toContain("envd.example.com");
      expect(record.getMessage()).not.toContain("https://");
      expect(record.getMessage()).toContain("/process.Process/Start");
    }
    await client.close();
  });

  it("test_http_error_body_bounded_and_truncated", async () => {
    // An oversized error body is truncated, never buffered wholesale.
    async function* chunks() {
      yield Buffer.alloc(100_000, "x");
    }

    const transport = mock_stream_transport(chunks, 500);
    const client = _make_client();
    patch_stream_client_init(transport);
    const exc = await raises(() => drain(stream(client)), EnvdRpcError);
    expect(exc.body_text.length).toBeLessThanOrEqual(500);
    await client.close();
  });

  it("test_connect_error_maps_to_connection_error", async () => {
    // httpx.ConnectError is mapped to the SDK ConnectionError_.
    const transport = new MockTransport(async (_request: Request) => {
      throw new ConnectError("connection refused");
    });
    const client = _make_client();
    patch_stream_client_init(transport);
    await raises(() => drain(stream(client)), ConnectionError_);
    await client.close();
  });

  it("test_early_stop_closes_stream_and_client", async () => {
    // Stopping iteration early (aclose) closes the response and client.
    //
    // `StreamReader.cancel()` propagates `GeneratorExit` into the generator; the `async with` blocks must then close
    // the streaming response (releasing the connection) and the httpx client.
    const frame1 = make_envd_frame({ event: { data: { stdout: "MQ==" } } });
    const frame2 = make_envd_frame({ event: { data: { stdout: "Mg==" } } });
    const responses: Response[] = [];

    async function* chunks() {
      yield frame1;
      yield frame2;
    }

    const transport = new MockTransport(async () => {
      const response = new Response(200, { content: chunks() });
      responses.push(response);
      return response;
    });
    const created: AsyncClient[] = [];
    const client = _make_client();
    patch_stream_client_init(transport, { created_clients: created });
    const gen = stream(client);
    const first = await gen.next();
    expect(first.value).toEqual({ event: { data: { stdout: "MQ==" } } });
    await gen.return(undefined); // simulates StreamReader.cancel()

    // Both the streaming response and the httpx client were closed.
    expect(responses.length > 0 && responses[0]!.is_closed).toBe(true);
    expect(created.length > 0 && created[0]!.is_closed).toBe(true);
    await client.close();
  });

  it("test_cancellation_closes_stream_and_client", async () => {
    // Cancelling the consuming task closes the response and client.
    //
    // JS has no task cancellation: the cancel is modelled by `return()` on the generator while a `next()` is pending
    // on the gated second chunk (the request is queued behind it, exactly as it is for an abandoned for-await).
    const frame1 = make_envd_frame({ event: { data: { stdout: "MQ==" } } });
    const frame2 = make_envd_frame({ event: { data: { stdout: "Mg==" } } });
    const responses: Response[] = [];
    const gate = new AsyncEvent();

    async function* chunks() {
      yield frame1;
      await gate.wait();
      yield frame2;
    }

    const transport = new MockTransport(async () => {
      const response = new Response(200, { content: chunks() });
      responses.push(response);
      return response;
    });
    const created: AsyncClient[] = [];
    const client = _make_client();

    patch_stream_client_init(transport, { created_clients: created });
    const gen = stream(client);
    const first = await gen.next();
    expect(first.value).toEqual({ event: { data: { stdout: "MQ==" } } });
    const pending = gen.next(); // blocked on the gated chunk 2
    await new Promise((r) => setTimeout(r, 50));
    const cancelled = gen.return(undefined); // cancel the consumer mid-stream
    expect(responses.length > 0 && responses[0]!.is_closed).toBe(false);
    gate.set(); // let the mock byte stream settle
    await pending;
    await cancelled;

    expect(responses.length > 0 && responses[0]!.is_closed).toBe(true);
    expect(created.length > 0 && created[0]!.is_closed).toBe(true);
    await client.close();
  });

  it("test_normal_completion_closes_client", async () => {
    // After the stream finishes normally the httpx client is closed.
    async function* chunks() {
      yield make_envd_frame({ event: { data: { stdout: "MQ==" } } });
      yield make_envd_frame({ event: { end: { exitCode: 0 } } });
      yield make_envd_frame({}, 0x02);
    }

    const transport = mock_stream_transport(chunks);
    const created: AsyncClient[] = [];
    const client = _make_client();
    patch_stream_client_init(transport, { created_clients: created });
    const frames = await collect(stream(client));
    expect(frames).toEqual([{ event: { data: { stdout: "MQ==" } } }, { event: { end: { exitCode: 0 } } }]);
    expect(created.length > 0 && created[0]!.is_closed).toBe(true);
    await client.close();
  });

  it("test_sends_auth_and_content_type_headers", async () => {
    // Streaming requests carry the envd token and Connect content type.
    const seen: Request[] = [];

    async function* chunks() {
      yield make_envd_frame({ ok: true });
    }

    const transport = new MockTransport(async (request: Request) => {
      seen.push(request);
      return new Response(200, { content: chunks() });
    });
    const client = _make_client();
    patch_stream_client_init(transport);
    await drain(stream(client, { payload: { process: { cmd: "ls" } } }));

    expect(seen.length > 0, "handler was never called").toBe(true);
    const req = seen[0]!;
    expect(req.method).toBe("POST");
    expect(req.url.path).toBe("/process.Process/Start");
    expect(req.headers.get("content-type")).toBe(CONNECT_CONTENT_TYPE);
    expect(req.headers.get("x-access-token")).toBe("test-envd-token");
    expect(JSON.parse(req.content.toString("utf-8"))).toEqual({ process: { cmd: "ls" } });
    await client.close();
  });
});

// Keep vitest hooks referenced (setup is registered via the helper calls above).
void beforeEach;
void iso;

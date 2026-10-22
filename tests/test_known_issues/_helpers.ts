/**
 * Wire-level helpers for the KI-xxx regression tests (ports of `python-sdk/client-sdk/tests/test_known_issues/helpers.py`).
 *
 * The tests drive the real `HttpClient` + protocol classes against the shared httpx mock, so the exact request bodies
 * and the raw envd responses (shapes captured from a real envd 0.5.2 sandbox, see `python-sdk/e2e/KNOWN-ISSUES.md`)
 * are what is asserted, not a mock of our own layers.
 */

import { expect } from "vitest";

import { Request } from "../../src/transport/_httpx.js";
import { ApiKeyAuth, EnvdTokenManager } from "../../src/providers/alicloud_express/auth.js";
import { TransportConfig } from "../../src/transport/config.js";
import { HttpClient } from "../../src/transport/http.js";
import { pyJsonDumps } from "../../src/utils/_pyformat.js";

export const API = "https://api.sandbox-test.example.com";
export const ENVD = "https://49983-sbx-ki.sandbox-test.example.com";

export function makeHttp(apiKey = "test-key"): HttpClient {
  return new HttpClient(new TransportConfig({ api_url: API, http2: false }), new ApiKeyAuth(apiKey));
}

export const token = (): EnvdTokenManager => new EnvdTokenManager("envd-token");

export function frame(payload: Record<string, unknown>, flags = 0x00): Buffer {
  const body = Buffer.from(pyJsonDumps(payload), "utf-8");
  const header = Buffer.alloc(5);
  header.writeUInt8(flags, 0);
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
}

export const stdoutEvent = (text: string) => ({ event: { data: { stdout: Buffer.from(text).toString("base64") } } });
export const startEvent = (pid: number) => ({ event: { start: { pid } } });
export const endEvent = (code = 0) => ({ event: { end: { exitCode: code, exited: true, status: "exited" } } });

export function processStream(...events: Record<string, unknown>[]): Buffer {
  return Buffer.concat([...events.map((e) => frame(e)), frame({}, 0x02)]);
}

export function bodyOf(request: Request): Record<string, any> {
  return JSON.parse(Buffer.from(request.content as Uint8Array).toString("utf-8"));
}

/** `pytest.raises(cls)` for async callables; returns the caught error. */
export async function raises<E extends Error>(fn: () => Promise<unknown>, cls: new (...a: never[]) => E): Promise<E> {
  let caught: unknown;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, "DID NOT RAISE").toBeInstanceOf(cls);
  return caught as E;
}

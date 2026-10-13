/**
 * Shared helpers of the template / deploy CLI tests: the Python `MagicMock()` configs, the mocked `DockerBuilder`, the
 * `httpx.HTTPStatusError` factory, the `patch("agent_sandbox.transport.*")` triplet and `monkeypatch.chdir/setenv`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, vi } from "vitest";

import * as fcTemplate from "../../src/api/fc_template.js";
import { templateSeams } from "../../src/cli/commands/template.js";
import { DockerBuilder } from "../../src/api/docker_builder.js";
import * as transportAuth from "../../src/transport/auth.js";
import * as transportConfig from "../../src/transport/config.js";
import * as transportHttp from "../../src/transport/http.js";
import { HTTPStatusError, Request, Response } from "../../src/transport/_httpx.js";

type Fn = ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export const spyAny = (o: object, k: string): Fn => vi.spyOn(o as Record<string, (...a: unknown[]) => unknown>, k) as unknown as Fn;

/** A tmp-path fixture: a fresh directory per test (removed afterwards); also restores the cwd. */
export function useTmpPath(): () => string {
  let tmp = "";
  let cwd = "";
  beforeEach(() => {
    cwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-tpl-"));
  });
  afterEach(() => {
    process.chdir(cwd);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  return () => tmp;
}

/** `monkeypatch.chdir`/`setenv`/`delenv` (restored by `vi.unstubAllEnvs` + the tmp fixture). */
export const setenv = (k: string, v: string): void => void vi.stubEnv(k, v);
export function delenv(k: string): void {
  vi.stubEnv(k, "");
  delete process.env[k];
}

export function writeText(p: string, text: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

export interface FakeConfig {
  access_key_id: string | null;
  access_key_secret: string | null;
  region: string;
  api_key: string;
  api_url: string;
  [key: string]: unknown;
}

/** `fake_config = MagicMock(); fake_config.access_key_id = ...`. */
export function fakeConfig(over: Partial<FakeConfig> = {}): FakeConfig {
  return { access_key_id: "platform-ak", access_key_secret: "platform-sk", region: "cn-hangzhou", api_key: "", api_url: "", ...over };
}

export function patchLoadConfig(config: unknown = fakeConfig()): Fn {
  return spyAny(transportConfig, "loadConfig").mockReturnValue(config);
}

export interface MockBuilder {
  builder: {
    checkDocker: Fn;
    build: Fn;
    loginAcrWithAksk: Fn;
    tag: Fn;
    push: Fn;
  };
  cls: Fn & { injectSdkWheel: Fn };
}

/** `patch("agent_sandbox.api.docker_builder.DockerBuilder")` -- installed on the template seam and restored after each test. */
export function useMockBuilder(): () => MockBuilder {
  let original: typeof DockerBuilder | null = null;
  let current: MockBuilder | null = null;
  beforeEach(() => {
    original = templateSeams.DockerBuilder;
    current = null;
  });
  afterEach(() => {
    if (original) templateSeams.DockerBuilder = original;
  });
  return () => {
    const builder = {
      checkDocker: vi.fn(async () => true),
      build: vi.fn(async () => "local:latest"),
      loginAcrWithAksk: vi.fn(async () => ({ tempUserName: "u", authorizationToken: "t" })),
      tag: vi.fn(async () => undefined),
      push: vi.fn(async () => undefined),
    };
    const cls = vi.fn(function () {
      return builder;
    }) as unknown as MockBuilder["cls"];
    cls.injectSdkWheel = vi.fn(async () => []);
    templateSeams.DockerBuilder = cls as unknown as typeof DockerBuilder;
    current = { builder, cls };
    return current;
  };
}

export function patchOfficialApi(opts: { create?: Record<string, unknown>; ready?: Record<string, unknown> } = {}): { create: Fn; ready: Fn } {
  const create = spyAny(fcTemplate, "createOfficialTemplate").mockResolvedValue(opts.create ?? { templateID: "tpl-001", statusCode: 200 });
  const ready = spyAny(fcTemplate, "waitForTemplateReady").mockResolvedValue(opts.ready ?? { status: { state: "ready" } });
  return { create, ready };
}

/** `TestTemplateCommandErrorHandling._http_error`. */
export function httpError(status: number, body: Record<string, unknown>): Error {
  const request = new Request("POST", "https://platform/templates");
  const response = new Response(status, { json: body, request });
  return new HTTPStatusError(String(status), { request, response });
}

export interface MockHttp {
  platformRequest: Fn;
  close: Fn;
}

/** `mock_http = MagicMock(); mock_http.platform_request = AsyncMock(...)`; `patch(transport.{config,auth,http})`. */
export function patchTransport(http: MockHttp, config: unknown = fakeConfig()): void {
  patchLoadConfig(config);
  spyAny(transportAuth, "createAuthProvider").mockReturnValue({});
  spyAny(transportHttp, "HttpClient").mockImplementation(function () {
    return http;
  });
}

export function mockHttp(opts: { json?: unknown; error?: Error } = {}): MockHttp {
  const resp = { json: () => opts.json, status_code: 200 };
  return {
    platformRequest: opts.error ? vi.fn(async () => Promise.reject(opts.error)) : vi.fn(async () => resp),
    close: vi.fn(async () => undefined),
  };
}

export type { Any };

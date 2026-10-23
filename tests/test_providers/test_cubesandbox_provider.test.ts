/**
 * CubeSandbox (`node/1`) through the TypeScript host, the CLI, and the local engine.
 * The backend is the in-process E2B-shaped mock: no Cube cluster and no credentials.
 */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { main } from "../../src/cli/main.js";
import { startEngine, type EngineHandle } from "../../src/engine/server.js";
import { QuotaExceededError, SandboxCreationError, SandboxNotFoundError, TemplateNotFoundError } from "../../src/models/errors.js";
import { ProcessChunkType, type ProcessResult } from "../../src/models/process.js";
import { ProviderConfigError, ProviderFeatureNotSupportedError } from "../../src/models/provider_errors.js";
import * as installer from "../../src/providers/installer.js";
import { type E2BMock, type Seen, startE2BMock } from "../_support/e2b_mock.js";
import { useIso } from "../_support/iso.js";
import { TEST_HOST_VERSION, catalogDir } from "../_support/plugins.js";
import { useCapsys } from "../test_cli/conftest.js";

const iso = useIso();
const cap = useCapsys();
const here = path.dirname(fileURLToPath(import.meta.url));
const CUBE = catalogDir("cubesandbox");
const haveCatalog = fs.existsSync(path.join(CUBE, "abx-provider.toml"));

async function abx(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const code = await main({ args });
  const { out, err } = cap.readouterr();
  return { code, out, err };
}

function basicUser(header: string | undefined): string {
  const token = String(header ?? "").split(" ")[1] ?? "";
  return Buffer.from(token, "base64").toString();
}

describe.skipIf(!haveCatalog)("cubesandbox through the host and CLI", () => {
  let mock: E2BMock;
  let origin = "";
  let port = 0;
  let seen: Seen[] = [];

  beforeEach(async () => {
    mock = await startE2BMock();
    ({ origin, port, seen } = mock);
    await installer.install(CUBE, { yes: true, hostVersion: TEST_HOST_VERSION });
  });
  afterEach(async () => {
    await mock.close();
  });

  const options = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    base_url: origin,
    domain: "cube.test",
    proxy: `127.0.0.1:${port}`,
    ...extra,
  });

  async function create(template = "py-image", extra: Record<string, unknown> = {}): Promise<Sandbox> {
    return Sandbox.create({ provider: "cubesandbox", provider_options: options(extra), template, timeout: 90, envs: { A: "1" }, metadata: { owner: "cube" } });
  }

  it("treats a missing key and domain as defaults, and rejects an unknown option", async () => {
    iso.setenv("ABX_SANDBOX_API_KEY", "express-key");
    const sb = await Sandbox.create({
      provider: "cubesandbox",
      provider_options: { base_url: origin, proxy: `127.0.0.1:${port}` },
      template: "base",
    });
    try {
      expect(seen[0]?.headers["x-api-key"]).toBeUndefined();
      expect(Object.values(seen[0]?.headers ?? {})).not.toContain("express-key");
      expect(sb.url).toBe("http://49983-sbx-1.reported.test");
    } finally {
      await sb.kill();
    }

    mock.flags.omitDomain = true;
    seen.length = 0;
    const plain = await Sandbox.create({
      provider: "cubesandbox",
      provider_options: { base_url: origin, proxy: `127.0.0.1:${port}` },
      template: "base",
    });
    try {
      expect(plain.url).toBe("http://49983-sbx-1.cube.app");
      expect((await plain.network.resolve(8080))[0]).toBe("http://8080-sbx-1.cube.app");
    } finally {
      await plain.kill();
    }

    iso.setenv("ABX_CUBESANDBOX_API_KEY", "cube-key");
    seen.length = 0;
    const keyed = await Sandbox.create({
      provider: "cubesandbox",
      provider_options: { base_url: origin, proxy: `127.0.0.1:${port}`, api_key: "" },
      template: "base",
    });
    try {
      expect(seen[0]?.headers["x-api-key"]).toBeUndefined();
    } finally {
      await keyed.kill();
    }

    seen.length = 0;
    const fromEnv = await Sandbox.create({
      provider: "cubesandbox",
      provider_options: { base_url: origin, proxy: `127.0.0.1:${port}` },
      template: "base",
    });
    try {
      expect(seen[0]?.headers["x-api-key"]).toBe("cube-key");
    } finally {
      await fromEnv.kill();
    }

    await expect(Sandbox.create({ provider: "cubesandbox", provider_options: options({ nope: "1" }), template: "base" })).rejects.toBeInstanceOf(ProviderConfigError);
    await expect(Sandbox.create({ provider: "cubesandbox", provider_options: options({ nope: "1" }), template: "base" })).rejects.toThrow(/Unknown option.*cubesandbox|cubesandbox.*Unknown option/);
  }, 30_000);

  it("creates with the template, connects, lists, sets timeout, pauses, and kills", async () => {
    const sb = await create();
    try {
      const payload = JSON.parse(seen.find((s) => s.method === "POST" && s.url === "/sandboxes")?.body.toString() ?? "{}") as Record<string, unknown>;
      expect(payload["templateID"]).toBe("py-image");
      expect(payload["timeout"]).toBe(90);
      expect(payload["envVars"]).toEqual({ A: "1" });
      expect(payload["metadata"]).toEqual({ owner: "cube" });
      expect(sb.id).toBe("sbx-1");
      expect(sb.url).toBe("http://49983-sbx-1.reported.test");

      mock.flags.connectStatus = 404;
      seen.length = 0;
      const connected = await Sandbox.connect("sbx-1", { provider: "cubesandbox", provider_options: options() });
      expect(connected.url).toBe("http://49983-sbx-1.reported.test");
      expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(expect.arrayContaining(["POST /sandboxes/sbx-1/connect", "GET /sandboxes/sbx-1"]));
      await connected.close();

      const listed = await Sandbox.list({ provider: "cubesandbox", provider_options: options() });
      expect(listed.map((item) => item.sandbox_id)).toEqual(["sbx-1"]);
      expect(listed[0]?.envd_url).toBe("http://49983-sbx-1.reported.test");

      seen.length = 0;
      await sb.setTimeout(120);
      const timeout = seen.find((s) => s.url === "/sandboxes/sbx-1/timeout");
      expect(timeout?.method).toBe("POST");
      expect(JSON.parse(timeout?.body.toString() ?? "{}")).toEqual({ timeout: 120 });

      seen.length = 0;
      await sb.pause();
      expect(seen[0]?.method).toBe("POST");
      expect(seen[0]?.url).toBe("/sandboxes/sbx-1/pause");
      seen.length = 0;
      await sb.resume();
      expect(seen[0]?.url).toBe("/sandboxes/sbx-1/resume");
      expect(seen[0]?.body.toString()).toBe("{}");

      const [url, headers] = await sb.network.resolve(8080);
      expect(url).toBe("http://8080-sbx-1.reported.test");
      expect(headers["X-Access-Token"]).toBe("tok");
      expect(await sb.refreshInfo()).toMatchObject({ envd_url: "http://49983-sbx-1.reported.test" });
    } finally {
      await sb.kill();
    }
    expect(seen.some((s) => s.method === "DELETE" && s.url === "/sandboxes/sbx-1")).toBe(true);
    await expect(Sandbox.connect("sbx-1", { provider: "cubesandbox", provider_options: options() })).rejects.toBeInstanceOf(SandboxNotFoundError);
  }, 30_000);

  it("runs commands, files and code, and refuses the undeclared PTY", async () => {
    const sb = await create("base");
    try {
      seen.length = 0;
      const result = (await sb.commands.run("echo hi")) as ProcessResult;
      expect(result.exit_code).toBe(0);
      expect(result.stdout).toBe("hi\n");
      const start = seen.find((s) => s.url === "/process.Process/Start");
      expect(start?.headers["host"]).toBe("49983-sbx-1.reported.test");
      expect(start?.headers["x-access-token"]).toBe("tok");
      expect(basicUser(start?.headers["authorization"])).toBe("root:");
      expect(start?.headers["connect-protocol-version"]).toBe("1");

      const chunks = [];
      for await (const chunk of sb.commands.stream("echo hi")) chunks.push(chunk);
      expect(chunks.some((c) => c.type === ProcessChunkType.STDOUT && c.data === "hi\n")).toBe(true);
      expect(chunks.some((c) => c.type === ProcessChunkType.EXIT && c.exit_code === 0)).toBe(true);

      seen.length = 0;
      await sb.files.write("/tmp/a.txt", "data");
      expect(seen[0]?.url).toBe("/files?path=%2Ftmp%2Fa.txt&username=root");
      expect(await sb.files.read("/tmp/a.txt")).toBe("file-bytes");
      const entries = await sb.files.list("/tmp");
      expect(entries.map((e) => e.name)).toEqual(["a.txt"]);
      const listDir = seen.find((s) => s.url === "/filesystem.Filesystem/ListDir");
      expect(listDir?.headers["host"]).toBe("49983-sbx-1.reported.test");
      expect(JSON.parse(listDir?.body.toString() ?? "{}")).toMatchObject({ path: "/tmp" });

      const watched = [];
      for await (const event of await sb.files.watch("/tmp")) {
        watched.push(event);
        break;
      }
      expect(watched[0]?.path).toBe("/tmp/a.txt");

      seen.length = 0;
      const code = await sb.runCode("print(42)", { operation: "code.default-context.execute", envs: { FOO: "bar" } });
      expect(code.stdout).toContain("42");
      expect(code.exit_code).toBe(0);
      const exec = seen.find((s) => s.url === "/execute");
      expect(exec?.headers["host"]).toBe("49999-sbx-1.reported.test");
      expect(exec?.headers["e2b-sandbox-port"]).toBe("49999");
      expect(JSON.parse(exec?.body.toString() ?? "{}")).toEqual({ code: "print(42)", language: "python", env_vars: { FOO: "bar" } });

      await expect(sb.getTerminal({ cols: 80, rows: 24 })).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError);
      expect(seen.some((s) => s.method === "UPGRADE")).toBe(false);
    } finally {
      await sb.kill();
    }
  }, 30_000);

  it("dials envd without a token when allow_missing is set, still as root", async () => {
    mock.flags.omitToken = true;
    const sb = await create("base");
    try {
      seen.length = 0;
      expect(((await sb.commands.run("echo hi")) as ProcessResult).stdout).toBe("hi\n");
      const start = seen.find((s) => s.url === "/process.Process/Start");
      expect(start?.headers["x-access-token"]).toBeUndefined();
      expect(basicUser(start?.headers["authorization"])).toBe("root:");
      const [url, headers] = await sb.network.resolve(8080);
      expect(url).toBe("http://8080-sbx-1.reported.test");
      expect(headers).toEqual({});
    } finally {
      await sb.kill();
    }
  });

  it("maps create, connect, and unsupported-feature failures", async () => {
    await expect(create("status-404")).rejects.toMatchObject({ name: "TemplateNotFoundError", code: "E2001", message: expect.stringContaining("template not found") });
    await expect(create("status-429")).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(create("status-400")).rejects.toMatchObject({ name: "SandboxCreationError", code: "E2000", message: expect.stringContaining("bad create") });
    const unavailable = create("status-503");
    await expect(unavailable).rejects.toBeInstanceOf(SandboxCreationError);
    await expect(unavailable).rejects.not.toBeInstanceOf(TemplateNotFoundError);

    const sb = await create("base");
    try {
      await expect(sb.commands.list()).rejects.toMatchObject({ name: "ProviderFeatureNotSupportedError", code: "E8004", message: expect.stringContaining("process.manage") });
    } finally {
      await sb.kill();
    }
    await expect(Sandbox.connect("missing", { provider: "cubesandbox", provider_options: options() })).rejects.toBeInstanceOf(SandboxNotFoundError);
  }, 30_000);

  it("drives create, exec, file list, sandbox list, and kill from the CLI", async () => {
    const created = await abx(
      "--json",
      "--provider",
      "cubesandbox",
      "--opt",
      `base_url=${origin}`,
      "--opt",
      `proxy=127.0.0.1:${port}`,
      "create",
      "--template",
      "base",
      "--timeout",
      "90",
    );
    expect(created.code).toBe(0);
    const doc = JSON.parse(created.out) as { ID: string; URL: string; provider: string };
    expect(doc.ID).toBe("sbx-1");
    expect(doc.provider).toBe("cubesandbox");
    expect(doc.URL).toBe("http://49983-sbx-1.reported.test");
    expect(seen.find((s) => s.method === "POST" && s.url === "/sandboxes")?.headers["x-api-key"]).toBeUndefined();

    const ran = await abx("--json", "--provider", "cubesandbox", "--opt", `base_url=${origin}`, "--opt", `proxy=127.0.0.1:${port}`, "exec", "sbx-1", "echo hi");
    expect(ran.code).toBe(0);
    expect(ran.out).toContain("hi");

    const files = await abx("--json", "--provider", "cubesandbox", "--opt", `base_url=${origin}`, "--opt", `proxy=127.0.0.1:${port}`, "sandbox", "files", "list", "sbx-1", "--path", "/tmp");
    expect(files.code).toBe(0);
    expect(files.out).toContain("a.txt");

    const listed = await abx("--json", "--provider", "cubesandbox", "--opt", `base_url=${origin}`, "--opt", `proxy=127.0.0.1:${port}`, "list");
    expect(listed.code).toBe(0);
    expect(listed.out).toContain("sbx-1");

    const killed = await abx("--provider", "cubesandbox", "--opt", `base_url=${origin}`, "--opt", `proxy=127.0.0.1:${port}`, "kill", "sbx-1", "--yes");
    expect(killed.code).toBe(0);
    expect(seen.some((s) => s.method === "DELETE" && s.url === "/sandboxes/sbx-1")).toBe(true);
  }, 30_000);

  it("reports a missing template, an unknown option, and an undeclared feature from the CLI", async () => {
    const missing = await abx("--provider", "cubesandbox", "--opt", `base_url=${origin}`, "--opt", `proxy=127.0.0.1:${port}`, "create", "--template", "status-404");
    expect(missing.code).toBe(4);
    expect(missing.err + missing.out).toContain("E2001");
    expect(missing.err + missing.out).toContain("template not found");

    const region = await abx("--provider", "cubesandbox", "--opt", `base_url=${origin}`, "list", "--region", "cn-hangzhou");
    expect(region.code).toBe(2);
    expect(region.err + region.out).toContain("E8002");
    expect(region.err + region.out).toContain("--region");

    const unknown = await abx("--provider", "cubesandbox", "--opt", "nope=1", "create", "--template", "base");
    expect(unknown.code).toBe(2);
    expect(unknown.err + unknown.out).toMatch(/Unknown option/);

    const templates = await abx("--provider", "cubesandbox", "template", "list");
    expect(templates.code).toBe(1);
    expect(templates.err + templates.out).toContain("E8004");
    expect(templates.err + templates.out).toMatch(/templates\.read/);
  }, 30_000);
});

describe.skipIf(!haveCatalog)("cubesandbox through the engine", () => {
  let mock: E2BMock;
  let engine: EngineHandle;
  let base = "";
  let token = "";
  let connection: Record<string, unknown> = {};

  beforeEach(async () => {
    mock = await startE2BMock();
    await installer.install(CUBE, { yes: true, hostVersion: TEST_HOST_VERSION });
    engine = await startEngine({ idle_timeout: 0 });
    base = `http://127.0.0.1:${engine.record.port}`;
    token = engine.record.token;
    connection = { provider: "cubesandbox", provider_options: { base_url: mock.origin, domain: "cube.test", proxy: `127.0.0.1:${mock.port}` } };
  });
  afterEach(async () => {
    await engine.close();
    await mock.close();
  });

  const conn = (c: Record<string, unknown> = connection): string => Buffer.from(JSON.stringify(c)).toString("base64url");
  async function api(method: string, route: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "X-Abx-Connection": conn(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* empty */
    }
    return { status: res.status, json };
  }

  it("sets a timeout, lists files, and builds an http port URL from the reported domain", async () => {
    const created = await api("POST", "/v1/sandboxes", { template: "base", timeout: 60 });
    expect(created.status).toBe(201);
    expect(created.json.url).toBe("http://49983-sbx-1.reported.test");

    const timeout = await api("POST", "/v1/sandboxes/sbx-1/timeout", { timeout: 120 });
    expect(timeout.status).toBe(200);
    expect(JSON.parse(mock.seen.find((s) => s.url === "/sandboxes/sbx-1/timeout")?.body.toString() ?? "{}")).toEqual({ timeout: 120 });

    const files = await api("GET", "/v1/sandboxes/sbx-1/files/list?path=/tmp");
    expect(files.status).toBe(200);
    expect(files.json.entries[0].name).toBe("a.txt");

    const portUrl = await api("GET", "/v1/sandboxes/sbx-1/ports/8080/url");
    expect(portUrl.status).toBe(200);
    expect(portUrl.json.url).toBe("http://8080-sbx-1.reported.test");
    expect(portUrl.json.headers["X-Access-Token"]).toBe("tok");
  }, 30_000);

  it("uses cube.app when the API omits a domain and the caller did not set one", async () => {
    mock.flags.omitDomain = true;
    connection = { provider: "cubesandbox", provider_options: { base_url: mock.origin, proxy: `127.0.0.1:${mock.port}` } };
    const created = await api("POST", "/v1/sandboxes", { template: "base" });
    expect(created.status).toBe(201);
    expect(created.json.url).toBe("http://49983-sbx-1.cube.app");
    const portUrl = await api("GET", "/v1/sandboxes/sbx-1/ports/8080/url");
    expect(portUrl.json.url).toBe("http://8080-sbx-1.cube.app");
  }, 30_000);

  it("maps create, connect, and config errors onto status, type, and code", async () => {
    const missing = await api("POST", "/v1/sandboxes", { template: "status-404" });
    expect(missing.status).toBe(404);
    expect(missing.json.error).toMatchObject({ type: "TemplateNotFoundError", code: "E2001" });
    expect(missing.json.error.message).toContain("template not found");

    const quota = await api("POST", "/v1/sandboxes", { template: "status-429" });
    expect(quota.status).toBe(429);
    expect(quota.json.error).toMatchObject({ type: "QuotaExceededError", code: "E2002" });

    const bad = await api("POST", "/v1/sandboxes", { template: "status-400" });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toMatchObject({ type: "SandboxCreationError", code: "E2000" });

    const unknown = await api("POST", "/v1/sandboxes", { template: "base" }, { "X-Abx-Connection": conn({ provider: "cubesandbox", provider_options: { nope: "1" } }) });
    expect(unknown.status).toBe(400);
    expect(unknown.json.error.code).toBe("E8002");
    expect(unknown.json.error.message).toMatch(/Unknown option/);

    await api("POST", "/v1/sandboxes", { template: "base" });
    expect((await api("DELETE", "/v1/sandboxes/sbx-1")).status).toBe(200);
    const gone = await api("POST", "/v1/sandboxes/sbx-1/connect");
    expect(gone.status).toBe(404);
    expect(gone.json.error.type).toBe("SandboxNotFoundError");
  }, 30_000);
});

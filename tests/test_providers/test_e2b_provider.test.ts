import { ProviderFeatureNotSupportedError } from "../../src/models/provider_errors.js";
/**
 * The catalog `e2b` node provider through the CLI host (`Sandbox` + the installed plugin), against the local
 * E2B-shaped mock. No live `api.e2b.app` call and no real API key.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { InvalidAPIKeyError, InvalidCredentialsError, SandboxNotFoundError } from "../../src/models/errors.js";
import { WatchEventType } from "../../src/models/filesystem.js";
import { ProcessChunkType, ProcessResult } from "../../src/models/process.js";
import * as installer from "../../src/providers/installer.js";
import { getProvider } from "../../src/providers/registry.js";
import { useIso } from "../_support/iso.js";
import { type E2BMock, type Seen, startE2BMock } from "../_support/e2b_mock.js";
import { TEST_HOST_VERSION, catalogDir } from "../_support/plugins.js";

const iso = useIso();
const here = path.dirname(fileURLToPath(import.meta.url));
const E2B = catalogDir("e2b");
const haveCatalog = fs.existsSync(path.join(E2B, "abx-provider.toml"));

describe.skipIf(!haveCatalog)("e2b node provider", () => {
  let mock: E2BMock;
  let origin = "";
  let seen: Seen[] = [];

  beforeEach(async () => {
    mock = await startE2BMock();
    ({ origin, seen } = mock);
    await installer.install(E2B, { yes: true, hostVersion: TEST_HOST_VERSION });
  });
  afterEach(async () => {
    await mock.close();
  });

  const options = (): { base_url: string; api_key: string; domain: string } => ({
    base_url: origin,
    api_key: "e2b-key",
    domain: "e2b.test",
  });

  it("installs as a node provider with the catalog features", () => {
    const provider = getProvider("e2b");
    expect(provider.kind).toBe("node");
    for (const feature of [
      "sandbox.lifecycle",
      "sandbox.timeout",
      "sandbox.pause",
      "exec.run",
      "exec.stream",
      "process.manage",
      "files.rw",
      "files.watch",
      "ports.url",
    ]) {
      expect(provider.supports(feature), feature).toBe(true);
    }
    expect(provider.supports("pty")).toBe(false);
  });

  it("rejects a missing key before any request and ignores the Express key", async () => {
    iso.setenv("ABX_SANDBOX_API_KEY", "express-key");
    await expect(Sandbox.create({ provider: "e2b", provider_options: { base_url: origin }, template: "base" })).rejects.toBeInstanceOf(InvalidCredentialsError);
    try {
      await Sandbox.create({ provider: "e2b", provider_options: { base_url: origin }, template: "base" });
    } catch (err) {
      expect(String(err)).toMatch(/ABX_E2B_API_KEY/);
      expect(String(err)).not.toContain("express-key");
    }
    expect(seen).toEqual([]);
  });

  it("sends ABX_E2B_API_KEY as X-API-Key and strips a trailing slash on the base URL", async () => {
    iso.setenv("ABX_E2B_API_KEY", "from-env");
    const sb = await Sandbox.create({
      provider: "e2b",
      provider_options: { base_url: `${origin}/`, domain: "e2b.test" },
      template: "base",
      timeout: 60,
    });
    try {
      expect(sb.id).toBe("sbx-1");
      expect(seen[0]?.method).toBe("POST");
      expect(seen[0]?.url).toBe("/sandboxes");
      expect(seen[0]?.headers["x-api-key"]).toBe("from-env");
      expect(seen[0]?.headers["authorization"]).toBeUndefined();
      expect(JSON.parse(seen[0]?.body.toString() ?? "{}")).toMatchObject({ templateID: "base", timeout: 60 });
    } finally {
      await sb.kill();
    }
  });

  it("creates, gets, connects, lists, sets timeout, pauses, resumes, and maps a killed sandbox to not found", async () => {
    const opts = options();
    const sb = await Sandbox.create({ provider: "e2b", provider_options: opts, template: "base", timeout: 60 });
    try {
      expect(sb.id).toBe("sbx-1");
      expect(sb.info.region).toBe("");
      expect(sb.info.timeout).toBe(0);
      expect(sb.url).toBe("https://49983-sbx-1.e2b.test");
      expect(sb.network.getUrl(8080)).toBe("https://8080-sbx-1.e2b.test");
      const [url, headers] = await sb.network.resolve(8080);
      expect(url).toBe("https://8080-sbx-1.reported.test");
      expect(headers["X-Access-Token"]).toBe("tok");

      const info = await sb.refreshInfo();
      expect(info.sandbox_id).toBe("sbx-1");
      expect(info.envd_access_token).toBe("tok");
      expect(info.status).toBe("running");
      expect(await sb.isRunning()).toBe(true);

      const listed = await Sandbox.list({ provider: "e2b", provider_options: opts });
      expect(listed.map((item) => item.sandbox_id)).toEqual(["sbx-1"]);

      const other = await Sandbox.connect("sbx-1", { provider: "e2b", provider_options: opts });
      expect(other.id).toBe("sbx-1");
      await other.close();

      await expect(Sandbox.connect("no-such", { provider: "e2b", provider_options: opts })).rejects.toBeInstanceOf(SandboxNotFoundError);

      seen.length = 0;
      await sb.setTimeout(120);
      expect(seen[0]?.method).toBe("POST");
      expect(seen[0]?.url).toBe("/sandboxes/sbx-1/timeout");
      expect(JSON.parse(seen[0]?.body.toString() ?? "{}")).toEqual({ timeout: 120 });
      expect(seen[0]?.headers["x-api-key"]).toBe("e2b-key");

      seen.length = 0;
      await sb.pause();
      await sb.resume();
      expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["POST /sandboxes/sbx-1/pause", "POST /sandboxes/sbx-1/resume"]);
    } finally {
      await sb.kill();
    }
    expect(seen.some((s) => s.method === "DELETE" && s.url === "/sandboxes/sbx-1")).toBe(true);
    await expect(Sandbox.connect("sbx-1", { provider: "e2b", provider_options: opts })).rejects.toBeInstanceOf(SandboxNotFoundError);
    const after = await Sandbox.list({ provider: "e2b", provider_options: opts });
    expect(after).toEqual([]);
  });

  it("falls back from the v2 connect route to v1 and then GET", async () => {
    const opts = options();
    const sb = await Sandbox.create({ provider: "e2b", provider_options: opts, template: "base" });
    try {
      mock.flags.connectStatus = 404;
      seen.length = 0;
      const other = await Sandbox.connect("sbx-1", { provider: "e2b", provider_options: opts });
      expect(other.id).toBe("sbx-1");
      await other.close();
      expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
        "POST /v2/sandboxes/sbx-1/connect",
        "POST /sandboxes/sbx-1/connect",
        "GET /sandboxes/sbx-1",
      ]);
    } finally {
      await sb.kill();
    }
  });

  it("maps a rejected key to InvalidAPIKeyError without echoing the key", async () => {
    mock.flags.unauthorized = true;
    const opts = options();
    try {
      await Sandbox.create({ provider: "e2b", provider_options: opts, template: "base" });
      expect.fail("create should reject a 401");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidAPIKeyError);
      expect(String(err)).not.toContain("e2b-key");
      expect((err as Error).message).not.toContain(origin);
    }
  });

  it("uses the default e2b.app domain when neither API nor configuration supplies one", async () => {
    mock.flags.omitDomain = true;
    const sb = await Sandbox.create({
      provider: "e2b",
      provider_options: { base_url: origin, api_key: "e2b-key" },
      template: "base",
    });
    try {
      expect(sb.url).toBe("https://49983-sbx-1.e2b.app");
      expect((await sb.network.resolve(443))[0]).toBe("https://443-sbx-1.e2b.app");
    } finally {
      await sb.kill();
    }
  });

  it("runs and streams commands, and lists processes, with stdin disabled", async () => {
    mock.flags.envdUrl = origin;
    const sb = await Sandbox.create({ provider: "e2b", provider_options: options(), template: "base", timeout: 60 });
    try {
      seen.length = 0;
      const result = await sb.commands.run("echo hi");
      expect(result).toBeInstanceOf(ProcessResult);
      expect((result as ProcessResult).stdout).toBe("hi\n");
      expect((result as ProcessResult).exit_code).toBe(0);
      const start = seen.find((s) => s.url === "/process.Process/Start");
      expect(start).toBeDefined();
      expect(JSON.parse(start?.body.toString() ?? "{}")).toEqual({ process: { cmd: "echo", args: ["hi"] }, stdin: false });
      expect(start?.headers["x-access-token"]).toBe("tok");
      expect(start?.headers["e2b-sandbox-id"]).toBe("sbx-1");
      expect(start?.headers["e2b-sandbox-port"]).toBe("49983");
      expect(start?.headers["x-api-key"]).toBeUndefined();

      const chunks = [];
      for await (const chunk of sb.commands.stream("echo hi")) chunks.push(chunk);
      expect(chunks.filter((c) => c.type === ProcessChunkType.STDOUT).map((c) => c.data).join("")).toContain("hi\n");
      expect(chunks.filter((c) => c.type === ProcessChunkType.EXIT).map((c) => c.exit_code)).toEqual([0]);

      const procs = await sb.commands.list();
      expect(procs.map((p) => p.pid)).toContain(7);
      expect(procs.map((p) => p.command)).toContain("echo hi");
    } finally {
      await sb.kill();
    }
  });

  it("writes, reads, and lists files, and parses an envd watch event", async () => {
    mock.flags.envdUrl = origin;
    const sb = await Sandbox.create({ provider: "e2b", provider_options: options(), template: "base" });
    try {
      seen.length = 0;
      await sb.files.write("/tmp/a.txt", "hello");
      const write = seen.find((s) => s.method === "POST" && s.url.startsWith("/files?"));
      expect(write).toBeDefined();
      const wrote = new URL(write?.url ?? "", "http://mock.local");
      expect(wrote.searchParams.get("path")).toBe("/tmp/a.txt");
      expect(wrote.searchParams.get("username")).toBe("user");
      expect(write?.body.includes(Buffer.from("hello"))).toBe(true);
      expect(await sb.files.read("/tmp/a.txt")).toBe("file-bytes");

      const entries = await sb.files.list("/tmp");
      expect(entries.map((e) => e.name)).toEqual(["a.txt"]);
      expect(entries[0]?.path).toBe("/tmp/a.txt");
      const list = seen.find((s) => s.url === "/filesystem.Filesystem/ListDir");
      expect(JSON.parse(list?.body.toString() ?? "{}").path).toBe("/tmp");

      const events = [];
      for await (const event of await sb.files.watch("/tmp")) events.push(event);
      expect(events.map((e) => e.type)).toEqual([WatchEventType.MODIFIED]);
      expect(events.map((e) => e.path)).toEqual(["/tmp/a.txt"]);
    } finally {
      await sb.kill();
    }
  });

  it("rejects interpreter requests without a verified adapter and sends no payload", async () => {
    mock.flags.envdUrl = origin;
    const sb = await Sandbox.create({ provider: "e2b", provider_options: options(), template: "base" });
    try { seen.length=0; await expect(sb.runCode("payload")).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError); expect(seen).toEqual([]); }
    finally { await sb.kill(); }
  });
});

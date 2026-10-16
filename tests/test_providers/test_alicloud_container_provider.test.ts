/**
 * alicloud-container (`node/1`) against the local E2B-shaped mock. No ACS/ACK account.
 *
 * The manifest's `[features] supported` list is the contract: every declared feature is called, and
 * `files.watch` (not declared) is refused with E8004 before any request. `code.interpret` is Jupyter
 * `POST /execute` only; context RPCs are refused on purpose.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import {
  EnvdRpcError,
  FileNotFoundError_,
  FileOperationError,
  InvalidAPIKeyError,
  InvalidCredentialsError,
  SandboxCreationError,
  SandboxNotFoundError,
  TemplateNotFoundError,
} from "../../src/models/errors.js";
import type { ProcessResult } from "../../src/models/process.js";
import { SandboxStatus } from "../../src/models/sandbox.js";
import { ProviderConfigError, ProviderFeatureNotSupportedError } from "../../src/providers/errors.js";
import * as installer from "../../src/providers/installer.js";
import { loadManifest } from "../../src/providers/manifest.js";
import { getProvider } from "../../src/providers/registry.js";
import { HTTPStatusError } from "../../src/transport/http.js";
import { loadLayeredConfig } from "../../src/transport/config_layers.js";
import { type E2BMock, type Seen, startE2BMock } from "../_support/e2b_mock.js";
import { useIso } from "../_support/iso.js";
import { TEST_HOST_VERSION, catalogDir } from "../_support/plugins.js";

const iso = useIso();
const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = catalogDir("alicloud-container");
const haveCatalog = fs.existsSync(path.join(PLUGIN, "abx-provider.toml"));

/** Features the toml advertises and this file actually drives. */
const ADVERTISED = [
  "sandbox.lifecycle",
  "sandbox.timeout",
  "sandbox.pause",
  "exec.run",
  "exec.stream",
  "process.manage",
  "files.rw",
  "code.interpret",
  "ports.url",
] as const;

describe.skipIf(!haveCatalog)("alicloud-container provider", () => {
  let mock: E2BMock;
  let origin = "";
  let seen: Seen[] = [];

  beforeEach(async () => {
    mock = await startE2BMock();
    ({ origin, seen } = mock);
    await installer.install(PLUGIN, { yes: true, hostVersion: TEST_HOST_VERSION });
  });
  afterEach(async () => {
    await mock.close();
  });

  const native = (): Record<string, string> => ({ base_url: origin, domain: "acs.test", api_key: "super-secret-key" });
  const priv = (): Record<string, string> => ({ base_url: `${origin}/kruise/api`, domain: "acs.test", api_key: "super-secret-key", protocol: "private" });

  async function open(options: Record<string, unknown>, extra: { template?: string; timeout?: number } = {}): Promise<Sandbox> {
    return Sandbox.create({
      provider: "alicloud-container",
      provider_options: options,
      template: extra.template ?? "code-interpreter",
      timeout: extra.timeout ?? 60,
    });
  }

  it("advertises exactly the features the provider implements", () => {
    const manifest = loadManifest(PLUGIN);
    expect([...manifest.features].sort()).toEqual([...ADVERTISED].sort());
    expect([...getProvider("alicloud-container").features].sort()).toEqual([...ADVERTISED].sort());
    expect(manifest.features).not.toContain("pty");
    expect(manifest.features).not.toContain("files.watch");
    expect(getProvider("alicloud-container").kind).toBe("node");
  });

  it("rejects a missing key, a missing domain, a bad protocol, and a base URL with no scheme", async () => {
    iso.setenv("E2B_API_KEY", "express-secret");
    await expect(open({ domain: "acs.test" })).rejects.toThrow(/ABX_ALICLOUD_CONTAINER_API_KEY/);
    await expect(open({ domain: "acs.test" })).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(open({ api_key: "k" })).rejects.toThrow(/domain or a base URL/);
    await expect(open({ domain: "acs.test", api_key: "k", protocol: "public" })).rejects.toThrow(/native or private/);
    await expect(open({ base_url: "127.0.0.1:9", api_key: "k" })).rejects.toBeInstanceOf(ProviderConfigError);
    await expect(open({ base_url: "127.0.0.1:9", api_key: "k" })).rejects.toThrow(/scheme/);
    await expect(open({ domain: "https://acs.test/kruise", api_key: "k" })).rejects.toThrow(/must be a host/);
    await expect(open({ domain: "acs.test", api_key: "   " })).rejects.toBeInstanceOf(InvalidAPIKeyError);
    expect(seen).toHaveLength(0);
    expect(JSON.stringify(seen)).not.toContain("express-secret");
  });

  it("treats a domain with a scheme the same as a bare host", async () => {
    const bare = await getProvider("alicloud-container").buildInfra(
      loadLayeredConfig({ provider: "alicloud-container", provider_options: { domain: "acs.test", api_key: "k" } }),
    );
    const schemed = await getProvider("alicloud-container").buildInfra(
      loadLayeredConfig({ provider: "alicloud-container", provider_options: { domain: "https://acs.test/", api_key: "k" } }),
    );
    const privScheme = await getProvider("alicloud-container").buildInfra(
      loadLayeredConfig({ provider: "alicloud-container", provider_options: { domain: "https://acs.test", api_key: "k", protocol: "private" } }),
    );
    const fromBase = await getProvider("alicloud-container").buildInfra(
      loadLayeredConfig({ provider: "alicloud-container", provider_options: { base_url: "https://api.acs.test", api_key: "k" } }),
    );
    try {
      expect(bare.config.sandbox_base_url).toBe("https://api.acs.test");
      expect(bare.config.sandbox_domain).toBe("acs.test");
      expect(schemed.config.sandbox_base_url).toBe("https://api.acs.test");
      expect(schemed.config.sandbox_domain).toBe("acs.test");
      expect(privScheme.config.sandbox_base_url).toBe("https://acs.test/kruise/api");
      expect(privScheme.config.sandbox_domain).toBe("acs.test");
      expect(fromBase.config.sandbox_base_url).toBe("https://api.acs.test");
      expect(fromBase.config.sandbox_domain).toBe("acs.test");
    } finally {
      await bare.close?.();
      await schemed.close?.();
      await privScheme.close?.();
      await fromBase.close?.();
    }

    const sb = await open({ base_url: origin, domain: "https://acs.test", api_key: "super-secret-key" });
    try {
      expect(sb.url).toBe("https://49983-sbx-1.acs.test");
      expect((await sb.network.resolve(8080))[0]).toBe("https://8080-sbx-1.acs.test");
    } finally {
      await sb.kill();
    }
  });

  it("keeps a port on the domain", async () => {
    const infra = await getProvider("alicloud-container").buildInfra(
      loadLayeredConfig({ provider: "alicloud-container", provider_options: { domain: "acs.test:8443", api_key: "k", protocol: "private" } }),
    );
    try {
      expect(infra.config.sandbox_base_url).toBe("https://acs.test:8443/kruise/api");
      expect(infra.config.sandbox_domain).toBe("acs.test:8443");
    } finally {
      await infra.close?.();
    }
  });

  it("reads domain, base URL and API key from the environment and ignores the Express key", async () => {
    iso.setenv("ABX_ALICLOUD_CONTAINER_BASE_URL", origin);
    iso.setenv("ABX_ALICLOUD_CONTAINER_DOMAIN", "https://acs.test");
    iso.setenv("ABX_ALICLOUD_CONTAINER_API_KEY", "from-env");
    iso.setenv("E2B_API_KEY", "express-secret");
    const sb = await Sandbox.create({ provider: "alicloud-container", template: "code-interpreter" });
    try {
      expect(sb.url).toBe("https://49983-sbx-1.acs.test");
      expect(seen[0]?.headers["x-api-key"]).toBe("from-env");
      expect(JSON.stringify(seen[0]?.headers)).not.toContain("express-secret");
    } finally {
      await sb.kill();
    }
  });

  it("creates, connects, lists, times out, pauses, resumes and kills on the native control plane", async () => {
    const options = native();
    const sb = await open(options, { timeout: 42 });
    try {
      expect(sb.id).toBe("sbx-1");
      expect(sb.url).toBe("https://49983-sbx-1.acs.test");
      const created = JSON.parse(seen[0]?.body.toString("utf8") ?? "{}") as { templateID?: string; timeout?: number };
      expect(created.templateID).toBe("code-interpreter");
      expect(created.timeout).toBe(42);
      expect(seen[0]?.headers["x-api-key"]).toBe("super-secret-key");
      expect(seen[0]?.headers["authorization"]).toBeUndefined();

      seen.length = 0;
      const again = await Sandbox.connect("sbx-1", { provider: "alicloud-container", provider_options: options });
      expect(again.id).toBe("sbx-1");
      expect(seen[0]?.method).toBe("POST");
      expect(seen[0]?.url).toBe("/v2/sandboxes/sbx-1/connect");
      await again.close();

      seen.length = 0;
      const listed = await Sandbox.list({
        provider: "alicloud-container",
        provider_options: options,
        status: SandboxStatus.RUNNING,
        limit: 2,
        offset: 3,
      });
      expect(listed.map((item) => item.sandbox_id)).toEqual(["sbx-1"]);
      const listUrl = seen.find((s) => s.method === "GET" && s.url.startsWith("/v2/sandboxes"))?.url ?? "";
      expect(listUrl).toContain("state=running");
      expect(listUrl).toContain("limit=2");
      expect(listUrl).toContain("offset=3");

      for (const shape of ["sandboxes", "data"] as const) {
        mock.flags.listAs = shape;
        const wrapped = await Sandbox.list({ provider: "alicloud-container", provider_options: options });
        expect(wrapped.map((item) => item.sandbox_id)).toEqual(["sbx-1"]);
      }
      mock.flags.listAs = "array";

      seen.length = 0;
      await sb.setTimeout(120);
      expect(seen[0]?.method).toBe("POST");
      expect(seen[0]?.url).toBe("/sandboxes/sbx-1/timeout");
      expect(JSON.parse(seen[0]?.body.toString("utf8") ?? "{}")).toEqual({ timeout: 120 });

      seen.length = 0;
      await sb.pause();
      expect(seen[0]?.url).toBe("/sandboxes/sbx-1/pause");
      await sb.resume();
      expect(seen.some((s) => s.method === "POST" && s.url === "/sandboxes/sbx-1/resume")).toBe(true);
      expect((await sb.network.resolve(8080))[0]).toBe("https://8080-sbx-1.acs.test");
    } finally {
      await sb.kill();
    }
    expect(seen.some((s) => s.method === "DELETE" && s.url === "/sandboxes/sbx-1")).toBe(true);
    const after = await Sandbox.list({ provider: "alicloud-container", provider_options: options });
    expect(after).toEqual([]);
    await expect(Sandbox.connect("sbx-1", { provider: "alicloud-container", provider_options: options })).rejects.toBeInstanceOf(SandboxNotFoundError);
  });

  it("runs commands, files, code and ports on the private data plane and forwards auth", async () => {
    const sb = await open(priv());
    try {
      expect(sb.url).toBe(`${origin}/kruise/sbx-1/49983`);
      expect((await sb.network.resolve(8080))[0]).toBe(`${origin}/kruise/sbx-1/8080`);

      seen.length = 0;
      const result = (await sb.commands.run("echo hi")) as ProcessResult;
      expect(result.exit_code).toBe(0);
      expect(result.stdout).toBe("hi\n");
      const start = seen.find((s) => s.url === "/process.Process/Start");
      expect(start?.headers["x-access-token"]).toBe("tok");
      expect(start?.headers["x-api-key"]).toBeUndefined();
      expect(start?.headers["e2b-sandbox-port"]).toBe("49983");

      const chunks = [];
      for await (const chunk of sb.commands.stream("echo hi")) chunks.push(chunk);
      expect(chunks.map((c) => c.data).join("")).toContain("hi");
      expect(chunks.some((c) => c.type === "exit" && c.exit_code === 0)).toBe(true);

      const processes = await sb.commands.list();
      expect(processes.map((p) => p.pid)).toContain(7);
      expect(processes.some((p) => p.command.includes("echo"))).toBe(true);
      seen.length = 0;
      await sb.commands.kill(7);
      expect(seen.some((s) => s.url === "/process.Process/SendSignal")).toBe(true);
      expect(seen.find((s) => s.url === "/process.Process/SendSignal")?.body.toString("utf8")).toContain("SIGNAL_SIGKILL");

      seen.length = 0;
      await sb.files.write("/tmp/a.txt", "hello");
      const write = seen.find((s) => s.method === "POST" && s.url.startsWith("/files?"));
      expect(write?.url).toContain("path=%2Ftmp%2Fa.txt");
      expect(write?.url).toContain("username=user");
      expect(write?.headers["x-api-key"]).toBeUndefined();
      expect(await sb.files.read("/tmp/a.txt")).toBe("file-bytes");
      const listed = await sb.files.list("/tmp");
      expect(listed.map((e) => e.name)).toEqual(["a.txt"]);
      expect(listed[0]?.path).toBe("/tmp/a.txt");

      seen.length = 0;
      const code = await sb.runCode("print(42)", { language: "python", envs: { A: "b" } });
      expect(code.stdout).toContain("42");
      expect(code.text).toContain("42");
      const exec = seen.find((s) => s.url === "/execute");
      expect(exec?.headers["e2b-sandbox-port"]).toBe("49999");
      expect(exec?.headers["x-access-token"]).toBe("tok");
      expect(exec?.headers["x-api-key"]).toBeUndefined();
      const execBody = JSON.parse(exec?.body.toString("utf8") ?? "{}") as { code?: string; language?: string; env_vars?: Record<string, string> };
      expect(execBody).toMatchObject({ code: "print(42)", language: "python", env_vars: { A: "b" } });

      const platform = seen.filter((s) => s.url.startsWith("/sandboxes") || s.url.startsWith("/v2/"));
      for (const call of platform) expect(call.headers["x-api-key"]).toBe("super-secret-key");

      const before = seen.length;
      await expect(sb.files.watch("/tmp")).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError);
      await expect(sb.code.createContext()).rejects.toThrow(/createContext/);
      expect(seen.length).toBe(before);
    } finally {
      await sb.kill();
    }
  });

  it("maps platform 401, 404 and 5xx and envd file and command errors", async () => {
    const options = native();
    const key = "super-secret-key";
    const rejected = async (template: string): Promise<unknown> => open({ ...options, api_key: key }, { template }).catch((err: unknown) => err);
    const unauthorized = await rejected("status-401");
    const missingTemplate = await rejected("status-404");
    const unavailable = await rejected("status-503");
    expect(unauthorized).toBeInstanceOf(InvalidAPIKeyError);
    expect(String(unauthorized)).toMatch(/HTTP 401/);
    expect(String(unauthorized)).not.toContain(key);
    expect(missingTemplate).toBeInstanceOf(TemplateNotFoundError);
    expect(String(missingTemplate)).not.toContain(key);
    expect(unavailable).toBeInstanceOf(SandboxCreationError);
    expect(String(unavailable)).toMatch(/backend unavailable/);
    expect(String(unavailable)).not.toContain(key);

    await expect(Sandbox.connect("missing-sbx", { provider: "alicloud-container", provider_options: options })).rejects.toBeInstanceOf(SandboxNotFoundError);
    await expect(Sandbox.connect("status-503", { provider: "alicloud-container", provider_options: options })).rejects.toBeInstanceOf(HTTPStatusError);

    const sb = await open(priv());
    try {
      await expect(sb.files.read("/status-404")).rejects.toBeInstanceOf(FileNotFoundError_);
      await expect(sb.files.read("/status-500")).rejects.toBeInstanceOf(FileOperationError);
      await expect(sb.files.read("/status-500")).rejects.toThrow(/HTTP 500/);
      await expect(sb.commands.run("status-500")).rejects.toBeInstanceOf(EnvdRpcError);
      await expect(sb.commands.run("status-500")).rejects.toThrow(/HTTP 500/);
    } finally {
      await sb.kill();
    }
  });
});

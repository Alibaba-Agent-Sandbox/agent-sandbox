import "../_support/isolatedHome.js";

/**
 * The catalog's `node/1` plugins (e2b, cubesandbox, alicloud-container) installed through the real installer and driven
 * through `Sandbox` against a local E2B-shaped server that serves both the control plane and envd.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import type { ProcessResult } from "../../src/models/process.js";
import { ProviderFeatureNotSupportedError } from "../../src/models/provider_errors.js";
import * as installer from "../../src/providers/installer.js";
import { getProvider } from "../../src/providers/registry.js";
import { useIso } from "../_support/iso.js";
import { type E2BMock, type Seen, startE2BMock } from "../_support/e2b_mock.js";
import { TEST_HOST_VERSION, catalogDir } from "../_support/plugins.js";

const iso = useIso();
const here = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = catalogDir();
const haveCatalog = fs.existsSync(path.join(CATALOG, "e2b", "abx-provider.toml"));

describe.skipIf(!haveCatalog)("node plugins from the catalog", () => {
  let mock: E2BMock;
  let origin = "";
  let port = 0;
  let seen: Seen[] = [];

  beforeEach(async () => {
    mock = await startE2BMock();
    ({ origin, port, seen } = mock);
  });
  afterEach(async () => {
    await mock.close();
  });

  const install = (id: string): Promise<unknown> => installer.install(path.join(CATALOG, id), { yes: true, hostVersion: TEST_HOST_VERSION });

  it("installs all three as node providers with their declared features", async () => {
    for (const id of ["e2b", "cubesandbox", "alicloud-container"]) {
      await install(id);
      const p = getProvider(id);
      expect(p.kind).toBe("node");
      expect(p.supports("files.rw")).toBe(true);
      expect(p.operations.cli.some(operation => operation === "code.execute")).toBe(false);
    }
    expect(getProvider("cubesandbox").supports("process.manage")).toBe(false);
    expect(getProvider("e2b").supports("process.manage")).toBe(true);
  });

  it("e2b: needs its own key, sends X-API-Key, and resumes through the v2 connect route", async () => {
    await install("e2b");
    iso.setenv("ABX_SANDBOX_API_KEY", "express-key");
    await expect(Sandbox.create({ provider: "e2b", provider_options: { base_url: origin }, template: "base" })).rejects.toThrow(/ABX_E2B_API_KEY|credentials|API key/i);

    const options = { base_url: origin, api_key: "e2b-key", domain: "e2b.test" };
    const sb = await Sandbox.create({ provider: "e2b", provider_options: options, template: "base", timeout: 60 });
    try {
      expect(sb.id).toBe("sbx-1");
      expect(seen[0]?.headers["x-api-key"]).toBe("e2b-key");
      expect(seen[0]?.headers["authorization"]).toBeUndefined();
      const other = await Sandbox.connect("sbx-1", { provider: "e2b", provider_options: options });
      const connect = seen.filter((s) => s.method === "POST" && s.url.endsWith("/connect"));
      expect(connect[0]?.url).toBe("/v2/sandboxes/sbx-1/connect");
      mock.flags.connectStatus = 404;
      seen.length = 0;
      await other.close();
      await Sandbox.connect("sbx-1", { provider: "e2b", provider_options: options }).catch(() => undefined);
      expect(seen.map((s) => `${s.method} ${s.url}`)).toContain("POST /sandboxes/sbx-1/connect");
    } finally {
      await sb.kill();
    }
    expect(seen.some((s) => s.method === "DELETE" && s.url === "/sandboxes/sbx-1")).toBe(true);
  });

  it("cubesandbox: no key header, http envd, root user, framed streams, dial through the proxy, Jupyter code", async () => {
    await install("cubesandbox");
    iso.setenv("ABX_SANDBOX_API_KEY", "express-key");
    const sb = await Sandbox.create({
      provider: "cubesandbox",
      provider_options: { base_url: origin, domain: "cube.test", proxy: `127.0.0.1:${port}` },
      template: "base",
      timeout: 60,
    });
    try {
      expect(seen[0]?.headers["x-api-key"]).toBeUndefined();
      expect(Object.values(seen[0]?.headers ?? {})).not.toContain("express-key");
      expect(sb.url).toBe("http://49983-sbx-1.reported.test");

      seen.length = 0;
      const result = (await sb.commands.run("echo hi")) as ProcessResult;
      expect(result.stdout).toBe("hi\n");
      const start = seen.find((s) => s.url === "/process.Process/Start");
      expect(start).toBeDefined();
      expect(start?.headers["host"]).toBe("49983-sbx-1.reported.test");
      expect(start?.headers["x-access-token"]).toBe("tok");
      expect(start?.headers["connect-protocol-version"]).toBe("1");
      expect(start?.body.readUInt8(0)).toBe(0);
      expect(start?.body.readUInt32BE(1)).toBe(start ? start.body.length - 5 : -1);
      expect(Buffer.from(String(start?.headers["authorization"]).split(" ")[1] as string, "base64").toString()).toBe("root:");
      expect(JSON.parse(start?.body.subarray(5).toString() ?? "{}").process).not.toHaveProperty("user");

      seen.length = 0;
      await sb.commands.run("echo hi", { user: "user" });
      const explicitUser = seen.find((s) => s.url === "/process.Process/Start");
      expect(Buffer.from(String(explicitUser?.headers["authorization"]).split(" ")[1] as string, "base64").toString()).toBe("user:");
      expect(explicitUser?.headers["x-access-token"]).toBe("tok");
      expect(JSON.parse(explicitUser?.body.subarray(5).toString() ?? "{}").process).not.toHaveProperty("user");

      seen.length = 0;
      await sb.files.write("/tmp/a.txt", "data");
      expect(seen[0]?.url).toBe("/files?path=%2Ftmp%2Fa.txt&username=root");
      expect(await sb.files.read("/tmp/a.txt")).toBe("file-bytes");
      expect(seen[1]?.url).toBe("/files?path=%2Ftmp%2Fa.txt&username=root");

      seen.length = 0;
      const code = await sb.runCode("print(42)", {operation:"code.default-context.execute"});
      const exec = seen.find((s) => s.url === "/execute");
      expect(exec?.headers["host"]).toBe("49999-sbx-1.reported.test");
      expect(exec?.headers["e2b-sandbox-port"]).toBe("49999");
      expect(JSON.stringify(code)).toContain("42");

      seen.length = 0;
      await sb.resume();
      expect(seen[0]?.method).toBe("POST");
      expect(seen[0]?.url).toBe("/sandboxes/sbx-1/resume");
      expect(seen[0]?.body.toString()).toBe("{}");
    } finally {
      await sb.kill();
    }
  });

  it("cubesandbox: an envd with no access token gets no token header", async () => {
    await install("cubesandbox");
    mock.flags.omitToken = true;
    const sb = await Sandbox.create({ provider: "cubesandbox", provider_options: { base_url: origin, domain: "cube.test", proxy: `127.0.0.1:${port}` }, template: "base" });
    try {
      seen.length = 0;
      expect(((await sb.commands.run("echo hi")) as ProcessResult).stdout).toBe("hi\n");
      const start = seen.find((s) => s.url === "/process.Process/Start");
      expect(start?.headers["x-access-token"]).toBeUndefined();
      expect(Buffer.from(String(start?.headers["authorization"]).split(" ")[1] as string, "base64").toString()).toBe("root:");
    } finally {
      await sb.kill();
    }
  });

  it("cubesandbox: a call that needs an undeclared feature raises E8004", async () => {
    await install("cubesandbox");
    const sb = await Sandbox.create({ provider: "cubesandbox", provider_options: { base_url: origin, domain: "cube.test", proxy: `127.0.0.1:${port}` }, template: "base" });
    try {
      await expect(sb.commands.list()).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError);
    } finally {
      await sb.kill();
    }
  });

  it("alicloud-container native: api.{domain} base, v2 list and Jupyter code", async () => {
    await install("alicloud-container");
    const options = { base_url: origin, domain: "acs.test", api_key: "k" };
    const sb = await Sandbox.create({ provider: "alicloud-container", provider_options: options, template: "base" });
    try {
      expect(seen[0]?.headers["x-api-key"]).toBe("k");
      expect(sb.url).toBe("https://49983-sbx-1.acs.test");
      const listed = await Sandbox.list({ provider: "alicloud-container", provider_options: options });
      expect(listed.map((i) => i.sandbox_id)).toEqual(["sbx-1"]);
      expect(seen.some((s) => s.url.startsWith("/v2/sandboxes?"))).toBe(true);
    } finally {
      await sb.kill();
    }
  });

  it("alicloud-container private: envd and port URLs live under /kruise/{id}/{port}", async () => {
    await install("alicloud-container");
    const sb = await Sandbox.create({
      provider: "alicloud-container",
      provider_options: { base_url: `${origin}/kruise/api`, domain: "acs.test", api_key: "k", protocol: "private" },
      template: "base",
    });
    try {
      expect(sb.url).toBe(`${origin}/kruise/sbx-1/49983`);
      expect((await sb.network.resolve(8080))[0]).toBe(`${origin}/kruise/sbx-1/8080`);
    } finally {
      await sb.kill();
    }
  });

  it("alicloud-container: a missing key and a missing domain are configuration errors", async () => {
    await install("alicloud-container");
    await expect(Sandbox.create({ provider: "alicloud-container", provider_options: { domain: "acs.test" }, template: "base" })).rejects.toThrow(/ABX_ALICLOUD_CONTAINER_API_KEY|credentials/i);
    await expect(Sandbox.create({ provider: "alicloud-container", provider_options: { api_key: "k" }, template: "base" })).rejects.toThrow(/domain|base URL/i);
  });
});

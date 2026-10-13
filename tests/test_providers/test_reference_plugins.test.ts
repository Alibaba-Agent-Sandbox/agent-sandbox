/**
 * The three reference plugins (local-process, e2b-compatible, opensandbox) validated through the CLI's provider layer.
 * The OpenSandbox cases use the plugin's in-process mock server, and a live server when one answers (see
 * `python-sdk/e2e/opensandbox/README.md`); they are skipped when the plugin tree is not checked out.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as installer from "../../src/providers/installer.js";
import { getProvider } from "../../src/providers/registry.js";
import { doctor } from "../../src/providers/doctor.js";
import { runContractSuite, summarizeContract, type ContractResult } from "../../src/providers/testing.js";
import { SandboxConfig } from "../../src/models/sandbox.js";
import { loadLayeredConfig } from "../../src/transport/config_layers.js";
import { useIso } from "../_support/iso.js";
import { E2B_COMPATIBLE, LOCAL_PROCESS, OPENSANDBOX, TEST_HOST_VERSION, pythonAvailable } from "../_support/plugins.js";

const iso = useIso();
const install = (src: string): Promise<unknown> => installer.install(src, { yes: true, hostVersion: TEST_HOST_VERSION });

const PY_EXAMPLES = path.dirname(OPENSANDBOX);

function treeFiles(dir: string, prefix = ""): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? treeFiles(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]))
    .filter((f) => !f.includes("__pycache__"))
    .sort();
}

describe("fixture copies of the reference plugins", () => {
  it.each([
    ["local-process", LOCAL_PROCESS],
    ["e2b-compatible", E2B_COMPATIBLE],
  ])("%s is identical to the python-sdk example when it is checked out", (name, copy) => {
    const original = path.join(PY_EXAMPLES, name);
    if (!fs.existsSync(original)) return;
    expect(treeFiles(copy)).toEqual(treeFiles(original));
    for (const f of treeFiles(copy)) expect(fs.readFileSync(path.join(copy, f)).equals(fs.readFileSync(path.join(original, f))), f).toBe(true);
  });
});

function report(results: ContractResult[]): string[] {
  return results.filter((r) => r.outcome === "failed").map((r) => `${r.name}: ${r.detail}`);
}

describe.skipIf(!pythonAvailable())("local-process", () => {
  it("installs, passes doctor and the contract kit", async () => {
    await install(LOCAL_PROCESS);
    expect((await doctor("local-process")).ok).toBe(true);
    const results = await runContractSuite("local-process");
    expect(report(results)).toEqual([]);
    expect(summarizeContract(results).passed).toBeGreaterThanOrEqual(12);
  }, 240_000);
});

describe("e2b-compatible (rest provider) over a local E2B-style server", () => {
  let server: http.Server;
  let origin = "";
  const seen: Array<{ method: string; url: string; key: string | undefined; auth: string | undefined }> = [];

  beforeEach(async () => {
    seen.length = 0;
    server = http.createServer((req, res) => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", key: req.headers["x-api-key"] as string | undefined, auth: req.headers["authorization"] });
      if (req.method === "POST" && req.url === "/sandboxes") {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sandboxID: "e2b-1", templateID: "base", envdAccessToken: "tok" }));
      } else if (req.method === "DELETE") {
        res.writeHead(204).end();
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await install(E2B_COMPATIBLE);
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  it("uses the inherited generic key and URL with the declared header scheme", async () => {
    iso.setenv("EBX_SANDBOX_API_KEY", "abcd1234");
    iso.setenv("EBX_SANDBOX_BASE_URL", origin);
    const infra = await getProvider("e2b-compatible").buildInfra(loadLayeredConfig({ provider: "e2b-compatible", http2: false }));
    try {
      const info = await infra.sandbox_protocol.create(new SandboxConfig({ template: "base" }), {});
      expect(info.sandbox_id).toBe("e2b-1");
      await infra.sandbox_protocol.kill("e2b-1");
    } finally {
      await infra.close?.();
    }
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["POST /sandboxes", "DELETE /sandboxes/e2b-1"]);
    expect(seen.every((s) => s.key === "abcd1234" && s.auth === undefined)).toBe(true);
  });

  it("scoped credentials win and never reach the built-in provider's namespace", async () => {
    iso.setenv("EBX_SANDBOX_API_KEY", "generic");
    iso.setenv("EBX_E2B_COMPATIBLE_SANDBOX_API_KEY", "scoped");
    iso.setenv("EBX_SANDBOX_BASE_URL", origin);
    const infra = await getProvider("e2b-compatible").buildInfra(loadLayeredConfig({ provider: "e2b-compatible", http2: false }));
    try {
      await infra.sandbox_protocol.create(new SandboxConfig({ template: "base" }), {});
    } finally {
      await infra.close?.();
    }
    expect(seen[0]?.key).toBe("scoped");
  });
});

const hasOpenSandbox = fs.existsSync(path.join(OPENSANDBOX, "ebx-provider.toml"));

describe.skipIf(!hasOpenSandbox)("opensandbox (exec provider, Node plugin)", () => {
  let tmp = "";
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ebx-osb-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("installs a copy, lists its features and runs the contract kit against the plugin's mock server", async () => {
    const mockModule = pathToFileURL(path.join(OPENSANDBOX, "tests", "mock", "mock-opensandbox.mjs")).href;
    const { startMock } = (await import(/* @vite-ignore */ mockModule)) as { startMock: (o?: object) => Promise<{ origin: string; apiKey: string; close: () => Promise<void> }> };
    const src = path.join(tmp, "opensandbox");
    fs.cpSync(OPENSANDBOX, src, { recursive: true, filter: (p) => !p.includes(`${path.sep}tests${path.sep}`) && !p.endsWith(`${path.sep}tests`) && !p.includes("node_modules") });
    await install(src);
    const prov = getProvider("opensandbox");
    expect(prov.kind).toBe("exec");
    expect(prov.inherit.size).toBe(0);
    expect(prov.supports("files.rw") && prov.supports("sandbox.pause") && prov.supports("sessions")).toBe(true);

    const mock = await startMock();
    try {
      const options = { base_url: mock.origin, api_key: mock.apiKey, ready_timeout: 20 };
      const results = await runContractSuite("opensandbox", { options });
      expect(report(results)).toEqual([]);
      const counts = summarizeContract(results);
      expect(counts.passed).toBeGreaterThanOrEqual(14);
      expect(JSON.stringify(results)).not.toContain(mock.apiKey);
    } finally {
      await mock.close();
    }
  }, 300_000);

  it("runs the contract kit against a live local OpenSandbox server when one answers", async (ctx) => {
    const base = process.env["OPENSANDBOX_URL"] ?? process.env["EBX_OPENSANDBOX_BASE_URL"] ?? "http://127.0.0.1:8080";
    const key = process.env["EBX_OPENSANDBOX_API_KEY"] ?? process.env["OPEN_SANDBOX_API_KEY"] ?? process.env["OPENSANDBOX_API_KEY"] ?? "local-dev-key";
    try {
      const res = await fetch(`${base.replace(/\/v1$/, "")}/health`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return ctx.skip();
    } catch {
      return ctx.skip();
    }
    const src = path.join(tmp, "opensandbox");
    fs.cpSync(OPENSANDBOX, src, { recursive: true, filter: (p) => !p.includes(`${path.sep}tests${path.sep}`) && !p.endsWith(`${path.sep}tests`) && !p.includes("node_modules") });
    await install(src);
    const options = { base_url: base.replace(/\/v1$/, ""), api_key: key, ready_timeout: 120 };
    const results = await runContractSuite("opensandbox", { options });
    expect(report(results)).toEqual([]);
    expect(JSON.stringify(results)).not.toContain(key);
  }, 600_000);
});

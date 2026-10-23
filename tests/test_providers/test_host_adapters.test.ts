/** Host-side adapters: wire names pinned by `epp-methods.json`, per-create options, ports.url (port of `test_host_adapters.py`). */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CommandTimeoutError, SandboxNotFoundError } from "../../src/models/errors.js";
import { SandboxConfig } from "../../src/models/sandbox.js";
import { FEATURES } from "../../src/providers/base.js";
import { AsyncQueue, mapError, type EppClient, type Notification } from "../../src/providers/epp.js";
import * as E from "../../src/models/provider_errors.js";
import * as xp from "../../src/providers/exec_provider.js";
import * as installer from "../../src/providers/installer.js";
import { getProvider } from "../../src/providers/registry.js";
import { loadLayeredConfig } from "../../src/transport/config_layers.js";
import { StreamReader } from "../../src/transport/streaming.js";
import { useIso } from "../_support/iso.js";
import { TEST_HOST_VERSION } from "../_support/plugins.js";

useIso();
const here = path.dirname(fileURLToPath(import.meta.url));
type Dict = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const TABLE: Record<string, Dict> = Object.fromEntries(
  (JSON.parse(fs.readFileSync(path.join(here, "..", "fixtures", "epp-methods.json"), "utf-8")).methods as Dict[]).map((m) => [m["method"], m]),
);
const ALL_FEATURES: ReadonlySet<string> = new Set(FEATURES);
const EPP = "epp://fake/sbx-1";

function typeOk(value: unknown, spec: string): boolean {
  return spec.split("|").some((alt) => {
    switch (alt) {
      case "string":
        return typeof value === "string";
      case "integer":
        return typeof value === "number" && Number.isInteger(value);
      case "boolean":
        return typeof value === "boolean";
      case "object":
        return typeof value === "object" && value !== null && !Array.isArray(value);
      case "array":
        return Array.isArray(value);
      case "number":
        return typeof value === "number";
      case "null":
        return value === null;
      default:
        return false;
    }
  });
}

function checkAgainstTable(method: string, params: Dict): void {
  const entry = TABLE[method];
  expect(entry, `adapter calls '${method}', which epp-methods.json does not list`).toBeDefined();
  const spec = (entry as Dict)["params"] as Dict;
  const unknown = Object.keys(params).filter((k) => !(k in spec));
  expect(unknown, `${method}: params ${unknown.join(",")} are not in the method table`).toEqual([]);
  for (const [name, rule] of Object.entries(spec)) {
    if (rule["required"]) expect(name in params, `${method}: required param '${name}' is not sent`).toBe(true);
    if (name in params) expect(typeOk(params[name], rule["type"]), `${method}.${name}=${JSON.stringify(params[name])} is not ${rule["type"]}`).toBe(true);
  }
}

class FakeClient {
  readonly provider_id = "fake";
  failure = null;
  calls: Array<[string, Dict]> = [];
  queues = new Map<string, AsyncQueue<Notification | null>>();
  constructor(private readonly noConnect = false) {}

  openStream(processId: string): AsyncQueue<Notification | null> {
    const q = new AsyncQueue<Notification | null>();
    q.push({ method: "exec.output", stream: "stdout", data: "hi" });
    q.push({ method: "exec.exit", exit_code: 0 });
    this.queues.set(processId, q);
    return q;
  }
  closeStream(processId: string): void {
    this.queues.delete(processId);
  }
  async call(method: string, params: Dict = {}): Promise<unknown> {
    this.calls.push([method, { ...params }]);
    checkAgainstTable(method, params);
    if (method === "sandbox.connect" && this.noConnect) throw mapError({ code: -32601, message: "unknown method" }, "fake");
    const record = { sandbox_id: "sbx-1", template: "base", status: "running" };
    const table: Dict = {
      "sandbox.create": record,
      "sandbox.get": record,
      "sandbox.connect": record,
      "sandbox.list": { sandboxes: [record] },
      "exec.run": { exit_code: 0, stdout: "x", stderr: "" },
      "exec.start": { process_id: "proc-1" },
      "process.list": { processes: [{ pid: "proc-1", command: "sleep" }, { pid: 7 }] },
      "files.read": { content_b64: "", size: 0 },
      "files.list": { entries: [] },
      "files.stat": { name: "a", path: "/a", type: "file", size: 1 },
      "ports.url": { url: "https://p.example/8080", headers: { "X-T": "1" } },
    };
    return table[method] ?? {};
  }
}

const asClient = (c: FakeClient): EppClient => c as unknown as EppClient;
const withExtras = (cfg: SandboxConfig, extra: { secure?: boolean; provider_options?: Dict }): xp.CreateConfig => Object.assign(cfg, extra) as xp.CreateConfig;
const TOKEN = null as never;

async function exerciseEveryAdapter(client: FakeClient, stream: boolean): Promise<void> {
  const feats = stream ? ALL_FEATURES : new Set([...ALL_FEATURES].filter((f) => f !== "exec.stream"));
  const sandbox = new xp.ExecSandboxProtocol(asClient(client), feats, new Set(["token"]));
  await sandbox.create(withExtras(new SandboxConfig({ template: "base" }), { secure: false, provider_options: { mode: "x", token: "s3cr3t" } }), { request_timeout: 5 });
  await sandbox.connect("sbx-1");
  await sandbox.getInfo("sbx-1");
  await sandbox.list({ limit: 5 });
  await sandbox.setTimeout("sbx-1", 60);
  await sandbox.pause("sbx-1");
  await sandbox.resume("sbx-1");
  await sandbox.portUrl("sbx-1", 8080);
  await sandbox.kill("sbx-1");

  const fs_ = new xp.ExecFilesystemProtocol(asClient(client), feats, null);
  await fs_.stat(EPP, TOKEN, { path: "/a" });
  await fs_.listDir(EPP, TOKEN, { path: "/" });
  await fs_.makeDir(EPP, TOKEN, { path: "/d" });
  await fs_.remove(EPP, TOKEN, { path: "/d" });
  await fs_.move(EPP, TOKEN, { source: "/a", destination: "/b" });
  await fs_.uploadFile(EPP, TOKEN, { path: "/a", content: Buffer.from("x") });
  await fs_.downloadFile(EPP, TOKEN, { path: "/a" });

  const proc = new xp.ExecProcessProtocol(asClient(client), feats, null);
  const reader = await proc.start(EPP, TOKEN, { cmd: "echo", args: ["hi"], timeout: 5 });
  expect(reader).toBeInstanceOf(StreamReader);
  const chunks = [];
  for await (const c of reader) chunks.push(c);
  expect(chunks.length).toBeGreaterThan(0);
  await proc.listProcesses(EPP, TOKEN);
  await proc.sendSignal(EPP, TOKEN, { pid: "proc-1", signal: 9 });
  await proc.sendSignal(EPP, TOKEN, { pid: 7, signal: 9 });
  await proc.sendSignal(EPP, TOKEN, { pid: 7, signal: 9 });
  await proc.sendInput(EPP, TOKEN, { pid: "proc-1", data: "x" });
}

describe("method table", () => {
  it.each([
    ["exec.stream", true],
    ["exec.run-only", false],
  ])("test_adapter_params_match_the_method_table[%s]", async (_id, stream) => {
    const client = new FakeClient();
    await exerciseEveryAdapter(client, stream);
    const sent = new Set(client.calls.map(([m]) => m));
    const expected = new Set(
      Object.entries(TABLE)
        .filter(([name, entry]) => entry["host_calls"] && name !== "initialize" && name !== "shutdown")
        .map(([name]) => name),
    );
    expected.delete(stream ? "exec.run" : "exec.start");
    const missing = [...expected].filter((m) => !sent.has(m));
    expect(missing).toEqual([]);
    expect(sent.has("files.move")).toBe(true);
    const move = client.calls.find(([m]) => m === "files.move")?.[1] as Dict;
    expect(new Set(Object.keys(move))).toEqual(new Set(["sandbox_id", "source", "destination"]));
  });

  it("test_method_table_is_consistent", () => {
    for (const [name, entry] of Object.entries(TABLE)) {
      expect(["required", "optional", "extension"], name).toContain(entry["support"]);
      expect(entry["feature"] === null || ALL_FEATURES.has(entry["feature"]), name).toBe(true);
      for (const rule of Object.values(entry["params"] as Dict)) expect(new Set(Object.keys(rule as Dict))).toEqual(new Set(["type", "required"]));
    }
    expect(TABLE["sandbox.get"]?.["support"]).toBe("required");
    expect(TABLE["sandbox.connect"]?.["support"]).toBe("optional");
    expect(TABLE["process.kill"]?.["params"]["pid"]["type"]).toBe("string|integer");
    expect(TABLE["exec.start"]?.["result"]).toBe("{process_id: string|integer}");
  });
});

describe("ExecSandboxProtocol", () => {
  it("test_create_sends_secure_only_when_specified_and_filters_secret_options", async () => {
    const client = new FakeClient();
    const sandbox = new xp.ExecSandboxProtocol(asClient(client), ALL_FEATURES, new Set(["token"]));
    await sandbox.create(new SandboxConfig({ template: "base" }));
    let params = (client.calls.at(-1) as [string, Dict])[1];
    expect("secure" in params || "options" in params).toBe(false);
    await sandbox.create(withExtras(new SandboxConfig({ template: "base" }), { secure: false, provider_options: { m: 1, token: "zzz" } }));
    params = (client.calls.at(-1) as [string, Dict])[1];
    expect(params["secure"]).toBe(false);
    expect(params["options"]).toEqual({ m: 1 });
    expect(JSON.stringify(params)).not.toContain("zzz");
    await sandbox.create(withExtras(new SandboxConfig({ template: "base" }), { secure: true }));
    expect((client.calls.at(-1) as [string, Dict])[1]["secure"]).toBe(true);
  });

  it("test_connect_falls_back_to_get_once_and_remembers", async () => {
    const client = new FakeClient(true);
    const sandbox = new xp.ExecSandboxProtocol(asClient(client), ALL_FEATURES);
    expect((await sandbox.connect("sbx-1")).sandbox_id).toBe("sbx-1");
    expect((await sandbox.connect("sbx-1")).sandbox_id).toBe("sbx-1");
    expect(client.calls.map(([m]) => m)).toEqual(["sandbox.connect", "sandbox.get", "sandbox.get"]);
  });

  it("test_connect_does_not_swallow_real_errors", async () => {
    class Failing extends FakeClient {
      override async call(): Promise<never> {
        throw mapError({ code: -32002, message: "nope" }, "fake");
      }
    }
    const sandbox = new xp.ExecSandboxProtocol(asClient(new Failing()), ALL_FEATURES);
    await expect(sandbox.connect("x")).rejects.toBeInstanceOf(SandboxNotFoundError);
    await expect(sandbox.getInfo("x")).rejects.toMatchObject({ code: "E2009", message: "nope" });
  });

  it("test_sandbox_not_found_is_one_error_for_every_sandbox_call", async () => {
    class Gone extends FakeClient {
      override async call(): Promise<never> {
        throw mapError({ code: -32002, message: "gone" }, "fake");
      }
    }
    const sandbox = new xp.ExecSandboxProtocol(asClient(new Gone()), ALL_FEATURES);
    for (const call of [() => sandbox.setTimeout("x", 5), () => sandbox.pause("x"), () => sandbox.resume("x")]) {
      await expect(call()).rejects.toBeInstanceOf(SandboxNotFoundError);
    }
  });

  it("test_plugin_can_name_sandbox_not_found_itself", () => {
    const exc = mapError({ code: -32002, message: "no such sandbox", data: { sdk_code: "E2009" } }, "fake");
    expect(exc).toBeInstanceOf(SandboxNotFoundError);
    expect((exc as SandboxNotFoundError).code).toBe("E2009");
  });

  it("test_kill_swallows_not_found", async () => {
    class Gone extends FakeClient {
      override async call(): Promise<never> {
        throw mapError({ code: -32002, message: "gone" }, "fake");
      }
    }
    await new xp.ExecSandboxProtocol(asClient(new Gone()), ALL_FEATURES).kill("sbx-1");
  });

  it("test_port_url_requires_the_feature", async () => {
    const sandbox = new xp.ExecSandboxProtocol(asClient(new FakeClient()), new Set([...ALL_FEATURES].filter((f) => f !== "ports.url")));
    expect(sandbox.hasPortUrl).toBe(false);
    await expect(sandbox.portUrl("sbx-1", 80)).rejects.toBeInstanceOf(E.ProviderFeatureNotSupportedError);
  });
});

describe("ExecProcessProtocol", () => {
  it.each([undefined, null, "", "   ", 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("refuses an invalid startup ID before emitting an acknowledgement: %j", async processId => {
    class MissingId extends FakeClient {
      override async call(method: string, params: Dict = {}): Promise<unknown> {
        if (method === "exec.start") return { process_id: processId };
        return super.call(method, params);
      }
    }
    const client = new MissingId();
    const proc = new xp.ExecProcessProtocol(asClient(client), ALL_FEATURES, null);
    const reader = await proc.start(EPP, TOKEN, { cmd: "silent-server", timeout: 1 });
    await expect(reader.next()).rejects.toBeInstanceOf(E.ProviderProtocolError);
    expect(client.queues.size).toBe(0);
  });

  it("test_process_info_accepts_string_ids", async () => {
    const proc = new xp.ExecProcessProtocol(asClient(new FakeClient()), ALL_FEATURES, null);
    const infos = await proc.listProcesses(EPP, TOKEN);
    expect(infos.map((i) => i.pid)).toEqual(["proc-1", 7]);
  });

  it("test_stream_timeout_is_a_typed_error", async () => {
    class Silent extends FakeClient {
      override openStream(processId: string): AsyncQueue<Notification | null> {
        const q = new AsyncQueue<Notification | null>();
        this.queues.set(processId, q);
        return q;
      }
    }
    const proc = new xp.ExecProcessProtocol(asClient(new Silent()), ALL_FEATURES, null);
    const reader = await proc.start(EPP, TOKEN, { cmd: "sleep", args: ["9"], timeout: 0 });
    const saved = xp.execTuning.exitGraceSeconds;
    xp.execTuning.exitGraceSeconds = 0.05;
    try {
      await expect(
        (async () => {
          for await (const _ of reader) void _;
        })(),
      ).rejects.toBeInstanceOf(CommandTimeoutError);
    } finally {
      xp.execTuning.exitGraceSeconds = saved;
    }
  });

  it("test_native_urls_are_delegated_in_hybrid_mode", async () => {
    const proc = new xp.ExecProcessProtocol(asClient(new FakeClient()), ALL_FEATURES, null);
    await expect(proc.listProcesses("https://envd.example", TOKEN)).rejects.toBeInstanceOf(E.ProviderFeatureNotSupportedError);
  });
});

const ECHO_PLUGIN = `
const fs = require("fs");
const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const rl = require("readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  const rid = msg.id, method = msg.method, p = msg.params || {};
  let res;
  if (method === "initialize") res = { protocol: "epp/1", plugin: { name: "echo", version: "1" }, operation_contract_version: 1, operations: {cli:[],python:[]}, features: ["sandbox.lifecycle", "ports.url"] };
  else if (method === "sandbox.create") res = { sandbox_id: "echo-1", template: p.template || "base", status: "running", metadata: { create: JSON.stringify(p) } };
  else if (method === "sandbox.get") res = { sandbox_id: p.sandbox_id, template: "base", status: "running", metadata: { via: "get" } };
  else if (method === "sandbox.kill") res = {};
  else if (method === "ports.url") res = { url: "https://echo.example/" + p.sandbox_id + "/" + p.port, headers: { "X-Echo": "1" } };
  else if (method === "shutdown") { send({ jsonrpc: "2.0", id: rid, result: {} }); process.exit(0); }
  else { send({ jsonrpc: "2.0", id: rid, error: { code: -32601, message: "unknown method" } }); return; }
  send({ jsonrpc: "2.0", id: rid, result: res });
});
`;

const ECHO_MANIFEST = `manifest_version = 1
operation_contract_version = 1
[operations]
cli = []
python = []
[workflow]
inputs = ["managed"]
startups = ["none"]

[provider]
id = "echo-prov"
name = "Echo"
version = "0.1.0"

[compat]
requires = { cli = ">=0.3" }

[runtime]
kind = "exec"
command = ["node", "./provider.cjs"]

[features]
supported = ["sandbox.lifecycle", "ports.url"]

[config.fields.mode]
type = "string"

[config.fields.token]
type = "string"
secret = true
`;

describe("echo plugin through the provider", () => {
  let tmp = "";
  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-echo-"));
    fs.writeFileSync(path.join(tmp, "abx-provider.toml"), ECHO_MANIFEST);
    fs.writeFileSync(path.join(tmp, "provider.cjs"), ECHO_PLUGIN);
    await installer.install(tmp, { yes: true, hostVersion: TEST_HOST_VERSION });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  async function infra(options: Dict = {}) {
    return getProvider("echo-prov").buildInfra(loadLayeredConfig({ provider: "echo-prov", provider_options: options }));
  }

  it("test_sandbox_create_passes_options_and_secure_to_the_plugin", async () => {
    const i = await infra({ mode: "fast", token: "hunter2-secret" });
    try {
      const cfg = withExtras(new SandboxConfig({ template: "base" }), { secure: false, provider_options: { mode: "fast", token: "hunter2-secret" } });
      const info = await i.sandbox_protocol.create(cfg, {});
      const sent = JSON.parse(info.metadata["create"] as string);
      expect(sent["secure"]).toBe(false);
      expect(sent["options"]).toEqual({ mode: "fast" });
      expect(JSON.stringify(sent)).not.toContain("hunter2-secret");
    } finally {
      await i.close?.();
    }
  });

  it("test_sandbox_create_without_secure_sends_no_hint", async () => {
    const i = await infra();
    try {
      const info = await i.sandbox_protocol.create(new SandboxConfig({ template: "base" }), {});
      const sent = JSON.parse(info.metadata["create"] as string);
      expect("secure" in sent || "options" in sent).toBe(false);
    } finally {
      await i.close?.();
    }
  });

  it("test_network_resolves_through_ports_url", async () => {
    const i = await infra();
    try {
      const info = await i.sandbox_protocol.create(new SandboxConfig({ template: "base" }), {});
      const sp = i.sandbox_protocol as unknown as xp.ExecSandboxProtocol;
      const [url, headers] = await sp.portUrl(info.sandbox_id, 8080);
      expect(url).toBe(`https://echo.example/${info.sandbox_id}/8080`);
      expect(headers).toEqual({ "X-Echo": "1" });
    } finally {
      await i.close?.();
    }
  });

  it("test_connect_uses_get_when_plugin_has_no_connect", async () => {
    const i = await infra();
    try {
      const info = await i.sandbox_protocol.create(new SandboxConfig({ template: "base" }), {});
      const again = await i.sandbox_protocol.connect(info.sandbox_id);
      expect(again.metadata["via"]).toBe("get");
    } finally {
      await i.close?.();
    }
  });
});

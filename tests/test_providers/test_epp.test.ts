/** EPP/1 client against the reference plugin and purpose-built misbehaving plugins (port of `test_epp.py`). */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as E from "../../src/providers/errors.js";
import * as epp from "../../src/providers/epp.js";
import { EppClient, exitCodeFor, mapError, scrubbedEnv } from "../../src/providers/epp.js";
import * as installer from "../../src/providers/installer.js";
import * as registry from "../../src/providers/registry.js";
import * as store from "../../src/providers/store.js";
import { loadLayeredConfig } from "../../src/transport/config_layers.js";
import { InvalidAPIKeyError, AuthenticationError, CapabilityNotSupportedError, CommandTimeoutError, FileNotFoundError_, QuotaExceededError, TemplateNotFoundError } from "../../src/models/errors.js";
import { useIso } from "../_support/iso.js";
import { LOCAL_PROCESS, TEST_HOST_VERSION, pythonAvailable } from "../_support/plugins.js";

const iso = useIso();
const INIT = { protocol: "epp/1", host: { name: "test", version: "0" }, provider_id: "t", config: {}, core: {}, locale: "en" };

let tmp = "";
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-epp-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PRELUDE = `const fs = require("fs");
function send(o) { process.stdout.write(JSON.stringify(o) + "\\n"); }
`;

function script(body: string): string[] {
  const file = path.join(tmp, "plugin.cjs");
  fs.writeFileSync(file, PRELUDE + body, "utf-8");
  return [process.execPath, file];
}

function client(body: string, opts: { startupTimeout?: number; callTimeout?: number; secrets?: string[] } = {}): EppClient {
  const data = path.join(tmp, "data");
  fs.mkdirSync(data, { recursive: true });
  return new EppClient("t", script(body), {
    cwd: data,
    env: scrubbedEnv(data),
    startupTimeout: opts.startupTimeout ?? 3,
    callTimeout: opts.callTimeout ?? 3,
    ...(opts.secrets ? { secrets: opts.secrets } : {}),
  });
}

const LOOP = `
const rl = require("readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocol: "epp/1", features: ["sandbox.lifecycle"] } });
  else if (msg.method === "shutdown") { send({ jsonrpc: "2.0", id: msg.id, result: {} }); process.exit(0); }
  else handle(msg);
});
`;

/** A plugin whose `handle(msg)` is `handlerBody`. */
const serve = (handlerBody: string): string => `function handle(msg) {\n${handlerBody}\n}\n${LOOP}`;

async function rejectsWith<T extends Error>(p: Promise<unknown>, cls: new (...a: never[]) => T): Promise<T> {
  try {
    await p;
  } catch (exc) {
    expect(exc).toBeInstanceOf(cls);
    return exc as T;
  }
  throw new Error(`expected ${cls.name}`);
}

const code = (e: Error): string => (e as E.ProviderError).code;

describe("EppClient", () => {
  it("test_handshake_and_ping", async () => {
    const c = client(serve('send({ jsonrpc: "2.0", id: msg.id, result: msg.params });'));
    const result = await c.start(INIT);
    try {
      expect(result["protocol"]).toBe("epp/1");
      expect([...c.features]).toEqual(["sandbox.lifecycle"]);
      expect(await c.call("echo", { a: 1 })).toEqual({ a: 1 });
      const results = (await Promise.all(Array.from({ length: 20 }, (_, i) => c.call("echo", { n: i })))) as Array<{ n: number }>;
      expect(results.map((r) => r.n)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    } finally {
      await c.close();
    }
  });

  it("test_protocol_mismatch_is_version_error", async () => {
    const c = client(`
      require("readline").createInterface({ input: process.stdin }).on("line", (line) => {
        send({ jsonrpc: "2.0", id: JSON.parse(line).id, result: { protocol: "epp/9" } });
      });
    `);
    const exc = await rejectsWith(c.start(INIT), E.ProviderVersionError);
    expect(code(exc)).toBe("E8013");
  });

  it("test_startup_timeout", async () => {
    const c = client("setTimeout(() => {}, 30000);", { startupTimeout: 0.5 });
    const t0 = Date.now();
    const exc = await rejectsWith(c.start(INIT), E.ProviderTimeoutError);
    expect(code(exc)).toBe("E8022");
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it("test_call_timeout", async () => {
    const c = client(serve("/* never answers */"), { callTimeout: 0.4 });
    await c.start(INIT);
    try {
      await rejectsWith(c.call("slow", {}), E.ProviderTimeoutError);
    } finally {
      await c.close();
    }
  });

  it("test_missing_executable", async () => {
    const c = new EppClient("t", [path.join(tmp, "nope")], { cwd: tmp, env: scrubbedEnv(tmp) });
    const exc = await rejectsWith(c.start(INIT), E.ProviderProcessError);
    expect(code(exc)).toBe("E8021");
  });

  it("test_plugin_exits_during_startup_includes_stderr", async () => {
    const c = client('fs.writeSync(2, "boom: missing dependency\\n"); process.exit(4);');
    const exc = await rejectsWith(c.start(INIT), E.ProviderProcessError);
    expect(String(exc)).toContain("missing dependency");
  });

  it("test_crash_mid_session_fails_pending_and_future_calls", async () => {
    const c = client(serve('fs.writeSync(2, "fatal: oops\\n"); process.exit(3);'));
    await c.start(INIT);
    try {
      const exc = await rejectsWith(c.call("die", {}), E.ProviderProcessError);
      expect(String(exc)).toContain("oops");
      await rejectsWith(c.call("echo", {}), E.ProviderProcessError);
    } finally {
      await c.close();
    }
  });

  it("test_garbage_line_is_protocol_error", async () => {
    const c = client(serve('process.stdout.write("this is not json\\n");'));
    await c.start(INIT);
    try {
      const exc = await rejectsWith(c.call("bad", {}), E.ProviderProtocolError);
      expect(code(exc)).toBe("E8020");
    } finally {
      await c.close();
    }
  });

  it("test_oversized_line_is_protocol_error", async () => {
    const c = client(serve('process.stdout.write("x".repeat(9 * 1024 * 1024) + "\\n");'));
    await c.start(INIT);
    try {
      await rejectsWith(c.call("big", {}), E.ProviderProtocolError);
    } finally {
      await c.close();
    }
  });

  it("test_error_response_is_mapped", async () => {
    const c = client(serve('send({ jsonrpc: "2.0", id: msg.id, error: { code: -32002, message: "gone", data: { sdk_code: "E2000" } } });'));
    await c.start(INIT);
    try {
      await rejectsWith(c.call("nf", {}), E.ProviderResourceNotFoundError);
    } finally {
      await c.close();
    }
  });

  it("test_secret_values_are_redacted_everywhere", async () => {
    const secret = "s3cr3t-token-value";
    const c = client(
      serve(`
        fs.writeSync(2, "token=" + ${JSON.stringify(secret)} + "\\n");
        send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "bad " + ${JSON.stringify(secret)} } });
      `),
      { secrets: [secret] },
    );
    await c.start(INIT);
    try {
      const exc = await rejectsWith(c.call("leak", {}), E.ProviderError);
      await new Promise((r) => setTimeout(r, 200));
      expect(String(exc)).not.toContain(secret);
      expect(c.stderrTail).not.toContain(secret);
      expect(c.stderrTail).toContain("***");
    } finally {
      await c.close();
    }
  });

  it.skipIf(process.platform === "win32")("test_close_terminates_process_group", async () => {
    const pidfile = path.join(tmp, "child.pid");
    const c = client(
      serve(`
        const child = require("child_process").spawn("sleep", ["60"], { stdio: "ignore" });
        fs.writeFileSync(${JSON.stringify(pidfile)}, String(child.pid));
        send({ jsonrpc: "2.0", id: msg.id, result: {} });
      `),
    );
    await c.start(INIT);
    await c.call("spawn", {});
    const child = Number(fs.readFileSync(pidfile, "utf-8"));
    await c.close();
    await new Promise((r) => setTimeout(r, 300));
    expect(() => process.kill(child, 0)).toThrow(/ESRCH/);
  });
});

describe("TestScrubbedEnv", () => {
  it("test_only_allowlist_and_data_dir", () => {
    const env = scrubbedEnv(tmp, ["MY_PASS"], {
      PATH: "/bin",
      HOME: "/h",
      LC_ALL: "C",
      ABX_SANDBOX_API_KEY: "secret",
      E2B_API_KEY: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
      MY_PASS: "yes",
      RANDOM: "x",
    });
    expect(new Set(Object.keys(env))).toEqual(new Set(["PATH", "HOME", "LC_ALL", "MY_PASS", "ABX_PROVIDER_DATA_DIR", "PYTHONDONTWRITEBYTECODE"]));
    expect(env["ABX_PROVIDER_DATA_DIR"]).toBe(tmp);
  });

  it("test_resolve_command_confines_dot_slash", () => {
    fs.writeFileSync(path.join(tmp, "p.py"), "");
    const argv = epp.resolveCommand(["python3", "./p.py", "plain"], tmp);
    expect(argv).toEqual(["python3", path.resolve(tmp, "p.py"), "plain"]);
    expect(() => epp.resolveCommand(["./../x"], path.join(tmp, "sub"))).toThrow(E.ProviderManifestError);
  });
});

describe("TestMapError", () => {
  const CASES: Array<[number, Record<string, unknown>, abstract new (...a: never[]) => unknown, number]> = [
    [-32001, {}, AuthenticationError, 3],
    [-32001, { sdk_code: "E1001" }, InvalidAPIKeyError, 3],
    [-32002, {}, E.ProviderResourceNotFoundError, 4],
    [-32002, { sdk_code: "E2000" }, E.ProviderResourceNotFoundError, 4],
    [-32002, { sdk_code: "E2001" }, TemplateNotFoundError, 4],
    [-32002, { sdk_code: "E4001" }, FileNotFoundError_, 4],
    [-32003, { details: { feature: "pty" } }, E.ProviderFeatureNotSupportedError, 1],
    [-32004, {}, QuotaExceededError, 6],
    [-32005, {}, E.ProviderTimeoutError, 5],
    [-32006, {}, E.ProviderConfigError, 2],
    [-32000, {}, E.ProviderError, 1],
    [-32000, { sdk_code: "E4001" }, FileNotFoundError_, 4],
    [-32000, { sdk_code: "E3001" }, CommandTimeoutError, 5],
    [-32601, {}, E.ProviderProtocolError, 1],
    [123, {}, E.ProviderProtocolError, 1],
  ];
  it.each(CASES)("test_codes[%s %j]", (rpc, data, cls, exit) => {
    const exc = mapError({ code: rpc, message: "m", data }, "prov");
    expect(exc.constructor).toBe(cls);
    expect(exitCodeFor(exc)).toBe(exit);
  });

  it("test_feature_error_is_both_provider_and_capability_error", () => {
    const exc = mapError({ code: -32003, message: "no", data: { details: { feature: "pty" } } }, "p");
    expect(exc).toBeInstanceOf(E.ProviderError);
    expect(exc).toBeInstanceOf(CapabilityNotSupportedError);
    expect(code(exc)).toBe("E8004");
  });

  it("test_text_is_sanitised", () => {
    const exc = mapError({ code: -32000, message: "\x1b[31mred\x1b[0m\x00 tok-12345", data: {} }, "p", ["tok-12345"]);
    expect(exc.message).not.toContain("\x1b");
    expect(exc.message).not.toContain("\x00");
    expect(exc.message).not.toContain("tok-12345");
  });

  it("test_exit_code_for_other_errors", () => {
    expect(exitCodeFor(new E.ProviderNotFoundError("x"))).toBe(4);
    expect(exitCodeFor(new E.ProviderTrustError("x"))).toBe(2);
    expect(exitCodeFor(new E.ProviderMismatchError("x"))).toBe(2);
    expect(exitCodeFor(new E.ProviderIntegrityError("x"))).toBe(1);
    expect(exitCodeFor(new Error("x"))).toBe(1);
  });
});

describe.skipIf(!pythonAvailable())("reference plugin", () => {
  it("test_reference_plugin_env_is_scrubbed_and_config_arrives_via_initialize", async () => {
    await installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });
    iso.setenv("ABX_SANDBOX_API_KEY", "parent-secret-1");
    iso.setenv("E2B_API_KEY", "parent-secret-2");
    iso.setenv("AWS_SECRET_ACCESS_KEY", "parent-secret-3");
    const provider = registry.getProvider("local-process");
    const cfg = loadLayeredConfig({ provider: "local-process", provider_options: { debug: true, token: "tok-abcdefgh" } });
    const infra = await provider.buildInfra(cfg);
    try {
      const c = (infra.sandbox_protocol as unknown as { client: EppClient }).client;
      const res = (await c.call("debug.env", {})) as { env: Record<string, string>; config_keys: string[] };
      const blob = JSON.stringify(res);
      expect(blob).not.toContain("parent-secret");
      expect(blob).not.toContain("tok-abcdefgh");
      expect(res.env["ABX_PROVIDER_DATA_DIR"]).toBe(store.dataDir("local-process"));
      expect(res.env["PYTHONDONTWRITEBYTECODE"]).toBe("1");
      expect(Object.keys(res.env).some((k) => /^(ABX_SANDBOX|E2B_|AWS_)/.test(k))).toBe(false);
      expect(new Set(res.config_keys)).toEqual(new Set(["debug", "token"]));
      await c.call("debug.leak", {});
      await new Promise((r) => setTimeout(r, 200));
      expect(c.stderrTail).not.toContain("tok-abcdefgh");
    } finally {
      await infra.close?.();
    }
  });
});

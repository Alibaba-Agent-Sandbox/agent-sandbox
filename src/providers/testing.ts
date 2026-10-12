/**
 * Provider contract kit (port of `providers/testing.py::ProviderContractTests`).
 *
 * The kit drives a provider through the same protocol objects the CLI uses (`provider.buildInfra`), so it needs no
 * test framework: `runContractSuite()` returns plain results (used by `ebx provider test`), and
 * `defineProviderContractTests()` registers the cases with any `describe`/`it` pair (vitest, node:test, ...).
 * Only features the plugin declares are exercised; the rest are reported as skipped.
 */

import * as assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { CapabilityNotSupportedError, FileNotFoundError_, SandboxError } from "../models/errors.js";
import { FileType } from "../models/filesystem.js";
import { ProcessChunkType, type ProcessChunk } from "../models/process.js";
import { SandboxConfig, type SandboxInfo } from "../models/sandbox.js";
import { EnvdTokenManager } from "../transport/auth.js";
import { loadLayeredConfig } from "../transport/config_layers.js";
import { FEATURES, type Provider, type ProviderInfra } from "./base.js";
import { ProviderFeatureNotSupportedError, ProviderResourceNotFoundError } from "./errors.js";
import * as registry from "./registry.js";

const UNKNOWN_ID = "does-not-exist-0000";

/** Thrown by a case to report "not applicable" (feature not declared). */
export class SkipContractTest extends Error {}

export type ContractOutcome = "passed" | "failed" | "skipped";

export interface ContractResult {
  name: string;
  outcome: ContractOutcome;
  detail: string;
  ms: number;
}

export interface ContractOptions {
  options?: Record<string, unknown>;
  /** Restrict to case names containing this substring. */
  filter?: string;
}

/** `["a=1", "b=x=y"]` to `{a: "1", b: "x=y"}` (the `--option` / `--opt` syntax). */
export function parseOptions(pairs: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx <= 0 || !pair.slice(0, idx).trim()) throw new Error(`--option expects KEY=VALUE, got '${pair}'`);
    out[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
  }
  return out;
}

interface Chunks {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  chunks: ProcessChunk[];
}

/** Everything a case needs: the provider, its infra, and sandbox helpers. */
export class ContractHarness {
  readonly provider: Provider;
  private infraPromise: Promise<ProviderInfra> | null = null;

  constructor(
    readonly providerId: string,
    readonly options: Record<string, unknown>,
  ) {
    this.provider = registry.getProvider(providerId);
  }

  get features(): ReadonlySet<string> {
    return this.provider.features;
  }

  need(...features: string[]): void {
    for (const f of features) if (!this.features.has(f)) throw new SkipContractTest(`${this.providerId} does not declare ${f}`);
  }

  /** A fresh infra (and, for exec providers, plugin process) per call; `close()` must always run. */
  async openInfra(extra: Record<string, unknown> = {}): Promise<ProviderInfra> {
    const config = loadLayeredConfig({ provider: this.providerId, provider_options: { ...this.options, ...extra } });
    return this.provider.buildInfra(config);
  }

  async infra(): Promise<ProviderInfra> {
    this.infraPromise ??= this.openInfra();
    return this.infraPromise;
  }

  async close(): Promise<void> {
    if (this.infraPromise) {
      const infra = await this.infraPromise.catch(() => null);
      this.infraPromise = null;
      await infra?.close?.();
    }
  }

  /** Mirrors the API layer: built-in/rest providers are gated on declared features before any call. */
  guard(feature: string): void {
    if (this.provider.kind !== "exec") this.provider.require(feature);
  }

  async withSandbox<T>(fn: (sb: SandboxHandle) => Promise<T>): Promise<T> {
    const infra = await this.infra();
    const info = await infra.sandbox_protocol.create(new SandboxConfig({ template: "base", timeout: 300 }), {});
    const sb = new SandboxHandle(this, infra, info);
    try {
      return await fn(sb);
    } finally {
      await infra.sandbox_protocol.kill(info.sandbox_id).catch(() => undefined);
    }
  }
}

export class SandboxHandle {
  readonly id: string;
  readonly url: string;
  readonly token: EnvdTokenManager;

  constructor(
    readonly h: ContractHarness,
    readonly infra: ProviderInfra,
    readonly info: SandboxInfo,
  ) {
    this.id = info.sandbox_id;
    this.url = info.envd_url ?? "";
    this.token = new EnvdTokenManager(info.envd_access_token, info.sandbox_id);
  }

  private proc(): NonNullable<ProviderInfra["process_protocol"]> {
    if (!this.infra.process_protocol) throw new ProviderFeatureNotSupportedError(this.h.providerId, "exec.run");
    return this.infra.process_protocol;
  }

  private fsys(): NonNullable<ProviderInfra["filesystem_protocol"]> {
    if (!this.infra.filesystem_protocol) throw new ProviderFeatureNotSupportedError(this.h.providerId, "files.rw");
    return this.infra.filesystem_protocol;
  }

  async stream(cmd: string, opts: { shell?: boolean; env?: Record<string, string>; timeout?: number } = {}): Promise<Chunks> {
    this.h.guard("exec.run");
    const [bin, args] = opts.shell === false ? [cmd, [] as string[]] : ["/bin/sh", ["-c", cmd]];
    const reader = await this.proc().start(this.url, this.token, { cmd: bin, args, env: opts.env ?? null, timeout: opts.timeout ?? 60 });
    const out: Chunks = { stdout: "", stderr: "", exit_code: null, chunks: [] };
    for await (const chunk of reader) {
      out.chunks.push(chunk);
      if (chunk.type === ProcessChunkType.STDOUT) out.stdout += chunk.data;
      else if (chunk.type === ProcessChunkType.STDERR) out.stderr += chunk.data;
      else if (chunk.type === ProcessChunkType.EXIT) out.exit_code = chunk.exit_code;
    }
    return out;
  }

  async listProcesses(): Promise<unknown[]> {
    this.h.guard("process.manage");
    return this.proc().listProcesses(this.url, this.token);
  }

  async write(path: string, content: string | Uint8Array): Promise<void> {
    this.h.guard("files.rw");
    await this.fsys().write(this.url, this.token, { path, content });
  }

  async readText(path: string): Promise<string> {
    this.h.guard("files.rw");
    return this.fsys().readText(this.url, this.token, { path });
  }

  async readBytes(path: string): Promise<Uint8Array> {
    this.h.guard("files.rw");
    return this.fsys().read(this.url, this.token, { path });
  }

  fs() {
    this.h.guard("files.rw");
    return this.fsys();
  }
}

export interface ContractCase {
  name: string;
  run: (h: ContractHarness) => Promise<void>;
}

function randomId(n = 6): string {
  return randomBytes(n).toString("hex").slice(0, n);
}

async function rejects(fn: () => Promise<unknown>, ...classes: Array<abstract new (...a: never[]) => unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (exc) {
    if (classes.length === 0 || classes.some((c) => exc instanceof c)) return exc;
    throw exc;
  }
  throw new assert.AssertionError({ message: `expected a ${classes.map((c) => c.name).join(" or ")} but nothing was thrown` });
}

/** The 18 contract cases; names match the Python `ProviderContractTests` methods. */
export function contractCases(): ContractCase[] {
  return [
    {
      name: "test_declared_features_are_known",
      async run(h) {
        const known = new Set<string>(FEATURES);
        const unknown = [...h.provider.features].filter((f) => !known.has(f));
        assert.deepEqual(unknown, []);
      },
    },
    {
      name: "test_describe_never_exposes_secret_defaults",
      async run(h) {
        for (const field of h.provider.describe().config_fields) {
          if (field.secret) assert.ok(field.default === null || field.default === "", `secret field ${field.key} has a default`);
        }
      },
    },
    {
      name: "test_lifecycle",
      async run(h) {
        h.need("sandbox.lifecycle");
        const infra = await h.infra();
        const sp = infra.sandbox_protocol;
        const info = await sp.create(new SandboxConfig({ template: "base", timeout: 300 }), {});
        try {
          const got = await sp.connect(info.sandbox_id);
          assert.equal(got.sandbox_id, info.sandbox_id);
          const listed = await sp.list({});
          assert.ok(listed.some((i) => i.sandbox_id === info.sandbox_id));
        } finally {
          await sp.kill(info.sandbox_id);
        }
        await sp.kill(info.sandbox_id);
        await rejects(() => sp.connect(UNKNOWN_ID), ProviderResourceNotFoundError, SandboxError);
      },
    },
    {
      name: "test_kill_is_idempotent",
      async run(h) {
        h.need("sandbox.lifecycle");
        const sp = (await h.infra()).sandbox_protocol;
        const info = await sp.create(new SandboxConfig({ template: "base", timeout: 300 }), {});
        await sp.kill(info.sandbox_id);
        await sp.kill(info.sandbox_id);
        await sp.kill(info.sandbox_id);
        await sp.kill(UNKNOWN_ID);
      },
    },
    {
      name: "test_set_timeout",
      async run(h) {
        h.need("sandbox.lifecycle", "sandbox.timeout");
        await h.withSandbox((sb) => sb.infra.sandbox_protocol.setTimeout(sb.id, 600));
      },
    },
    {
      name: "test_pause_resume",
      async run(h) {
        h.need("sandbox.lifecycle", "sandbox.pause");
        await h.withSandbox(async (sb) => {
          await sb.infra.sandbox_protocol.pause(sb.id);
          await sb.infra.sandbox_protocol.resume(sb.id);
          if (h.features.has("exec.run")) assert.match((await sb.stream("echo back")).stdout, /back/);
        });
      },
    },
    {
      name: "test_exec_run",
      async run(h) {
        h.need("exec.run");
        await h.withSandbox(async (sb) => {
          const res = await sb.stream("echo contract");
          assert.equal(res.exit_code, 0);
          assert.match(res.stdout, /contract/);
        });
      },
    },
    {
      name: "test_exec_exit_code_stderr_and_env",
      async run(h) {
        h.need("exec.run");
        await h.withSandbox(async (sb) => {
          const bad = await sb.stream("echo oops >&2; exit 3");
          assert.equal(bad.exit_code, 3);
          assert.match(bad.stderr, /oops/);
          const env = await sb.stream("echo $CONTRACT_VAR", { env: { CONTRACT_VAR: "v1" } });
          assert.equal(env.stdout.trim(), "v1");
        });
      },
    },
    {
      name: "test_exec_stream_order_and_single_exit",
      async run(h) {
        h.need("exec.run", "exec.stream");
        await h.withSandbox(async (sb) => {
          const res = await sb.stream("echo one; sleep 0.3; echo two; exit 4");
          const out = res.chunks.filter((c) => c.type === ProcessChunkType.STDOUT).map((c) => c.data).join("");
          assert.ok(out.indexOf("one") >= 0 && out.indexOf("one") < out.indexOf("two"));
          const exits = res.chunks.filter((c) => c.type === ProcessChunkType.EXIT);
          assert.equal(exits.length, 1);
          assert.equal(exits[0], res.chunks[res.chunks.length - 1]);
          assert.equal(exits[0]?.exit_code, 4);
        });
      },
    },
    {
      name: "test_exec_timeout_is_enforced",
      async run(h) {
        h.need("exec.run");
        await h.withSandbox(async (sb) => {
          const started = Date.now();
          try {
            const res = await sb.stream("sleep 60", { timeout: 2 });
            assert.notEqual(res.exit_code, 0);
          } catch (exc) {
            if (!(exc instanceof SandboxError)) throw exc;
          }
          assert.ok(Date.now() - started < 45_000, "timeout was not enforced");
        });
      },
    },
    {
      name: "test_process_list",
      async run(h) {
        h.need("exec.run", "process.manage");
        await h.withSandbox(async (sb) => assert.ok(Array.isArray(await sb.listProcesses())));
      },
    },
    {
      name: "test_files_roundtrip",
      async run(h) {
        h.need("files.rw");
        await h.withSandbox(async (sb) => {
          await sb.write("/contract.txt", "hello");
          assert.equal(await sb.readText("/contract.txt"), "hello");
        });
      },
    },
    {
      name: "test_files_binary_and_unicode",
      async run(h) {
        h.need("files.rw");
        const blob = Buffer.concat(Array.from({ length: 4 }, () => Buffer.from(Array.from({ length: 256 }, (_, i) => i))));
        await h.withSandbox(async (sb) => {
          await sb.write("/blob.bin", blob);
          assert.ok(Buffer.from(await sb.readBytes("/blob.bin")).equals(blob));
          await sb.write("/uni.txt", "héllo 世界");
          assert.equal(await sb.readText("/uni.txt"), "héllo 世界");
          await sb.write("/uni.txt", "short");
          assert.equal(await sb.readText("/uni.txt"), "short");
        });
      },
    },
    {
      name: "test_files_directory_operations",
      async run(h) {
        h.need("files.rw");
        const name = `contract-${randomId()}`;
        await h.withSandbox(async (sb) => {
          const fs = sb.fs();
          const ctx = [sb.url, sb.token] as const;
          await fs.makeDir(...ctx, { path: `/${name}` });
          await sb.write(`/${name}/a.txt`, "a");
          const names = new Set((await fs.listDir(...ctx, { path: `/${name}` })).map((e) => e.name));
          assert.ok(names.has("a.txt"));
          assert.ok(await fs.exists(...ctx, { path: `/${name}/a.txt` }));
          const entry = (await fs.listDir(...ctx, { path: `/${name}` })).find((e) => e.name === "a.txt");
          assert.notEqual(entry?.type, FileType.DIRECTORY);
          await fs.move(...ctx, { source: `/${name}/a.txt`, destination: `/${name}/b.txt` });
          assert.equal(await sb.readText(`/${name}/b.txt`), "a");
          assert.ok(!(await fs.exists(...ctx, { path: `/${name}/a.txt` })));
          await fs.remove(...ctx, { path: `/${name}/b.txt` });
          assert.ok(!(await fs.exists(...ctx, { path: `/${name}/b.txt` })));
        });
      },
    },
    {
      name: "test_missing_file_is_a_typed_not_found",
      async run(h) {
        h.need("files.rw");
        await h.withSandbox(async (sb) => {
          await rejects(() => sb.readText("/definitely/not/here.txt"), FileNotFoundError_, ProviderResourceNotFoundError);
        });
      },
    },
    {
      name: "test_ports_url",
      async run(h) {
        h.need("ports.url");
        await h.withSandbox(async (sb) => {
          const sp = sb.infra.sandbox_protocol as unknown as { portUrl?: (id: string, port: number) => Promise<[string, Record<string, string>]> };
          const url = sp.portUrl
            ? (await sp.portUrl(sb.id, 8080))[0]
            : `https://8080-${sb.id}.${sb.infra.config.sandbox_domain}`;
          assert.match(url, /^https?:\/\//);
        });
      },
    },
    {
      name: "test_undeclared_feature_fails_with_e8004",
      async run(h) {
        h.need("sandbox.lifecycle");
        const probes: Record<string, (sb: SandboxHandle) => Promise<unknown>> = {
          "sandbox.pause": (sb) => (h.guard("sandbox.pause"), sb.infra.sandbox_protocol.pause(sb.id)),
          "code.interpret": async (sb) => {
            h.guard("code.interpret");
            return (sb.infra.code_interpreter_protocol as unknown as { runCode: (...a: unknown[]) => Promise<unknown> }).runCode(
              sb.id,
              sb.url,
              sb.token,
              { code: "1 + 1" },
            );
          },
          "files.watch": async (sb) => {
            h.guard("files.watch");
            return (sb.fs() as unknown as { watchDir: (...a: unknown[]) => Promise<unknown> }).watchDir(sb.url, sb.token, { path: "/" });
          },
          "exec.run": (sb) => sb.stream("true"),
          "files.rw": (sb) => sb.readText("/x"),
          "process.manage": (sb) => sb.listProcesses(),
        };
        const undeclared = Object.entries(probes).filter(([f]) => !h.features.has(f));
        if (undeclared.length === 0) throw new SkipContractTest("provider declares every probed feature");
        await h.withSandbox(async (sb) => {
          for (const [feature, probe] of undeclared) {
            const err = (await rejects(() => probe(sb), ProviderFeatureNotSupportedError)) as ProviderFeatureNotSupportedError;
            assert.equal((err.constructor as { code?: string }).code ?? err.code, "E8004", feature);
            assert.ok(err instanceof CapabilityNotSupportedError, feature);
          }
        });
      },
    },
    {
      name: "test_secret_options_are_redacted_from_errors",
      async run(h) {
        const secretKeys = h.provider.configFields.filter((f) => f.secret).map((f) => f.key);
        if (secretKeys.length === 0) throw new SkipContractTest(`${h.providerId} declares no secret config fields`);
        const canary = `ebx-canary-${randomBytes(8).toString("hex")}`;
        const extra = Object.fromEntries(secretKeys.map((k) => [k, canary]));
        let raised: unknown = null;
        let infra: ProviderInfra | null = null;
        try {
          infra = await h.openInfra(extra);
          const info = await infra.sandbox_protocol.create(new SandboxConfig({ template: "base", timeout: 300 }), {});
          try {
            await infra.sandbox_protocol.connect(UNKNOWN_ID);
          } catch (exc) {
            raised = exc;
          } finally {
            await infra.sandbox_protocol.kill(info.sandbox_id).catch(() => undefined);
          }
        } catch (exc) {
          raised = exc;
        } finally {
          await infra?.close?.();
        }
        if (raised instanceof SandboxError) {
          const blob = [String(raised), raised.message, JSON.stringify(raised.toDict())].join(" ");
          assert.ok(!blob.includes(canary), "a secret option value leaked into an error");
        } else if (raised !== null) {
          throw raised;
        }
      },
    },
  ];
}

/** Run every applicable case; never throws for a failing case. */
export async function runContractSuite(providerId: string, opts: ContractOptions = {}): Promise<ContractResult[]> {
  const results: ContractResult[] = [];
  for (const c of contractCases()) {
    if (opts.filter && !c.name.includes(opts.filter)) continue;
    const started = Date.now();
    let h: ContractHarness | null = null;
    let outcome: ContractOutcome = "passed";
    let detail = "";
    try {
      h = new ContractHarness(providerId, opts.options ?? {});
      await c.run(h);
    } catch (exc) {
      if (exc instanceof SkipContractTest) {
        outcome = "skipped";
        detail = exc.message;
      } else {
        outcome = "failed";
        detail = exc instanceof Error ? exc.message : String(exc);
      }
    } finally {
      await h?.close().catch(() => undefined);
    }
    results.push({ name: c.name, outcome, detail, ms: Date.now() - started });
  }
  return results;
}

export interface TestRegistrar {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => Promise<void>, timeoutMs?: number) => void;
  /** Called to skip a case at run time (vitest: `ctx.skip`); defaults to passing silently. */
  onSkip?: (reason: string) => void;
}

/** Register the contract cases for `providerId` with a test framework. */
export function defineProviderContractTests(
  providerId: string,
  reg: TestRegistrar,
  opts: { options?: Record<string, unknown>; timeoutMs?: number } = {},
): void {
  reg.describe(`ProviderContractTests[${providerId}]`, () => {
    for (const c of contractCases()) {
      reg.it(
        c.name,
        async () => {
          const h = new ContractHarness(providerId, opts.options ?? {});
          try {
            await c.run(h);
          } catch (exc) {
            if (exc instanceof SkipContractTest) {
              reg.onSkip?.(exc.message);
              return;
            }
            throw exc;
          } finally {
            await h.close();
          }
        },
        opts.timeoutMs ?? 60_000,
      );
    }
  });
}

export function summarizeContract(results: readonly ContractResult[]): { passed: number; failed: number; skipped: number } {
  return {
    passed: results.filter((r) => r.outcome === "passed").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
  };
}

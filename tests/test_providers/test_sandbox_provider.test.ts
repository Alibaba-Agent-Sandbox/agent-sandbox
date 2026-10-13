/**
 * The installed reference plugin driven through the provider's protocol objects (the layer `api/sandbox.ts` uses;
 * port of `test_sandbox_provider.py`), plus the `Sandbox.connect('provider:id')` / built-in-default routing cases.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { activeProviderId } from "../../src/providers/active.js";
import { CapabilityNotSupportedError, InvalidCredentialsError } from "../../src/models/errors.js";
import { ProcessChunkType } from "../../src/models/process.js";
import { SandboxConfig } from "../../src/models/sandbox.js";
import { Provider, type ProviderInfra } from "../../src/providers/base.js";
import * as E from "../../src/providers/errors.js";
import * as installer from "../../src/providers/installer.js";
import { getProvider, registerProvider, resolveProviderId } from "../../src/providers/registry.js";
import * as settings from "../../src/providers/settings.js";
import * as store from "../../src/providers/store.js";
import { EnvdTokenManager } from "../../src/transport/auth.js";
import { loadLayeredConfig, type LayeredConfig } from "../../src/transport/config_layers.js";
import { useIso } from "../_support/iso.js";
import { LOCAL_PROCESS, TEST_HOST_VERSION, pythonAvailable, writePlugin } from "../_support/plugins.js";

const iso = useIso();
let tmp = "";
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ebx-sbp-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const installLocal = (): Promise<unknown> => installer.install(LOCAL_PROCESS, { yes: true, hostVersion: TEST_HOST_VERSION });

async function open(options: Record<string, unknown> = {}, provider = "local-process"): Promise<ProviderInfra> {
  return getProvider(provider).buildInfra(loadLayeredConfig({ provider, provider_options: options }));
}

async function withSandbox<T>(fn: (infra: ProviderInfra, id: string, url: string, token: EnvdTokenManager) => Promise<T>): Promise<T> {
  const infra = await open();
  try {
    const info = await infra.sandbox_protocol.create(new SandboxConfig({ template: "base", metadata: { k: "v" }, env_vars: { A: "1" } }), {});
    const token = new EnvdTokenManager(info.envd_access_token, info.sandbox_id);
    try {
      return await fn(infra, info.sandbox_id, info.envd_url as string, token);
    } finally {
      await infra.sandbox_protocol.kill(info.sandbox_id);
    }
  } finally {
    await infra.close?.();
  }
}

async function run(infra: ProviderInfra, url: string, token: EnvdTokenManager, cmd: string, args: string[]): Promise<{ stdout: string; exit: number | null }> {
  const reader = await (infra.process_protocol as NonNullable<ProviderInfra["process_protocol"]>).start(url, token, { cmd, args, timeout: 30 });
  let stdout = "";
  let exit: number | null = null;
  for await (const c of reader) {
    if (c.type === ProcessChunkType.STDOUT) stdout += c.data;
    if (c.type === ProcessChunkType.EXIT) exit = c.exit_code;
  }
  return { stdout, exit };
}

describe.skipIf(!pythonAvailable())("reference plugin", () => {
  beforeEach(async () => {
    await installLocal();
  });

  it("test_create_run_files_kill", async () => {
    await withSandbox(async (infra, id, url, token) => {
      expect(id.startsWith("lp-")).toBe(true);
      const res = await run(infra, url, token, "echo", ["hello"]);
      expect(res.exit).toBe(0);
      expect(res.stdout.trim()).toBe("hello");
      expect((await run(infra, url, token, "sh", ["-c", "exit 3"])).exit).toBe(3);
      const fsp = infra.filesystem_protocol as NonNullable<ProviderInfra["filesystem_protocol"]>;
      await fsp.write(url, token, { path: "/dir/a.txt", content: "payload" });
      expect(await fsp.readText(url, token, { path: "/dir/a.txt" })).toBe("payload");
      expect((await fsp.listDir(url, token, { path: "/dir" })).map((f) => f.name)).toEqual(["a.txt"]);
      expect(await fsp.exists(url, token, { path: "/dir/a.txt" })).toBe(true);
      await fsp.remove(url, token, { path: "/dir/a.txt" });
      expect(await fsp.exists(url, token, { path: "/dir/a.txt" })).toBe(false);
    });
  });

  it("test_streaming_commands", async () => {
    await withSandbox(async (infra, _id, url, token) => {
      const res = await run(infra, url, token, "sh", ["-c", "echo one; echo two"]);
      expect(res.stdout).toContain("one");
      expect(res.stdout).toContain("two");
    });
  });

  it("test_connect_list_and_kill_by_id", async () => {
    const infra = await open();
    try {
      const sp = infra.sandbox_protocol;
      const info = await sp.create(new SandboxConfig({ template: "base" }), {});
      expect((await sp.connect(info.sandbox_id)).sandbox_id).toBe(info.sandbox_id);
      expect((await sp.list({})).map((i) => i.sandbox_id)).toContain(info.sandbox_id);
      await sp.kill(info.sandbox_id);
      try {
        await sp.connect(info.sandbox_id);
        expect.unreachable();
      } catch (exc) {
        expect(exc).toBeInstanceOf(E.ProviderResourceNotFoundError);
        expect((exc as E.ProviderError).code).toBe("E8005");
      }
    } finally {
      await infra.close?.();
    }
  });

  it("test_unsupported_features_raise_e8004", async () => {
    await withSandbox(async (infra, id, url, token) => {
      const calls: Array<() => Promise<unknown>> = [
        () => infra.sandbox_protocol.pause(id),
        () => (infra.code_interpreter_protocol as unknown as { runCode: (...a: unknown[]) => Promise<unknown> }).runCode(id, url, token, { code: "1 + 1" }),
        () => (infra.filesystem_protocol as unknown as { watchDir: (...a: unknown[]) => Promise<unknown> }).watchDir(url, token, { path: "/" }),
      ];
      for (const call of calls) {
        try {
          await call();
          expect.unreachable();
        } catch (exc) {
          expect(exc).toBeInstanceOf(E.ProviderFeatureNotSupportedError);
          expect((exc as E.ProviderError).code).toBe("E8004");
          expect(exc).toBeInstanceOf(CapabilityNotSupportedError);
          expect((exc as E.ProviderFeatureNotSupportedError).provider).toBe("local-process");
        }
      }
    });
  });

  it("test_set_timeout_supported", async () => {
    await withSandbox((infra, id) => infra.sandbox_protocol.setTimeout(id, 120));
  });

  it("test_unknown_option_is_typed", async () => {
    await expect(open({ nope: 1 })).rejects.toBeInstanceOf(E.ProviderConfigError);
  });

  it("test_default_provider_from_config_and_env", () => {
    settings.setDefaultProvider("local-process");
    iso.writeToml(fs.readFileSync(iso.toml, "utf-8"));
    expect(resolveProviderId()).toBe("local-process");
    settings.setDefaultProvider(null);
    expect(resolveProviderId()).toBe("alicloud-express");
    iso.setenv("EBX_PROVIDER", "local-process");
    expect(resolveProviderId()).toBe("local-process");
  });

  it("test_explicit_provider_beats_ambient_default", () => {
    iso.setenv("EBX_PROVIDER", "local-process");
    expect(resolveProviderId("alicloud-express")).toBe("alicloud-express");
  });

  it("test_tampered_plugin_refuses_to_start", async () => {
    fs.writeFileSync(path.join(store.providerDir("local-process"), "provider.py"), "print('evil')\n");
    await expect(open()).rejects.toBeInstanceOf(E.ProviderIntegrityError);
  });
});

describe("provider-level behaviour that needs no plugin runtime", () => {
  it("test_unknown_provider_is_typed", () => {
    try {
      getProvider("nothing-here");
      expect.unreachable();
    } catch (exc) {
      expect(exc).toBeInstanceOf(E.ProviderNotFoundError);
      expect((exc as E.ProviderError).code).toBe("E8001");
    }
  });

  it("test_missing_required_config_is_a_config_error", async () => {
    const src = writePlugin(path.join(tmp, "src"), {
      extra: '[config.fields.api_token]\ntype = "string"\nsecret = true\ncredential = true\nrequired = true\n',
    });
    await installer.install(src, { yes: true, hostVersion: TEST_HOST_VERSION });
    try {
      await open({}, "demo-prov");
      expect.unreachable();
    } catch (exc) {
      expect(exc).toBeInstanceOf(InvalidCredentialsError);
      expect(String(exc)).toContain("EBX_DEMO_PROV_API_TOKEN");
    }
  });

  it("test_python_provider_object", async () => {
    let killed = "";
    class Fake extends Provider {
      readonly id = "fake-py";
      constructor() {
        super();
        this.features = new Set(["sandbox.lifecycle"]);
      }
      async buildInfra(config: LayeredConfig): Promise<ProviderInfra> {
        const proto = {
          create: async (cfg: SandboxConfig) => ({ sandbox_id: "fake-1", template: cfg.template }),
          kill: async (id: string) => void (killed = id),
        };
        return { config, auth: null, http_client: null, sandbox_protocol: proto as never, process_protocol: null, filesystem_protocol: null, code_interpreter_protocol: null };
      }
    }
    const fake = new Fake();
    registerProvider(fake);
    expect(getProvider("fake-py")).toBe(fake);
    const infra = await fake.buildInfra(loadLayeredConfig({ provider: "fake-py" }));
    const info = await infra.sandbox_protocol.create(new SandboxConfig({ template: "base" }), {});
    expect(info.sandbox_id).toBe("fake-1");
    await infra.sandbox_protocol.kill("fake-1");
    expect(killed).toBe("fake-1");
  });

  it("test_builtin_provider_builds_the_existing_transport_objects", async () => {
    const provider = getProvider();
    const infra = await provider.buildInfra(loadLayeredConfig({ sandbox_api_key: "k", sandbox_base_url: "https://api.example" }));
    try {
      expect(infra.http_client).not.toBeNull();
      expect(infra.sandbox_protocol.constructor.name).toBe("SandboxProtocol");
      expect(infra.config.sandbox_base_url).toBe("https://api.example");
      expect(await infra.auth?.getHeaders()).toEqual({ Authorization: "Bearer k" });
    } finally {
      await infra.close?.();
    }
  });

  it("test_qualified_sandbox_reference", async () => {
    const connected: string[] = [];
    class Fake extends Provider {
      readonly id = "fake-ref";
      constructor() {
        super();
        this.features = new Set(["sandbox.lifecycle"]);
      }
      async buildInfra(config: LayeredConfig): Promise<ProviderInfra> {
        const proto = {
          connect: async (id: string) => {
            connected.push(id);
            return { sandbox_id: id, template: "base", status: "running", envd_access_token: null, envd_url: null };
          },
          kill: async () => undefined,
        };
        return { config, auth: null, http_client: null, sandbox_protocol: proto as never, process_protocol: null, filesystem_protocol: null, code_interpreter_protocol: null };
      }
    }
    registerProvider(new Fake());

    const sbx = await Sandbox.connect("fake-ref:sbx-9");
    expect(connected).toEqual(["sbx-9"]);
    expect(sbx.provider).toBe("fake-ref");
    expect(sbx.id).toBe("sbx-9");

    await expect(Sandbox.connect("fake-ref:sbx-9", { provider: "alicloud-express" })).rejects.toBeInstanceOf(E.ProviderMismatchError);
    try {
      await Sandbox.connect("fake-ref:sbx-9", { provider: "alicloud-express" });
      expect.unreachable();
    } catch (exc) {
      expect((exc as E.ProviderError).code).toBe("E8030");
      expect(E.exitCodeFor(exc as Error)).toBe(2);
    }
    await expect(Sandbox.connect("other:sbx-9", { provider: "fake-ref" })).resolves.toBeInstanceOf(Sandbox);
    expect(connected.at(-1)).toBe("other:sbx-9");
  });

  it("test_builtin_default_path_is_untouched", async () => {
    const { SandboxProtocol } = await import("../../src/protocol/sandbox.js");
    const create = vi.spyOn(SandboxProtocol.prototype, "create").mockResolvedValue({
      sandbox_id: "sbx-legacy",
      template: "base",
      status: "running",
      envd_access_token: null,
      envd_url: "https://49983-sbx-legacy.example",
    } as never);
    try {
      const sbx = await Sandbox.create({ template: "base", api_key: "k" });
      expect(create).toHaveBeenCalledOnce();
      expect(sbx.provider).toBe("alicloud-express");
      expect(sbx.id).toBe("sbx-legacy");
      expect(activeProviderId()).toBe("alicloud-express");
    } finally {
      create.mockRestore();
    }
  });
});

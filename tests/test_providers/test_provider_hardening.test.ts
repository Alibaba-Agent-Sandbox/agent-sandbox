/** Provider hardening: missing-manifest hint, unpinned installs, record mapping, feature gate on `rest`, `features` listing. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compactFeatures, orderedFeatures } from "../../src/providers/base.js";
import { recordToInfo } from "../../src/providers/exec_provider.js";
import { ProviderFeatureNotSupportedError, ProviderManifestError, ProviderTrustError } from "../../src/providers/errors.js";
import { gateProtocol, SANDBOX_RULES } from "../../src/providers/feature_gate.js";
import * as installer from "../../src/providers/installer.js";
import { loadManifest } from "../../src/providers/manifest.js";
import * as registry from "../../src/providers/registry.js";
import { loadLayeredConfig } from "../../src/transport/config_layers.js";
import { TEST_HOST_VERSION, git, gitCommitAll, initRepo, writePlugin } from "../_support/plugins.js";
import { useIso } from "../_support/iso.js";

const iso = useIso();
let tmp = "";
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-hard-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const HV = { hostVersion: TEST_HOST_VERSION };

describe("missing manifest", () => {
  it("test_plain_missing_manifest_points_at_the_subdir_option", () => {
    try {
      loadManifest(tmp);
      throw new Error("expected throw");
    } catch (exc) {
      expect(exc).toBeInstanceOf(ProviderManifestError);
      expect(String((exc as ProviderManifestError).suggestion)).toContain("--subdir");
    }
  });
});

describe("unpinned git installs", () => {
  let repo = "";
  const url = (): string => `file://${repo}`;
  beforeEach(() => {
    repo = initRepo(path.join(tmp, "remote"));
    writePlugin(repo, { version: "1.0.0" });
    gitCommitAll(repo, "v1");
  });

  it("test_yes_alone_never_accepts_a_moving_ref", async () => {
    await expect(installer.install(url(), { ...HV, yes: true, allowInsecureTransport: true })).rejects.toBeInstanceOf(ProviderTrustError);
    const commit = git(repo, "rev-parse", "HEAD");
    await expect(installer.install(url(), { ...HV, yes: true, allowInsecureTransport: true })).rejects.toMatchObject({
      suggestion: expect.stringContaining(`--ref ${commit}`),
    });
  });

  it("test_interactive_review_may_accept_an_unpinned_ref", async () => {
    let shown = "";
    const receipt = await installer.install(url(), {
      ...HV,
      allowInsecureTransport: true,
      confirm: async (plan) => {
        shown = plan.manifest.sha256;
        return true;
      },
    });
    expect(receipt["trust"]).toBe("unpinned");
    expect(shown).toMatch(/^[0-9a-f]{64}$/);
  });

  it("test_commit_pin_with_yes_is_accepted", async () => {
    const commit = git(repo, "rev-parse", "HEAD");
    const receipt = await installer.install(url(), { ...HV, ref: commit, yes: true, allowInsecureTransport: true });
    expect(receipt["trust"]).toBe("pinned");
  });
});

describe("install confirmation hint", () => {
  it("test_the_rerun_hint_keeps_the_subdir_and_the_commit", async () => {
    const repo = initRepo(path.join(tmp, "mono"));
    writePlugin(path.join(repo, "plugins", "demo"), { version: "1.0.0" });
    gitCommitAll(repo, "v1");
    const commit = git(repo, "rev-parse", "HEAD");
    await expect(installer.install(`file://${repo}`, { ...HV, subdir: "plugins/demo", ref: commit, allowInsecureTransport: true })).rejects.toMatchObject({
      suggestion: expect.stringContaining(`--subdir plugins/demo --ref ${commit}`),
    });
  });
});

describe("recordToInfo", () => {
  it("test_region_is_empty_unless_the_plugin_reports_one", () => {
    const info = recordToInfo({ sandbox_id: "s1", status: "running" }, "p");
    expect(info.region).toBe("");
    expect(info.envd_url).toBe("epp://p/s1");
    expect(recordToInfo({ sandbox_id: "s1", region: "eu-1" }, "p").region).toBe("eu-1");
  });

  it("test_timeout_is_the_reported_lifetime", () => {
    const info = recordToInfo({ sandbox_id: "s1", created_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-01T00:10:00Z" }, "p");
    expect(info.timeout).toBe(600);
  });
});

const REST_MANIFEST = `
manifest_version = 1
[provider]
id = "rest-lite"
version = "0.1.0"
[runtime]
kind = "rest"
[endpoint]
base_url = "http://127.0.0.1:9"
[features]
supported = ["sandbox.lifecycle"]
[core]
inherit = ["sandbox_api_key"]
`;

describe("rest provider feature gate", () => {
  it("test_undeclared_features_fail_with_e8004_before_any_request", async () => {
    const dir = path.join(tmp, "rest-lite");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "abx-provider.toml"), REST_MANIFEST);
    await installer.install(dir, { ...HV, yes: true });
    iso.setenv("E2B_API_KEY", "k");
    const infra = await registry.getProvider("rest-lite").buildInfra(loadLayeredConfig({ provider: "rest-lite", http2: false }));
    try {
      const process = infra.process_protocol as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      const files = infra.filesystem_protocol as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      const calls = [() => infra.sandbox_protocol.pause("s1"), () => process["listProcesses"]!("http://x", null), () => files["exists"]!("http://x", null, "/x")];
      for (const call of calls) {
        const exc = await call().catch((e: unknown) => e);
        expect(exc).toBeInstanceOf(ProviderFeatureNotSupportedError);
        expect((exc as ProviderFeatureNotSupportedError).code).toBe("E8004");
      }
    } finally {
      await infra.close?.();
    }
  });

  it("test_gate_only_blocks_methods_of_undeclared_features", async () => {
    const calls: string[] = [];
    const target = {
      create: async () => calls.push("create"),
      pause: async () => calls.push("pause"),
      setTimeout: async () => calls.push("setTimeout"),
    };
    const gated = gateProtocol(target, "rest-lite", SANDBOX_RULES, new Set(["sandbox.lifecycle"]));
    await gated.create();
    expect(calls).toEqual(["create"]);
    for (const method of ["pause", "setTimeout"] as const) {
      const exc = await gated[method]().catch((e: unknown) => e);
      expect(exc).toBeInstanceOf(ProviderFeatureNotSupportedError);
    }
    expect(calls).toEqual(["create"]);
  });

  it("test_declared_feature_passes_through_with_this_bound", async () => {
    class Impl {
      readonly tag = "ok";
      async pause(): Promise<string> {
        return this.tag;
      }
    }
    const gated = gateProtocol(new Impl(), "p", SANDBOX_RULES, new Set(["sandbox.pause"]));
    expect(await gated.pause()).toBe("ok");
  });
});

describe("feature listing", () => {
  it("test_ordered_and_compact_features", () => {
    const features = ["pty", "unknown.thing", "exec.stream", "sandbox.pause", "sandbox.lifecycle", "exec.run"];
    expect(orderedFeatures(features)).toEqual(["sandbox.lifecycle", "sandbox.pause", "exec.run", "exec.stream", "pty", "unknown.thing"]);
    expect(compactFeatures(features)).toBe("sandbox(lifecycle,pause) exec(run,stream) pty unknown(thing)");
    expect(compactFeatures([])).toBe("");
  });

  it("test_list_providers_reports_declared_features", () => {
    const rows = registry.listProviders();
    const builtin = rows.find((r) => r.id === "alicloud-express");
    expect(builtin?.features.length).toBeGreaterThan(10);
  });
});

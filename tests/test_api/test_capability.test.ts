/** Tests for capability model, gating, and resolver. */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ResolvedCapabilities, _seams as capability_seams, cacheDeployedTemplate, resolveCapabilities } from "../../src/api/capability.js";
import { getLogger } from "../../src/utils/logging.js";
import { CodeContextModule } from "../../src/api/code.js";
import { CommandsModule } from "../../src/api/commands.js";
import { FilesModule } from "../../src/api/files.js";
import { NetworkModule } from "../../src/api/network.js";
import { FrozenSet, Sandbox } from "../../src/api/sandbox.js";
import { ValidationError } from "../../src/models/base.js";
import { CapabilityNotSupportedError, TemplateParseError } from "../../src/models/errors.js";
import { ProcessChunk, ProcessChunkType, ProcessResult } from "../../src/models/process.js";
import {
  DEFAULT_CAPABILITIES,
  STANDARD_CAPABILITIES,
  SandboxTemplate,
} from "../../src/models/template.js";
import { EnvdTokenManager } from "../../src/transport/auth.js";
import { MockStreamReader as _MockStreamReader, TEST_ENVD_TOKEN, TEST_ENVD_URL, makeSandboxInfo as make_sandbox_info } from "./conftest.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const dedent = (s: string): string => {
  const lines = s.split("\n");
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return lines.map((l) => l.slice(indent)).join("\n");
};

const setEq = (a: Iterable<string>, b: Iterable<string>) => expect(new Set(a)).toEqual(new Set(b));

const ORIGINAL_CACHE_DIR = capability_seams.TEMPLATE_CACHE_DIR;
afterEach(() => {
  capability_seams.TEMPLATE_CACHE_DIR = ORIGINAL_CACHE_DIR;
});

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "abx-cap-"));
}

function mkSandbox(extra: Record<string, any> = {}): Sandbox {
  return new Sandbox({
    info: make_sandbox_info(),
    config: {} as any,
    http_client: {} as any,
    auth: {} as any,
    envd_token: new EnvdTokenManager(TEST_ENVD_TOKEN),
    ...extra,
  });
}

// =====================================================================
// 1. Template / Capability Model tests
// =====================================================================

describe("TestStandardCapabilities", () => {
  // Verify the vocabulary and default baseline constants.
  it("test_standard_vocab", () => {
    setEq(["shell", "files", "code", "terminal", "ports"], STANDARD_CAPABILITIES);
  });

  it("test_default_baseline", () => {
    setEq(["shell", "files", "code"], DEFAULT_CAPABILITIES);
    expect(DEFAULT_CAPABILITIES.has("terminal")).toBe(false);
    expect(DEFAULT_CAPABILITIES.has("ports")).toBe(false);
  });
});

describe("TestSandboxTemplateCapabilities", () => {
  // Test SandboxTemplate capability field validation.
  it("test_none_capabilities_is_valid", () => {
    const t = new SandboxTemplate({ name: "test" });
    expect(t.capabilities).toBeNull();
  });

  it("test_valid_capabilities", () => {
    const t = new SandboxTemplate({ name: "test", capabilities: ["shell", "files", "ports"] });
    expect(t.capabilities).toEqual(["shell", "files", "ports"]);
  });

  it("test_invalid_capability_raises", () => {
    let caught: any = null;
    try {
      new SandboxTemplate({ name: "test", capabilities: ["shell", "invalid_cap"] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught.message).toMatch(/Unknown capability/);
  });

  it("test_empty_capabilities_is_valid", () => {
    const t = new SandboxTemplate({ name: "test", capabilities: [] });
    expect(t.capabilities).toEqual([]);
  });
});

// =====================================================================
// 2. CapabilityNotSupportedError
// =====================================================================

describe("TestCapabilityNotSupportedError", () => {
  it("test_error_code_and_message", () => {
    const err = new CapabilityNotSupportedError("terminal");
    expect(err.code).toBe("E3004");
    expect(err.message).toContain("terminal");
    expect(err.suggestion).toContain("terminal");
    expect(err.capability).toBe("terminal");
  });

  it("test_custom_message", () => {
    const err = new CapabilityNotSupportedError("ports", { message: "Custom message", suggestion: "Custom suggestion" });
    expect(err.message).toBe("Custom message");
    expect(err.suggestion).toBe("Custom suggestion");
  });
});

// =====================================================================
// 3. Allowed-path smoke tests (gating removed; verify modules work)
// =====================================================================

describe("TestCommandsAllowedPath", () => {
  // Verify commands.run works (no gating).
  it("test_run_allowed_with_shell", async () => {
    const proto: any = {
      start: vi.fn(async () => new _MockStreamReader([new ProcessChunk({ type: ProcessChunkType.EXIT, exit_code: 0 })])),
    };
    const mod = new CommandsModule(TEST_ENVD_URL, new EnvdTokenManager(TEST_ENVD_TOKEN), proto, new Set(["shell"]));
    const result = await mod.run("echo ok");
    expect(result).toBeInstanceOf(ProcessResult);
  });
});

describe("TestNetworkAllowedPath", () => {
  // Verify network.get_host works (no gating).
  it("test_allowed_with_ports", () => {
    const mod = new NetworkModule({ sandbox_id: "sbx-1", domain: "example.com", capabilities: new Set(["ports"]) });
    const host = mod.getHost(8080);
    expect(host).toContain("8080");
  });
});

// =====================================================================
// 4. Sandbox.capabilities / list_commands / run
// =====================================================================

describe("TestSandboxCapabilitiesProperty", () => {
  // Test Sandbox.capabilities property.
  it("test_returns_effective_set", () => {
    const resolved = new ResolvedCapabilities({ capabilities: new Set(["shell", "files"]) });
    const sb = mkSandbox({ resolved_capabilities: resolved });
    setEq(sb.capabilities, ["shell", "files"]);
    // Contract: capabilities property returns a frozenset.
    expect(sb.capabilities).toBeInstanceOf(FrozenSet);
  });

  it("test_default_when_no_resolved", () => {
    const sb = mkSandbox();
    setEq(sb.capabilities, DEFAULT_CAPABILITIES);
  });
});

// =====================================================================
// 5. Resolver tests
// =====================================================================

describe("TestResolveCapabilities", () => {
  // Test resolve_capabilities from local YAML.
  it("test_resolve_from_local_yaml", async () => {
    const yaml_content = dedent(`\
      name: test-template
      capabilities:
        - shell
        - files
        - terminal
    `);
    const yaml_file = join(mkTmp(), "template.yaml");
    writeFileSync(yaml_file, yaml_content);

    const result = await resolveCapabilities("test-template", { local_yaml_path: yaml_file });
    setEq(result.capabilities, ["shell", "files", "terminal"]);
  });

  it("test_resolve_fallback_to_defaults", async () => {
    // When template is not found, use DEFAULT_CAPABILITIES.
    const warning = vi.spyOn(getLogger("api.capability"), "warning");
    const result = await resolveCapabilities("nonexistent-template-xyz");
    setEq(result.capabilities, DEFAULT_CAPABILITIES);
    expect(String(warning.mock.calls.at(-1)?.[0])).toContain("~/.abx/templates");
    expect(String(warning.mock.calls.at(-1)?.[0])).toContain("abx template deploy");
  });

  it("test_cache_deployed_template_matches_by_id", async () => {
    const root = mkTmp();
    const cache = join(root, "templates");
    capability_seams.TEMPLATE_CACHE_DIR = cache;
    const src = join(root, "template.yaml");
    writeFileSync(src, "name: friendly\ncapabilities:\n  - shell\n  - files\n  - code\n");
    cacheDeployedTemplate(src, "tpl-123");
    const result = await resolveCapabilities("tpl-123");
    setEq(result.capabilities, ["shell", "files", "code"]);
  });

  it("test_cache_deployed_template_matches_by_alias", async () => {
    const root = mkTmp();
    const cache = join(root, "templates");
    capability_seams.TEMPLATE_CACHE_DIR = cache;
    const src = join(root, "template.yaml");
    writeFileSync(src, "name: friendly\ncapabilities:\n  - shell\n  - terminal\n");
    const warning = vi.spyOn(getLogger("api.capability"), "warning");
    cacheDeployedTemplate(src, "tpl-123", ["unique-alias", "friendly"]);
    const byAlias = await resolveCapabilities("unique-alias");
    setEq(byAlias.capabilities, ["shell", "terminal"]);
    const byId = await resolveCapabilities("tpl-123");
    setEq(byId.capabilities, ["shell", "terminal"]);
    expect(warning).not.toHaveBeenCalled();
  });

  it("test_cache_deployed_template_ignores_path_like_alias", () => {
    const root = mkTmp();
    const cache = join(root, "templates");
    capability_seams.TEMPLATE_CACHE_DIR = cache;
    const src = join(root, "template.yaml");
    writeFileSync(src, "name: friendly\ncapabilities:\n  - shell\n");
    cacheDeployedTemplate(src, "tpl-123", ["../escape", "ok-alias"]);
    expect(existsSync(join(cache, "tpl-123", "template.yaml"))).toBe(true);
    expect(existsSync(join(cache, "ok-alias", "template.yaml"))).toBe(true);
    expect(existsSync(join(root, "escape", "template.yaml"))).toBe(false);
  });

  it("test_resolve_none_capabilities_uses_defaults", async () => {
    // A template with no capabilities field uses DEFAULT_CAPABILITIES.
    const yaml_file = join(mkTmp(), "template.yaml");
    writeFileSync(yaml_file, dedent(`\
      name: minimal
    `));

    const result = await resolveCapabilities("minimal", { local_yaml_path: yaml_file });
    setEq(result.capabilities, DEFAULT_CAPABILITIES);
  });

  it("test_malformed_local_yaml_fails_closed", async () => {
    // A matched template whose capabilities fail validation must NOT silently fall back to DEFAULT_CAPABILITIES
    // (permission widening).
    const yaml_file = join(mkTmp(), "template.yaml");
    writeFileSync(yaml_file, dedent(`\
      name: broken
      capabilities:
        - shell
        - not_a_real_capability
    `));

    await expect(resolveCapabilities("broken", { local_yaml_path: yaml_file })).rejects.toBeInstanceOf(TemplateParseError);
  });

  it("test_malformed_scanned_template_fails_closed", async () => {
    // Scanning ~/.abx/templates: a matched-but-malformed template raises instead of falling back to defaults.
    const cache = join(mkTmp(), "templates");
    mkdirSync(join(cache, "broken-tmpl"), { recursive: true });
    writeFileSync(
      join(cache, "broken-tmpl", "template.yaml"),
      dedent(`\
        name: broken-tmpl
        capabilities:
          - bogus_capability
      `),
    );
    capability_seams.TEMPLATE_CACHE_DIR = cache;

    await expect(resolveCapabilities("broken-tmpl")).rejects.toBeInstanceOf(TemplateParseError);
  });

  it("test_unreadable_scanned_template_skipped", async () => {
    // A non-dict / unreadable document cannot match, so it is skipped and resolution falls back to defaults (no
    // fail-closed).
    const cache = join(mkTmp(), "templates");
    mkdirSync(join(cache, "junk"), { recursive: true });
    writeFileSync(join(cache, "junk", "template.yaml"), "just a string\n");
    capability_seams.TEMPLATE_CACHE_DIR = cache;

    const result = await resolveCapabilities("anything");
    setEq(result.capabilities, DEFAULT_CAPABILITIES);
  });

  it("test_match_by_alias_field", async () => {
    // A template referenced by its ``alias`` field must be matched (previously only ``name`` was compared → wrongful
    // DEFAULT fallback).
    const cache = join(mkTmp(), "templates");
    mkdirSync(join(cache, "some-dir"), { recursive: true });
    writeFileSync(
      join(cache, "some-dir", "template.yaml"),
      dedent(`\
        name: real-name
        alias: my-alias
        capabilities:
          - shell
          - terminal
      `),
    );
    capability_seams.TEMPLATE_CACHE_DIR = cache;

    const result = await resolveCapabilities("my-alias");
    setEq(result.capabilities, ["shell", "terminal"]);
  });

  it("test_match_by_aliases_list", async () => {
    const cache = join(mkTmp(), "templates");
    mkdirSync(join(cache, "dir"), { recursive: true });
    writeFileSync(
      join(cache, "dir", "template.yaml"),
      dedent(`\
        name: real-name
        aliases:
          - first-alias
          - second-alias
        capabilities:
          - ports
      `),
    );
    capability_seams.TEMPLATE_CACHE_DIR = cache;

    const result = await resolveCapabilities("second-alias");
    setEq(result.capabilities, ["ports"]);
  });

  it("test_match_by_directory_name", async () => {
    // A template referenced by its containing directory name matches.
    const cache = join(mkTmp(), "templates");
    mkdirSync(join(cache, "dir-name-ref"), { recursive: true });
    writeFileSync(
      join(cache, "dir-name-ref", "template.yaml"),
      dedent(`\
        name: something-else
        capabilities:
          - shell
          - ports
      `),
    );
    capability_seams.TEMPLATE_CACHE_DIR = cache;

    const result = await resolveCapabilities("dir-name-ref");
    setEq(result.capabilities, ["shell", "ports"]);
  });
});

// =====================================================================
// 6. Default capabilities in default-constructed modules
// =====================================================================

describe("TestDefaultCapabilities", () => {
  // Modules get DEFAULT_CAPABILITIES when none are passed.
  it("test_commands_default", () => {
    const mod = new CommandsModule("http://x", new EnvdTokenManager("tok"), {} as any);
    setEq(mod._capabilities, DEFAULT_CAPABILITIES);
  });

  it("test_files_default", () => {
    const mod = new FilesModule("http://x", new EnvdTokenManager("tok"), {} as any);
    setEq(mod._capabilities, DEFAULT_CAPABILITIES);
  });

  it("test_code_default", () => {
    const mod = new CodeContextModule("sbx-1", "http://x", new EnvdTokenManager("tok"), {} as any);
    setEq(mod._capabilities, DEFAULT_CAPABILITIES);
  });

  it("test_network_default", () => {
    const mod = new NetworkModule({ sandbox_id: "sbx-1", domain: "example.com" });
    setEq(mod._capabilities, DEFAULT_CAPABILITIES);
  });
});

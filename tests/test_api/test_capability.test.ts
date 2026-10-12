/** Tests for capability model, gating, custom commands, and resolver. */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ResolvedCapabilities, _seams as capability_seams, resolveCapabilities } from "../../src/api/capability.js";
import { CodeContextModule } from "../../src/api/code.js";
import { CommandsModule } from "../../src/api/commands.js";
import { FilesModule } from "../../src/api/files.js";
import { NetworkModule } from "../../src/api/network.js";
import { FrozenSet, Sandbox } from "../../src/api/sandbox.js";
import { ValueError } from "../../src/api/_pyerrors.js";
import { ValidationError } from "../../src/models/_pydantic.js";
import { CapabilityNotSupportedError, CommandNotFoundError, TemplateParseError, TokenExpiredError } from "../../src/models/errors.js";
import { ProcessChunk, ProcessChunkType, ProcessResult } from "../../src/models/process.js";
import {
  CustomCommand,
  CustomCommandArg,
  DEFAULT_CAPABILITIES,
  STANDARD_CAPABILITIES,
  SandboxTemplate,
} from "../../src/models/template.js";
import { EnvdTokenManager } from "../../src/transport/auth.js";
import { ALL_CAPABILITIES, MockStreamReader as _MockStreamReader, TEST_ENVD_TOKEN, TEST_ENVD_URL, makeSandboxInfo as make_sandbox_info } from "./conftest.js";

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
  return mkdtempSync(join(tmpdir(), "ebx-cap-"));
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

  it("test_custom_commands_model", () => {
    const t = new SandboxTemplate({
      name: "test",
      custom_commands: {
        build: new CustomCommand({
          cmd: "npm run build",
          description: "Build project",
          args: [new CustomCommandArg({ name: "mode", default: "production" })],
        }),
      },
    });
    expect("build" in t.custom_commands!).toBe(true);
    expect(t.custom_commands!["build"].cmd).toBe("npm run build");
    expect(t.custom_commands!["build"].args[0].name).toBe("mode");
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

describe("TestSandboxListCommands", () => {
  // Test Sandbox.list_commands().
  it("test_returns_command_catalogue", async () => {
    const resolved = new ResolvedCapabilities({
      capabilities: ALL_CAPABILITIES,
      custom_commands: {
        build: new CustomCommand({
          cmd: "npm run build",
          description: "Build it",
          args: [new CustomCommandArg({ name: "mode", required: false, default: "production", description: "Build mode" })],
        }),
        test: new CustomCommand({ cmd: "npm test", description: "Test it" }),
      },
    });
    const sb = mkSandbox({ resolved_capabilities: resolved });
    // No SandboxServer reachable in this unit test — only template (A) commands should be returned.
    sb._fetchServerCommands = vi.fn(async () => []);
    const cmds = await sb.listCommands();
    expect(cmds.length).toBe(2);
    const by_name = Object.fromEntries(cmds.map((c: any) => [c["name"], c]));
    setEq(Object.keys(by_name), ["build", "test"]);

    // Contract: each entry carries name/description/args including type, plus the new source/shadowed keys.
    const build = by_name["build"];
    expect(build["description"]).toBe("Build it");
    expect(build["source"]).toBe("template");
    expect(build["shadowed"]).toBe(false);
    expect(Array.isArray(build["args"])).toBe(true);
    expect(build["args"].length).toBe(1);
    const arg = build["args"][0];
    expect(arg).toEqual({
      name: "mode",
      required: false,
      default: "production",
      description: "Build mode",
      type: "string",
    });

    // A command with no declared args yields an empty args list.
    expect(by_name["test"]["args"]).toEqual([]);
  });

  it("test_merges_server_commands_and_marks_shadowed", async () => {
    // Server (B) commands are merged in; a name that also exists as a template (A) command is flagged
    // ``shadowed=True`` rather than hidden.
    const resolved = new ResolvedCapabilities({
      capabilities: ALL_CAPABILITIES,
      custom_commands: { build: new CustomCommand({ cmd: "npm run build", description: "Build it" }) },
    });
    const sb = mkSandbox({ resolved_capabilities: resolved });
    sb._fetchServerCommands = vi.fn(async () => [
      { name: "deploy", description: "Deploy", args: [] },
      { name: "build", description: "server build", args: [] },
    ]);
    const cmds = await sb.listCommands();
    const by_source = new Map<string, any>(cmds.map((c: any) => [`${c["name"]}\u0000${c["source"]}`, c]));
    const get = (n: string, s: string) => by_source.get(`${n}\u0000${s}`);

    // Template build present and never shadowed.
    expect(get("build", "template")["shadowed"]).toBe(false);
    // Server deploy is unique → not shadowed.
    expect(get("deploy", "server")["shadowed"]).toBe(false);
    // Server build overlaps a template command → surfaced as shadowed.
    expect(get("build", "server")["shadowed"]).toBe(true);
  });

  it("test_requires_auth", async () => {
    // list_commands() raises when envd token is not set.
    const resolved = new ResolvedCapabilities({ capabilities: ALL_CAPABILITIES });
    const sb = mkSandbox({ envd_token: new EnvdTokenManager(null), resolved_capabilities: resolved });
    await expect(sb.listCommands()).rejects.toBeInstanceOf(TokenExpiredError);
  });
});

function sandboxWithProto(resolved: ResolvedCapabilities, mock_proto: any): Sandbox {
  return mkSandbox({ process_protocol: mock_proto, resolved_capabilities: resolved });
}

function exitReader(...chunks: ProcessChunk[]): _MockStreamReader {
  return new _MockStreamReader([...chunks, new ProcessChunk({ type: ProcessChunkType.EXIT, exit_code: 0 })]);
}

describe("TestSandboxRunCustomCommand", () => {
  // Test Sandbox.custom() named-command dispatch (template mechanism A).
  it("test_custom_unknown_command", async () => {
    const resolved = new ResolvedCapabilities({ capabilities: ALL_CAPABILITIES });
    const sb = sandboxWithProto(resolved, {});
    // Not a template command and the SandboxServer is unreachable (probe already marked failed) → CommandNotFoundError.
    sb._server_probe_failed = true;
    await expect(sb.custom("nonexistent")).rejects.toBeInstanceOf(CommandNotFoundError);
  });

  it("test_run_missing_required_arg", async () => {
    const resolved = new ResolvedCapabilities({
      capabilities: ALL_CAPABILITIES,
      custom_commands: {
        deploy: new CustomCommand({ cmd: "deploy {target}", args: [new CustomCommandArg({ name: "target", required: true })] }),
      },
    });
    const sb = sandboxWithProto(resolved, {});
    const p = sb.custom("deploy");
    await expect(p).rejects.toBeInstanceOf(ValueError);
    await expect(p).rejects.toThrow(/Required argument/);
  });

  it("test_run_fills_placeholders_with_shlex_quote", async () => {
    const mock_proto: any = { start: vi.fn(async () => exitReader(new ProcessChunk({ type: ProcessChunkType.STDOUT, data: "ok\n" }))) };
    const resolved = new ResolvedCapabilities({
      capabilities: ALL_CAPABILITIES,
      custom_commands: {
        greet: new CustomCommand({ cmd: "echo {msg}", args: [new CustomCommandArg({ name: "msg", required: true })] }),
      },
    });
    const sb = sandboxWithProto(resolved, mock_proto);
    await sb.custom("greet", { msg: "hello world; rm -rf /" });
    // The argument should be shlex-quoted in the cmd string to prevent injection. After _parse_cmd (shlex.split), the
    // dangerous payload is a single atomic arg, not a separate command.
    const call_args = mock_proto.start.mock.calls[0][2]["args"];
    // The arg list should contain exactly one element that is the whole payload (shlex.split re-joins the quoted string).
    expect(call_args.length).toBe(1);
    expect(call_args[0]).toBe("hello world; rm -rf /");
  });

  it("test_run_uses_default_arg", async () => {
    const mock_proto: any = { start: vi.fn(async () => exitReader()) };
    const resolved = new ResolvedCapabilities({
      capabilities: ALL_CAPABILITIES,
      custom_commands: {
        run: new CustomCommand({ cmd: "python3 {file}", args: [new CustomCommandArg({ name: "file", default: "main.py" })] }),
      },
    });
    const sb = sandboxWithProto(resolved, mock_proto);
    await sb.custom("run");
    // Should have used default "main.py" → shlex-quoted
    const call_kwargs = mock_proto.start.mock.calls[0][2];
    const reconstructed = `${call_kwargs["cmd"]} ${call_kwargs["args"].join(" ")}`;
    expect(reconstructed).toContain("main.py");
  });

  it("test_run_value_that_looks_like_placeholder_is_not_misjudged", async () => {
    // A legitimate value such as ``{id}`` must NOT be reported as an unfilled placeholder (single-pass substitution
    // over the original template only).
    const mock_proto: any = { start: vi.fn(async () => exitReader()) };
    const resolved = new ResolvedCapabilities({
      capabilities: ALL_CAPABILITIES,
      custom_commands: {
        render: new CustomCommand({ cmd: "render {tpl}", args: [new CustomCommandArg({ name: "tpl", required: true })] }),
      },
    });
    const sb = sandboxWithProto(resolved, mock_proto);
    // Should NOT raise ValueError about unfilled placeholders.
    await sb.custom("render", { tpl: "{id}" });
    const call_args = mock_proto.start.mock.calls[0][2]["args"];
    expect(call_args).toEqual(["{id}"]);
  });

  it("test_run_no_second_pass_expansion_injection", async () => {
    // Injection attempt: a value that itself references another placeholder must NOT be re-expanded into extra argv
    // tokens.
    const mock_proto: any = { start: vi.fn(async () => exitReader()) };
    const resolved = new ResolvedCapabilities({
      capabilities: ALL_CAPABILITIES,
      custom_commands: {
        x: new CustomCommand({
          cmd: "run {a} {b}",
          args: [new CustomCommandArg({ name: "a", required: true }), new CustomCommandArg({ name: "b", required: true })],
        }),
      },
    });
    const sb = sandboxWithProto(resolved, mock_proto);
    await sb.custom("x", { a: "{b}", b: "; rm -rf /" });
    // After shlex.split, a's value stays a SINGLE token "{b}" — it was not re-scanned/re-expanded into b's payload, and
    // b's payload stays one atomic token (no injected extra argv).
    const call_args = mock_proto.start.mock.calls[0][2]["args"];
    expect(call_args).toEqual(["{b}", "; rm -rf /"]);
  });

  it("test_run_rejects_undeclared_kwarg", async () => {
    // Passing an arg not declared in cmd_def.args raises ValueError instead of being silently dropped.
    const resolved = new ResolvedCapabilities({
      capabilities: ALL_CAPABILITIES,
      custom_commands: {
        greet: new CustomCommand({ cmd: "echo {msg}", args: [new CustomCommandArg({ name: "msg", required: true })] }),
      },
    });
    const sb = sandboxWithProto(resolved, {});
    const p = sb.custom("greet", { msg: "hi", bogus: "x" });
    await expect(p).rejects.toBeInstanceOf(ValueError);
    await expect(p).rejects.toThrow(/Unexpected argument/);
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
      custom_commands:
        build:
          cmd: "make build"
          description: "Build the project"
    `);
    const yaml_file = join(mkTmp(), "template.yaml");
    writeFileSync(yaml_file, yaml_content);

    const result = await resolveCapabilities("test-template", { local_yaml_path: yaml_file });
    setEq(result.capabilities, ["shell", "files", "terminal"]);
    expect("build" in result.custom_commands).toBe(true);
    expect(result.custom_commands["build"].cmd).toBe("make build");
  });

  it("test_resolve_fallback_to_defaults", async () => {
    // When template is not found, use DEFAULT_CAPABILITIES.
    const result = await resolveCapabilities("nonexistent-template-xyz");
    setEq(result.capabilities, DEFAULT_CAPABILITIES);
    expect(result.custom_commands).toEqual({});
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
    // Scanning ~/.ebx/templates: a matched-but-malformed template raises instead of falling back to defaults.
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

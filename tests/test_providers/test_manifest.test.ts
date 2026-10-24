/** Manifest parsing/validation rules. Port of `tests/test_providers/test_manifest.py`. */

import { expect, it } from "vitest";

import { ProviderManifestError, ProviderVersionError } from "../../src/models/provider_errors.js";
import { checkRequires, parseManifest, versionSatisfies } from "../../src/providers/manifest.js";

const BASE = `
manifest_version = 1
operation_contract_version = 1
[operations]
cli = []
python = []
[workflow]
inputs = ["managed"]
startups = ["none"]
[provider]
id = "demo-prov"
version = "1.2.3"
[runtime]
kind = "exec"
command = ["python3", "./p.py"]
[features]
supported = ["sandbox.lifecycle", "exec.run"]
`;

function mutate(old: string, replacement: string): string {
  if (!BASE.includes(old)) throw new Error(`${old} not in BASE`);
  return BASE.replace(old, replacement);
}

it("test_minimal_manifest_defaults", () => {
  const m = parseManifest(BASE);
  expect([m.id, m.version, m.kind, m.protocol]).toEqual(["demo-prov", "1.2.3", "exec", "epp/1"]);
  expect(m.command).toEqual(["python3", "./p.py"]);
  expect([m.startup_timeout_ms, m.call_timeout_ms]).toEqual([10_000, 60_000]);
  expect(m.inherit).toEqual([]);
  expect(m.fields).toEqual([]);
  expect(m.auth_any_of).toEqual([]);
  expect(m.sha256).toHaveLength(64);
});

it("test_bytes_and_str_inputs_agree", () => {
  expect(parseManifest(Buffer.from(BASE)).sha256).toBe(parseManifest(BASE).sha256);
});

it("accepts optional source recipe descriptions without granting provider operations", () => {
  const parsed = parseManifest(BASE.replace('startups = ["none"]', 'startups = ["none"]\nsource_placeholders = ["<region>", "<tag>"]'));
  expect(parsed.operations).toEqual({ cli: [], python: [] });
  expect(parsed.workflow_inputs).toEqual(["managed"]);
  expect(parsed.raw["workflow"]).toMatchObject({ source_placeholders: ["<region>", "<tag>"] });
});

it.each(['["<unknown>"]', '["<tag>", "<tag>"]', '["region"]', '"<tag>"', '[1]'])("rejects invalid source placeholder descriptions: %s", value => {
  expect(() => parseManifest(BASE.replace('startups = ["none"]', `startups = ["none"]\nsource_placeholders = ${value}`))).toThrow(ProviderManifestError);
});

const REJECTIONS: Array<[string, string]> = [
  [mutate('supported = ["sandbox.lifecycle", "exec.run"]', 'supported = ["templates.deploy"]'), "unknown feature"],
  ["not toml [", "Invalid abx-provider.toml"],
  [mutate("manifest_version = 1", "manifest_version = 2"), "manifest_version"],
  [mutate('id = "demo-prov"', 'id = "Demo"'), "provider id"],
  [mutate('id = "demo-prov"', 'id = "alicloud-express"'), "reserved"],
  [mutate('id = "demo-prov"', 'id = "abx-thing"'), "reserved"],
  [mutate('version = "1.2.3"', 'version = "banana"'), "version"],
  [mutate('kind = "exec"', 'kind = "docker"'), "runtime.kind"],
  [mutate('kind = "exec"', 'kind = "python"'), "not supported"],
  [mutate('command = ["python3", "./p.py"]', "command = []"), "runtime.command"],
  [mutate('command = ["python3", "./p.py"]', 'command = ["run.bat"]'), "launcher"],
  [mutate('command = ["python3", "./p.py"]', 'command = ["../evil"]'), "inside the plugin"],
  [mutate('command = ["python3", "./p.py"]', 'command = ["./../../evil"]'), "inside the plugin"],
  [mutate('supported = ["sandbox.lifecycle", "exec.run"]', 'supported = ["time.travel"]'), "unknown feature"],
  [`${BASE}\n[core]\ninherit = ["region"]\n`, "core.inherit"],
  [`${BASE}\n[runtime2]\n[security]\nenv_passthrough = ["ABX_TOKEN"]\n`, "env_passthrough"],
  [`${BASE}\n[security]\nfilesystem = ["everything"]\n`, "filesystem"],
  [`${BASE}\n[config.fields.provider]\ntype = "string"\n`, "collides"],
  [`${BASE}\n[config.fields.Bad-Key]\ntype = "string"\n`, "must match"],
  [`${BASE}\n[config.fields.tok]\ntype = "secret"\n`, "type"],
  [`${BASE}\n[config.fields.tok]\ntype = "string"\nsecret = true\ndefault = "x"\n`, "default"],
  [`${BASE}\n[config.fields.tok]\ntype = "enum"\n`, "choices"],
  [`${BASE}\n[config.fields.tok]\ntype = "string"\nenv = ["ABX_TOK"]\n`, "reserved"],
  [`${BASE}\n[auth]\nany_of = [["ghost"]]\n`, "undeclared"],
  [mutate('kind = "exec"', 'kind = "exec"\nstartup_timeout_ms = 5'), "startup_timeout_ms"],
  [`${BASE}\n[compat]\nprotocol = "epp/9"\n`, "protocol"],
  [`${BASE}\n[compat]\nrequires = { sdk = "~~1" }\n`, "compat.requires"],
];

it("test_python_kind_names_node_exec_and_rest", () => {
  let caught: unknown;
  try {
    parseManifest(mutate('kind = "exec"', 'kind = "python"'));
  } catch (e) {
    caught = e;
  }
  const message = String((caught as Error).message);
  expect(caught).toBeInstanceOf(ProviderManifestError);
  expect(message).toContain("not supported");
  expect(message).toContain("'node'");
  expect(message).toContain("'exec'");
  expect(message).toContain("'rest'");
  expect(message).not.toContain("Python SDK");
});

it.each(REJECTIONS)("test_rejections[%#]", (text, needle) => {
  let caught: unknown;
  try {
    parseManifest(text);
  } catch (e) {
    caught = e;
  }
  expect(caught instanceof ProviderManifestError || caught instanceof ProviderVersionError).toBe(true);
  expect(String((caught as Error).message).toLowerCase()).toContain(needle.toLowerCase());
});

it("test_oversized_manifest_rejected", () => {
  expect(() => parseManifest(`${BASE}#${"x".repeat(257 * 1024)}`)).toThrow(ProviderManifestError);
});

it("test_protocol_mismatch_is_version_error_code", () => {
  try {
    parseManifest(`${BASE}\n[compat]\nprotocol = "epp/9"\n`);
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ProviderVersionError);
    expect((e as ProviderVersionError).code).toBe("E8013");
  }
});

it("test_rest_manifest", () => {
  const text = `
manifest_version = 1
operation_contract_version = 1
[operations]
cli = []
python = []
[workflow]
inputs = ["managed"]
startups = ["none"]
[provider]
id = "rest-one"
version = "0.1"
[runtime]
kind = "rest"
[endpoint]
base_url = "https://api.example.com"
auth = { scheme = "header", header = "X-Key" }
derive = { sandbox_domain = "{region}.example.com" }
[features]
supported = ["sandbox.lifecycle"]
[core]
inherit = ["sandbox_api_key"]
[auth]
any_of = [["sandbox_api_key"]]
`;
  const m = parseManifest(text);
  expect([m.kind, m.protocol]).toEqual(["rest", "e2b-rest/1"]);
  expect(m.inherit).toEqual(["sandbox_api_key"]);
  expect(m.auth_any_of).toEqual([["sandbox_api_key"]]);
  expect(() => parseManifest(text.replace('auth = { scheme = "header", header = "X-Key" }', 'auth = { scheme = "digest" }'))).toThrow(ProviderManifestError);
  expect(() => parseManifest(text.replace("sandbox_domain =", "region ="))).toThrow(ProviderManifestError);
  expect(() => parseManifest(text.replace("https://api.example.com", "ftp://x"))).toThrow(ProviderManifestError);
});

it("test_field_details", () => {
  const m = parseManifest(`${BASE}
[config.fields.api_token]
type = "string"
secret = true
credential = true
required = true
env = ["DEMO_TOKEN"]
description = "tok"
description_zh = "令牌"
[config.fields.mode]
type = "enum"
choices = ["a", "b"]
default = "a"
`);
  const [tok, mode] = m.fields;
  expect([tok?.secret, tok?.credential, tok?.required, tok?.env]).toEqual([true, true, true, ["DEMO_TOKEN"]]);
  expect(tok?.type).toBe("str");
  expect([mode?.choices, mode?.default]).toEqual([["a", "b"], "a"]);
});

it.each([
  ["0.3.0", ">=0.3", true], ["0.3.0", ">=0.4", false], ["1.0", ">=1.0,<2", true], ["2.0", ">=1.0,<2", false],
  ["1.2.9", "~=1.2", true], ["1.3.0", "~=1.2", true], ["2.0.0", "~=1.2", false], ["1.2.9", "~=1.2.3", true],
  ["1.3.0", "~=1.2.3", false], ["1.0rc1", ">=1.0", false], ["1.0", ">1.0rc1", true], ["1.0.0", "==1.0", true],
  ["1.0", "!=1.0", false], ["5", "", true],
  ["0.3.1a2", ">=0.3.1a3", false], ["0.3.1a10", ">0.3.1a3", true],
  ["0.3.1b1", ">0.3.1a99", true], ["0.3.1rc1", ">0.3.1b99", true],
  ["0.3.1", ">0.3.1rc99", true], ["0.3.1-alpha.3", "==0.3.1a3", true],
  ["0.3.1.dev1", "<0.3.1a1", true], ["0.3.1-beta.2", "==0.3.1b2", true],
] as Array<[string, string, boolean]>)("test_version_satisfies[%s %s]", (ver, spec, ok) => {
  expect(versionSatisfies(ver, spec)).toBe(ok);
});

it.each(["~~1", ">=", "foo", ">=x", ">=1.0-unrecognized", ">=0.3.1a3extra"])("test_bad_specs_raise_value_error[%s]", (spec) => {
  expect(() => versionSatisfies("1.0", spec)).toThrow(Error);
});

it("test_check_requires_raises_e8013", () => {
  const m = parseManifest(`${BASE}\n[compat]\nrequires = { sdk = ">=9", cli = ">=0.1" }\n`);
  expect(() => checkRequires(m, { component: "sdk", host_version: "0.3.0" })).toThrow(ProviderVersionError);
  checkRequires(m, { component: "cli", host_version: "0.3.0" });
  checkRequires(m, { component: "other", host_version: "0.0.1" });
});

it("test_sha_is_stable_hex", () => {
  expect(parseManifest(BASE).sha256).toMatch(/^[0-9a-f]{64}$/);
});

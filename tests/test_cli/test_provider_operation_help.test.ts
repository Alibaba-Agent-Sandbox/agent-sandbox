/** Selected-provider operations use ordinary help without loading untrusted runtime code. */

import "./host-version-for-plugins.js";

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { main } from "../../src/cli/main.js";
import { useIso } from "../_support/iso.js";
import { useCapsys } from "./conftest.js";

const iso = useIso();
const cap = useCapsys();

async function abx(...args: string[]): Promise<{ exit_code: number; output: string; stdout: string }> {
  const exit_code = await main({ args });
  const { out, err } = cap.readouterr();
  return { exit_code, output: out + err, stdout: out };
}

interface Operation {
  id: string;
  effect?: "read" | "write" | "delete";
}

async function installFixture(id: string, operations: Operation[], options: { brokenEntry?: boolean; credential?: boolean } = {}): Promise<string> {
  const source = path.join(iso.root, `${id}-source`);
  const marker = path.join(iso.root, `${id}-executions.txt`);
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "abx-provider.toml"), `
manifest_version = 1
[provider]
id = "${id}"
name = "${id}"
version = "1.0.0"
[runtime]
kind = "node"
entry = "provider.mjs"
[features]
supported = []
${options.credential ? `
[config.fields.api_key]
type = "string"
required = true
secret = true
credential = true
` : ""}
[commands]
protocol = "provider-commands/1"
${operations.length === 0 ? "entries = []" : ""}
${operations.map(({ id: operation, effect = "read" }) => `
[[commands.entries]]
id = "${operation}"
description = "English description for ${operation}"
description_zh = "中文说明：${operation}"
effect = "${effect}"
idempotent = true
input_schema = { type = "object", properties = { name = { type = "string", description = "Resource name" } }, required = ["name"], additionalProperties = false }
output_schema = { type = "object", properties = { operation = { type = "string" }, input = { type = "object" } }, required = ["operation", "input"], additionalProperties = false }
`).join("\n")}`);
  fs.writeFileSync(path.join(source, "provider.mjs"), `
import { appendFileSync } from "node:fs";
const mark = phase => appendFileSync(${JSON.stringify(marker)}, phase + "\\n");
mark("import");
${options.brokenEntry ? 'throw new Error("The help path must not import this module");' : ""}
export default () => {
  mark("factory");
  return {
    async buildInfra() {
      mark("buildInfra");
      return {
        sandbox_protocol: {},
        provider_commands: {
          async run(operation, input) {
            mark("run:" + operation);
            return { operation, input };
          }
        },
        async close() { mark("close"); }
      };
    }
  };
};
`);
  const result = await abx("provider", "install", source, "--yes", "--no-verify");
  expect(result.exit_code, result.output).toBe(0);
  expect(fs.existsSync(marker)).toBe(false);
  return marker;
}

describe("selected Provider help and execution", () => {
  it("discovers an unconfigured Provider through ordinary help without importing its broken entry", async () => {
    const marker = await installFixture("help-only", [{ id: "volumes.read" }, { id: "volumes.create", effect: "write" }], { brokenEntry: true, credential: true });
    iso.writeToml('[core]\nprovider = "help-only"\n');
    for (const args of [["--help"], ["-h"], ["provider", "--help"], ["provider", "run", "--help"], ["provider", "run", "volumes.create", "--help"]]) {
      const result = await abx(...args);
      expect(result.exit_code, result.output).toBe(0);
      expect(result.output).toContain("help-only");
      expect(result.output).not.toContain("E1000");
      expect(result.output).not.toContain("must not import");
    }
    const root = await abx("--help");
    expect(root.output).toContain("abx provider run");
    expect(root.output).not.toContain("additionalProperties");
    const directory = await abx("provider", "--help");
    expect(directory.output).toContain("abx provider run volumes.read");
    expect(directory.output).toContain("abx provider run volumes.create");
    const runHelp = await abx("provider", "run", "--help");
    for (const id of ["volumes.read", "volumes.create"]) {
      expect(runHelp.output).toContain(id);
      expect(runHelp.output.split(`English description for ${id}`).length - 1).toBe(1);
    }
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("renders localized descriptions, required input and output schemas, effects and confirmation", async () => {
    const marker = await installFixture("localized-help", [{ id: "volumes.create", effect: "write" }]);
    iso.writeToml('[core]\nprovider = "localized-help"\n');
    iso.setenv("LANG", "zh_CN.UTF-8");
    iso.setenv("LC_ALL", "zh_CN.UTF-8");
    const result = await abx("provider", "run", "volumes.create", "--help");
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain("中文说明：volumes.create");
    for (const part of ["name", "string", "required", "operation", "input", "write", "--yes", "--input", "--input-file"]) {
      expect(result.output).toContain(part);
    }
    expect(result.output).not.toContain("--name");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("refreshes the operation tree on every invocation and honors explicit Provider selection", async () => {
    await installFixture("first-help", [{ id: "first.operation" }]);
    await installFixture("second-help", [{ id: "second.operation" }]);
    iso.writeToml('[core]\nprovider = "first-help"\n');
    const first = await abx("provider", "--help");
    expect(first.output).toContain("first.operation");
    expect(first.output).not.toContain("second.operation");
    const override = await abx("--provider", "second-help", "provider", "--help");
    expect(override.exit_code, override.output).toBe(0);
    expect(override.output).toContain("second.operation");
    expect(override.output).not.toContain("first.operation");
    const again = await abx("provider", "--help");
    expect(again.output).toContain("first.operation");
    expect(again.output).not.toContain("second.operation");
    iso.writeToml('[core]\nprovider = "second-help"\n');
    const changedDefault = await abx("provider", "--help");
    expect(changedDefault.output).toContain("second.operation");
    expect(changedDefault.output).not.toContain("first.operation");
  });

  it("uses environment and per-invocation selection consistently across help and execution", async () => {
    await installFixture("configured-help", [{ id: "configured.read" }]);
    await installFixture("environment-help", [{ id: "environment.read" }]);
    await installFixture("explicit-help", [{ id: "explicit.read" }]);
    iso.writeToml('[core]\nprovider = "configured-help"\n');
    iso.setenv("ABX_PROVIDER", "environment-help");
    const ambient = await abx("provider", "--help");
    expect(ambient.output).toContain("environment.read");
    expect(ambient.output).not.toContain("configured.read");
    const explicit = await abx("provider", "run", "explicit.read", "--provider", "explicit-help", "-h");
    expect(explicit.exit_code, explicit.output).toBe(0);
    expect(explicit.output).toContain("English description for explicit.read");
    const result = await abx("--json", "provider", "run", "explicit.read", "--provider", "explicit-help", "--input", '{"name":"example"}');
    expect(result.exit_code, result.output).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ operation: "explicit.read", input: { name: "example" } });
    const after = await abx("provider", "--help");
    expect(after.output).toContain("environment.read");
    expect(after.output).not.toContain("explicit.read");
  });

  it("refreshes installed declarations without a separate command registration step", async () => {
    const marker = await installFixture("updated-help", [{ id: "old.read" }]);
    iso.writeToml('[core]\nprovider = "updated-help"\n');
    expect((await abx("provider", "--help")).output).toContain("old.read");
    const source = path.join(iso.root, "updated-help-source");
    const manifest = path.join(source, "abx-provider.toml");
    fs.writeFileSync(manifest, fs.readFileSync(manifest, "utf8").replaceAll("old.read", "new.read"));
    const installed = await abx("provider", "install", source, "--force", "--yes", "--no-verify");
    expect(installed.exit_code, installed.output).toBe(0);
    const updated = await abx("provider", "--help");
    expect(updated.output).toContain("new.read");
    expect(updated.output).not.toContain("old.read");
    const removed = await abx("provider", "run", "old.read", "--help");
    expect(removed.exit_code, removed.output).toBe(2);
    expect(removed.output).toMatch(/abx provider run (?:--help|-h)/);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("keeps Provider management available when no custom operations are declared", async () => {
    await installFixture("empty-help", []);
    iso.writeToml('[core]\nprovider = "empty-help"\n');
    const root = await abx("--help");
    expect(root.exit_code, root.output).toBe(0);
    expect(root.output).toContain("empty-help");
    const directory = await abx("provider", "run", "--help");
    expect(directory.exit_code, directory.output).toBe(0);
    expect(directory.output).toContain("0 provider operations declared");
    expect((await abx("provider", "--help")).output).toContain("No custom management operations declared");
    const unknown = await abx("provider", "run", "not-declared");
    expect(unknown.exit_code, unknown.output).toBe(2);
    const hostList = await abx("--json", "provider", "list");
    expect(hostList.exit_code, hostList.output).toBe(0);
    expect(JSON.parse(hostList.stdout).some((row: { ID: string }) => row.ID === "empty-help")).toBe(true);
  });

  it("keeps host management commands separate from opaque operation ids that share their names", async () => {
    const operations = ["install", "list", "help", "run", "volumes.read"].map((id) => ({ id }));
    await installFixture("collision-help", operations);
    iso.writeToml('[core]\nprovider = "collision-help"\n');
    for (const { id } of operations) {
      const help = await abx("provider", "run", id, "--help");
      expect(help.exit_code, help.output).toBe(0);
      expect(help.output).toContain(`English description for ${id}`);
      const result = await abx("--json", "provider", "run", id, "--input", '{"name":"example"}');
      expect(result.exit_code, result.output).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ operation: id, input: { name: "example" } });
    }
    const hostList = await abx("--json", "provider", "list");
    expect(hostList.exit_code, hostList.output).toBe(0);
    expect(JSON.parse(hostList.stdout).some((row: { ID: string }) => row.ID === "collision-help")).toBe(true);
    const hostInstall = await abx("provider", "install", "--help");
    expect(hostInstall.exit_code).toBe(0);
    expect(hostInstall.output).not.toContain("English description for install");
  });

  it("preserves explicit-id JSON discovery and gives canonical and legacy execution identical results", async () => {
    await installFixture("compatible-help", [{ id: "volumes.read" }]);
    iso.writeToml('[core]\nprovider = "compatible-help"\n');
    const list = await abx("--json", "provider", "command", "list", "compatible-help");
    expect(list.exit_code, list.output).toBe(0);
    expect(JSON.parse(list.stdout)).toHaveLength(1);
    const info = await abx("--json", "provider", "command", "info", "compatible-help", "volumes.read");
    expect(info.exit_code, info.output).toBe(0);
    expect(JSON.parse(info.stdout)).toMatchObject({ id: "volumes.read", effect: "read" });
    const input = path.join(iso.root, "input.json");
    fs.writeFileSync(input, '{"name":"example"}');
    const canonical = await abx("--json", "provider", "run", "volumes.read", "--input-file", input);
    const legacy = await abx("--json", "provider", "command", "run", "compatible-help", "volumes.read", "--input", '{"name":"example"}');
    expect(canonical.exit_code, canonical.output).toBe(0);
    expect(legacy.exit_code, legacy.output).toBe(0);
    expect(JSON.parse(canonical.stdout)).toEqual(JSON.parse(legacy.stdout));
  });

  it("requires confirmation and valid JSON/schema before loading either execution path", async () => {
    const marker = await installFixture("gated-help", [{ id: "volumes.create", effect: "write" }, { id: "volumes.delete", effect: "delete" }]);
    iso.writeToml('[core]\nprovider = "gated-help"\n');
    for (const id of ["volumes.create", "volumes.delete"]) {
      for (const args of [["provider", "run", id], ["provider", "command", "run", "gated-help", id]]) {
        const refused = await abx(...args, "--input", '{"name":"example"}');
        expect(refused.exit_code, refused.output).toBe(2);
        expect(refused.output).toContain("E8012");
      }
      for (const value of ["{", "{}", '{"name":42}']) {
        const invalid = await abx("provider", "run", id, "--yes", "--input", value);
        expect(invalid.exit_code, invalid.output).toBe(2);
        expect(invalid.output).toContain("E8002");
      }
    }
    expect(fs.existsSync(marker)).toBe(false);
    const allowed = await abx("--json", "provider", "run", "volumes.create", "--yes", "--input", '{"name":"example"}');
    expect(allowed.exit_code, allowed.output).toBe(0);
    expect(fs.readFileSync(marker, "utf8")).toContain("run:volumes.create\n");
  });

  for (const damage of ["missing", "manifest", "digest"] as const) {
    it(`keeps repair help usable for a ${damage} Provider while refusing execution without fallback`, async () => {
      const id = "unavailable-help";
      let marker: string | undefined;
      if (damage !== "missing") {
        marker = await installFixture(id, [{ id: "volumes.read" }]);
        const installed = path.join(iso.home, "providers", id);
        if (damage === "manifest") fs.writeFileSync(path.join(installed, "abx-provider.toml"), "[provider\n");
        else fs.appendFileSync(path.join(installed, "provider.mjs"), "\n// Changed after installation\n");
      }
      iso.writeToml(`[core]\nprovider = "${id}"\n`);
      for (const args of [["--help"], ["provider", "--help"]]) {
        const result = await abx(...args);
        expect(result.exit_code, result.output).toBe(0);
        expect(result.output).toContain(id);
        expect(result.output).toMatch(/unavailable|cannot|failed|not installed|invalid|integrity/i);
        expect(result.output).toContain("provider");
      }
      const repair = await abx("provider", "install", "--help");
      expect(repair.exit_code, repair.output).toBe(0);
      const run = await abx("provider", "run", "volumes.read", "--input", '{"name":"example"}');
      expect(run.exit_code, run.output).not.toBe(0);
      expect(run.output).toMatch(/E80\d\d/);
      expect(run.output).not.toContain("access_key");
      if (marker) expect(fs.existsSync(marker)).toBe(false);
      const reset = await abx("provider", "default", "alicloud-express");
      expect(reset.exit_code, reset.output).toBe(0);
      expect((await abx("provider", "run", "--help")).output).toContain("Provider: alicloud-express");
    });
  }
});

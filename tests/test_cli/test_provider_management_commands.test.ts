/** CLI parsing and mutation gates for provider management commands. */

import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../../src/cli/main.js";
import { getProviderCommand, listProviderCommands, runProviderCommand } from "../../src/providers/commands.js";
import { ProviderFeatureNotSupportedError, ProviderTrustError } from "../../src/providers/errors.js";
import * as installer from "../../src/providers/installer.js";
import { sys } from "../../src/cli/io.js";
import * as prompts from "../../src/cli/prompts.js";
import { useIso } from "../_support/iso.js";
import { useCapsys } from "./conftest.js";

vi.mock("../../src/providers/commands.js", () => ({
  getProviderCommand: vi.fn(), listProviderCommands: vi.fn(), runProviderCommand: vi.fn(),
}));

const iso = useIso();
const cap = useCapsys();
const descriptor = {
  id: "volumes.list", description: "List volumes", description_zh: "列出存储卷",
  input_schema: { type: "object" }, output_schema: { type: "object" }, effect: "read" as const, idempotent: true,
};
async function abx(...args: string[]): Promise<{ exit_code: number; output: string; stdout: string }> {
  const exit_code = await main({ args });
  const { out, err } = cap.readouterr();
  return { exit_code, output: out + err, stdout: out };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listProviderCommands).mockReturnValue([descriptor]);
  vi.mocked(getProviderCommand).mockReturnValue(descriptor);
  vi.mocked(runProviderCommand).mockResolvedValue({ volumes: [] });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("provider management commands", () => {
  it("shows command ids and effects before installation consent", async () => {
    vi.spyOn(sys.stdin, "isatty").mockReturnValue(true);
    vi.spyOn(prompts, "confirm").mockResolvedValue(false);
    vi.spyOn(installer, "install").mockImplementation(async (_source, options) => {
      await options?.confirm?.({ summary: () => ({
        id: "example-provider", name: "Example", version: "1.0.0", source: { path: "example-provider" }, trust: "local",
        runtime: ["node", "provider.mjs"], features: [], fields: [], inherit: [], changes: [],
        security: { network: [], filesystem: [], spawns_processes: false },
        commands: [{ id: "volumes.list", effect: "read" }, { id: "volumes.delete", effect: "delete" }],
      }) } as unknown as installer.InstallPlan);
      throw new ProviderTrustError("Install cancelled.");
    });
    const result = await abx("provider", "install", "example-provider");
    expect(result.output).toContain("volumes.list (read), volumes.delete (delete)");
    expect(prompts.confirm).toHaveBeenCalledOnce();
    expect(runProviderCommand).not.toHaveBeenCalled();
  });

  it("discovers descriptors and schemas without executing a command", async () => {
    const list = await abx("--json", "provider", "command", "list", "alicloud-express");
    expect(list.exit_code, list.output).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([descriptor]);
    const info = await abx("--json", "provider", "command", "info", "alicloud-express", "volumes.list");
    expect(info.exit_code, info.output).toBe(0);
    expect(JSON.parse(info.stdout)).toEqual(descriptor);
    expect(runProviderCommand).not.toHaveBeenCalled();
  });

  it("prints command ids in quiet discovery", async () => {
    const result = await abx("--quiet", "provider", "command", "list", "alicloud-express");
    expect(result.exit_code, result.output).toBe(0);
    expect(result.stdout).toBe("volumes.list\n");
  });

  it("passes parsed input, provider options and region to the common API", async () => {
    const result = await abx("--json", "provider", "command", "run", "alicloud-express", "volumes.list", "--input", '{"limit":2}', "--opt", "endpoint=https://example.test", "--region", "cn-hangzhou");
    expect(result.exit_code, result.output).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ volumes: [] });
    expect(runProviderCommand).toHaveBeenCalledWith("alicloud-express", "volumes.list", { limit: 2 }, { provider_options: { endpoint: "https://example.test" }, region: "cn-hangzhou" });
  });

  it("requires --yes for both write and delete before any execution", async () => {
    for (const effect of ["write", "delete"] as const) {
      vi.mocked(getProviderCommand).mockReturnValue({ ...descriptor, effect });
      const refused = await abx("provider", "command", "run", "alicloud-express", "volumes.list");
      expect(refused.exit_code).toBe(2);
      expect(refused.output).toContain("E8012");
      expect(runProviderCommand).not.toHaveBeenCalled();
    }
    const allowed = await abx("provider", "command", "run", "alicloud-express", "volumes.list", "--yes");
    expect(allowed.exit_code, allowed.output).toBe(0);
    expect(runProviderCommand).toHaveBeenCalledOnce();
  });

  it("reads sensitive JSON from a file without printing the input", async () => {
    const filename = path.join(iso.root, "input.json");
    fs.writeFileSync(filename, '{"certificate":"private-certificate-placeholder"}');
    const result = await abx("provider", "command", "run", "alicloud-express", "volumes.list", "--input-file", filename);
    expect(result.exit_code, result.output).toBe(0);
    expect(runProviderCommand).toHaveBeenCalledWith("alicloud-express", "volumes.list", { certificate: "private-certificate-placeholder" }, { provider_options: {} });
    expect(result.output).not.toContain("private-certificate-placeholder");
  });

  it("rejects malformed JSON, missing files and conflicting input sources without exposing input", async () => {
    for (const args of [["--input", '{"private-certificate-placeholder":'], ["--input-file", path.join(iso.root, "missing.json")], ["--input", "{}", "--input-file", "input.json"]]) {
      const result = await abx("provider", "command", "run", "alicloud-express", "volumes.list", ...args);
      expect(result.exit_code, result.output).toBe(2);
      expect(result.output).toContain("E8002");
      expect(result.output).not.toContain("private-certificate-placeholder");
    }
    expect(runProviderCommand).not.toHaveBeenCalled();
  });

  it("rejects oversized files and inline UTF-8 input before JSON parsing or execution", async () => {
    const filename = path.join(iso.root, "oversized.json");
    fs.writeFileSync(filename, "");
    fs.truncateSync(filename, 1024 * 1024 + 1);
    const largeInline = '{"value":"' + "字".repeat(400_000) + '"}';
    expect(largeInline.length).toBeLessThan(1024 * 1024);
    for (const args of [["--input-file", filename], ["--input", largeInline]]) {
      const result = await abx("provider", "command", "run", "alicloud-express", "volumes.list", ...args);
      expect(result.exit_code, result.output).toBe(2);
      expect(result.output).toContain("E8002");
      expect(result.output).toContain("1 MiB");
    }
    expect(runProviderCommand).not.toHaveBeenCalled();
  });

  it("accepts the exact byte limit for both input sources and refuses directories", async () => {
    const input = "{}" + " ".repeat(1024 * 1024 - 2);
    const filename = path.join(iso.root, "maximum.json");
    fs.writeFileSync(filename, input);
    for (const args of [["--input", input], ["--input-file", filename]]) {
      const result = await abx("provider", "command", "run", "alicloud-express", "volumes.list", ...args);
      expect(result.exit_code, result.output).toBe(0);
    }
    expect(runProviderCommand).toHaveBeenCalledTimes(2);
    const directory = await abx("provider", "command", "run", "alicloud-express", "volumes.list", "--input-file", iso.root);
    expect(directory.exit_code, directory.output).toBe(2);
    expect(directory.output).toContain("regular file");
    expect(runProviderCommand).toHaveBeenCalledTimes(2);
  });

  it("rejects conflicting explicit provider selection and malformed options", async () => {
    const mismatch = await abx("--provider", "other", "provider", "command", "run", "alicloud-express", "volumes.list");
    expect(mismatch.exit_code).toBe(2);
    expect(mismatch.output).toContain("E8030");
    const invalid = await abx("provider", "command", "run", "alicloud-express", "volumes.list", "--opt", "invalid");
    expect(invalid.exit_code).toBe(2);
    expect(runProviderCommand).not.toHaveBeenCalled();
  });

  it("refuses secret provider options on argv without echoing the value", async () => {
    const result = await abx("provider", "command", "run", "alicloud-express", "volumes.list", "--opt", "access_key_secret=private-key-placeholder");
    expect(result.exit_code, result.output).toBe(2);
    expect(result.output).toContain("E8002");
    expect(result.output).not.toContain("private-key-placeholder");
    expect(runProviderCommand).not.toHaveBeenCalled();
  });

  it("preserves provider capability errors", async () => {
    vi.mocked(getProviderCommand).mockImplementation(() => { throw new ProviderFeatureNotSupportedError("alicloud-express", "commands"); });
    const result = await abx("provider", "command", "run", "alicloud-express", "volumes.list");
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("E8004");
    expect(runProviderCommand).not.toHaveBeenCalled();
  });
});

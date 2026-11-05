import "../_support/isolatedHome.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import * as providerCommands from "../../src/providers/commands.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useIso } from "../_support/iso.js";
import { useMockCloudConfiguration } from "../_support/mockCloudConfiguration.js";
import { resetCliSelection, setCliProvider } from "../../src/providers/selection.js";
import { readTrafficTokenFile, withTrafficTokenOutput } from "../../src/cli/traffic_token_file.js";

useIso();
useMockCloudConfiguration();
afterEach(() => { vi.restoreAllMocks(); resetCliSelection(); });
const abx = (args: string[]) => new CliRunner().invoke(cli, args);

describe("native Express runtime entry points", () => {
  it.each([["pause", "sandbox.pause"], ["resume", "sandbox.resume"], ["timeout", "sandbox.timeout"]])("runs qualified %s through the declared provider implementation", async (verb, command) => {
    const run = vi.spyOn(providerCommands, "runProviderCommand").mockResolvedValue({ sandbox_id: "source", updated: true });
    const connect = vi.spyOn(Sandbox, "connect");
    const result = await abx(["sandbox", verb, "alicloud-express:source", ...(verb === "timeout" ? ["600"] : [])]);
    expect(result.exit_code, result.output).toBe(0);
    expect(run).toHaveBeenCalledExactlyOnceWith("alicloud-express", command, { sandbox_id: "source", ...(verb === "timeout" ? { timeout: 600 } : {}) });
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects conflicting provider ownership before sending a command", async () => {
    const run = vi.spyOn(providerCommands, "runProviderCommand");
    setCliProvider("other-provider");
    const result = await abx(["sandbox", "resume", "alicloud-express:source"]);
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("E8030");
    expect(run).not.toHaveBeenCalled();
  });

  it("passes a native network input file to sandbox creation without printing rules", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abx-network-"));
    try {
      const file = path.join(dir, "network.json");
      const network = { allow_public_traffic: false, deny_out: ["0.0.0.0/0"], rules: { "api.example.test": [{ transform: { headers: { Authorization: "Bearer placeholder-secret" } } }] } };
      fs.writeFileSync(file, JSON.stringify(network));
      const create = vi.spyOn(Sandbox, "create").mockResolvedValue({ id: "source", provider: "alicloud-express", status: "running", url: "https://envd.example.test", info: { template: "base" } } as unknown as Sandbox);
      const result = await abx(["create", "base", "--network-file", file]);
      expect(result.exit_code, result.output).toBe(0);
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ network }));
      expect(result.output).not.toContain("placeholder-secret");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("exports a gateway token only to an explicitly requested exclusive 0600 file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abx-traffic-"));
    try {
      const file = path.join(dir, "traffic-token");
      const create = vi.spyOn(Sandbox, "create").mockResolvedValue({ id: "source", provider: "alicloud-express", status: "running", url: "https://envd.example.test", traffic_access_token: "placeholder-traffic-secret", info: { template: "base" } } as unknown as Sandbox);
      const result = await abx(["create", "base", "--traffic-token-output", file]);
      expect(result.exit_code, result.output).toBe(0);
      expect(fs.readFileSync(file, "utf8")).toBe("placeholder-traffic-secret\n");
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(result.output).not.toContain("placeholder-traffic-secret");
      create.mockClear();
      const existing = await abx(["create", "base", "--traffic-token-output", file]);
      expect(existing.exit_code).not.toBe(0);
      expect(create).not.toHaveBeenCalled();
      expect(fs.readFileSync(file, "utf8")).toBe("placeholder-traffic-secret\n");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("attaches application commands with an explicit private gateway file and no lifecycle mutation", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abx-traffic-"));
    try {
      const file = path.join(dir, "traffic-token");
      fs.writeFileSync(file, "placeholder-traffic-secret\n", { mode: 0o600 });
      const connect = vi.spyOn(Sandbox, "connect").mockResolvedValue({ runCommand: vi.fn().mockResolvedValue({ success: true, value: "ok" }) } as unknown as Sandbox);
      const result = await abx(["run", "source", "probe", "--traffic-token-file", file]);
      expect(result.exit_code, result.output).toBe(0);
      expect(connect).toHaveBeenCalledExactlyOnceWith("source", { traffic_access_token: "placeholder-traffic-secret" });
      expect(result.output).not.toContain("placeholder-traffic-secret");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("cleans up the newly created sandbox when explicitly requested token export cannot be fulfilled", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abx-traffic-"));
    try {
      const file = path.join(dir, "traffic-token");
      const kill = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(Sandbox, "create").mockResolvedValue({ id: "source", traffic_access_token: null, kill } as unknown as Sandbox);
      const result = await abx(["create", "base", "--traffic-token-output", file]);
      expect(result.exit_code).not.toBe(0);
      expect(kill).toHaveBeenCalledExactlyOnceWith();
      expect(fs.existsSync(file)).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("explicit gateway-token file boundary", () => {
  it("rejects symlink, shared and multi-line token inputs without exposing their contents", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abx-traffic-"));
    try {
      const target = path.join(dir, "target"), link = path.join(dir, "link");
      fs.writeFileSync(target, "placeholder-token", { mode: 0o600 });
      fs.symlinkSync(target, link);
      expect(() => readTrafficTokenFile(link)).toThrow("private regular file");
      if (process.platform !== "win32") {
        fs.chmodSync(target, 0o644);
        expect(() => readTrafficTokenFile(target)).toThrow("private regular file");
      }
      fs.chmodSync(target, 0o600);
      fs.writeFileSync(target, "placeholder-token\nsecond-token");
      expect(() => readTrafficTokenFile(target)).toThrow("private regular file");
      try { readTrafficTokenFile(target); } catch (error) { expect(String(error)).not.toContain("placeholder-token"); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("removes its unused empty output after failure and preserves a replacement path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abx-traffic-"));
    try {
      const file = path.join(dir, "traffic-token");
      await expect(withTrafficTokenOutput(file, async () => { throw new Error("action failed"); })).rejects.toThrow("action failed");
      expect(fs.existsSync(file)).toBe(false);
      await expect(withTrafficTokenOutput(file, async (save) => {
        fs.unlinkSync(file);
        fs.writeFileSync(file, "another owner's file");
        save("placeholder-token");
      })).rejects.toThrow("path changed");
      expect(fs.readFileSync(file, "utf8")).toBe("another owner's file");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

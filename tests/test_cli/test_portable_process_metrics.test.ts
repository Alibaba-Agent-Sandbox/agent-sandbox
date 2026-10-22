import { useMockCloudConfiguration } from "../_support/mockCloudConfiguration.js";
/** Execute the remote inspection scripts on a real minimal Python/Linux runtime. */
import "../_support/isolatedHome.js";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { ProcessResult } from "../../src/models/process.js";
import { CliRunner } from "../helpers/cliRunner.js";

afterEach(() => vi.restoreAllMocks());

function execute(command: string): ProcessResult {
  const result = spawnSync("sh", ["-c", command], { encoding: "utf8", timeout: 10_000 });
  if (result.error) throw result.error;
  return new ProcessResult({ stdout: result.stdout, stderr: result.stderr, exit_code: result.status ?? 1 });
}

it("inspects a live process when procps is unavailable", async () => {
  const run = vi.fn(async (command: string) => command.startsWith("ps ")
    ? new ProcessResult({ exit_code: 127, stderr: "ps: not found" }) : execute(command));
  vi.spyOn(Sandbox, "connect").mockResolvedValue({ commands: { run, list: vi.fn().mockResolvedValue([]) } } as unknown as Sandbox);
  const result = await new CliRunner().invoke(cli, ["--json", "sandbox", "process", "info", "owned", String(process.pid)]);
  expect(result.exit_code, result.output).toBe(0);
  const row = JSON.parse(result.stdout);
  expect(row.PID).toBe(String(process.pid));
  expect(Number(row.PPID)).toBeGreaterThanOrEqual(1);
  expect(row.Command).toBeTruthy();
  expect(run).toHaveBeenCalledTimes(2);
});

it("collects typed metrics through valid Python without uptime or procps", async () => {
  const run = vi.fn(async (command: string) => execute(command));
  vi.spyOn(Sandbox, "connect").mockResolvedValue({ commands: { run, list: vi.fn().mockResolvedValue([]) } } as unknown as Sandbox);
  const result = await new CliRunner().invoke(cli, ["--json", "sandbox", "system", "metrics", "owned"]);
  expect(result.exit_code, result.output).toBe(0);
  const row = JSON.parse(result.stdout);
  expect(typeof row.cpu_load_1m).toBe("number");
  expect(row.disk_total_gb).toBeGreaterThan(0);
  expect(row.disk_free_gb).toBeGreaterThanOrEqual(0);
  expect(run).toHaveBeenCalledTimes(1);
});

// Remote APIs in this file are mocked; provide configuration without bypassing preflight.
useMockCloudConfiguration();

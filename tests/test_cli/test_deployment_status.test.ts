/** A saved deployment is ownership history, not proof of current remote health. */
import { afterEach, expect, it, vi } from "vitest";
import { cli } from "../../src/cli/main.js";
import { readDeployment, saveDeployment, type Deployment } from "../../src/cli/deployment_store.js";
import { managementSeams } from "../../src/cli/commands/deployment_management.js";
import { AuthenticationError, SandboxNotFoundError, SandboxError } from "../../src/models/errors.js";
import { SandboxInfo } from "../../src/models/sandbox.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useIso } from "../_support/iso.js";

useIso();
afterEach(() => vi.restoreAllMocks());
function saved(overrides: Partial<Deployment> = {}) {
  saveDeployment({ version: 1, name: "demo", kind: "sandbox", provider: "alicloud-express", sandboxId: "sbx-owned", status: "ready", createdAt: "now", updatedAt: "now", ...overrides });
  return readDeployment("demo");
}
const run = () => new CliRunner().invoke(cli, ["--json", "status", "demo"], { env: { ABX_SANDBOX_API_KEY: "fixture-key" } });

it("reports typed NotFound as missing and preserves local ownership history", async () => {
  const before = saved({ providerOptions: { region: "cn-shanghai" }, connection: { api_url: "https://example.invalid" } });
  const query = vi.spyOn(managementSeams, "info").mockRejectedValue(new SandboxNotFoundError("gone"));
  const result = await run();
  expect(result.exit_code, result.output).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "missing", recorded_status: "ready", observation: "not_found", remote: null });
  expect(query).toHaveBeenCalledExactlyOnceWith("sbx-owned", { provider: "alicloud-express", provider_options: { region: "cn-shanghai" }, api_url: "https://example.invalid" });
  expect(readDeployment("demo")).toEqual(before);
});

it("uses observed state instead of recorded ready and never discloses transport tokens", async () => {
  saved();
  vi.spyOn(managementSeams, "info").mockResolvedValue(SandboxInfo.modelValidate({ sandboxID: "sbx-owned", templateID: "base", status: "paused", envdAccessToken: "private-token" }));
  const result = await run();
  expect(result.exit_code, result.output).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "paused", recorded_status: "ready", observation: "remote", remote: { status: "paused" } });
  expect(result.output).not.toContain("private-token");
});

it("does not label a present response with an unavailable status as missing", async () => {
  saved();
  vi.spyOn(managementSeams, "info").mockResolvedValue({ modelDump: () => ({ sandbox_id: "sbx-owned" }) } as unknown as SandboxInfo);
  const result = await run();
  expect(result.exit_code, result.output).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "unknown", observation: "remote", recorded_status: "ready" });
});

it.each([new AuthenticationError("forbidden"), new SandboxError("service unavailable", { code: "E5000" }), new Error("connection failed")])("does not treat a failed query as absence (%s)", async error => {
  const before = saved();
  vi.spyOn(managementSeams, "info").mockRejectedValue(error);
  const result = await run();
  expect(result.exit_code).not.toBe(0);
  expect(JSON.parse(result.stdout)).not.toHaveProperty("observation", "not_found");
  expect(result.output).not.toContain('"status": "missing"');
  expect(readDeployment("demo")).toEqual(before);
});

it("does not infer absence or query an unrelated name when no id was recorded", async () => {
  saved({ sandboxId: undefined, status: "preparing" });
  const query = vi.spyOn(managementSeams, "info");
  const result = await run();
  expect(result.exit_code, result.output).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "unknown", recorded_status: "preparing", observation: "not_requested" });
  expect(query).not.toHaveBeenCalled();
});

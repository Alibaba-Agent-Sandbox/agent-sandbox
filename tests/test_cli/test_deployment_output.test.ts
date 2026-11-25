/** Public lifecycle results expose resource identities, never internal recovery documents. */
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { cli } from "../../src/cli/main.js";
import { deploymentSummary } from "../../src/cli/commands/deploy.js";
import { saveDeployment, readDeployment, deploymentDirectory, type Deployment } from "../../src/cli/deployment_store.js";
import { publicSummary } from "../../src/application/service.js";
import type { ApplicationReceipt } from "../../src/application/types.js";
import { useIso } from "../_support/iso.js";
import { CliRunner } from "../helpers/cliRunner.js";

const iso = useIso();
afterEach(() => vi.restoreAllMocks());
const run = (args: string[]) => new CliRunner().invoke(cli, ["--json", ...args], { env: { ABX_SANDBOX_API_KEY: "fixture-key" } });
function saved(withToken = false): Deployment {
  return { version: 1, name: "demo", kind: "sandbox", provider: "alicloud-express", status: "requires_recovery", createdAt: "now", updatedAt: "now", launch: {
    template_reference: "template-real", journal_id: "internal-journal", plan_digest: "private-plan-digest", source_digest: "private-source-digest", credentials_file: "private-credentials-file",
    services: { api: { port: 9000, url: "https://example.invalid", ...(withToken ? { token: "private-token" } : {}) } },
  } };
}
function receipt(): ApplicationReceipt {
  return { schemaVersion: 2, kind: "ManagedApplicationReceipt", plan: { applicationId: "demo", revision: "revision-real" }, accountId: "fixture-account", phase: "internal-step", status: "ready", credentialsFile: "application-credentials.json", endpoint: "https://example.invalid", functions: [], retained: [], cleanup: [{ kind: "function", identity: "function-real", status: "uncertain" }],
    sandbox: { provider: "alicloud-express", reference: "template-real", journalId: "internal-journal", resources: [{ kind: "image", id: "registry.example/image:v1", state: "created", cleanup: "manual", intent_id: "internal-intent" }] },
  } as unknown as ApplicationReceipt;
}

it("projects a Sandbox summary from explicitly supported user fields", () => {
  const result = deploymentSummary(saved(true));
  expect(result).toEqual({ name: "demo", kind: "sandbox", provider: "alicloud-express", status: "requires_recovery", template: "template-real", services: { api: { port: 9000, url: "https://example.invalid" } } });
  expect(JSON.stringify(result)).not.toMatch(/internal-|private-/);
});

it("projects managed resource cleanup without receipt paths or correlation metadata", () => {
  const result = publicSummary(receipt(), "private-receipt-file");
  expect(result).toMatchObject({ application_id: "demo", endpoint: "https://example.invalid", credentials_file: "application-credentials.json", retained_resources: [{ kind: "image", id: "registry.example/image:v1", state: "created" }], recovery: [{ kind: "image", id: "registry.example/image:v1", state: "created" }, { kind: "function", id: "function-real", state: "uncertain" }] });
  expect(JSON.stringify(result)).not.toMatch(/internal-|private-/);
});

it("keeps the intentional application credential file reference without reading or printing its key", () => {
  const file = path.join(iso.home, "private-receipt.json"), credentials = path.join(iso.home, "application-credentials.json");
  fs.writeFileSync(credentials, JSON.stringify({ businessKey: "private-business-key" }));
  fs.writeFileSync(file, JSON.stringify({ ...receipt(), credentialsFile: credentials }));
  const result = deploymentSummary({ ...saved(), kind: "application", receipt: file });
  expect(result.credentials_file).toBe(credentials);
  expect(result).not.toHaveProperty("receipt_file");
  expect(JSON.stringify(result)).not.toMatch(/private-business-key|private-receipt/);
});

it.each([false, true])("keeps list and recover output public with verbose=%s", async verbose => {
  const value = saved();
  value.journal = path.join(iso.home, "private-journal.json");
  fs.writeFileSync(value.journal, JSON.stringify({ version: 1, provider: value.provider, entries: [{ kind: "sandbox", id: "sandbox-real", state: "uncertain", intent_id: "internal-intent", correlation_key: "internal-correlation", cleanup: "sandbox.delete" }] }));
  saveDeployment(value);
  const before = readDeployment("demo");
  for (const args of [["list", "--local"], ["recover", "demo"]]) {
    const result = await run([...(verbose ? ["--verbose"] : []), ...args]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).not.toMatch(/internal-|private-|journal|plan_digest|receipt_file/);
    if (args[0] === "recover") expect(JSON.parse(result.stdout)).toMatchObject({ resources: [{ kind: "sandbox", id: "sandbox-real", state: "uncertain" }], next: expect.stringContaining("abx delete demo --yes") });
  }
  expect(readDeployment("demo")).toEqual(before);
});

it("retains actual image identity after deletion without exposing its internal intent", async () => {
  const value = saved();
  value.journal = path.join(iso.home, "private-journal.json");
  fs.writeFileSync(value.journal, JSON.stringify({ version: 1, provider: value.provider, entries: [{ kind: "image", id: "registry.example/image:v1", state: "retained", intent_id: "internal-intent", cleanup: "manual" }] }));
  saveDeployment(value);
  const result = await run(["delete", "demo", "--yes"]);
  expect(result.exit_code, result.output).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "deleted", retained_resources: [{ kind: "image", id: "registry.example/image:v1", state: "retained" }] });
  expect(result.output).not.toMatch(/internal-|private-|journal/);
  expect(fs.existsSync(value.journal)).toBe(true);
});

it("does not accept a public recovery receipt handoff", async () => {
  const help = await run(["recover", "--help"]);
  expect(help.output).not.toContain("--receipt");
  const result = await run(["recover", "demo", "--receipt", "receipt.json"]);
  expect(result.exit_code).toBe(2);
  expect(readDeployment("demo")).toBeUndefined();
});

it.each([false, true])("sanitizes a damaged internal record in error output (verbose=%s)", async verbose => {
  saveDeployment(saved());
  const file = path.join(deploymentDirectory("demo"), "deployment.json");
  fs.writeFileSync(file, '{ "private-business-key":');
  const result = await run([...(verbose ? ["--verbose"] : []), "status", "demo"]);
  expect(result.exit_code).not.toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ message: expect.stringContaining("Saved deployment information cannot be read") });
  expect(result.output).not.toMatch(/private-business-key|deployment.json/);
  expect(fs.readFileSync(file, "utf8")).toBe('{ "private-business-key":');
});

it("sanitizes damaged application records without exposing parser fragments", async () => {
  const file = path.join(iso.home, "private-receipt.json");
  fs.writeFileSync(file, '{ "private-business-key":');
  saveDeployment({ ...saved(), kind: "application", receipt: file });
  const result = await run(["--verbose", "status", "demo"]);
  expect(result.exit_code).not.toBe(0);
  expect(result.output).toContain("Saved application information cannot be read");
  expect(result.output).not.toMatch(/private-business-key|private-receipt/);
});

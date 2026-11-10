/** Cross-provider listings report incomplete observations without treating failed queries as empty. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cli, main } from "../../src/cli/main.js";
import { saveDeployment } from "../../src/cli/deployment_store.js";
import { managementSeams } from "../../src/cli/commands/deployment_management.js";
import { Provider } from "../../src/providers/base.js";
import { registerProvider } from "../../src/providers/registry.js";
import { SandboxInfo } from "../../src/models/sandbox.js";
import { AuthenticationError } from "../../src/models/errors.js";
import { KeyboardInterrupt } from "../../src/cli/errors.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useCapsys } from "./conftest.js";
import { useIso } from "../_support/iso.js";
useIso(); const cap = useCapsys();
class Fixture extends Provider { readonly id = "partial-fixture"; async buildInfra(): Promise<never> { throw Error("unused"); } }
afterEach(() => vi.restoreAllMocks());
describe("list partial results", () => {
  it("lists local records with no cloud configuration or SDK queries", async () => {
    const query = vi.spyOn(managementSeams, "list");
    expect(await main({ args: ["--json", "list", "--local"] })).toBe(0);
    expect(JSON.parse(cap.readouterr().out)).toEqual({ items: [], partial: false, errors: [] });
    expect(query).not.toHaveBeenCalled();
  });
  it("keeps successful provider rows, emits one JSON document and a sanitized warning", async () => {
    registerProvider(new Fixture());
    vi.spyOn(managementSeams, "list").mockImplementation(async options => {
      if (options?.provider === "alicloud-express") throw new AuthenticationError("secret-fixture-credential");
      return [SandboxInfo.modelValidate({ sandboxID: "fixture-id", templateID: "base", status: "running" })];
    });
    const exit_code = await main({ args: ["--json", "list", "--all-providers"] });
    const captured = cap.readouterr();
    const result = { exit_code, stdout: captured.out, stderr: captured.err, output: captured.out + captured.err };
    expect(result.exit_code, result.output).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ partial: true, errors: [{ provider: "alicloud-express", code: "E1000" }], items: [{ provider: "partial-fixture", sandbox_id: "fixture-id" }] });
    expect(result.stderr).toContain("results are incomplete"); expect(result.output).not.toContain("secret-fixture-credential");
  });
  it("fails with the first error if all remote providers fail", async () => {
    registerProvider(new Fixture());
    vi.spyOn(managementSeams, "list").mockRejectedValue(new AuthenticationError("fixture-auth-failure"));
    const result = await new CliRunner().invoke(cli, ["--json", "list", "--all-providers"]);
    expect(result.exit_code).not.toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ code: "E1000" });
    expect(JSON.parse(result.stdout)).not.toHaveProperty("items");
  });
  it("never converts an interrupt into a partial result or queries later providers", async () => {
    registerProvider(new Fixture()); const query = vi.spyOn(managementSeams, "list").mockRejectedValue(new KeyboardInterrupt());
    const result = await new CliRunner().invoke(cli, ["--json", "list", "--all-providers"]);
    expect(result.exit_code).not.toBe(0); expect(query).toHaveBeenCalledOnce(); expect(result.stdout).not.toContain('"partial"');
  });
});

it("preserves the observed template when merging a named deployment with its remote Sandbox", async () => {
  saveDeployment({version:1,name:"named",kind:"sandbox",provider:"alicloud-express",sandboxId:"sbx-owned",status:"ready",createdAt:"now",updatedAt:"now"});
  const query = vi.spyOn(managementSeams, "list").mockResolvedValue([
    SandboxInfo.modelValidate({sandboxID:"sbx-owned",templateID:"native-template",status:"running",envdAccessToken:"private-token"}),
    SandboxInfo.modelValidate({sandboxID:"sbx-untracked",templateID:"other-template",status:"running"}),
  ]);
  const result = await new CliRunner().invoke(cli, ["--json", "list"], {env:{ABX_SANDBOX_API_KEY:"fixture-key"}});
  expect(result.exit_code,result.output).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({partial:false,errors:[],items:[
    {name:"named",sandbox_id:"sbx-owned",template:"native-template",status:"running",observation:"remote"},
    {name:null,sandbox_id:"sbx-untracked",template:"other-template",status:"running",observation:"remote"},
  ]});
  expect(query).toHaveBeenCalledOnce();
  expect(result.output).not.toContain("private-token");
});

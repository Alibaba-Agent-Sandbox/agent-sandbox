/** Native template CRUD remains discoverable and executable through the sole provider runner. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { _sdkLoader, _seams } from "../../src/providers/alicloud_express/fc_template.js";
import { TEMPLATE_COMMANDS } from "../../src/providers/alicloud_express/template_commands.js";
import { getProviderCommand, runProviderCommand } from "../../src/providers/commands.js";
import { validateCommandOutput } from "../../src/providers/command_contract.js";
import { cli } from "../../src/cli/main.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useIso } from "../_support/iso.js";
/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = useIso();
const original = _sdkLoader.load;
const sdk = original();
const credentials = { access_key_id: "placeholder-ak", access_key_secret: "placeholder-secret", region: "cn-shanghai" };
const ref = { team_id: "team-one", template_id: "template-one" };
function fixture(method: string, body: any) {
  const call = vi.fn().mockResolvedValue({ body, statusCode: 200 });
  const client = vi.fn(function (_config: unknown) { return { [method]: call }; });
  _sdkLoader.load = () => ({ ...sdk, Client: client as any });
  return { call, client };
}
afterEach(() => { _sdkLoader.load = original; vi.restoreAllMocks(); });
describe("provider native template CRUD", () => {
  it("publishes strict schemas and read/write/delete metadata without SDK I/O", async () => {
    const load = vi.fn(original); _sdkLoader.load = load;
    for (const entry of TEMPLATE_COMMANDS) {
      expect(getProviderCommand("alicloud-express", entry.id)).toEqual(entry);
      expect(entry.input_schema.additionalProperties).toBe(false);
      const result = await new CliRunner().invoke(cli, ["--json", "provider", "command", "info", "alicloud-express", entry.id]);
      expect(result.exit_code, result.output).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ id: entry.id, effect: entry.effect });
    }
    expect(load).not.toHaveBeenCalled();
  });
  it.each(["template.create", "template.delete"])("requires explicit confirmation for %s", async command => {
    const load = vi.fn(original); _sdkLoader.load = load;
    const result = await new CliRunner().invoke(cli, ["--ci", "--json", "provider", "run", command, "--input", JSON.stringify(ref)]);
    expect(result.exit_code).toBe(2); expect(JSON.parse(result.stdout)).toMatchObject({ code: "E8012" });
    expect(load).not.toHaveBeenCalled();
  });
  it("executes get through the public parser and real generated request model", async () => {
    iso.setenv("ALICLOUD_ACCESS_KEY_ID", credentials.access_key_id); iso.setenv("ALICLOUD_ACCESS_KEY_SECRET", credentials.access_key_secret);
    const { call } = fixture("getTemplate", { toMap: () => ({ templateID: ref.template_id, status: "building" }) });
    const result = await new CliRunner().invoke(cli, ["--json", "provider", "run", "template.get", "--region", "cn-shanghai", "--input", JSON.stringify(ref)]);
    expect(result.exit_code, result.output).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ template: { templateID: ref.template_id, status: "building" } });
    expect(call.mock.calls[0][0]).toBe(ref.template_id);
    expect(call.mock.calls[0][1]).toBeInstanceOf(sdk.models.GetTemplateRequest);
    expect(call.mock.calls[0][1].teamID).toBe(ref.team_id);
  });
  it("lists all pages and maps delete without a second management frontend", async () => {
    const listed = fixture("listTemplates", { templates: [{ toMap: () => ({ templateID: "one" }) }], nextToken: "" });
    const result = await runProviderCommand("alicloud-express", "template.list", { team_id: ref.team_id, max_results: 4 }, credentials);
    expect(result).toEqual({ templates: [{ templateID: "one" }] });
    expect(listed.call.mock.calls[0][0]).toBeInstanceOf(sdk.models.ListTemplatesRequest);
    expect(listed.call.mock.calls[0][0]).toMatchObject({ teamID: ref.team_id, maxResults: 4 });
    const deleted = fixture("deleteTemplate", {});
    expect(await runProviderCommand("alicloud-express", "template.delete", ref, credentials)).toEqual({ template_id: ref.template_id, deleted: true });
    expect(deleted.call.mock.calls[0][1]).toBeInstanceOf(sdk.models.DeleteTemplateRequest);
  });
  it("creates through original SDK models with steps/resource fields; does not manufacture readiness or expose registry secrets", async () => {
    const { call, client } = fixture("createTemplate", { templateID: "new", code: "200", message: "submitted private-registry" });
    const result = await runProviderCommand("alicloud-express", "template.create", { team_id: ref.team_id, name: "example", image: "registry.test/image:v1", cpu: 2, memory_size: 4096, generation: 2, start_command: "python app.py", registry_username: "user", registry_password: "private-registry", steps: [{ type: "run", args: ["echo hi"] }] }, credentials);
    validateCommandOutput(getProviderCommand("alicloud-express", "template.create"), result);
    expect(call.mock.calls[0][0]).toBeInstanceOf(sdk.models.CreateTemplateRequest);
    expect(call.mock.calls[0][0].body.runtimeConfig).toMatchObject({ cpu: 2, memorySize: 4096, sandboxConfig: { generation: 2, startCommand: "python app.py", steps: [{ type: "run", args: ["echo hi"] }] } });
    expect(client.mock.calls[0][0]).toMatchObject({ regionId: "cn-shanghai", endpoint: "fcsandbox.cn-shanghai.aliyuncs.com" });
    expect(JSON.stringify(result)).not.toContain("private-registry");
    expect(result).toMatchObject({ template: { templateID: "new", message: "submitted [REDACTED]" } });
    expect(JSON.stringify(result)).not.toContain("ready");
  });
  it("resolves an omitted Team with the same AK/SK and honors configured or explicit Team", async () => {
    const getTeam = vi.spyOn(_seams, "getTeamId").mockResolvedValue("same-account-team");
    const { call } = fixture("getTemplate", { toMap: () => ({ templateID: "one" }) });
    await runProviderCommand("alicloud-express", "template.get", { template_id: "one" }, credentials);
    expect(getTeam).toHaveBeenCalledWith(credentials.access_key_id, credentials.access_key_secret, "cn-shanghai", { endpoint: null });
    expect(call.mock.calls[0][1].teamID).toBe("same-account-team");
    await runProviderCommand("alicloud-express", "template.get", { template_id: "one" }, { ...credentials, provider_options: { team_id: "configured" } });
    expect(call.mock.calls[1][1].teamID).toBe("configured");
    await runProviderCommand("alicloud-express", "template.get", { template_id: "one", team_id: "explicit" }, { ...credentials, provider_options: { team_id: "configured" } });
    expect(call.mock.calls[2][1].teamID).toBe("explicit");
    expect(getTeam).toHaveBeenCalledOnce();
  });
  it("rejects duplicate names without updating or deleting any existing template", async () => {
    const { call } = fixture("createTemplate", {}); call.mockRejectedValue(new Error("409 TemplateAlreadyExists"));
    await expect(runProviderCommand("alicloud-express", "template.create", { team_id: ref.team_id, name: "existing", image: "image:v1" }, credentials)).rejects.toThrow(/already exists/);
    expect(call).toHaveBeenCalledOnce();
  });
});

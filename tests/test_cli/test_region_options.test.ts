/** Region selection has one generic Provider override; source tooling keeps its local option. */
import "../_support/isolatedHome.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, cli } from "../../src/cli/main.js";
import { resolveRegion } from "../../src/cli/region.js";
import { loadLayeredConfig } from "../../src/transport/config_layers.js";
import { managementSeams } from "../../src/cli/commands/deployment_management.js";
import * as fcTemplate from "../../src/providers/alicloud_express/fc_template.js";
import { useIso } from "../_support/iso.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { useCapsys } from "./conftest.js";
const iso = useIso();
const cap = useCapsys();
const writeConfig = (region: string): void => iso.writeToml( `[transport]\nregion = "${region}"\n`);
afterEach(() => vi.restoreAllMocks());
describe("Provider region routing", () => {
  it("passes generic --opt region through the actual root parser for list", async () => {
    iso.setenv("ABX_SANDBOX_API_KEY", "placeholder-key");
    iso.setenv("ALIBABA_CLOUD_REGION_ID", "cn-beijing");
    let region: string | undefined;
    vi.spyOn(managementSeams, "list").mockImplementation(async () => { region = loadLayeredConfig().region; return []; });
    const code = await main({ args: ["--json", "--provider", "alicloud-express", "--opt", "region=cn-shanghai", "list"] });
    expect(code, JSON.stringify(cap.readouterr())).toBe(0); expect(region).toBe("cn-shanghai");
  });
  it("native provider management uses its local --region ahead of stored defaults", async () => {
    iso.setenv("ALICLOUD_ACCESS_KEY_ID", "placeholder-ak"); iso.setenv("ALICLOUD_ACCESS_KEY_SECRET", "placeholder-secret");
    iso.setenv("ABX_SANDBOX_API_KEY", "placeholder-key");
    iso.setenv("ALIBABA_CLOUD_REGION_ID", "cn-beijing");
    const listed = vi.spyOn(fcTemplate, "listOfficialTemplates").mockResolvedValue([]);
    const code = await main({ args: ["--json", "provider", "run", "template.list", "--region", "cn-shanghai"] });
    expect(code, cap.readouterr().err).toBe(0); expect(listed.mock.calls[0][0].region).toBe("cn-shanghai");
  });
  it.each([["list"], ["status", "id"], ["delete", "id"], ["template", "list"], ["template", "info", "base"], ["template", "init", "local"]])("rejects the obsolete regional alias %j", async (...args) => {
    const result = await new CliRunner().invoke(cli, [...args, "--region", "cn-shanghai"]);
    expect(result.exit_code).toBe(2); expect(result.output).toContain("No such option");
  });
});
describe("Unified region selection", () => {
  it("does not advertise a second global region spelling", async () => {
    const result = await new CliRunner().invoke(cli, ["--help"]);
    expect(result.exit_code).toBe(0); expect(result.output).not.toContain("--region");
  });
  it("rejects both retired global region spellings before I/O", async () => {
    for (const spelling of ["--region", "-r"]) {
      const result = await new CliRunner().invoke(cli, [spelling, "cn-shanghai", "list"]);
      expect(result.exit_code).toBe(2); expect(result.output).toContain("No such option");
    }
  });
});
describe("TestResolveRegionPriority", () => {
  // Command > env / config file > default, implemented once for all commands.

  it("test_cli_region_beats_config_file", () => {
    writeConfig("cn-beijing");
    expect(resolveRegion("cn-shanghai")).toBe("cn-shanghai");
  });

  it("test_config_file_fallback", () => {
    writeConfig("cn-beijing");
    expect(resolveRegion(null)).toBe("cn-beijing");
  });

  it("test_env_var_fallback", () => {
    iso.setenv("ALIBABA_CLOUD_REGION_ID", "cn-shenzhen");
    expect(resolveRegion(null)).toBe("cn-shenzhen");
  });

  it("test_cli_region_beats_env_var", () => {
    iso.setenv("ALIBABA_CLOUD_REGION_ID", "cn-shenzhen");
    expect(resolveRegion("cn-shanghai")).toBe("cn-shanghai");
  });

  it("test_env_var_beats_config_file", () => {
    writeConfig("cn-beijing");
    iso.setenv("ALIBABA_CLOUD_REGION_ID", "cn-shenzhen");
    expect(resolveRegion(null)).toBe("cn-shenzhen");
  });

  it("test_default_when_nothing_configured", () => {
    expect(resolveRegion(null)).toBe("cn-hangzhou");
  });
});

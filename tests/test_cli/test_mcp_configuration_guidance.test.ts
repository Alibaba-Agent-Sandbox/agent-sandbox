/** MCP setup never mixes identities/targets or contaminates protocol and machine output. */
import "../_support/isolatedHome.js";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cli } from "../../src/cli/main.js";
import * as mcp from "../../src/cli/commands/mcp.js";
import { guidanceSeams } from "../../src/cli/config_guidance.js";
import { SandboxMCPServer } from "../../src/agent/mcp.js";
import { Provider, type ProviderInfra } from "../../src/providers/base.js";
import { registerProvider } from "../../src/providers/registry.js";
import { setCliProvider } from "../../src/providers/selection.js";
import { useIso } from "../_support/iso.js";
import { CliRunner } from "../helpers/cliRunner.js";

const iso = useIso();
const ideMap = mcp._IDE_CONFIG_MAP;
afterEach(() => { setCliProvider(null); mcp._setIdeConfigMap(ideMap); vi.restoreAllMocks(); });

class MetadataProvider extends Provider {
  readonly id = "mcp-example";
  override endpointDefaults = { sandbox_base_url: "https://other-provider.invalid", sandbox_domain: "other-provider.invalid" };
  override inherit = new Set(["sandbox_api_key", "sandbox_base_url", "sandbox_domain"]);
  async buildInfra(): Promise<ProviderInfra> { throw new Error("No backend should be constructed during registration."); }
}

describe("MCP configuration guidance", () => {
  it("keeps an explicitly selected Provider's key and endpoint together despite another default", () => {
    registerProvider(new MetadataProvider());
    iso.writeToml('[core]\nprovider="mcp-example"\n[providers.alicloud-express]\nsandbox_base_url="https://express.invalid"\nsandbox_domain="express.invalid"\n');
    iso.setenv("ABX_ALICLOUD_EXPRESS_SANDBOX_API_KEY", "placeholder-express");
    setCliProvider("alicloud-express");
    expect(mcp._readApiKey()).toBe("placeholder-express");
    const block = mcp._buildMcpServerConfig();
    const env = block.get("env") as Map<string, string>;
    expect(env.get("ABX_SANDBOX_BASE_URL")).toBe("https://express.invalid");
    expect(env.get("ABX_SANDBOX_DOMAIN")).toBe("express.invalid");
    expect(env.has("ABX_SANDBOX_API_KEY")).toBe(false);
    expect(JSON.stringify([...block])).not.toContain("placeholder-express");
  });

  it("uses a default plugin's metadata without borrowing Express credentials", () => {
    registerProvider(new MetadataProvider());
    iso.writeToml('[core]\nprovider="mcp-example"\n');
    iso.setenv("ABX_SANDBOX_API_KEY", "placeholder-unrelated");
    const env = mcp._buildMcpServerConfig().get("env") as Map<string, string>;
    expect(env.get("ABX_PROVIDER")).toBe("mcp-example");
    expect(env.has("ABX_SANDBOX_API_KEY")).toBe(false);
  });

  it("registers an IDE offline with one JSON result and no embedded key", async () => {
    const file = path.join(iso.root, "cursor.json");
    mcp._setIdeConfigMap({ cursor: () => file });
    const ask = vi.spyOn(guidanceSeams, "ask");
    const result = await new CliRunner().invoke(cli, ["--json", "mcp", "install", "--target", "cursor"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "registered", credentials_embedded: false, service_verified: false });
    expect(ask).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, "utf8")).not.toContain("ABX_SANDBOX_API_KEY");
  });

  it.each(["--json", "--ci"])("generates an offline artifact with one %s result and a private token file", async flag => {
    const directory = path.join(iso.root, "artifact");
    const result = await new CliRunner().invoke(cli, [flag, "mcp", "deploy", "--generate-token", "--output-dir", directory]);
    expect(result.exit_code, result.output).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "artifact-created", deployed: false, service_verified: false, sandbox_access_configured: false, bearer_token_configured: true });
    const file = path.join(directory, "config.yaml");
    const yaml = fs.readFileSync(file, "utf8");
    const token = /ABX_MCP_AUTH_TOKEN:\s*([^\s]+)/.exec(yaml)?.[1];
    expect(token).toBeTruthy();
    expect(result.output).not.toContain(token!);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("does not start configuration input while serving STDIO without credentials", async () => {
    iso.setenv("ABX_MCP_RUNTIME_DIR", path.join(iso.root, "run"));
    const serve = vi.spyOn(SandboxMCPServer.prototype, "run").mockResolvedValue(undefined);
    const ask = vi.spyOn(guidanceSeams, "ask");
    const result = await new CliRunner().invoke(cli, ["mcp", "start"]);
    expect(result.exit_code, result.output).toBe(0);
    expect(result.stdout).toBe("");
    expect(serve).toHaveBeenCalledOnce();
    expect(ask).not.toHaveBeenCalled();
  });

  it("retains mandatory Bearer authentication on non-loopback HTTP in automation", async () => {
    const result = await new CliRunner().invoke(cli, ["mcp", "start", "--http", "--host", "0.0.0.0"]);
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("not loopback");
  });

  it("does not generate an Express artifact using a different Provider's identity", async () => {
    registerProvider(new MetadataProvider());
    iso.writeToml('[core]\nprovider="mcp-example"\n');
    const directory = path.join(iso.root, "artifact");
    const result = await new CliRunner().invoke(cli, ["mcp", "deploy", "--generate-token", "--output-dir", directory]);
    expect(result.exit_code).not.toBe(0);
    expect(result.output).toContain("require --provider alicloud-express");
    expect(fs.existsSync(directory)).toBe(false);
  });
});

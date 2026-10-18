/** Template source acquisition is host work; deployment remains behind the selected backend's factory. */
import fs from "node:fs";
import path from "node:path";
import { type Context } from "./kit.js";
import { getFormatter } from "./formatters.js";
import { getOutput } from "./output.js";
import { CliError } from "./errors.js";
import { getProvider, resolveProviderId } from "../providers/registry.js";
import { cliProvider, cliOptions } from "../providers/selection.js";
import { ProviderFeatureNotSupportedError } from "../providers/errors.js";
import { loadLayeredConfig } from "../transport/config_layers.js";
import { RegistryClient, loadTemplateFromYaml, TEMPLATE_CACHE_DIR } from "../utils/registry.js";
import { _findTemplateYaml, _resolveIndexName, _withGithubRateLimitRetry } from "./template_catalog.js";
import type { ProviderTemplateManager } from "../providers/template_contract.js";
import { resolveGithubToken } from "./commands/config_cmd.js";

export async function installTemplate(ctx: Context, params: Record<string, unknown>): Promise<void> {
  const fmt = getFormatter(ctx), out = getOutput(ctx);
  const provider = getProvider(resolveProviderId(cliProvider()));
  let manager: ProviderTemplateManager | null = null;
  if (!params["download_only"]) {
    provider.require("templates.build");
    if (!params["yes"]) throw new CliError("Review deployment inputs and pass --yes, or use --download-only.");
    manager = await provider.buildTemplateManager(loadLayeredConfig({ provider: provider.id, provider_options: cliOptions() }));
    if (!manager.buildProject) {
      await manager.close?.();
      throw new ProviderFeatureNotSupportedError(provider.id, "templates.build");
    }
  }
  try {
    let name = String(params["template_ref"]);
    const token = await resolveGithubToken(params["token"] as string | null);
    const acquired = await _withGithubRateLimitRetry(async (active) => {
      const registry = new RegistryClient(String(params["registry_url"] ?? "https://github.com"), active);
      let ref = await registry.resolve(name, params["registry_type"] as string | null);
      if (ref.is_builtin) {
        name = await _resolveIndexName(name, { token: active, fmt, out });
        ref = await registry.resolve(name, params["registry_type"] as string | null);
      }
      return registry.fetch(ref);
    }, { token, fmt, out });
    const yaml = _findTemplateYaml(acquired);
    if (!yaml) throw new CliError("Template source has no template.yaml.");
    const template = loadTemplateFromYaml(yaml);
    const alias = String(params["alias"] || template.name || path.basename(acquired));
    const destination = params["dest_dir"] ? path.resolve(String(params["dest_dir"])) : path.join(TEMPLATE_CACHE_DIR, alias);
    if (path.resolve(acquired) !== destination) {
      if (fs.existsSync(destination) && fs.readdirSync(destination).length) throw new CliError("Destination is not empty.");
      fs.cpSync(acquired, destination, { recursive: true });
    }
    if (params["download_only"]) fmt.printData({ Alias: alias, Cached: destination, Status: "installed-locally" });
    else {
      fmt.printData(await manager!.buildProject!(destination, params));
    }
  } finally { await manager?.close?.(); }
}

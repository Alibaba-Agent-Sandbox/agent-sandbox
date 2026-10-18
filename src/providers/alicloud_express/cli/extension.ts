import type { ProviderCliExtension } from "../../../cli/provider_extensions.js";
import { CONFIGURATION_UI } from "./configuration.js";
/** Upper-layer CLI integration owned by Express. Static metadata never performs cloud I/O. */
import { CONFIG_METADATA } from "../metadata.js";
import { templateUi, createParams, DEPLOY_HELP } from "./metadata.js";
import type { Context } from "../../../cli/kit.js";
export const CLI_EXTENSION = {
  id: CONFIG_METADATA.id, templateUi, createParams, deployHelp: DEPLOY_HELP, configuration: CONFIGURATION_UI,
  loadTemplates: () => import("./template.js"),
  loadDeploy: () => import("./deploy.js"),
  async deployGenerated(directory: string, options: Record<string, unknown>, ctx: Context) {
    const adapter = await import("./template.js");
    const namespace = adapter.resolve_acr_namespace(options["acr_namespace"] as string | null);
    const result = await adapter.do_deploy(directory, { acr_namespace: namespace, ctx, verbose: Boolean(options["verbose"]) });
    const id = result["TemplateID"];
    return { template_id: id && id !== "N/A" ? id : null, status: result["Status"] };
  },
} satisfies ProviderCliExtension;

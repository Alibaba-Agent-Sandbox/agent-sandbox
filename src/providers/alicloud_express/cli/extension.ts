import { isConditionalCommand } from "../conditional_commands.js";
import { confirm } from "../../../cli/prompts.js";
import type { ProviderCliExtension } from "../../../cli/provider_extensions.js";
import { CONFIGURATION_UI } from "./configuration.js";
/** Upper-layer CLI integration owned by Express. Static metadata never performs cloud I/O. */
import { CONFIG_METADATA } from "../metadata.js";
import { templateUi, createParams, DEPLOY_HELP } from "./metadata.js";
import type { Context } from "../../../cli/kit.js";
export const CLI_EXTENSION = {
  id: CONFIG_METADATA.id, templateUi, createParams, deployHelp: DEPLOY_HELP, configuration: CONFIGURATION_UI,
  async prepareProject(directory, options, ctx) {
    const started = Date.now();
    const adapter = await import("./template.js");
    const deployOptions = { alias: options.alias, timeout: options.timeout, yes: Boolean(ctx.params["yes"]), ctx };
    return adapter.withDeployConfiguration(directory, deployOptions, async () => {
      if (!deployOptions.yes) await confirm("Build/register this template and create a billable sandbox?", { abort: true, err: true });
    const result = await adapter.do_deploy(directory, deployOptions);
    const reference = result["TemplateID"];
    if (typeof reference !== "string" || !reference || reference === "N/A") throw new Error("Template preparation returned no reference.");
    if (String(result["Status"]).toLowerCase() !== "ready") {
      const fc = await import("../fc_template.js");
      const config = adapter.templateSeams.loadConfig();
      await fc.waitForTemplateReady(reference, { access_key_id: config.access_key_id!, access_key_secret: config.access_key_secret!, region: config.region,
        timeout: Math.max(0.01, options.timeout - (Date.now() - started) / 1000), poll_interval: 2 });
    }
    return { reference, status: "ready" };
    });
  },
  managementRequirements: (commandId: string) => isConditionalCommand(commandId) ? ["sandbox_api_key"] : ["access_key_id", "access_key_secret"],
  loadTemplates: () => import("./template.js"),
  loadDeploy: () => import("./deploy.js"),
  async deployGenerated(directory: string, options: Record<string, unknown>, ctx: Context) {
    const adapter = await import("./template.js");
    // All supported deployment options survive generation; plan selection happens before ACR requirements.
    const result = await adapter.do_deploy(directory, { ...options, yes: Boolean(ctx.params["yes"]), explicit_acr_namespace: adapter.acrNamespacePassedOnCli(), ctx, verbose: Boolean(options["verbose"]) });
    const id = result["TemplateID"];
    return { template_id: id && id !== "N/A" ? id : null, status: result["Status"] };
  },
} satisfies ProviderCliExtension;

import { TemplateBuildTimeoutError } from "../../../models/errors.js";
import { isConditionalCommand } from "../conditional_commands.js";
import { confirm } from "../../../cli/prompts.js";
import type { ProviderCliExtension } from "../../../cli/provider_extensions.js";
import { CONFIGURATION_UI } from "./configuration.js";
/** Upper-layer CLI integration owned by Express. Static metadata never performs cloud I/O. */
import { materializeBaseImage } from "../base_image.js";
import { loadLayeredConfig } from "../../../transport/config_layers.js";
import { CONFIG_METADATA } from "../metadata.js";
import { templateUi, createParams, DEPLOY_HELP } from "./metadata.js";
import type { Context } from "../../../cli/kit.js";
import { getOutput } from "../../../cli/output.js";
import path from "node:path";
import fs from "node:fs";
import { stageProject } from "../../shared/project.js";
import { resolveBuildPlan, commandWithStepEnvironment } from "../../../template/build_plan.js";
import { ProviderConfigError } from "../../../models/provider_errors.js";
import type { PreparedTemplate } from "../../template_contract.js";
export const CLI_EXTENSION = {
  id: CONFIG_METADATA.id, templateUi, createParams, deployHelp: DEPLOY_HELP, configuration: CONFIGURATION_UI,
  generationBaseImage(options: Record<string, unknown>) {
    return options["build"] === "steps" ? materializeBaseImage(CONFIG_METADATA.templateProfile.base_image, loadLayeredConfig({ provider: CONFIG_METADATA.id }).region) : undefined;
  },
  async stageProject(directory, options) {
    const selected = options.build_profile ? path.join(directory, options.build_profile.dockerfile) : undefined;
    const plan = resolveBuildPlan(directory, { mode: selected ? "dockerfile" : "auto", dockerfile: selected });
    const region = loadLayeredConfig({ provider: CONFIG_METADATA.id }).region;
    return stageProject(directory, { dockerfile: plan.kind === "steps" ? null : path.basename(plan.dockerfile),
      resolveDockerfile: source => materializeBaseImage(source, region) });
  },
  async prepareProject(directory, options, ctx) {
    if (!options.journal) throw new ProviderConfigError("Express workflow preparation requires an owned-resource journal.");
    const started = Date.now();
    const adapter = await import("./template.js");
    const dockerfile = options.build_profile ? path.join(directory, options.build_profile.dockerfile) : undefined;
    const plan = resolveBuildPlan(directory, { mode: dockerfile ? "dockerfile" : "auto", dockerfile });
    const deployOptions = { alias: options.alias, tag: options.alias, timeout: options.timeout, yes: Boolean(ctx.params["yes"]), ctx,
      dockerfile, build: plan.kind, journal: options.journal, workflow_launch: true,
      cpu: options.template.cpu, memory: options.template.memory,
      envd_inject: plan.kind === "dockerfile" && !/^FROM\s+fc-e2b-registry\.[a-z0-9-]+\.cr\.aliyuncs\.com\/runtime\/base:/im.test(fs.readFileSync(plan.dockerfile, "utf8")) };
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
    return { reference, status: "ready", identity: { native_version: reference },
      owned_resources: result["owned_resources"] as PreparedTemplate["owned_resources"],
      ...(options.template.start_cmd ? { startup_command: commandWithStepEnvironment(plan, options.template.start_cmd)! } : {}),
      ...(options.template.ready_cmd ? { ready_command: commandWithStepEnvironment(plan, options.template.ready_cmd)! } : {}) };
    });
  },
  managementRequirements: (commandId: string) => isConditionalCommand(commandId) ? ["sandbox_api_key"] : ["access_key_id", "access_key_secret"],
  loadTemplates: () => import("./template.js"),
  loadDeploy: () => import("./deploy.js"),
  async deployGenerated(directory: string, options: Record<string, unknown>, ctx: Context) {
    const started = Date.now();
    const adapter = await import("./template.js");
    // All supported deployment options survive generation; plan selection happens before ACR requirements.
    const result = await adapter.do_deploy(directory, { ...options, yes: Boolean(ctx.params["yes"]), explicit_acr_namespace: adapter.acrNamespacePassedOnCli(), ctx, verbose: Boolean(options["verbose"]) });
    const id = result["TemplateID"];
    if (typeof id === "string" && id && id !== "N/A" && String(result["Status"]).toLowerCase() === "submitted") {
      const fc = await import("../fc_template.js");
      const config = adapter.templateSeams.loadConfig({ region: typeof options["region"] === "string" ? options["region"] : null });
      const out = getOutput(ctx);
      let lastState = "", lastReport = -15;
      out.progress(`Waiting for generated template ${id} to become ready...`);
      await fc.waitForTemplateReady(id, { access_key_id: config.access_key_id!, access_key_secret: config.access_key_secret!, region: config.region,
        timeout: Math.max(0.01, (typeof options["timeout"] === "number" ? options["timeout"] : 600) - (Date.now() - started) / 1000), poll_interval: 2,
        on_poll: (state, elapsed) => {
          if (state !== lastState || elapsed - lastReport >= 15) {
            out.progress(`Template ${id}: ${state} (${Math.floor(elapsed)}s)`);
            lastState = state; lastReport = elapsed;
          }
        } }).catch((error: unknown) => {
          if (error instanceof TemplateBuildTimeoutError) {
            error.suggestion = `Inspect 'abx template info ${id}' and the generated files at ${directory}. The remote build may still be running; do not resubmit it blindly. Simplify the build steps if needed, or delete this exact template after inspection.`;
          }
          throw error;
        });
      return { template_id: id, status: "ready" };
    }
    return { template_id: id && id !== "N/A" ? id : null, status: result["Status"] };
  },
} satisfies ProviderCliExtension;

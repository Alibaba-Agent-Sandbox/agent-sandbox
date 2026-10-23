import { withGuidedConfiguration, canGuideConfiguration } from "../config_guidance.js";
import { getOperationConfig } from "../../utils/operation_config.js";
import { launchTemplate } from "../template_launch.js";
import { cleandoc } from "../../utils/_py.js";
import { confirm } from "../prompts.js";
/** Provider-neutral template commands. Native UI, authentication and cloud work belong to adapters. */
import { argument, command, option, type Context, type Param, type Command } from "../kit.js";
import { handleErrors } from "../error_handler.js";
import { getFormatter } from "../formatters.js";
import { getOutput } from "../output.js";
import { INT, FLOAT, IntRange } from "../types.js";
import { providerCliExtension } from "../provider_extensions.js";
import { getProvider, resolveProviderId } from "../../providers/registry.js";
import { cliProvider, cliOptions } from "../../providers/selection.js";
import { loadLayeredConfig } from "../../transport/config_layers.js";
import { ProviderFeatureNotSupportedError } from "../../models/provider_errors.js";
import type { ProviderTemplateManager } from "../../providers/template_contract.js";
import { UsageError } from "../errors.js";
import { template } from "../template_catalog.js";
import { installTemplate } from "../template_install.js";
import { prepareTemplateProject } from "../template_project.js";
export * from "../template_catalog.js";

const exportsByCommand: Record<string, string> = { list: "list_templates", create: "create_template", delete: "delete_" };
const help: Record<string, string> = {
  list: "List templates on the selected provider.", info: "Get a template from the selected provider.",
  create: "Register a template using the selected provider.", push: "Publish an image using the selected provider.",
  build: "Build a template project using the selected provider.", deploy: "Deploy a template project using the selected provider.",
  delete: "Delete a template from the selected provider.", install: "Download template source and optionally deploy it with the selected provider.",
};
function genericParams(name: string): readonly Param[] {
  if (name === "install") return [argument(["template_ref"]), option(["--download-only"], { is_flag: true }),
    option(["--dir", "dest_dir"], { default: null }), option(["--registry-url"], { default: "https://github.com" }),
    option(["--registry-type"], { default: null }), option(["--token"], { default: null, envvar: "GITHUB_TOKEN" }),
    option(["--alias", "-a"], { default: null }), option(["--yes", "-y"], { is_flag: true })];
  const params: Param[] = [];
  if (["info", "delete"].includes(name)) params.push(argument(["template_id"]));
  if (["build", "deploy"].includes(name)) params.push(argument(["template_dir"]));
  if (["create", "push"].includes(name)) params.push(argument(["image"]));
  if (name === "create") params.push(option(["--name"], { default: null }));
  if (["build", "deploy", "create", "push"].includes(name)) params.push(option(["--alias", "-a"], { default: null }),
    option(["--timeout"], { type: INT, default: 600 }));
  if (["delete", "build", "deploy", "create", "push"].includes(name)) params.push(option(["--yes", "-y"], { is_flag: true }));
  return params;
}

/** A provider can own specialized UI, while the generic manager supports new providers without host branches. */
export async function providerTemplateCommand(name: string): Promise<Command | null> {
  const extension = providerCliExtension();
  if (!extension) return null;
  const module = await extension.loadTemplates();
  return (module[exportsByCommand[name] ?? name] as Command | undefined) ?? null;
}

async function runGeneric(name: string, ctx: Context, params: Record<string, unknown>): Promise<void> {
  if (name === "install") return installTemplate(ctx, params);
  const provider = getProvider(resolveProviderId(cliProvider()));
  const feature = ["list", "info"].includes(name) ? "templates.read" : "templates.build";
  provider.require(feature);
  if (!["list", "info"].includes(name) && !params["yes"] && !canGuideConfiguration(ctx, false)) throw new UsageError("Review the target and pass --yes to apply this template operation.");
  return withGuidedConfiguration(ctx, { operation: `Template ${name}`, provider: provider.id, yes: Boolean(params["yes"]) }, async () => {
  const config = loadLayeredConfig({ provider: provider.id, provider_options: cliOptions() });
  if (!["list", "info"].includes(name) && !params["yes"]) await confirm("Apply this template operation? The provider may charge for cloud operations.", { abort: true, err: true });
  const manager = await provider.buildTemplateManager(config, feature);
  try {
    const fmt = getFormatter(ctx);
    if (name === "list") {
      if (!manager.list) throw new ProviderFeatureNotSupportedError(provider.id, feature);
      fmt.printData(await manager.list());
    } else if (name === "info") {
      if (!manager.get) throw new ProviderFeatureNotSupportedError(provider.id, feature);
      fmt.printData(await manager.get(String(params["template_id"])));
    } else if (name === "delete") {
      if (!manager.delete) throw new ProviderFeatureNotSupportedError(provider.id, feature);
      await manager.delete(String(params["template_id"]));
      fmt.printSuccess("Template deleted.");
    } else {
      const method = ["build", "deploy"].includes(name) ? "buildProject" : name;
      const operation = (manager as ProviderTemplateManager & Record<string, unknown>)[method];
      if (typeof operation !== "function") throw new ProviderFeatureNotSupportedError(provider.id, feature);
      fmt.printData(await operation.call(manager, String(params["template_dir"] ?? params["image"]), params));
    }
  } finally {
    await manager.close?.();
  }
  });
}
function routed(name: string, publicName = name): Command {
  const cmd = command(publicName, {
    help: () => providerCliExtension()?.templateUi[name]?.help ?? help[name] ?? "Manage provider templates.",
    params: () => providerCliExtension()?.templateUi[name]?.params ?? genericParams(name),
    callback: handleErrors(async (ctx, params) => {
      if (name === "build" || name === "deploy") {
        getProvider(resolveProviderId(cliProvider())).require("templates.build");
        const yes = Boolean(params["yes"]) || getOutput(ctx).ci;
        params = { ...params, yes, template_dir: await prepareTemplateProject(ctx, String(params["template_dir"]), yes) };
      }
      const target = await providerTemplateCommand(name);
      if (target) await ctx.invoke(target, params);
      else await runGeneric(name, ctx, params);
    }),
  });
  template.addCommand(cmd);
  return cmd;
}
export const install = routed("install");
export const list_templates = routed("list");
export const info = routed("info");
export const create_template = routed("create", "from-image");
export const push = routed("push");
export const build = routed("build");
export const deploy = routed("deploy");
export const delete_ = routed("delete");


/** Public native image route; keeps existing provider-owned create UI when no image factory is declared. */
export const from_image = create_template;

/** Prepare the selected source and launch it without copying a cloud template ID. */
export const launch = template.command("launch", {
  help: "Build/register a template with the selected provider and create a sandbox using its returned reference. Configure the provider first; --yes permits billable operations. The selected workflow determines required operations before build. This project extension does not convert IDs between clouds.",
  params: [argument(["template_ref"]), option(["--service-url"], { default: null, help: "Explicit external service URL for a service workflow" }), option(["--build-profile"], { default: null, help: "Explicit manifest build profile; preserves its Dockerfile without rewriting source" }), option(["--workflow"], { default: null, help: "Explicit workflow ID (defaults to the manifest default_workflow)" }), option(["--alias", "-a"], { default: null }),
    option(["--timeout"], { type: FLOAT, default: 600, help: "Build deadline in seconds (maximum 3600)" }),
    option(["--sandbox-timeout"], { type: FLOAT, default: 300, help: "Sandbox lifetime in seconds" }),
    option(["--yes", "-y"], { is_flag: true })],
  callback: handleErrors(launchTemplate),
});

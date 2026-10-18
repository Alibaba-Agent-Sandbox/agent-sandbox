import { cleandoc } from "../../utils/_py.js";
import { confirm } from "../prompts.js";
import { requireTemplateFeature } from "../template_provider.js";
import type { ProviderImageRequest } from "../../providers/base.js";
import { deployProviderImage, validateProviderImage } from "../../api/provider_template.js";
/** Provider-neutral template commands. Native UI, authentication and cloud work belong to adapters. */
import { argument, command, option, type Context, type Param, type Command } from "../kit.js";
import { handleErrors } from "../error_handler.js";
import { getFormatter } from "../formatters.js";
import { INT, FLOAT, IntRange } from "../types.js";
import { providerCliExtension } from "../provider_extensions.js";
import { getProvider, resolveProviderId } from "../../providers/registry.js";
import { cliProvider, cliOptions } from "../../providers/selection.js";
import { loadLayeredConfig } from "../../transport/config_layers.js";
import { ProviderFeatureNotSupportedError } from "../../providers/errors.js";
import type { ProviderTemplateManager } from "../../providers/template_contract.js";
import { UsageError } from "../errors.js";
import { template } from "../template_catalog.js";
import { installTemplate } from "../template_install.js";
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
  const config = loadLayeredConfig({ provider: provider.id, provider_options: cliOptions() });
  if (!["list", "info"].includes(name) && !params["yes"]) throw new UsageError("Review the target and pass --yes to apply this template operation.");
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
}
function routed(name: string): Command {
  const cmd = command(name, {
    help: () => providerCliExtension()?.templateUi[name]?.help ?? help[name] ?? "Manage provider templates.",
    params: () => providerCliExtension()?.templateUi[name]?.params ?? genericParams(name),
    callback: handleErrors(async (ctx, params) => {
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
export const create_template = routed("create");
export const push = routed("push");
export const build = routed("build");
export const deploy = routed("deploy");
export const delete_ = routed("delete");

export const from_image = template.command("from-image", {
  help: cleandoc(`Create a provider template from an already pushed OCI image.

    Requires templates.deploy. Configure provider credentials separately.
    Private images use ABX_IMAGE_REGISTRY_USERNAME and ABX_IMAGE_REGISTRY_PASSWORD.
    Timeout cancels waiting; an already submitted remote build may still exist.
    E2B needs Node.js 22+ and the optional e2b package; its manifest must opt in.

    Example:
      abx --provider e2b template from-image docker.io/example/runtime:v1 --name runtime:v1 -y
    `),
  params: [
    argument(["image"]),
    option(["--name"], { required: true, help: "Provider template name, optionally with a tag" }),
    option(["--cpu"], { type: new IntRange({ min: 1 }), default: null, help: "CPU cores" }),
    option(["--memory"], { type: new IntRange({ min: 1 }), default: null, help: "Memory in MiB" }),
    option(["--start-cmd"], { default: null, help: "Build-time start command; requires --ready-cmd" }),
    option(["--ready-cmd"], { default: null, help: "Build-time readiness command" }),
    option(["--timeout"], { type: FLOAT, default: 600, help: "Build deadline in seconds (0 < timeout <= 3600)" }),
    option(["--yes", "-y"], { is_flag: true, default: false, help: "Skip confirmation" }),
  ],
  callback: handleErrors(async (ctx: Context, params: Record<string, any>): Promise<void> => {
    const spec: NonNullable<ProviderImageRequest["spec"]> = {};
    for (const key of ["cpu", "memory", "start_cmd", "ready_cmd"] as const) {
      if (params[key] !== null && params[key] !== undefined) Object.assign(spec, { [key]: params[key] });
    }
    const input: ProviderImageRequest = {
      source: { kind: "image", image: params["image"] }, name: params["name"], spec, timeout: params["timeout"],
    };
    const username = process.env["ABX_IMAGE_REGISTRY_USERNAME"];
    const password = process.env["ABX_IMAGE_REGISTRY_PASSWORD"];
    if (username !== undefined || password !== undefined) input.registry = { username: username ?? "", password: password ?? "" };
    validateProviderImage(input);
    requireTemplateFeature("templates.deploy");
    if (!params["yes"]) await confirm("Create this provider template? The provider may charge for the build.", { abort: true });
    const data = await deployProviderImage(input);
    const fmt = getFormatter(ctx);
    if (fmt.use_json) fmt.printData(data);
    else fmt.printDict({ ...data });
  }),
});


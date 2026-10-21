/** Top-level deployment delegates to the active provider's template implementation. */
import { argument, command, type Option } from "../kit.js";
import { handleErrors } from "../error_handler.js";
import { providerCliExtension } from "../provider_extensions.js";
import { build } from "./template.js";
import { prepareTemplateProject } from "../template_project.js";
import { getOutput } from "../output.js";
export const deploySeams = { build };
export const deploy_shortcut = command("deploy", {
  help: () => providerCliExtension()?.deployHelp ?? "Publish a template project with the selected provider (same as 'template deploy'). Create a project first with 'abx template scaffold'.",
  params: () => [argument(["path"], { default: ".", required: false }),
    ...build.params.filter((p): p is Option => p.kind === "option")],
  callback: handleErrors(async (ctx, params) => {
    const extension = providerCliExtension();
    const yes = Boolean(params["yes"]) || getOutput(ctx).ci;
    params = { ...params, yes, path: await prepareTemplateProject(ctx, String(params["path"]), yes) };
    if (extension?.loadDeploy) {
      const adapter = await extension.loadDeploy();
      await ctx.invoke(adapter.deploy_shortcut, params);
    } else {
      const { path, ...options } = params;
      await ctx.invoke(build, { ...options, template_dir: path });
    }
  }),
});

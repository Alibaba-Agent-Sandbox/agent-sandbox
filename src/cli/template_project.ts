/** Local project preparation shared by template build/deploy entry points. */
import fs from "node:fs";
import { BuildModeError, resolveBuildPlan } from "../template/build_plan.js";
import { canGuideConfiguration } from "./config_guidance.js";
import path from "node:path";

import { shlexQuote } from "../api/_shlex.js";
import { pyExpandUser, pyResolve } from "../utils/_pyos.js";
import { UsageError } from "./errors.js";
import { getFormatter } from "./formatters.js";
import type { Context } from "./kit.js";
import { getOutput } from "./output.js";
import { confirm, prompt, select } from "./prompts.js";
import { availableCases } from "./scaffold.js";
import { _selectScaffoldCase, templateSeams, writeBuiltinScaffold } from "./template_catalog.js";

/** Resolve a project, creating a missing scaffold with confirmation or explicit yes/CI consent. */
export async function prepareTemplateProject(ctx: Context, directory: string, yes: boolean): Promise<string> {
  const target = pyResolve(pyExpandUser(directory));
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isDirectory()) throw new UsageError(`Path '${directory}' is not a directory.`, ctx);
    return target;
  }

  const out = getOutput(ctx);
  const automatic = yes || out.ci;
  const fmt = getFormatter(ctx);
  if (automatic || (templateSeams._scaffoldPickerAvailable(fmt) &&
      await confirm(`Directory '${directory}' does not exist. Create a template project here and continue?`, { default: false, err: true }))) {
    const caseName = automatic ? "python" : await _selectScaffoldCase(availableCases());
    await writeBuiltinScaffold(ctx, { directory: target, name: path.basename(target), caseName, yes: automatic });
    out.info(`Created template project '${directory}' using '${caseName}'. Continuing ${ctx.command.name}.`);
    return target;
  }
  const argument = shlexQuote(directory);
  throw new UsageError(
    `Path '${directory}' is not an existing directory. Create the directory and template files with 'abx template scaffold ${argument}'. ` +
    "Or pass --yes/-y (or --ci) to create a Python template project and continue. " +
    `For another case: abx template scaffold --template node ${argument}. ` +
    "Browse more templates: https://registry.agent-sandbox.cn/templates/",
    ctx,
  );
}

/** Repair only the absence of a build definition; explicit invalid paths and malformed YAML are never overwritten. */
export async function prepareTemplateBuildInputs(ctx: Context, directory: string, yes: boolean, options: { build?: string | null; dockerfile?: string | null }): Promise<string> {
  let target = directory;
  for (;;) {
    try { resolveBuildPlan(target, { mode: options.build ?? "auto", dockerfile: options.dockerfile }); return target; }
    catch (error) {
      if (!(error instanceof BuildModeError)) throw error;
      if (!error.message.startsWith("No Dockerfile and no template.yaml build steps")) throw new UsageError(error.message, ctx);
      if (!canGuideConfiguration(ctx, yes)) throw new UsageError(`${error.message} Initialize with 'abx template scaffold --template python ${shlexQuote(target)}', adapt existing code with 'abx template scaffold --adopt ${shlexQuote(target)}', or choose another project path. Existing files were preserved.`, ctx);
      const out = getOutput(ctx);
      out.info(`Directory '${target}' has no Dockerfile or platform build steps. Existing files will be preserved unless you explicitly approve listed replacements.`);
      const choice = await select("Prepare this template project", {
        choices: [
          { name: "Scaffold a template", value: "1" },
          { name: "Adapt existing code with a model", value: "2" },
          { name: "Use another directory", value: "3" },
          { name: "Cancel", value: "4" },
        ], default: "4", err: true,
      });
      if (choice === "1") {
        const caseName = await _selectScaffoldCase(availableCases());
        await writeBuiltinScaffold(ctx, { directory: target, name: path.basename(target), caseName, yes: false });
      } else if (choice === "2") {
        const { runAdopt } = await import("./commands/_adopt.js");
        await runAdopt(ctx, target, { hint: null, name: null, dry_run: false, force: false, yes: false, verbose: out.verbose });
      } else if (choice === "3") {
        const entered = String(await prompt("Template project directory; Enter cancels", { default: "", show_default: false, err: true })).trim();
        if (!entered) throw new UsageError("Project selection cancelled. Existing files were preserved.", ctx);
        target = await prepareTemplateProject(ctx, entered, false);
      } else throw new UsageError("Template preparation cancelled. Existing files were preserved.", ctx);
    }
  }
}

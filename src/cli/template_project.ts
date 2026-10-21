/** Local project preparation shared by template build/deploy entry points. */
import fs from "node:fs";
import path from "node:path";

import { shlexQuote } from "../api/_shlex.js";
import { pyExpandUser, pyResolve } from "../utils/_pyos.js";
import { Exit, UsageError } from "./errors.js";
import { getFormatter } from "./formatters.js";
import type { Context } from "./kit.js";
import { getOutput } from "./output.js";
import { confirm } from "./prompts.js";
import { init, templateSeams } from "./template_catalog.js";

/** Validate a project path, optionally scaffolding a missing project for review. Never deploy generated files. */
export async function prepareTemplateProject(ctx: Context, directory: string, yes: boolean): Promise<string> {
  const target = pyResolve(pyExpandUser(directory));
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isDirectory()) throw new UsageError(`Path '${directory}' is not a directory.`, ctx);
    return target;
  }

  const argument = shlexQuote(directory);
  const scaffold = `abx template scaffold ${argument}`;
  const fmt = getFormatter(ctx);
  if (!yes && templateSeams._scaffoldPickerAvailable(fmt) &&
      await confirm(`Directory '${directory}' does not exist. Create a template project here?`, { default: false, err: true })) {
    await ctx.invoke(init, { directory: target, name: path.basename(target) });
    getOutput(ctx).info(`Review the generated files, then deploy: abx template deploy ${argument}`);
    throw new Exit(0);
  }
  throw new UsageError(
    `Path '${directory}' is not an existing directory. Create the directory and template files with '${scaffold}'. ` +
    `In scripts, choose a case explicitly, for example: abx template scaffold --template python ${argument}. ` +
    "Browse more templates: https://registry.agent-sandbox.cn/templates/",
    ctx,
  );
}

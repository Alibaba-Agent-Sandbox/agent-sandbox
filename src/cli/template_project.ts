/** Local project preparation shared by template build/deploy entry points. */
import fs from "node:fs";
import path from "node:path";

import { shlexQuote } from "../api/_shlex.js";
import { pyExpandUser, pyResolve } from "../utils/_pyos.js";
import { UsageError } from "./errors.js";
import { getFormatter } from "./formatters.js";
import type { Context } from "./kit.js";
import { getOutput } from "./output.js";
import { confirm } from "./prompts.js";
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

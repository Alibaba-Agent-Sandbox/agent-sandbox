import { DEPLOY_HELP } from "./metadata.js";
/**
 * Top-level `abx deploy` — publish a template project (same as `abx template deploy`).
 *
 * `abx deploy [PATH]` is the fixed, deterministic *publish* step of the template lifecycle: docker build → ACR push →
 * CreateTemplate → poll. It is exactly `abx template deploy` with `PATH` defaulting to `.` and shares **every** option of
 * it (`--acr-namespace`, `--alias`, `--yes`, `-v/--verbose`, ...).
 *
 * It takes no description and needs no LLM: everything about *what* the template is (name, resources, ports,
 * capabilities) is authored earlier — by hand, from `abx template scaffold`, or by `abx template scaffold --prompt "DESCRIPTION"` (template
 * generation) — and lives in `template.yaml`, which `deploy` only reads. It does not create a sandbox, so it has no
 * `--timeout` option.
 */

import fs from "node:fs";

import { Argument, Option, argument, command, getCurrentContext, type Context } from "../../../cli/kit.js";
import { UsageError } from "../../../cli/errors.js";
import { pyExpandUser, pyResolve } from "../../../utils/_pyos.js";
import { handleErrors } from "../../../cli/error_handler.js";
import { enableVerbose } from "../../../cli/output.js";
import { requireTemplateFeature } from "./selection.js";
import { BuildModeError, resolveBuildPlan } from "../../../template/build_plan.js";
import { build, acrNamespacePassedOnCli, resolve_acr_namespace } from "./template.js";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Patch points (module attributes the Python tests monkeypatch: `build`, `resolve_acr_namespace`). */
export const deploySeams: {
  build: typeof build;
  resolve_acr_namespace: typeof resolve_acr_namespace;
} = {
  build,
  resolve_acr_namespace,
};

/**
 * Every option of `template build` (without its TEMPLATE_DIR argument), reused verbatim so `deploy` and
 * `template deploy` cannot drift.
 */
const _BUILD_OPTIONS = build.params.filter((p): p is Option => p.kind === "option");

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export const deploy_shortcut = command("deploy", {
  help: DEPLOY_HELP,
  params: [
    argument(["path"], { default: ".", required: false }) as Argument,
    ..._BUILD_OPTIONS,
  ],
  callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
    const kwargs: Record<string, Any> = { ...params };
    const path: string = kwargs["path"];
    delete kwargs["path"];

    if (kwargs["verbose_flag"]) enableVerbose(ctx);
    requireTemplateFeature("templates.build");

    const projectPath = pyResolve(pyExpandUser(path));
    if (!isDirectory(projectPath)) {
      throw new UsageError(`Path '${path}' is not an existing directory.`, getCurrentContext(true));
    }

    let plan;
    try {
      plan = resolveBuildPlan(projectPath, { mode: kwargs["build"] ?? "auto", dockerfile: kwargs["dockerfile"] ?? null });
    } catch (e) {
      if (e instanceof BuildModeError) {
        const hint = e.message.startsWith("No Dockerfile")
          ? " Author the template first: 'abx template scaffold --adopt .' (adapt this project), " +
            "'abx template scaffold \"DESCRIPTION\"' (generate) or " +
            "'abx template scaffold --template python' (scaffold)."
          : "";
        throw new UsageError(e.message + hint, getCurrentContext(true));
      }
      throw e;
    }

    // Fail fast, before any docker or cloud call.
    if (plan.kind === "dockerfile") {
      deploySeams.resolve_acr_namespace(kwargs["acr_namespace"] ?? null);
    } else if (acrNamespacePassedOnCli()) {
      throw new UsageError("--acr-namespace cannot be used with platform build steps.", getCurrentContext(true));
    }

    await ctx.invoke(deploySeams.build, { template_dir: String(projectPath), ...kwargs });
  }),
});

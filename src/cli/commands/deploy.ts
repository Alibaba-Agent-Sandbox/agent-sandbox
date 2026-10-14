/**
 * Top-level `abx deploy` — publish a template project (same as `abx template deploy`).
 *
 * `abx deploy [PATH]` is the fixed, deterministic *publish* step of the template lifecycle: docker build → ACR push →
 * CreateTemplate → poll. It is exactly `abx template deploy` with `PATH` defaulting to `.` and shares **every** option of
 * it (`--acr-namespace`, `--alias`, `--yes`, `-v/--verbose`, ...).
 *
 * It takes no description and needs no LLM: everything about *what* the template is (name, resources, ports,
 * capabilities) is authored earlier — by hand, from `abx template init`, or by `abx template init "DESCRIPTION"` (template
 * generation) — and lives in `template.yaml`, which `deploy` only reads. It does not create a sandbox, so it has no
 * `--timeout` option.
 */

import fs from "node:fs";

import { Argument, Option, argument, command, getCurrentContext, type Context } from "../kit.js";
import { UsageError } from "../errors.js";
import { cleandoc } from "../../utils/_py.js";
import { pyExpandUser, pyResolve } from "../../utils/_pyos.js";
import { handleErrors } from "../main.js";
import { enableVerbose } from "../output.js";
import { requireTemplateFeature } from "../template_provider.js";
import { BuildModeError, resolveBuildPlan } from "../../template/build_plan.js";
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
  help: cleandoc(`Publish a template project: build, push to ACR, register the template (same as 'abx template deploy').

    Runs one publish path. No LLM is involved.
    PATH is the template directory (default: .). --build auto (the default)
    uses a Dockerfile when one is present, and otherwise template.yaml build
    steps. dockerfile mode builds and pushes an image, then waits until the
    template is ready. steps mode sends base.image and sandboxConfig.steps
    and does not use Docker or ACR. template.yaml supplies the template name
    and resources.

    To author the files first, use 'abx template init': --adopt for an existing
    project, a natural-language description to generate the files, or
    --template for a scaffold.

    Accepts every option of 'abx template deploy' (--acr-namespace,
    --alias, --yes, -v/--verbose, ...). The ACR namespace and AccessKey are
    set with 'abx config init --build'.

    \b
    Examples:
      abx deploy --acr-namespace my-ns           # publish ./ as a template
      abx deploy ./my-template --yes             # non-interactive
      abx deploy ./my-template -v                # with debug logs

    \b
    Typical flow:
      abx template init --adopt .                      # 1a. author from a project
      abx template init "a python data science env"   # 1b. generate from a description
      abx deploy ./<name> --acr-namespace my-ns       # 2. publish
      abx create --template <TEMPLATE_ID>             # 3. launch a sandbox

    \b
    Related commands:
      abx template init          Author Dockerfile / template.yaml
      abx template deploy DIR    The same pipeline with a required DIRECTORY
      abx create "DESCRIPTION"   Generate + publish + launch in one go
    `),
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
          ? " Author the template first: 'abx template init --adopt .' (adapt this project), " +
            "'abx template init \"DESCRIPTION\"' (generate) or " +
            "'abx template init --template python' (scaffold)."
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

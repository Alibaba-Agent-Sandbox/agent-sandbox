/**
 * Top-level `ebx deploy` — publish a template project (port of `cli/commands/deploy.py`).
 *
 * `ebx deploy [PATH]` is the fixed, deterministic *publish* step of the template lifecycle: docker build → ACR push →
 * CreateTemplate → poll. It is exactly `ebx template deploy` with `PATH` defaulting to `.` and shares **every** option of
 * it (`--acr-namespace`, `--alias`, `--yes`, `-v/--verbose`, ...).
 *
 * It takes no description and needs no LLM: everything about *what* the template is (name, resources, ports,
 * capabilities, commands) is authored earlier — by hand, from `ebx template init`, or by
 * `ebx template init "DESCRIPTION"` (AI) — and lives in `template.yaml`, which `deploy` only reads.
 *
 * The in-sandbox agent deployment (`Sandbox.deploy`, which starts a `qwen-code` cloud sandbox) remains available as an
 * SDK API only.
 */

import fs from "node:fs";
import nodePath from "node:path";

import {
  Argument,
  Option,
  UsageError,
  argument,
  command,
  getCurrentContext,
  option,
  type Context,
} from "../../framework/index.js";
import { cleandoc } from "../../framework/py.js";
import { pyExpandUser, pyResolve } from "../../utils/_pyos.js";
import { handleErrors } from "../main.js";
import { enableVerbose, getOutput } from "../output.js";
import { build, resolve_acr_namespace } from "./template.js";

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
const _BUILD_OPTIONS = build.params.filter((p): p is Option => p instanceof Option);

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFileAt(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export const deploy_shortcut = command("deploy", {
  help: cleandoc(`Publish a template project: build, push to ACR, register the template.

    Runs the fixed pipeline: docker build, push the image to ACR, register
    the template, and wait until it is ready. No LLM is involved.
    PATH is the template directory (default: .). It must contain a
    Dockerfile; template.yaml supplies the template name and resources.

    To author the files first, use 'ebx template init': --adopt for an existing
    project, a natural-language description to let the AI write the files, or
    -t for a scaffold.

    Accepts every option of 'ebx template deploy' (--acr-namespace,
    --alias, --yes, -v/--verbose, ...).

    \b
    Examples:
      ebx deploy --acr-namespace my-ns           # publish ./ as a template
      ebx deploy ./my-template --yes             # non-interactive
      ebx deploy ./my-template -v                # with debug logs

    \b
    Typical flow:
      ebx template init --adopt .                      # 1a. author from a project
      ebx template init "a python data science env"   # 1b. author from a description
      ebx deploy ./<name> --acr-namespace my-ns       # 2. publish
      ebx create --template <TEMPLATE_ID>             # 3. launch a sandbox

    \b
    Related commands:
      ebx template init          Author Dockerfile / template.yaml (AI optional)
      ebx template deploy DIR    The same pipeline with a required DIRECTORY
      ebx create "DESCRIPTION"   Author + publish + launch in one go
    `),
  params: [
    argument(["path"], { default: ".", required: false }) as Argument,
    option(["--traditional"], { is_flag: true, hidden: true }),
    ..._BUILD_OPTIONS,
  ],
  callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
    const kwargs: Record<string, Any> = { ...params };
    const path: string = kwargs["path"];
    delete kwargs["path"];
    const traditional: boolean = kwargs["traditional"];
    delete kwargs["traditional"];

    if (kwargs["verbose_flag"]) enableVerbose(ctx);
    const out = getOutput(ctx);

    const projectPath = pyResolve(pyExpandUser(path));
    if (!isDirectory(projectPath)) {
      throw new UsageError(`Path '${path}' is not an existing directory.`, getCurrentContext(true));
    }

    if (traditional) {
      out.warning("--traditional is deprecated and ignored: 'ebx deploy' always runs the " + "build/push/register pipeline.");
    }

    // Fail fast, before any docker or cloud call.
    deploySeams.resolve_acr_namespace(kwargs["acr_namespace"] ?? null);

    if (!isFileAt(nodePath.join(projectPath, "Dockerfile")) && !kwargs["dockerfile"]) {
      throw new UsageError(
        `No Dockerfile found in ${projectPath}. Pass --dockerfile, or author the ` +
          "template first: 'ebx template init --adopt .' (adapt this project), " +
          "'ebx template init \"DESCRIPTION\"' (AI) or " +
          "'ebx template init -t python' (scaffold).",
        getCurrentContext(true),
      );
    }

    await ctx.invoke(deploySeams.build, { template_dir: String(projectPath), ...kwargs });
  }),
});

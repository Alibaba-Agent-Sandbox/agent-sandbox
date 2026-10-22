import { canGuideConfiguration, withGuidedConfiguration } from "./config_guidance.js";
import { getOperationConfig } from "../utils/operation_config.js";
import { TemplateNotFoundError } from "../models/errors.js";
/** Provider-neutral template discovery, authoring and local output. */
/**
 * Template management CLI commands (`abx template ...`; `abx deploy` is the top-level shortcut of `template deploy`).
 *
 * Port of `cli/commands/template.py`. Helper functions keep the Python names (snake_case -> `_camelCase`); keyword
 * arguments of the internal helpers keep their Python (snake_case) spelling because they are plain data. Every module
 * attribute the Python tests monkeypatch is reachable through the mutable {@link templateSeams} object: all internal
 * calls read it at call time.
 */
import fs from "node:fs";
import nodePath from "node:path";
import { argument, getCurrentContext, group, option, type Context } from "./kit.js";
import { Choice, IntRange, Path as ClickPath } from "./types.js";
import { Abort, CliError, UsageError } from "./errors.js";
import { echo, sys } from "./io.js";
import { confirm, prompt } from "./prompts.js";
import { isatty } from "./io.js";
import { cleandoc } from "../utils/_py.js";
import { handleErrors } from "./error_handler.js";
import { getFormatter } from "./formatters.js";
import { getOutput, isCiEnv } from "./output.js";
import { availableCases, renderScaffold } from "./scaffold.js";
import { ValueError } from "../utils/_pyerrors.js";
import { GitHubRateLimitError } from "../models/errors.js";
import { isFile, mkdirParents, pathExists, pyCopytree, pyJoin, pyResolve, scandirNames, writeTextPy } from "../utils/_pyos.js";
import { FINE_GRAINED_PAT_URL } from "../utils/github_token.js";
import { RegistryClient, loadTemplateFromYaml } from "../utils/registry.js";
import { fetchIndex } from "../utils/template_index.js";
import { resolveTemplateProfile } from "../providers/template_profile.js";
export type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any


export /**
 * Shared help for the three `--token` options (task 206). The persistent `abx config set github_token` flow is
 * recommended; the flag remains a temporary override with an explicit leak warning.
 */
const _GITHUB_TOKEN_HELP = "GitHub token for private repos / higher rate limits. Prefer " +
    "'abx config set github_token' (masked input, stored once in ~/.abx/.env); " +
    "--token is a temporary override that may leak into shell history and the " +
    "process list (env: GITHUB_TOKEN).";

export /** Python `str.strip()` for the whitespace set used here. */
function pyStrip(text: string): string {
    return text.replace(/^[\s\x1c-\x1f\x85]+|[\s\x1c-\x1f\x85]+$/g, "");
}

export function usageError(message: string): UsageError {
    return new UsageError(message, getCurrentContext(true));
}

export /**
 * Lazy sibling-module import (the command-module graph must stay acyclic at import time).
 * The specifiers are a fixed set so the standalone binary bundler can include them.
 */
const _LAZY_MODULES: Record<string, () => Promise<Any>> = {
    "./config_cmd.js": () => import("./commands/config_cmd.js"),
    "./_adopt.js": () => import("./commands/_adopt.js"),
    "./sandbox.js": () => import("./commands/sandbox.js"),
};

export async function _lazyModule(specifier: string): Promise<Any> {
    const load = _LAZY_MODULES[specifier];
    if (load === undefined)
        throw new Error(`Unknown lazy module '${specifier}'`);
    return await load();
}

export /** Load one of the config helpers lazily (`config_cmd` imports `main`; keep the command-module graph acyclic). */
async function _configCmd(): Promise<Any> {
    return await _lazyModule("./config_cmd.js");
}

/** Return the template manifest path, or `null` if none is present. */
export function _findTemplateYaml(template_path: string): string | null {
    const base = String(template_path);
    for (const name of ["template.yaml"]) {
        const candidate = nodePath.join(base, name);
        if (pathExists(candidate))
            return candidate;
    }
    return null;
}

/** Whether the interactive GitHub-token onboarding can run here. */
export function _githubRateLimitSetupAvailable(out: Any): boolean {
    if (out.quiet || out.ci || out.jsonMode || templateSeams.isCiEnv() || Boolean(getCurrentContext(true)?.params["yes"]))
        return false;
    try {
        return Boolean(templateSeams.stdinIsatty()) && canGuideConfiguration(getCurrentContext(true) ?? undefined, false);
    }
    catch {
        return false;
    }
}

/**
 * Offer a one-shot interactive `github_token` setup after a rate limit.
 *
 * Returns the stored token, or `null` when the user declines / cancels / enters nothing. The token value is never
 * echoed, printed, or logged.
 */
export async function _offerGithubTokenSetup(_fmt: Any, out: Any): Promise<string | null> {
    out.info("GitHub anonymous rate limit reached. A token can increase the limit; no cloud credentials are required.");
    out.info(`Create a GitHub token for the repositories you need: ${FINE_GRAINED_PAT_URL}`);
    if (!(await confirm("Configure github_token now?", { default: true, err: true }))) return null;
    try {
        return await withGuidedConfiguration(getCurrentContext(true) ?? undefined, { operation: "Read template source from GitHub", requirements: ["github_token"], validateProvider: false }, async () => {
            out.info("Retrying the source request once. Change the saved token later: abx config set github_token");
            return String(getOperationConfig()?.["github_token"] ?? "") || null;
        });
    } catch (error) { if (error instanceof Abort) return null; throw error; }
}

/**
 * Run `operation` (which takes the active token) with one-shot recovery.
 *
 * When the operation hits GitHub's anonymous rate limit while no token is configured, an interactive session is offered
 * the masked `github_token` setup and the operation is retried exactly once with the freshly stored token.
 */
export async function _withGithubRateLimitRetry<T>(operation: (token: string | null) => T | Promise<T>, opts: {
    token: string | null;
    fmt: Any;
    out: Any;
}): Promise<T> {
    const { token, fmt, out } = opts;
    try {
        return await operation(token);
    }
    catch (e) {
        if (!(e instanceof GitHubRateLimitError))
            throw e;
        if (token || !templateSeams._githubRateLimitSetupAvailable(out))
            throw e;
        const newToken = await templateSeams._offerGithubTokenSetup(fmt, out);
        if (newToken === null)
            throw e;
        return await operation(newToken);
    }
}

export const template = group("template", {
    help: cleandoc(`Discover, scaffold, build, publish and install sandbox templates.

    \b
    Examples:
      abx template search python
      abx template scaffold --template python --name my-template
      abx template list

    \b
    Related commands:
      abx create TEMPLATE             Launch a sandbox from a template
      abx deploy [PATH]               Same as 'template deploy'
      abx config --help               Configure credentials and region

    More templates: https://registry.agent-sandbox.cn/templates/
    `),
});

export const search = template.command("search", {
    help: cleandoc(`Search the template catalog by name, tag, or description.

    Queries the template index published in the alibaba-agent-sandbox/awesome-templates
    repository - the single source of truth for official and community
    templates. The fetched index is cached under ~/.abx/index/ and reused for
    up to an hour; on network failures the cached copy is served with a
    warning.

    For private mirrors / higher rate limits a token is taken from --token,
    then the GITHUB_TOKEN environment variable, then ./.env, then the stored
    github_token (in that order); prefer 'abx config set github_token'.

    \b
    Examples:
      abx template search python
      abx template search ai-agent
      abx template search browser --status official
      abx template search qwen --tag deploy
      abx template search python --refresh    # bypass the local cache

    \b
    Related commands:
      abx template install <name>             Install a template by index name
      abx template install owner/repo//subdir[@ref]
      abx template list
    `),
    params: [
        argument(["query"]),
        option(["--tag", "-t"], { default: null, help: "Filter by exact tag name" }),
        option(["--status", "-s"], {
            type: new Choice(["official", "community", "experimental"]),
            default: null,
            help: "Filter by template status",
        }),
        option(["--index-url"], {
            default: null,
            envvar: "ABX_TEMPLATE_INDEX_URL",
            help: "Template index location: HTTP(S) URL or local file path " +
                "(env: ABX_TEMPLATE_INDEX_URL; default: the canonical remote index)",
        }),
        option(["--token"], { default: null, envvar: "GITHUB_TOKEN", help: _GITHUB_TOKEN_HELP }),
        option(["--refresh"], {
            is_flag: true,
            default: false,
            help: "Force a re-fetch of the index, ignoring the local cache",
        }),
    ],
    callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
        const { query, tag, status, index_url: indexUrl, token, refresh } = params;
        const cfgMod = await _configCmd();
        const resolveGithubToken = cfgMod.resolveGithubToken;
        const fmt = getFormatter(ctx);
        const out = getOutput(ctx);
        const fetch = (active: string | null): Promise<Any> => out.spinner("Fetching the template index", () => fetchIndex(indexUrl, { token: active, force: refresh }));
        const index = await _withGithubRateLimitRetry(fetch, { token: await resolveGithubToken(token), fmt, out });
        if (index.notice)
            out.warning(index.notice);
        const results = index.filter(query, { tag, status });
        if (results.length === 0) {
            fmt.printSuccess(`No templates matching '${query}'.`);
            return;
        }
        if (fmt.use_json) {
            fmt.printData(results.map((entry: Any) => ({
                name: entry.name,
                description: entry.description,
                repo: entry.repo,
                path: entry.path,
                ref: entry.ref,
                tags: [...entry.tags],
                author: entry.author,
                capabilities: [...entry.capabilities],
                status: entry.status,
            })));
            return;
        }
        const headers = ["Name", "Description", "Tags", "Status"];
        const rows = results.map((entry: Any) => [entry.name, entry.description || "N/A", entry.tags.join(", "), entry.status || "N/A"]);
        fmt.printTable(headers, rows);
        if (!fmt.quiet) {
            echo(`\n${results.length} template(s) found.`);
            echo(`Install one with: abx template install <name> (index: ${index.source_url})`);
        }
    }),
});

// ---------------------------------------------------------------------------
// template init — scaffold a new template project
// ---------------------------------------------------------------------------
/** Whether the interactive scaffold-case picker can run here. */
export function _scaffoldPickerAvailable(fmt: Any): boolean {
    if (fmt.use_json || getOutput().quiet || templateSeams.isCiEnv())
        return false;
    try {
        return Boolean(templateSeams.stdinIsatty()) && canGuideConfiguration(getCurrentContext(true) ?? undefined, false);
    }
    catch {
        return false;
    }
}

/**
 * Cross-platform arrow-key picker (`@inquirer/prompts` `select`, the Node counterpart of `questionary`).
 *
 * Returns the chosen case name, or `null` when the picker cannot start, so the caller can fall back to the numbered
 * prompt. Cancelling the picker (Ctrl-C) aborts the command instead of silently re-prompting.
 */
export async function _tryArrowCasePicker(cases: Array<[
    string,
    string
]>): Promise<string | null> {
    let answer: unknown;
    try {
        const inquirer = await import("@inquirer/prompts");
        const choices = cases.map(([c, desc]) => ({ name: `${c.padEnd(12)} ${desc}`, value: c }));
        answer = await inquirer.select({ message: "Select a case", choices, default: (cases[0] as [
                string,
                string
            ])[0] }, { output: process.stderr });
    }
    catch (e) {
        const err = e as {
            name?: string;
            code?: string;
        };
        if (err && (err.name === "ExitPromptError" || err.name === "AbortPromptError"))
            throw new Abort();
        // No usable terminal (or a picker failure): fall back to numbered input.
        return null;
    }
    if (answer === null || answer === undefined) {
        // The picker returns nothing when the user cancels with Ctrl-C.
        throw new Abort();
    }
    return String(answer);
}

/**
 * Return whether `value` is a sentence rather than a directory path.
 *
 * A path token (`my-app`, `./my app`, `.`) stays a directory so existing `abx template scaffold [DIRECTORY]` invocations
 * are unchanged. Whitespace or CJK text is a natural-language description. Prefix a directory that contains spaces
 * with `./`.
 */
export function _isNlDescription(value: string): boolean {
    if (value === "." || value === ".." || value.startsWith(".") || value.includes("/") || value.includes("\\"))
        return false;
    if (/[\s\x1c-\x1f\x85]/u.test(value))
        return true;
    return /[\u4e00-\u9fff]/u.test(value);
}

/**
 * Pick a scaffold case interactively.
 *
 * Prefers the cross-platform arrow-key picker; falls back to the previous numbered prompt whenever the picker is
 * unavailable.
 */
export async function _selectScaffoldCase(cases: Array<[
    string,
    string
]>): Promise<string> {
    const picked = await templateSeams._tryArrowCasePicker(cases);
    if (picked !== null)
        return picked;
    echo("Available scaffold cases:", { err: true });
    cases.forEach(([c, desc], idx) => {
        echo(`  ${idx + 1}. ${c.padEnd(12)} ${desc}`, { err: true });
    });
    const choice = await prompt("Select a case", { type: new IntRange({ min: 1, max: cases.length }), default: 1, err: true });
    return (cases[Number(choice) - 1] as [
        string,
        string
    ])[0];
}

/** Disclose existing entries and obtain overwrite authorization before any writes. */
async function confirmTemplateWrites(
  target: string, entries: readonly string[], force: boolean, yes: boolean,
  fmt: ReturnType<typeof getFormatter>, out: ReturnType<typeof getOutput>,
): Promise<string[]> {
  if (!pathExists(target)) return [];
  if (!fs.statSync(target).isDirectory()) throw new CliError(`Path '${target}' is not a directory.`);
  if (fs.readdirSync(target).length === 0) return [];
  const conflicts = entries.filter((name) => pathExists(pyJoin(target, name)));
  out.warning(`Directory '${target}' is not empty.`);
  if (conflicts.length) {
    out.warning(`Existing entries may be overwritten: ${conflicts.join(", ")}.`);
  } else {
    out.info(`Adding template files: ${entries.join(", ")}. Existing files will be kept.`);
  }
  if (!yes && templateSeams._scaffoldPickerAvailable(fmt)) {
    if (!(await confirm(conflicts.length ? "Overwrite these existing entries?" : "Add template files to this directory?", { default: false, err: true }))) {
      throw new Abort();
    }
  } else if (conflicts.length && !force) {
    throw new CliError(`Files already exist in ${target}: ${conflicts.join(", ")}. Use --force to overwrite; --yes alone does not permit replacement.`);
  }
  return conflicts;
}

/** Write a built-in scaffold with the same conflict checks as the standalone command. */
export async function writeBuiltinScaffold(ctx: Context, options: {
  directory: string; caseName: string; name: string; force?: boolean; yes?: boolean;
}): Promise<{ created: string[]; replaced: string[] }> {
  const { directory: target, caseName, name, force = false, yes = false } = options;
  const fmt = getFormatter(ctx);
  const out = getOutput(ctx);
  let files: Map<string, string>;
  try {
    files = renderScaffold(caseName, name);
  } catch (exc) {
    if (exc instanceof ValueError) throw usageError(exc.message);
    throw exc;
  }

  for (const filename of files.keys()) {
    const destination = pyJoin(target, filename);
    if (pathExists(destination)) {
      const entry = fs.lstatSync(destination);
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        throw new CliError(`Cannot replace directory or symbolic link '${destination}' with a template file. Choose another output directory.`);
      }
    }
  }
  const conflicts = await confirmTemplateWrites(target, [...files.keys()], force, yes, fmt, out);
  mkdirParents(target);

  // Write files
  for (const [filename, content] of files) {
    writeTextPy(pyJoin(target, filename), content);
  }

  return { created: [...files.keys()], replaced: conflicts };
}

export const init = template.command("scaffold", {
  help: cleandoc(`Scaffold a new sandbox template project.

    Creates a ready-to-build template directory with template.yaml,
    Dockerfile, and (depending on the case) a commands.py file.
    Nothing is built, pushed, deployed, or turned into a sandbox.

    When DIRECTORY is omitted a new ./<name> subdirectory is created
    (derived from --name, the scaffold case, or the fetched template).
    Existing nonempty directories show the affected entries before writing.
    Interactive replacement requires confirmation; in scripts use --force
    explicitly. --yes alone never authorizes overwriting existing entries.

    --prompt requests natural-language template generation; DIRECTORY always
    names a directory. Template generation (Qwen Code, needs 'abx config init --llm')
    writes Dockerfile, commands.py (the HTTP server) and template.yaml into
    ./<name>/ and stops. An interactive
    terminal is asked for that directory first (Enter keeps ./<name>/).
    A path token (my-app, ./my app) stays a directory.

    --adopt adapts a project that already has source code and no template
    files. Template generation sees a copy, and only Dockerfile, commands.py,
    template.yaml and a generated .dockerignore are written back, after you
    confirm. Nothing is built or deployed.

    \b
    Examples:
      abx template scaffold --list                     # List built-in cases
      abx template scaffold -t python                  # Creates ./python/
      abx template scaffold -t python --name myapp     # Creates ./myapp/
      abx template scaffold -t python ./my-template    # Explicit directory
      abx template scaffold --from owner/repo          # Creates ./<template-name>/
      abx template scaffold --prompt "a python data science env"  # generate files only, no build
      abx template scaffold -y --prompt "a node.js api server"    # non-interactive generation
      abx template scaffold --adopt . --hint "port 8080" # adapt this project
      abx template scaffold --adopt ./app --dry-run      # show what would be sent

    \b
    Related commands:
      abx template deploy DIRECTORY
      abx template install TEMPLATE_REF
      abx create TEMPLATE
      abx create --prompt "DESCRIPTION"   # generate, build, deploy, and create
    `),
  params: [
    argument(["directory"], { default: null, required: false, type: new ClickPath() }),
    option(["--prompt"], { default: null, help: "Generate a template from a natural-language description" }),
    option(["--template", "-t", "case"], { default: null, help: "Built-in scaffold case (python, node, minimal)" }),
    option(["--from", "from_ref"], {
      default: null,
      help: "Fetch template source from a registry ref (owner/repo, local path)",
    }),
    option(["--name"], { default: null, help: "Template name (default: case name, or fetched template name)" }),
    option(["--list", "list_cases"], { is_flag: true, default: false, help: "List available scaffold cases" }),
    option(["--force"], { is_flag: true, default: false, help: "Overwrite existing files" }),
    option(["--adopt"], {
      is_flag: true,
      default: false,
      help:
        "Adapt an existing source project: template generation adds the template files " +
        "(Dockerfile, commands.py, template.yaml). DIRECTORY is the project (default: .).",
    }),
    option(["--hint"], {
      default: null,
      help: "With --adopt: what the code cannot tell the generator (ports, services).",
    }),
    option(["--dry-run"], {
      is_flag: true,
      default: false,
      help: "With --adopt: list what would be sent to the model. Nothing is sent or written.",
    }),
    option(["-v", "--verbose", "verbose_flag"], { is_flag: true, help: "Verbose output (DEBUG level)" }),
    option(["--yes", "-y"], {
      is_flag: true,
      default: false,
      help:
        "Skip confirmation prompts: the template directory, description " +
        "clarification, and (with --adopt) the send and write prompts. Required for " +
        "non-interactive template generation. " +
        "Does not build or deploy. Replacing an existing Dockerfile still needs --force " +
        "when there is no interactive preview.",
    }),
    option(["--model"], {
      default: null,
      help:
        "Model id for natural-language generation. Overrides llm_model for this command. " +
        "An interactive terminal offers coding and chat models with the arrow keys when the chosen id does not exist.",
    }),
  ],
  callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
    const directory: string | null = params["directory"];
    const { case: caseName0, from_ref: fromRef, list_cases: listCases, force, adopt, hint, yes } = params;
    const dryRun: boolean = params["dry_run"];
    let caseName: string | null = caseName0;
    let name: string | null = params["name"];

    const fmt = getFormatter(ctx);
    const out = getOutput(ctx);

    if (adopt || hint !== null || dryRun) {
      if (!adopt) throw usageError("--hint and --dry-run require --adopt.");
      if (caseName || fromRef || listCases) {
        throw usageError("--adopt cannot be combined with --template/-t, --from or --list.");
      }
      const adoptMod: Any = await _lazyModule("./_adopt.js");
      await adoptMod.runAdopt(ctx, directory, {
        hint,
        name,
        dry_run: dryRun,
        force,
        yes,
        verbose: params["verbose_flag"],
        model: params["model"],
      });
      return;
    }

    // --list: print available cases and exit
    if (listCases) {
      const cases = availableCases();
      if (fmt.use_json) {
        fmt.printData(cases.map(([c, d]) => ({ case: c, description: d })));
      } else {
        for (const [c, desc] of cases) {
          echo(`  ${c.padEnd(12)} ${desc}`);
        }
      }
      return;
    }

    // --template and --from are mutually exclusive
    if (caseName && fromRef) {
      throw usageError("--template/-t and --from are mutually exclusive. Use one or the other.");
    }

    // A sentence is a description, not a directory name. Generate the template files and stop — no build, push, deploy,
    // or sandbox.
    if (params["prompt"] !== null) {
      if (caseName || fromRef) {
        throw usageError(
          "A natural-language description cannot be combined with " +
            "--template/-t or --from. Drop those flags to generate a " +
            "template from the description, or drop the description to " +
            "scaffold or fetch a template.",
        );
      }
      const sandboxMod: Any = await _lazyModule("./sandbox.js");
      const generate = sandboxMod._generateLocalTemplate;
      await generate(ctx, params["prompt"], { yes, name, force, ask_directory: true, model: params["model"], ...(directory ? { directory } : {}) });
      return;
    }

    // Whether the user explicitly provided a DIRECTORY argument
    const dirProvided = directory !== null;

    // --from: fetch from registry and copy source files into DIR
    if (fromRef) {
      const cfgMod = await _configCmd();
      const resolveGithubToken = cfgMod.resolveGithubToken;

      const fetchFrom = async (active: string | null): Promise<[Any, string]> => {
        const client = new RegistryClient("https://github.com", active);
        const ref = await client.resolve(fromRef);
        if (ref.is_builtin) {
          throw usageError(
            `'${fromRef}' is a built-in template and cannot be used with --from. ` + "Use -t/--template for built-in cases.",
          );
        }
        return [ref, await out.spinner(`Fetching template from ${fromRef}`, () => client.fetch(ref))];
      };

      const [ref, sourcePath] = await _withGithubRateLimitRetry(fetchFrom, { token: await resolveGithubToken(), fmt, out });

      const source = String(sourcePath);

      // A local directory with no manifest is a source project, not a template. Copying it would also copy .env and
      // .git. Remote refs stay tolerant.
      if ((ref.registry_type ?? "") === "local" && _findTemplateYaml(source) === null) {
        throw new CliError(
          `'${fromRef}' has no template.yaml, so it is not a template. ` + `To adapt a source project, run: abx template scaffold --adopt ${fromRef}`,
        );
      }

      // Derive name: --name > template.yaml name > ref basename
      if (name === null) {
        const yamlPath = _findTemplateYaml(source);
        if (yamlPath) {
          const tmpl = loadTemplateFromYaml(yamlPath);
          name = tmpl.name || "";
        }
        if (!name) {
          // Fallback: repo basename or last path component
          if (ref.path) {
            const stripped = (ref.path as string).replace(/\/+$/, "");
            name = stripped.slice(stripped.lastIndexOf("/") + 1);
          } else {
            name = ref.repo || nodePath.basename(fromRef);
          }
        }
      }
      if (!name) throw new Error("");

      // Resolve target directory
      const target = dirProvided ? pyResolve(directory as string) : pyJoin(process.cwd(), name);

      const conflicts = await confirmTemplateWrites(target, scandirNames(source), force, yes, fmt, out);
      mkdirParents(target);
      pyCopytree(source, target);
      out.info(`Template files copied from ${fromRef} to ${target}`);
      const created = fs
        .readdirSync(target)
        .filter((f) => isFile(nodePath.join(target, f)));
      _printInitSummary(fmt, out, target, created, name, conflicts.length ? { replaced: conflicts } : {});
      return;
    }

    // Interactive selection when no --template/--from given
    if (caseName === null) {
      const cases = availableCases();
      if (templateSeams._scaffoldPickerAvailable(fmt)) {
        caseName = await _selectScaffoldCase(cases);
      } else {
        const caseNames = cases.map(([c]) => c).join(", ");
        throw usageError(`No scaffold case specified. Available cases: ${caseNames}. ` + "Use -t/--template <case> or --from <ref>.");
      }
    }

    // Derive name: --name > case name > "my-template"
    if (name === null) {
      name = caseName || "my-template";
    }

    // Resolve target directory
    const target = dirProvided ? pyResolve(directory as string) : pyJoin(process.cwd(), name);

    const result = await writeBuiltinScaffold(ctx, { directory: target, caseName: caseName as string, name, force, yes });
    _printInitSummary(fmt, out, target, result.created, name, result.replaced.length ? { replaced: result.replaced } : {});
  }),
});

/** Print a friendly summary after scaffold init. */
export function _printInitSummary(fmt: Any, out: Any, target: string, created: string[], name: string, opts: {
    replaced?: string[] | null;
    backed_up?: string[] | null;
    not_applied?: string[] | null;
    dry_run?: boolean;
    next_steps?: string[] | null;
} = {}): void {
    const { replaced = null, backed_up = null, not_applied = null, dry_run = false, next_steps = null } = opts;
    if (fmt.use_json) {
        const payload: Record<string, Any> = { name, directory: String(target), files: created };
        if (replaced !== null)
            payload["replaced"] = replaced;
        if (backed_up !== null)
            payload["backed_up"] = backed_up;
        if (not_applied !== null)
            payload["not_applied"] = not_applied;
        if (dry_run)
            payload["dry_run"] = true;
        fmt.printData(payload);
        return;
    }
    const title = dry_run ? "previewed" : "created";
    out.info(`\n\u2705 Template '${name}' ${title} in ${target}`);
    out.info("Created files:");
    for (const filename of [...created].sort(_codePointCompare)) {
        out.info(`  ${filename}`);
    }
    if (replaced && replaced.length > 0) {
        out.info("Replaced files:");
        for (const filename of replaced) {
            out.info(`  ${filename}`);
        }
    }
    if (backed_up && backed_up.length > 0) {
        out.info("Backups:");
        for (const filename of backed_up) {
            out.info(`  ${filename}`);
        }
    }
    if (not_applied && not_applied.length > 0) {
        out.info("Generated changes not applied:");
        for (const filename of not_applied) {
            out.info(`  ${filename}`);
        }
    }
    out.info("\nNext steps:");
    if (next_steps !== null) {
        for (const step of next_steps) {
            out.info(`  ${step}`);
        }
        return;
    }
    const dirArg = String(target) !== process.cwd() ? String(target) : ".";
    out.info(`  abx template deploy ${dirArg} -y`);
    const profile = resolveTemplateProfile();
    if (profile.registry) out.info(`  # ${profile.registry}`);
}

export /** Python `sorted()` order for strings (code point order, not UTF-16 unit order). */
function _codePointCompare(a: string, b: string): number {
    const ca = Array.from(a);
    const cb = Array.from(b);
    const n = Math.min(ca.length, cb.length);
    for (let i = 0; i < n; i++) {
        const x = (ca[i] as string).codePointAt(0) as number;
        const y = (cb[i] as string).codePointAt(0) as number;
        if (x !== y)
            return x - y;
    }
    return ca.length - cb.length;
}
export const templateSeams: {
    _githubRateLimitSetupAvailable: typeof _githubRateLimitSetupAvailable;
    _offerGithubTokenSetup: typeof _offerGithubTokenSetup;
    _tryArrowCasePicker: (cases: Array<[
        string,
        string
    ]>) => Promise<string | null>;
    _scaffoldPickerAvailable: (fmt: Any) => boolean;
    isCiEnv: () => boolean;
    stdinIsatty: () => boolean;
} = {
    _githubRateLimitSetupAvailable: (...a) => _githubRateLimitSetupAvailable(...a),
    _offerGithubTokenSetup: (...a) => _offerGithubTokenSetup(...a),
    _tryArrowCasePicker: (...a) => _tryArrowCasePicker(...a),
    _scaffoldPickerAvailable: (...a) => _scaffoldPickerAvailable(...a),
    isCiEnv: () => isCiEnv(),
    stdinIsatty: () => isatty(sys.stdin)
};

export async function _resolveIndexName(name: string, opts: { token: string | null; fmt: Any; out: Any }): Promise<string> {
  const { token, fmt, out } = opts;
  let index = await fetchIndex(null, { token });
  let entry = index.find(name);
  if (entry === null && !index.stale) {
    // The cache may predate a freshly published template - refresh once.
    index = await fetchIndex(null, { token, force: true });
    entry = index.find(name);
  }
  if (index.notice) out.warning(index.notice);
  if (entry === null) {
    throw new TemplateNotFoundError(
      `Template '${name}' is not a built-in template and was not found in the ` + `template index (${index.source_url}).`,
      {
        suggestion:
          "Run 'abx template search <query>' to browse the index, or install " +
          "directly from a repository: 'abx template install owner/repo//subdir[@ref]'.",
      },
    );
  }
  fmt.printSuccess(`Resolved '${name}' via the template index: ${entry.install_ref}`);
  return entry.install_ref;
}

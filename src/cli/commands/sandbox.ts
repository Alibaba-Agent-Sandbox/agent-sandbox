import { canGuideConfiguration, withGuidedConfiguration } from "../config_guidance.js";
/**
 * Sandbox lifecycle CLI commands: create, list, info, kill, exec, connect, upload, download (port of
 * `cli/commands/sandbox.py`).
 *
 * Port notes:
 *
 * - Python's `run_sync(...)` bridge does not exist: every command awaits the SDK directly. The Python tests that patch
 *   `run_sync` / `Sandbox.create` / `Sandbox.connect` spy on `Sandbox.create` / `Sandbox.connect` instead (module
 *   exports are read at call time, so `vi.spyOn(Sandbox, "connect")` and `vi.spyOn(transportConfig, "loadConfig")`
 *   intercept them).
 * - Python's module-level `sys` / `os.access` (patched by the tests to fake a TTY or an unwritable directory) are the
 *   {@link sandboxSeams} object.
 * - Context managers (`with out.activity(...) as update`) become callbacks: {@link _phaseStatus} takes the body as a
 *   function.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

import { ClarifyOutcome } from "../../agent/clarify.js";
import * as clarify from "../../agent/clarify.js";
import type { CodingAgentBackend } from "../../agent/coding_agent.js";
import { defaultGeneratedDir } from "../../agent/codegen.js";
import { dumpYaml, isMapping, loadYaml } from "../../utils/yaml_io.js";
import { pyPathStr } from "../../agent/_pycompat.js";
import { shlexQuote } from "../../api/_shlex.js";
import { Sandbox } from "../../api/sandbox.js";
import { type Option, Context, argument, command, group, option } from "../kit.js";
import { Choice, FLOAT, INT, Path } from "../types.js";
import { Abort, CliError, EOFError, KeyboardInterrupt, SystemExit, UsageError, sysExit } from "../errors.js";
import { echo, sys } from "../io.js";
import { confirm, prompt } from "../prompts.js";
import { cpSlice } from "../../utils/_py.js";
import { CommandNotFoundError, DescriptionClarificationError, ExecutionError } from "../../models/errors.js";
import { ProcessChunkType, type CommandResult } from "../../models/process.js";
import { SandboxStatus, validateVolumeMounts } from "../../models/sandbox.js";
import { ProviderFeatureNotSupportedError } from "../../models/provider_errors.js";
import { loadLayeredConfig } from "../../transport/config_layers.js";
import { getProvider } from "../../providers/registry.js";
import { providerCliExtension } from "../provider_extensions.js";
import { getLogger } from "../../utils/logging.js";
import { PyFloat, pyRepr, pyStr, pyStrip } from "../../utils/_pyformat.js";
import { formatFixed0 } from "../../agent/_pycompat.js";
import { isDir, isFile, mkdirParents, pathExists, pyExpandUser, pyJoin, pyResolve, readTextPy, rglobAll, toOSError, writeTextPy } from "../../utils/_pyos.js";
import { getFormatter, type OutputFormatter } from "../formatters.js";
import { handleErrors } from "../error_handler.js";
import { enableVerbose, getOutput, type OutputManager } from "../output.js";
import { REPL_TIMEOUT, describeCommandFailure, enableLineEditing, input, inputInterrupts, programName } from "../repl.js";
import { regionOption } from "../region.js";
import { printedId, providerView, scopedFlagOptions } from "../provider_view.js";
import { providersInUse } from "../../providers/in_use.js";
import * as providerRegistry from "../../providers/registry.js";
import { ValueError } from "../../models/value_error.js";
import type { BuildMode } from "../../template/build_plan.js";
import { withTemplateEnvironment, applicationToken } from "../template_environment.js";
import { executeTemplateLaunch, type TemplateLaunchResult } from "../template_launch.js";
import { files } from "./sandbox_files.js";
import { process as process_ } from "./sandbox_process.js";
import { capabilities, system } from "./sandbox_system.js";

getLogger("cli.commands.sandbox");

/** Patch points (the TypeScript counterparts of the module attributes the Python tests monkeypatch). */
export const sandboxSeams: {
  /** `sys.stdin.isatty()` of the Python module (`monkeypatch.setattr("...commands.sandbox.sys", _FakeSys())`). */
  stdinIsatty: () => boolean;
  /** `os.access(path, os.W_OK)`. */
  access: (path: string) => boolean;
} = {
  stdinIsatty: () => sys.stdin.isatty(),
  access: (p) => {
    try {
      fs.accessSync(p, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Help texts (the Python docstrings, verbatim; cleaned with `cleandoc`)
// ---------------------------------------------------------------------------------------------------------------------

const CREATE_HELP = `Create a new sandbox.

    'abx create' is the shortcut of 'abx sandbox create'. A positional argument
    selects a template; the default is base. Natural language uses --prompt.

    \b
      abx create base                        launch the base template
      abx create code-interpreter-v1         launch an existing template
      abx create --prompt "DESCRIPTION"      generate a template, build and launch

    --prompt and an explicit template cannot be combined.

    --timeout is the sandbox lifetime in seconds (default: 300).

    \b
    Examples:
      abx create base              # explicit 'base' template
      abx create -e API_KEY=xxx -e DEBUG=1    # inject env vars
      abx create --upload ./app --timeout 600 # upload dir, 10-min lifetime
      abx create --prompt "a python data science env"  # generate, build, deploy, create
      abx create -y --prompt "a node.js api server"    # non-interactive full pipeline
      abx create -y --detach --build steps --prompt "a Python data analysis API"
      abx template scaffold --prompt "a python data science env"  # template files only

    \b
    Notes:
      Template generation needs the Qwen Code CLI and a DashScope/ModelStudio
      key ('abx config init --llm'); building and deploying also needs
      'abx config init --build'. It researches publicly verifiable facts
      itself (tool stack, official install method, common dependencies) and
      only asks for private preferences or business decisions it cannot
      infer — one question at a time in interactive sessions. Non-interactive
      shells must pass --yes to generate without asking. Interactive
      sessions are asked up front whether to switch to template init,
      which writes Dockerfile, commands.py, and template.yaml and stops
      before build, push, deploy, and sandbox create. --yes skips that
      question and runs the full pipeline.
      New generated applications require ABX_SERVER_TOKEN in the environment (or -e).
      It is injected at runtime; generation-only does not require a token.
      --detach is accepted on this path: generated sandboxes already return
      without opening a terminal. --build steps uses platform build steps
      instead of local Docker/ACR; the default build path stays unchanged.

    \b
    Related commands:
      abx list                 List existing sandboxes
      abx info SANDBOX_ID      Inspect a created sandbox
      abx template scaffold DIR    Scaffold a new template project (local)
      abx template scaffold --prompt "DESC" Generate a template only (no build)
      abx template search KEY  Find reusable templates
      abx config init          Set credentials and region
    `;

const LIST_HELP = `List sandboxes, optionally filtered by lifecycle status.

    \b
    Examples:
      abx list
      abx list --status running
      abx list --status error --limit 50
      abx list --region cn-shanghai

    \b
    Related commands:
      abx info SANDBOX_ID  Show one sandbox in detail
      abx create           Create a new sandbox
      abx kill SANDBOX_ID  Destroy a sandbox
    `;

const INFO_HELP = `Show status, template, region, timeout, and URL for a sandbox.

    \b
    Examples:
      abx info abc123
      abx --json info abc123

    \b
    Related commands:
      abx list                  Find sandbox IDs
      abx sandbox capabilities  Show declared capability groups
      abx exec SANDBOX_ID -- CMD  Run a command in the sandbox
    `;

const KILL_HELP = `Permanently destroy one sandbox or all running sandboxes.

    Confirmation is required unless --yes is supplied. Use --yes for scripts
    and other non-interactive environments.

    \b
    Examples:
      abx kill abc123
      abx kill abc123 --yes
      abx kill --all --yes
      abx kill --all --yes --region cn-shanghai

    \b
    Related commands:
      abx list              Find running sandbox IDs
      abx info SANDBOX_ID   Verify a sandbox before deletion
      abx create            Create a replacement sandbox
    `;

const EXEC_HELP = `Run a command in a sandbox.

    'abx exec' is the shortcut of 'abx sandbox exec'.

    Put the command after \`\`--\`\`: it is run exactly as given (no shell).
    A single quoted argument is read as a command line, so pipes and
    redirects work; use \`\`sh -c '...'\`\` for variable expansion.

    By default the command runs to completion and abx exits with its remote
    exit code. \`\`--stream\`\` prints stdout/stderr live while it runs;
    \`\`--background\`\` starts it, prints the pid and returns at once.

    \b
    Examples:
      abx exec abc123 -- python --version
      abx exec abc123 --cwd /app --timeout 300 -- pytest -q
      abx exec abc123 --env DEBUG=1 -- python app.py
      abx exec abc123 --stream -- pip install numpy
      abx exec abc123 --background -- python -m http.server 8000
      abx exec abc123 "ls /app | wc -l"
      abx --json exec abc123 -- echo ready

    \b
    Related commands:
      abx connect SANDBOX_ID                  Open the command REPL
      abx sandbox process list SANDBOX_ID     Find a background process
      abx run SANDBOX_ID NAME                 Run a named command registered in the sandbox
    `;

const CONNECT_HELP = `Open an interactive command REPL for a sandbox.

    'abx connect' is the shortcut of 'abx sandbox connect'.

    This is a line-based REPL, not a PTY: every line you enter runs in a new
    process with a 30-second timeout, so \`\`cd\`\`, environment variables and
    aliases do not survive between lines (use \`\`cd /path && <cmd>\`\` on one
    line, or \`\`abx exec --cwd\`\`, instead).

    On interactive terminals basic line editing and command history are
    enabled (Up/Down history, Ctrl+R search, Ctrl+A/E and friends).  Type
    \`\`exit\`\`/\`\`quit\`\` or press Ctrl+D to leave; Ctrl+C also disconnects.
    Failed commands are reported as one friendly message - never as raw
    HTTP errors.

    \b
    Examples:
      abx connect abc123

    \b
    Related commands:
      abx exec SANDBOX_ID -- CMD  Run one command with a custom timeout
      abx info SANDBOX_ID         Inspect connection details
    `;

const UPLOAD_HELP = `Upload a local file or directory to the sandbox.

    Examples:

        abx upload abc123 ./script.py /app/script.py

        abx upload abc123 ./data/ /app/data/

    \b
    Related commands:
      abx download SANDBOX_ID REMOTE_PATH LOCAL_PATH
      abx sandbox files list SANDBOX_ID --path /app
      abx exec SANDBOX_ID -- CMD
    `;

const DOWNLOAD_HELP = `Download a file from the sandbox to local.

    Examples:

        abx download abc123 /app/result.csv ./result.csv

        abx download abc123 /app/output.log .

    \b
    Related commands:
      abx upload SANDBOX_ID LOCAL_PATH REMOTE_PATH
      abx sandbox files stat SANDBOX_ID --path REMOTE_PATH
      abx sandbox files list SANDBOX_ID --path REMOTE_DIR
    `;

const RUN_HELP = `Run a named command registered in the sandbox.

    'abx run' is the shortcut of 'abx sandbox command run'.

    Named commands are functions the template registers on the SandboxServer
    that runs inside the sandbox (\`\`POST /commands/NAME\`\`). List them with
    'abx sandbox command list SANDBOX_ID'. Arguments are validated and
    converted by the server according to the registered signature.

    Pass arguments with --arg KEY=VALUE (repeatable) and/or --json-args
    '{"key": value}' for typed values. The command's return value is printed
    (JSON with --json). Fails with a clear error when the sandbox has no
    server.

    \b
    Examples:
      abx run abc123 build
      abx run abc123 test --arg file=tests/
      abx run abc123 add --json-args '{"x": 1, "y": 2}'
      abx --json run abc123 greet --arg name=Ada

    \b
    Related commands:
      abx sandbox command list SANDBOX_ID   List the registered commands
      abx exec SANDBOX_ID -- CMD            Run an arbitrary command
      abx info SANDBOX_ID                   Inspect the target sandbox
    `;

const COMMAND_GROUP_HELP = `List and run the named commands registered in a sandbox.

    The commands come from the SandboxServer running inside the sandbox
    (CommandRegistry; \`\`GET /commands\`\`, \`\`POST /commands/NAME\`\`). A sandbox
    without a server has none.

    \b
    Examples:
      abx sandbox command list abc123
      abx sandbox command run abc123 build --arg target=release

    \b
    Related commands:
      abx run SANDBOX_ID NAME    Shortcut for 'sandbox command run'
      abx exec SANDBOX_ID -- CMD Run an arbitrary command
    `;

const COMMAND_LIST_HELP = `List the named commands registered in a sandbox.

    Shows each command's name, argument signature and description, read from
    the SandboxServer in the sandbox. Errors when no server is reachable.

    \b
    Examples:
      abx sandbox command list abc123
      abx --json sandbox command list abc123

    \b
    Related commands:
      abx run SANDBOX_ID NAME    Run one of them
      abx sandbox capabilities SANDBOX_ID
    `;

const SANDBOX_HELP = `Manage sandboxes: lifecycle, files, processes, named commands, system details.

    create, list, info, kill, exec, connect, upload and download are also
    available as top-level shortcuts (abx create, abx list, ...), and
    'sandbox command run' as 'abx run'.

    \b
    Examples:
      abx sandbox create --template base
      abx sandbox list --status running
      abx sandbox system info abc123

    \b
    Related commands:
      abx sandbox files --help    Inspect and modify remote files
      abx sandbox process --help  Inspect and signal processes
      abx sandbox command --help  Run commands registered in the sandbox
      abx sandbox system --help   Inspect runtime system details
    `;


// ---------------------------------------------------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Minimum HTTP timeout (seconds) for the sandbox-create call. Cold starts routinely exceed the 30s transport default
 * -- even when the user has configured a custom http_timeout in ~/.abx/config.toml, we enforce this floor so that a
 * small configured value doesn't silently kill create.
 */
export const _CREATE_REQUEST_TIMEOUT_FLOOR = 120.0;

/** How many file/status lines a live progress block keeps. The display itself shows only the last `ABX_ACTIVITY_LINES` (default 6). */
export const _PROGRESS_NOTE_LIMIT = 10;

/**
 * Return a callback that keeps the last `limit` lines for `update`.
 *
 * `null` (quiet, JSON, CI, non-TTY) drops every line. Callers must pass names and counters only -- never file bytes,
 * tokens, or tool input.
 */
export function _rollingNote(update: ((summary: string) => void) | null, limit: number = _PROGRESS_NOTE_LIMIT): (text: string) => void {
  const feed: string[] = [];
  return (text: string): void => {
    const cleaned = pyStrip(text);
    if (update === null || !cleaned) return;
    feed.push(cleaned);
    feed.splice(0, Math.max(0, feed.length - limit));
    update(feed.join("\n"));
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// AI template generation helpers for `abx create --prompt "<description>"`
//
// The pipeline talks to a pluggable coding-agent backend (see `agent/coding_agent.ts`); Qwen Code is the only shipped
// backend today, so every default message stays byte-identical to the Qwen Code wording. Backend resolution, binary
// install/repair, and credential resolution are shared with the agent-driven deploy route and live in
// `./_coding_agent.ts`.
// ---------------------------------------------------------------------------------------------------------------------

type ActivityUpdate = ((summary: string) => void) | null;

/**
 * Phase status for the clarification / generation flow.
 *
 * Interactive TTY: an animated spinner on **stderr** (never stdout) with the `message... 12s` header, and below it the
 * agent's last six activity lines in grey (`ABX_ACTIVITY_LINES`, 1–10) that scroll line by line -- its
 * recent text and a short redacted tool detail (command, url, query, or path). File bytes, thinking, and
 * credentials stay hidden. `--verbose` keeps the same block as a self-erasing one that log output is written around.
 * Every other mode (non-TTY, `--json`): one machine-readable progress line on
 * stderr; quiet and CI stay silent. stdout is never touched in any mode.
 *
 * `body` receives the `update(summary)` callable to hand to the agent as `onActivity`, or `null` when no live line is
 * drawn.
 */
export async function _phaseStatus<T>(
  out: Pick<OutputManager, "progress" | "quiet" | "activity" | "useLiveStatus">,
  message: string,
  body: (update: ActivityUpdate) => T | Promise<T>,
): Promise<T> {
  if (!out.useLiveStatus && !out.quiet) out.progress(message);
  return out.activity(message, (update) => body(update));
}

/**
 * `{ onActivity: update }` when there is a live line to feed, else `{}`.
 *
 * Python inspected the backend method's signature and dropped `on_activity` for third-party / test backends that predate
 * it; a JavaScript function cannot be introspected that way, and the extra option is simply ignored by such backends.
 */
export function _activityKwargs(_method: unknown, update: ActivityUpdate): { onActivity?: (summary: string) => void } {
  if (update === null) return {};
  return { onActivity: update };
}

/** Python `f"{value:.0%}"`. */
function _percent(value: number): string {
  return `${formatFixed0(value * 100)}%`;
}

/**
 * Complete `description` through the research-first clarification loop.
 *
 * The research, the evaluation, and the questions all come from the coding agent itself, on ONE native session: round
 * 1 runs a plain research round (`backend.research` -- the agent settles publicly verifiable facts with its own tools
 * before anything is asked) followed by the structured assessment (`backend.assess` with `--json-schema`); every
 * following round resumes the same session (`--resume`) with one user answer, so the model keeps the description, the
 * research summary, and every Q/A pair in its own memory.
 *
 * Agent Sandbox keeps only its own surface:
 *
 * - the single question per round, numbered `Question 1`, `Question 2`, ... with **no total shown** -- the internal
 *   round cap is a safety bound, mentioned only when reached;
 * - the 80% threshold gate (our verdict, not the model's);
 * - delegation answers ("你自己决定" / "you decide") -- the follow-up prompt instructs the agent to settle the delegated
 *   choice itself;
 * - anti-repetition -- asked questions are embedded in every follow-up prompt, and an exactly-repeated question breaks
 *   the loop;
 * - non-interactive fail-fast with the missing details + example;
 * - research stays fail-open -- a failed round only warns (with the outcome's stable `reason` hint when the backend
 *   provides one) and the assessment continues;
 * - degradation to direct generation when the assessment is unavailable.
 *
 * All phase status (assessing / re-assessing / generating) renders on **stderr only** (spinner on TTY, machine-readable
 * progress lines otherwise); stdout stays clean and the model's research output is never echoed.
 *
 * Returns a `ClarifyOutcome`; a non-empty `sessionId` means generation should resume that session.
 */
export async function _clarifyRequirements(
  ctx: Context,
  description: string,
  opts: {
    yes: boolean;
    workdir: string;
    binary: unknown;
    env: Record<string, string>;
    backend: CodingAgentBackend;
  },
): Promise<ClarifyOutcome> {
  const { yes, workdir, env, backend } = opts;
  const binary = opts.binary as string;
  const fmt = getFormatter(ctx);
  const out = getOutput(ctx);

  if (yes) return new ClarifyOutcome({ skipped: true });

  const interactive = sandboxSeams.stdinIsatty() && canGuideConfiguration(ctx, yes) && !fmt.use_json;
  let sessionId = clarify.newSessionId();
  const asked: string[] = [];

  const failureHint = (assessment: clarify.ClarifyAssessment): string => {
    const parts = [`Missing details: ${assessment.missingSummary()}.`];
    if (assessment.example) parts.push(`Example description: "${assessment.example}".`);
    parts.push(
      DescriptionClarificationError.suggestion,
    );
    return parts.join(" ");
  };

  const warnIncomplete = (assessment: clarify.ClarifyAssessment): void => {
    out.warning(
      `Description is about ${_percent(assessment.completeness)} complete; ` +
        `missing: ${assessment.missingSummary()}. Generating anyway.`,
    );
    if (assessment.example) out.info(`Example description: "${assessment.example}"`);
  };

  const researchHints: Record<string, string> = {
    [clarify.RESEARCH_REASON_TIMEOUT]:
      "The research round timed out; retry, or continue \u2014 the assessment " + "still applies safe defaults.",
    [clarify.RESEARCH_REASON_AGENT_UNAVAILABLE]: "Template generation could not be started; check that the Qwen Code CLI runs, then retry.",
    [clarify.RESEARCH_REASON_COMMAND_FAILED]: "The Qwen Code command failed; re-run with --verbose to inspect its output.",
    [clarify.RESEARCH_REASON_TURN_LIMIT]:
      "The research used up its step budget; continuing \u2014 the assessment " + "still applies safe defaults.",
  };

  const researchFailureWarning = (research: unknown): string => {
    // Show the stable reason; omit the detailed research output from concise warnings.
    const message =
      `${backend.displayName} could not research the public facts ` +
      "behind the description; continuing with the assessment " +
      "(safe defaults apply where facts are missing).";
    const reason = (research as { reason?: unknown } | null)?.reason ?? "";
    const hint = typeof reason === "string" && Object.hasOwn(researchHints, reason) ? researchHints[reason] : undefined;
    return hint ? `${message} ${hint}` : message;
  };

  // ---- Round 1: research the public facts, then assess (one session) ----
  const research = await _phaseStatus(out, "Researching public facts", (update) =>
    backend.research(clarify.researchPrompt(description), {
      workdir,
      binary,
      env,
      sessionId,
      ..._activityKwargs(backend.research, update),
    }),
  );
  const researched = research.ok;
  if (!researched) {
    out.warning(researchFailureWarning(research));
    // The failed round may already have created `sessionId` in the agent (it rejects re-pinning an existing id with
    // "Session Id ... is already in use"), so the assessment starts a fresh session.
    sessionId = clarify.newSessionId();
  }
  let assessment = await _phaseStatus(out, "Assessing description", (update) =>
    backend.assess(clarify.assessmentPrompt(description), {
      workdir,
      binary,
      env,
      resume: researched ? sessionId : null,
      sessionId: researched ? null : sessionId,
      ..._activityKwargs(backend.assess, update),
    }),
  );
  if (assessment === null) {
    out.warning(
      `Could not assess the description completeness with ` +
        `${backend.displayName} (assessment unavailable); continuing ` +
        "straight to generation.",
    );
    return new ClarifyOutcome({ degraded: true });
  }

  if (assessment.complete) return new ClarifyOutcome({ sessionId, assessment });

  if (!interactive) {
    // Non-TTY / JSON / CI: never block -- fail fast with the missing details and a ready-to-use example.
    throw new DescriptionClarificationError(
      `The description is about ${_percent(assessment.completeness)} complete ` +
        `(minimum ${_percent(clarify.CLARITY_THRESHOLD)}) and this session cannot ` +
        "ask clarifying questions.",
      { suggestion: failureHint(assessment) },
    );
  }

  // ---- Interactive: one question per round, same native session ----
  out.info(
    `Description is about ${_percent(assessment.completeness)} complete. ` +
      "I'll ask for the missing details one question at a time \u2014 " +
      "press Enter to cancel.",
  );
  let rounds = 0;
  let repeated = false;
  for (let roundNumber = 1; roundNumber <= clarify.MAX_CLARIFY_ROUNDS; roundNumber++) {
    const question = assessment.question;
    if (question === null) break; // the model has nothing left to ask
    if (asked.includes(question)) {
      // defensive net behind the prompt rule
      repeated = true;
      break;
    }
    asked.push(question);
    let answer: string;
    try {
      answer = await prompt(`Question ${roundNumber}: ${question}`, { default: "", show_default: false, err: true });
    } catch (exc) {
      if (exc instanceof Abort || exc instanceof EOFError) {
        throw new DescriptionClarificationError("Clarification was interrupted (EOF) before the description was complete.", {
          suggestion: failureHint(assessment),
        });
      }
      throw exc;
    }
    if (!pyStrip(answer)) {
      throw new DescriptionClarificationError("Clarification was cancelled; no template was generated.", {
        suggestion: failureHint(assessment),
      });
    }
    rounds = roundNumber;
    const next: clarify.ClarifyAssessment | null = await _phaseStatus(out, "Re-assessing description", (update) =>
      backend.assess(clarify.answerPrompt(answer, asked), {
        workdir,
        binary,
        env,
        resume: sessionId,
        ..._activityKwargs(backend.assess, update),
      }),
    );
    if (next === null) {
      out.warning("The clarification assessment became unavailable; continuing " + "straight to generation.");
      return new ClarifyOutcome({ sessionId, degraded: true, rounds });
    }
    assessment = next;
    if (assessment.complete) {
      out.info(`Description is now about ${_percent(assessment.completeness)}; generating.`);
      break;
    }
  }

  if (!assessment.complete) {
    if (repeated) {
      out.warning("The generator repeated an already-answered question; generating " + "with the information collected.");
    } else if (rounds >= clarify.MAX_CLARIFY_ROUNDS) {
      out.info(`Reached the ${clarify.MAX_CLARIFY_ROUNDS}-question safety ` + "limit; generating with the information collected.");
    }
    warnIncomplete(assessment);
  }
  return new ClarifyOutcome({ sessionId, assessment, rounds });
}

/** `Path(...).parent` loop of the directory validators: the nearest existing ancestor of `target`. */
function _nearestExisting(target: string): string {
  let existing = target;
  while (!pathExists(existing) && existing !== nodePath.dirname(existing)) existing = nodePath.dirname(existing);
  return existing;
}

/**
 * Resolve where the generated template workspace is created (`--dir`).
 *
 * The returned path is the **parent** directory: a fresh `<slug>-<timestamp>-<token>` subdirectory is created inside
 * it, so a previous generation (or the user's own files) is never overwritten and the SDK wheel that the image build
 * copies in stays inside that subdir.
 *
 * - `--dir` given -> used as is;
 * - not given, `ask` is true, and the session is an interactive terminal (not `--yes` / `--json`) -> one prompt whose
 *   default is the standard location, so Enter accepts it;
 * - otherwise -> `null` (the standard `~/.abx/generated`).
 *
 * Nothing is created here: the path is only validated (it must be, or be creatable under, a writable directory).
 *
 * @throws UsageError The path is a file, cannot be created, or is not writable.
 */
export async function _resolveOutputDir(
  ctx: Context,
  outputDir: string | null,
  opts: { yes: boolean; ask: boolean },
): Promise<string | null> {
  const defaultDir = defaultGeneratedDir();
  let chosen = outputDir;
  if (chosen === null) {
    const fmt = getFormatter(ctx);
    if (!opts.ask || !canGuideConfiguration(ctx, opts.yes) || fmt.use_json || !sandboxSeams.stdinIsatty()) return null;
    const home = os.homedir();
    let shown = String(defaultDir);
    if (shown.startsWith(home)) shown = "~" + shown.slice(home.length);
    chosen = await prompt("Save the generated template under which directory?", { default: shown, err: true });
  }
  chosen = pyStrip(chosen as string) || String(defaultDir);
  const target = pyResolve(pyExpandUser(chosen));
  if (target === pyResolve(String(defaultDir)) && outputDir === null) return null;
  if (pathExists(target) && !isDir(target)) throw new UsageError(`--dir ${pyRepr(chosen)} exists and is not a directory.`);
  // Validate only. The directory is created by the generation step itself (`prepareWorkdir`), so an answer typed at the
  // wrong prompt -- or a run cancelled before generation -- never leaves stray directories behind.
  const existing = _nearestExisting(target);
  if (!isDir(existing)) throw new UsageError(`Cannot create --dir ${pyRepr(chosen)}: ${existing} is not a directory.`);
  if (!sandboxSeams.access(existing)) {
    const where = existing === target ? "is" : `cannot be created: ${existing} is`;
    throw new UsageError(`--dir ${pyRepr(chosen)} ${where} not writable.`);
  }
  return target;
}

function _modelInUse(creds: { asEnv(): Record<string, string> }): string {
  return creds.asEnv().OPENAI_MODEL || "qwen3-coder-plus";
}

export function _withModelHint(exc: unknown, creds: { asEnv(): Record<string, string> }): unknown {
  const model = _modelInUse(creds);
  const suggestion =
    `The endpoint rejected model '${model}'. ` +
    "Pass a model this key can call: abx create --prompt \"<description>\" --model <id> " +
    "(or abx template scaffold --model <id>). " +
    "Persist it with: abx config set llm_model <id>. " +
    "ABX_LLM_MODEL and OPENAI_MODEL also work.";
  if (exc !== null && typeof exc === "object" && "suggestion" in exc) {
    (exc as { suggestion: string }).suggestion = suggestion;
  }
  return exc;
}

export async function _pickReplacementModel(
  ctx: Context,
  creds: { asEnv(): Record<string, string>; apiKey?: string; baseUrl?: string },
): Promise<string | null> {
  const qwenCode = await import("../../agent/qwen_code.js");
  const apiKey = creds.apiKey ?? "";
  const baseUrl = creds.baseUrl || qwenCode._DEFAULT_OPENAI_BASE_URL;
  const ids = apiKey ? await qwenCode.listCompatibleModels(baseUrl, apiKey) : [];
  const ranked = qwenCode.rankCodegenModels(ids);
  const out = getOutput(ctx);
  if (ranked.length === 0) {
    out.warning("No coding or chat model was listed. Type a model id, or press Enter to stop.");
    const typed = pyStrip(await prompt("Model id", { default: "", show_default: false, err: true }));
    return typed || null;
  }
  try {
    const inquirer = await import("@inquirer/prompts");
    const choices = [
      ...ranked.map((id) => ({ name: id, value: id })),
      { name: "Other model id…", value: "__other__" },
    ];
    const answer = await inquirer.select({
      message: "Select a model (up/down, Enter)",
      choices,
      default: ranked[0],
    }, { output: process.stderr });
    if (answer === "__other__") {
      const typed = pyStrip(await prompt("Model id", { default: "", show_default: false, err: true }));
      return typed || null;
    }
    return String(answer);
  } catch (exc) {
    const err = exc as { name?: string };
    if (err && (err.name === "ExitPromptError" || err.name === "AbortPromptError")) throw new Abort();
  }
  const shown = ranked;
  out.info("Models for template generation:");
  shown.forEach((id, index) => out.info(`  ${index + 1}. ${id}`));
  const answer = pyStrip(await prompt("Model id or list number", { default: "1", show_default: true, err: true }));
  if (!answer) return null;
  const index = Number(answer);
  if (Number.isInteger(index) && index >= 1 && index <= shown.length) return shown[index - 1] as string;
  return answer;
}

/**
 * Clarify `description` and generate the template files.
 *
 * The agent writes `Dockerfile`, the `commands.py` HTTP server entry point, and `template.yaml` (plus README / business
 * code).
 *
 * The description first goes through the single-question clarification loop ({@link _clarifyRequirements}), which runs
 * on the backend's native session (Qwen Code by default); generation then resumes that very session so the model keeps
 * the clarification context in its own memory.
 *
 * Returns the codegen result. Nothing is built, pushed, or deployed.
 */
export async function _generateTemplateWorkspace(
  ctx: Context,
  description: string,
  opts: { yes: boolean; output_dir?: string | null; ask_output_dir?: boolean; model?: string | null; buildMode?: BuildMode; baseImage?: string },
): Promise<any> {
  const { yes } = opts;
  const outputDir = opts.output_dir ?? null;
  const askOutputDir = opts.ask_output_dir ?? false;
  const codingAgent = await import("./_coding_agent.js");
  const qwenCode = await import("../../agent/qwen_code.js");

  const fmt = getFormatter(ctx);
  const out = getOutput(ctx);

  const backend = codingAgent.resolveCodingAgentBackend();
  const binary = await codingAgent.ensureCodingAgentBinary(ctx, { yes, backend });
  let modelOverride = opts.model ?? null;
  const credsFor = () => codingAgent.resolveCodingAgentCredentials(ctx, { yes, backend, model: modelOverride });
  let creds = await credsFor();
  // Decided before any agent call: sessions are keyed by the working directory, so it must exist (and never change) from
  // research onwards.
  const baseDir = await _resolveOutputDir(ctx, outputDir, { yes, ask: askOutputDir });
  let workdir: string;
  let templateName: string;
  if (baseDir === null) [workdir, templateName] = await backend.prepareWorkdir(description);
  else [workdir, templateName] = await backend.prepareWorkdir(description, { baseDir });

  const once = async (active: Awaited<ReturnType<typeof credsFor>>) => {
    const outcome = await _clarifyRequirements(ctx, description, {
      yes,
      workdir,
      binary,
      env: active.asEnv(),
      backend,
    });
    return _phaseStatus(out, "Generating template", (update) =>
      backend.generate(description, {
        workdir,
        templateName,
        resumeSession: outcome.sessionId || null,
        binary,
        env: active.asEnv(),
        onProgress: out.useLiveStatus ? null : (message: string) => out.progress(message),
        ...(opts.buildMode && opts.buildMode !== "auto" ? { buildMode: opts.buildMode } : {}),
        ...(opts.baseImage ? { baseImage: opts.baseImage } : {}),
        ..._activityKwargs(backend.generate, update),
      }),
    );
  };

  try {
    const gen = await once(creds);
    if (!fmt.use_json) {
      out.info("");
      out.info(`\u2713 Generated template: ${gen.templateName}`);
      out.info(`    Dockerfile:    ${gen.dockerfile}`);
      const commandsPy = (gen as { commandsPy?: string | null }).commandsPy ?? null;
      if (commandsPy !== null) out.info(`    commands.py:   ${commandsPy}`);
      out.info(`    template.yaml: ${gen.templateYaml}`);
    }
    return gen;
  } catch (exc) {
    const text = exc instanceof Error ? `${exc.message}\n${(exc as { suggestion?: string }).suggestion ?? ""}` : String(exc);
    if (!qwenCode.modelRejectedByEndpoint(text)) throw exc;
    if (modelOverride || !canGuideConfiguration(ctx, yes) || !sandboxSeams.stdinIsatty()) throw _withModelHint(exc, creds);
    const picked = await _pickReplacementModel(ctx, creds);
    if (!picked) throw _withModelHint(exc, creds);
    if (await confirm("Save this model for future generation commands?", { default: false, err: true })) {
      const configCmd = await import("./config_cmd.js");
      await configCmd.writeEnvVar("ABX_LLM_MODEL", picked);
      out.info("Saved llm_model in ~/.abx/.env. Change it later: abx config set llm_model");
    } else out.info("Using the selected model only for this command. Change the saved model later: abx config set llm_model");
    modelOverride = picked;
    creds = await credsFor();
    const gen = await once(creds);
    if (!fmt.use_json) {
      out.info("");
      out.info(`\u2713 Generated template: ${gen.templateName}`);
      out.info(`    Dockerfile:    ${gen.dockerfile}`);
      const commandsPy = (gen as { commandsPy?: string | null }).commandsPy ?? null;
      if (commandsPy !== null) out.info(`    commands.py:   ${commandsPy}`);
      out.info(`    template.yaml: ${gen.templateYaml}`);
    }
    return gen;
  }
}

/**
 * Copy the generated template into `./<name>/` and return `[dir, files]`.
 *
 * `--name` overrides both the directory and the `name` field in `template.yaml`. `directory`, when given, is the
 * project directory itself (the init prompt). Existing files in the target are left alone unless `force` is set.
 */
export function _materializeLocalTemplate(
  gen: any,
  opts: { name: string | null; force: boolean; directory?: string | null },
): [string, string[]] {
  const { name, force } = opts;
  const directory = opts.directory ?? null;
  const folder = name || gen.templateName;
  const target = directory !== null ? directory : pyResolve(pyJoin(process.cwd(), folder));
  // Every deliverable the agent produced (Dockerfile, commands.py server, template.yaml, README.md, business code, ...);
  // older results only carry the two deployment files.
  const generatedFiles = (gen.files ?? []) as readonly string[];
  const filenames: string[] = generatedFiles.length > 0 ? [...generatedFiles] : ["Dockerfile", "template.yaml"];
  if (target === pyResolve(String(gen.workdir))) {
    return [target, filenames.filter((fn) => isFile(pyJoin(target, fn)))];
  }

  mkdirParents(target);
  if (!force) {
    const conflicts = filenames.filter((fn) => pathExists(pyJoin(target, fn)));
    if (conflicts.length > 0) {
      throw new CliError(`Files already exist in ${target}: ${conflicts.join(", ")}. ` + "Use --force to overwrite.");
    }
  }
  for (const filename of filenames) {
    const destination = pyJoin(target, filename);
    mkdirParents(nodePath.dirname(destination));
    const source = pyJoin(String(gen.workdir), filename);
    let content: Buffer;
    try {
      content = fs.readFileSync(source);
    } catch (exc) {
      throw toOSError(exc, source);
    }
    try {
      fs.writeFileSync(destination, content);
    } catch (exc) {
      throw toOSError(exc, destination);
    }
  }
  if (name && name !== gen.templateName) _renameGeneratedTemplate(pyJoin(target, "template.yaml"), name);
  return [target, filenames];
}

/** Set the `name` field of a generated `template.yaml`. */
export function _renameGeneratedTemplate(templateYaml: string, name: string): void {
  const data = loadYaml(readTextPy(templateYaml));
  if (!isMapping(data)) return;
  data["name"] = name;
  writeTextPy(templateYaml, dumpYaml(data));
}

/** Shown as the default when the generated folder name is not known yet. */
export const _AUTO_PROJECT_DIR = "./<name>";

/**
 * Check `chosen` can become the template project. Do not create it.
 *
 * @throws UsageError The path is a file, or cannot be created under a writable directory.
 * @throws CliError The directory already holds template files and `force` is not set.
 */
export function _validateProjectDirectory(chosen: string, opts: { force: boolean }): string {
  const target = pyResolve(pyExpandUser(chosen));
  if (pathExists(target) && !isDir(target)) throw new UsageError(`${pyRepr(chosen)} exists and is not a directory.`);
  const existing = _nearestExisting(target);
  if (!isDir(existing) || !sandboxSeams.access(existing)) {
    throw new UsageError(`Cannot create ${pyRepr(chosen)}: ${existing} is not a writable directory.`);
  }
  if (pathExists(target) && !opts.force) {
    const conflicts = ["Dockerfile", "commands.py", "template.yaml"].filter((filename) => pathExists(pyJoin(target, filename)));
    if (conflicts.length > 0) {
      throw new CliError(`Files already exist in ${target}: ${conflicts.join(", ")}. ` + "Use --force to overwrite.");
    }
  }
  return target;
}

/**
 * Ask where `abx template scaffold --prompt "DESCRIPTION"` should write the project.
 *
 * Returns the chosen directory, or `null` to keep `./<name>/` (or `./<--name>/`). `--yes`, `--json`, and a
 * non-interactive terminal skip the prompt. Enter accepts the default. Nothing is created here.
 */
export async function _promptProjectDirectory(
  ctx: Context,
  opts: { yes: boolean; name: string | null; force: boolean },
): Promise<string | null> {
  const fmt = getFormatter(ctx);
  if (!canGuideConfiguration(ctx, opts.yes) || fmt.use_json || !sandboxSeams.stdinIsatty()) return null;
  const defaultDirectory = opts.name ? `./${opts.name}` : _AUTO_PROJECT_DIR;
  let chosen: string = await prompt("Directory for the template project", { default: defaultDirectory, err: true });
  chosen = pyStrip(chosen);
  if (!chosen || chosen === defaultDirectory || chosen === _AUTO_PROJECT_DIR) return null;
  return _validateProjectDirectory(chosen, { force: opts.force });
}

/**
 * Generate a local template project and stop.
 *
 * Shared by `abx template scaffold --prompt "DESCRIPTION"` and by the create-path switch that opts out of build, push, deploy, and
 * sandbox creation. `ask_directory` prompts for the project directory before generation (init). The create switch
 * keeps `./<name>/`.
 */
export async function _generateLocalTemplate(
  ctx: Context,
  description: string,
  opts: { yes: boolean; name?: string | null; force?: boolean; ask_directory?: boolean; model?: string | null; directory?: string | null },
): Promise<void> {
  const { yes } = opts;
  const name = opts.name ?? null;
  const force = opts.force ?? false;
  const askDirectory = opts.ask_directory ?? false;
  const template = await import("./template.js");

  const projectDir = opts.directory ? _validateProjectDirectory(opts.directory, { force }) : (askDirectory ? await _promptProjectDirectory(ctx, { yes, name, force }) : null);
  const gen = await _generateTemplateWorkspace(ctx, description, { yes, model: opts.model ?? null });
  const [target, created] = _materializeLocalTemplate(gen, { name, force, directory: projectDir });
  template._printInitSummary(getFormatter(ctx), getOutput(ctx), target, created, name || gen.templateName);
}

/**
 * Ask whether natural-language create should stop after the local template.
 *
 * `--yes` and `--json` keep the full create pipeline and do not ask. A non-interactive terminal gets a one-line reminder
 * and continues; the later build confirmation still applies. An interactive terminal must opt in -- the default is to
 * continue creating the sandbox.
 */
export async function _wantsTemplateOnly(ctx: Context, description: string, opts: { yes: boolean }): Promise<boolean> {
  const fmt = getFormatter(ctx);
  if (opts.yes || fmt.use_json) return false;

  const hint =
    "Natural-language create generates a template, then builds and pushes " +
    "the image, deploys it, and creates a sandbox. " +
    `Template only: abx template scaffold --prompt "${description}"`;
  if (!canGuideConfiguration(ctx, false) || !sandboxSeams.stdinIsatty()) {
    getOutput(ctx).info(hint);
    return false;
  }

  echo(
    "Natural-language create will:\n" +
      "  1. generate a template (Dockerfile, commands.py server, template.yaml)\n" +
      "  2. build and push the image\n" +
      "  3. deploy the template\n" +
      "  4. create a sandbox\n",
    { err: true },
  );
  return confirm("Switch to template init and only create the local template?", { default: false, err: true });
}

/**
 * Generate a template, then use the shared whole-template launch lifecycle.
 *
 * `output_dir` is `--dir`: the parent directory for the generated workspace (an interactive terminal is asked when it
 * is omitted).
 *
 * Returns creation presentation and the service receipt after one preparation/create/start.
 */
export async function _generateAndLaunchTemplate(
  ctx: Context,
  description: string,
  opts: { yes: boolean; verbose: boolean; output_dir?: string | null; model?: string | null; provider_options?: Record<string, unknown>; creationOptions?: Parameters<typeof executeTemplateLaunch>[2]; [key: string]: unknown },
): Promise<TemplateLaunchResult> {
  const extension = providerCliExtension();
  if (!extension?.prepareProject) throw new ProviderFeatureNotSupportedError(providerView().effective, "templates.build");
  // Generated applications always require this runtime credential; fail before model work.
  return withTemplateEnvironment(ctx, { ABX_SERVER_TOKEN: "" }, opts.creationOptions?.envs ?? {}, opts.yes, async environment => {
  opts = { ...opts, creationOptions: { ...opts.creationOptions, envs: { ...environment } } };
  const selected = providerView().effective;
  return withGuidedConfiguration(ctx, { operation: "Generate and launch sandbox", provider: selected, yes: Boolean(ctx.params["yes"]),
    requirements: selected === "alicloud-express" ? ["access_key_id", "access_key_secret"] : undefined,
    validateProvider: selected !== "alicloud-express", overrides: { region: opts.provider_options?.["region"] ?? opts["region"] } }, async () => {
    const gen = await _generateTemplateWorkspace(ctx, description, {
      yes: opts.yes, output_dir: opts.output_dir ?? null, ask_output_dir: true, model: opts.model ?? null,
      buildMode: (opts.provider_options?.["build"] ?? "auto") as BuildMode,
      baseImage: extension.generationBaseImage?.(opts.provider_options ?? {}),
    });
    if (!opts.yes && (!canGuideConfiguration(ctx, false) || !sandboxSeams.stdinIsatty())) {
      throw new UsageError("Confirmation required to build and deploy the generated template. Use --yes/-y to skip in non-interactive mode.");
    }
    return executeTemplateLaunch(ctx, {
      template_ref: gen.workdir, yes: opts.yes, timeout: 600,
      sandbox_timeout: opts.provider_options?.["cmd_timeout"] ?? 300,
    }, opts.creationOptions);
  });
  });
}

/** Parse `KEY=VALUE` items; the first malformed item is reported through `onInvalid`, which exits. */
function _parsePairs(items: readonly string[], onInvalid: (item: string) => never): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of items) {
    const at = item.indexOf("=");
    if (at >= 0) {
      // defineProperty: a plain assignment of `__proto__` would invoke the prototype setter and drop the key
      Object.defineProperty(result, item.slice(0, at), { value: item.slice(at + 1), enumerable: true, writable: true, configurable: true });
    } else onInvalid(item);
  }
  return result;
}

export const create = command("create", {
  help: CREATE_HELP,
  params: () => [
    argument(["template_name"], { required: false, default: null }),
    option(["--prompt"], { default: null, help: "Generate a sandbox from a natural-language description. Mutually exclusive with a template." }),
    option(["--detach", "-d"], { is_flag: true, help: "Return after creation without opening a terminal (already the default for --prompt). Does not replace --yes." }),
    option(["--template", "-T"], { default: null, help: "Provider-native template reference (e.g. 'base'); Express uses a platform ID or already registered alias. Git Registry source uses template launch. " + "Defaults to 'base' when omitted. Cannot be combined with DESCRIPTION." }),
    option(["--upload", "-u"], { type: new Path({ exists: true }), default: null, help: "Local file or directory to upload after creation" }),
    option(["--timeout", "-t", "cmd_timeout"], { type: INT, default: 300, help: "Sandbox lifetime in seconds (positive integer; default: 300)" }),
    option(["--request-timeout"], {
      type: FLOAT,
      default: null,
      help:
        "HTTP request timeout in seconds for the create call " +
        "(floor: 120s for cold starts, or your configured http_timeout if larger). " +
        "Increase for very slow sandbox creation.",
    }),
    option(["--env", "-e"], { multiple: true, help: "Environment variable for the sandbox, format KEY=VALUE (repeatable)" }),
    option(["--metadata", "-m"], { multiple: true, help: "Metadata key-value pair, format KEY=VALUE (repeatable)" }),
    option(["--volume-mount"], { multiple: true, metavar: "PATH=NAME", help: "Mount an existing same-Team Volume by name at an absolute Unix path (Express only; repeatable)" }),
    option(["--yes", "-y"], {
      is_flag: true,
      default: false,
      help:
        "Skip interactive prompts (the template-only switch, Qwen Code install, " +
        "credentials, description clarification, build/deploy confirmation) and run " +
        "the full create pipeline. Required for template generation in non-interactive shells.",
    }),
    option(["--model"], {
      default: null,
      help:
        "Model id for the template generation step (for example qwen3-coder-plus). " +
        "Overrides llm_model / ABX_LLM_MODEL / OPENAI_MODEL for this command. " +
        "When the endpoint rejects the model, an interactive terminal offers coding and chat models with the arrow keys.",
    }),
    ...(providerCliExtension()?.createParams ?? []),
    option(["--dir", "output_dir"], {
      default: null,
      metavar: "DIRECTORY",
      help:
        "Parent directory for the generated template files (Dockerfile, " +
        "commands.py, template.yaml); a new <name>-<timestamp>-<id> subfolder is created inside it. " +
        "Default: ~/.abx/generated (an interactive terminal is asked when omitted).",
    }),
    option(["-v", "--verbose", "verbose_flag"], { is_flag: true, help: "Verbose output (DEBUG level)" }),
  ],
  callback: handleErrors(async (ctx: Context, params) => {
    const description: string | null = params["prompt"];
    const template: string | null = params["template"] ?? params["template_name"] ?? (description ? null : "base");
    const upload: string | null = params["upload"];
    const cmdTimeout: number = params["cmd_timeout"];
    const requestTimeout: number | null = params["request_timeout"];
    const env: string[] = params["env"];
    const metadata: string[] = params["metadata"];
    const volumeMountPairs: string[] = params["volume_mount"];
    const yes: boolean = params["yes"];
    const model: string | null = params["model"];
    const outputDir: string | null = params["output_dir"];
    const verboseFlag: boolean = params["verbose_flag"];

    const mountEntries: Array<[string, string]> = [];
    const mountPaths = new Set<string>();
    for (const pair of volumeMountPairs) {
      const separator = pair.indexOf("=");
      if (separator < 1 || mountPaths.has(pair.slice(0, separator))) throw new UsageError("--volume-mount requires PATH=NAME with a unique mount path.");
      const mountPath = pair.slice(0, separator);
      mountPaths.add(mountPath);
      mountEntries.push([mountPath, pair.slice(separator + 1)]);
    }
    let volumeMounts: Record<string, string>;
    try { volumeMounts = validateVolumeMounts(Object.fromEntries(mountEntries)); }
    catch { throw new UsageError("--volume-mount requires a nonempty Volume name and a normalized absolute Unix path outside system/hidden directories."); }
    if (mountEntries.length) {
      const selected = providerView().effective;
      if (!getProvider(selected).createOptions.has("volume_mounts")) throw new ProviderFeatureNotSupportedError(selected, "volume_mounts");
    }

    if (verboseFlag) enableVerbose(ctx);

    // Routing guard: DESCRIPTION and --template are mutually exclusive. Accepting both while silently dropping one of them
    // would be surprising, so reject the combination before any AI generation or network call.
    if (description && template) {
      throw new UsageError(
        "DESCRIPTION and --template cannot be combined. Drop --template to " +
          "generate a template from the description, or drop DESCRIPTION to " +
          "launch an existing template directly.",
      );
    }

    if (outputDir && !description) {
      throw new UsageError(
        "--dir only applies to template generation; pass a DESCRIPTION, " + "or drop --dir when launching an existing template.",
      );
    }

    const fmt = getFormatter(ctx);

    // Local-only generation makes no cloud configuration demands.
    if (description && !template && await _wantsTemplateOnly(ctx, description, { yes })) {
      if (outputDir) getOutput(ctx).warning("--dir is ignored for template-only generation; the files are written to ./<name>/.");
      await _generateLocalTemplate(ctx, description, { yes, model });
      return;
    }

    // Parse env vars from "KEY=VALUE" format
    const envs = _parsePairs(env, (item) => {
      fmt.printError(`Invalid environment variable format: ${pyRepr(item)} (expected KEY=VALUE)`);
      return sysExit(2);
    });

    // Parse metadata from "KEY=VALUE" format
    const meta = _parsePairs(metadata, (item) => {
      fmt.printError(`Invalid metadata format: ${pyRepr(item)} (expected KEY=VALUE)`);
      return sysExit(2);
    });

    if (requestTimeout !== null && (!Number.isFinite(requestTimeout) || requestTimeout <= 0)) throw new ValueError(`request_timeout must be a positive number of seconds, got ${pyRepr(new PyFloat(requestTimeout))}`);
    const execute = async (): Promise<void> => {
    if (description && !template) {
      const launched = await _generateAndLaunchTemplate(ctx, description, {
        yes, provider_options: params, verbose: verboseFlag, output_dir: outputDir, model,
        creationOptions: {
          envs, metadata: meta, volume_mounts: volumeMounts,
          request_timeout: requestTimeout ?? Math.max(loadLayeredConfig().http_timeout, _CREATE_REQUEST_TIMEOUT_FLOOR),
          afterCreate: async (sandbox) => {
            if (!upload) return;
            if (isFile(upload)) await sandbox.files.write(`/home/user/${nodePath.basename(upload)}`, fs.readFileSync(upload));
            else for (const relative of rglobAll(upload)) {
              const local = nodePath.join(upload, relative);
              if (isFile(local)) await sandbox.files.write(`/home/user/${relative}`, fs.readFileSync(local));
            }
          },
        },
      });
      const data = { ...launched.creation };
      const out = getOutput(ctx);
      if (!out.jsonMode) {
        data["ID"] = printedId(providerView(String(data["provider"])), String(data["ID"]));
        delete data["provider"];
      }
      out.data(data);
      if (!out.jsonMode) out.success(`Sandbox ${data["ID"]} created successfully.`);
      return;
    }
    const effectiveTemplate = template || "base";

    // Build create kwargs
    const createKwargs: Record<string, unknown> = { template: effectiveTemplate, timeout: cmdTimeout };
    if (Object.keys(envs).length > 0) createKwargs["envs"] = envs;
    if (Object.keys(meta).length > 0) createKwargs["metadata"] = meta;
    if (mountEntries.length) createKwargs["volume_mounts"] = volumeMounts;

    // HTTP timeout for the create call: sandbox creation (cold start) is known to be slow, so we always enforce a floor of
    // 120s. If the user configured a *larger* http_timeout (e.g. 300s) that is respected; if they configured a *smaller*
    // value (e.g. 30s) or left the default, we bump to the floor. --request-timeout always wins when provided.
    if (requestTimeout !== null) {
      createKwargs["request_timeout"] = requestTimeout;
    } else {
      const configured = loadLayeredConfig().http_timeout;
      createKwargs["request_timeout"] = Math.max(configured, _CREATE_REQUEST_TIMEOUT_FLOOR);
    }

    const out = getOutput(ctx);

    const runCreate = async (note: ((text: string) => void) | null): Promise<Sandbox> => {
      // The option is a Python float, so its repr keeps the ".0" the SDK (which only sees a JS number) cannot print.
      if (requestTimeout !== null && requestTimeout <= 0) {
        throw new ValueError(`request_timeout must be a positive number of seconds, got ${pyRepr(new PyFloat(requestTimeout))}`);
      }
      const sbx = await Sandbox.create(createKwargs);
      if (upload) {
        const remoteBase = "/home/user";
        if (isFile(upload)) {
          const dest = `${remoteBase}/${nodePath.basename(upload)}`;
          await sbx.files.write(dest, fs.readFileSync(upload));
          if (note !== null) note(nodePath.basename(upload));
          if (!fmt.use_json) out.info(`\u2191 Uploaded ${upload} \u2192 ${dest}`);
        } else if (isDir(upload)) {
          let count = 0;
          for (const rel of rglobAll(upload)) {
            const file = nodePath.join(upload, rel);
            if (isFile(file)) {
              const dest = `${remoteBase}/${rel}`;
              await sbx.files.write(dest, fs.readFileSync(file));
              count += 1;
              if (note !== null) note(rel);
            }
          }
          if (!fmt.use_json) out.info(`\u2191 Uploaded ${count} file(s) \u2192 ${remoteBase}/`);
        }
      }
      return sbx;
    };

    let sandbox: Sandbox;
    if (upload) {
      sandbox = await out.activity("Creating sandbox", (update) => runCreate(_rollingNote(update)), { tick: true });
    } else {
      sandbox = await out.spinner("Creating sandbox", () => runCreate(null));
    }

    const createView = providerView(sandbox.provider);
    const data: Record<string, unknown> = {
      ID: sandbox.id,
      Status: sandbox.status,
      Template: sandbox.info.template,
      URL: sandbox.url,
    };
    if (sandbox.info.envd_version) data["EnvdVersion"] = sandbox.info.envd_version;
    if (!out.jsonMode) data["ID"] = printedId(createView, sandbox.id);
    else data["provider"] = createView.effective;
    // Result channel (task 167): the machine-consumable document goes to stdout; the success notice is skipped in --json
    // mode so that stdout stays a single parseable JSON document.
    out.data(data);
    if (!out.jsonMode) out.success(`Sandbox ${printedId(createView, sandbox.id)} created successfully.`);
    };
    const selectedProvider = getProvider(providerView().effective);
    selectedProvider.require("sandbox.lifecycle");
    if (description) selectedProvider.require("templates.build");
    return withGuidedConfiguration(ctx, { operation: "Generate, deploy and create sandbox", provider: selectedProvider.id, yes,
      requirements: selectedProvider.id === "alicloud-express" ? ["sandbox_api_key", ...(description ? ["access_key_id", "access_key_secret"] : [])] : undefined,
      validateProvider: selectedProvider.id !== "alicloud-express", overrides: { region: params["region"] } }, execute);
  }),
});

// ---------------------------------------------------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------------------------------------------------

export const list_cmd = command("list", {
  help: LIST_HELP,
  params: [
    option(["--status", "-s"], {
      type: new Choice(["running", "stopped", "creating", "paused", "error"]),
      default: null,
      help: "Filter by status",
    }),
    option(["--limit", "-l"], { type: INT, default: 20, help: "Maximum results (positive integer; default: 20)" }),
    regionOption(),
    option(["--all-providers"], { is_flag: true, hidden: !providersInUse(), help: "List the sandboxes of every configured provider (adds a Provider column)" }),
  ],
  callback: handleErrors(async (ctx: Context, params) => {
    const status: string | null = params["status"];
    const limit: number = params["limit"];
    const region: string | null = params["region"];

    const fmt = getFormatter(ctx);

    if (params["all_providers"]) {
      await _listAllProviders(fmt, status, limit);
      return;
    }
    const view = providerView();
    const sandboxes = await Sandbox.list({
      status: status ? (status as SandboxStatus) : null, limit, provider: view.effective,
      provider_options: scopedFlagOptions("--region", "region", region, view),
    });

    _printSandboxList(fmt, view, sandboxes.map((sb) => ({ provider: view.effective, info: sb })));
  }),
});

interface ListedSandbox {
  provider: string;
  info: { sandbox_id: string; template: string; status: unknown; region: string };
}

/** Qualified ids in text mode, a `provider` key in JSON (spec section 4.4). */
function _printSandboxList(fmt: OutputFormatter, view: ReturnType<typeof providerView>, listed: ListedSandbox[], withColumn = false): void {
  if (fmt.use_json) {
    fmt.printData(
      listed.map(({ provider, info: sb }) => new Map<string, unknown>([
        ["ID", sb.sandbox_id], ["Template", sb.template], ["Status", sb.status], ["Region", _unknownDash(sb.region)], ["provider", provider],
      ])),
    );
    return;
  }
  if (!listed.length) {
    fmt.printSuccess("No sandboxes found.");
    return;
  }
  const headers = withColumn ? ["ID", "Template", "Status", "Region", "Provider"] : ["ID", "Template", "Status", "Region"];
  const rows = listed.map(({ provider, info: sb }) => {
    const row = [printedId(view, sb.sandbox_id, provider), sb.template, String(sb.status), _unknownDash(sb.region)];
    return withColumn ? [...row, provider] : row;
  });
  fmt.printTable(headers, rows);
}

/** `abx list --all-providers`: every configured provider; a failing one is skipped with a warning. */
async function _listAllProviders(fmt: OutputFormatter, status: string | null, limit: number): Promise<void> {
  const view = { ...providerView(), ambient: "" };
  const listed: ListedSandbox[] = [];
  let firstError: unknown = null;
  let succeeded = 0;
  for (const summary of providerRegistry.listProviders()) {
    try {
      const found = await Sandbox.list({ status: status ? (status as SandboxStatus) : null, limit, provider: summary.id });
      succeeded += 1;
      for (const sb of found) listed.push({ provider: summary.id, info: sb });
    } catch (exc) {
      if (_isBaseException(exc)) throw exc;
      if (firstError === null) firstError = exc;
      echo(`warning: provider '${summary.id}' skipped: ${pyStr(exc)}`, { err: true });
    }
  }
  if (succeeded === 0 && firstError !== null) throw firstError;
  _printSandboxList(fmt, view, listed, true);
}

// ---------------------------------------------------------------------------------------------------------------------
/** Plugin providers that do not report a region/timeout leave "" / 0 in `SandboxInfo`; print them as "-". */
function _unknownDash(value: string): string {
  return value === "" ? "-" : value;
}

// info
// ---------------------------------------------------------------------------------------------------------------------

export const info = command("info", {
  help: INFO_HELP,
  params: [argument(["sandbox_id"])],
  callback: handleErrors(async (ctx: Context, params) => {
    const sandboxId: string = params["sandbox_id"];
    const fmt = getFormatter(ctx);

    const sandbox = await Sandbox.connect(sandboxId);
    const sbInfo = sandbox.info;
    const infoView = providerView(sandbox.provider);

    const data: Record<string, unknown> = {
      ID: fmt.use_json ? sbInfo.sandbox_id : printedId(infoView, sbInfo.sandbox_id),
      Template: sbInfo.template,
      Status: sbInfo.status,
      Region: _unknownDash(sbInfo.region),
      Timeout: sbInfo.timeout > 0 ? `${sbInfo.timeout}s` : "-",
      URL: sbInfo.envd_url || "N/A",
    };
    if (sbInfo.envd_version) data["EnvdVersion"] = sbInfo.envd_version;
    if (sbInfo.started_at) data["Started"] = pyStr(sbInfo.started_at);
    if (sbInfo.metadata && Object.keys(sbInfo.metadata).length > 0) data["Metadata"] = pyStr(sbInfo.metadata);
    data[fmt.use_json ? "provider" : "Provider"] = infoView.effective;

    fmt.printDict(data);
  }),
});

// ---------------------------------------------------------------------------------------------------------------------
// kill
// ---------------------------------------------------------------------------------------------------------------------

async function _connectAndKill(sid: string): Promise<void> {
  // `killById` talks to the provider's kill method directly. Connecting first would
  // `sandbox.get` a sandbox that is already gone and fail the command; kill is idempotent.
  await Sandbox.killById(sid);
}

/** `except Exception`: everything but the BaseException family (`SystemExit`, `KeyboardInterrupt`). */
function _isBaseException(exc: unknown): boolean {
  return exc instanceof SystemExit || exc instanceof KeyboardInterrupt;
}

export const kill = command("kill", {
  help: KILL_HELP,
  params: [
    argument(["sandbox_id"], { required: false }),
    option(["--all", "kill_all"], { is_flag: true, help: "Kill all running sandboxes" }),
    option(["--yes", "-y"], { is_flag: true, help: "Skip confirmation" }),
    regionOption(),
  ],
  callback: handleErrors(async (ctx: Context, params) => {
    const sandboxId: string | null = params["sandbox_id"];
    const killAll: boolean = params["kill_all"];
    const yes: boolean = params["yes"];
    const region: string | null = params["region"];

    const fmt = getFormatter(ctx);

    if (!killAll && !sandboxId) {
      fmt.printError("Either provide a sandbox ID or use --all.", { suggestion: "Usage: abx kill <sandbox-id> or abx kill --all" });
      sysExit(2);
    }

    if (killAll) {
      const killView = providerView();
      let sandboxes: Array<{ sandbox_id: string }>;
      sandboxes = (await Sandbox.list({ status: SandboxStatus.RUNNING, provider: killView.effective,
        provider_options: scopedFlagOptions("--region", "region", region, killView),
      })).map((sandbox) => ({ sandbox_id: printedId(killView, sandbox.sandbox_id, killView.effective) }));

      if (!sandboxes.length) {
        fmt.printSuccess("No running sandboxes to kill.");
        return;
      }

      if (!yes) {
        if (!canGuideConfiguration(ctx, false) || !sandboxSeams.stdinIsatty()) {
          throw new UsageError("Confirmation required for killing all sandboxes. " + "Use --yes/-y to skip in non-interactive mode.");
        }
        await confirm(`Kill all ${sandboxes.length} running sandbox(es)?`, { abort: true });
      }

      const out = getOutput(ctx);
      let killed = 0;
      const total = sandboxes.length;
      await out.activity(
        `Killing ${total} sandbox(es)`,
        async (update) => {
          const note = _rollingNote(update);
          let index = 0;
          for (const sb of sandboxes) {
            index += 1;
            note(`${index}/${total} ${sb.sandbox_id}`);
            try {
              await _connectAndKill(sb.sandbox_id);
              killed += 1;
            } catch (exc) {
              if (_isBaseException(exc)) throw exc;
              fmt.printError(`Failed to kill ${sb.sandbox_id}: ${pyStr(exc)}`);
            }
          }
        },
        { tick: true },
      );

      fmt.printSuccess(`Killed ${killed}/${total} sandbox(es).`);
    } else {
      if (!yes) await confirm(`Kill sandbox ${sandboxId}?`, { abort: true });

      await getOutput(ctx).spinner(`Killing sandbox ${sandboxId}`, () => _connectAndKill(sandboxId as string));

      fmt.printSuccess(`Sandbox ${sandboxId} killed.`);
    }
  }),
});

// ---------------------------------------------------------------------------------------------------------------------
// exec
// ---------------------------------------------------------------------------------------------------------------------

function _processResultData(result: { stdout: string; stderr: string; exit_code: number; execution_time: number }): Record<string, unknown> {
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    execution_time: new PyFloat(result.execution_time),
  };
}

/** The command line `abx exec` sends: one argument is a command line as typed, several are an exact argv. */
export function _execCommandLine(argv: readonly string[]): string {
  return argv.length === 1 ? (argv[0] as string) : argv.map((a) => shlexQuote(a)).join(" ");
}

export const exec_cmd = command("exec", {
  help: EXEC_HELP,
  params: [
    argument(["sandbox_id"]),
    argument(["command"], { nargs: -1, required: true }),
    option(["--cwd"], { default: "", help: "Working directory (empty = container default)" }),
    option(["--env", "-e"], { multiple: true, help: "Environment variable for the command, format KEY=VALUE (repeatable)" }),
    option(["--timeout", "-t", "cmd_timeout"], { type: INT, default: 60, help: "Command timeout in seconds (positive integer; default: 60)" }),
    option(["--background"], { is_flag: true, help: "Start the command, print its pid and return without waiting" }),
    option(["--stream"], { is_flag: true, help: "Print stdout/stderr live while the command runs" }),
    option(["-v", "--verbose", "verbose_flag"], { is_flag: true, help: "Verbose output (DEBUG level)" }),
  ],
  callback: handleErrors(async (ctx: Context, params) => {
    const sandboxId: string = params["sandbox_id"];
    const argv: string[] = params["command"];
    const cmdTimeout: number = params["cmd_timeout"];
    const cwd: string = params["cwd"];
    const background: boolean = params["background"];
    const stream: boolean = params["stream"];
    const verboseFlag: boolean = params["verbose_flag"];

    if (verboseFlag) enableVerbose(ctx);

    const fmt = getFormatter(ctx);
    if (background && stream) throw new UsageError("--background and --stream cannot be combined.");

    const envs = _parsePairs(params["env"], (item) => {
      fmt.printError(`Invalid environment variable format: ${pyRepr(item)} (expected KEY=VALUE)`);
      return sysExit(2);
    });
    const env = Object.keys(envs).length > 0 ? envs : null;
    const commandLine = _execCommandLine(argv);

    const sandbox = await Sandbox.connect(sandboxId);

    if (background) {
      let pid: number | string | null = null;
      for await (const chunk of await sandbox.commands.start(commandLine, { timeout: cmdTimeout, cwd, env })) {
        if (chunk.pid !== null && chunk.pid !== undefined) {
          pid = chunk.pid;
          break;
        }
        if (chunk.type === ProcessChunkType.EXIT) break;
      }
      if (pid === null) {
        fmt.printError("The sandbox did not report a process id for the command.");
        return sysExit(1);
      }
      if (fmt.use_json) fmt.printData({ pid });
      else echo(String(pid));
      return;
    }

    if (stream) {
      let exitCode = 0;
      for await (const chunk of sandbox.commands.stream(commandLine, { timeout: cmdTimeout, cwd, env })) {
        if (chunk.type === ProcessChunkType.STDOUT) {
          if (chunk.data) echo(chunk.data, { nl: false });
        } else if (chunk.type === ProcessChunkType.STDERR) {
          if (chunk.data) echo(chunk.data, { err: true, nl: false });
        } else if (chunk.type === ProcessChunkType.EXIT) {
          exitCode = chunk.exit_code || 0;
        }
      }
      if (fmt.use_json) fmt.printData({ exit_code: exitCode });
      sysExit(exitCode);
    }

    const result = (await sandbox.commands.run(commandLine, { timeout: cmdTimeout, cwd, env })) as unknown as {
      stdout: string;
      stderr: string;
      exit_code: number;
      execution_time: number;
    };

    if (fmt.use_json) {
      fmt.printData(_processResultData(result));
    } else {
      if (result.stdout) echo(result.stdout, { nl: false });
      if (result.stderr) echo(result.stderr, { err: true, nl: false });
    }

    sysExit(result.exit_code);
  }),
});

// ---------------------------------------------------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------------------------------------------------

export const connect = command("connect", {
  help: CONNECT_HELP,
  params: [argument(["sandbox_id"])],
  callback: handleErrors(async (ctx: Context, params) => {
    const sandboxId: string = params["sandbox_id"];

    const sandbox = await Sandbox.connect(sandboxId);
    const out = getOutput(ctx);
    out.success(`Connected to sandbox ${sandboxId}`);
    out.info("Type 'exit' or Ctrl+D to disconnect");
    out.info("Note: each line runs in an independent process - cd, environment " + "variables and shell state do not persist");
    enableLineEditing();

    // Executables observed in this session, used only as a reliable source for "did you mean" hints (never a guess about
    // the image).
    const knownCommands = new Set<string>();

    // `asyncio.run` semantics: the first Ctrl+C only cancels the task (a pending input() keeps waiting, the cancellation
    // lands at the next await, or when the coroutine returns); the second one interrupts input().
    inputInterrupts.swallowFirst = true;
    inputInterrupts.count = 0;
    try {
      await _replLoop(sandbox, out, sandboxId, knownCommands);
    } finally {
      inputInterrupts.swallowFirst = false;
    }
    if (inputInterrupts.count > 0) throw new KeyboardInterrupt();
  }),
});

async function _replLoop(sandbox: Sandbox, out: OutputManager, sandboxId: string, knownCommands: Set<string>): Promise<void> {
  for (;;) {
    let cmd: string;
    try {
      cmd = await input(`abx:${cpSlice(sandboxId, 0, 8)}> `);
    } catch (exc) {
      if (exc instanceof EOFError || exc instanceof KeyboardInterrupt) {
        out.info("\nDisconnected.");
        break;
      }
      throw exc;
    }

    cmd = pyStrip(cmd);
    if (!cmd) continue;
    if (cmd === "exit" || cmd === "quit") {
      out.info("Disconnected.");
      break;
    }

    // The pending task cancellation of a swallowed Ctrl+C lands at the first await after input() returned.
    if (inputInterrupts.count > 0) throw new KeyboardInterrupt();

    try {
      // Hardcoded 30s timeout for interactive commands to prevent indefinite hangs; long-running tasks should use 'abx
      // exec' with an explicit --timeout instead.
      const result = (await sandbox.commands.run(cmd, { timeout: REPL_TIMEOUT })) as unknown as {
        stdout: string;
        stderr: string;
        exit_code: number;
      };
      if (result.stdout) echo(result.stdout, { nl: false });
      if (result.stderr) echo(result.stderr, { nl: false, err: true });
      // 126/127 mean "not executable / not found" - a shell wrapper may report the failure while the program does not
      // exist.
      if (result.exit_code !== 126 && result.exit_code !== 127) {
        const name = programName(cmd);
        if (name) knownCommands.add(name);
      }
    } catch (exc) {
      if (_isBaseException(exc)) throw exc;
      // One friendly message per failure: a raw exception string could leak the sandbox URL / an MDN link, and logging it
      // as a warning on top would repeat the same information.
      const failure = describeCommandFailure(exc, { command: cmd, timeout: REPL_TIMEOUT, known_commands: knownCommands });
      out.error(failure.message, { code: failure.code, suggestion: failure.suggestion });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------------------------------------------------

export const upload = command("upload", {
  help: UPLOAD_HELP,
  params: [argument(["sandbox_id"]), argument(["local_path"], { type: new Path({ exists: true }) }), argument(["remote_path"])],
  callback: handleErrors(async (ctx: Context, params) => {
    const sandboxId: string = params["sandbox_id"];
    const localPath: string = params["local_path"];
    const remotePath: string = params["remote_path"];

    const fmt = getFormatter(ctx);
    const out = getOutput(ctx);

    const runUpload = async (note: (text: string) => void): Promise<string> => {
      const sandbox = await Sandbox.connect(sandboxId);

      if (isFile(localPath)) {
        await sandbox.files.write(remotePath, fs.readFileSync(localPath));
        note(pyBasename(remotePath));
        return `Uploaded ${localPath} -> ${remotePath}`;
      }
      if (isDir(localPath)) {
        let count = 0;
        for (const rel of rglobAll(localPath)) {
          const file = nodePath.join(localPath, rel);
          if (isFile(file)) {
            const dest = `${remotePath.replace(/\/+$/, "")}/${rel}`;
            await sandbox.files.write(dest, fs.readFileSync(file));
            count += 1;
            note(rel);
          }
        }
        return `Uploaded ${count} files from ${localPath} -> ${remotePath}`;
      }
      return "";
    };

    // Directory uploads can sit for a long time. On a terminal the header keeps the elapsed time moving and the grey lines
    // name each file (never the bytes). Quiet / JSON / CI / non-TTY stay silent here; the success line below is the only
    // result.
    const message = await out.activity(`Uploading ${localPath}`, (update) => runUpload(_rollingNote(update)), { tick: true });
    if (message) fmt.printSuccess(message);
  }),
});

/** `Path(p).name`. */
function pyBasename(p: string): string {
  const stripped = pyPathStr(p);
  if (stripped === "." || stripped === "/" || stripped === "") return "";
  return stripped.slice(stripped.lastIndexOf("/") + 1);
}

// ---------------------------------------------------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------------------------------------------------

export const download = command("download", {
  help: DOWNLOAD_HELP,
  params: [argument(["sandbox_id"]), argument(["remote_path"]), argument(["local_path"], { type: new Path() })],
  callback: handleErrors(async (ctx: Context, params) => {
    const sandboxId: string = params["sandbox_id"];
    const remotePath: string = params["remote_path"];
    const localPath: string = params["local_path"];

    const fmt = getFormatter(ctx);
    const out = getOutput(ctx);

    const content = await out.spinner(`Downloading ${remotePath}`, async () => {
      const sandbox = await Sandbox.connect(sandboxId);
      return sandbox.files.readBytes(remotePath);
    });

    let local = pyPathStr(localPath);
    if (isDir(local)) {
      const filename = remotePath.slice(remotePath.lastIndexOf("/") + 1);
      local = pyJoin(local, filename);
    }

    mkdirParents(nodePath.dirname(local));
    let fd: number;
    try {
      fd = fs.openSync(local, "w");
    } catch (exc) {
      throw toOSError(exc, local);
    }
    try {
      let off = 0;
      while (off < content.length) off += fs.writeSync(fd, content, off, content.length - off);
    } catch (exc) {
      // `Path.write_bytes`: only a failed open names the file, a failed write does not
      throw toOSError(exc, null);
    } finally {
      fs.closeSync(fd);
    }
    fmt.printSuccess(`Downloaded ${remotePath} -> ${local}`);
  }),
});

// ---------------------------------------------------------------------------------------------------------------------
// named commands (registered on the in-sandbox server): list / run
// ---------------------------------------------------------------------------------------------------------------------

const _serverPortOption = (): Option =>
  option(["--server-port"], {
    type: INT,
    default: 9000,
    help: "Port of the SandboxServer inside the sandbox (default: 9000)",
  }) as Option;

/** `--arg KEY=VALUE` pairs (later duplicates win) merged with a `--json-args` object. */
export function _commandArguments(pairs: readonly string[], jsonArgs: string | null, fmt: OutputFormatter): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (jsonArgs !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonArgs);
    } catch (exc) {
      fmt.printError(`--json-args is not valid JSON: ${pyStr(exc)}`);
      return sysExit(2);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      fmt.printError("--json-args must be a JSON object, for example '{\"x\": 1}'.");
      return sysExit(2);
    }
    Object.assign(out, parsed);
  }
  const fromPairs = _parsePairs(pairs, (item) => {
    fmt.printError(`Invalid argument format: ${pyRepr(item)} (expected KEY=VALUE)`);
    return sysExit(2);
  });
  for (const [key, value] of Object.entries(fromPairs)) {
    if (Object.hasOwn(out, key)) {
      fmt.printError(`Argument ${pyRepr(key)} is given both in --json-args and with --arg.`);
      return sysExit(2);
    }
    out[key] = value;
  }
  return out;
}

export const run_cmd = command("run", {
  help: RUN_HELP,
  params: [
    argument(["sandbox_id"]),
    argument(["command_name"]),
    option(["--arg", "-a", "args"], { multiple: true, help: "Command argument, format KEY=VALUE (repeatable)" }),
    option(["--json-args"], { default: null, help: 'Command arguments as a JSON object, e.g. \'{"x": 1}\' (for typed values)' }),
    _serverPortOption(),
  ],
  callback: handleErrors(async (ctx: Context, params) => {
    const sandboxId: string = params["sandbox_id"];
    const commandName: string = params["command_name"];
    const serverPort: number = params["server_port"];

    const fmt = getFormatter(ctx);
    const kwargs = _commandArguments(params["args"], params["json_args"], fmt);

    const sandbox = await Sandbox.connect(sandboxId);
    let result: CommandResult;
    try {
      result = await sandbox.runCommand(commandName, kwargs, { server_port: serverPort, application_token: applicationToken() });
    } catch (exc) {
      if (exc instanceof CommandNotFoundError) {
        fmt.printError(exc.message, { code: exc.code, suggestion: exc.suggestion });
        return sysExit(2);
      }
      throw exc;
    }

    if (!result.success) {
      if (fmt.use_json) fmt.printError(result.stderr || "Command execution failed", { code: ExecutionError.code });
      else if (result.stderr) echo(result.stderr, { err: true });
      return sysExit(1);
    }
    if (fmt.use_json) fmt.printData({ result: result.value });
    else if (typeof result.value === "string") echo(result.value);
    else if (result.value !== null && result.value !== undefined) echo(JSON.stringify(result.value));
  }),
});

const _commandSignature = (args: Array<Record<string, unknown>>): string =>
  args.map((a) => `${pyStr(a["name"])}${a["required"] ? "" : "?"}:${pyStr(a["type"] ?? "string")}`).join(", ");

export const command_list = command("list", {
  help: COMMAND_LIST_HELP,
  params: [argument(["sandbox_id"]), _serverPortOption()],
  callback: handleErrors(async (ctx: Context, params) => {
    const sandboxId: string = params["sandbox_id"];
    const fmt = getFormatter(ctx);
    const sandbox = await Sandbox.connect(sandboxId);
    const commands = await sandbox.listCommands({ server_port: params["server_port"], application_token: applicationToken() });

    if (fmt.use_json) {
      fmt.printData(commands);
      return;
    }
    if (!commands.length) {
      fmt.printSuccess("No commands are registered in this sandbox.");
      return;
    }
    fmt.printTable(
      ["Name", "Arguments", "Description"],
      commands.map((c) => [pyStr(c["name"]), _commandSignature((c["args"] ?? []) as Array<Record<string, unknown>>), pyStr(c["description"] ?? "")]),
    );
  }),
});

export const command_group = group("command", {
  help: COMMAND_GROUP_HELP,
  callback: (ctx: Context) => {
    ctx.ensureObject(Object);
  },
});

command_group.addCommand(command_list, "list");
command_group.addCommand(run_cmd, "run");

// ---------------------------------------------------------------------------------------------------------------------
// sandbox group (abx sandbox list/info/kill/...)
// ---------------------------------------------------------------------------------------------------------------------

export const sandbox = group("sandbox", {
  help: SANDBOX_HELP,
  callback: (ctx: Context) => {
    ctx.ensureObject(Object);
  },
});

sandbox.addCommand(create);
sandbox.addCommand(list_cmd, "list");
sandbox.addCommand(info);
sandbox.addCommand(kill);
sandbox.addCommand(exec_cmd, "exec");
sandbox.addCommand(connect);
sandbox.addCommand(upload);
sandbox.addCommand(download);
sandbox.addCommand(capabilities, "capabilities");

sandbox.addCommand(files, "files");
sandbox.addCommand(process_, "process");
sandbox.addCommand(command_group, "command");
sandbox.addCommand(system, "system");

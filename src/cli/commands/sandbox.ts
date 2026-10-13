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
 * - `_discover_registered_commands` executes Python files; the Node CLI cannot import Python, so the module loader is the
 *   {@link sandboxSeams}`.discoverImport` seam (default: no-op). The function was never called by the Python CLI.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

import { ClarifyOutcome } from "../../agent/clarify.js";
import * as clarify from "../../agent/clarify.js";
import type { CodingAgentBackend } from "../../agent/coding_agent.js";
import { defaultGeneratedDir } from "../../agent/codegen.js";
import { safeDump, safeLoadRich } from "../../agent/_pyyaml.js";
import { pyPathStr } from "../../agent/_pycompat.js";
import { Sandbox } from "../../api/sandbox.js";
import {
  Abort,
  ClickException,
  Choice,
  Context,
  EOFError,
  FLOAT,
  INT,
  KeyboardInterrupt,
  Path,
  SystemExit,
  UsageError,
  argument,
  command,
  confirm,
  echo,
  group,
  option,
  prompt,
  sys,
  sysExit,
} from "../../framework/index.js";
import { cmpStr, cpSlice, parseIntStrict } from "../../framework/py.js";
import { CommandNotFoundError, DescriptionClarificationError } from "../../models/errors.js";
import { SandboxStatus } from "../../models/sandbox.js";
import { SandboxProtocol } from "../../protocol/sandbox.js";
import { createAuthProvider } from "../../transport/auth.js";
import { loadConfig } from "../../transport/config.js";
import { HttpClient } from "../../transport/http.js";
import { getLogger } from "../../utils/logging.js";
import { PyFloat, pyRepr, pyStr, pyStrip } from "../../utils/_pyformat.js";
import { formatFixed0 } from "../../agent/_pycompat.js";
import { isDir, isFile, mkdirParents, pathExists, pyExpandUser, pyJoin, pyResolve, readTextPy, rglobAll, toOSError, writeTextPy } from "../../utils/_pyos.js";
import { getFormatter, type OutputFormatter } from "../formatters.js";
import { handleErrors } from "../main.js";
import { enableVerbose, getOutput, type OutputManager } from "../output.js";
import { REPL_TIMEOUT, describeCommandFailure, enableLineEditing, input, inputInterrupts, programName } from "../repl.js";
import { regionOption } from "../region.js";
import { printedId, providerView, scopedFlagOptions } from "../provider_view.js";
import { providersInUse } from "../../providers/in_use.js";
import * as providerRegistry from "../../providers/registry.js";
import { BUILTIN_PROVIDER_ID } from "../../utils/config_keys.js";
import { ValueError } from "../../models/_pydantic.js";
import { files } from "./sandbox_files.js";
import { process as process_ } from "./sandbox_process.js";
import { capabilities, shell_stream, system } from "./sandbox_system.js";

const _log = getLogger("cli.commands.sandbox");

/** Patch points (the TypeScript counterparts of the module attributes the Python tests monkeypatch). */
export const sandboxSeams: {
  /** `sys.stdin.isatty()` of the Python module (`monkeypatch.setattr("...commands.sandbox.sys", _FakeSys())`). */
  stdinIsatty: () => boolean;
  /** `os.access(path, os.W_OK)`. */
  access: (path: string) => boolean;
  /** Execute one discovered Python file (`importlib.util.spec_from_file_location` + `exec_module`). */
  discoverImport: (moduleName: string, file: string) => void | Promise<void>;
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
  discoverImport: () => undefined,
};

// ---------------------------------------------------------------------------------------------------------------------
// Help texts (the Python docstrings, verbatim; the framework applies `inspect.cleandoc` like Click)
// ---------------------------------------------------------------------------------------------------------------------

const CREATE_HELP = `Create a new sandbox.

    Exactly one route is taken, and it must be explicit:

    \b
      ebx create --template base  →  launch the 'base' template
      ebx create --template NAME  →  launch NAME directly (no AI)
      ebx create "DESCRIPTION"    →  Qwen Code generates a template, builds
                                    and deploys it, then launches a sandbox;
                                    the agent researches public facts first
                                    and asks only for details it cannot infer.
                                    An interactive terminal is first asked
                                    whether to switch to template init
                                    (local files only)

    DESCRIPTION and --template are mutually exclusive: passing both is
    rejected instead of silently ignoring one of them.

    \b
    Examples:
      ebx create --template base              # explicit 'base' template
      ebx create --template python-hello      # named template (no AI)
      ebx create -e API_KEY=xxx -e DEBUG=1    # inject env vars
      ebx create --upload ./app --timeout 600 # upload dir, 10-min lifetime
      ebx create "a python data science env"  # AI-generate, build, deploy, create
      ebx create -y "a node.js api server"    # non-interactive full pipeline
      ebx template init "a python data science env"  # template files only

    \b
    Notes:
      AI generation needs the Qwen Code CLI and a DashScope/ModelStudio key
      ('ebx config init'). The agent researches publicly verifiable facts
      itself (tool stack, official install method, common dependencies) and
      only asks for private preferences or business decisions it cannot
      infer — one question at a time in interactive sessions. Non-interactive
      shells must pass --yes to generate without asking. Interactive
      sessions are asked up front whether to switch to template init,
      which writes Dockerfile, commands.py, and template.yaml and stops
      before build, push, deploy, and sandbox create. --yes skips that
      question and runs the full pipeline.

    \b
    Related commands:
      ebx list                 List existing sandboxes
      ebx info SANDBOX_ID      Inspect a created sandbox
      ebx template init DIR    Scaffold a new template project (local)
      ebx template init "DESC" AI-scaffold a template only (no build)
      ebx template search KEY  Find reusable templates
      ebx config init          Configure platform and Qwen Code credentials
    `;

const LIST_HELP = `List sandboxes, optionally filtered by lifecycle status.

    \b
    Examples:
      ebx list
      ebx list --status running
      ebx list --status error --limit 50
      ebx list --region cn-shanghai

    \b
    Related commands:
      ebx info SANDBOX_ID  Show one sandbox in detail
      ebx create           Create a new sandbox
      ebx kill SANDBOX_ID  Destroy a sandbox
    `;

const INFO_HELP = `Show status, template, region, timeout, and URL for a sandbox.

    \b
    Examples:
      ebx info abc123
      ebx --json info abc123

    \b
    Related commands:
      ebx list                  Find sandbox IDs
      ebx sandbox capabilities  Show declared capability groups
      ebx exec SANDBOX_ID CMD   Run a command in the sandbox
    `;

const KILL_HELP = `Permanently destroy one sandbox or all running sandboxes.

    Confirmation is required unless --yes is supplied. Use --yes for scripts
    and other non-interactive environments.

    \b
    Examples:
      ebx kill abc123
      ebx kill abc123 --yes
      ebx kill --all --yes
      ebx kill --all --yes --region cn-shanghai

    \b
    Related commands:
      ebx list              Find running sandbox IDs
      ebx info SANDBOX_ID   Verify a sandbox before deletion
      ebx create            Create a replacement sandbox
    `;

const EXEC_HELP = `Execute one command in a sandbox and return its exit code.

    Quote commands containing spaces or shell operators. Use --cwd to select
    the remote working directory and --timeout for long-running commands.

    \b
    Examples:
      ebx exec abc123 "python --version"
      ebx exec abc123 "pytest -q" --cwd /app --timeout 300
      ebx --json exec abc123 "echo ready"

    \b
    Related commands:
      ebx connect SANDBOX_ID  Open the command REPL
      ebx sandbox shell-stream SANDBOX_ID -c CMD
      ebx run SANDBOX_ID NAME  Run a registered custom command
    `;

const CONNECT_HELP = `Open an interactive command REPL for a sandbox.

    This is a line-based REPL, not a PTY or a full SSH session: every entered
    line runs in a new process with a 30-second timeout, and no shell state
    survives between lines - \`\`cd\`\`, environment variables and aliases are
    gone after each command (use \`\`cd /path && <cmd>\`\` on one line, or
    \`\`ebx exec --cwd\`\`, instead).

    On interactive terminals basic line editing and command history are
    enabled (Up/Down history, Ctrl+R search, Ctrl+A/E and friends).  Type
    \`\`exit\`\`/\`\`quit\`\` or press Ctrl+D to leave; Ctrl+C also disconnects.
    Failed commands are reported as one friendly message - never as raw
    HTTP errors.

    \b
    Examples:
      ebx connect abc123
      ebx sandbox connect abc123

    \b
    Related commands:
      ebx exec SANDBOX_ID CMD  Run one command with a custom timeout
      ebx info SANDBOX_ID      Inspect connection details
      ebx sandbox shell-stream SANDBOX_ID -c CMD
    `;

const UPLOAD_HELP = `Upload a local file or directory to the sandbox.

    Examples:

        ebx upload abc123 ./script.py /app/script.py

        ebx upload abc123 ./data/ /app/data/

    \b
    Related commands:
      ebx download SANDBOX_ID REMOTE_PATH LOCAL_PATH
      ebx sandbox files list SANDBOX_ID --path /app
      ebx exec SANDBOX_ID CMD
    `;

const DOWNLOAD_HELP = `Download a file from the sandbox to local.

    Examples:

        ebx download abc123 /app/result.csv ./result.csv

        ebx download abc123 /app/output.log .

    \b
    Related commands:
      ebx upload SANDBOX_ID LOCAL_PATH REMOTE_PATH
      ebx sandbox files stat SANDBOX_ID --path REMOTE_PATH
      ebx sandbox files list SANDBOX_ID --path REMOTE_DIR
    `;

const RUN_HELP = `Run a named custom command or registered command.

    Supports two argument styles:

    \b
    Legacy:  ebx run <id> <cmd> --arg key=value
    New:     ebx run <id> <cmd> --key value

    When the command comes from @sandbox.register, typed options
    (--x, --y, ...) are derived automatically from the function signature.

    Examples:

        ebx run abc123 dev

        ebx run abc123 test --arg file=tests/

        ebx run abc123 demo --x 1 --y hello

    \b
    Related commands:
      ebx exec SANDBOX_ID CMD  Run an arbitrary shell command
      ebx info SANDBOX_ID      Inspect the target sandbox
      ebx template info ID     Inspect a template definition
    `;

const SANDBOX_HELP = `Manage sandbox lifecycle, files, processes, and system details.

    Lifecycle commands are also available as shorter top-level aliases.

    \b
    Examples:
      ebx sandbox create --template base
      ebx sandbox list --status running
      ebx sandbox system info abc123

    \b
    Related commands:
      ebx sandbox files --help    Inspect and modify remote files
      ebx sandbox process --help  Inspect and control processes
      ebx sandbox system --help   Inspect runtime system details
    `;


// ---------------------------------------------------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Minimum HTTP timeout (seconds) for the sandbox-create call. Cold starts routinely exceed the 30s transport default
 * -- even when the user has configured a custom http_timeout in ~/.ebx/config.toml, we enforce this floor so that a
 * small configured value doesn't silently kill create.
 */
export const _CREATE_REQUEST_TIMEOUT_FLOOR = 120.0;

/** How many file/status lines a live progress block keeps. The display itself shows only the last `EBX_ACTIVITY_LINES` (default 6). */
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
// AI template generation helpers for `ebx create "<description>"`
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
 * agent's last six activity lines in grey (`EBX_ACTIVITY_LINES`, 1–10) that scroll line by line -- its
 * recent text and a short redacted tool detail (command, url, query, or path). File bytes, thinking, and
 * credentials stay hidden. `--verbose` keeps the same block as a self-erasing one that log output is written around.
 * Every other mode (non-TTY, `--json`): one machine-readable progress line on
 * stderr; quiet and CI stay silent. stdout is never touched in any mode.
 *
 * `body` receives the `update(summary)` callable to hand to the agent as `onActivity`, or `null` when no live line is
 * drawn.
 */
export async function _phaseStatus<T>(
  out: Pick<OutputManager, "progress" | "quiet" | "activity" | "useRichSpinner">,
  message: string,
  body: (update: ActivityUpdate) => T | Promise<T>,
): Promise<T> {
  if (!out.useRichSpinner && !out.quiet) out.progress(message);
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
 * Easy Sandbox keeps only its own surface:
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

  const interactive = sandboxSeams.stdinIsatty() && !fmt.use_json;
  let sessionId = clarify.newSessionId();
  const asked: string[] = [];

  const failureHint = (assessment: clarify.ClarifyAssessment): string => {
    const parts = [`Missing details: ${assessment.missingSummary()}.`];
    if (assessment.example) parts.push(`Example description: "${assessment.example}".`);
    parts.push(
      "Add them to DESCRIPTION, pass --yes/-y to generate from the current " +
        "description anyway, or use 'ebx create --template <name>'.",
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
    [clarify.RESEARCH_REASON_AGENT_UNAVAILABLE]: "The agent could not be started; check that the agent CLI runs, then retry.",
    [clarify.RESEARCH_REASON_COMMAND_FAILED]: "The agent command failed; re-run with --verbose to inspect the agent's output.",
    [clarify.RESEARCH_REASON_TURN_LIMIT]:
      "The research used up its step budget; continuing \u2014 the assessment " + "still applies safe defaults.",
  };

  const researchFailureWarning = (research: unknown): string => {
    // The outcome is bool-compatible (legacy backends return a plain `bool`), so the stable `reason` attribute is read
    // defensively; the sanitised `detail` is deliberately not rendered -- the warning stays terse.
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
  const researched = clarify.researchSucceeded(research);
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
      answer = await prompt(`Question ${roundNumber}: ${question}`, { default: "", show_default: false });
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
      out.warning("The agent repeated an already-answered question; generating " + "with the information collected.");
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
 * - otherwise -> `null` (the standard `~/.ebx/generated`).
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
    if (!opts.ask || opts.yes || fmt.use_json || !sandboxSeams.stdinIsatty()) return null;
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

function _withModelHint(exc: unknown, creds: { asEnv(): Record<string, string> }): unknown {
  const model = _modelInUse(creds);
  const suggestion =
    `The endpoint rejected model '${model}'. ` +
    "Pass a model this key can call: ebx create \"<description>\" --model <id> " +
    "(or ebx template init --model <id>). " +
    "Persist it with: ebx config set llm_model <id>. " +
    "EBX_LLM_MODEL and OPENAI_MODEL also work.";
  if (exc !== null && typeof exc === "object" && "suggestion" in exc) {
    (exc as { suggestion: string }).suggestion = suggestion;
  }
  return exc;
}

async function _pickReplacementModel(
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
    });
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
  opts: { yes: boolean; output_dir?: string | null; ask_output_dir?: boolean; model?: string | null },
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
        onProgress: out.useRichSpinner ? null : (message: string) => out.progress(message),
        ..._activityKwargs(backend.generate, update),
      }),
    );
  };

  try {
    const gen = await once(creds);
    if (!fmt.use_json) {
      out.info("");
      out.info(`\u2713 AI generated template: ${gen.templateName}`);
      out.info(`    Dockerfile:    ${gen.dockerfile}`);
      const commandsPy = (gen as { commandsPy?: string | null }).commandsPy ?? null;
      if (commandsPy !== null) out.info(`    commands.py:   ${commandsPy}`);
      out.info(`    template.yaml: ${gen.templateYaml}`);
    }
    return gen;
  } catch (exc) {
    const text = exc instanceof Error ? `${exc.message}\n${(exc as { suggestion?: string }).suggestion ?? ""}` : String(exc);
    if (!qwenCode.modelRejectedByEndpoint(text) || modelOverride) throw _withModelHint(exc, creds);
    if (yes || fmt.use_json || !sandboxSeams.stdinIsatty()) throw _withModelHint(exc, creds);
    const picked = await _pickReplacementModel(ctx, creds);
    if (!picked) throw _withModelHint(exc, creds);
    const configCmd = await import("./config_cmd.js");
    configCmd.writeEnvVar("EBX_LLM_MODEL", picked);
    out.success(`Stored llm_model ${picked} in ~/.ebx/.env`);
    modelOverride = picked;
    creds = await credsFor();
    const gen = await once(creds);
    if (!fmt.use_json) {
      out.info("");
      out.info(`\u2713 AI generated template: ${gen.templateName}`);
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
      throw new ClickException(`Files already exist in ${target}: ${conflicts.join(", ")}. ` + "Use --force to overwrite.");
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
  const data = safeLoadRich(readTextPy(templateYaml));
  if (!(data instanceof Map)) return;
  data.set("name", name);
  writeTextPy(templateYaml, safeDump(data));
}

/** Shown as the default when the generated folder name is not known yet. */
export const _AUTO_PROJECT_DIR = "./<name>";

/**
 * Check `chosen` can become the template project. Do not create it.
 *
 * @throws UsageError The path is a file, or cannot be created under a writable directory.
 * @throws ClickException The directory already holds template files and `force` is not set.
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
      throw new ClickException(`Files already exist in ${target}: ${conflicts.join(", ")}. ` + "Use --force to overwrite.");
    }
  }
  return target;
}

/**
 * Ask where `ebx init "DESCRIPTION"` should write the project.
 *
 * Returns the chosen directory, or `null` to keep `./<name>/` (or `./<--name>/`). `--yes`, `--json`, and a
 * non-interactive terminal skip the prompt. Enter accepts the default. Nothing is created here.
 */
export async function _promptProjectDirectory(
  ctx: Context,
  opts: { yes: boolean; name: string | null; force: boolean },
): Promise<string | null> {
  const fmt = getFormatter(ctx);
  if (opts.yes || fmt.use_json || !sandboxSeams.stdinIsatty()) return null;
  const defaultDirectory = opts.name ? `./${opts.name}` : _AUTO_PROJECT_DIR;
  let chosen: string = await prompt("Directory for the template project", { default: defaultDirectory, err: true });
  chosen = pyStrip(chosen);
  if (!chosen || chosen === defaultDirectory || chosen === _AUTO_PROJECT_DIR) return null;
  return _validateProjectDirectory(chosen, { force: opts.force });
}

/**
 * Generate a local template project and stop.
 *
 * Shared by `ebx template init "DESCRIPTION"` and by the create-path switch that opts out of build, push, deploy, and
 * sandbox creation. `ask_directory` prompts for the project directory before generation (init). The create switch
 * keeps `./<name>/`.
 */
export async function _generateLocalTemplate(
  ctx: Context,
  description: string,
  opts: { yes: boolean; name?: string | null; force?: boolean; ask_directory?: boolean; model?: string | null },
): Promise<void> {
  const { yes } = opts;
  const name = opts.name ?? null;
  const force = opts.force ?? false;
  const askDirectory = opts.ask_directory ?? false;
  const template = await import("./template.js");

  const projectDir = askDirectory ? await _promptProjectDirectory(ctx, { yes, name, force }) : null;
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
    `Template only: ebx template init "${description}"`;
  if (!sandboxSeams.stdinIsatty()) {
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
 * Generate a template with the coding agent, build+deploy it, return its ref.
 *
 * `output_dir` is `--dir`: the parent directory for the generated workspace (an interactive terminal is asked when it
 * is omitted).
 *
 * Returns the template ID (or name) to pass to `Sandbox.create`.
 */
export async function _generateAndDeployTemplate(
  ctx: Context,
  description: string,
  opts: { yes: boolean; acr_namespace: string | null; verbose: boolean; output_dir?: string | null; model?: string | null },
): Promise<string> {
  const { yes, verbose } = opts;
  const template = await import("./template.js");

  const gen = await _generateTemplateWorkspace(ctx, description, {
    yes,
    output_dir: opts.output_dir ?? null,
    ask_output_dir: true,
    model: opts.model ?? null,
  });

  if (!yes) {
    if (!sandboxSeams.stdinIsatty()) {
      throw new UsageError(
        "Confirmation required to build and deploy the AI-generated template. " + "Use --yes/-y to skip in non-interactive mode.",
      );
    }
    await confirm(`Build and deploy template '${gen.templateName}' now?`, { abort: true });
  }

  const namespace = await template.resolve_acr_namespace(opts.acr_namespace);
  const data = await template.do_deploy(String(gen.workdir), { acr_namespace: namespace, ctx, verbose });
  let templateRef = pyStrip(String((data as Record<string, unknown>)["TemplateID"] || ""));
  if (!templateRef || templateRef === "N/A") templateRef = gen.templateName;
  return templateRef;
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
  params: [
    argument(["description"], { required: false, default: null }),
    option(["--template", "-T"], { default: null, help: "Template ID or alias to launch (e.g. 'base', 'python-hello'). " + "Defaults to 'base' when omitted. Cannot be combined with DESCRIPTION." }),
    option(["--upload", "-u"], { type: new Path({ exists: true }), default: null, help: "Local file or directory to upload after creation" }),
    option(["--timeout", "-t", "cmd_timeout"], { type: INT, default: null, help: "Sandbox lifetime in seconds (positive integer; default: global --timeout)" }),
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
    option(["--yes", "-y"], {
      is_flag: true,
      default: false,
      help:
        "Skip interactive prompts (the template-only switch, Qwen Code install, " +
        "credentials, description clarification, build/deploy confirmation) and run " +
        "the full create pipeline. Required for AI generation in non-interactive shells.",
    }),
    option(["--model"], {
      default: null,
      help:
        "Model id for the Qwen Code generation step (for example qwen-coder-plus). " +
        "Overrides llm_model / EBX_LLM_MODEL / OPENAI_MODEL for this command. " +
        "When the endpoint rejects the model, an interactive terminal offers coding and chat models with the arrow keys.",
    }),
    option(["--acr-namespace"], {
      envvar: "ACR_NAMESPACE",
      default: null,
      help: "ACR namespace for building the AI-generated template " + "(env: ACR_NAMESPACE, or set in .env file)",
    }),
    option(["--dir", "output_dir"], {
      default: null,
      metavar: "DIRECTORY",
      help:
        "Parent directory for the AI-generated template files (Dockerfile, " +
        "commands.py, template.yaml); a new <name>-<timestamp>-<id> subfolder is created inside it. " +
        "Default: ~/.ebx/generated (an interactive terminal is asked when omitted).",
    }),
    option(["-v", "--verbose", "verbose_flag"], { is_flag: true, help: "Verbose output (DEBUG level)" }),
  ],
  callback: handleErrors(async (ctx: Context, params) => {
    const description: string | null = params["description"];
    const template: string | null = params["template"];
    const upload: string | null = params["upload"];
    const cmdTimeout: number | null = params["cmd_timeout"];
    const requestTimeout: number | null = params["request_timeout"];
    const env: string[] = params["env"];
    const metadata: string[] = params["metadata"];
    const yes: boolean = params["yes"];
    const model: string | null = params["model"];
    const acrNamespace: string | null = params["acr_namespace"];
    const outputDir: string | null = params["output_dir"];
    const verboseFlag: boolean = params["verbose_flag"];

    if (verboseFlag) enableVerbose(ctx);

    // Routing guard: one of the three routes must be explicit. An implicit 'base' fallback made `ebx create` with no
    // arguments easy to trigger by accident (e.g. a dropped argument), so require an explicit choice and show all three
    // paths instead. Emitted directly on stderr with exit code 2 (usage-error contract) instead of raising
    // `UsageError`, which `handleErrors` would re-wrap to exit 1.
    if (!description && !template) {
      echo(
        "Error: No DESCRIPTION or --template given. Choose one of:\n\n" +
          "  ebx create --template base       launch the explicit base template\n" +
          "  ebx create --template <NAME>     launch an existing template (no AI)\n" +
          '  ebx create "<DESCRIPTION>"      AI-generate, build, deploy, create',
        { err: true },
      );
      sysExit(2);
    }

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
        "--dir only applies to AI template generation; pass a DESCRIPTION, " + "or drop --dir when launching an existing template.",
      );
    }

    const fmt = getFormatter(ctx);

    // ---- AI template generation when description given and --template omitted --
    let effectiveTemplate = template || "base";
    if (description && !template) {
      if (await _wantsTemplateOnly(ctx, description, { yes })) {
        if (outputDir) {
          getOutput(ctx).warning("--dir is ignored for template-only generation; the files are " + "written to ./<name>/.");
        }
        await _generateLocalTemplate(ctx, description, { yes, model });
        return;
      }
      effectiveTemplate = await _generateAndDeployTemplate(ctx, description, {
        yes,
        acr_namespace: acrNamespace,
        verbose: verboseFlag,
        output_dir: outputDir,
        model,
      });
      if (!fmt.use_json) {
        const out = getOutput(ctx);
        if (!out.useRichSpinner) {
          // The spinner below already announces creation in TTY mode; only print the plain progress line in degraded modes.
          out.progress("Creating...");
        }
      }
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

    // Build create kwargs
    const createKwargs: Record<string, unknown> = { template: effectiveTemplate };
    if (cmdTimeout !== null) createKwargs["timeout"] = cmdTimeout;
    else createKwargs["timeout"] = ctx.obj !== null && ctx.obj !== undefined && "timeout" in ctx.obj ? ctx.obj["timeout"] : 300;
    if (Object.keys(envs).length > 0) createKwargs["envs"] = envs;
    if (Object.keys(meta).length > 0) createKwargs["metadata"] = meta;

    // HTTP timeout for the create call: sandbox creation (cold start) is known to be slow, so we always enforce a floor of
    // 120s. If the user configured a *larger* http_timeout (e.g. 300s) that is respected; if they configured a *smaller*
    // value (e.g. 30s) or left the default, we bump to the floor. --request-timeout always wins when provided.
    if (requestTimeout !== null) {
      createKwargs["request_timeout"] = requestTimeout;
    } else {
      const configured = loadConfig().http_timeout;
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
    if (!createView.legacy) {
      if (!out.jsonMode) data["ID"] = printedId(createView, sandbox.id);
      else data["provider"] = createView.effective;
    }
    // Result channel (task 167): the machine-consumable document goes to stdout; the success notice is skipped in --json
    // mode so that stdout stays a single parseable JSON document.
    out.data(data);
    if (!out.jsonMode) out.success(`Sandbox ${printedId(createView, sandbox.id)} created successfully.`);
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
    if (view.effective !== BUILTIN_PROVIDER_ID) {
      const found = await Sandbox.list({
        status: status ? (status as SandboxStatus) : null,
        limit,
        provider: view.effective,
        provider_options: scopedFlagOptions("--region", "region", region, view),
      });
      _printSandboxList(fmt, view, found.map((sb) => ({ provider: view.effective, info: sb })));
      return;
    }

    const config = loadConfig({ region });
    const auth = createAuthProvider({
      api_key: config.api_key,
      access_key_id: config.access_key_id,
      access_key_secret: config.access_key_secret,
    });
    const httpClient = new HttpClient(config, auth);
    const proto = new SandboxProtocol(httpClient);

    const sbStatus = status ? (status as SandboxStatus) : null;
    const sandboxes = await proto.list({ status: sbStatus, limit });

    if (!sandboxes.length) {
      fmt.printSuccess("No sandboxes found.");
      return;
    }

    if (!view.legacy) {
      _printSandboxList(fmt, view, sandboxes.map((sb) => ({ provider: BUILTIN_PROVIDER_ID, info: sb })));
      return;
    }
    const headers = ["ID", "Template", "Status", "Region"];
    const rows = sandboxes.map((sb) => [sb.sandbox_id, sb.template, sb.status, sb.region]);
    fmt.printTable(headers, rows);
  }),
});

interface ListedSandbox {
  provider: string;
  info: { sandbox_id: string; template: string; status: unknown; region: string };
}

/** Qualified ids in text mode, a `provider` key in JSON (spec section 4.4). */
function _printSandboxList(fmt: OutputFormatter, view: ReturnType<typeof providerView>, listed: ListedSandbox[], withColumn = false): void {
  if (!listed.length) {
    fmt.printSuccess("No sandboxes found.");
    return;
  }
  if (fmt.use_json) {
    fmt.printData(
      listed.map(({ provider, info: sb }) => new Map<string, unknown>([
        ["ID", sb.sandbox_id], ["Template", sb.template], ["Status", sb.status], ["Region", sb.region], ["provider", provider],
      ])),
    );
    return;
  }
  const headers = withColumn ? ["ID", "Template", "Status", "Region", "Provider"] : ["ID", "Template", "Status", "Region"];
  const rows = listed.map(({ provider, info: sb }) => {
    const row = [printedId(view, sb.sandbox_id, provider), sb.template, String(sb.status), sb.region];
    return withColumn ? [...row, provider] : row;
  });
  fmt.printTable(headers, rows);
}

/** `ebx list --all-providers`: every configured provider; a failing one is skipped with a warning. */
async function _listAllProviders(fmt: OutputFormatter, status: string | null, limit: number): Promise<void> {
  const view = { ...providerView(), legacy: false, ambient: "" };
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
      ID: infoView.legacy || fmt.use_json ? sbInfo.sandbox_id : printedId(infoView, sbInfo.sandbox_id),
      Template: sbInfo.template,
      Status: sbInfo.status,
      Region: sbInfo.region,
      Timeout: `${sbInfo.timeout}s`,
      URL: sbInfo.envd_url || "N/A",
    };
    if (sbInfo.envd_version) data["EnvdVersion"] = sbInfo.envd_version;
    if (sbInfo.started_at) data["Started"] = pyStr(sbInfo.started_at);
    if (sbInfo.metadata && Object.keys(sbInfo.metadata).length > 0) data["Metadata"] = pyStr(sbInfo.metadata);
    if (!infoView.legacy) data[fmt.use_json ? "provider" : "Provider"] = infoView.effective;

    fmt.printDict(data);
  }),
});

// ---------------------------------------------------------------------------------------------------------------------
// kill
// ---------------------------------------------------------------------------------------------------------------------

async function _connectAndKill(sid: string): Promise<void> {
  const sbx = await Sandbox.connect(sid);
  await sbx.kill();
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
      fmt.printError("Either provide a sandbox ID or use --all.", { suggestion: "Usage: ebx kill <sandbox-id> or ebx kill --all" });
      sysExit(2);
    }

    if (killAll) {
      const killView = providerView();
      let sandboxes: Array<{ sandbox_id: string }>;
      if (killView.effective !== BUILTIN_PROVIDER_ID) {
        sandboxes = (
          await Sandbox.list({
            status: SandboxStatus.RUNNING,
            provider: killView.effective,
            provider_options: scopedFlagOptions("--region", "region", region, killView),
          })
        ).map((sb) => ({ sandbox_id: `${killView.effective}:${sb.sandbox_id}` }));
      } else {
        const config = loadConfig({ region });
        const auth = createAuthProvider({
          api_key: config.api_key,
          access_key_id: config.access_key_id,
          access_key_secret: config.access_key_secret,
        });
        const httpClient = new HttpClient(config, auth);
        const proto = new SandboxProtocol(httpClient);
        sandboxes = await proto.list({ status: SandboxStatus.RUNNING });
      }

      if (!sandboxes.length) {
        fmt.printSuccess("No running sandboxes to kill.");
        return;
      }

      if (!yes) {
        if (!sandboxSeams.stdinIsatty()) {
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

export const exec_cmd = command("exec", {
  help: EXEC_HELP,
  params: [
    argument(["sandbox_id"]),
    argument(["command"]),
    option(["--timeout", "-t", "cmd_timeout"], { type: INT, default: 60, help: "Command timeout in seconds (positive integer; default: 60)" }),
    option(["--cwd"], { default: "", help: "Working directory (empty = container default)" }),
    option(["-v", "--verbose", "verbose_flag"], { is_flag: true, help: "Verbose output (DEBUG level)" }),
  ],
  callback: handleErrors(async (ctx: Context, params) => {
    const sandboxId: string = params["sandbox_id"];
    const command_: string = params["command"];
    const cmdTimeout: number = params["cmd_timeout"];
    const cwd: string = params["cwd"];
    const verboseFlag: boolean = params["verbose_flag"];

    if (verboseFlag) enableVerbose(ctx);

    const fmt = getFormatter(ctx);

    const sandbox = await Sandbox.connect(sandboxId);
    const result = (await sandbox.commands.run(command_, { timeout: cmdTimeout, cwd })) as unknown as {
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
      cmd = await input(`ebx:${cpSlice(sandboxId, 0, 8)}> `);
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
      // Hardcoded 30s timeout for interactive commands to prevent indefinite hangs; long-running tasks should use 'ebx
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
// run (custom command)
// ---------------------------------------------------------------------------------------------------------------------

/** Parse Click extra-args (`--key value` pairs) into a dict. */
export function _parseExtraArgs(extra: readonly string[], fmt: OutputFormatter): Record<string, string> {
  const kwargs: Record<string, string> = {};
  let i = 0;
  while (i < extra.length) {
    const arg = extra[i] as string;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (!key) {
        fmt.printError("Empty option name: '--'");
        sysExit(2);
      }
      // Next token is the value unless it's another option
      if (i + 1 < extra.length && !(extra[i + 1] as string).startsWith("--")) {
        kwargs[key] = extra[i + 1] as string;
        i += 2;
      } else {
        // Treat as boolean flag
        kwargs[key] = "true";
        i += 1;
      }
    } else {
      fmt.printError(`Unexpected positional argument: ${pyRepr(arg)}`);
      sysExit(2);
    }
  }
  return kwargs;
}

/** Print a `ProcessResult` using `fmt`. */
export function _printProcessResult(
  fmt: OutputFormatter,
  result: { stdout: string; stderr: string; exit_code: number; execution_time: number },
): void {
  if (fmt.use_json) {
    fmt.printData(_processResultData(result));
  } else {
    if (result.stdout) echo(result.stdout, { nl: false });
    if (result.stderr) echo(result.stderr, { err: true, nl: false });
  }
}

export const run_cmd = command("run", {
  help: RUN_HELP,
  context_settings: { ignore_unknown_options: true, allow_extra_args: true },
  params: [
    argument(["sandbox_id"]),
    argument(["command_name"]),
    option(["--arg", "-a", "args"], { multiple: true, help: "Command argument as key=value (repeatable, legacy style)" }),
  ],
  callback: handleErrors(async (ctx: Context, params) => {
    const sandboxId: string = params["sandbox_id"];
    const commandName: string = params["command_name"];
    const args: string[] = params["args"];

    const fmt = getFormatter(ctx);

    // -- Parse arguments --------------------------------------------------
    const kwargs: Record<string, string> = {};

    // Legacy --arg key=value
    for (const item of args) {
      const at = item.indexOf("=");
      if (at >= 0) {
        kwargs[item.slice(0, at)] = item.slice(at + 1);
      } else {
        fmt.printError(`Invalid argument format: ${pyRepr(item)} (expected key=value)`);
        sysExit(2);
      }
    }

    // New-style --key value from extra args
    Object.assign(kwargs, _parseExtraArgs(ctx.args, fmt));

    // -- Connect and dispatch ----------------------------------------------
    const sandbox = await Sandbox.connect(sandboxId);

    // server_port is a reserved kwarg controlling mechanism-B routing; it is never forwarded as a command argument.
    let port: number | bigint = 9000;
    if (Object.hasOwn(kwargs, "server_port")) {
      const raw = kwargs["server_port"] as string;
      delete kwargs["server_port"];
      const parsed = parseIntStrict(raw);
      if (parsed === null) {
        fmt.printError("server_port must be an integer");
        sysExit(2);
      } else {
        port = parsed;
      }
    }

    // sandbox.custom() resolves template commands (A) then falls back to the in-sandbox SandboxServer registry (B),
    // returning a unified CommandResult. This preserves the historic `ebx run` A->B routing.
    let result: Awaited<ReturnType<Sandbox["custom"]>>;
    try {
      result = await sandbox.custom(commandName, { server_port: port, ...kwargs });
    } catch (exc) {
      if (exc instanceof CommandNotFoundError || exc instanceof ValueError) {
        fmt.printError(pyStr(exc));
        sysExit(2);
      }
      throw exc;
    }

    if (result.source === "server") {
      // Mechanism B: print the function's JSON return value.
      if (fmt.use_json) fmt.printData({ result: result.value });
      else echo(result.value === null || result.value === undefined ? null : pyStr(result.value));
      sysExit(result.success ? 0 : 1);
    }

    // Mechanism A: print process stdout/stderr like the old template path.
    _printProcessResult(fmt, result);
    sysExit(result.exit_code);
  }),
});

// ---------------------------------------------------------------------------------------------------------------------
// run_cmd helpers
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Best-effort: scan `*.py` in the current directory for `@sandbox.register`.
 *
 * Files containing the literal `sandbox.register` are imported so that registrations are triggered on the module-level
 * `sandbox` singleton. Failures are silently ignored.
 *
 * **Opt-in behaviour** (security hardening): discovery is gated behind an explicit opt-in to prevent accidental code
 * execution when the CLI is invoked from an untrusted directory. At least one of the following conditions must hold:
 *
 * - The `EBX_DISCOVER_COMMANDS` environment variable is set to a truthy value (`1`, `true`, `yes`).
 * - A `.ebx` marker file or directory exists in the current working directory, indicating a trusted Easy-Sandbox project
 *   root.
 *
 * When neither condition is satisfied the function returns immediately without scanning.
 *
 * SECURITY NOTE: matched Python files are *executed* during loading (`sandboxSeams.discoverImport`). Only enable
 * discovery in project directories whose `.py` files you trust. The scan is limited to top-level files in the current
 * directory (no recursive descent) and only files whose names are valid Python identifiers are considered.
 */
export async function _discoverRegisteredCommands(): Promise<void> {
  // ---- Opt-in gate -------------------------------------------------------
  const truthy = new Set(["1", "true", "yes"]);
  const envFlag = pyStrip(process.env["EBX_DISCOVER_COMMANDS"] ?? "").toLowerCase();
  const cwd = process.cwd();
  const markerExists = pathExists(nodePath.join(cwd, ".ebx"));

  if (!truthy.has(envFlag) && !markerExists) {
    _log.debug("Skipping command discovery: set EBX_DISCOVER_COMMANDS=1 " + "or create a .ebx marker in the project root to enable.");
    return;
  }

  // ---- Safe filename filter -----------------------------------------------
  const safeStem = /^[A-Za-z_][A-Za-z0-9_]*$/;

  let names: string[];
  try {
    names = fs.readdirSync(cwd).filter((entry) => entry.endsWith(".py"));
  } catch {
    return;
  }
  names.sort(cmpStr);
  for (const name of names) {
    const stem = name === ".py" ? name : name.slice(0, -3);
    if (!safeStem.test(stem)) {
      _log.debug("Skipping %s: stem is not a valid Python identifier", name);
      continue;
    }
    try {
      const text = fs.readFileSync(nodePath.join(cwd, name)).toString("utf-8");
      if (!text.includes("sandbox.register")) continue;
      await sandboxSeams.discoverImport(`_ebx_discover_${stem}`, nodePath.join(cwd, name));
    } catch {
      _log.debug("Failed to import %s during command discovery", name);
      continue;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// sandbox group (ebx sandbox list/info/kill/...)
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
sandbox.addCommand(run_cmd, "run");

// Sub-groups for extended server capabilities
sandbox.addCommand(files, "files");
sandbox.addCommand(process_, "process");
sandbox.addCommand(system, "system");
sandbox.addCommand(capabilities, "capabilities");
sandbox.addCommand(shell_stream, "shell-stream");

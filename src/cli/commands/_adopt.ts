/**
 * `abx template init --adopt` orchestration (port of `cli/commands/_adopt.py`).
 *
 * The agent work and the safety checks live in `agent/adopt.ts`. This module only talks to the user: consent, the
 * preview, and translating rejections into Click errors.
 */

import fs from "node:fs";
import nodePath from "node:path";

import { getCurrentContext, type Context } from "../kit.js";
import { Abort, CliError, UsageError } from "../errors.js";
import { sys } from "../io.js";
import { confirm } from "../prompts.js";
import { structuredPatch } from "diff";
import { isatty } from "../io.js";
import {
  ADOPT_SESSION_TURNS,
  AdoptRejectedError,
  assertAdoptable,
  buildAdoptPrompt,
  defaultTemplateName,
  planFromStaging,
  preflight,
  promote,
  stageProject,
  validateTemplateName,
  type AdoptPlan,
  type StagedProject,
} from "../../agent/adopt.js";
import { pyExpandUser, pyResolve } from "../../utils/_pyos.js";
import { getFormatter } from "../formatters.js";
import { enableVerbose, getOutput, isCiEnv } from "../output.js";
import * as codingAgent from "./_coding_agent.js";
import { _printInitSummary } from "./template.js";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const _PREVIEW_LINES = 200;

/** Patch points (the TypeScript counterparts of the module attributes the Python tests monkeypatch). */
export const adoptSeams: {
  _isInteractive: (fmt: Any) => boolean;
  stdinIsatty: () => boolean;
  isCiEnv: () => boolean;
} = {
  _isInteractive: (fmt) => _isInteractive(fmt),
  stdinIsatty: () => isatty(sys.stdin),
  isCiEnv: () => isCiEnv(),
};

function usageError(message: string): UsageError {
  return new UsageError(message, getCurrentContext(true));
}

export interface RunAdoptOptions {
  hint: string | null;
  name: string | null;
  dry_run: boolean;
  force: boolean;
  yes: boolean;
  verbose: boolean;
}

/** Phase status for the generation flow: a progress line when no spinner is drawn, then the live activity block. */
async function _phaseStatus<T>(out: Any, message: string, fn: (update: ((summary: string) => void) | null) => Promise<T>): Promise<T> {
  const liveStatus = out.useLiveStatus ?? out.use_live_status;
  if (!liveStatus && !out.quiet) out.progress(message);
  return await out.activity(message, fn);
}

/** Adapt `directory` (default `.`) into a template. Nothing is deployed. */
export async function runAdopt(ctx: Context, directory: string | null, opts: RunAdoptOptions): Promise<void> {
  const { hint, name, dry_run: dryRun, force, yes, verbose } = opts;

  if (verbose) enableVerbose(ctx);

  const fmt = getFormatter(ctx);
  const out = getOutput(ctx);
  const interactive = adoptSeams._isInteractive(fmt);
  const needsConfirm = interactive && !yes;

  let project: string;
  let templateName: string;
  let state: ReturnType<typeof preflight>;
  try {
    project = assertAdoptable(pyExpandUser(directory || "."));
    templateName = name ? validateTemplateName(name) : defaultTemplateName(project);
    state = preflight(project, { force, needsConfirm });
  } catch (exc) {
    if (exc instanceof AdoptRejectedError) _reraise(exc);
    throw exc;
  }

  if (!dryRun && !yes && !interactive) {
    throw usageError(
      "Confirmation required before project files are sent to the model. " +
        "Use --yes/-y to approve, or --dry-run to list the files without sending them.",
    );
  }

  let staged: StagedProject;
  try {
    staged = stageProject(project);
  } catch (exc) {
    if (exc instanceof AdoptRejectedError) _reraise(exc);
    throw exc;
  }
  let cleanup = false;
  try {
    if (dryRun) {
      _emitDryRun(ctx, out, project, templateName, staged);
      cleanup = true;
      return;
    }

    const backend = codingAgent.resolveCodingAgentBackend();
    const binary = await codingAgent.ensureCodingAgentBinary(ctx, { yes, backend });
    const credentials = await codingAgent.resolveCodingAgentCredentials(ctx, { yes, backend });
    const host = _modelHost(credentials);
    _announce(out, project, templateName, staged, host);
    if (needsConfirm && !(await confirm(`Send ${staged.copied.length} files to ${host}?`, { default: true, err: true }))) {
      out.info("Nothing was sent.");
      cleanup = true;
      throw new Abort();
    }

    const existing = Object.entries(state.hashes)
      .filter(([, digest]) => digest !== null)
      .map(([n]) => n);
    const prompt = buildAdoptPrompt(staged, { hint, templateName, existing });
    const raw = await _phaseStatus(out, "Adapting project", async (update) =>
      backend.runInWorkspace(prompt, {
        workdir: staged.stagingDir,
        binary,
        env: credentials.asEnv(),
        maxSessionTurns: ADOPT_SESSION_TURNS,
        ...(update !== null ? { onActivity: update } : {}),
      }),
    );
    const plan = planFromStaging(project, staged, { templateName, rawOutput: raw });
    for (const warning of plan.warnings) {
      out.warning(warning);
    }
    _preview(out, project, plan);
    if (needsConfirm && !(await confirm("Write these files?", { default: true, err: true }))) {
      out.info(`Nothing was written. Staging kept at ${staged.stagingDir}`);
      throw new Abort();
    }

    let result: ReturnType<typeof promote>;
    try {
      result = promote(project, plan, state);
    } catch (exc) {
      if (exc instanceof AdoptRejectedError) _reraise(exc);
      throw exc;
    }
    cleanup = true;
    const dirArg = project === pyResolve(process.cwd()) ? "." : String(project);
    _printInitSummary(fmt, out, project, [...result.written], templateName, {
      replaced: [...plan.replaces],
      backed_up: [...result.backedUp],
      not_applied: [...plan.notApplied],
      next_steps: [`abx deploy ${dirArg} -y`],
    });
  } finally {
    if (cleanup) fs.rmSync(staged.stagingDir, { recursive: true, force: true });
  }
}

/** True only on a terminal that is not JSON and not CI. */
export function _isInteractive(fmt: Any): boolean {
  return adoptSeams.stdinIsatty() && !fmt.use_json && !adoptSeams.isCiEnv();
}

function _reraise(exc: AdoptRejectedError): never {
  if (exc.usage) throw usageError(exc.message);
  throw new CliError(exc.message);
}

/** `urllib.parse.urlparse(base).netloc`. */
function _netloc(value: string): string {
  let rest = value;
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(rest);
  if (scheme) rest = rest.slice(scheme[0].length);
  if (!rest.startsWith("//")) return "";
  const tail = rest.slice(2);
  const end = tail.search(/[/?#]/);
  return end < 0 ? tail : tail.slice(0, end);
}

function _modelHost(credentials: Any): string {
  const baseValue = credentials?.baseUrl ?? credentials?.base_url ?? "";
  const base = String(baseValue || "");
  if (!base) return "the model provider";
  const host = _netloc(base);
  return host || base;
}

function _announce(out: Any, project: string, name: string, staged: StagedProject, host: string): void {
  const kilobytes = Math.max(staged.totalBytes, 1) / 1024;
  out.info(
    `Adopting ${project} as template '${name}': ` + `${staged.copied.length} files (${_formatFixed0(kilobytes)} KB) would be sent to ${host}.`,
  );
  const reasons = Object.keys(staged.excluded);
  if (reasons.length > 0) {
    const counts = [...reasons]
      .sort()
      .map((reason) => `${(staged.excluded[reason] as readonly string[]).length} ${reason}`)
      .join(", ");
    out.info(`Excluded: ${counts}.`);
  }
}

/** Python `f"{value:.0f}"` (round-half-to-even on exact halves). */
function _formatFixed0(value: number): string {
  const floor = Math.floor(value);
  const diff = value - floor;
  let rounded: number;
  if (diff === 0.5) rounded = floor % 2 === 0 ? floor : floor + 1;
  else rounded = Math.round(value);
  return String(rounded);
}

function _emitDryRun(ctx: Context, out: Any, project: string, name: string, staged: StagedProject): void {
  const fmt = getFormatter(ctx);
  _announce(out, project, name, staged, "the model provider (nothing is sent)");
  if (fmt.use_json) {
    const excluded: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(staged.excluded)) excluded[key] = [...values];
    fmt.printData({
      name,
      directory: String(project),
      dry_run: true,
      would_send: [...staged.copied],
      excluded,
      bytes: staged.totalBytes,
    });
    return;
  }
  out.info("Would send:");
  for (const p of staged.copied) {
    out.info(`  ${p}`);
  }
  for (const reason of Object.keys(staged.excluded).sort()) {
    out.info(`Excluded (${reason}):`);
    for (const p of staged.excluded[reason] as readonly string[]) {
      out.info(`  ${p}`);
    }
  }
  out.info("Dry run: no files were sent or written.");
}

function _preview(out: Any, project: string, plan: AdoptPlan): void {
  for (const [rel, content] of Object.entries(plan.files)) {
    const current = nodePath.join(project, rel);
    let isFile: boolean;
    try {
      isFile = fs.statSync(current).isFile();
    } catch {
      isFile = false;
    }
    const old = isFile ? new TextDecoder("utf-8", { fatal: false }).decode(fs.readFileSync(current)).replace(/\r\n?/g, "\n") : "";
    if (isFile) {
      const diff = unifiedDiff(splitlinesKeepends(old), splitlinesKeepends(content), rel, rel).join("");
      out.info(`~ ${rel}`);
      _bounded(out, diff || "(no changes)\n");
    } else {
      out.info(`+ ${rel}`);
      _bounded(out, content);
    }
  }
}

function _bounded(out: Any, text: string): void {
  const lines = splitlines(text);
  for (const line of lines.slice(0, _PREVIEW_LINES)) {
    out.info(`  ${line}`);
  }
  if (lines.length > _PREVIEW_LINES) {
    out.info(`  \u2026 ${lines.length - _PREVIEW_LINES} more lines`);
  }
}

const _LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/g;

/** Python `str.splitlines()`. */
export function splitlines(text: string): string[] {
  return splitlinesKeepends(text).map((line) => line.replace(/(?:\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029])$/, ""));
}

/** Python `str.splitlines(keepends=True)`. */
export function splitlinesKeepends(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  _LINE_BREAK.lastIndex = 0;
  for (let m = _LINE_BREAK.exec(text); m !== null; m = _LINE_BREAK.exec(text)) {
    lines.push(text.slice(start, m.index + m[0].length));
    start = m.index + m[0].length;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}
/** Unified diff of two line lists (lines keep their terminators), as an array of output lines. */
export function unifiedDiff(a: string[], b: string[], fromfile: string, tofile: string, n = 3): string[] {
  const patch = structuredPatch(fromfile, tofile, a.join(""), b.join(""), undefined, undefined, { context: n });
  if (patch.hunks.length === 0) return [];
  const out = [`--- ${fromfile}\n`, `+++ ${tofile}\n`];
  for (const h of patch.hunks) {
    const range = (start: number, len: number): string => (len === 1 ? `${start}` : `${len === 0 ? start - 1 : start},${len}`);
    out.push(`@@ -${range(h.oldStart, h.oldLines)} +${range(h.newStart, h.newLines)} @@\n`);
    for (const line of h.lines) out.push(`${line}\n`);
  }
  return out;
}

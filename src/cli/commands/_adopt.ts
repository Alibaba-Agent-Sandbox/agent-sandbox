/**
 * `ebx template init --adopt` orchestration (port of `cli/commands/_adopt.py`).
 *
 * The agent work and the safety checks live in `agent/adopt.ts`. This module only talks to the user: consent, the
 * preview, and translating rejections into Click errors.
 */

import fs from "node:fs";
import nodePath from "node:path";

import { Abort, ClickException, UsageError, confirm, getCurrentContext, sys, type Context } from "../../framework/index.js";
import { SequenceMatcher } from "../../framework/difflib.js";
import { isatty } from "../../framework/io.js";
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
  const richSpinner = out.useRichSpinner ?? out.use_rich_spinner;
  if (!richSpinner && !out.quiet) out.progress(message);
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
      next_steps: [`ebx deploy ${dirArg} --acr-namespace <ns>`],
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
  throw new ClickException(exc.message);
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

type Opcode = [tag: string, i1: number, i2: number, j1: number, j2: number];

function _getOpcodes(sm: SequenceMatcher): Opcode[] {
  let i = 0;
  let j = 0;
  const answer: Opcode[] = [];
  for (const { a: ai, b: bj, size } of sm.getMatchingBlocks()) {
    let tag = "";
    if (i < ai && j < bj) tag = "replace";
    else if (i < ai) tag = "delete";
    else if (j < bj) tag = "insert";
    if (tag) answer.push([tag, i, ai, j, bj]);
    i = ai + size;
    j = bj + size;
    if (size) answer.push(["equal", ai, i, bj, j]);
  }
  return answer;
}

function _getGroupedOpcodes(sm: SequenceMatcher, n = 3): Opcode[][] {
  let codes = _getOpcodes(sm);
  if (codes.length === 0) codes = [["equal", 0, 1, 0, 1]];
  const first = codes[0] as Opcode;
  if (first[0] === "equal") {
    const [tag, i1, i2, j1, j2] = first;
    codes[0] = [tag, Math.max(i1, i2 - n), i2, Math.max(j1, j2 - n), j2];
  }
  const lastIdx = codes.length - 1;
  const last = codes[lastIdx] as Opcode;
  if (last[0] === "equal") {
    const [tag, i1, i2, j1, j2] = last;
    codes[lastIdx] = [tag, i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)];
  }
  const nn = n + n;
  const groups: Opcode[][] = [];
  let group: Opcode[] = [];
  for (const code of codes) {
    const [tag, i1Start, i2, j1Start, j2] = code;
    let i1 = i1Start;
    let j1 = j1Start;
    // End the current group and start a new one whenever there is a large range with no changes.
    if (tag === "equal" && i2 - i1 > nn) {
      group.push([tag, i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)]);
      groups.push(group);
      group = [];
      i1 = Math.max(i1, i2 - n);
      j1 = Math.max(j1, j2 - n);
    }
    group.push([tag, i1, i2, j1, j2]);
  }
  if (group.length > 0 && !(group.length === 1 && (group[0] as Opcode)[0] === "equal")) groups.push(group);
  return groups;
}

function _formatRangeUnified(start: number, stop: number): string {
  let beginning = start + 1;
  const length = stop - start;
  if (length === 1) return String(beginning);
  if (!length) beginning -= 1;
  return `${beginning},${length}`;
}

/** `difflib.unified_diff(a, b, fromfile=..., tofile=...)` with the default context of 3 lines. */
export function unifiedDiff(a: string[], b: string[], fromfile: string, tofile: string, n = 3): string[] {
  const out: string[] = [];
  const sm = new SequenceMatcher(null, a, b);
  let started = false;
  for (const group of _getGroupedOpcodes(sm, n)) {
    if (!started) {
      started = true;
      out.push(`--- ${fromfile}\n`);
      out.push(`+++ ${tofile}\n`);
    }
    const first = group[0] as Opcode;
    const last = group[group.length - 1] as Opcode;
    out.push(`@@ -${_formatRangeUnified(first[1], last[2])} +${_formatRangeUnified(first[3], last[4])} @@\n`);
    for (const [tag, i1, i2, j1, j2] of group) {
      if (tag === "equal") {
        for (const line of a.slice(i1, i2)) out.push(` ${line}`);
        continue;
      }
      if (tag === "replace" || tag === "delete") {
        for (const line of a.slice(i1, i2)) out.push(`-${line}`);
      }
      if (tag === "replace" || tag === "insert") {
        for (const line of b.slice(j1, j2)) out.push(`+${line}`);
      }
    }
  }
  return out;
}

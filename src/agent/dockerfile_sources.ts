/**
 * Minimal `COPY` / `ADD` source extraction from a Dockerfile.
 *
 * Port of `agent_sandbox/agent/dockerfile_sources.py`. `abx template init --adopt` validates AI-written Dockerfiles
 * *before* `docker build` runs for minutes. The check that matters most is "does every path the Dockerfile copies
 * actually exist in the build context?". This module extracts those source paths; deciding whether they exist is
 * the caller's job.
 *
 * Scope is deliberately small and stated:
 *
 * - handled: `# escape=` directive, line continuations, comments inside a continuation, shell and JSON forms,
 *   `--chown/--chmod/--link/--parents/--exclude/--keep-git-dir/--checksum` style flags (dropped);
 * - skipped (never a source): `--from=` copies, `ONBUILD`, URL sources, heredoc instructions and their bodies;
 * - classified rather than resolved: sources with `$VAR` are `variable` (build args are unknown), sources with
 *   `* ? [` are `glob`.
 */

import { PY_WHITESPACE, pyLstrip, pyRstrip, pySplitLines, pySplitWhitespace, pyStrip, stripChars } from "./_pycompat.js";
import { JSONDecodeError, pyJsonLoads, pyStr } from "./_py.js";

export const __all__ = ["CopySource", "parseCopySources"] as const;

export type SourceKind = "literal" | "glob" | "variable";

const WS = PY_WHITESPACE;
const HEREDOC_RE = new RegExp(`<<(-?)[${WS}]*(["']?)([A-Za-z_][A-Za-z0-9_]*)\\2`, "g");
const URL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/|git@)/i;
const DIRECTIVE_RE = new RegExp(`^#[${WS}]*escape[${WS}]*=[${WS}]*([^${WS}])[${WS}]*$`, "i");

/** One source operand of a `COPY`/`ADD` instruction. */
export class CopySource {
  /** `"COPY"` or `"ADD"`. */
  readonly instruction: string;
  readonly source: string;
  /** 1-based line of the instruction's first physical line. */
  readonly line: number;
  readonly kind: SourceKind;

  constructor(instruction: string, source: string, line: number, kind: SourceKind) {
    this.instruction = instruction;
    this.source = source;
    this.line = line;
    this.kind = kind;
    Object.freeze(this);
  }
}

function escapeChar(lines: readonly string[]): string {
  for (const raw of lines) {
    const stripped = pyStrip(raw);
    if (!stripped) break;
    const match = DIRECTIVE_RE.exec(stripped);
    if (match) return match[1] as string;
    if (!stripped.startsWith("#")) break;
  }
  return "\\";
}

/** Join continuations; return `[firstLineNumber, instructionText]`. */
export function _logicalLines(text: string): Array<[number, string]> {
  const lines = pySplitLines(text);
  const esc = escapeChar(lines);
  const result: Array<[number, string]> = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] as string;
    const stripped = pyStrip(raw);
    if (!stripped || stripped.startsWith("#")) {
      i += 1;
      continue;
    }
    const start = i + 1;
    let buf = pyRstrip(raw);
    while (buf.endsWith(esc) && i + 1 < lines.length) {
      buf = buf.slice(0, buf.length - esc.length);
      i += 1;
      const nxt = lines[i] as string;
      if (pyStrip(nxt).startsWith("#") || !pyStrip(nxt)) {
        // Comments / blanks inside a continuation are dropped, and the continuation carries on (BuildKit behaviour).
        buf += " ";
        buf = pyRstrip(buf) + esc;
        continue;
      }
      buf += pyRstrip(nxt);
    }
    buf = buf.endsWith(esc) ? buf.slice(0, buf.length - esc.length) : buf;
    result.push([start, pyStrip(buf)]);
    i += 1;
    // Consume heredoc bodies so their lines are not parsed as instructions.
    for (const match of buf.matchAll(HEREDOC_RE)) {
      const dash = match[1] as string;
      const delim = match[3] as string;
      while (i < lines.length) {
        const body = dash ? pyLstripTabs(lines[i] as string) : (lines[i] as string);
        i += 1;
        if (stripChars(body, "\r") === delim) break;
      }
    }
  }
  return result;
}

function pyLstripTabs(text: string): string {
  return text.replace(/^\t+/, "");
}

function splitFlags(args: string): [string[], string] {
  const flags: string[] = [];
  let rest = pyLstrip(args);
  while (rest.startsWith("--")) {
    const idx = rest.indexOf(" ");
    const token = idx < 0 ? rest : rest.slice(0, idx);
    const remainder = idx < 0 ? "" : rest.slice(idx + 1);
    flags.push(token);
    rest = pyLstrip(remainder);
  }
  return [flags, rest];
}

function classify(source: string): SourceKind {
  if (source.includes("$")) return "variable";
  if ([...source].some((ch) => "*?[".includes(ch))) return "glob";
  return "literal";
}

/** Return every source operand of every `COPY`/`ADD` in `text`. */
export function parseCopySources(text: string): CopySource[] {
  const found: CopySource[] = [];
  for (const [lineNo, logical] of _logicalLines(text)) {
    const idx = logical.indexOf(" ");
    const head = idx < 0 ? logical : logical.slice(0, idx);
    const args = idx < 0 ? "" : logical.slice(idx + 1);
    const instruction = head.toUpperCase();
    if (instruction !== "COPY" && instruction !== "ADD") continue;
    HEREDOC_RE.lastIndex = 0;
    if (new RegExp(HEREDOC_RE.source).test(args)) continue;
    const [flags, rest] = splitFlags(args);
    if (flags.some((flag) => flag.toLowerCase().startsWith("--from"))) continue;
    let operands: string[];
    if (rest.startsWith("[")) {
      let loaded: unknown;
      let ok = true;
      try {
        loaded = pyJsonLoads(rest);
      } catch (exc) {
        if (!(exc instanceof JSONDecodeError)) throw exc;
        ok = false;
      }
      if (!ok) operands = pySplitWhitespace(rest);
      else operands = Array.isArray(loaded) ? loaded.map((item) => pyStr(item)) : [];
    } else {
      operands = pySplitWhitespace(rest);
    }
    if (operands.length < 2) continue;
    for (const source of operands.slice(0, -1)) {
      if (URL_RE.test(source)) continue;
      found.push(new CopySource(instruction, source, lineNo, classify(source)));
    }
  }
  return found;
}

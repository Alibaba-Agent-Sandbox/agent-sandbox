/**
 * Port of `click/formatting.py` + `click/_textwrap.py` (Click 8.5) including a faithful port of the parts of
 * CPython's `textwrap.TextWrapper` that Click subclasses. Output of `HelpFormatter` is byte-identical to Click's.
 */

import { cpSlice, expandTabs, len, lstrip, rstrip, splitlines, strip } from "./py.js";
import { getTerminalSize } from "./io.js";

// ---------------------------------------------------------------------------
// ANSI helpers (click._compat)
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

/** `click._compat.strip_ansi`. */
export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}

/** `click._compat.term_len`: visible length (code points) with ANSI sequences removed. */
export function termLen(x: string): number {
  return len(stripAnsi(x));
}

// ---------------------------------------------------------------------------
// textwrap.TextWrapper (the subset Click uses: replace_whitespace=False, break_on_hyphens=True)
// ---------------------------------------------------------------------------

const WHITESPACE = "\\t\\n\\x0b\\x0c\\r ";
const WORD_PUNCT = "[\\p{L}\\p{N}_!\"'&.,?]";
const LETTER = "[\\p{L}\\p{Nl}\\p{No}_]";
const WS = `[${WHITESPACE}]`;
const NWS = `[^${WHITESPACE}]`;
const W = "[\\p{L}\\p{N}_]";

const WORDSEP_RE = new RegExp(
  `(` +
    `${WS}+` +
    `|(?<=${WORD_PUNCT})-{2,}(?=${W})` +
    `|${NWS}+?(?:` +
    `-(?:(?<=${LETTER}{2}-)|(?<=${LETTER}-${LETTER}-))(?=${LETTER}-?${LETTER})` +
    `|(?=${WS}|$)` +
    `|(?<=${WORD_PUNCT})(?=-{2,}${W})` +
    `)` +
    `)`,
  "u",
);

/** `re.split` with one capture group (CPython semantics: separators are kept, empty strings dropped by callers). */
function wordsepSplit(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(WORDSEP_RE.source, "gu");
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    out.push(text.slice(last, m.index));
    out.push(m[1] as string);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function truncateVisible(text: string, n: number): string {
  if (n <= 0) return "";
  let visible = 0;
  let i = 0;
  let cut = 0;
  const end = text.length;
  const re = /\x1b\[[0-?]*[ -/]*[@-~]/y;
  while (i < end) {
    re.lastIndex = i;
    const m = re.exec(text);
    if (m !== null) {
      i = re.lastIndex;
      continue;
    }
    const cp = text.codePointAt(i) as number;
    i += cp > 0xffff ? 2 : 1;
    visible++;
    cut = i;
    if (visible >= n) break;
  }
  return text.slice(0, cut);
}

export class TextWrapper {
  width: number;
  initial_indent: string;
  subsequent_indent: string;
  break_long_words = true;
  drop_whitespace = true;
  max_lines: number | null = null;
  placeholder = " [...]";

  constructor(width = 70, initialIndent = "", subsequentIndent = "") {
    this.width = width;
    this.initial_indent = initialIndent;
    this.subsequent_indent = subsequentIndent;
  }

  private splitChunks(text: string): string[] {
    // expand_tabs=True (tabsize 8); replace_whitespace=False
    const munged = expandTabs(text, 8);
    return wordsepSplit(munged).filter((c) => c);
  }

  private handleLongWord(reversedChunks: string[], curLine: string[], curLen: number, width: number): void {
    const spaceLeft = Math.max(width - curLen, 1);
    if (this.break_long_words) {
      const last = reversedChunks[reversedChunks.length - 1] as string;
      const cut = truncateVisible(last, spaceLeft);
      const res = last.slice(cut.length);
      curLine.push(cut);
      reversedChunks[reversedChunks.length - 1] = res;
    } else if (!curLine.length) {
      curLine.push(reversedChunks.pop() as string);
    }
  }

  private wrapChunks(chunks: string[]): string[] {
    const lines: string[] = [];
    if (this.width <= 0) throw new Error(`ValueError: invalid width ${this.width} (must be > 0)`);
    if (this.max_lines !== null) {
      const indent = this.max_lines > 1 ? this.subsequent_indent : this.initial_indent;
      if (termLen(indent) + termLen(lstrip(this.placeholder)) > this.width) {
        throw new Error("ValueError: placeholder too large for max width");
      }
    }
    chunks.reverse();
    while (chunks.length) {
      let curLine: string[] = [];
      let curLen = 0;
      const indent = lines.length ? this.subsequent_indent : this.initial_indent;
      const width = this.width - termLen(indent);
      if (this.drop_whitespace && strip(chunks[chunks.length - 1] as string) === "" && lines.length) {
        chunks.pop();
      }
      while (chunks.length) {
        const n = termLen(chunks[chunks.length - 1] as string);
        if (curLen + n <= width) {
          curLine.push(chunks.pop() as string);
          curLen += n;
        } else {
          break;
        }
      }
      if (chunks.length && termLen(chunks[chunks.length - 1] as string) > width) {
        this.handleLongWord(chunks, curLine, curLen, width);
        curLen = curLine.reduce((acc, c) => acc + termLen(c), 0);
      }
      if (this.drop_whitespace && curLine.length && strip(curLine[curLine.length - 1] as string) === "") {
        curLen -= termLen(curLine[curLine.length - 1] as string);
        curLine.pop();
      }
      if (curLine.length) {
        if (
          this.max_lines === null ||
          lines.length + 1 < this.max_lines ||
          ((!chunks.length || (this.drop_whitespace && chunks.length === 1 && !strip(chunks[0] as string))) &&
            curLen <= width)
        ) {
          lines.push(indent + curLine.join(""));
        } else {
          let placed = false;
          while (curLine.length) {
            if (strip(curLine[curLine.length - 1] as string) && curLen + termLen(this.placeholder) <= width) {
              curLine.push(this.placeholder);
              lines.push(indent + curLine.join(""));
              placed = true;
              break;
            }
            curLen -= termLen(curLine[curLine.length - 1] as string);
            curLine.pop();
          }
          if (!placed) {
            if (lines.length) {
              const prev = rstrip(lines[lines.length - 1] as string);
              if (termLen(prev) + termLen(this.placeholder) <= this.width) {
                lines[lines.length - 1] = prev + this.placeholder;
                break;
              }
            }
            lines.push(indent + lstrip(this.placeholder));
          }
          break;
        }
      }
    }
    return lines;
  }

  wrap(text: string): string[] {
    return this.wrapChunks(this.splitChunks(text));
  }

  fill(text: string): string {
    return this.wrap(text).join("\n");
  }

  /** Run `fn` with `indent` appended to both indents (Click's `extra_indent` context manager). */
  withExtraIndent<T>(indent: string, fn: () => T): T {
    const oldInitial = this.initial_indent;
    const oldSubsequent = this.subsequent_indent;
    this.initial_indent += indent;
    this.subsequent_indent += indent;
    try {
      return fn();
    } finally {
      this.initial_indent = oldInitial;
      this.subsequent_indent = oldSubsequent;
    }
  }

  indentOnly(text: string): string {
    const rv: string[] = [];
    splitlines(text).forEach((line, idx) => {
      const indent = idx > 0 ? this.subsequent_indent : this.initial_indent;
      rv.push(`${indent}${line}`);
    });
    return rv.join("\n");
  }
}

// ---------------------------------------------------------------------------
// formatting.py
// ---------------------------------------------------------------------------

/** `click.formatting.FORCED_WIDTH` (set to 80 by `CliRunner`). */
export const formatting: { FORCED_WIDTH: number | null } = { FORCED_WIDTH: null };

export function measureTable(rows: Array<[string, string]>): number[] {
  const widths = new Map<number, number>();
  for (const row of rows) {
    row.forEach((col, idx) => {
      widths.set(idx, Math.max(widths.get(idx) ?? 0, termLen(col)));
    });
  }
  return [...widths.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
}

/** `click.formatting.wrap_text`. */
export function wrapText(
  text: string,
  width = 78,
  initialIndent = "",
  subsequentIndent = "",
  preserveParagraphs = false,
): string {
  text = expandTabs(text);
  const wrapper = new TextWrapper(width, initialIndent, subsequentIndent);
  if (!preserveParagraphs) return wrapper.fill(text);

  const p: Array<[number, boolean, string]> = [];
  let buf: string[] = [];
  let indent: number | null = null;

  const flushPar = (): void => {
    if (!buf.length) return;
    if (strip(buf[0] as string) === "\b") {
      p.push([indent ?? 0, true, buf.slice(1).join("\n")]);
    } else {
      p.push([indent ?? 0, false, buf.join(" ")]);
    }
    buf = [];
  };

  for (let line of splitlines(text)) {
    if (!line) {
      flushPar();
      indent = null;
    } else {
      if (indent === null) {
        const origLen = termLen(line);
        line = lstrip(line);
        indent = origLen - termLen(line);
      }
      buf.push(line);
    }
  }
  flushPar();

  const rv: string[] = [];
  for (const [ind, raw, t] of p) {
    wrapper.withExtraIndent(" ".repeat(ind), () => {
      rv.push(raw ? wrapper.indentOnly(t) : wrapper.fill(t));
    });
  }
  return rv.join("\n\n");
}

export interface HelpFormatterOptions {
  indent_increment?: number;
  width?: number | null;
  max_width?: number | null;
}

/** `click.formatting.HelpFormatter`. */
export class HelpFormatter {
  indent_increment: number;
  width: number;
  current_indent = 0;
  buffer: string[] = [];

  constructor(opts: HelpFormatterOptions = {}) {
    this.indent_increment = opts.indent_increment ?? 2;
    const maxWidth = opts.max_width ?? 80;
    let width = opts.width ?? null;
    if (width === null) {
      width = formatting.FORCED_WIDTH;
      if (width === null) {
        width = Math.max(Math.min(getTerminalSize().columns, maxWidth) - 2, 50);
      }
    }
    this.width = width;
  }

  write(text: string): void {
    this.buffer.push(text);
  }

  indent(): void {
    this.current_indent += this.indent_increment;
  }

  dedent(): void {
    this.current_indent -= this.indent_increment;
  }

  writeUsage(prog: string, args = "", prefix: string | null = null): void {
    if (prefix === null) prefix = "Usage: ";
    const usagePrefix = `${" ".repeat(Math.max(this.current_indent - len(prefix), 0))}${prefix}${prog} `;
    const textWidth = this.width - this.current_indent;
    if (!args) {
      this.write(usagePrefix.replace(/ +$/, ""));
      this.write("\n");
      return;
    }
    if (textWidth >= termLen(usagePrefix) + 20) {
      const indent = " ".repeat(termLen(usagePrefix));
      this.write(wrapText(args, textWidth, usagePrefix, indent));
    } else {
      this.write(usagePrefix);
      this.write("\n");
      const indent = " ".repeat(Math.max(this.current_indent, termLen(prefix)) + 4);
      this.write(wrapText(args, textWidth, indent, indent));
    }
    this.write("\n");
  }

  writeHeading(heading: string): void {
    this.write(`${" ".repeat(this.current_indent)}${heading}:\n`);
  }

  writeParagraph(): void {
    if (this.buffer.length) this.write("\n");
  }

  writeText(text: string): void {
    const indent = " ".repeat(this.current_indent);
    this.write(wrapText(text, this.width, indent, indent, true));
    this.write("\n");
  }

  writeDl(rows: Array<[string, string]>, colMax = 30, colSpacing = 2): void {
    const widths = measureTable(rows);
    if (widths.length !== 2) throw new TypeError("Expected two columns for definition list");
    const firstCol = Math.min(widths[0] as number, colMax) + colSpacing;
    for (const [first, second] of rows) {
      this.write(`${" ".repeat(this.current_indent)}${first}`);
      if (!second) {
        this.write("\n");
        continue;
      }
      if (termLen(first) <= firstCol - colSpacing) {
        this.write(" ".repeat(firstCol - termLen(first)));
      } else {
        this.write("\n");
        this.write(" ".repeat(firstCol + this.current_indent));
      }
      const textWidth = Math.max(this.width - firstCol - 2, 10);
      const wrapped = wrapText(second, textWidth, "", "", true);
      const lines = splitlines(wrapped);
      if (lines.length) {
        this.write(`${lines[0]}\n`);
        for (const line of lines.slice(1)) {
          this.write(`${" ".repeat(firstCol + this.current_indent)}${line}\n`);
        }
      } else {
        this.write("\n");
      }
    }
  }

  /** `with formatter.section(name):` */
  section(name: string, fn: () => void): void {
    this.writeParagraph();
    this.writeHeading(name);
    this.indent();
    try {
      fn();
    } finally {
      this.dedent();
    }
  }

  /** `with formatter.indentation():` */
  indentation(fn: () => void): void {
    this.indent();
    try {
      fn();
    } finally {
      this.dedent();
    }
  }

  getvalue(): string {
    return this.buffer.join("");
  }
}

/** `click.formatting.join_options`: returns `[joined, any_prefix_is_slash]`. */
export function joinOptions(options: string[]): [string, boolean] {
  const rv: Array<[number, string]> = [];
  let anyPrefixIsSlash = false;
  for (const opt of options) {
    const prefix = splitOpt(opt)[0];
    if (prefix === "/") anyPrefixIsSlash = true;
    rv.push([prefix.length, opt]);
  }
  // list.sort is stable
  const sorted = rv
    .map((v, i) => [v, i] as const)
    .sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1])
    .map((v) => v[0]);
  return [sorted.map((x) => x[1]).join(", "), anyPrefixIsSlash];
}

/** `click.parser._split_opt`. */
export function splitOpt(opt: string): [string, string] {
  const first = cpSlice(opt, 0, 1);
  if (first && /^[\p{L}\p{N}]$/u.test(first)) return ["", opt];
  if (cpSlice(opt, 1, 2) === first) return [cpSlice(opt, 0, 2), cpSlice(opt, 2)];
  return [first, cpSlice(opt, 1)];
}

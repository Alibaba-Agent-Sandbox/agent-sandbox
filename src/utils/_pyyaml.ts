/**
 * PyYAML-faithful `yaml.safe_load` / `yaml.safe_dump(sort_keys=False, allow_unicode=True)`.
 *
 * `codegen.generate_template_files` loads the agent-produced `template.yaml`, validates it and **rewrites** it with
 * `yaml.safe_dump`. To keep the on-disk bytes identical to what the Python CLI writes, the dumper is a line-by-line
 * port of the PyYAML emitter (scalar analysis, plain / single-quoted / double-quoted selection driven by the implicit
 * resolvers, width-80 folding, indentless block sequences below mapping keys, `&id001` anchors for shared
 * collections). The loader is a port of the PyYAML pipeline itself (`_pyyaml_load.ts`: Reader, Scanner, Parser, Composer,
 * Resolver, SafeConstructor), so acceptance, constructed values and the exception text of every rejection match.
 *
 * Value model of the "rich" tree produced by {@link safeLoadRich}: `null`, `boolean`, `number` (int), `bigint` (int
 * beyond 2^53), {@link PyFloat}, `string`, {@link PyDate}, `Uint8Array` (`!!binary`), `Set` (`!!set`), `Map` (mapping,
 * insertion ordered, any key type) and `Array` (`PyTuple` for `!!omap` / `!!pairs` entries). {@link toPlain} flattens
 * that tree to plain JSON-like objects.
 */

import { PyFloat } from "./_pyformat.js";
import { pyFloatRepr } from "./_pyformat.js";
import {
  PyDate,
  PyTuple,
  TAG_BINARY,
  TAG_BOOL,
  TAG_FLOAT,
  TAG_INT,
  TAG_MAP,
  TAG_NULL,
  TAG_PREFIX,
  TAG_SEQ,
  TAG_SET,
  TAG_STR,
  TAG_TIMESTAMP,
  YAMLError,
  loadRich,
  resolveImplicit,
  type Rich,
} from "./_pyyaml_load.js";

export { PyFloat, PyDate, PyTuple, YAMLError };
export {
  ComposerError,
  ConstructorError,
  MarkedYAMLError,
  ParserError,
  PyLoadError,
  ReaderError,
  ScannerError,
} from "./_pyyaml_load.js";

/** `yaml.safe_load` returning the rich tree (Map / PyFloat / PyDate preserved so a later dump is byte-faithful). */
export function safeLoadRich(text: string, streamName: string | null = null): Rich {
  return loadRich(text, streamName);
}

/** Flatten a rich tree to plain JSON-like values (Map -> object, PyFloat -> number, PyDate -> text). */
export function toPlain(value: unknown): unknown {
  return flatten(value, false);
}

/** `flatten` keeping the Python type distinctions (what {@link safeLoadValue} returns) for an already loaded tree. */
export function flattenRich(rich: Rich): unknown {
  return flatten(rich, true);
}

export function pyDateToDate(d: PyDate): Date | string {
  const text = d.text;
  const hasZone = /(?:Z|[-+]\d\d(?::\d\d)?)$/.test(text) && text.includes("T");
  const parsed = new Date(text.includes("T") && !hasZone ? `${text}Z` : text);
  return Number.isNaN(parsed.getTime()) ? text : parsed;
}

function flatten(value: unknown, keepTypes: boolean): unknown {
  const memo = new Map<object, unknown>();
  const walk = (item: unknown): unknown => {
    if (item instanceof PyFloat) {
      if (!keepTypes) return item.value;
      return Number.isInteger(item.value) || !Number.isFinite(item.value) ? item : item.value;
    }
    if (item instanceof PyDate) return keepTypes ? pyDateToDate(item) : item.text;
    if (typeof item === "bigint") return keepTypes ? item : Number(item);
    if (item instanceof Map) {
      if (memo.has(item)) return memo.get(item);
      const out: Record<string, unknown> = {};
      memo.set(item, out);
      for (const [k, v] of item.entries()) {
        const name = k instanceof PyFloat ? String(k.value) : k instanceof PyDate ? k.text : String(k);
        Object.defineProperty(out, name, { value: walk(v), enumerable: true, writable: true, configurable: true });
      }
      return out;
    }
    if (Array.isArray(item)) {
      if (memo.has(item)) return memo.get(item);
      const out: unknown[] = [];
      memo.set(item, out);
      for (const element of item) out.push(walk(element));
      return out;
    }
    return item;
  };
  return walk(value);
}

/** `yaml.safe_load` with plain-object output. */
export function safeLoad(text: string, streamName: string | null = null): unknown {
  return toPlain(safeLoadRich(text, streamName));
}

/**
 * `yaml.safe_load` for the SDK/CLI call sites: plain objects like {@link safeLoad}, but the Python type distinctions the
 * formatters care about survive (whole-valued floats are {@link PyFloat}, ints beyond 2**53 are `bigint`, timestamps are
 * `Date`).
 */
export function safeLoadValue(text: string, streamName: string | null = null): unknown {
  return flatten(safeLoadRich(text, streamName), true);
}

// ---------------------------------------------------------------------------
// Representation (yaml/representer.py, SafeRepresenter) + serialization (yaml/serializer.py)
// ---------------------------------------------------------------------------

interface ScalarNodeT {
  kind: "scalar";
  tag: string;
  value: string;
  style?: "|";
  anchor?: string;
}
interface SeqNodeT {
  kind: "seq";
  items: NodeT[];
  anchor?: string;
}
interface MapNodeT {
  kind: "map";
  pairs: Array<[NodeT, NodeT]>;
  tag?: string;
  anchor?: string;
}
type NodeT = ScalarNodeT | SeqNodeT | MapNodeT;

export class RepresenterError extends YAMLError {}

function floatText(value: number): string {
  if (Number.isNaN(value)) return ".nan";
  if (value === Infinity) return ".inf";
  if (value === -Infinity) return "-.inf";
  let text = pyFloatRepr(value).toLowerCase();
  if (!text.includes(".") && text.includes("e")) text = text.replace("e", ".0e");
  return text;
}

/** Python `base64.encodebytes`: 76-character lines, every line (the last one included) ends with a newline. */
function base64EncodeBytes(data: Uint8Array): string {
  const text = Buffer.from(data).toString("base64");
  return text.replace(/(.{1,76})/g, "$1\n");
}

function represent(data: unknown): NodeT {
  const represented = new Map<object, NodeT>();
  const walk = (item: unknown): NodeT => {
    if (item === null || item === undefined) return { kind: "scalar", tag: TAG_NULL, value: "null" };
    if (typeof item === "string") return { kind: "scalar", tag: TAG_STR, value: item };
    if (typeof item === "boolean") return { kind: "scalar", tag: TAG_BOOL, value: item ? "true" : "false" };
    if (typeof item === "bigint") return { kind: "scalar", tag: TAG_INT, value: item.toString() };
    if (typeof item === "number") {
      if (Number.isInteger(item) && !Object.is(item, -0)) return { kind: "scalar", tag: TAG_INT, value: String(item) };
      return { kind: "scalar", tag: TAG_FLOAT, value: floatText(item) };
    }
    if (typeof item !== "object") throw new RepresenterError(`cannot represent an object: ${String(item)}`);
    if (item instanceof PyFloat) return { kind: "scalar", tag: TAG_FLOAT, value: floatText(item.value) };
    const seen = represented.get(item);
    if (seen) return seen;
    if (item instanceof Uint8Array) {
      const node: NodeT = { kind: "scalar", tag: TAG_BINARY, value: base64EncodeBytes(item), style: "|" };
      represented.set(item, node);
      return node;
    }
    if (item instanceof Set) {
      const node: MapNodeT = { kind: "map", pairs: [] };
      node.tag = TAG_SET;
      represented.set(item, node);
      for (const element of item) node.pairs.push([walk(element), { kind: "scalar", tag: TAG_NULL, value: "null" }]);
      return node;
    }
    if (item instanceof PyDate) {
      const node: NodeT = { kind: "scalar", tag: TAG_TIMESTAMP, value: item.text };
      represented.set(item, node);
      return node;
    }
    if (Array.isArray(item)) {
      const node: SeqNodeT = { kind: "seq", items: [] };
      represented.set(item, node);
      for (const element of item) node.items.push(walk(element));
      return node;
    }
    const node: MapNodeT = { kind: "map", pairs: [] };
    represented.set(item, node);
    const entries: Array<[unknown, unknown]> =
      item instanceof Map ? [...item.entries()] : Object.entries(item as Record<string, unknown>);
    for (const [k, v] of entries) node.pairs.push([walk(k), walk(v)]);
    return node;
  };
  return walk(data);
}

/** Serializer.anchor_node: nodes reachable twice get `idNNN` anchors, numbered in discovery order. */
function assignAnchors(root: NodeT): Map<NodeT, string | null> {
  const anchors = new Map<NodeT, string | null>();
  let counter = 0;
  const visit = (node: NodeT): void => {
    if (anchors.has(node)) {
      if (anchors.get(node) === null) {
        counter += 1;
        anchors.set(node, `id${String(counter).padStart(3, "0")}`);
      }
      return;
    }
    anchors.set(node, null);
    if (node.kind === "seq") for (const item of node.items) visit(item);
    else if (node.kind === "map") {
      for (const [k, v] of node.pairs) {
        visit(k);
        visit(v);
      }
    }
  };
  visit(root);
  return anchors;
}

// ---------------------------------------------------------------------------
// Emitter (yaml/emitter.py)
// ---------------------------------------------------------------------------

const BREAKS = "\n\x85\u2028\u2029";
const WS_AND_NUL = "\0 \t\r\n\x85\u2028\u2029";

interface ScalarAnalysis {
  scalar: string;
  empty: boolean;
  multiline: boolean;
  allowFlowPlain: boolean;
  allowBlockPlain: boolean;
  allowSingleQuoted: boolean;
  allowDoubleQuoted: boolean;
  allowBlock: boolean;
}

const cp = (ch: string): number => ch.codePointAt(0) as number;

function analyzeScalar(scalar: string, allowUnicode: boolean): ScalarAnalysis {
  if (scalar === "") {
    return {
      scalar,
      empty: true,
      multiline: false,
      allowFlowPlain: false,
      allowBlockPlain: true,
      allowSingleQuoted: true,
      allowDoubleQuoted: true,
      allowBlock: false,
    };
  }
  const chars = Array.from(scalar);
  let blockIndicators = false;
  let flowIndicators = false;
  let lineBreaks = false;
  let specialCharacters = false;
  let leadingSpace = false;
  let leadingBreak = false;
  let trailingSpace = false;
  let trailingBreak = false;
  let breakSpace = false;
  let spaceBreak = false;

  if (scalar.startsWith("---") || scalar.startsWith("...")) {
    blockIndicators = true;
    flowIndicators = true;
  }
  let precededByWhitespace = true;
  let followedByWhitespace = chars.length === 1 || WS_AND_NUL.includes(chars[1] as string);
  let previousSpace = false;
  let previousBreak = false;
  let index = 0;
  while (index < chars.length) {
    const ch = chars[index] as string;
    if (index === 0) {
      if ("#,[]{}&*!|>'\"%@`".includes(ch)) {
        flowIndicators = true;
        blockIndicators = true;
      }
      if (ch === "?" || ch === ":") {
        flowIndicators = true;
        if (followedByWhitespace) blockIndicators = true;
      }
      if (ch === "-" && followedByWhitespace) {
        flowIndicators = true;
        blockIndicators = true;
      }
    } else {
      if (",?[]{}".includes(ch)) flowIndicators = true;
      if (ch === ":") {
        flowIndicators = true;
        if (followedByWhitespace) blockIndicators = true;
      }
      if (ch === "#" && precededByWhitespace) {
        flowIndicators = true;
        blockIndicators = true;
      }
    }
    if (BREAKS.includes(ch)) lineBreaks = true;
    const code = cp(ch);
    if (!(ch === "\n" || (code >= 0x20 && code <= 0x7e))) {
      if (
        (ch === "\x85" ||
          (code >= 0xa0 && code <= 0xd7ff) ||
          (code >= 0xe000 && code <= 0xfffd) ||
          (code >= 0x10000 && code < 0x10ffff)) &&
        ch !== "\ufeff"
      ) {
        if (!allowUnicode) specialCharacters = true;
      } else {
        specialCharacters = true;
      }
    }
    if (ch === " ") {
      if (index === 0) leadingSpace = true;
      if (index === chars.length - 1) trailingSpace = true;
      if (previousBreak) breakSpace = true;
      previousSpace = true;
      previousBreak = false;
    } else if (BREAKS.includes(ch)) {
      if (index === 0) leadingBreak = true;
      if (index === chars.length - 1) trailingBreak = true;
      if (previousSpace) spaceBreak = true;
      previousSpace = false;
      previousBreak = true;
    } else {
      previousSpace = false;
      previousBreak = false;
    }
    index += 1;
    precededByWhitespace = WS_AND_NUL.includes(ch);
    const nxt = chars[index + 1];
    followedByWhitespace = index + 1 >= chars.length || WS_AND_NUL.includes(nxt as string);
  }

  let allowFlowPlain = true;
  let allowBlockPlain = true;
  let allowSingleQuoted = true;
  const allowDoubleQuoted = true;
  let allowBlock = true;
  if (leadingSpace || leadingBreak || trailingSpace || trailingBreak) allowFlowPlain = allowBlockPlain = false;
  if (trailingSpace) allowBlock = false;
  if (breakSpace) allowFlowPlain = allowBlockPlain = allowSingleQuoted = false;
  if (spaceBreak || specialCharacters) allowFlowPlain = allowBlockPlain = allowSingleQuoted = allowBlock = false;
  if (lineBreaks) allowFlowPlain = allowBlockPlain = false;
  if (flowIndicators) allowFlowPlain = false;
  if (blockIndicators) allowBlockPlain = false;
  return {
    scalar,
    empty: false,
    multiline: lineBreaks,
    allowFlowPlain,
    allowBlockPlain,
    allowSingleQuoted,
    allowDoubleQuoted,
    allowBlock,
  };
}

const ESCAPE_REPLACEMENTS: Record<string, string> = {
  "\0": "0",
  "\x07": "a",
  "\x08": "b",
  "\x09": "t",
  "\x0a": "n",
  "\x0b": "v",
  "\x0c": "f",
  "\x0d": "r",
  "\x1b": "e",
  '"': '"',
  "\\": "\\",
  "\x85": "N",
  "\xa0": "_",
  "\u2028": "L",
  "\u2029": "P",
};

class Emitter {
  private out: string[] = [];
  private column = 0;
  private indent: number | null = null;
  private indents: Array<number | null> = [];
  private whitespace = true;
  private indention = true;
  private openEnded = false;
  private readonly bestIndent = 2;
  private readonly bestWidth = 80;
  private readonly allowUnicode = true;
  private rootContext = false;
  private mappingContext = false;
  private simpleKeyContext = false;

  constructor(private readonly anchors: Map<NodeT, string | null>) {}

  private serialized = new Set<NodeT>();

  result(): string {
    return this.out.join("");
  }

  emitDocument(root: NodeT): void {
    this.emitNode(root, { root: true });
    this.writeIndent();
    if (this.openEnded) {
      this.writeIndicator("...", true);
      this.writeIndent();
    }
  }

  private write(data: string): void {
    this.out.push(data);
  }

  private increaseIndent(flow = false, indentless = false): void {
    this.indents.push(this.indent);
    if (this.indent === null) {
      this.indent = flow ? this.bestIndent : 0;
    } else if (!indentless) {
      this.indent += this.bestIndent;
    }
  }

  private popIndent(): void {
    this.indent = this.indents.pop() as number | null;
  }

  private writeIndicator(
    indicator: string,
    needWhitespace: boolean,
    opts: { whitespace?: boolean; indention?: boolean } = {},
  ): void {
    const data = this.whitespace || !needWhitespace ? indicator : ` ${indicator}`;
    this.whitespace = opts.whitespace ?? false;
    this.indention = this.indention && (opts.indention ?? false);
    this.column += Array.from(data).length;
    this.openEnded = false;
    this.write(data);
  }

  private writeIndent(): void {
    const indent = this.indent ?? 0;
    if (!this.indention || this.column > indent || (this.column === indent && !this.whitespace)) {
      this.writeLineBreak();
    }
    if (this.column < indent) {
      this.whitespace = true;
      this.write(" ".repeat(indent - this.column));
      this.column = indent;
    }
  }

  private writeLineBreak(data = "\n"): void {
    this.whitespace = true;
    this.indention = true;
    this.column = 0;
    this.write(data);
  }

  private isEmptyCollection(node: NodeT): boolean {
    return (node.kind === "seq" && node.items.length === 0) || (node.kind === "map" && node.pairs.length === 0);
  }

  private checkSimpleKey(node: NodeT, alias: boolean, analysis: ScalarAnalysis | null): boolean {
    let length = 0;
    const anchor = this.anchors.get(node);
    if (anchor) length += anchor.length;
    if (node.kind === "scalar" && analysis) length += Array.from(analysis.scalar).length;
    return (
      length < 128 &&
      (alias || (node.kind === "scalar" && analysis !== null && !analysis.empty && !analysis.multiline) || this.isEmptyCollection(node))
    );
  }

  private emitNode(
    node: NodeT,
    ctx: { root?: boolean; sequence?: boolean; mapping?: boolean; simpleKey?: boolean } = {},
  ): void {
    this.rootContext = ctx.root ?? false;
    this.mappingContext = ctx.mapping ?? false;
    this.simpleKeyContext = ctx.simpleKey ?? false;
    const anchor = this.anchors.get(node) ?? null;
    if (this.serialized.has(node)) {
      this.writeIndicator(`*${anchor}`, true);
      return;
    }
    this.serialized.add(node);
    if (anchor) this.writeIndicator(`&${anchor}`, true);
    if (node.kind === "map" && node.tag === TAG_SET) this.writeIndicator("!!set", true);
    if (node.kind === "scalar") {
      this.emitScalar(node);
    } else if (node.kind === "seq") {
      if (node.items.length === 0) this.emitEmptyFlow("[", "]");
      else this.emitBlockSequence(node);
    } else if (node.pairs.length === 0) {
      this.emitEmptyFlow("{", "}");
    } else {
      this.emitBlockMapping(node);
    }
  }

  private emitEmptyFlow(open: string, close: string): void {
    this.writeIndicator(open, true, { whitespace: true });
    this.increaseIndent(true);
    this.popIndent();
    this.writeIndicator(close, false);
  }

  private emitBlockSequence(node: SeqNodeT): void {
    const indentless = this.mappingContext && !this.indention;
    this.increaseIndent(false, indentless);
    for (const item of node.items) {
      this.writeIndent();
      this.writeIndicator("-", true, { indention: true });
      this.emitNode(item, { sequence: true });
    }
    this.popIndent();
  }

  private keyAnalysis(node: NodeT): ScalarAnalysis | null {
    return node.kind === "scalar" ? analyzeScalar(node.value, this.allowUnicode) : null;
  }

  private emitBlockMapping(node: MapNodeT): void {
    this.increaseIndent(false);
    for (const [key, value] of node.pairs) {
      this.writeIndent();
      const alias = this.serialized.has(key);
      if (this.checkSimpleKey(key, alias, this.keyAnalysis(key))) {
        this.emitNode(key, { mapping: true, simpleKey: true });
        this.writeIndicator(":", false);
        this.emitNode(value, { mapping: true });
      } else {
        this.writeIndicator("?", true, { indention: true });
        this.emitNode(key, { mapping: true });
        this.writeIndent();
        this.writeIndicator(":", true, { indention: true });
        this.emitNode(value, { mapping: true });
      }
    }
    this.popIndent();
  }

  private chooseScalarStyle(node: ScalarNodeT, analysis: ScalarAnalysis, implicitPlain: boolean): "" | "'" | '"' | "|" {
    if (node.style === "|") {
      if (!this.simpleKeyContext && analysis.allowBlock) return "|";
      return '"';
    }
    if (
      implicitPlain &&
      !(this.simpleKeyContext && (analysis.empty || analysis.multiline)) &&
      analysis.allowBlockPlain
    ) {
      return "";
    }
    if (analysis.allowSingleQuoted && !(this.simpleKeyContext && analysis.multiline)) return "'";
    void node;
    return '"';
  }

  private emitScalar(node: ScalarNodeT): void {
    const analysis = analyzeScalar(node.value, this.allowUnicode);
    const detected = resolveImplicit(node.value);
    const implicitPlain = node.tag === detected;
    const implicitQuoted = node.tag === TAG_STR;
    const style = this.chooseScalarStyle(node, analysis, implicitPlain);
    if (!((style === "" && implicitPlain) || (style !== "" && implicitQuoted))) {
      const tag = node.tag.startsWith(TAG_PREFIX) ? `!!${node.tag.slice(TAG_PREFIX.length)}` : `!<${node.tag}>`;
      this.writeIndicator(tag, true);
    }
    this.increaseIndent(true);
    const split = !this.simpleKeyContext;
    if (style === '"') this.writeDoubleQuoted(analysis.scalar, split);
    else if (style === "|") this.writeLiteral(analysis.scalar);
    else if (style === "'") this.writeSingleQuoted(analysis.scalar, split);
    else this.writePlain(analysis.scalar, split);
    this.popIndent();
  }

  private writeLiteral(text: string): void {
    const chars = Array.from(text);
    let hints = "";
    if (chars.length > 0) {
      if (" \n\x85\u2028\u2029".includes(chars[0] as string)) hints += String(this.bestIndent);
      const last = chars[chars.length - 1] as string;
      if (!BREAKS.includes(last)) hints += "-";
      else if (chars.length === 1 || BREAKS.includes(chars[chars.length - 2] as string)) hints += "+";
    }
    this.writeIndicator(`|${hints}`, true);
    if (hints.endsWith("+")) this.openEnded = true;
    this.writeLineBreak();
    let breaks = true;
    let start = 0;
    let end = 0;
    while (end <= chars.length) {
      const ch: string | null = end < chars.length ? (chars[end] as string) : null;
      if (breaks) {
        if (ch === null || !BREAKS.includes(ch)) {
          for (const br of chars.slice(start, end)) {
            if (br === "\n") this.writeLineBreak();
            else this.writeLineBreak(br);
          }
          if (ch !== null) this.writeIndent();
          start = end;
        }
      } else if (ch === null || BREAKS.includes(ch)) {
        this.write(chars.slice(start, end).join(""));
        if (ch === null) this.writeLineBreak();
        start = end;
      }
      if (ch !== null) breaks = BREAKS.includes(ch);
      end += 1;
    }
  }

  private writeRaw(data: string): void {
    this.column += Array.from(data).length;
    this.write(data);
  }

  private writeSingleQuoted(text: string, split: boolean): void {
    const chars = Array.from(text);
    this.writeIndicator("'", true);
    let spaces = false;
    let breaks = false;
    let start = 0;
    let end = 0;
    while (end <= chars.length) {
      const ch: string | null = end < chars.length ? (chars[end] as string) : null;
      if (spaces) {
        if (ch === null || ch !== " ") {
          if (start + 1 === end && this.column > this.bestWidth && split && start !== 0 && end !== chars.length) {
            this.writeIndent();
          } else {
            this.writeRaw(chars.slice(start, end).join(""));
          }
          start = end;
        }
      } else if (breaks) {
        if (ch === null || !BREAKS.includes(ch)) {
          if (chars[start] === "\n") this.writeLineBreak();
          for (const br of chars.slice(start, end)) {
            if (br === "\n") this.writeLineBreak();
            else this.writeLineBreak(br);
          }
          this.writeIndent();
          start = end;
        }
      } else if (ch === null || " \n\x85\u2028\u2029".includes(ch) || ch === "'") {
        if (start < end) {
          this.writeRaw(chars.slice(start, end).join(""));
          start = end;
        }
      }
      if (ch === "'") {
        this.writeRaw("''");
        start = end + 1;
      }
      if (ch !== null) {
        spaces = ch === " ";
        breaks = BREAKS.includes(ch);
      }
      end += 1;
    }
    this.writeIndicator("'", false);
  }

  private writeDoubleQuoted(text: string, split: boolean): void {
    const chars = Array.from(text);
    this.writeIndicator('"', true);
    let start = 0;
    let end = 0;
    while (end <= chars.length) {
      const ch: string | null = end < chars.length ? (chars[end] as string) : null;
      let needsEscape = ch === null;
      if (ch !== null) {
        const code = cp(ch);
        const printable =
          (code >= 0x20 && code <= 0x7e) ||
          (this.allowUnicode && ((code >= 0xa0 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd)));
        needsEscape = '"\\\x85\u2028\u2029\ufeff'.includes(ch) || !printable;
      }
      if (needsEscape) {
        if (start < end) {
          this.writeRaw(chars.slice(start, end).join(""));
          start = end;
        }
        if (ch !== null) {
          const code = cp(ch);
          let data: string;
          const replacement = ESCAPE_REPLACEMENTS[ch];
          if (replacement !== undefined) data = `\\${replacement}`;
          else if (code <= 0xff) data = `\\x${code.toString(16).toUpperCase().padStart(2, "0")}`;
          else if (code <= 0xffff) data = `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
          else data = `\\U${code.toString(16).toUpperCase().padStart(8, "0")}`;
          this.writeRaw(data);
          start = end + 1;
        }
      }
      if (
        end > 0 &&
        end < chars.length - 1 &&
        (ch === " " || start >= end) &&
        this.column + (end - start) > this.bestWidth &&
        split
      ) {
        const data = `${chars.slice(start, end).join("")}\\`;
        if (start < end) start = end;
        this.writeRaw(data);
        this.writeIndent();
        this.whitespace = false;
        this.indention = false;
        if (chars[start] === " ") this.writeRaw("\\");
      }
      end += 1;
    }
    this.writeIndicator('"', false);
  }

  private writePlain(text: string, split: boolean): void {
    if (this.rootContext) this.openEnded = true;
    if (!text) return;
    const chars = Array.from(text);
    if (!this.whitespace) this.writeRaw(" ");
    this.whitespace = false;
    this.indention = false;
    let spaces = false;
    let breaks = false;
    let start = 0;
    let end = 0;
    while (end <= chars.length) {
      const ch: string | null = end < chars.length ? (chars[end] as string) : null;
      if (spaces) {
        if (ch !== " ") {
          if (start + 1 === end && this.column > this.bestWidth && split) {
            this.writeIndent();
            this.whitespace = false;
            this.indention = false;
          } else {
            this.writeRaw(chars.slice(start, end).join(""));
          }
          start = end;
        }
      } else if (breaks) {
        if (ch === null || !BREAKS.includes(ch)) {
          if (chars[start] === "\n") this.writeLineBreak();
          for (const br of chars.slice(start, end)) {
            if (br === "\n") this.writeLineBreak();
            else this.writeLineBreak(br);
          }
          this.writeIndent();
          this.whitespace = false;
          this.indention = false;
          start = end;
        }
      } else if (ch === null || " \n\x85\u2028\u2029".includes(ch)) {
        this.writeRaw(chars.slice(start, end).join(""));
        start = end;
      }
      if (ch !== null) {
        spaces = ch === " ";
        breaks = BREAKS.includes(ch);
      }
      end += 1;
    }
  }
}

/** `yaml.safe_dump(data, sort_keys=False, allow_unicode=True)`. */
export function safeDump(data: unknown): string {
  const root = represent(data);
  const emitter = new Emitter(assignAnchors(root));
  emitter.emitDocument(root);
  return emitter.result();
}

export { TAG_MAP, TAG_SEQ };

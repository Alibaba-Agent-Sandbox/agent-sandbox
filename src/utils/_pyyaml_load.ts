/**
 * Line-by-line port of PyYAML 6.0.3 `yaml.safe_load` (reader, scanner, parser, composer, resolver, SafeConstructor).
 *
 * The npm `yaml` package implements YAML 1.2 and disagrees with PyYAML (a YAML 1.1 processor) on many accept/reject
 * decisions (tabs, flow-context oddities, implicit-key length, printable-character check, tags, anchors). Because
 * `template.yaml` is a gate ("PyYAML can load this") every one of those decisions has to be PyYAML's, so the front
 * half of the loader is a port of the PyYAML sources themselves, including their lazy token/event pipeline and the
 * exact `MarkedYAMLError` message layout (context / problem / snippet marks).
 *
 * Value model produced by {@link constructDocument}: `null`, `boolean`, `number` (int), `bigint` (int beyond 2^53),
 * {@link PyFloat}, `string`, {@link PyDate}, `Uint8Array` (`!!binary`), `Set` (`!!set`), `Array` (sequences, `!!omap`,
 * `!!pairs`) and `Map` (mappings, insertion ordered, Python dict key equality).
 */

import { pyB64Decode, BinasciiError } from "../protocol/_b64.js";
import { PyFloat, pyFloatParse, pyStrRepr } from "./_pyformat.js";
import { _utf8DecodeError } from "./_pyos.js";

export { PyFloat };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class YAMLError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YAMLError";
  }
}

class Mark {
  constructor(
    readonly name: string,
    readonly index: number,
    readonly line: number,
    readonly column: number,
    readonly buffer: readonly string[] | null,
    readonly pointer: number,
  ) {}

  getSnippet(indent = 4, maxLength = 75): string | null {
    if (this.buffer === null) return null;
    let head = "";
    let start = this.pointer;
    while (start > 0 && !"\0\r\n\x85\u2028\u2029".includes(this.buffer[start - 1] as string)) {
      start -= 1;
      if (this.pointer - start > maxLength / 2 - 1) {
        head = " ... ";
        start += 5;
        break;
      }
    }
    let tail = "";
    let end = this.pointer;
    while (end < this.buffer.length && !"\0\r\n\x85\u2028\u2029".includes(this.buffer[end] as string)) {
      end += 1;
      if (end - this.pointer > maxLength / 2 - 1) {
        tail = " ... ";
        end -= 5;
        break;
      }
    }
    const snippet = this.buffer.slice(start, end).join("");
    return `${" ".repeat(indent)}${head}${snippet}${tail}\n${" ".repeat(indent + this.pointer - start + Array.from(head).length)}^`;
  }

  toString(): string {
    const snippet = this.getSnippet();
    const where = `  in "${this.name}", line ${this.line + 1}, column ${this.column + 1}`;
    return snippet === null ? where : `${where}:\n${snippet}`;
  }
}

export class MarkedYAMLError extends YAMLError {
  constructor(
    context: string | null,
    contextMark: Mark | null,
    problem: string | null,
    problemMark: Mark | null,
    note: string | null = null,
  ) {
    const lines: string[] = [];
    if (context !== null) lines.push(context);
    if (
      contextMark !== null &&
      (problem === null ||
        problemMark === null ||
        contextMark.name !== problemMark.name ||
        contextMark.line !== problemMark.line ||
        contextMark.column !== problemMark.column)
    ) {
      lines.push(contextMark.toString());
    }
    if (problem !== null) lines.push(problem);
    if (problemMark !== null) lines.push(problemMark.toString());
    if (note !== null) lines.push(note);
    super(lines.join("\n"));
    this.name = "MarkedYAMLError";
  }
}

export class ReaderError extends YAMLError {
  constructor(name: string, position: number, character: number, reason: string) {
    super(
      `unacceptable character #x${character.toString(16).padStart(4, "0")}: ${reason}\n  in "${name}", position ${position}`,
    );
    this.name = "ReaderError";
  }
}
export class ScannerError extends MarkedYAMLError {}
export class ParserError extends MarkedYAMLError {}
export class ComposerError extends MarkedYAMLError {}
export class ConstructorError extends MarkedYAMLError {}

/** Non-YAML Python exceptions raised while loading (`str(exc)` is what the CLI prints after `Unexpected error: `). */
export class PyLoadError extends Error {
  constructor(
    readonly pyType: string,
    message: string,
  ) {
    super(message);
    this.name = pyType;
  }
}
const pyValueError = (m: string): PyLoadError => new PyLoadError("ValueError", m);
const pyIndexError = (): PyLoadError => new PyLoadError("IndexError", "string index out of range");

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

/** A Python `tuple` (the `(key, value)` entries of `!!omap` / `!!pairs`); dumps and flattens like a list. */
export class PyTuple<T = unknown> extends Array<T> {}

/** A YAML timestamp (Python `date` / `datetime`), stored as its `isoformat` text. */
export class PyDate {
  constructor(readonly text: string) {}
  toString(): string {
    return this.text;
  }
}

export const TAG_PREFIX = "tag:yaml.org,2002:";
export const TAG_STR = `${TAG_PREFIX}str`;
export const TAG_INT = `${TAG_PREFIX}int`;
export const TAG_FLOAT = `${TAG_PREFIX}float`;
export const TAG_BOOL = `${TAG_PREFIX}bool`;
export const TAG_NULL = `${TAG_PREFIX}null`;
export const TAG_TIMESTAMP = `${TAG_PREFIX}timestamp`;
export const TAG_MERGE = `${TAG_PREFIX}merge`;
export const TAG_VALUE = `${TAG_PREFIX}value`;
export const TAG_SEQ = `${TAG_PREFIX}seq`;
export const TAG_MAP = `${TAG_PREFIX}map`;
export const TAG_BINARY = `${TAG_PREFIX}binary`;
export const TAG_SET = `${TAG_PREFIX}set`;
export const TAG_OMAP = `${TAG_PREFIX}omap`;
export const TAG_PAIRS = `${TAG_PREFIX}pairs`;

// ---------------------------------------------------------------------------
// Implicit resolvers (yaml/resolver.py)
// ---------------------------------------------------------------------------

const RESOLVERS: Array<{ tag: string; re: RegExp; first: string | null }> = [
  { tag: TAG_BOOL, re: /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/, first: "yYnNtTfFoO" },
  {
    tag: TAG_FLOAT,
    re: /^(?:[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/,
    first: "-+0123456789.",
  },
  {
    tag: TAG_INT,
    re: /^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/,
    first: "-+0123456789",
  },
  { tag: TAG_MERGE, re: /^(?:<<)$/, first: "<" },
  { tag: TAG_NULL, re: /^(?:~|null|Null|NULL|)$/, first: "~nN" },
  {
    tag: TAG_TIMESTAMP,
    re: /^(?:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]|[0-9][0-9][0-9][0-9]-[0-9][0-9]?-[0-9][0-9]?(?:[Tt]|[ \t]+)[0-9][0-9]?:[0-9][0-9]:[0-9][0-9](?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9][0-9]?(?::[0-9][0-9])?))?)$/,
    first: "0123456789",
  },
  { tag: TAG_VALUE, re: /^(?:=)$/, first: "=" },
];

/** Python's `$` also matches before one trailing newline. */
function pyMatch(re: RegExp, value: string): boolean {
  return re.test(value.endsWith("\n") ? value.slice(0, -1) : value) || re.test(value);
}

/** `Resolver.resolve(ScalarNode, value, (True, False))` */
export function resolveImplicit(value: string): string {
  const key = value === "" ? "" : (String.fromCodePoint(value.codePointAt(0) as number));
  for (const { tag, re, first } of RESOLVERS) {
    const hit = key === "" ? tag === TAG_NULL : first !== null && first.includes(key);
    if (hit && pyMatch(re, value)) return tag;
  }
  return TAG_STR;
}

// ---------------------------------------------------------------------------
// Tokens / events / nodes
// ---------------------------------------------------------------------------

type TokenKind =
  | "StreamStart"
  | "StreamEnd"
  | "Directive"
  | "DocumentStart"
  | "DocumentEnd"
  | "BlockSequenceStart"
  | "BlockMappingStart"
  | "BlockEnd"
  | "FlowSequenceStart"
  | "FlowMappingStart"
  | "FlowSequenceEnd"
  | "FlowMappingEnd"
  | "Key"
  | "Value"
  | "BlockEntry"
  | "FlowEntry"
  | "Alias"
  | "Anchor"
  | "Tag"
  | "Scalar";

const TOKEN_IDS: Record<TokenKind, string> = {
  StreamStart: "<stream start>",
  StreamEnd: "<stream end>",
  Directive: "<directive>",
  DocumentStart: "<document start>",
  DocumentEnd: "<document end>",
  BlockSequenceStart: "<block sequence start>",
  BlockMappingStart: "<block mapping start>",
  BlockEnd: "<block end>",
  FlowSequenceStart: "[",
  FlowMappingStart: "{",
  FlowSequenceEnd: "]",
  FlowMappingEnd: "}",
  Key: "?",
  Value: ":",
  BlockEntry: "-",
  FlowEntry: ",",
  Alias: "<alias>",
  Anchor: "<anchor>",
  Tag: "<tag>",
  Scalar: "<scalar>",
};

interface Token {
  kind: TokenKind;
  startMark: Mark;
  endMark: Mark;
  value?: unknown;
  name?: string;
  plain?: boolean;
  style?: string | null;
}

type EventKind =
  | "StreamStart"
  | "StreamEnd"
  | "DocumentStart"
  | "DocumentEnd"
  | "Alias"
  | "Scalar"
  | "SequenceStart"
  | "SequenceEnd"
  | "MappingStart"
  | "MappingEnd";

interface YEvent {
  kind: EventKind;
  startMark: Mark;
  endMark: Mark;
  anchor?: string | null;
  tag?: string | null;
  implicit?: boolean | [boolean, boolean];
  value?: string;
  style?: string | null;
  flowStyle?: boolean;
}

interface YNode {
  kind: "scalar" | "sequence" | "mapping";
  tag: string;
  value: string | YNode[] | Array<[YNode, YNode]>;
  startMark: Mark;
  endMark: Mark;
}

interface SimpleKey {
  tokenNumber: number;
  required: boolean;
  index: number;
  line: number;
  column: number;
  mark: Mark;
}

const BREAKZ = "\0\r\n\x85\u2028\u2029";
const BLANK_BREAKZ = "\0 \t\r\n\x85\u2028\u2029";
const SPACE_BREAKZ = "\0 \r\n\x85\u2028\u2029";
const HEX = "0123456789ABCDEFabcdef";

const isAlnum = (ch: string): boolean =>
  ("0" <= ch && ch <= "9") || ("A" <= ch && ch <= "Z") || ("a" <= ch && ch <= "z") || ch === "-" || ch === "_";
const inS = (ch: string, set: string): boolean => ch.length > 0 && set.includes(ch);

const ESCAPE_REPLACEMENTS: Record<string, string> = {
  "0": "\0",
  a: "\x07",
  b: "\x08",
  t: "\x09",
  "\t": "\x09",
  n: "\x0A",
  v: "\x0B",
  f: "\x0C",
  r: "\x0D",
  e: "\x1B",
  " ": "\x20",
  '"': '"',
  "\\": "\\",
  "/": "/",
  N: "\x85",
  _: "\xA0",
  L: "\u2028",
  P: "\u2029",
};
const ESCAPE_CODES: Record<string, number> = { x: 2, u: 4, U: 8 };

const NON_PRINTABLE = /[^\x09\x0A\x0D\x20-\x7E\x85\xA0-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;

function chrOf(code: number): string {
  if (code > 0x10ffff) throw pyValueError("chr() arg not in range(0x110000)");
  return String.fromCodePoint(code);
}

// ---------------------------------------------------------------------------
// Reader + Scanner + Parser + Composer (one object, lazily pulled like PyYAML's)
// ---------------------------------------------------------------------------

type ParseState = () => YEvent;

const STREAM_CHUNK = 4096;

class PyYamlComposer {
  private readonly name: string;
  private readonly buffer: string[];
  private readonly streamed: boolean;
  private readonly badAt: number;
  private rawRead = 0;
  private loaded = 0;
  private eof = false;
  private rawDone = false;
  private pointer = 0;
  private index = 0;
  private line = 0;
  private column = 0;

  // scanner
  private done = false;
  private flowLevel = 0;
  private tokens: Token[] = [];
  private tokensTaken = 0;
  private indent = -1;
  private indents: number[] = [];
  private allowSimpleKey = true;
  private possibleSimpleKeys = new Map<number, SimpleKey>();

  // parser
  private currentEvent: YEvent | null = null;
  private tagHandles: Record<string, string> = {};
  private states: ParseState[] = [];
  private marks: Mark[] = [];
  private state: ParseState | null;

  // composer
  private anchors = new Map<string, YNode>();

  constructor(text: string, streamName: string | null = null) {
    const chars = Array.from(text);
    this.streamed = streamName !== null;
    this.name = streamName ?? "<unicode string>";
    this.badAt = chars.findIndex((c) => NON_PRINTABLE.test(c));
    if (!this.streamed && this.badAt >= 0) this.raiseBad(chars);
    chars.push("\0");
    this.buffer = chars;
    if (this.streamed) {
      this.readChunk();
      while (!this.eof && this.rawRead < 2) this.readChunk();
      this.update(1);
    }
    this.fetchStreamStart();
    this.state = this.parseStreamStart;
  }

  // ---- reader ----

  private raiseBad(chars: readonly string[]): never {
    throw new ReaderError(this.name, this.badAt, (chars[this.badAt] as string).codePointAt(0) as number, "special characters are not allowed");
  }

  /** `stream.read(4096)`: the text length (without the sentinel) is `buffer.length - 1`. */
  private readChunk(): void {
    const total = this.buffer.length === 0 ? 0 : this.rawTotal();
    const got = Math.min(STREAM_CHUNK, total - this.rawRead);
    if (got <= 0) this.eof = true;
    else this.rawRead += got;
  }

  private rawTotal(): number {
    return this.buffer.length - 1;
  }

  /** PyYAML's `Reader.update` for a text stream: chunks of 4096 characters are validated when they are first needed. */
  private update(length: number): void {
    if (!this.streamed || this.rawDone) return;
    while (this.loaded - this.pointer < length) {
      if (!this.eof) this.readChunk();
      if (this.badAt >= this.loaded && this.badAt < this.rawRead) this.raiseBad(this.buffer);
      this.loaded = this.rawRead;
      if (this.eof) {
        this.loaded += 1;
        this.rawDone = true;
        break;
      }
    }
  }

  private peek(index = 0): string {
    if (this.streamed && this.pointer + index >= this.loaded) this.update(index + 1);
    const ch = this.buffer[this.pointer + index];
    if (ch === undefined) throw pyIndexError();
    return ch;
  }

  private prefix(length = 1): string {
    if (this.streamed && this.pointer + length >= this.loaded) this.update(length);
    return this.buffer.slice(this.pointer, this.pointer + length).join("");
  }

  private forward(length = 1): void {
    if (this.streamed && this.pointer + length + 1 >= this.loaded) this.update(length + 1);
    while (length) {
      const ch = this.buffer[this.pointer] as string;
      this.pointer += 1;
      this.index += 1;
      if ("\n\x85\u2028\u2029".includes(ch) || (ch === "\r" && this.peekRaw(this.pointer) !== "\n")) {
        this.line += 1;
        this.column = 0;
      } else if (ch !== "\uFEFF") {
        this.column += 1;
      }
      length -= 1;
    }
  }

  private peekRaw(at: number): string {
    const ch = this.buffer[at];
    if (ch === undefined) throw pyIndexError();
    return ch;
  }

  private getMark(): Mark {
    return new Mark(this.name, this.index, this.line, this.column, this.streamed ? null : this.buffer, this.pointer);
  }

  // ---- scanner: token queue ----

  private needMoreTokens(): boolean {
    if (this.done) return false;
    if (this.tokens.length === 0) return true;
    this.stalePossibleSimpleKeys();
    return this.nextPossibleSimpleKey() === this.tokensTaken;
  }

  private checkToken(...kinds: TokenKind[]): boolean {
    while (this.needMoreTokens()) this.fetchMoreTokens();
    if (this.tokens.length > 0) {
      if (kinds.length === 0) return true;
      for (const kind of kinds) if ((this.tokens[0] as Token).kind === kind) return true;
    }
    return false;
  }

  private peekToken(): Token {
    while (this.needMoreTokens()) this.fetchMoreTokens();
    return this.tokens[0] as Token;
  }

  private getToken(): Token {
    while (this.needMoreTokens()) this.fetchMoreTokens();
    this.tokensTaken += 1;
    return this.tokens.shift() as Token;
  }

  private fetchMoreTokens(): void {
    this.scanToNextToken();
    this.stalePossibleSimpleKeys();
    this.unwindIndent(this.column);
    const ch = this.peek();
    if (ch === "\0") return this.fetchStreamEnd();
    if (ch === "%" && this.checkDirective()) return this.fetchDirective();
    if (ch === "-" && this.checkDocumentStart()) return this.fetchDocumentIndicator("DocumentStart");
    if (ch === "." && this.checkDocumentEnd()) return this.fetchDocumentIndicator("DocumentEnd");
    if (ch === "[") return this.fetchFlowCollectionStart("FlowSequenceStart");
    if (ch === "{") return this.fetchFlowCollectionStart("FlowMappingStart");
    if (ch === "]") return this.fetchFlowCollectionEnd("FlowSequenceEnd");
    if (ch === "}") return this.fetchFlowCollectionEnd("FlowMappingEnd");
    if (ch === ",") return this.fetchFlowEntry();
    if (ch === "-" && this.checkBlockEntry()) return this.fetchBlockEntry();
    if (ch === "?" && this.checkKey()) return this.fetchKey();
    if (ch === ":" && this.checkValue()) return this.fetchValue();
    if (ch === "*") return this.fetchAnchorLike("Alias");
    if (ch === "&") return this.fetchAnchorLike("Anchor");
    if (ch === "!") return this.fetchTag();
    if (ch === "|" && !this.flowLevel) return this.fetchBlockScalar("|");
    if (ch === ">" && !this.flowLevel) return this.fetchBlockScalar(">");
    if (ch === "'") return this.fetchFlowScalar("'");
    if (ch === '"') return this.fetchFlowScalar('"');
    if (this.checkPlain()) return this.fetchPlain();
    throw new ScannerError(
      "while scanning for the next token",
      null,
      `found character ${pyStrRepr(ch)} that cannot start any token`,
      this.getMark(),
    );
  }

  private nextPossibleSimpleKey(): number | null {
    let min: number | null = null;
    for (const key of this.possibleSimpleKeys.values()) {
      if (min === null || key.tokenNumber < min) min = key.tokenNumber;
    }
    return min;
  }

  private stalePossibleSimpleKeys(): void {
    for (const level of [...this.possibleSimpleKeys.keys()]) {
      const key = this.possibleSimpleKeys.get(level) as SimpleKey;
      if (key.line !== this.line || this.index - key.index > 1024) {
        if (key.required) {
          throw new ScannerError("while scanning a simple key", key.mark, "could not find expected ':'", this.getMark());
        }
        this.possibleSimpleKeys.delete(level);
      }
    }
  }

  private savePossibleSimpleKey(): void {
    const required = !this.flowLevel && this.indent === this.column;
    if (this.allowSimpleKey) {
      this.removePossibleSimpleKey();
      const tokenNumber = this.tokensTaken + this.tokens.length;
      this.possibleSimpleKeys.set(this.flowLevel, {
        tokenNumber,
        required,
        index: this.index,
        line: this.line,
        column: this.column,
        mark: this.getMark(),
      });
    }
  }

  private removePossibleSimpleKey(): void {
    const key = this.possibleSimpleKeys.get(this.flowLevel);
    if (key !== undefined) {
      if (key.required) {
        throw new ScannerError("while scanning a simple key", key.mark, "could not find expected ':'", this.getMark());
      }
      this.possibleSimpleKeys.delete(this.flowLevel);
    }
  }

  private unwindIndent(column: number): void {
    if (this.flowLevel) return;
    while (this.indent > column) {
      const mark = this.getMark();
      this.indent = this.indents.pop() as number;
      this.tokens.push({ kind: "BlockEnd", startMark: mark, endMark: mark });
    }
  }

  private addIndent(column: number): boolean {
    if (this.indent < column) {
      this.indents.push(this.indent);
      this.indent = column;
      return true;
    }
    return false;
  }

  // ---- scanner: fetchers ----

  private fetchStreamStart(): void {
    const mark = this.getMark();
    this.tokens.push({ kind: "StreamStart", startMark: mark, endMark: mark });
  }

  private fetchStreamEnd(): void {
    this.unwindIndent(-1);
    this.removePossibleSimpleKey();
    this.allowSimpleKey = false;
    this.possibleSimpleKeys = new Map();
    const mark = this.getMark();
    this.tokens.push({ kind: "StreamEnd", startMark: mark, endMark: mark });
    this.done = true;
  }

  private fetchDirective(): void {
    this.unwindIndent(-1);
    this.removePossibleSimpleKey();
    this.allowSimpleKey = false;
    this.tokens.push(this.scanDirective());
  }

  private fetchDocumentIndicator(kind: TokenKind): void {
    this.unwindIndent(-1);
    this.removePossibleSimpleKey();
    this.allowSimpleKey = false;
    const startMark = this.getMark();
    this.forward(3);
    this.tokens.push({ kind, startMark, endMark: this.getMark() });
  }

  private fetchFlowCollectionStart(kind: TokenKind): void {
    this.savePossibleSimpleKey();
    this.flowLevel += 1;
    this.allowSimpleKey = true;
    const startMark = this.getMark();
    this.forward();
    this.tokens.push({ kind, startMark, endMark: this.getMark() });
  }

  private fetchFlowCollectionEnd(kind: TokenKind): void {
    this.removePossibleSimpleKey();
    this.flowLevel -= 1;
    this.allowSimpleKey = false;
    const startMark = this.getMark();
    this.forward();
    this.tokens.push({ kind, startMark, endMark: this.getMark() });
  }

  private fetchFlowEntry(): void {
    this.allowSimpleKey = true;
    this.removePossibleSimpleKey();
    const startMark = this.getMark();
    this.forward();
    this.tokens.push({ kind: "FlowEntry", startMark, endMark: this.getMark() });
  }

  private fetchBlockEntry(): void {
    if (!this.flowLevel) {
      if (!this.allowSimpleKey) {
        throw new ScannerError(null, null, "sequence entries are not allowed here", this.getMark());
      }
      if (this.addIndent(this.column)) {
        const mark = this.getMark();
        this.tokens.push({ kind: "BlockSequenceStart", startMark: mark, endMark: mark });
      }
    }
    this.allowSimpleKey = true;
    this.removePossibleSimpleKey();
    const startMark = this.getMark();
    this.forward();
    this.tokens.push({ kind: "BlockEntry", startMark, endMark: this.getMark() });
  }

  private fetchKey(): void {
    if (!this.flowLevel) {
      if (!this.allowSimpleKey) {
        throw new ScannerError(null, null, "mapping keys are not allowed here", this.getMark());
      }
      if (this.addIndent(this.column)) {
        const mark = this.getMark();
        this.tokens.push({ kind: "BlockMappingStart", startMark: mark, endMark: mark });
      }
    }
    this.allowSimpleKey = !this.flowLevel;
    this.removePossibleSimpleKey();
    const startMark = this.getMark();
    this.forward();
    this.tokens.push({ kind: "Key", startMark, endMark: this.getMark() });
  }

  private fetchValue(): void {
    const key = this.possibleSimpleKeys.get(this.flowLevel);
    if (key !== undefined) {
      this.possibleSimpleKeys.delete(this.flowLevel);
      this.tokens.splice(key.tokenNumber - this.tokensTaken, 0, { kind: "Key", startMark: key.mark, endMark: key.mark });
      if (!this.flowLevel) {
        if (this.addIndent(key.column)) {
          this.tokens.splice(key.tokenNumber - this.tokensTaken, 0, {
            kind: "BlockMappingStart",
            startMark: key.mark,
            endMark: key.mark,
          });
        }
      }
      this.allowSimpleKey = false;
    } else {
      if (!this.flowLevel) {
        if (!this.allowSimpleKey) {
          throw new ScannerError(null, null, "mapping values are not allowed here", this.getMark());
        }
      }
      if (!this.flowLevel) {
        if (this.addIndent(this.column)) {
          const mark = this.getMark();
          this.tokens.push({ kind: "BlockMappingStart", startMark: mark, endMark: mark });
        }
      }
      this.allowSimpleKey = !this.flowLevel;
      this.removePossibleSimpleKey();
    }
    const startMark = this.getMark();
    this.forward();
    this.tokens.push({ kind: "Value", startMark, endMark: this.getMark() });
  }

  private fetchAnchorLike(kind: "Alias" | "Anchor"): void {
    this.savePossibleSimpleKey();
    this.allowSimpleKey = false;
    this.tokens.push(this.scanAnchor(kind));
  }

  private fetchTag(): void {
    this.savePossibleSimpleKey();
    this.allowSimpleKey = false;
    this.tokens.push(this.scanTag());
  }

  private fetchBlockScalar(style: string): void {
    this.allowSimpleKey = true;
    this.removePossibleSimpleKey();
    this.tokens.push(this.scanBlockScalar(style));
  }

  private fetchFlowScalar(style: string): void {
    this.savePossibleSimpleKey();
    this.allowSimpleKey = false;
    this.tokens.push(this.scanFlowScalar(style));
  }

  private fetchPlain(): void {
    this.savePossibleSimpleKey();
    this.allowSimpleKey = false;
    this.tokens.push(this.scanPlain());
  }

  // ---- scanner: checkers ----

  private checkDirective(): boolean {
    return this.column === 0;
  }

  private checkDocumentStart(): boolean {
    return this.column === 0 && this.prefix(3) === "---" && inS(this.peek(3), BLANK_BREAKZ);
  }

  private checkDocumentEnd(): boolean {
    return this.column === 0 && this.prefix(3) === "..." && inS(this.peek(3), BLANK_BREAKZ);
  }

  private checkBlockEntry(): boolean {
    return inS(this.peek(1), BLANK_BREAKZ);
  }

  private checkKey(): boolean {
    if (this.flowLevel) return true;
    return inS(this.peek(1), BLANK_BREAKZ);
  }

  private checkValue(): boolean {
    if (this.flowLevel) return true;
    return inS(this.peek(1), BLANK_BREAKZ);
  }

  private checkPlain(): boolean {
    const ch = this.peek();
    return (
      !inS(ch, "\0 \t\r\n\x85\u2028\u2029-?:,[]{}#&*!|>'\"%@`") ||
      (!inS(this.peek(1), BLANK_BREAKZ) && (ch === "-" || (!this.flowLevel && inS(ch, "?:"))))
    );
  }

  // ---- scanner: scanners ----

  private scanToNextToken(): void {
    if (this.index === 0 && this.peek() === "\uFEFF") this.forward();
    let found = false;
    while (!found) {
      while (this.peek() === " ") this.forward();
      if (this.peek() === "#") {
        while (!inS(this.peek(), BREAKZ)) this.forward();
      }
      if (this.scanLineBreak()) {
        if (!this.flowLevel) this.allowSimpleKey = true;
      } else {
        found = true;
      }
    }
  }

  private scanDirective(): Token {
    const startMark = this.getMark();
    this.forward();
    const name = this.scanDirectiveName(startMark);
    let value: unknown = null;
    let endMark: Mark;
    if (name === "YAML") {
      value = this.scanYamlDirectiveValue(startMark);
      endMark = this.getMark();
    } else if (name === "TAG") {
      value = this.scanTagDirectiveValue(startMark);
      endMark = this.getMark();
    } else {
      endMark = this.getMark();
      while (!inS(this.peek(), BREAKZ)) this.forward();
    }
    this.scanDirectiveIgnoredLine(startMark);
    return { kind: "Directive", name, value, startMark, endMark };
  }

  private scanDirectiveName(startMark: Mark): string {
    let length = 0;
    let ch = this.peek(length);
    while (isAlnum(ch)) {
      length += 1;
      ch = this.peek(length);
    }
    if (!length) {
      throw new ScannerError(
        "while scanning a directive",
        startMark,
        `expected alphabetic or numeric character, but found ${pyStrRepr(ch)}`,
        this.getMark(),
      );
    }
    const value = this.prefix(length);
    this.forward(length);
    ch = this.peek();
    if (!inS(ch, SPACE_BREAKZ)) {
      throw new ScannerError(
        "while scanning a directive",
        startMark,
        `expected alphabetic or numeric character, but found ${pyStrRepr(ch)}`,
        this.getMark(),
      );
    }
    return value;
  }

  private scanYamlDirectiveValue(startMark: Mark): [number, number] {
    while (this.peek() === " ") this.forward();
    const major = this.scanYamlDirectiveNumber(startMark);
    if (this.peek() !== ".") {
      throw new ScannerError(
        "while scanning a directive",
        startMark,
        `expected a digit or '.', but found ${pyStrRepr(this.peek())}`,
        this.getMark(),
      );
    }
    this.forward();
    const minor = this.scanYamlDirectiveNumber(startMark);
    if (!inS(this.peek(), SPACE_BREAKZ)) {
      throw new ScannerError(
        "while scanning a directive",
        startMark,
        `expected a digit or ' ', but found ${pyStrRepr(this.peek())}`,
        this.getMark(),
      );
    }
    return [major, minor];
  }

  private scanYamlDirectiveNumber(startMark: Mark): number {
    const ch = this.peek();
    if (!("0" <= ch && ch <= "9")) {
      throw new ScannerError("while scanning a directive", startMark, `expected a digit, but found ${pyStrRepr(ch)}`, this.getMark());
    }
    let length = 0;
    while ("0" <= this.peek(length) && this.peek(length) <= "9") length += 1;
    const value = Number(this.prefix(length));
    this.forward(length);
    return value;
  }

  private scanTagDirectiveValue(startMark: Mark): [string, string] {
    while (this.peek() === " ") this.forward();
    const handle = this.scanTagDirectiveHandle(startMark);
    while (this.peek() === " ") this.forward();
    const prefix = this.scanTagDirectivePrefix(startMark);
    return [handle, prefix];
  }

  private scanTagDirectiveHandle(startMark: Mark): string {
    const value = this.scanTagHandle("directive", startMark);
    const ch = this.peek();
    if (ch !== " ") {
      throw new ScannerError("while scanning a directive", startMark, `expected ' ', but found ${pyStrRepr(ch)}`, this.getMark());
    }
    return value;
  }

  private scanTagDirectivePrefix(startMark: Mark): string {
    const value = this.scanTagUri("directive", startMark);
    const ch = this.peek();
    if (!inS(ch, SPACE_BREAKZ)) {
      throw new ScannerError("while scanning a directive", startMark, `expected ' ', but found ${pyStrRepr(ch)}`, this.getMark());
    }
    return value;
  }

  private scanDirectiveIgnoredLine(startMark: Mark): void {
    while (this.peek() === " ") this.forward();
    if (this.peek() === "#") {
      while (!inS(this.peek(), BREAKZ)) this.forward();
    }
    const ch = this.peek();
    if (!inS(ch, BREAKZ)) {
      throw new ScannerError(
        "while scanning a directive",
        startMark,
        `expected a comment or a line break, but found ${pyStrRepr(ch)}`,
        this.getMark(),
      );
    }
    this.scanLineBreak();
  }

  private scanAnchor(kind: "Alias" | "Anchor"): Token {
    const startMark = this.getMark();
    const indicator = this.peek();
    const name = indicator === "*" ? "alias" : "anchor";
    this.forward();
    let length = 0;
    let ch = this.peek(length);
    while (isAlnum(ch)) {
      length += 1;
      ch = this.peek(length);
    }
    if (!length) {
      throw new ScannerError(
        `while scanning an ${name}`,
        startMark,
        `expected alphabetic or numeric character, but found ${pyStrRepr(ch)}`,
        this.getMark(),
      );
    }
    const value = this.prefix(length);
    this.forward(length);
    ch = this.peek();
    if (!inS(ch, "\0 \t\r\n\x85\u2028\u2029?:,]}%@`")) {
      throw new ScannerError(
        `while scanning an ${name}`,
        startMark,
        `expected alphabetic or numeric character, but found ${pyStrRepr(ch)}`,
        this.getMark(),
      );
    }
    return { kind, value, startMark, endMark: this.getMark() };
  }

  private scanTag(): Token {
    const startMark = this.getMark();
    let ch = this.peek(1);
    let handle: string | null;
    let suffix: string;
    if (ch === "<") {
      handle = null;
      this.forward(2);
      suffix = this.scanTagUri("tag", startMark);
      if (this.peek() !== ">") {
        throw new ScannerError("while parsing a tag", startMark, `expected '>', but found ${pyStrRepr(this.peek())}`, this.getMark());
      }
      this.forward();
    } else if (inS(ch, BLANK_BREAKZ)) {
      handle = null;
      suffix = "!";
      this.forward();
    } else {
      let length = 1;
      let useHandle = false;
      while (!inS(ch, SPACE_BREAKZ)) {
        if (ch === "!") {
          useHandle = true;
          break;
        }
        length += 1;
        ch = this.peek(length);
      }
      handle = "!";
      if (useHandle) {
        handle = this.scanTagHandle("tag", startMark);
      } else {
        handle = "!";
        this.forward();
      }
      suffix = this.scanTagUri("tag", startMark);
    }
    ch = this.peek();
    if (!inS(ch, SPACE_BREAKZ)) {
      throw new ScannerError("while scanning a tag", startMark, `expected ' ', but found ${pyStrRepr(ch)}`, this.getMark());
    }
    return { kind: "Tag", value: [handle, suffix], startMark, endMark: this.getMark() };
  }

  private scanBlockScalar(style: string): Token {
    const folded = style === ">";
    const chunks: string[] = [];
    const startMark = this.getMark();
    this.forward();
    const [chomping, increment] = this.scanBlockScalarIndicators(startMark);
    this.scanBlockScalarIgnoredLine(startMark);

    let minIndent = this.indent + 1;
    if (minIndent < 1) minIndent = 1;
    let breaks: string[];
    let maxIndent: number;
    let endMark: Mark;
    let indent: number;
    if (increment === null) {
      [breaks, maxIndent, endMark] = this.scanBlockScalarIndentation();
      indent = Math.max(minIndent, maxIndent);
    } else {
      indent = minIndent + increment - 1;
      [breaks, endMark] = this.scanBlockScalarBreaks(indent);
    }
    let lineBreak = "";

    while (this.column === indent && this.peek() !== "\0") {
      chunks.push(...breaks);
      const leadingNonSpace = !inS(this.peek(), " \t");
      let length = 0;
      while (!inS(this.peek(length), BREAKZ)) length += 1;
      chunks.push(this.prefix(length));
      this.forward(length);
      lineBreak = this.scanLineBreak();
      [breaks, endMark] = this.scanBlockScalarBreaks(indent);
      if (this.column === indent && this.peek() !== "\0") {
        if (folded && lineBreak === "\n" && leadingNonSpace && !inS(this.peek(), " \t")) {
          if (breaks.length === 0) chunks.push(" ");
        } else {
          chunks.push(lineBreak);
        }
      } else {
        break;
      }
    }

    if (chomping !== false) chunks.push(lineBreak);
    if (chomping === true) chunks.push(...breaks);

    return { kind: "Scalar", value: chunks.join(""), plain: false, startMark, endMark, style };
  }

  private scanBlockScalarIndicators(startMark: Mark): [boolean | null, number | null] {
    let chomping: boolean | null = null;
    let increment: number | null = null;
    let ch = this.peek();
    if (inS(ch, "+-")) {
      chomping = ch === "+";
      this.forward();
      ch = this.peek();
      if (inS(ch, "0123456789")) {
        increment = Number(ch);
        if (increment === 0) {
          throw new ScannerError(
            "while scanning a block scalar",
            startMark,
            "expected indentation indicator in the range 1-9, but found 0",
            this.getMark(),
          );
        }
        this.forward();
      }
    } else if (inS(ch, "0123456789")) {
      increment = Number(ch);
      if (increment === 0) {
        throw new ScannerError(
          "while scanning a block scalar",
          startMark,
          "expected indentation indicator in the range 1-9, but found 0",
          this.getMark(),
        );
      }
      this.forward();
      ch = this.peek();
      if (inS(ch, "+-")) {
        chomping = ch === "+";
        this.forward();
      }
    }
    ch = this.peek();
    if (!inS(ch, SPACE_BREAKZ)) {
      throw new ScannerError(
        "while scanning a block scalar",
        startMark,
        `expected chomping or indentation indicators, but found ${pyStrRepr(ch)}`,
        this.getMark(),
      );
    }
    return [chomping, increment];
  }

  private scanBlockScalarIgnoredLine(startMark: Mark): void {
    while (this.peek() === " ") this.forward();
    if (this.peek() === "#") {
      while (!inS(this.peek(), BREAKZ)) this.forward();
    }
    const ch = this.peek();
    if (!inS(ch, BREAKZ)) {
      throw new ScannerError(
        "while scanning a block scalar",
        startMark,
        `expected a comment or a line break, but found ${pyStrRepr(ch)}`,
        this.getMark(),
      );
    }
    this.scanLineBreak();
  }

  private scanBlockScalarIndentation(): [string[], number, Mark] {
    const chunks: string[] = [];
    let maxIndent = 0;
    let endMark = this.getMark();
    while (inS(this.peek(), " \r\n\x85\u2028\u2029")) {
      if (this.peek() !== " ") {
        chunks.push(this.scanLineBreak());
        endMark = this.getMark();
      } else {
        this.forward();
        if (this.column > maxIndent) maxIndent = this.column;
      }
    }
    return [chunks, maxIndent, endMark];
  }

  private scanBlockScalarBreaks(indent: number): [string[], Mark] {
    const chunks: string[] = [];
    let endMark = this.getMark();
    while (this.column < indent && this.peek() === " ") this.forward();
    while (inS(this.peek(), "\r\n\x85\u2028\u2029")) {
      chunks.push(this.scanLineBreak());
      endMark = this.getMark();
      while (this.column < indent && this.peek() === " ") this.forward();
    }
    return [chunks, endMark];
  }

  private scanFlowScalar(style: string): Token {
    const double = style === '"';
    const chunks: string[] = [];
    const startMark = this.getMark();
    const quote = this.peek();
    this.forward();
    chunks.push(...this.scanFlowScalarNonSpaces(double, startMark));
    while (this.peek() !== quote) {
      chunks.push(...this.scanFlowScalarSpaces(double, startMark));
      chunks.push(...this.scanFlowScalarNonSpaces(double, startMark));
    }
    this.forward();
    return { kind: "Scalar", value: chunks.join(""), plain: false, startMark, endMark: this.getMark(), style };
  }

  private scanFlowScalarNonSpaces(double: boolean, startMark: Mark): string[] {
    const chunks: string[] = [];
    for (;;) {
      let length = 0;
      while (!inS(this.peek(length), "'\"\\\0 \t\r\n\x85\u2028\u2029")) length += 1;
      if (length) {
        chunks.push(this.prefix(length));
        this.forward(length);
      }
      let ch = this.peek();
      if (!double && ch === "'" && this.peek(1) === "'") {
        chunks.push("'");
        this.forward(2);
      } else if ((double && ch === "'") || (!double && inS(ch, "\"\\"))) {
        chunks.push(ch);
        this.forward();
      } else if (double && ch === "\\") {
        this.forward();
        ch = this.peek();
        if (Object.prototype.hasOwnProperty.call(ESCAPE_REPLACEMENTS, ch)) {
          chunks.push(ESCAPE_REPLACEMENTS[ch] as string);
          this.forward();
        } else if (Object.prototype.hasOwnProperty.call(ESCAPE_CODES, ch)) {
          length = ESCAPE_CODES[ch] as number;
          this.forward();
          for (let k = 0; k < length; k += 1) {
            if (!inS(this.peek(k), HEX)) {
              throw new ScannerError(
                "while scanning a double-quoted scalar",
                startMark,
                `expected escape sequence of ${length} hexadecimal numbers, but found ${pyStrRepr(this.peek(k))}`,
                this.getMark(),
              );
            }
          }
          const code = parseInt(this.prefix(length), 16);
          chunks.push(chrOf(code));
          this.forward(length);
        } else if (inS(ch, "\r\n\x85\u2028\u2029")) {
          this.scanLineBreak();
          chunks.push(...this.scanFlowScalarBreaks(double, startMark));
        } else {
          throw new ScannerError(
            "while scanning a double-quoted scalar",
            startMark,
            `found unknown escape character ${pyStrRepr(ch)}`,
            this.getMark(),
          );
        }
      } else {
        return chunks;
      }
    }
  }

  private scanFlowScalarSpaces(double: boolean, startMark: Mark): string[] {
    const chunks: string[] = [];
    let length = 0;
    while (inS(this.peek(length), " \t")) length += 1;
    const whitespaces = this.prefix(length);
    this.forward(length);
    const ch = this.peek();
    if (ch === "\0") {
      throw new ScannerError("while scanning a quoted scalar", startMark, "found unexpected end of stream", this.getMark());
    } else if (inS(ch, "\r\n\x85\u2028\u2029")) {
      const lineBreak = this.scanLineBreak();
      const breaks = this.scanFlowScalarBreaks(double, startMark);
      if (lineBreak !== "\n") chunks.push(lineBreak);
      else if (breaks.length === 0) chunks.push(" ");
      chunks.push(...breaks);
    } else {
      chunks.push(whitespaces);
    }
    return chunks;
  }

  private scanFlowScalarBreaks(_double: boolean, startMark: Mark): string[] {
    const chunks: string[] = [];
    for (;;) {
      const prefix = this.prefix(3);
      if ((prefix === "---" || prefix === "...") && inS(this.peek(3), BLANK_BREAKZ)) {
        throw new ScannerError("while scanning a quoted scalar", startMark, "found unexpected document separator", this.getMark());
      }
      while (inS(this.peek(), " \t")) this.forward();
      if (inS(this.peek(), "\r\n\x85\u2028\u2029")) {
        chunks.push(this.scanLineBreak());
      } else {
        return chunks;
      }
    }
  }

  private scanPlain(): Token {
    const chunks: string[] = [];
    const startMark = this.getMark();
    let endMark = startMark;
    const indent = this.indent + 1;
    let spaces: string[] = [];
    for (;;) {
      let length = 0;
      if (this.peek() === "#") break;
      for (;;) {
        const ch = this.peek(length);
        if (
          inS(ch, BLANK_BREAKZ) ||
          (ch === ":" && inS(this.peek(length + 1), BLANK_BREAKZ + (this.flowLevel ? ",[]{}" : ""))) ||
          (this.flowLevel && inS(ch, ",?[]{}"))
        ) {
          break;
        }
        length += 1;
      }
      if (length === 0) break;
      this.allowSimpleKey = false;
      chunks.push(...spaces);
      chunks.push(this.prefix(length));
      this.forward(length);
      endMark = this.getMark();
      const next = this.scanPlainSpaces();
      if (next === null) {
        spaces = [];
        break;
      }
      spaces = next;
      if (spaces.length === 0 || this.peek() === "#" || (!this.flowLevel && this.column < indent)) break;
    }
    return { kind: "Scalar", value: chunks.join(""), plain: true, startMark, endMark, style: null };
  }

  /** `null` mirrors Python's bare `return` (None) at a document separator. */
  private scanPlainSpaces(): string[] | null {
    const chunks: string[] = [];
    let length = 0;
    while (this.peek(length) === " ") length += 1;
    const whitespaces = this.prefix(length);
    this.forward(length);
    const ch = this.peek();
    if (inS(ch, "\r\n\x85\u2028\u2029")) {
      const lineBreak = this.scanLineBreak();
      this.allowSimpleKey = true;
      let prefix = this.prefix(3);
      if ((prefix === "---" || prefix === "...") && inS(this.peek(3), BLANK_BREAKZ)) return null;
      const breaks: string[] = [];
      while (inS(this.peek(), " \r\n\x85\u2028\u2029")) {
        if (this.peek() === " ") {
          this.forward();
        } else {
          breaks.push(this.scanLineBreak());
          prefix = this.prefix(3);
          if ((prefix === "---" || prefix === "...") && inS(this.peek(3), BLANK_BREAKZ)) return null;
        }
      }
      if (lineBreak !== "\n") chunks.push(lineBreak);
      else if (breaks.length === 0) chunks.push(" ");
      chunks.push(...breaks);
    } else if (whitespaces) {
      chunks.push(whitespaces);
    }
    return chunks;
  }

  private scanTagHandle(name: string, startMark: Mark): string {
    let ch = this.peek();
    if (ch !== "!") {
      throw new ScannerError(`while scanning a ${name}`, startMark, `expected '!', but found ${pyStrRepr(ch)}`, this.getMark());
    }
    let length = 1;
    ch = this.peek(length);
    if (ch !== " ") {
      while (isAlnum(ch)) {
        length += 1;
        ch = this.peek(length);
      }
      if (ch !== "!") {
        this.forward(length);
        throw new ScannerError(`while scanning a ${name}`, startMark, `expected '!', but found ${pyStrRepr(ch)}`, this.getMark());
      }
      length += 1;
    }
    const value = this.prefix(length);
    this.forward(length);
    return value;
  }

  private scanTagUri(name: string, startMark: Mark): string {
    const chunks: string[] = [];
    let length = 0;
    let ch = this.peek(length);
    while (isUriChar(ch)) {
      if (ch === "%") {
        chunks.push(this.prefix(length));
        this.forward(length);
        length = 0;
        chunks.push(this.scanUriEscapes(name, startMark));
      } else {
        length += 1;
      }
      ch = this.peek(length);
    }
    if (length) {
      chunks.push(this.prefix(length));
      this.forward(length);
      length = 0;
    }
    if (chunks.length === 0) {
      throw new ScannerError(`while parsing a ${name}`, startMark, `expected URI, but found ${pyStrRepr(ch)}`, this.getMark());
    }
    return chunks.join("");
  }

  private scanUriEscapes(name: string, startMark: Mark): string {
    const codes: number[] = [];
    const mark = this.getMark();
    while (this.peek() === "%") {
      this.forward();
      for (let k = 0; k < 2; k += 1) {
        if (!inS(this.peek(k), HEX)) {
          throw new ScannerError(
            `while scanning a ${name}`,
            startMark,
            `expected URI escape sequence of 2 hexadecimal numbers, but found ${pyStrRepr(this.peek(k))}`,
            this.getMark(),
          );
        }
      }
      codes.push(parseInt(this.prefix(2), 16));
      this.forward(2);
    }
    const bytes = Uint8Array.from(codes);
    const failure = _utf8DecodeError(bytes);
    if (failure !== null) throw new ScannerError(`while scanning a ${name}`, startMark, failure, mark);
    return Buffer.from(bytes).toString("utf8");
  }

  private scanLineBreak(): string {
    const ch = this.peek();
    if (inS(ch, "\r\n\x85")) {
      if (this.prefix(2) === "\r\n") this.forward(2);
      else this.forward();
      return "\n";
    }
    if (inS(ch, "\u2028\u2029")) {
      this.forward();
      return ch;
    }
    return "";
  }

  // ---- parser ----

  private checkEvent(...kinds: EventKind[]): boolean {
    if (this.currentEvent === null && this.state) this.currentEvent = this.state.call(this);
    if (this.currentEvent !== null) {
      if (kinds.length === 0) return true;
      for (const kind of kinds) if (this.currentEvent.kind === kind) return true;
    }
    return false;
  }

  private peekEvent(): YEvent {
    if (this.currentEvent === null && this.state) this.currentEvent = this.state.call(this);
    return this.currentEvent as YEvent;
  }

  private getEvent(): YEvent {
    if (this.currentEvent === null && this.state) this.currentEvent = this.state.call(this);
    const value = this.currentEvent as YEvent;
    this.currentEvent = null;
    return value;
  }

  private popState(): ParseState {
    return this.states.pop() as ParseState;
  }

  private readonly parseStreamStart: ParseState = () => {
    const token = this.getToken();
    this.state = this.parseImplicitDocumentStart;
    return { kind: "StreamStart", startMark: token.startMark, endMark: token.endMark };
  };

  private readonly parseImplicitDocumentStart: ParseState = () => {
    if (!this.checkToken("Directive", "DocumentStart", "StreamEnd")) {
      this.tagHandles = { "!": "!", "!!": TAG_PREFIX };
      const token = this.peekToken();
      this.states.push(this.parseDocumentEnd);
      this.state = this.parseBlockNode;
      return { kind: "DocumentStart", startMark: token.startMark, endMark: token.startMark, implicit: true };
    }
    return this.parseDocumentStart();
  };

  private readonly parseDocumentStart: ParseState = () => {
    while (this.checkToken("DocumentEnd")) this.getToken();
    if (!this.checkToken("StreamEnd")) {
      let token = this.peekToken();
      const startMark = token.startMark;
      this.processDirectives();
      if (!this.checkToken("DocumentStart")) {
        throw new ParserError(
          null,
          null,
          `expected '<document start>', but found ${pyStrRepr(TOKEN_IDS[this.peekToken().kind])}`,
          this.peekToken().startMark,
        );
      }
      token = this.getToken();
      this.states.push(this.parseDocumentEnd);
      this.state = this.parseDocumentContent;
      return { kind: "DocumentStart", startMark, endMark: token.endMark, implicit: false };
    }
    const token = this.getToken();
    this.state = null;
    return { kind: "StreamEnd", startMark: token.startMark, endMark: token.endMark };
  };

  private readonly parseDocumentEnd: ParseState = () => {
    let token = this.peekToken();
    const startMark = token.startMark;
    let endMark = token.startMark;
    if (this.checkToken("DocumentEnd")) {
      token = this.getToken();
      endMark = token.endMark;
    }
    this.state = this.parseDocumentStart;
    return { kind: "DocumentEnd", startMark, endMark };
  };

  private readonly parseDocumentContent: ParseState = () => {
    if (this.checkToken("Directive", "DocumentStart", "DocumentEnd", "StreamEnd")) {
      const event = this.processEmptyScalar(this.peekToken().startMark);
      this.state = this.popState();
      return event;
    }
    return this.parseBlockNode();
  };

  private processDirectives(): void {
    let yamlVersion: [number, number] | null = null;
    this.tagHandles = {};
    while (this.checkToken("Directive")) {
      const token = this.getToken();
      if (token.name === "YAML") {
        if (yamlVersion !== null) {
          throw new ParserError(null, null, "found duplicate YAML directive", token.startMark);
        }
        const [major] = token.value as [number, number];
        if (major !== 1) {
          throw new ParserError(null, null, "found incompatible YAML document (version 1.* is required)", token.startMark);
        }
        yamlVersion = token.value as [number, number];
      } else if (token.name === "TAG") {
        const [handle, prefix] = token.value as [string, string];
        if (Object.prototype.hasOwnProperty.call(this.tagHandles, handle)) {
          throw new ParserError(null, null, `duplicate tag handle ${pyStrRepr(handle)}`, token.startMark);
        }
        this.tagHandles[handle] = prefix;
      }
    }
    for (const [key, value] of Object.entries({ "!": "!", "!!": TAG_PREFIX })) {
      if (!Object.prototype.hasOwnProperty.call(this.tagHandles, key)) this.tagHandles[key] = value;
    }
  }

  private readonly parseBlockNode: ParseState = () => this.parseNode(true, false);
  private readonly parseFlowNode: ParseState = () => this.parseNode(false, false);
  private readonly parseBlockNodeOrIndentlessSequence: ParseState = () => this.parseNode(true, true);

  private parseNode(block: boolean, indentlessSequence: boolean): YEvent {
    if (this.checkToken("Alias")) {
      const token = this.getToken();
      this.state = this.popState();
      return { kind: "Alias", anchor: token.value as string, startMark: token.startMark, endMark: token.endMark };
    }
    let anchor: string | null = null;
    let tagPair: [string | null, string] | null = null;
    let tag: string | null = null;
    let startMark: Mark | null = null;
    let endMark: Mark | null = null;
    let tagMark: Mark | null = null;
    if (this.checkToken("Anchor")) {
      let token = this.getToken();
      startMark = token.startMark;
      endMark = token.endMark;
      anchor = token.value as string;
      if (this.checkToken("Tag")) {
        token = this.getToken();
        tagMark = token.startMark;
        endMark = token.endMark;
        tagPair = token.value as [string | null, string];
      }
    } else if (this.checkToken("Tag")) {
      let token = this.getToken();
      startMark = tagMark = token.startMark;
      endMark = token.endMark;
      tagPair = token.value as [string | null, string];
      if (this.checkToken("Anchor")) {
        token = this.getToken();
        endMark = token.endMark;
        anchor = token.value as string;
      }
    }
    if (tagPair !== null) {
      const [handle, suffix] = tagPair;
      if (handle !== null) {
        if (!Object.prototype.hasOwnProperty.call(this.tagHandles, handle)) {
          throw new ParserError(
            "while parsing a node",
            startMark,
            `found undefined tag handle ${pyStrRepr(handle)}`,
            tagMark,
          );
        }
        tag = (this.tagHandles[handle] as string) + suffix;
      } else {
        tag = suffix;
      }
    }
    if (startMark === null) {
      startMark = endMark = this.peekToken().startMark;
    }
    let event: YEvent;
    const implicit = tag === null || tag === "!";
    if (indentlessSequence && this.checkToken("BlockEntry")) {
      endMark = this.peekToken().endMark;
      event = { kind: "SequenceStart", anchor, tag, implicit, startMark, endMark };
      this.state = this.parseIndentlessSequenceEntry;
    } else if (this.checkToken("Scalar")) {
      const token = this.getToken();
      endMark = token.endMark;
      let imp: [boolean, boolean];
      if ((token.plain && tag === null) || tag === "!") imp = [true, false];
      else if (tag === null) imp = [false, true];
      else imp = [false, false];
      event = { kind: "Scalar", anchor, tag, implicit: imp, value: token.value as string, startMark, endMark, style: token.style ?? null };
      this.state = this.popState();
    } else if (this.checkToken("FlowSequenceStart")) {
      endMark = this.peekToken().endMark;
      event = { kind: "SequenceStart", anchor, tag, implicit, startMark, endMark, flowStyle: true };
      this.state = this.parseFlowSequenceFirstEntry;
    } else if (this.checkToken("FlowMappingStart")) {
      endMark = this.peekToken().endMark;
      event = { kind: "MappingStart", anchor, tag, implicit, startMark, endMark, flowStyle: true };
      this.state = this.parseFlowMappingFirstKey;
    } else if (block && this.checkToken("BlockSequenceStart")) {
      endMark = this.peekToken().startMark;
      event = { kind: "SequenceStart", anchor, tag, implicit, startMark, endMark, flowStyle: false };
      this.state = this.parseBlockSequenceFirstEntry;
    } else if (block && this.checkToken("BlockMappingStart")) {
      endMark = this.peekToken().startMark;
      event = { kind: "MappingStart", anchor, tag, implicit, startMark, endMark, flowStyle: false };
      this.state = this.parseBlockMappingFirstKey;
    } else if (anchor !== null || tag !== null) {
      event = {
        kind: "Scalar",
        anchor,
        tag,
        implicit: [implicit, false],
        value: "",
        startMark,
        endMark: endMark as Mark,
        style: null,
      };
      this.state = this.popState();
    } else {
      const node = block ? "block" : "flow";
      const token = this.peekToken();
      throw new ParserError(
        `while parsing a ${node} node`,
        startMark,
        `expected the node content, but found ${pyStrRepr(TOKEN_IDS[token.kind])}`,
        token.startMark,
      );
    }
    return event;
  }

  private readonly parseBlockSequenceFirstEntry: ParseState = () => {
    const token = this.getToken();
    this.marks.push(token.startMark);
    return this.parseBlockSequenceEntry();
  };

  private readonly parseBlockSequenceEntry: ParseState = () => {
    if (this.checkToken("BlockEntry")) {
      const token = this.getToken();
      if (!this.checkToken("BlockEntry", "BlockEnd")) {
        this.states.push(this.parseBlockSequenceEntry);
        return this.parseBlockNode();
      }
      this.state = this.parseBlockSequenceEntry;
      return this.processEmptyScalar(token.endMark);
    }
    if (!this.checkToken("BlockEnd")) {
      const token = this.peekToken();
      throw new ParserError(
        "while parsing a block collection",
        this.marks[this.marks.length - 1] as Mark,
        `expected <block end>, but found ${pyStrRepr(TOKEN_IDS[token.kind])}`,
        token.startMark,
      );
    }
    const token = this.getToken();
    this.state = this.popState();
    this.marks.pop();
    return { kind: "SequenceEnd", startMark: token.startMark, endMark: token.endMark };
  };

  private readonly parseIndentlessSequenceEntry: ParseState = () => {
    if (this.checkToken("BlockEntry")) {
      const token = this.getToken();
      if (!this.checkToken("BlockEntry", "Key", "Value", "BlockEnd")) {
        this.states.push(this.parseIndentlessSequenceEntry);
        return this.parseBlockNode();
      }
      this.state = this.parseIndentlessSequenceEntry;
      return this.processEmptyScalar(token.endMark);
    }
    const token = this.peekToken();
    this.state = this.popState();
    return { kind: "SequenceEnd", startMark: token.startMark, endMark: token.startMark };
  };

  private readonly parseBlockMappingFirstKey: ParseState = () => {
    const token = this.getToken();
    this.marks.push(token.startMark);
    return this.parseBlockMappingKey();
  };

  private readonly parseBlockMappingKey: ParseState = () => {
    if (this.checkToken("Key")) {
      const token = this.getToken();
      if (!this.checkToken("Key", "Value", "BlockEnd")) {
        this.states.push(this.parseBlockMappingValue);
        return this.parseBlockNodeOrIndentlessSequence();
      }
      this.state = this.parseBlockMappingValue;
      return this.processEmptyScalar(token.endMark);
    }
    if (!this.checkToken("BlockEnd")) {
      const token = this.peekToken();
      throw new ParserError(
        "while parsing a block mapping",
        this.marks[this.marks.length - 1] as Mark,
        `expected <block end>, but found ${pyStrRepr(TOKEN_IDS[token.kind])}`,
        token.startMark,
      );
    }
    const token = this.getToken();
    this.state = this.popState();
    this.marks.pop();
    return { kind: "MappingEnd", startMark: token.startMark, endMark: token.endMark };
  };

  private readonly parseBlockMappingValue: ParseState = () => {
    if (this.checkToken("Value")) {
      const token = this.getToken();
      if (!this.checkToken("Key", "Value", "BlockEnd")) {
        this.states.push(this.parseBlockMappingKey);
        return this.parseBlockNodeOrIndentlessSequence();
      }
      this.state = this.parseBlockMappingKey;
      return this.processEmptyScalar(token.endMark);
    }
    this.state = this.parseBlockMappingKey;
    const token = this.peekToken();
    return this.processEmptyScalar(token.startMark);
  };

  private readonly parseFlowSequenceFirstEntry: ParseState = () => {
    const token = this.getToken();
    this.marks.push(token.startMark);
    return this.parseFlowSequenceEntry(true);
  };

  private readonly parseFlowSequenceEntryNext: ParseState = () => this.parseFlowSequenceEntry(false);

  private parseFlowSequenceEntry(first: boolean): YEvent {
    if (!this.checkToken("FlowSequenceEnd")) {
      if (!first) {
        if (this.checkToken("FlowEntry")) {
          this.getToken();
        } else {
          const token = this.peekToken();
          throw new ParserError(
            "while parsing a flow sequence",
            this.marks[this.marks.length - 1] as Mark,
            `expected ',' or ']', but got ${pyStrRepr(TOKEN_IDS[token.kind])}`,
            token.startMark,
          );
        }
      }
      if (this.checkToken("Key")) {
        const token = this.peekToken();
        this.state = this.parseFlowSequenceEntryMappingKey;
        return {
          kind: "MappingStart",
          anchor: null,
          tag: null,
          implicit: true,
          startMark: token.startMark,
          endMark: token.endMark,
          flowStyle: true,
        };
      } else if (!this.checkToken("FlowSequenceEnd")) {
        this.states.push(this.parseFlowSequenceEntryNext);
        return this.parseFlowNode();
      }
    }
    const token = this.getToken();
    this.state = this.popState();
    this.marks.pop();
    return { kind: "SequenceEnd", startMark: token.startMark, endMark: token.endMark };
  }

  private readonly parseFlowSequenceEntryMappingKey: ParseState = () => {
    const token = this.getToken();
    if (!this.checkToken("Value", "FlowEntry", "FlowSequenceEnd")) {
      this.states.push(this.parseFlowSequenceEntryMappingValue);
      return this.parseFlowNode();
    }
    this.state = this.parseFlowSequenceEntryMappingValue;
    return this.processEmptyScalar(token.endMark);
  };

  private readonly parseFlowSequenceEntryMappingValue: ParseState = () => {
    if (this.checkToken("Value")) {
      const token = this.getToken();
      if (!this.checkToken("FlowEntry", "FlowSequenceEnd")) {
        this.states.push(this.parseFlowSequenceEntryMappingEnd);
        return this.parseFlowNode();
      }
      this.state = this.parseFlowSequenceEntryMappingEnd;
      return this.processEmptyScalar(token.endMark);
    }
    this.state = this.parseFlowSequenceEntryMappingEnd;
    const token = this.peekToken();
    return this.processEmptyScalar(token.startMark);
  };

  private readonly parseFlowSequenceEntryMappingEnd: ParseState = () => {
    this.state = this.parseFlowSequenceEntryNext;
    const token = this.peekToken();
    return { kind: "MappingEnd", startMark: token.startMark, endMark: token.startMark };
  };

  private readonly parseFlowMappingFirstKey: ParseState = () => {
    const token = this.getToken();
    this.marks.push(token.startMark);
    return this.parseFlowMappingKey(true);
  };

  private readonly parseFlowMappingKeyNext: ParseState = () => this.parseFlowMappingKey(false);

  private parseFlowMappingKey(first: boolean): YEvent {
    if (!this.checkToken("FlowMappingEnd")) {
      if (!first) {
        if (this.checkToken("FlowEntry")) {
          this.getToken();
        } else {
          const token = this.peekToken();
          throw new ParserError(
            "while parsing a flow mapping",
            this.marks[this.marks.length - 1] as Mark,
            `expected ',' or '}', but got ${pyStrRepr(TOKEN_IDS[token.kind])}`,
            token.startMark,
          );
        }
      }
      if (this.checkToken("Key")) {
        const token = this.getToken();
        if (!this.checkToken("Value", "FlowEntry", "FlowMappingEnd")) {
          this.states.push(this.parseFlowMappingValue);
          return this.parseFlowNode();
        }
        this.state = this.parseFlowMappingValue;
        return this.processEmptyScalar(token.endMark);
      } else if (!this.checkToken("FlowMappingEnd")) {
        this.states.push(this.parseFlowMappingEmptyValue);
        return this.parseFlowNode();
      }
    }
    const token = this.getToken();
    this.state = this.popState();
    this.marks.pop();
    return { kind: "MappingEnd", startMark: token.startMark, endMark: token.endMark };
  }

  private readonly parseFlowMappingValue: ParseState = () => {
    if (this.checkToken("Value")) {
      const token = this.getToken();
      if (!this.checkToken("FlowEntry", "FlowMappingEnd")) {
        this.states.push(this.parseFlowMappingKeyNext);
        return this.parseFlowNode();
      }
      this.state = this.parseFlowMappingKeyNext;
      return this.processEmptyScalar(token.endMark);
    }
    this.state = this.parseFlowMappingKeyNext;
    const token = this.peekToken();
    return this.processEmptyScalar(token.startMark);
  };

  private readonly parseFlowMappingEmptyValue: ParseState = () => {
    this.state = this.parseFlowMappingKeyNext;
    return this.processEmptyScalar(this.peekToken().startMark);
  };

  private processEmptyScalar(mark: Mark): YEvent {
    return { kind: "Scalar", anchor: null, tag: null, implicit: [true, false], value: "", startMark: mark, endMark: mark, style: null };
  }

  // ---- composer ----

  getSingleNode(): YNode | null {
    this.getEvent();
    let document: YNode | null = null;
    if (!this.checkEvent("StreamEnd")) document = this.composeDocument();
    if (!this.checkEvent("StreamEnd")) {
      const event = this.getEvent();
      throw new ComposerError(
        "expected a single document in the stream",
        (document as YNode).startMark,
        "but found another document",
        event.startMark,
      );
    }
    this.getEvent();
    return document;
  }

  private composeDocument(): YNode {
    this.getEvent();
    const node = this.composeNode();
    this.getEvent();
    this.anchors = new Map();
    return node;
  }

  private composeNode(): YNode {
    if (this.checkEvent("Alias")) {
      const event = this.getEvent();
      const anchor = event.anchor as string;
      const found = this.anchors.get(anchor);
      if (found === undefined) {
        throw new ComposerError(null, null, `found undefined alias ${pyStrRepr(anchor)}`, event.startMark);
      }
      return found;
    }
    const event = this.peekEvent();
    const anchor = event.anchor ?? null;
    if (anchor !== null) {
      const existing = this.anchors.get(anchor);
      if (existing !== undefined) {
        throw new ComposerError(
          `found duplicate anchor ${pyStrRepr(anchor)}; first occurrence`,
          existing.startMark,
          "second occurrence",
          event.startMark,
        );
      }
    }
    let node: YNode;
    if (this.checkEvent("Scalar")) node = this.composeScalarNode(anchor);
    else if (this.checkEvent("SequenceStart")) node = this.composeSequenceNode(anchor);
    else node = this.composeMappingNode(anchor);
    return node;
  }

  private composeScalarNode(anchor: string | null): YNode {
    const event = this.getEvent();
    let tag = event.tag ?? null;
    if (tag === null || tag === "!") {
      const implicit = event.implicit as [boolean, boolean];
      tag = implicit[0] ? resolveImplicit(event.value as string) : TAG_STR;
    }
    const node: YNode = { kind: "scalar", tag, value: event.value as string, startMark: event.startMark, endMark: event.endMark };
    if (anchor !== null) this.anchors.set(anchor, node);
    return node;
  }

  private composeSequenceNode(anchor: string | null): YNode {
    const startEvent = this.getEvent();
    let tag = startEvent.tag ?? null;
    if (tag === null || tag === "!") tag = TAG_SEQ;
    const items: YNode[] = [];
    const node: YNode = { kind: "sequence", tag, value: items, startMark: startEvent.startMark, endMark: startEvent.endMark };
    if (anchor !== null) this.anchors.set(anchor, node);
    while (!this.checkEvent("SequenceEnd")) items.push(this.composeNode());
    node.endMark = this.getEvent().endMark;
    return node;
  }

  private composeMappingNode(anchor: string | null): YNode {
    const startEvent = this.getEvent();
    let tag = startEvent.tag ?? null;
    if (tag === null || tag === "!") tag = TAG_MAP;
    const pairs: Array<[YNode, YNode]> = [];
    const node: YNode = { kind: "mapping", tag, value: pairs, startMark: startEvent.startMark, endMark: startEvent.endMark };
    if (anchor !== null) this.anchors.set(anchor, node);
    while (!this.checkEvent("MappingEnd")) {
      const key = this.composeNode();
      const value = this.composeNode();
      pairs.push([key, value]);
    }
    node.endMark = this.getEvent().endMark;
    return node;
  }
}

function isUriChar(ch: string): boolean {
  return (
    ("0" <= ch && ch <= "9") || ("A" <= ch && ch <= "Z") || ("a" <= ch && ch <= "z") || (ch.length > 0 && "-;/?:@&=+$,_.!~*'()[]%".includes(ch))
  );
}

// ---------------------------------------------------------------------------
// SafeConstructor
// ---------------------------------------------------------------------------

export type Rich =
  | null
  | boolean
  | number
  | bigint
  | string
  | PyFloat
  | PyDate
  | Uint8Array
  | Set<unknown>
  | Map<unknown, unknown>
  | unknown[];

const INT_BIG = BigInt(Number.MAX_SAFE_INTEGER);

function normaliseInt(value: bigint): number | bigint {
  return value > INT_BIG || value < -INT_BIG ? value : Number(value);
}

const PY_WS = /^[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;

/** Python `int(text, base)` for the shapes the YAML constructors feed it. */
function pyInt(text: string, base: 2 | 8 | 10 | 16): bigint {
  const fail = (): never => {
    throw pyValueError(`invalid literal for int() with base ${base}: ${pyStrRepr(text)}`);
  };
  let s = text.replace(PY_WS, "");
  let negative = false;
  if (s[0] === "-" || s[0] === "+") {
    negative = s[0] === "-";
    s = s.slice(1);
  }
  const prefix = base === 16 ? "0x" : base === 8 ? "0o" : base === 2 ? "0b" : "";
  if (prefix && s.slice(0, 2).toLowerCase() === prefix) s = s.slice(2);
  const digits = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^[0-9]+$/, 16: /^[0-9a-fA-F]+$/ }[base];
  if (!digits.test(s)) return fail();
  if (base === 10 && s.length > 4300) {
    throw pyValueError(
      `Exceeds the limit (4300 digits) for integer string conversion: value has ${s.length} digits; use sys.set_int_max_str_digits() to increase the limit`,
    );
  }
  const value = BigInt(`${prefix}${s}`);
  return negative ? -value : value;
}

function pyFloat(text: string): number {
  const parsed = pyFloatParse(text);
  if (parsed === null) throw pyValueError(`could not convert string to float: ${pyStrRepr(text)}`);
  return parsed;
}

function constructInt(raw: string): number | bigint {
  let value = raw.replace(/_/g, "");
  let sign = 1n;
  if (value === "") throw pyIndexError();
  if (value[0] === "-") sign = -1n;
  if (value[0] === "-" || value[0] === "+") value = value.slice(1);
  let result: bigint;
  if (value === "0") return 0;
  if (value.startsWith("0b")) result = pyInt(value.slice(2), 2);
  else if (value.startsWith("0x")) result = pyInt(value.slice(2), 16);
  else if (value === "") throw pyIndexError();
  else if (value[0] === "0") result = pyInt(value, 8);
  else if (value.includes(":")) {
    const digits = value.split(":").map((part) => pyInt(part, 10));
    digits.reverse();
    let base = 1n;
    result = 0n;
    for (const digit of digits) {
      result += digit * base;
      base *= 60n;
    }
  } else result = pyInt(value, 10);
  return normaliseInt(sign * result);
}

function constructFloat(raw: string): PyFloat {
  let value = raw.replace(/_/g, "").toLowerCase();
  let sign = 1;
  if (value === "") throw pyIndexError();
  if (value[0] === "-") sign = -1;
  if (value[0] === "-" || value[0] === "+") value = value.slice(1);
  if (value === ".inf") return new PyFloat(sign * Infinity);
  if (value === ".nan") return new PyFloat(Number.NaN);
  if (value.includes(":")) {
    const digits = value.split(":").map((part) => pyFloat(part));
    digits.reverse();
    let base = 1;
    let result = 0;
    for (const digit of digits) {
      result += digit * base;
      base *= 60;
    }
    return new PyFloat(sign * result);
  }
  return new PyFloat(sign * pyFloat(value));
}

const TIMESTAMP_RE =
  /^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:(?:[Tt]|[ \t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\.([0-9]*))?(?:[ \t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?)?$/;

const pad = (value: number | string, width: number): string => String(value).padStart(width, "0");

function timedeltaRepr(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const seconds = totalSeconds - days * 86400;
  const parts: string[] = [];
  if (days) parts.push(`days=${days}`);
  if (seconds) parts.push(`seconds=${seconds}`);
  return `datetime.timedelta(${parts.join(", ") || "0"})`;
}

function constructTimestamp(raw: string): PyDate {
  const m = TIMESTAMP_RE.exec(raw.endsWith("\n") ? raw.slice(0, -1) : raw) ?? TIMESTAMP_RE.exec(raw);
  if (!m) throw new PyLoadError("AttributeError", "'NoneType' object has no attribute 'groupdict'");
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const checkDate = (): void => {
    if (year < 1) throw pyValueError(`year ${year} is out of range`);
    if (month < 1 || month > 12) throw pyValueError("month must be in 1..12");
    const lastDay = new Date(Date.UTC(2000 + (year % 400), month, 0)).getUTCDate();
    if (day < 1 || day > lastDay) throw pyValueError("day is out of range for month");
  };
  const date = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  if (!m[4]) {
    checkDate();
    return new PyDate(date);
  }
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  let micro = 0;
  if (m[7]) micro = Number(m[7].slice(0, 6).padEnd(6, "0"));
  let zone = "";
  if (m[9]) {
    let deltaSeconds = Number(m[10]) * 3600 + Number(m[11] ?? 0) * 60;
    if (m[9] === "-") deltaSeconds = -deltaSeconds;
    if (Math.abs(deltaSeconds) >= 86400) {
      throw pyValueError(
        `offset must be a timedelta strictly between -timedelta(hours=24) and timedelta(hours=24), not ${timedeltaRepr(deltaSeconds)}.`,
      );
    }
    const abs = Math.abs(deltaSeconds);
    zone = `${deltaSeconds < 0 ? "-" : "+"}${pad(Math.floor(abs / 3600), 2)}:${pad(Math.floor((abs % 3600) / 60), 2)}`;
  } else if (m[8]) {
    zone = "+00:00";
  }
  checkDate();
  if (hour > 23) throw pyValueError("hour must be in 0..23");
  if (minute > 59) throw pyValueError("minute must be in 0..59");
  if (second > 59) throw pyValueError("second must be in 0..59");
  let text = `${date} ${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}`;
  if (micro !== 0) text += `.${pad(micro, 6)}`;
  return new PyDate(text + zone);
}

/** Python dict key equality: `True == 1 == 1.0`, so such keys collapse onto the first one inserted. */
export function pyKeyIdentity(key: unknown): string {
  if (key === null) return "null";
  if (typeof key === "boolean") return `n:${key ? 1 : 0}`;
  if (typeof key === "number" || typeof key === "bigint") return `n:${String(key)}`;
  if (key instanceof PyFloat) return `n:${Number.isInteger(key.value) ? String(BigInt(key.value)) : String(key.value)}`;
  if (key instanceof PyDate) {
    const aware = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(?:\.(\d{6}))?([+-]\d\d:\d\d)$/.exec(key.text);
    if (aware) return `t:${Date.parse(`${aware[1]}T${aware[2]}${aware[4]}`)}:${aware[3] ?? "0"}`;
    return `d:${key.text}`;
  }
  if (key instanceof Uint8Array) return `b:${Buffer.from(key).toString("hex")}`;
  return `s:${String(key)}`;
}

const isHashable = (key: unknown): boolean => !(key instanceof Map || Array.isArray(key) || key instanceof Set);

const NODE_ID: Record<YNode["kind"], string> = { scalar: "scalar", sequence: "sequence", mapping: "mapping" };

class SafeConstructor {
  private constructed = new Map<YNode, unknown>();
  private recursive = new Set<YNode>();
  private stateGenerators: Array<Generator<unknown, void, unknown>> = [];

  constructDocument(node: YNode): unknown {
    const data = this.constructObject(node);
    while (this.stateGenerators.length > 0) {
      const generators = this.stateGenerators;
      this.stateGenerators = [];
      for (const generator of generators) {
        for (;;) {
          if (generator.next().done) break;
        }
      }
    }
    return data;
  }

  private constructObject(node: YNode): unknown {
    if (this.constructed.has(node)) return this.constructed.get(node);
    if (this.recursive.has(node)) {
      throw new ConstructorError(null, null, "found unconstructable recursive node", node.startMark);
    }
    this.recursive.add(node);
    let data: unknown;
    switch (node.tag) {
      case TAG_NULL:
        this.constructScalar(node);
        data = null;
        break;
      case TAG_BOOL:
        data = this.constructBool(node);
        break;
      case TAG_INT:
        data = constructInt(this.constructScalar(node));
        break;
      case TAG_FLOAT:
        data = constructFloat(this.constructScalar(node));
        break;
      case TAG_BINARY:
        data = this.constructBinary(node);
        break;
      case TAG_TIMESTAMP:
        this.constructScalar(node);
        data = constructTimestamp(node.value as string);
        break;
      case TAG_STR:
        data = this.constructScalar(node);
        break;
      case TAG_OMAP:
        data = this.startGenerator(this.constructOmapOrPairs(node, "an ordered map"));
        break;
      case TAG_PAIRS:
        data = this.startGenerator(this.constructOmapOrPairs(node, "pairs"));
        break;
      case TAG_SET:
        data = this.startGenerator(this.constructSet(node));
        break;
      case TAG_SEQ:
        data = this.startGenerator(this.constructSeq(node));
        break;
      case TAG_MAP:
        data = this.startGenerator(this.constructMap(node));
        break;
      default:
        throw new ConstructorError(
          null,
          null,
          `could not determine a constructor for the tag ${pyStrRepr(node.tag)}`,
          node.startMark,
        );
    }
    this.constructed.set(node, data);
    this.recursive.delete(node);
    return data;
  }

  private startGenerator(generator: Generator<unknown, void, unknown>): unknown {
    const first = generator.next();
    this.stateGenerators.push(generator);
    return first.value;
  }

  private constructScalar(node: YNode): string {
    if (node.kind === "mapping") {
      for (const [keyNode, valueNode] of node.value as Array<[YNode, YNode]>) {
        if (keyNode.tag === TAG_VALUE) return this.constructScalar(valueNode);
      }
    }
    if (node.kind !== "scalar") {
      throw new ConstructorError(
        null,
        null,
        `expected a scalar node, but found ${NODE_ID[node.kind]}`,
        node.startMark,
      );
    }
    return node.value as string;
  }

  private constructBool(node: YNode): boolean {
    const value = this.constructScalar(node).toLowerCase();
    switch (value) {
      case "yes":
      case "true":
      case "on":
        return true;
      case "no":
      case "false":
      case "off":
        return false;
      default:
        throw new PyLoadError("KeyError", pyStrRepr(value));
    }
  }

  private constructBinary(node: YNode): Uint8Array {
    const text = this.constructScalar(node);
    const chars = Array.from(text);
    const first = chars.findIndex((c) => (c.codePointAt(0) as number) > 0x7f);
    if (first >= 0) {
      let last = first;
      while (last + 1 < chars.length && (chars[last + 1]?.codePointAt(0) as number) > 0x7f) last += 1;
      const esc = (c: string): string => {
        const cp = c.codePointAt(0) as number;
        return cp < 0x100 ? `\\x${pad(cp.toString(16), 2)}` : cp < 0x10000 ? `\\u${pad(cp.toString(16), 4)}` : `\\U${pad(cp.toString(16), 8)}`;
      };
      const detail =
        last === first
          ? `can't encode character '${esc(chars[first] as string)}' in position ${first}`
          : `can't encode characters in position ${first}-${last}`;
      throw new ConstructorError(
        null,
        null,
        `failed to convert base64 data into ascii: 'ascii' codec ${detail}: ordinal not in range(128)`,
        node.startMark,
      );
    }
    try {
      return new Uint8Array(pyB64Decode(text));
    } catch (exc) {
      if (exc instanceof BinasciiError) {
        throw new ConstructorError(null, null, `failed to decode base64 data: ${exc.message}`, node.startMark);
      }
      throw exc;
    }
  }

  private *constructSeq(node: YNode): Generator<unknown, void, unknown> {
    const data: unknown[] = [];
    yield data;
    data.push(...this.constructSequence(node));
  }

  private *constructMap(node: YNode): Generator<unknown, void, unknown> {
    const data = new Map<unknown, unknown>();
    yield data;
    for (const [k, v] of this.constructMapping(node)) data.set(k, v);
  }

  private *constructSet(node: YNode): Generator<unknown, void, unknown> {
    const data = new Set<unknown>();
    yield data;
    for (const k of this.constructMapping(node).keys()) data.add(k);
  }

  private *constructOmapOrPairs(node: YNode, what: string): Generator<unknown, void, unknown> {
    const out: unknown[] = [];
    yield out;
    const context = `while constructing ${what}`;
    if (node.kind !== "sequence") {
      throw new ConstructorError(context, node.startMark, `expected a sequence, but found ${NODE_ID[node.kind]}`, node.startMark);
    }
    for (const sub of node.value as YNode[]) {
      if (sub.kind !== "mapping") {
        throw new ConstructorError(
          context,
          node.startMark,
          `expected a mapping of length 1, but found ${NODE_ID[sub.kind]}`,
          sub.startMark,
        );
      }
      const items = sub.value as Array<[YNode, YNode]>;
      if (items.length !== 1) {
        throw new ConstructorError(
          context,
          node.startMark,
          `expected a single mapping item, but found ${items.length} items`,
          sub.startMark,
        );
      }
      const [keyNode, valueNode] = items[0] as [YNode, YNode];
      const key = this.constructObject(keyNode);
      const value = this.constructObject(valueNode);
      out.push(PyTuple.of<unknown>(key, value));
    }
  }

  private constructSequence(node: YNode): unknown[] {
    if (node.kind !== "sequence") {
      throw new ConstructorError(
        null,
        null,
        `expected a sequence node, but found ${NODE_ID[node.kind]}`,
        node.startMark,
      );
    }
    return (node.value as YNode[]).map((child) => this.constructObject(child));
  }

  private flattenMapping(node: YNode): void {
    const merge: Array<[YNode, YNode]> = [];
    const pairs = node.value as Array<[YNode, YNode]>;
    let index = 0;
    while (index < pairs.length) {
      const [keyNode, valueNode] = pairs[index] as [YNode, YNode];
      if (keyNode.tag === TAG_MERGE) {
        pairs.splice(index, 1);
        if (valueNode.kind === "mapping") {
          this.flattenMapping(valueNode);
          merge.push(...(valueNode.value as Array<[YNode, YNode]>));
        } else if (valueNode.kind === "sequence") {
          const submerge: Array<Array<[YNode, YNode]>> = [];
          for (const sub of valueNode.value as YNode[]) {
            if (sub.kind !== "mapping") {
              throw new ConstructorError(
                "while constructing a mapping",
                node.startMark,
                `expected a mapping for merging, but found ${NODE_ID[sub.kind]}`,
                sub.startMark,
              );
            }
            this.flattenMapping(sub);
            submerge.push(sub.value as Array<[YNode, YNode]>);
          }
          submerge.reverse();
          for (const value of submerge) merge.push(...value);
        } else {
          throw new ConstructorError(
            "while constructing a mapping",
            node.startMark,
            `expected a mapping or list of mappings for merging, but found ${NODE_ID[valueNode.kind]}`,
            valueNode.startMark,
          );
        }
      } else if (keyNode.tag === TAG_VALUE) {
        keyNode.tag = TAG_STR;
        index += 1;
      } else {
        index += 1;
      }
    }
    if (merge.length > 0) node.value = [...merge, ...pairs];
  }

  private constructMapping(node: YNode): Map<unknown, unknown> {
    if (node.kind === "mapping") this.flattenMapping(node);
    if (node.kind !== "mapping") {
      throw new ConstructorError(
        null,
        null,
        `expected a mapping node, but found ${NODE_ID[node.kind]}`,
        node.startMark,
      );
    }
    const mapping = new Map<unknown, unknown>();
    const canonical = new Map<string, unknown>();
    for (const [keyNode, valueNode] of node.value as Array<[YNode, YNode]>) {
      const key = this.constructObject(keyNode);
      if (!isHashable(key)) {
        throw new ConstructorError("while constructing a mapping", node.startMark, "found unhashable key", keyNode.startMark);
      }
      const value = this.constructObject(valueNode);
      const id = pyKeyIdentity(key);
      const existing = canonical.has(id) ? canonical.get(id) : key;
      canonical.set(id, existing);
      mapping.set(existing, value);
    }
    return mapping;
  }
}

/**
 * `yaml.safe_load(text)` returning the rich tree. A `streamName` selects the behaviour of `yaml.safe_load(open(path))`:
 * the error marks name the file and carry no snippet, and non-printable characters are only noticed once the 4096
 * character chunk holding them is read.
 */
export function loadRich(text: string, streamName: string | null = null): Rich {
  const composer = new PyYamlComposer(text, streamName);
  const node = composer.getSingleNode();
  if (node === null) return null;
  return new SafeConstructor().constructDocument(node) as Rich;
}

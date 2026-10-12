/**
 * Interactive REPL helpers for `ebx connect` (port of `cli/repl.py`).
 *
 * `ebx connect` is deliberately a *line-based* command REPL -- not a PTY and not an SSH session: every entered line is
 * executed as its own process and no shell state survives between lines. This module owns the behaviours that are
 * specific to that loop:
 *
 *  - {@link enableLineEditing}: activates Node's `readline` line editor for {@link input} when the session is
 *    interactive, so Up/Down history and the usual editing keys work (Python used the stdlib `readline` module).
 *  - {@link input}: the equivalent of the builtin `input(prompt)`: prompt on stdout, one line from `sys.stdin`,
 *    `EOFError` at end of input, `KeyboardInterrupt` on Ctrl+C. `replSeams.input` is the patch point (Python tests
 *    patch `builtins.input`).
 *  - {@link describeCommandFailure}: maps whatever `commands.run()` threw to a *single* friendly
 *    `(message, suggestion)` pair. Transport text is sanitised (never the full sandbox URL or an MDN status link) and
 *    `EnvdRpcError.envd_error` is mined for the executable envd could not start, so a command-not-found is reported
 *    with the real command name.
 *
 * Spelling hints are only produced from commands that already ran in this session -- a guess about what a remote image
 * happens to install would not be reliable, so no such guess is made.
 */

import { PassThrough } from "node:stream";
import * as nodeReadline from "node:readline";

import { shlexSplit } from "../api/_shlex.js";
import { EOFError, KeyboardInterrupt, sys } from "../framework/index.js";
import { cpSlice, len, rstrip, sortedStrings, splitWhitespace } from "../framework/py.js";
import { getCloseMatches } from "../framework/difflib.js";
import { CommandTimeoutError, EnvdRpcError, SandboxError } from "../models/errors.js";
import { AsyncioTimeoutError } from "../transport/ws.js";
import { pyStr, pyStripChars } from "../utils/_pyformat.js";
import * as httpx from "../transport/_httpx.js";

/** Wall-clock limit applied to every REPL line; `ebx exec --timeout` accepts larger values for long-running commands. */
export const REPL_TIMEOUT = 30;

/** Short form used inside suggestions (the real sandbox id would be noise). */
const _EXEC_HINT = "ebx exec <SANDBOX_ID>";

const _STATUS_HINT = "Check the sandbox status with 'ebx info <SANDBOX_ID>' and retry.";

const _MAX_MESSAGE_LEN = 240;

/** Shell builtins have no standalone executable, so envd reports them as "not found" even though the shell supports them. */
const _SHELL_BUILTINS: ReadonlySet<string> = new Set([
  "alias",
  "bg",
  "cd",
  "dirs",
  "disown",
  "eval",
  "exec",
  "export",
  "fc",
  "fg",
  "hash",
  "history",
  "jobs",
  "local",
  "popd",
  "pushd",
  "read",
  "set",
  "shopt",
  "source",
  "trap",
  "typeset",
  "ulimit",
  "umask",
  "unalias",
  "unset",
  "wait",
]);

// ---------------------------------------------------------------------------------------------------------------------
// Line editing
// ---------------------------------------------------------------------------------------------------------------------

/** Patch points (the TypeScript counterparts of Python's `builtins.input` and the `readline` module state). */
export const replSeams: {
  /** `builtins.input`: the REPL reads every line through this. */
  input: (prompt: string) => Promise<string>;
} = {
  input: (prompt) => _defaultInput(prompt),
};

let _lineEditing = false;
/** Most-recent-first history shared by every {@link input} call of the process (readline's in-memory history). */
const _history: string[] = [];
const HISTORY_SIZE = 1000;

/** Forget the recorded line-editing state and history (test hook). */
export function _resetLineEditing(): void {
  _lineEditing = false;
  _pending = "";
  _stdinEnded = false;
  _history.length = 0;
}

/** The lines typed so far, oldest first (what `readline.get_history_item` would enumerate). */
export function lineHistory(): string[] {
  return [..._history].reverse();
}

/**
 * Enable readline-backed line editing for {@link input} when possible.
 *
 * Returns `true` when line editing was enabled for an interactive stdin. Non-interactive sessions (pipes, CI, test
 * runners) keep the plain line reader.
 */
export function enableLineEditing(): boolean {
  const stdin = (sys as { stdin?: { isatty?: () => boolean } | null }).stdin ?? null;
  const isatty = stdin === null ? undefined : stdin.isatty;
  if (typeof isatty !== "function" || !isatty.call(stdin)) return false;
  _lineEditing = true;
  return true;
}

/**
 * SIGINT policy of `input` for the `connect` REPL. The Python command runs inside `asyncio.run`, whose SIGINT handler
 * only cancels the main task on the first Ctrl+C: a blocking `input()` keeps waiting (the cancellation lands at the next
 * `await`), and only the second Ctrl+C raises `KeyboardInterrupt` inside `input()`. With `swallowFirst` set, `input`
 * reproduces that and counts the interrupts in `count`.
 */
export const inputInterrupts: { swallowFirst: boolean; count: number } = { swallowFirst: false, count: 0 };

/**
 * `input(prompt)`: print *prompt* (no newline) on stdout, read one line from stdin without its terminator.
 *
 * Rejects with `EOFError("EOF when reading a line")` at end of input and with `KeyboardInterrupt` on Ctrl+C.
 */
export function input(prompt = ""): Promise<string> {
  return replSeams.input(prompt);
}

async function _defaultInput(prompt: string): Promise<string> {
  const stdin = sys.stdin;
  const interactive = _lineEditing && stdin.isatty() && process.stdin.isTTY === true && stdin.fileno?.() === 0;
  if (interactive) return _editedInput(prompt);
  sys.stdout.write(prompt);
  sys.stdout.flush();
  const line = await _untilSecondInterrupt(stdin.readLine());
  if (line === null) throw new EOFError("EOF when reading a line");
  return line;
}

/** With {@link inputInterrupts}`.swallowFirst`: the first SIGINT is only counted, the second rejects the read. */
function _untilSecondInterrupt<T>(work: Promise<T>): Promise<T> {
  if (!inputInterrupts.swallowFirst) return work;
  const parked = process.listeners("SIGINT");
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const restore = (): void => {
      if (settled) return;
      settled = true;
      process.off("SIGINT", onSigint);
      for (const listener of parked) process.on("SIGINT", listener as NodeJS.SignalsListener);
    };
    const onSigint = (): void => {
      inputInterrupts.count += 1;
      if (inputInterrupts.count < 2) return;
      restore();
      reject(new KeyboardInterrupt());
    };
    for (const listener of parked) process.off("SIGINT", listener as NodeJS.SignalsListener);
    process.on("SIGINT", onSigint);
    work.then(
      (value) => {
        restore();
        resolve(value);
      },
      (error) => {
        restore();
        reject(error);
      },
    );
  });
}

/** Terminal input that was read from stdin but not consumed by a prompt yet (type-ahead / pasted lines). */
let _pending = "";
let _stdinEnded = false;

/**
 * Cut the next piece off the pending input: everything up to and including the first character that can finish a
 * prompt (Enter, Ctrl+J, Ctrl+C, Ctrl+D). GNU readline reads one byte at a time, so whatever follows such a character
 * stays in the terminal queue for the *next* `input()`; handing readline only this piece reproduces that.
 */
function _takeSegment(): string | null {
  if (_pending === "") return null;
  const m = /[\r\n\x03\x04]/.exec(_pending);
  const end = m ? m.index + 1 : _pending.length;
  const seg = _pending.slice(0, end);
  _pending = _pending.slice(end);
  return seg;
}

const _nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function _setRawMode(on: boolean): void {
  const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => unknown };
  if (typeof stdin.setRawMode !== "function") return;
  try {
    stdin.setRawMode(on);
  } catch {
    /* not a terminal any more */
  }
}

interface EditableInterface {
  line: string;
  cursor: number;
  _ttyWrite: (s: string, key?: { name?: string; ctrl?: boolean; meta?: boolean }) => void;
  _refreshLine: () => void;
}

/** The text most recently killed by Ctrl+K / Ctrl+U / Ctrl+W / Alt+D / Alt+Backspace (readline's kill ring head). */
let _killed = "";

const _isWordChar = (ch: string): boolean => /[\p{L}\p{N}]/u.test(ch);

/**
 * GNU readline semantics Node's `readline` lacks or implements differently: a kill ring with Ctrl+Y (yank), the
 * whitespace-delimited Ctrl+W (`unix-word-rubout`), a bell for Ctrl+D at the end of a non-empty line.
 * The oracle's readline does not merge consecutive kills: every kill replaces the yank buffer.
 */
function _installKillRing(rl: nodeReadline.Interface): void {
  const ed = rl as unknown as EditableInterface;
  const original = Object.getPrototypeOf(rl)._ttyWrite as EditableInterface["_ttyWrite"];
  const kill = (from: number, to: number): void => {
    _killed = ed.line.slice(from, to);
    ed.line = ed.line.slice(0, from) + ed.line.slice(to);
    ed.cursor = from;
    ed._refreshLine();
  };
  ed._ttyWrite = function ttyWrite(s, key) {
    const k = key ?? {};
    const { line, cursor } = ed;
    if (k.ctrl && !k.meta) {
      switch (k.name) {
        case "k":
          kill(cursor, line.length);
          return;
        case "u":
          kill(0, cursor);
          return;
        case "w": {
          let i = cursor;
          while (i > 0 && /\s/.test(line[i - 1] as string)) i -= 1;
          while (i > 0 && !/\s/.test(line[i - 1] as string)) i -= 1;
          kill(i, cursor);
          return;
        }
        case "y":
          ed.line = line.slice(0, cursor) + _killed + line.slice(cursor);
          ed.cursor = cursor + _killed.length;
          ed._refreshLine();
          return;
        case "d":
          if (line.length > 0 && cursor === line.length) {
            process.stdout.write("\x07");
            return;
          }
          break;
        default:
          break;
      }
    } else if (k.meta && (k.name === "d" || k.name === "backspace")) {
      let i = cursor;
      if (k.name === "d") {
        while (i < line.length && !_isWordChar(line[i] as string)) i += 1;
        while (i < line.length && _isWordChar(line[i] as string)) i += 1;
        kill(cursor, i);
      } else {
        while (i > 0 && !_isWordChar(line[i - 1] as string)) i -= 1;
        while (i > 0 && _isWordChar(line[i - 1] as string)) i -= 1;
        kill(i, cursor);
      }
      return;
    }
    original.call(ed, s, key);
  };
}

function _editedInput(prompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    const source = new PassThrough();
    const rl = nodeReadline.createInterface({
      input: source,
      output: process.stdout,
      terminal: true,
      history: [..._history],
      historySize: HISTORY_SIZE,
      prompt,
    });
    // Node swaps in a keystroke-less "dumb terminal" handler for TERM=dumb; Python's readline still edits the line.
    delete (rl as unknown as { _ttyWrite?: unknown })._ttyWrite;
    _installKillRing(rl);
    let settled = false;
    let streamEnded = false;
    let pumping = false;
    const onData = (chunk: string | Buffer): void => {
      _pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      void pump();
    };
    const onEnd = (): void => {
      _stdinEnded = true;
      streamEnded = true;
      if (!settled) rl.close();
    };
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      stdin.off("error", onEnd);
      _setRawMode(false);
      stdin.pause();
      rl.close();
      source.destroy();
      fn();
    };
    const pump = async (): Promise<void> => {
      if (pumping) return;
      pumping = true;
      try {
        while (!settled) {
          const seg = _takeSegment();
          if (seg === null) break;
          source.write(seg);
          await _nextTurn();
        }
      } finally {
        pumping = false;
      }
    };
    rl.on("SIGINT", () => {
      if (inputInterrupts.swallowFirst) {
        inputInterrupts.count += 1;
        if (inputInterrupts.count < 2) return;
        // Python's readline leaves the terminal driver's `^C` echo in place (no newline of its own).
        process.stdout.write("^C");
        finish(() => reject(new KeyboardInterrupt()));
        return;
      }
      process.stdout.write("\n");
      finish(() => reject(new KeyboardInterrupt()));
    });
    rl.on("close", () => {
      // The terminal driver echoes Ctrl+D as `^D` when Python reads in canonical mode; raw-mode readline does not.
      if (!settled && !streamEnded) process.stdout.write("^D");
      finish(() => reject(new EOFError("EOF when reading a line")));
    });
    rl.question(prompt, (answer) => {
      // After a swallowed Ctrl+C Python's readline redraws the submitted line once more.
      if (inputInterrupts.swallowFirst && inputInterrupts.count > 0) process.stdout.write(`${answer}\n`);
      if (answer !== "") _history.unshift(answer);
      if (_history.length > HISTORY_SIZE) _history.length = HISTORY_SIZE;
      finish(() => resolve(answer));
    });
    if (_stdinEnded && _pending === "") {
      onEnd();
      return;
    }
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.on("error", onEnd);
    _setRawMode(true);
    stdin.resume();
    void pump();
  });
}

/** Return the first token of *command* (the program that would run). */
export function programName(command: string): string {
  let parts: string[];
  try {
    parts = shlexSplit(command);
  } catch {
    parts = splitWhitespace(command);
  }
  return parts.length ? (parts[0] as string) : "";
}

// ---------------------------------------------------------------------------------------------------------------------
// Sanitising
// ---------------------------------------------------------------------------------------------------------------------

/**
 * httpx appends "For more information check: https://developer.mozilla.org/..." to status errors; drop the whole
 * clause, URL included. Requiring the URL keeps legitimate prose like "check the logs" intact.
 */
const _MDN_CLAUSE_RE = /\s*For more information check:?\s*https?:\/\/\S*/gi;
/** Also swallows the surrounding quotes so a scrubbed URL leaves no stray `'`. */
const _URL_RE = /['"]?https?:\/\/[^\s'"]+['"]?/g;

/** Remove sandbox URLs / MDN links from *text* and collapse whitespace. */
export function sanitizeText(text: string | null | undefined): string {
  let cleaned = (text || "").replace(_MDN_CLAUSE_RE, "").replace(_URL_RE, "");
  cleaned = cleaned.split("''").join("").split('""').join("");
  return splitWhitespace(cleaned).join(" ");
}

/** Truncate long remote details so one failure stays one short line. */
function _clip(text: string, limit = _MAX_MESSAGE_LEN): string {
  if (len(text) <= limit) return text;
  return rstrip(cpSlice(text, 0, limit)) + "...";
}

// ---------------------------------------------------------------------------------------------------------------------
// envd error mining
// ---------------------------------------------------------------------------------------------------------------------

const _NOT_FOUND_MARKERS: readonly string[] = ["not found", "no such file", "cannot find", "not installed"];

const _MISSING_NAME_PATTERNS: readonly RegExp[] = [
  /exec:\s*["']?([^"'\s:]+)["']?/,
  /([^\s:]+):\s*(?:command\s+)?not found/i,
  /([^\s:]+):\s*executable file not found/i,
  /not found:\s*([^\s:]+)/i,
];

const _NOT_NAMES: ReadonlySet<string> = new Set(["exec", "found", "in", "not", "the", "$path"]);

const _isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v !== "";
const _isDict = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Best-effort human detail from the structured envd error body.
 *
 * Mirrors the shapes the transport accepts: nested `{"error": {...}}`, flat `{"message": ...}` and plain string errors.
 */
function _envdDetail(exc: EnvdRpcError): string {
  const err = exc.envd_error;
  if (_isDict(err)) {
    const inner = err["error"];
    if (_isDict(inner)) {
      for (const key of ["message", "msg", "detail"]) {
        const value = inner[key];
        if (_isNonEmptyString(value)) return value;
      }
    } else if (_isNonEmptyString(inner)) {
      return inner;
    }
    for (const key of ["message", "msg", "detail"]) {
      const value = err[key];
      if (_isNonEmptyString(value)) return value;
    }
  }
  return exc.body_text || "";
}

/**
 * Name of the executable envd could not start, or `""`.
 *
 * Prefers the structured error body (`EnvdRpcError.envd_error`); falls back to the executable the user actually typed
 * when envd reports a not-found without naming it (e.g. `"exec not found"`).
 */
function _missingCommand(exc: EnvdRpcError, typed: string): string {
  const detail = _envdDetail(exc) || exc.message;
  const lowered = detail.toLowerCase();
  if (!_NOT_FOUND_MARKERS.some((marker) => lowered.includes(marker))) return "";
  for (const pattern of _MISSING_NAME_PATTERNS) {
    const match = pattern.exec(detail);
    if (match) {
      const name = pyStripChars(match[1] as string, "\"'` ");
      if (name && !_NOT_NAMES.has(name.toLowerCase())) return name;
    }
  }
  return programName(typed);
}

// ---------------------------------------------------------------------------------------------------------------------
// Spelling hints (session-verified commands only)
// ---------------------------------------------------------------------------------------------------------------------

/** `true` for a single substitution, insertion, deletion or adjacent transposition between *candidate* and *name*. */
function _oneEditAway(candidateIn: string, nameIn: string): boolean {
  const candidate = Array.from(candidateIn);
  const name = Array.from(nameIn);
  if (candidateIn === nameIn || Math.abs(candidate.length - name.length) > 1) return false;
  if (candidate.length === name.length) {
    const diff: number[] = [];
    for (let i = 0; i < name.length; i++) if (name[i] !== candidate[i]) diff.push(i);
    if (diff.length === 1) return true;
    return (
      diff.length === 2 &&
      (diff[1] as number) === (diff[0] as number) + 1 &&
      name[diff[0] as number] === candidate[diff[1] as number] &&
      name[diff[1] as number] === candidate[diff[0] as number]
    );
  }
  const [shorter, longer] = name.length < candidate.length ? [name, candidate] : [candidate, name];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

/** Closest session-verified command name, or `""` when not confident. */
function _spellSuggestion(name: string, known: Iterable<string>): string {
  const candidates = sortedStrings(new Set([...known].filter((c) => c && c !== name)));
  if (!name || candidates.length === 0) return "";
  const matches = getCloseMatches(name, candidates, 1, 0.7);
  if (matches.length) return matches[0] as string;
  const near = candidates.filter((c) => _oneEditAway(name, c));
  if (near.length) {
    let best = near[0] as string;
    for (const c of near.slice(1)) {
      const a = Math.abs(len(c) - len(name));
      const b = Math.abs(len(best) - len(name));
      if (a < b || (a === b && len(c) < len(best))) best = c;
    }
    return best;
  }
  return "";
}

// ---------------------------------------------------------------------------------------------------------------------
// Failure description
// ---------------------------------------------------------------------------------------------------------------------

/** A single friendly failure notice for one REPL command. */
export class CommandFailure {
  readonly message: string;
  readonly suggestion: string;
  readonly code: string;

  constructor(init: { message: string; suggestion?: string; code?: string }) {
    this.message = init.message;
    this.suggestion = init.suggestion ?? "";
    this.code = init.code ?? "";
    Object.freeze(this);
  }
}

function _timeoutFailure(timeout: number): CommandFailure {
  return new CommandFailure({
    message: `Command timed out after ${timeout}s.`,
    suggestion:
      `Each REPL line has a ${timeout}s limit - use ` + `'${_EXEC_HINT} "<cmd>" --timeout N' for long-running commands.`,
    code: "E3001",
  });
}

function _missingSuggestion(name: string, known: Iterable<string>): string {
  if (name === "cd") {
    return (
      "'cd' is a shell builtin and needs a shell: use 'cd /path && <cmd>' on one line, " +
      `or '${_EXEC_HINT} "<cmd>" --cwd /path'.`
    );
  }
  if (_SHELL_BUILTINS.has(name)) {
    return (
      `'${name}' is a shell builtin with no standalone executable; shell state ` +
      "(working directory, environment variables, aliases) does not persist between lines."
    );
  }
  const spell = _spellSuggestion(name, known);
  if (spell) return `Did you mean '${spell}'? It ran earlier in this session.`;
  return `Check that '${name}' exists in the sandbox image - each line runs in its own process.`;
}

function _envdFailure(exc: EnvdRpcError, command: string, knownCommands: Iterable<string>): CommandFailure {
  const missing = _missingCommand(exc, command);
  if (missing) {
    return new CommandFailure({
      message: `Command not found: ${missing}`,
      suggestion: _missingSuggestion(missing, knownCommands),
      code: exc.code,
    });
  }
  const detail = _clip(sanitizeText(_envdDetail(exc)));
  const status = exc.status_code ? ` (HTTP ${exc.status_code})` : "";
  let message = `Sandbox envd rejected the command${status}`;
  if (detail) message = `${message}: ${detail}`;
  return new CommandFailure({ message, suggestion: sanitizeText(exc.suggestion), code: exc.code });
}

const _typeName = (exc: unknown): string => (exc instanceof Error ? exc.constructor.name : typeof exc);

/**
 * Map a REPL command failure to one friendly `(message, suggestion)`.
 *
 * `knownCommands` are executables observed to run in this session; they are the *only* source used for "did you mean"
 * hints, so a suggestion is never based on a guess about the sandbox image.
 */
export function describeCommandFailure(
  exc: unknown,
  opts: { command: string; timeout?: number; known_commands?: Iterable<string> },
): CommandFailure {
  const { command, timeout = REPL_TIMEOUT, known_commands: knownCommands = [] } = opts;
  if (exc instanceof EnvdRpcError) return _envdFailure(exc, command, knownCommands);
  if (exc instanceof CommandTimeoutError || exc instanceof httpx.TimeoutException || exc instanceof AsyncioTimeoutError) {
    return _timeoutFailure(timeout);
  }
  if (exc instanceof httpx.HTTPStatusError) {
    return new CommandFailure({
      message: `Remote request failed (HTTP ${exc.response.status_code}).`,
      suggestion: _STATUS_HINT,
      code: "E5000",
    });
  }
  if (exc instanceof httpx.ProtocolError) {
    const detail = _clip(sanitizeText(pyStr(exc)));
    let message = "Connection to the sandbox was interrupted";
    if (detail) message = `${message}: ${detail}`;
    return new CommandFailure({
      message,
      suggestion:
        "The sandbox may have stopped or hit its lifetime limit - " + "check 'ebx info <SANDBOX_ID>' and retry.",
      code: "E5003",
    });
  }
  if (exc instanceof httpx.ConnectError || exc instanceof httpx.NetworkError) {
    const detail = _clip(sanitizeText(pyStr(exc)));
    let message = "Cannot reach the sandbox envd";
    if (detail) message = `${message}: ${detail}`;
    return new CommandFailure({ message, suggestion: _STATUS_HINT, code: "E5001" });
  }
  if (exc instanceof httpx.HTTPError) {
    const detail = _clip(sanitizeText(pyStr(exc))) || _typeName(exc);
    return new CommandFailure({ message: `Sandbox request failed: ${detail}`, suggestion: _STATUS_HINT });
  }
  if (exc instanceof SandboxError) {
    return new CommandFailure({
      message: _clip(sanitizeText(exc.message)) || _typeName(exc),
      suggestion: sanitizeText(exc.suggestion),
      code: exc.code,
    });
  }
  const detail = _clip(sanitizeText(pyStr(exc))) || _typeName(exc);
  return new CommandFailure({
    message: `Unexpected error while running this line: ${detail}`,
    suggestion: "Run 'ebx -v connect <SANDBOX_ID>' for DEBUG diagnostics.",
  });
}

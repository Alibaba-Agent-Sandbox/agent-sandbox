/**
 * Structured logging for Easy Sandbox (port of `easy_sandbox/utils/logging.py`).
 *
 * Because the CLI's `OutputManager` bridges *stdlib* `logging`, this file contains BOTH
 *
 *  1. a small, documented re-implementation of the parts of Python's stdlib `logging` the code base relies on
 *     (exported as the {@link logging} namespace object *and* as individual named exports), and
 *  2. the SDK helper `getLogger(name)` (Python `get_logger`) that prefixes names with `easy_sandbox.` and applies the
 *     one-time `SANDBOX_LOG_LEVEL` / handler configuration.
 *
 * ## API cheat-sheet
 *
 * ```ts
 * import { getLogger, logging, ExcInfo } from "../utils/logging.js";
 *
 * const logger = getLogger("transport.http");          // SDK logger  -> "easy_sandbox.transport.http"
 * logger.debug("Sending request to %s", url);          // %-style lazy formatting (%s %r %d %f %(key)s ...)
 * logger.warning("failed: %s", path, new ExcInfo(err)); // `exc_info=True` equivalent: trailing ExcInfo argument
 *
 * const std = logging.getLogger("easy_sandbox.cli.output"); // stdlib `logging.getLogger(name)`; no name => root
 * logging.getLogger().addHandler(handler);              // root handler bridge hook
 * logging.getLogger().setLevel(logging.DEBUG);
 * class Bridge extends logging.Handler { emit(record) { const msg = this.format(record); ... } }
 * ```
 *
 * ### Python parity notes
 *  - Levels: `NOTSET=0 DEBUG=10 INFO=20 WARNING=30 ERROR=40 CRITICAL=50` (also `WARN`, `FATAL`).
 *    `levelFromName(name, default)` is `getattr(logging, name.upper(), default)`.
 *  - Named hierarchical loggers (`a.b.c` -> parent `a.b` -> ... -> root), `propagate`, per-logger and per-handler
 *    levels, `Logger.handlers`, `addHandler/removeHandler/hasHandlers`, `getEffectiveLevel`, `isEnabledFor`.
 *  - Last-resort handler (stderr, WARNING+, message only) when a record finds no handler anywhere (as CPython does).
 *  - `Formatter` supports `%(asctime)s %(name)s %(levelname)s %(message)s %(levelno)d %(created)f %(msecs)d ...`.
 *  - A handler's `emit` exception is routed to `handleError` (prints a traceback-ish line to stderr, like CPython).
 *  - The module flag `_CONFIGURED` is exposed through `_isConfigured()` / `_setConfigured(v)` (ESM bindings are
 *    read-only; tests use `_setConfigured(false)` like the Python tests assign `log_module._CONFIGURED = False`).
 *  - `get_logger` is exported as `getLogger`; stdlib's is `logging.getLogger` (and `stdGetLogger`).
 */

import { pyFormat } from "./_pyformat.js";

export const NOTSET = 0;
export const DEBUG = 10;
export const INFO = 20;
export const WARNING = 30;
export const WARN = WARNING;
export const ERROR = 40;
export const CRITICAL = 50;
export const FATAL = CRITICAL;

const LEVEL_TO_NAME = new Map<number, string>([
  [CRITICAL, "CRITICAL"],
  [ERROR, "ERROR"],
  [WARNING, "WARNING"],
  [INFO, "INFO"],
  [DEBUG, "DEBUG"],
  [NOTSET, "NOTSET"],
]);
const NAME_TO_LEVEL: Record<string, number> = {
  CRITICAL,
  FATAL,
  ERROR,
  WARN,
  WARNING,
  INFO,
  DEBUG,
  NOTSET,
};

export type Level = number | string;

/** `logging.getLevelName(level)`: number -> name; known name -> number. */
export function getLevelName(level: Level): string | number {
  if (typeof level === "number") return LEVEL_TO_NAME.get(level) ?? `Level ${level}`;
  return NAME_TO_LEVEL[level] ?? `Level ${level}`;
}

/** `getattr(logging, name.upper(), default)` for the level constants. */
export function levelFromName(name: string, dflt: number): number {
  const v = NAME_TO_LEVEL[name];
  return v === undefined ? dflt : v;
}

function checkLevel(level: Level): number {
  if (typeof level === "number") return level;
  const v = NAME_TO_LEVEL[level];
  if (v === undefined) throw new Error(`ValueError: Unknown level: ${JSON.stringify(level)}`);
  return v;
}

/** Marker argument: pass as the LAST logging argument for Python's `exc_info=True` (optionally with the error). */
export class ExcInfo {
  constructor(public readonly error?: unknown) {}
}

export class LogRecord {
  name: string;
  msg: unknown;
  args: unknown[];
  levelno: number;
  levelname: string;
  created: number;
  msecs: number;
  exc_info: ExcInfo | null;
  exc_text: string | null = null;
  message = "";
  asctime = "";

  constructor(name: string, level: number, msg: unknown, args: unknown[], excInfo: ExcInfo | null = null) {
    this.name = name;
    this.msg = msg;
    // `logging` treats a single non-empty mapping argument as the mapping itself.
    this.args = args;
    this.levelno = level;
    this.levelname = String(getLevelName(level));
    const now = Date.now();
    this.created = now / 1000;
    this.msecs = now % 1000;
    this.exc_info = excInfo;
  }

  /** `LogRecord.getMessage()`: `str(msg) % args` (only when args are present). */
  getMessage(): string {
    let msg = typeof this.msg === "string" ? this.msg : String(this.msg);
    if (this.args.length) {
      const only = this.args.length === 1 ? this.args[0] : undefined;
      if (
        only !== null &&
        typeof only === "object" &&
        !Array.isArray(only) &&
        Object.getPrototypeOf(only) === Object.prototype &&
        Object.keys(only as object).length
      ) {
        msg = pyFormat(msg, only as Record<string, unknown>);
      } else {
        msg = pyFormat(msg, this.args);
      }
    }
    return msg;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `time.strftime("%Y-%m-%d %H:%M:%S", localtime)` + `,mmm` as CPython's default `asctime`. */
function formatAsctime(record: LogRecord): string {
  const d = new Date(record.created * 1000);
  const base = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return `${base},${String(Math.floor(record.msecs)).padStart(3, "0")}`;
}

export class Formatter {
  readonly _fmt: string;

  constructor(fmt: string | null = null) {
    this._fmt = fmt ?? "%(message)s";
  }

  usesTime(): boolean {
    return this._fmt.includes("%(asctime)");
  }

  formatTime(record: LogRecord): string {
    return formatAsctime(record);
  }

  formatException(exc: ExcInfo): string {
    const err = exc.error;
    if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
    if (err !== undefined) return String(err);
    return "NoneType: None";
  }

  format(record: LogRecord): string {
    record.message = record.getMessage();
    if (this.usesTime()) record.asctime = this.formatTime(record);
    let s = pyFormat(this._fmt, {
      name: record.name,
      levelno: record.levelno,
      levelname: record.levelname,
      message: record.message,
      asctime: record.asctime,
      created: record.created,
      msecs: record.msecs,
    });
    if (record.exc_info && !record.exc_text) record.exc_text = this.formatException(record.exc_info);
    if (record.exc_text) {
      if (s.slice(-1) !== "\n") s += "\n";
      s += record.exc_text;
    }
    return s;
  }
}

const defaultFormatter = new Formatter();

export interface Writable {
  write(chunk: string): unknown;
  flush?(): unknown;
}

export class Handler {
  level: number;
  formatter: Formatter | null = null;

  constructor(level: Level = NOTSET) {
    this.level = checkLevel(level);
  }

  setLevel(level: Level): void {
    this.level = checkLevel(level);
  }

  setFormatter(fmt: Formatter | null): void {
    this.formatter = fmt;
  }

  format(record: LogRecord): string {
    return (this.formatter ?? defaultFormatter).format(record);
  }

  /** Subclasses override. */
  emit(_record: LogRecord): void {
    throw new Error("NotImplementedError: emit must be implemented by Handler subclasses");
  }

  handle(record: LogRecord): boolean {
    emitGuard(this, record);
    return true;
  }

  handleError(record: LogRecord): void {
    try {
      process.stderr.write(`--- Logging error ---\nCall stack: ${new Error().stack ?? ""}\nMessage: ${String(record.msg)}\n`);
    } catch {
      /* ignore */
    }
  }

  flush(): void {}

  close(): void {}
}

function emitGuard(handler: Handler, record: LogRecord): void {
  try {
    handler.emit(record);
  } catch {
    handler.handleError(record);
  }
}

export class StreamHandler extends Handler {
  stream: Writable;
  terminator = "\n";

  constructor(stream?: Writable) {
    super();
    this.stream = stream ?? (process.stderr as unknown as Writable);
  }

  override emit(record: LogRecord): void {
    const msg = this.format(record);
    this.stream.write(msg + this.terminator);
  }

  override flush(): void {
    this.stream.flush?.();
  }
}

export class NullHandler extends Handler {
  override handle(_record: LogRecord): boolean {
    return false;
  }
  override emit(_record: LogRecord): void {}
}

class LastResortHandler extends StreamHandler {
  constructor() {
    super();
    this.level = WARNING;
  }
}

let lastResort: Handler | null = null;

export class Logger {
  readonly name: string;
  level: number = NOTSET;
  propagate = true;
  disabled = false;
  handlers: Handler[] = [];

  constructor(name: string, level: Level = NOTSET) {
    this.name = name;
    this.level = checkLevel(level);
  }

  /** Nearest existing ancestor logger (dot hierarchy), else the root. `null` for the root itself. */
  get parent(): Logger | null {
    if (this === rootLogger) return null;
    let n = this.name;
    for (;;) {
      const i = n.lastIndexOf(".");
      if (i < 0) return rootLogger;
      n = n.slice(0, i);
      const p = registry.get(n);
      if (p) return p;
    }
  }

  setLevel(level: Level): void {
    this.level = checkLevel(level);
  }

  getEffectiveLevel(): number {
    let logger: Logger | null = this;
    while (logger) {
      if (logger.level) return logger.level;
      logger = logger.parent;
    }
    return NOTSET;
  }

  isEnabledFor(level: number): boolean {
    if (this.disabled) return false;
    if (level < disableLevel) return false;
    return level >= this.getEffectiveLevel();
  }

  addHandler(h: Handler): void {
    if (!this.handlers.includes(h)) this.handlers.push(h);
  }

  removeHandler(h: Handler): void {
    const i = this.handlers.indexOf(h);
    if (i >= 0) this.handlers.splice(i, 1);
  }

  hasHandlers(): boolean {
    let c: Logger | null = this;
    while (c) {
      if (c.handlers.length) return true;
      if (!c.propagate) break;
      c = c.parent;
    }
    return false;
  }

  getChild(suffix: string): Logger {
    return stdGetLogger(this === rootLogger ? suffix : `${this.name}.${suffix}`);
  }

  debug(msg: unknown, ...args: unknown[]): void {
    this.log(DEBUG, msg, ...args);
  }
  info(msg: unknown, ...args: unknown[]): void {
    this.log(INFO, msg, ...args);
  }
  warning(msg: unknown, ...args: unknown[]): void {
    this.log(WARNING, msg, ...args);
  }
  warn(msg: unknown, ...args: unknown[]): void {
    this.log(WARNING, msg, ...args);
  }
  error(msg: unknown, ...args: unknown[]): void {
    this.log(ERROR, msg, ...args);
  }
  critical(msg: unknown, ...args: unknown[]): void {
    this.log(CRITICAL, msg, ...args);
  }
  /** `logger.exception(msg, ...)`: ERROR with exc_info. */
  exception(msg: unknown, ...args: unknown[]): void {
    const last = args[args.length - 1];
    if (!(last instanceof ExcInfo)) args.push(new ExcInfo());
    this.log(ERROR, msg, ...args);
  }

  log(level: number, msg: unknown, ...args: unknown[]): void {
    if (!this.isEnabledFor(level)) return;
    let exc: ExcInfo | null = null;
    const last = args[args.length - 1];
    if (last instanceof ExcInfo) {
      exc = last;
      args = args.slice(0, -1);
    }
    this.handle(new LogRecord(this.name, level, msg, args, exc));
  }

  handle(record: LogRecord): void {
    if (this.disabled) return;
    this.callHandlers(record);
  }

  callHandlers(record: LogRecord): void {
    let c: Logger | null = this;
    let found = 0;
    while (c) {
      for (const hdlr of [...c.handlers]) {
        found += 1;
        if (record.levelno >= hdlr.level) hdlr.handle(record);
      }
      c = c.propagate ? c.parent : null;
    }
    if (found === 0) {
      lastResort ??= new LastResortHandler();
      if (record.levelno >= lastResort.level) {
        const h = lastResort as StreamHandler;
        try {
          h.stream.write(`${record.getMessage()}\n`);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

class RootLogger extends Logger {
  constructor(level: number) {
    super("root", level);
  }
}

const rootLogger: Logger = new RootLogger(WARNING);
const registry = new Map<string, Logger>();
let disableLevel = 0;

/** stdlib `logging.getLogger(name?)`: no / empty / "root" name returns the root logger. */
export function stdGetLogger(name?: string | null): Logger {
  if (!name || name === "root") return rootLogger;
  let l = registry.get(name);
  if (!l) {
    l = new Logger(name);
    registry.set(name, l);
  }
  return l;
}

/** stdlib `logging.disable(level)`. */
export function disable(level: number = CRITICAL): void {
  disableLevel = level;
}

/** Python `logging.root`. */
export function getRootLogger(): Logger {
  return rootLogger;
}

/** stdlib `logging.basicConfig(level=..., format=..., stream=...)` (no-op when the root already has handlers). */
export function basicConfig(opts: { level?: Level; format?: string; stream?: Writable; force?: boolean } = {}): void {
  if (opts.force) for (const h of [...rootLogger.handlers]) rootLogger.removeHandler(h);
  if (rootLogger.handlers.length) return;
  const h = new StreamHandler(opts.stream);
  h.setFormatter(new Formatter(opts.format ?? "%(levelname)s:%(name)s:%(message)s"));
  rootLogger.addHandler(h);
  if (opts.level !== undefined) rootLogger.setLevel(opts.level);
}

/** Drop every registered logger/handler (test isolation helper; not part of Python's API). */
export function _resetLoggingForTests(): void {
  registry.clear();
  for (const h of [...rootLogger.handlers]) rootLogger.removeHandler(h);
  rootLogger.setLevel(WARNING);
  _CONFIGURED = false;
  disableLevel = 0;
}

/** stdlib-style namespace (`logging.getLogger`, `logging.Handler`, `logging.DEBUG`, ...). */
export const logging = {
  NOTSET,
  DEBUG,
  INFO,
  WARNING,
  WARN,
  ERROR,
  CRITICAL,
  FATAL,
  getLevelName,
  getLogger: stdGetLogger,
  Logger,
  LogRecord,
  Handler,
  StreamHandler,
  NullHandler,
  Formatter,
  basicConfig,
  disable,
  root: rootLogger,
};

// ---------------------------------------------------------------------------
// SDK helper (port of the module body)
// ---------------------------------------------------------------------------

export const _LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s";
let _CONFIGURED = false;

export function _isConfigured(): boolean {
  return _CONFIGURED;
}

export function _setConfigured(value: boolean): void {
  _CONFIGURED = value;
}

/**
 * Configure logging once on first call.
 *
 * The package logger's *level* always follows `SANDBOX_LOG_LEVEL` so that standalone SDK users keep the documented
 * knob. The fallback stderr handler is only installed when nothing else owns the output: when the CLI (or any
 * embedding host) has already configured the root logger — the `OutputManager` installs a single bridge handler
 * there — a second handler would render every record twice, so only the host's is kept.
 */
export function _configureOnce(): void {
  if (_CONFIGURED) return;
  const levelStr = (process.env["SANDBOX_LOG_LEVEL"] ?? "WARNING").toUpperCase();
  const level = levelFromName(levelStr, WARNING);
  const handler = new StreamHandler();
  handler.setFormatter(new Formatter(_LOG_FORMAT));
  const packageLogger = stdGetLogger("easy_sandbox");
  packageLogger.setLevel(level);
  if (!packageLogger.handlers.length && !stdGetLogger().handlers.length) {
    packageLogger.addHandler(handler);
  } else if (stdGetLogger().handlers.length) {
    // A host (the CLI bridge) already filters records. A WARNING level on this logger would drop INFO before that
    // host ever sees it.
    packageLogger.setLevel(NOTSET);
  }
  _CONFIGURED = true;
}

/**
 * Get a namespaced logger for a module (Python `get_logger`).
 *
 * @param name Module name, will be prefixed with `easy_sandbox.`.
 * @example
 *   const logger = getLogger("transport.http");
 *   logger.debug("Sending request to %s", url);
 */
export function getLogger(name: string): Logger {
  _configureOnce();
  if (!name.startsWith("easy_sandbox.")) name = `easy_sandbox.${name}`;
  return stdGetLogger(name);
}

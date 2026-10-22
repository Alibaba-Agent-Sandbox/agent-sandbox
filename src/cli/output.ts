/**
 * Unified CLI output manager with TTY/CI detection and multi-mode support (port of `cli/output.py`).
 *
 * Provides a single {@link OutputManager} that every CLI command uses instead of bare `echo` calls. Supports normal,
 * verbose, quiet, JSON, and CI output modes.
 *
 * Channel policy (task 167):
 *  - **stdout** carries only what a user or a script consumes as the final result: `data`, `table`, `success`.
 *  - **stderr** carries progress state and diagnostics: `info`, `progress`, `warning`, `error`, `debug`, and every
 *    stdlib `logging` record (bridged through a single root handler).
 *
 * Machine-readable output can therefore never be polluted by status lines or log records, in any mode
 * (plain / `--quiet` / `--json` / `--ci`).
 *
 * ## Using it from a command
 *
 * ```ts
 * import { getOutput } from "../output.js";
 *
 * const out = getOutput();                       // from the current click context (ctx.meta["abx.output"])
 * out.info("Creating sandbox...");               // stderr
 * await out.spinner("Creating sandbox", () => createIt());     // activity line on an interactive stderr
 * await out.activity("Researching", async (update) => {         // update === null when no live display is possible
 *   update?.("line one\nline two");
 * }, { tick: true });
 * out.data({ ID: sb.id, Status: sb.status });    // stdout (aligned lines / JSON / bare values in --quiet)
 * out.table(["ID", "Status"], rows);             // stdout (table / JSON list / TSV in --quiet)
 * out.success("done");                           // stdout
 * ```
 *
 * Python's context managers (`with out.spinner(...)`, `with out.activity(...) as update`) become callbacks that
 * return the callback's result (a promise); the display is stopped even when the callback throws. The imperative
 * form {@link OutputManager.startActivity} returns `{ update, close }` for code that cannot nest a callback.
 *
 * ## Test seams
 *
 * Python tests monkeypatch module attributes of `agent_sandbox.cli.output` (`sys`, `is_tty`, `_ACTIVITY_MIN_INTERVAL`,
 * `_ACTIVITY_TICK_SECONDS`, `click.echo`). ESM bindings are read-only, so the same patch
 * points live on the mutable {@link outputSeams} object; the module always reads them at call time.
 */

import { getCurrentContext, type Context } from "./kit.js";
import { echo, type TextOutput } from "./io.js";
import { getTerminalSize, sys as frameworkSys } from "./io.js";
import { len } from "../utils/_py.js";
import { pyStr } from "../utils/_pyformat.js";
import { orjsonDumps } from "./_orjson.js";
import { type LogRecord, _isConfigured, levelFromName, logging } from "../utils/logging.js";
import { type ColorName, paint } from "./color.js";
import { cellWidth, renderTable } from "./table.js";

export { cellWidth as _cellLen };

export const OUTPUT_META_KEY = "abx.output";

// ---------------------------------------------------------------------------------------------------------------------
// seams
// ---------------------------------------------------------------------------------------------------------------------

interface SysLike {
  stdout: TextOutput;
  stderr: TextOutput;
}

export const outputSeams: {
  /** The `sys` module as `output.py` sees it (`sys.stdout` / `sys.stderr`). Defaults to `io.ts`'s `sys`. */
  sys: SysLike;
  /** `is_tty()`; tests replace it to simulate a terminal. Defaults to `sys.stdout.isatty()`. */
  isTty: () => boolean;
  /** `click.echo` as used by the manager. */
  echo: (text: string, opts: { err: boolean }) => void;
  /** `_ACTIVITY_MIN_INTERVAL` (seconds between redraws). */
  activityMinInterval: number;
  /** `_ACTIVITY_TICK_SECONDS` (seconds between ticks of a ticked block). */
  activityTickSeconds: number;
  /** `time.monotonic()` in seconds. */
  monotonic: () => number;
} = {
  sys: frameworkSys,
  isTty: () => defaultIsTty(),
  echo: (text, opts) => echo(text, { err: opts.err }),
  activityMinInterval: 0.1,
  activityTickSeconds: 1.0,
  monotonic: () => performance.now() / 1000,
};

function defaultIsTty(): boolean {
  const stdout = outputSeams.sys.stdout;
  return typeof stdout.isatty === "function" && Boolean(stdout.isatty());
}

const stderrIsTty = (): boolean => {
  const stderr = outputSeams.sys.stderr;
  return typeof stderr.isatty === "function" && Boolean(stderr.isatty());
};

// ---------------------------------------------------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------------------------------------------------

const CI_ENV_VARS: readonly string[] = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "JENKINS_URL",
  "TRAVIS",
  "CIRCLECI",
  "BITBUCKET_PIPELINES",
  "TF_BUILD",
  "CODEBUILD_BUILD_ID",
];

/** Return `true` when *stdout* is connected to a terminal. */
export function isTty(): boolean {
  return outputSeams.isTty();
}

/** Return `true` when running inside a known CI environment. */
export function isCiEnv(): boolean {
  return CI_ENV_VARS.some((v) => Boolean(process.env[v]));
}

// ---------------------------------------------------------------------------------------------------------------------
// logging bridge
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Forward stdlib `logging` records into the CLI's stderr channel.
 *
 * A *single* instance of this handler is installed on the root logger by {@link OutputManager}, replacing the handler
 * that `utils/logging` installs for standalone SDK use. That is what keeps a library warning (e.g. the
 * capability-resolver fallback) from being rendered twice. Records are formatted once (`LEVELNAME: message`) and
 * handed to the manager so that live spinners are paused before anything is written.
 */
export class _LogBridgeHandler extends logging.Handler {
  private readonly manager: OutputManager;

  constructor(manager: OutputManager) {
    super(manager._level);
    this.manager = manager;
    this.setFormatter(new logging.Formatter("%(levelname)s: %(message)s"));
  }

  override emit(record: LogRecord): void {
    let message: string;
    try {
      message = this.format(record);
    } catch {
      this.handleError(record);
      return;
    }
    this.manager._emitLog(message);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Live activity line
// ---------------------------------------------------------------------------------------------------------------------

const ACTIVITY_STRIP_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|[\x00-\x1f\x7f]/g;

/** Environment variable overriding how many grey activity lines are shown. */
export const ACTIVITY_LINES_ENV = "ABX_ACTIVITY_LINES";
const ACTIVITY_LINES_DEFAULT = 6;
const ACTIVITY_LINES_MAX = 10;

/** How many activity lines to show: `ABX_ACTIVITY_LINES` (1-10), default 6. */
export function _activityLineCount(): number {
  const raw = (process.env[ACTIVITY_LINES_ENV] ?? "").trim();
  if (!/^[+-]?\d+$/.test(raw.replace(/_/g, ""))) return ACTIVITY_LINES_DEFAULT;
  const value = Number.parseInt(raw.replace(/_/g, ""), 10);
  return Math.min(Math.max(value, 1), ACTIVITY_LINES_MAX);
}

/**
 * The header line: `message... 12s`.
 *
 * Phase strings that already end in an ellipsis (`Checking Docker daemon...`) are not given a second one.
 */
export function _activityHead(message: string, elapsed: number): string {
  const text = message.replace(/[\s]+$/u, "");
  if (text.endsWith("...")) return `${text} ${elapsed}s`;
  return `${text}... ${elapsed}s`;
}

/**
 * Split *summary* into its last *limit* non-empty lines, controls removed.
 *
 * The agent side hands over a newline-separated feed (oldest first); each line is sanitised on its own so an escape
 * sequence can never survive or span lines.
 */
export function _activityLines(summary: string, limit: number): string[] {
  const lines = pySplitLines(summary).map((raw) => raw.replace(ACTIVITY_STRIP_RE, " ").split(/\s+/u).filter(Boolean).join(" "));
  const kept = lines.filter((l) => l);
  return limit > 0 ? kept.slice(-limit) : [];
}

function pySplitLines(s: string): string[] {
  if (s === "") return [];
  const parts = s.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Truncate *text* to at most *width* terminal cells (CJK-aware). */
export function _fitCells(text: string, width: number): string {
  if (width <= 0) return "";
  if (cellWidth(text) <= width) return text;
  const out: string[] = [];
  let used = 0;
  for (const char of text) {
    const size = cellWidth(char);
    if (used + size > width - 1) break;
    out.push(char);
    used += size;
  }
  return `${out.join("")}…`;
}

interface PausableDisplay {
  stop(): void;
  start(): void;
}

/**
 * A self-erasing block on *stderr*: a header plus grey activity lines.
 *
 * The live activity display. Duck-types the two
 * methods {@link OutputManager._spinnerGuard} calls on a live status (`stop` / `start`), so every ordinary log, info or
 * warning write first clears the block and redraws it afterwards - log lines never interleave with it.
 *
 * The block is redrawn in place: the cursor stays at the end of its last row (no trailing newline), and each redraw
 * moves up over the rows drawn before (`ESC [ n A`), then clears to the end of the screen.
 */
export class _TransientLine implements PausableDisplay {
  private readonly color: boolean;
  private head = "";
  private details: string[] = [];
  private active = false;
  private rows = 0;

  constructor(opts: { color: boolean }) {
    this.color = opts.color;
  }

  private width(): number {
    return Math.max(getTerminalSize([80, 24]).columns - 1, 10);
  }

  private err(): TextOutput {
    return outputSeams.sys.stderr;
  }

  private rewind(): void {
    if (this.rows > 1) this.err().write(`\x1b[${this.rows - 1}A`);
    this.err().write("\r");
  }

  private draw(): void {
    const width = this.width();
    const previous = this.rows;
    this.rewind();
    const rows: Array<[string, boolean]> = [[this.head, false], ...this.details.map((d): [string, boolean] => [d, true])];
    const out: string[] = [];
    for (const [text, grey] of rows) {
      const fitted = _fitCells(text, width);
      const padded = fitted + " ".repeat(Math.max(width - cellWidth(fitted), 0));
      out.push(!this.color ? padded : grey ? paint(padded, "bright_black") : paint(padded, "bold"));
    }
    this.err().write(out.join("\n"));
    if (previous > rows.length) this.err().write("\x1b[J");
    this.err().flush();
    this.rows = rows.length;
  }

  private erase(): void {
    if (this.rows) {
      this.rewind();
      this.err().write("\x1b[J");
      this.err().flush();
      this.rows = 0;
    }
  }

  start(): void {
    this.active = true;
    if (this.head) this.draw();
  }

  stop(): void {
    this.active = false;
    this.erase();
  }

  update(head: string, details: string[]): void {
    this.head = head;
    this.details = details;
    if (this.active) this.draw();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// OutputManager
// ---------------------------------------------------------------------------------------------------------------------

export interface OutputManagerOptions {
  /** Emit DEBUG-level messages. */
  verbose?: boolean;
  /** Suppress informational messages; only errors and final results. */
  quiet?: boolean;
  /** All output as JSON (machine-parseable). */
  jsonMode?: boolean;
  /** Disable ANSI colours. */
  noColor?: boolean;
  /** CI/CD mode: implies quiet + noColor + jsonMode. */
  ci?: boolean;
  /** Explicit log level (`DEBUG` / `INFO` / `WARNING` / `ERROR`). Takes precedence over verbose / quiet. */
  logLevel?: string | null;

}

export type ActivityUpdate = (summary?: string) => void;

export interface ActivityHandle {
  /** `update(summary)` callable, or `null` when no live display can be drawn. */
  update: ActivityUpdate | null;
  /** Stop the display (idempotent). */
  close(): void;
}

type DisplayHandle = PausableDisplay;

function dictEntries(data: unknown): Array<[unknown, unknown]> | null {
  if (data instanceof Map) return [...data.entries()];
  if (data !== null && typeof data === "object" && !Array.isArray(data) && !(data instanceof Set)) {
    const proto = Object.getPrototypeOf(data);
    if (proto === Object.prototype || proto === null) return Object.entries(data as Record<string, unknown>);
  }
  return null;
}

/**
 * Unified output manager for the CLI.
 *
 * Central place that decides *what* gets printed and *how*, depending on the combination of `--verbose`, `--quiet`,
 * `--json`, `--no-color`, `--ci`, and `--log-level` flags.
 *
 * Results meant to be consumed (`data` / `table` / `success`) are written to **stdout**; progress state and
 * diagnostics (`info` / `progress` / `warning` / `error` / `debug`) are written to **stderr**, together with every
 * bridged stdlib log record. In `--json` mode the diagnostic messages stay JSON, but on stderr, so `stdout` remains a
 * single machine-parseable document.
 */
export class OutputManager {
  verbose: boolean;
  quiet: boolean;
  jsonMode: boolean;
  noColor: boolean;
  ci: boolean;
  /** Effective stdlib log level (`_level`). */
  _level: number;
  /**
   * Status objects currently rendering on stderr. Output written while any of them is live is wrapped in a
   * pause/resume guard so that the live display never garbles a warning or a result.
   */
  _spinnerStack: DisplayHandle[] = [];
  _logBridge: _LogBridgeHandler | null = null;

  constructor(opts: OutputManagerOptions = {}) {
    const verbose = opts.verbose ?? false;
    let quiet = opts.quiet ?? false;
    let jsonMode = opts.jsonMode ?? false;
    let noColor = opts.noColor ?? false;
    const ci = opts.ci ?? false;
    if (ci) {
      quiet = true;
      jsonMode = true;
      noColor = true;
    }
    this.verbose = verbose;
    this.quiet = quiet;
    this.jsonMode = jsonMode;
    this.noColor = noColor || !isTty();
    this.ci = ci;

    const logLevel = opts.logLevel ?? null;
    if (logLevel !== null) this._level = levelFromName(logLevel.toUpperCase(), logging.INFO);
    else if (verbose) this._level = logging.DEBUG;
    else if (quiet) this._level = logging.ERROR;
    else this._level = logging.WARNING;

    this._configureLogging();
  }

  /**
   * Enable (or disable) verbose mode after construction.
   *
   * Used when a subcommand-level `-v/--verbose` flag is parsed after the root group has already created this manager.
   */
  setVerbose(enabled = true): void {
    this.verbose = enabled;
    this._level = enabled ? logging.DEBUG : logging.WARNING;
    this._applyLogLevel();
  }

  // -- output methods ---------------------------------------------------------------------------------------------

  /** Print an informational message to *stderr* (suppressed in *quiet*). */
  info(message: string, extra: Record<string, unknown> = {}): void {
    if (this.quiet) return;
    if (this.jsonMode) this._json({ level: "info", message, ...extra }, true);
    else this._writeStderr(message);
  }

  /**
   * Print a success message to *stdout* (suppressed in *quiet* mode).
   *
   * A success notice belongs to the result channel: it is what a human reads after the command did its job.
   */
  success(message: string, extra: Record<string, unknown> = {}): void {
    if (this.quiet) return;
    if (this.jsonMode) this._json({ status: "success", message, ...extra });
    else this._writeStdout(message, "green");
  }

  /** Print a warning to *stderr* (always shown unless *quiet*). */
  warning(message: string, extra: Record<string, unknown> = {}): void {
    if (this.quiet) return;
    if (this.jsonMode) this._json({ level: "warning", message, ...extra }, true);
    else this._writeStderr(`Warning: ${message}`, "yellow");
  }

  /** Print an error message to *stderr* (**always** shown, even in *quiet*). */
  error(message: string, opts: { code?: string; suggestion?: string; [extra: string]: unknown } = {}): void {
    const { code = "", suggestion = "", ...extra } = opts;
    if (this.jsonMode) {
      const payload: Record<string, unknown> = { status: "error", message };
      if (code) payload["code"] = code;
      if (suggestion) payload["suggestion"] = suggestion;
      Object.assign(payload, extra);
      this._json(payload, true);
    } else {
      const parts: string[] = [];
      if (code) parts.push(`[${code}] `);
      parts.push(message);
      this._writeStderr(parts.join(""), "red");
      if (suggestion && !this.quiet) this._writeStderr(`  Suggestion: ${suggestion}`);
    }
  }

  /** Print a debug message to *stderr* (only in *verbose* mode). */
  debug(message: string, extra: Record<string, unknown> = {}): void {
    if (!this.verbose) return;
    if (this.jsonMode) this._json({ level: "debug", message, ...extra }, true);
    else this._writeStderr(`DEBUG: ${message}`, "cyan");
  }

  /**
   * Print structured data - the user-consumable result - to *stdout*.
   *
   * In JSON mode the data is emitted as a single JSON document on stdout. In quiet mode only the bare values are
   * written (one per line) so that shell pipelines keep working. Otherwise dicts become aligned key/value lines, lists
   * one line per item, and anything else `str()`. A "dict" is a plain object or a `Map` (use a `Map` when key order
   * must not be subject to JS integer-key reordering).
   */
  data(data: unknown): void {
    if (this.jsonMode) {
      this._json(data);
      return;
    }
    const dict = dictEntries(data);
    if (this.quiet) {
      if (dict) for (const [, value] of dict) this._writeStdout(pyStr(value));
      else if (Array.isArray(data)) for (const item of data) this._writeStdout(pyStr(item));
      else this._writeStdout(pyStr(data));
      return;
    }
    if (dict) {
      if (!dict.length) return;
      const maxKey = Math.max(...dict.map(([k]) => len(pyStr(k))));
      for (const [k, v] of dict) {
        const key = pyStr(k);
        this._writeStdout(`${key}${" ".repeat(Math.max(maxKey - len(key), 0))}  ${pyStr(v)}`);
      }
    } else if (Array.isArray(data)) {
      for (const item of data) this._writeStdout(pyStr(item));
    } else this._writeStdout(pyStr(data));
  }

  /**
   * Print tabular data.
   *
   * JSON mode emits a list of dicts; quiet mode emits tab-separated values; normal mode prints an aligned table.
   */
  table(headers: string[], rows: string[][]): void {
    if (this.jsonMode) {
      const items = rows.map((row) => {
        const item = new Map<string, unknown>();
        const n = Math.min(headers.length, row.length);
        for (let i = 0; i < n; i++) item.set(headers[i] as string, row[i]);
        return item;
      });
      this._json(items);
      return;
    }
    if (this.quiet) {
      for (const row of rows) this._writeStdout(row.join("\t"));
      return;
    }
    const bold = this.noColor ? undefined : (text: string): string => paint(text, "bold");
    this._writeStdout(renderTable(headers, rows, bold));
  }

  /**
   * Print a progress / status message to *stderr*.
   *
   * Status updates are diagnostics, never results: they stay on stderr in every mode so `abx ... | jq` (or any other
   * consumer of stdout) is unaffected. In CI/quiet mode they are suppressed.
   */
  progress(message: string): void {
    if (this.quiet) return;
    if (this.jsonMode) this._json({ level: "progress", message }, true);
    else this._writeStderr(`... ${message}`, "blue");
  }

  /**
   * Whether the full live status line is appropriate for the current session.
   *
   * Only enabled in interactive TTY mode: disabled by `--verbose`, `--quiet`, `--json`, `--no-color` (which includes
   * non-TTY stdout), or when stderr is not connected to a terminal.
   *
   * In verbose mode spinners are suppressed because DEBUG log lines written to stderr would interleave with the
   * live display, producing garbled output like `⠋ Waiting...DEBUG: https://...`.
   */
  get useLiveStatus(): boolean {
    return !(this.verbose || this.quiet || this.jsonMode || this.noColor || !stderrIsTty());
  }

  /**
   * Run *fn* around a long step that has no line-by-line log.
   *
   * On an interactive terminal this is the activity header (`message... 12s`), redrawn once a second so the elapsed
   * time does not freeze. Grey detail lines stay empty until a caller uses {@link activity} and feeds them. Quiet,
   * JSON, CI, and non-TTY sessions stay silent - callers that need a machine-readable line already emit
   * {@link progress} themselves.
   *
   * If *fn* throws, the display stops and the exception propagates untouched.
   */
  async spinner<T>(message: string, fn: () => T | Promise<T>): Promise<T> {
    if (this.useActivityLine) return this.activity(message, () => fn(), { tick: true });
    return fn();
  }

  /**
   * Like {@link spinner}, but passes `update(text)` for one detail line to *fn*.
   *
   * On an interactive terminal *text* is the grey line under the `message... 12s` header. `--verbose` without a live
   * display prints each change on stderr. Quiet, JSON, CI, and non-TTY pass a no-op.
   */
  async liveSpinner<T>(message: string, fn: (update: (text: string) => void) => T | Promise<T>): Promise<T> {
    if (this.useActivityLine) return this.activity(message, (update) => fn((update ?? noop) as (text: string) => void), { tick: true });
    if (this.verbose && !this.quiet && !this.jsonMode) return fn((text) => this._writeStderr(`... ${text}`));
    return fn(noop);
  }

  /**
   * Whether a live (grey) activity line can be drawn on *stderr*.
   *
   * Needs an interactive stderr, a real terminal type, and no `--json` / `--quiet` / CI mode. Unlike
   * {@link useLiveStatus} it stays available under `--verbose` and `--no-color`: there the line is a self-erasing
   * `\r` line that the log writers already pause around.
   */
  get useActivityLine(): boolean {
    return !(this.quiet || this.jsonMode || this.ci || (process.env["TERM"] ?? "").toLowerCase() === "dumb" || !stderrIsTty());
  }

  /**
   * Show *message* with elapsed time and a rolling activity feed while *fn* runs.
   *
   * *fn* receives an `update(summary)` callable, or `null` when no live display can be drawn (non-TTY, `--json`,
   * `--quiet`, CI, dumb terminal); callers then simply skip reporting. *summary* is recent activity, **one line per
   * entry, oldest first**: the display keeps the last `ABX_ACTIVITY_LINES` (default 6) of them in grey *below* the
   * `message... 12s` header, so the block scrolls by line. An update that arrives inside the throttle window is
   * remembered and drawn on the next update that is allowed through - a later call is still required, so a throttled
   * line never appears on its own.
   *
   * When `tick` is true a timer redraws the same summary once a second so the elapsed time keeps moving during a
   * silent step (create, upload, install, fetch). Agent runs leave it off; they already heartbeat. Everything is
   * written to **stderr**, never stdout, and each line is stripped of control characters and rendered literally.
   *
   * The block is redrawn in place on a TTY and cleared around every log write.
   */
  async activity<T>(message: string, fn: (update: ActivityUpdate | null) => T | Promise<T>, opts: { tick?: boolean } = {}): Promise<T> {
    const handle = this.startActivity(message, opts);
    try {
      return await fn(handle.update);
    } finally {
      handle.close();
    }
  }

  /** Imperative form of {@link activity}: call `close()` (idempotent) when the step is over. */
  startActivity(message: string, opts: { tick?: boolean } = {}): ActivityHandle {
    if (!this.useActivityLine) return { update: null, close: () => undefined };
    const tick = opts.tick ?? false;
    const started = outputSeams.monotonic();
    let last = 0;
    let pending = "";
    const shown = _activityLineCount();

    const makeUpdater = (render: (head: string, details: string[]) => void): ActivityUpdate => {
      return (summary = ""): void => {
        pending = summary;
        const now = outputSeams.monotonic();
        // `last == 0` is the first draw; it always paints.
        if (last && now - last < outputSeams.activityMinInterval) return;
        last = now;
        const text = pending;
        render(_activityHead(message, Math.trunc(now - started)), _activityLines(text, shown));
      };
    };

    const arm = (redraw: () => void): ReturnType<typeof setInterval> | null => {
      if (!tick) return null;
      const timer = setInterval(() => {
        try {
          redraw();
        } catch {
          /* suppress: a failed tick never breaks the step */
        }
      }, outputSeams.activityTickSeconds * 1000);
      timer.unref();
      return timer;
    };

    const disarm = (timer: ReturnType<typeof setInterval> | null): void => {
      if (timer !== null) clearInterval(timer);
    };

    const line = new _TransientLine({ color: !this.noColor });
    this._spinnerStack.push(line);
    line.update(_activityHead(message, 0), []);
    line.start();
    const updater = makeUpdater((head, det) => line.update(head, det));
    const redrawPlain = (): void => {
      const text = pending;
      const now = outputSeams.monotonic();
      if (last && now - last < outputSeams.activityMinInterval) return;
      last = now;
      line.update(_activityHead(message, Math.trunc(now - started)), _activityLines(text, shown));
    };
    const timer = arm(redrawPlain);
    let closed = false;
    return {
      update: updater,
      close: () => {
        if (closed) return;
        closed = true;
        disarm(timer);
        const at = this._spinnerStack.indexOf(line);
        if (at >= 0) this._spinnerStack.splice(at, 1);
        line.stop();
      },
    };
  }

  // -- private helpers ----------------------------------------------------------------------------------------------

  /**
   * Install the single stdlib-logging bridge used by this manager.
   *
   * The bridge handler lives on the *root* logger and replaces whatever a previous `logging.basicConfig` (or the SDK's
   * standalone fallback handler) installed, so a library warning is rendered exactly once, on stderr. Its level follows
   * the CLI's verbosity - that is what `--quiet` / `--verbose` / `--log-level` mean during a CLI run - while
   * propagation stays enabled so that `caplog`-style handlers keep working.
   */
  _configureLogging(): void {
    const rootLogger = logging.getLogger();
    rootLogger.setLevel(this._level);
    for (const handler of [...rootLogger.handlers]) rootLogger.removeHandler(handler);
    // The SDK's standalone handler would render every record a second time; the bridge supersedes it. The package
    // logger's own level is left untouched: the handler gate already implements the CLI level.
    const packageLogger = logging.getLogger("agent_sandbox");
    for (const handler of [...packageLogger.handlers]) packageLogger.removeHandler(handler);
    // The Python CLI imports the SDK lazily, i.e. after this bridge exists, so `_configureOnce` sees a host and leaves
    // the package logger at NOTSET. ES modules load the SDK (and its module-level `getLogger` calls) up front, which pins
    // the package logger at SANDBOX_LOG_LEVEL (WARNING) and would drop INFO/DEBUG before the bridge sees them; restore the
    // state the lazy import would have produced.
    if (_isConfigured()) packageLogger.setLevel(logging.NOTSET);
    this._logBridge = new _LogBridgeHandler(this);
    rootLogger.addHandler(this._logBridge);
  }

  /** Re-align the root logger and the bridge after a level change. */
  _applyLogLevel(): void {
    logging.getLogger().setLevel(this._level);
    if (this._logBridge !== null) this._logBridge.setLevel(this._level);
  }

  /** Write a bridged stdlib log record to stderr. */
  _emitLog(message: string): void {
    this._writeStderr(message);
  }

  /** Stop every live status display so raw output is not garbled. */
  _pauseSpinner(): void {
    for (const status of [...this._spinnerStack].reverse()) {
      try {
        status.stop();
      } catch {
        /* defensive */
      }
    }
  }

  /** Restart the status displays paused by {@link _pauseSpinner}. */
  _resumeSpinner(): void {
    for (const status of this._spinnerStack) {
      try {
        status.start();
      } catch {
        /* defensive */
      }
    }
  }

  /**
   * Hide live spinners around a write, then restore them.
   *
   * Without this, a live display and a plain `echo` line written at the same time interleave into unreadable
   * output (`⠋ Waiting...Warning: ...`).
   */
  _spinnerGuardSync<T>(fn: () => T): T {
    if (!this._spinnerStack.length) return fn();
    this._pauseSpinner();
    try {
      return fn();
    } finally {
      this._resumeSpinner();
    }
  }

  /** Async flavour of {@link _spinnerGuardSync} for code that awaits inside the guarded region. */
  async _spinnerGuard<T>(fn: () => T | Promise<T>): Promise<T> {
    if (!this._spinnerStack.length) return fn();
    this._pauseSpinner();
    try {
      return await fn();
    } finally {
      this._resumeSpinner();
    }
  }

  /** Write one result line to stdout, pausing any live spinner first. */
  _writeStdout(message: string, color: string | null = null): void {
    this._write(message, false, color);
  }

  /** Write one status/diagnostic line to stderr, pausing any spinner. */
  _writeStderr(message: string, color: string | null = null): void {
    this._write(message, true, color);
  }

  /** Low-level writer shared by every channel helper. */
  _write(message: string, err: boolean, color: string | null): void {
    const text = this.noColor || color === null ? message : paint(message, color as ColorName);
    this._spinnerGuardSync(() => outputSeams.echo(text, { err }));
  }

  /** Emit a single JSON value to stdout (`err=true` -> stderr). */
  _json(data: unknown, err = false): void {
    const text = orjsonDumps(data);
    this._spinnerGuardSync(() => outputSeams.echo(text, { err }));
  }
}

const noop = (): void => undefined;


// ---------------------------------------------------------------------------------------------------------------------
// Context helper
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Retrieve the {@link OutputManager} from the click context.
 *
 * The manager is stored in `ctx.meta["abx.output"]` so that `ctx.obj` remains JSON-serializable.
 *
 * Falls back to a default instance when no context is available (e.g. during early startup / error handling).
 */
export function getOutput(ctx: Context | null | undefined = undefined): OutputManager {
  const context = ctx === undefined ? getCurrentContext(true) : ctx;
  if (context) {
    const mgr = context.meta[OUTPUT_META_KEY];
    if (mgr instanceof OutputManager) return mgr;
  }
  return new OutputManager();
}

/**
 * Turn on verbose mode from a subcommand-level `-v/--verbose` flag.
 *
 * Some users type `abx create -v` instead of `abx -v create`. Key subcommands therefore accept a local `-v/--verbose`
 * flag and call this helper, which flips the shared {@link OutputManager} (stored in `ctx.meta`) to verbose and
 * re-applies DEBUG-level logging.
 */
export function enableVerbose(ctx: Context): void {
  const out = getOutput(ctx);
  out.setVerbose(true);
  if (ctx.obj === null || ctx.obj === undefined) ctx.obj = {};
  ctx.obj["verbose"] = true;
}

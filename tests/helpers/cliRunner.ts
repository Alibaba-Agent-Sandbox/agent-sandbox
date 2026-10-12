/**
 * `CliRunner`: the equivalent of `click.testing.CliRunner` for the TypeScript framework.
 *
 * ```ts
 * import { CliRunner } from "../helpers/cliRunner.js";
 * import { cli } from "../../src/cli/main.js";
 *
 * const runner = new CliRunner();
 * const result = await runner.invoke(cli, ["--help"]);
 * expect(result.exit_code).toBe(0);
 * expect(result.output).toContain("Usage:");
 * ```
 *
 * `invoke(cli, args, { input, env, catch_exceptions, color, prog_name, ...contextExtra })` runs `cli.main()` in
 * standalone mode with an isolated environment, then returns a `Result`:
 *
 * | field                                 | meaning                                                                    |
 * | ------------------------------------- | -------------------------------------------------------------------------- |
 * | `exit_code`                           | the `SystemExit` code (0 when `main` returned), 1 for uncaught exceptions   |
 * | `output`                              | stdout + stderr interleaved in write order (Click >= 8.2 semantics)         |
 * | `stdout`, `stderr`                    | each stream separately                                                      |
 * | `stdout_bytes`, `stderr_bytes`, ...   | UTF-8 buffers                                                               |
 * | `exception`                           | the `SystemExit` (non-zero) or the uncaught error, `null` otherwise         |
 * | `return_value`                        | what `main` returned (only meaningful with `standalone_mode: false`)        |
 *
 * Isolation (the same as Click's): `sys.stdin/stdout/stderr` (the framework's `sys` object from
 * `src/framework/io.ts`) are replaced by in-memory streams that report `isatty() === false`; `FORCED_WIDTH` is 80;
 * the `visible_prompt_func` / `hidden_prompt_func` seams of `termui` read from `input` (the prompt is echoed to
 * stdout, then the typed value and a newline); ANSI codes are stripped unless `color: true`; environment variables
 * in `env` are applied to `process.env` (a `null` value deletes the variable) and restored afterwards.
 *
 * Code that writes to `process.stdout` directly (instead of through `sys` / `echo`) is NOT captured; the CLI never
 * does that. `result.stdout` of a command that prints through `sys.stdout.write` is captured.
 *
 * Differences from Click: `args` strings are split with POSIX `shlex`; `capture: "fd"`, `isolated_filesystem()` and
 * the `pdb` patching do not exist (use `fs.mkdtempSync` + `process.chdir` in tests, or pass absolute paths).
 */

import { Command } from "../../src/framework/core.js";
import { formatting } from "../../src/framework/formatting.js";
import { sys, type TextInput, type TextOutput } from "../../src/framework/io.js";
import { termui } from "../../src/framework/termui.js";
import { EOFError, SystemExit, setShouldStripAnsi } from "../../src/framework/utils.js";
import { shlexSplit } from "../../src/api/_shlex.js";

class Mixer {
  readonly chunks: Array<["out" | "err", string]> = [];
}

/**
 * An in-memory text stream. Like Python's (unflushed) `TextIOWrapper` it keeps written text in a buffer and only
 * hands it to the shared `Mixer` on `flush()`; `echo()` always flushes, plain `write()` calls do not. This is what
 * makes `result.output` interleave exactly like Click's.
 */
class MemoryOutput implements TextOutput {
  private pending = "";
  constructor(
    private readonly mixer: Mixer,
    private readonly kind: "out" | "err",
  ) {}

  write(text: string): void {
    this.pending += text;
  }

  flush(): void {
    if (this.pending) {
      this.mixer.chunks.push([this.kind, this.pending]);
      this.pending = "";
    }
  }

  isatty(): boolean {
    return false;
  }

  fileno(): number {
    throw new Error("UnsupportedOperation: fileno");
  }
}

class MemoryInput implements TextInput {
  private pos = 0;
  paused = false;
  constructor(
    private readonly data: string,
    private readonly echoTo: TextOutput | null,
  ) {}

  private echo(text: string): string {
    if (this.echoTo !== null && !this.paused && text) this.echoTo.write(text);
    return text;
  }

  /** The next line INCLUDING its terminator (`next(text_input)`), `null` at EOF. */
  nextLineRaw(): string | null {
    if (this.pos >= this.data.length) return null;
    const idx = this.data.indexOf("\n", this.pos);
    const end = idx === -1 ? this.data.length : idx + 1;
    const line = this.data.slice(this.pos, end);
    this.pos = end;
    return line;
  }

  async readLine(): Promise<string | null> {
    const raw = this.nextLineRaw();
    if (raw === null) return null;
    this.echo(raw);
    return raw.replace(/\r?\n$/, "");
  }

  async read(n = -1): Promise<string> {
    const end = n < 0 ? this.data.length : Math.min(this.data.length, this.pos + n);
    const out = this.data.slice(this.pos, end);
    this.pos = end;
    return this.echo(out);
  }

  isatty(): boolean {
    return false;
  }
}

export class Result {
  constructor(
    readonly runner: CliRunner,
    readonly stdout_bytes: Buffer,
    readonly stderr_bytes: Buffer,
    readonly output_bytes: Buffer,
    readonly return_value: unknown,
    readonly exit_code: number,
    readonly exception: unknown,
  ) {}

  get output(): string {
    return this.output_bytes.toString("utf8").replace(/\r\n/g, "\n");
  }

  get stdout(): string {
    return this.stdout_bytes.toString("utf8").replace(/\r\n/g, "\n");
  }

  get stderr(): string {
    return this.stderr_bytes.toString("utf8").replace(/\r\n/g, "\n");
  }

  toString(): string {
    return `<Result ${this.exception ? String(this.exception) : "okay"}>`;
  }
}

export interface CliRunnerOptions {
  charset?: string;
  env?: Record<string, string | null>;
  echo_stdin?: boolean;
  catch_exceptions?: boolean;
}

export interface InvokeOptions {
  input?: string | Buffer | null;
  env?: Record<string, string | null> | null;
  catch_exceptions?: boolean | null;
  color?: boolean;
  prog_name?: string;
  /** Extra `Context` settings forwarded to `cli.main()` (e.g. `obj`, `default_map`, `terminal_width`). */
  [extra: string]: unknown;
}

export class CliRunner {
  readonly charset: string;
  readonly env: Record<string, string | null>;
  readonly echo_stdin: boolean;
  readonly catch_exceptions: boolean;

  constructor(opts: CliRunnerOptions = {}) {
    this.charset = opts.charset ?? "utf-8";
    this.env = opts.env ?? {};
    this.echo_stdin = opts.echo_stdin ?? false;
    this.catch_exceptions = opts.catch_exceptions ?? true;
  }

  getDefaultProgName(cli: Command): string {
    return cli.name || "root";
  }

  makeEnv(overrides: Record<string, string | null> | null = null): Record<string, string | null> {
    return { ...this.env, ...(overrides ?? {}) };
  }

  /**
   * `with runner.isolation(...)`: runs `fn` inside the isolated environment and hands it the captured streams.
   */
  async isolation<T>(
    fn: (streams: { mixer: Mixer; stdout: MemoryOutput; stderr: MemoryOutput }) => Promise<T>,
    opts: { input?: string | Buffer | null; env?: Record<string, string | null> | null; color?: boolean } = {},
  ): Promise<T> {
    const input = opts.input === undefined || opts.input === null ? "" : typeof opts.input === "string" ? opts.input : opts.input.toString(this.charset as BufferEncoding);
    const mixer = new Mixer();
    const stdout = new MemoryOutput(mixer, "out");
    const stderr = new MemoryOutput(mixer, "err");
    const textInput = new MemoryInput(input, this.echo_stdin ? stdout : null);

    const old = { stdin: sys.stdin, stdout: sys.stdout, stderr: sys.stderr };
    const oldForcedWidth = formatting.FORCED_WIDTH;
    formatting.FORCED_WIDTH = 80;

    sys.stdin = textInput;
    sys.stdout = stdout;
    sys.stderr = stderr;

    const pauseEcho = async <R>(f: () => Promise<R> | R): Promise<R> => {
      textInput.paused = true;
      try {
        return await f();
      } finally {
        textInput.paused = false;
      }
    };

    const visibleInput = (prompt: string): Promise<string> =>
      pauseEcho(() => {
        sys.stdout.write(prompt || "");
        const raw = textInput.nextLineRaw();
        if (raw === null) throw new EOFError();
        const val = raw.replace(/[\r\n]+$/, "");
        sys.stdout.write(`${val}\n`);
        sys.stdout.flush();
        return val;
      });

    const hiddenInput = (prompt: string): Promise<string> =>
      pauseEcho(() => {
        sys.stdout.write(`${prompt || ""}\n`);
        sys.stdout.flush();
        const raw = textInput.nextLineRaw();
        if (raw === null) throw new EOFError();
        return raw.replace(/[\r\n]+$/, "");
      });

    const defaultColor = opts.color ?? false;
    const oldVisible = termui.visible_prompt_func;
    const oldHidden = termui.hidden_prompt_func;
    termui.visible_prompt_func = visibleInput;
    termui.hidden_prompt_func = hiddenInput;
    const oldStrip = setShouldStripAnsi((_stream, color) => (color === null ? !defaultColor : !color));

    const env = this.makeEnv(opts.env ?? null);
    const oldEnv = new Map<string, string | undefined>();
    try {
      for (const [key, value] of Object.entries(env)) {
        oldEnv.set(key, process.env[key]);
        if (value === null) delete process.env[key];
        else process.env[key] = value;
      }
      return await fn({ mixer, stdout, stderr });
    } finally {
      for (const [key, value] of oldEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      sys.stdout = old.stdout;
      sys.stderr = old.stderr;
      sys.stdin = old.stdin;
      termui.visible_prompt_func = oldVisible;
      termui.hidden_prompt_func = oldHidden;
      setShouldStripAnsi(oldStrip);
      formatting.FORCED_WIDTH = oldForcedWidth;
    }
  }

  async invoke(cli: Command, args: string | readonly string[] | null = null, opts: InvokeOptions = {}): Promise<Result> {
    const { input, env, catch_exceptions: catchOpt, color = false, prog_name: progOpt, ...extra } = opts;
    const catchExceptions = catchOpt ?? this.catch_exceptions;

    return this.isolation(
      async ({ mixer, stdout: capturedOut, stderr: capturedErr }) => {
        let returnValue: unknown = null;
        let exception: unknown = null;
        let exitCode = 0;

        const argv: string[] = typeof args === "string" ? shlexSplit(args) : [...(args ?? [])];
        const progName = progOpt ?? this.getDefaultProgName(cli);

        try {
          returnValue = await cli.main({ args: argv, prog_name: progName, ...(extra as object) });
        } catch (e) {
          if (e instanceof SystemExit) {
            let eCode: unknown = e.code;
            if (eCode === null || eCode === undefined) eCode = 0;
            if (eCode !== 0) exception = e;
            if (typeof eCode !== "number") {
              sys.stdout.write(String(eCode));
              sys.stdout.write("\n");
              eCode = 1;
            }
            exitCode = eCode as number;
          } else if (e instanceof Error && e.name === "KeyboardInterrupt") {
            throw e;
          } else {
            if (!catchExceptions) throw e;
            exception = e;
            exitCode = 1;
          }
        }

        capturedOut.flush();
        capturedErr.flush();
        const pick = (kind?: "out" | "err"): Buffer =>
          Buffer.from(
            mixer.chunks
              .filter(([k]) => kind === undefined || k === kind)
              .map(([, t]) => t)
              .join(""),
            "utf8",
          );
        return new Result(this, pick("out"), pick("err"), pick(), returnValue, exitCode, exception);
      },
      { input, env, color },
    );
  }
}

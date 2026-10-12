/**
 * The Node counterpart of Python's `sys.stdin / sys.stdout / sys.stderr` as used by Click and the CLI.
 *
 * All framework / CLI code that writes user-visible output MUST go through these streams (or `echo()` which uses
 * them) instead of touching `process.stdout` directly. That is what lets `CliRunner` capture output, and what lets
 * tests swap a stream for a fake TTY exactly like the Python tests monkeypatch `sys`.
 *
 * ```ts
 * import { sys } from "../framework/io.js";
 * sys.stderr.write("hello\n");
 * sys.stdout.isatty();
 * ```
 */

import * as fs from "node:fs";

/** Writable text stream (a `sys.stdout` look-alike). */
export interface TextOutput {
  write(text: string): void;
  flush(): void;
  isatty(): boolean;
  /** Terminal size of the underlying device (only for real TTYs). */
  getWindowSize?(): [number, number] | null;
  /** Underlying file descriptor when known (1 / 2 for the real streams). */
  fileno?(): number;
}

/** Readable text stream (a `sys.stdin` look-alike). */
export interface TextInput {
  /** Next line without its line terminator, or `null` at EOF. (Python `input()` / `next(stdin)` minus the newline.) */
  readLine(): Promise<string | null>;
  /** Read `n` characters (or everything when `n` is omitted / negative). Empty string at EOF. */
  read(n?: number): Promise<string>;
  isatty(): boolean;
  fileno?(): number;
}

const STREAM_ERRNO: Record<string, [number, string]> = {
  EIO: [5, "Input/output error"],
  ENOSPC: [28, "No space left on device"],
  EFBIG: [27, "File too large"],
  EDQUOT: [122, "Disk quota exceeded"],
  EROFS: [30, "Read-only file system"],
  ENOMEM: [12, "Cannot allocate memory"],
};

/** Write failures that leave the stream unusable (what Python reports as `OSError` from `flush()`); sticky per stream. */
const streamFailures = new Map<string, Error & { code?: string }>();

function sleepBriefly(): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
  } catch {
    /* no SharedArrayBuffer: spin */
  }
}

class ProcessOutput implements TextOutput {
  private failure: Error | null = null;

  constructor(
    private readonly stream: NodeJS.WriteStream,
    private readonly fd: number,
  ) {
    stream.on("error", (e: Error & { code?: string }) => this.recordFailure(e));
  }

  private recordFailure(e: Error & { code?: string }): Error | null {
    const code = e.code ?? "";
    if (!(code in STREAM_ERRNO)) return null;
    if (!this.failure) {
      this.failure = e;
      streamFailures.set(this.fd === 2 ? "<stderr>" : "<stdout>", e);
    }
    return this.failure;
  }

  write(text: string): void {
    if (!text) return;
    if (this.failure) throw this.failure;
    try {
      if (this.stream.isTTY || this.stream.writableLength > 0 || this.stream.destroyed) this.stream.write(text);
      else this.writeFd(Buffer.from(text, "utf8"));
    } catch (e) {
      const failure = this.recordFailure(e as Error & { code?: string });
      if (failure) throw failure;
      /* closed pipe: Python would raise BrokenPipeError which Click turns into a quiet exit */
    }
  }

  private writeFd(buf: Buffer): void {
    let off = 0;
    while (off < buf.length) {
      try {
        off += fs.writeSync(this.fd, buf, off, buf.length - off);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EAGAIN") {
          sleepBriefly();
          continue;
        }
        throw e;
      }
    }
  }

  flush(): void {}

  isatty(): boolean {
    return Boolean(this.stream.isTTY);
  }

  getWindowSize(): [number, number] | null {
    if (!this.stream.isTTY) return null;
    const s = this.stream as NodeJS.WriteStream & { getWindowSize?: () => [number, number] };
    try {
      const size = s.getWindowSize?.();
      return size ?? null;
    } catch {
      return null;
    }
  }

  fileno(): number {
    return this.fd;
  }
}

/** Stdin reader that supports `readLine` / `read` from the real process stdin. */
class ProcessInput implements TextInput {
  private buffer = "";
  private ended = false;
  private waiting: Array<() => void> = [];
  private attached = false;

  private attach(): void {
    if (this.attached) return;
    this.attached = true;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.wake();
    });
    process.stdin.on("end", () => {
      this.ended = true;
      this.wake();
    });
    process.stdin.on("error", () => {
      this.ended = true;
      this.wake();
    });
  }

  private wake(): void {
    const w = this.waiting;
    this.waiting = [];
    for (const fn of w) fn();
  }

  private waitForData(): Promise<void> {
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      process.stdin.resume();
    });
  }

  async readLine(): Promise<string | null> {
    this.attach();
    for (;;) {
      const idx = this.buffer.indexOf("\n");
      if (idx >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        this.pause();
        return line.endsWith("\r") ? line.slice(0, -1) : line;
      }
      if (this.ended) {
        if (this.buffer.length) {
          const rest = this.buffer;
          this.buffer = "";
          return rest;
        }
        return null;
      }
      await this.waitForData();
    }
  }

  async read(n = -1): Promise<string> {
    this.attach();
    for (;;) {
      if (n >= 0 && this.buffer.length >= n) {
        const out = this.buffer.slice(0, n);
        this.buffer = this.buffer.slice(n);
        this.pause();
        return out;
      }
      if (this.ended) {
        const out = n >= 0 ? this.buffer.slice(0, n) : this.buffer;
        this.buffer = n >= 0 ? this.buffer.slice(n) : "";
        return out;
      }
      await this.waitForData();
    }
  }

  private pause(): void {
    if (!this.waiting.length) process.stdin.pause();
  }

  isatty(): boolean {
    return Boolean(process.stdin.isTTY);
  }

  fileno(): number {
    return 0;
  }
}

/** The mutable "sys module": replace `sys.stdout` etc. to redirect (what `CliRunner` does). */
export const sys: {
  stdout: TextOutput;
  stderr: TextOutput;
  stdin: TextInput;
} = {
  stdout: new ProcessOutput(process.stdout, 1),
  stderr: new ProcessOutput(process.stderr, 2),
  stdin: new ProcessInput(),
};

/** The original process streams (Python's `sys.__stdout__` & co). */
export const realStreams: { stdout: TextOutput; stderr: TextOutput; stdin: TextInput } = {
  stdout: sys.stdout,
  stderr: sys.stderr,
  stdin: sys.stdin,
};

/** `stream.isatty()` that never throws. */
export function isatty(stream: { isatty?: () => boolean } | null | undefined): boolean {
  try {
    return Boolean(stream && typeof stream.isatty === "function" && stream.isatty());
  } catch {
    return false;
  }
}

/**
 * `shutil.get_terminal_size()`: `COLUMNS` / `LINES` environment first, then the real stdout device, then the
 * `(80, 24)` fallback.
 */
export function getTerminalSize(fallback: [number, number] = [80, 24]): { columns: number; lines: number } {
  let columns = 0;
  let lines = 0;
  try {
    columns = Number.parseInt(process.env.COLUMNS ?? "", 10) || 0;
  } catch {
    columns = 0;
  }
  try {
    lines = Number.parseInt(process.env.LINES ?? "", 10) || 0;
  } catch {
    lines = 0;
  }
  if (columns <= 0 || lines <= 0) {
    let size: [number, number] | null = null;
    try {
      size = realStreams.stdout.getWindowSize?.() ?? null;
    } catch {
      size = null;
    }
    if (size) {
      if (columns <= 0) columns = size[0];
      if (lines <= 0) lines = size[1];
    }
  }
  if (columns <= 0) columns = fallback[0];
  if (lines <= 0) lines = fallback[1];
  return { columns, lines };
}

/**
 * Python flushes `sys.stdout` / `sys.stderr` once more at interpreter shutdown; when an earlier flush already failed
 * (disk full, ...) that final flush fails again: `Exception ignored in: ...` on stderr and exit status 120.
 * Returns the exit status to use instead of *code* (unchanged when every write succeeded).
 */
export function finalizeStreams(code: number): number {
  if (streamFailures.size === 0) return code;
  for (const [name, e] of streamFailures) {
    const [errno, strerror] = STREAM_ERRNO[e.code ?? ""] ?? [0, e.message];
    writeFdSync(
      2,
      `Exception ignored in: <_io.TextIOWrapper name='${name}' mode='w' encoding='utf-8'>\nOSError: [Errno ${errno}] ${strerror}\n`,
    );
  }
  return 120;
}

/** Synchronously flush the real process streams (used right before `process.exit`). */
export async function drainRealStreams(): Promise<void> {
  await Promise.all(
    [process.stdout, process.stderr].map(
      (s) =>
        new Promise<void>((resolve) => {
          try {
            if (s.writableLength === 0) resolve();
            else s.write("", () => resolve());
          } catch {
            resolve();
          }
        }),
    ),
  );
}

/** Write directly to a file descriptor, ignoring errors (EPIPE etc.). */
export function writeFdSync(fd: number, text: string): void {
  try {
    fs.writeSync(fd, text);
  } catch {
    /* ignore */
  }
}

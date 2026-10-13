/** Exit and error types shared by the command modules and the command runner (`kit.ts`). */

import { echo, sys, type TextOutput } from "./io.js";

/** `process.exit` stand-in: thrown by {@link sysExit}; the runner and the test runner turn it into an exit code. */
export class SystemExit extends Error {
  readonly code: number | string | null;
  constructor(code: number | string | null = null) {
    super(`SystemExit: ${String(code)}`);
    this.name = "SystemExit";
    this.code = code;
  }
}

export function sysExit(code: number | string | null = null): never {
  throw new SystemExit(code);
}

/** Ctrl+C. */
export class KeyboardInterrupt extends Error {
  constructor() {
    super("KeyboardInterrupt");
    this.name = "KeyboardInterrupt";
  }
}

/** stdin closed while a prompt was waiting. */
export class EOFError extends Error {
  constructor(message = "EOF when reading a line") {
    super(message);
    this.name = "EOFError";
  }
}

/** Where a usage error happened: enough to print the usage line and the `-h` hint. */
export interface UsageContext {
  usage(): string;
  readonly commandPath: string;
}

/** A failure to show as `Error: <message>` on stderr; the process exits with {@link CliError.exit_code} (1). */
export class CliError extends Error {
  static exit_code = 1;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }

  get exit_code(): number {
    return (this.constructor as typeof CliError).exit_code;
  }

  formatMessage(): string {
    return this.message;
  }

  show(file: TextOutput | null = null): void {
    echo(`Error: ${this.formatMessage()}`, { file: file ?? sys.stderr });
  }
}

/** Bad command line: prints the usage line and a `-h` hint before the message, exits with code 2. */
export class UsageError extends CliError {
  static override exit_code = 2;
  readonly ctx: UsageContext | null;

  constructor(message: string, ctx: UsageContext | null = null) {
    super(message);
    this.ctx = ctx;
  }

  override show(file: TextOutput | null = null): void {
    const out = file ?? sys.stderr;
    if (this.ctx !== null) echo(`${this.ctx.usage()}\nTry '${this.ctx.commandPath} -h' for help.\n`, { file: out });
    echo(`Error: ${this.formatMessage()}`, { file: out });
  }
}

/** The user declined or interrupted (prints `Aborted!`, exit 1). */
export class Abort extends Error {
  constructor() {
    super("Abort");
    this.name = "Abort";
  }
}

/** Leave the command with `exit_code` without printing anything. */
export class Exit extends Error {
  readonly exit_code: number;
  constructor(code = 0) {
    super(`Exit: ${code}`);
    this.name = "Exit";
    this.exit_code = code;
  }
}

/**
 * Port of the interactive part of `click/termui.py` (Click 8.5): `prompt` and `confirm`.
 *
 * `visible_prompt_func` / `hidden_prompt_func` are mutable seams (`termui.visible_prompt_func = ...`): `CliRunner`
 * replaces them so tests can script `input=` exactly like the Python runner does.
 */

import { Abort, UsageError } from "./exceptions.js";
import { stripAnsi } from "./formatting.js";
import { resolveColorDefault } from "./globals.js";
import { sys } from "./io.js";
import { pyStr, pyStrRepr } from "./py.js";
import { Choice, convertType } from "./types.js";
import { EOFError, KeyboardInterrupt, echo, shouldStripAnsi } from "./utils.js";

type PromptFunc = (prompt: string) => Promise<string>;

/**
 * Python raises `KeyboardInterrupt` inside a blocking `input()` when SIGINT arrives. While `work` is pending the other
 * SIGINT listeners (the process-wide "Aborted!" handler of the executable) are parked and a SIGINT rejects with
 * {@link KeyboardInterrupt} instead, so `click.prompt` / `click.confirm` turn it into `Abort` like Click does.
 */
function raceSigint<T>(work: Promise<T>): Promise<T> {
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

/** Python `input(prompt)`: writes the prompt to `sys.stdout`, reads one line from `sys.stdin`. */
async function builtinInput(prompt: string): Promise<string> {
  sys.stdout.write(prompt);
  sys.stdout.flush();
  const line = await raceSigint(sys.stdin.readLine());
  if (line === null) throw new EOFError();
  return line;
}

/** `getpass.getpass(prompt)`: reads without echo on a real terminal, otherwise falls back to a plain line read. */
async function builtinGetpass(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (stdin.isTTY && typeof stdin.setRawMode === "function" && sys.stdin.isatty()) {
    return await new Promise<string>((resolve, reject) => {
      sys.stderr.write(prompt);
      let buf = "";
      const onData = (chunk: Buffer): void => {
        for (const ch of chunk.toString("utf8")) {
          if (ch === "\r" || ch === "\n") {
            cleanup();
            sys.stderr.write("\n");
            resolve(buf);
            return;
          }
          if (ch === "\x03") {
            cleanup();
            sys.stderr.write("\n");
            reject(new KeyboardInterrupt());
            return;
          }
          if (ch === "\x04") {
            if (buf.length === 0) {
              cleanup();
              sys.stderr.write("\n");
              reject(new EOFError());
              return;
            }
            continue;
          }
          if (ch === "\x7f" || ch === "\b") {
            buf = Array.from(buf).slice(0, -1).join("");
            continue;
          }
          buf += ch;
        }
      };
      const cleanup = (): void => {
        stdin.off("data", onData);
        stdin.setRawMode(false);
        stdin.pause();
      };
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onData);
    });
  }
  sys.stderr.write("Warning: Password input may be echoed.\n");
  sys.stderr.write(prompt);
  sys.stderr.flush();
  const line = await sys.stdin.readLine();
  if (line === null) throw new EOFError();
  return line;
}

/** Mutable seams (assigned by `CliRunner`). */
export const termui: {
  visible_prompt_func: PromptFunc;
  hidden_prompt_func: PromptFunc;
} = {
  visible_prompt_func: builtinInput,
  hidden_prompt_func: builtinGetpass,
};

const HIDDEN_INPUT_MASK = "'***'";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `_mask_hidden_input`. */
export function maskHiddenInput(message: string, value: string): string {
  message = message.split(pyStrRepr(value)).join(HIDDEN_INPUT_MASK);
  if (value) {
    message = message.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(value)}(?![\\p{L}\\p{N}_])`, "gu"), HIDDEN_INPUT_MASK);
  }
  return message;
}

/** `_readline_prompt`. */
async function readlinePrompt(func: PromptFunc, text: string, err: boolean): Promise<string> {
  const stream = err ? sys.stderr : sys.stdout;
  if (shouldStripAnsi(stream, resolveColorDefault())) text = stripAnsi(text);
  if (err) {
    const saved = sys.stdout;
    sys.stdout = sys.stderr;
    try {
      return await func(text);
    } finally {
      sys.stdout = saved;
    }
  }
  return await func(text);
}

/** `_build_prompt`. */
export function buildPrompt(
  text: string,
  suffix: string,
  showDefault: boolean | string = false,
  deflt: unknown = null,
  showChoices = true,
  type: unknown = null,
): string {
  let prompt = text;
  if (type !== null && showChoices && type instanceof Choice) {
    prompt += ` (${type.choices.map((c) => pyStr(c)).join(", ")})`;
  }
  let defaultPreview = "";
  if (showDefault) {
    if (typeof showDefault === "string") defaultPreview = ` [(${showDefault})]`;
    else if (deflt !== null && deflt !== undefined) defaultPreview = ` [${pyStr(deflt)}]`;
  }
  return `${prompt}${defaultPreview}${suffix}`;
}

export interface PromptOptions {
  default?: unknown;
  hide_input?: boolean;
  confirmation_prompt?: boolean | string;
  type?: unknown;
  value_proc?: ((value: string) => unknown | Promise<unknown>) | null;
  prompt_suffix?: string;
  show_default?: boolean | string;
  err?: boolean;
  show_choices?: boolean;
}

/** `click.prompt(text, default=None, hide_input=False, ...)`. */
export async function prompt(text: string, opts: PromptOptions = {}): Promise<any> {
  const {
    default: deflt = null,
    hide_input: hideInput = false,
    type = null,
    prompt_suffix: promptSuffix = ": ",
    show_default: showDefault = true,
    err = false,
    show_choices: showChoices = true,
  } = opts;
  let confirmationPrompt: boolean | string = opts.confirmation_prompt ?? false;
  let valueProc = opts.value_proc ?? null;

  const promptFunc = async (t: string): Promise<string> => {
    const f = hideInput ? termui.hidden_prompt_func : termui.visible_prompt_func;
    try {
      return await readlinePrompt(f, t, err);
    } catch (e) {
      if (e instanceof KeyboardInterrupt || e instanceof EOFError) {
        if (hideInput) echo(null, { err });
        throw new Abort();
      }
      throw e;
    }
  };

  if (valueProc === null) {
    const converter = convertType(type, deflt);
    valueProc = (v: string) => converter.call(v, null, null);
  }

  const promptText = buildPrompt(text, promptSuffix, showDefault, deflt, showChoices, type);

  if (confirmationPrompt) {
    if (confirmationPrompt === true) confirmationPrompt = "Repeat for confirmation";
    confirmationPrompt = buildPrompt(confirmationPrompt, promptSuffix);
  }

  for (;;) {
    let value: string;
    for (;;) {
      value = await promptFunc(promptText);
      if (value) break;
      if (deflt !== null && deflt !== undefined) {
        value = deflt as string;
        break;
      }
    }
    let result: unknown;
    try {
      result = await valueProc(value);
    } catch (e) {
      if (e instanceof UsageError) {
        const message = hideInput ? maskHiddenInput(e.message, value) : e.message;
        echo(`Error: ${message}`, { err });
        continue;
      }
      throw e;
    }
    if (!confirmationPrompt) return result;
    let value2: string;
    for (;;) {
      value2 = await promptFunc(confirmationPrompt as string);
      const isEmpty = !value && !value2;
      if (value2 || isEmpty) break;
    }
    if (value === value2) return result;
    echo("Error: The two entered values do not match.", { err });
  }
}

export interface ConfirmOptions {
  default?: boolean | null;
  abort?: boolean;
  prompt_suffix?: string;
  show_default?: boolean;
  err?: boolean;
}

/** `click.confirm(text, default=False, abort=False, prompt_suffix=": ", show_default=True, err=False)`. */
export async function confirm(text: string, opts: ConfirmOptions = {}): Promise<boolean> {
  const { default: deflt = false, abort = false, prompt_suffix: promptSuffix = ": ", show_default: showDefault = true, err = false } = opts;
  const promptText = buildPrompt(text, promptSuffix, showDefault, deflt === null ? "y/n" : deflt ? "Y/n" : "y/N");
  let rv: boolean;
  for (;;) {
    let value: string;
    try {
      value = (await readlinePrompt(termui.visible_prompt_func, promptText, err)).toLowerCase().trim();
    } catch (e) {
      if (e instanceof KeyboardInterrupt || e instanceof EOFError) throw new Abort();
      throw e;
    }
    if (value === "y" || value === "yes") rv = true;
    else if (value === "n" || value === "no") rv = false;
    else if (deflt !== null && value === "") rv = deflt;
    else {
      echo("Error: invalid input", { err });
      continue;
    }
    break;
  }
  if (abort && !rv) throw new Abort();
  return rv;
}

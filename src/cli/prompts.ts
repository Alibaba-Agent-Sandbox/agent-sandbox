/**
 * Interactive questions. On a real terminal they use `@inquirer/prompts`; with piped or scripted input (or a swapped
 * `sys.stdin`) they print the question and read one line, so `abx ... < answers.txt` and the test runner both work.
 */

import { Abort, EOFError, KeyboardInterrupt } from "./errors.js";
import { echo, realStreams, sys } from "./io.js";
import { ParamError, type ParamType } from "./types.js";
import { pyStr } from "../utils/_py.js";

type PromptFunc = (prompt: string) => Promise<string>;

/** Patch points: the test runner replaces them to script `input=`. */
export const promptSeams: { visible: PromptFunc; hidden: PromptFunc } = {
  visible: async (prompt) => {
    sys.stdout.write(prompt);
    sys.stdout.flush();
    const line = await sys.stdin.readLine();
    if (line === null) throw new EOFError();
    return line;
  },
  hidden: async (prompt) => {
    sys.stderr.write("Warning: Password input may be echoed.\n");
    sys.stderr.write(prompt);
    sys.stderr.flush();
    const line = await sys.stdin.readLine();
    if (line === null) throw new EOFError();
    return line;
  },
};

const onRealTerminal = (): boolean => sys.stdin === realStreams.stdin && Boolean(process.stdin.isTTY);

/** Run an inquirer prompt, mapping Ctrl+C / closed input to {@link Abort}. */
async function inquire<T>(ask: (output: NodeJS.WritableStream) => Promise<T>, err: boolean): Promise<T> {
  try {
    return await ask(err ? process.stderr : process.stdout);
  } catch (e) {
    if (e instanceof Error && (e.name === "ExitPromptError" || e.name === "AbortPromptError")) throw new Abort();
    throw e;
  }
}

async function readAnswer(text: string, hidden: boolean, err: boolean, deflt: string | null): Promise<string> {
  if (onRealTerminal()) {
    const { input, password } = await import("@inquirer/prompts");
    const message = text.replace(/:\s*$/, "");
    if (hidden) return inquire((output) => password({ message, mask: true }, { output }), err);
    return inquire((output) => input({ message, ...(deflt === null ? {} : { default: deflt }) }, { output }), err);
  }
  const ask = hidden ? promptSeams.hidden : promptSeams.visible;
  const stream = err ? sys.stderr : sys.stdout;
  const saved = sys.stdout;
  if (err) sys.stdout = stream;
  try {
    return await ask(text);
  } catch (e) {
    if (e instanceof KeyboardInterrupt || e instanceof EOFError) {
      if (hidden) echo(null, { err });
      throw new Abort();
    }
    throw e;
  } finally {
    sys.stdout = saved;
  }
}

export interface PromptOptions {
  default?: unknown;
  hide_input?: boolean;
  type?: ParamType | null;
  show_default?: boolean;
  err?: boolean;
}

/** Ask for a line of text (converted with `type`); an empty answer takes `default`, and without one the question repeats. */
// The converted value's type depends on `opts.type` (string, int, a Choice, ...).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function prompt(text: string, opts: PromptOptions = {}): Promise<any> {
  const { default: deflt = null, hide_input: hideInput = false, type = null, show_default: showDefault = true, err = false } = opts;
  const withDefault = showDefault && deflt !== null && deflt !== undefined ? ` [${pyStr(deflt)}]` : "";
  const line = `${text}${withDefault}: `;
  for (;;) {
    let value = await readAnswer(line, hideInput, err, deflt === null || deflt === undefined ? null : pyStr(deflt));
    if (!value) {
      if (deflt === null || deflt === undefined) continue;
      value = pyStr(deflt);
    }
    if (type === null) return value;
    try {
      return type.convert(value);
    } catch (e) {
      if (!(e instanceof ParamError)) throw e;
      echo(`Error: ${e.message}`, { err });
    }
  }
}

export interface ConfirmOptions {
  default?: boolean | null;
  abort?: boolean;
  err?: boolean;
}

/** Ask a yes/no question; `abort` throws {@link Abort} on "no". */
export async function confirm(text: string, opts: ConfirmOptions = {}): Promise<boolean> {
  const { default: deflt = false, abort = false, err = false } = opts;
  let answer: boolean;
  if (onRealTerminal()) {
    const { confirm: ask } = await import("@inquirer/prompts");
    answer = await inquire((output) => ask({ message: text, default: deflt ?? undefined }, { output }), err);
  } else {
    const hint = deflt === null ? "y/n" : deflt ? "Y/n" : "y/N";
    for (;;) {
      const value = (await readAnswer(`${text} [${hint}]: `, false, err, null)).toLowerCase().trim();
      if (value === "y" || value === "yes") answer = true;
      else if (value === "n" || value === "no") answer = false;
      else if (deflt !== null && value === "") answer = deflt;
      else {
        echo("Error: invalid input", { err });
        continue;
      }
      break;
    }
  }
  if (abort && !answer) throw new Abort();
  return answer;
}

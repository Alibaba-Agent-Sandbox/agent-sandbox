/** One policy for human configuration input. Protocol servers must never call interactive setup. */
import type { Context } from "./kit.js";
import { getCurrentContext } from "./kit.js";
import { sys } from "./io.js";
import { isCiEnv } from "./output.js";

interface InputStreams {
  stdin: { isatty(): boolean };
  stdout?: { isatty(): boolean };
  stderr?: { isatty(): boolean };
}

/** Allow input only in an ordinary terminal, preserving existing automation and output contracts. */
export function canPrompt(ctx?: Context, yes = false, streams?: InputStreams): boolean {
  if (yes || isCiEnv()) return false;
  const current = ctx ?? getCurrentContext(true) ?? undefined;
  const options = current?.obj ?? {};
  if (options["json"] || options["ci"] || options["quiet"] || options["protocol"]) return false;
  try {
    return Boolean((streams?.stdin ?? sys.stdin).isatty() && (streams?.stdout ?? sys.stdout).isatty() && (streams?.stderr ?? sys.stderr).isatty());
  } catch { return false; }
}

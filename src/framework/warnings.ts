/** Minimal `warnings.warn`: developer-facing mistakes (duplicate option names, ...) are printed once to stderr. */

import { sys } from "./io.js";

const seen = new Set<string>();

export function warn(message: string, category = "UserWarning"): void {
  const key = `${category}:${message}`;
  if (seen.has(key)) return;
  seen.add(key);
  sys.stderr.write(`${category}: ${message}\n`);
}

/** Forget what has been reported (test helper). */
export function resetWarnings(): void {
  seen.clear();
}

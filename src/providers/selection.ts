/**
 * Per-invocation provider selection made on the command line: the global `--provider ID` and repeatable
 * `--opt KEY=VALUE`. The API layer (`Sandbox.create/connect/list/killById`) uses it as the default when a caller does not
 * pass `provider` / `provider_options` explicitly, so every command picks it up without per-command plumbing.
 */

import { ProviderConfigError } from "./errors.js";

interface Selection {
  provider: string | null;
  options: Record<string, string>;
}

const selection: Selection = { provider: null, options: {} };

export function setCliProvider(providerId: string | null): void {
  selection.provider = providerId && providerId.trim() ? providerId.trim() : null;
}

export function cliProvider(): string | null {
  return selection.provider;
}

/** Parse and store `KEY=VALUE` pairs (bad syntax is `E8002`, exit 2). */
export function addCliOptions(pairs: readonly string[]): void {
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    const key = idx > 0 ? pair.slice(0, idx).trim() : "";
    if (!key) {
      throw new ProviderConfigError(`Invalid --opt '${pair}': expected KEY=VALUE.`, {
        suggestion: "Example: --opt region=cn-shanghai (see 'ebx provider info ID' for the options).",
      });
    }
    selection.options[key] = pair.slice(idx + 1);
  }
}

export function cliOptions(): Record<string, string> {
  return { ...selection.options };
}

export function resetCliSelection(): void {
  selection.provider = null;
  selection.options = {};
}

/**
 * Pull `--provider ID` / `--provider=ID` / `--opt K=V` / `--opt=K=V` out of `args` (any position before a `--`
 * terminator) and return the remaining arguments. Not applied to the `provider` command group, whose subcommands
 * (`provider test`) own an `--opt` of their own.
 */
export function extractProviderFlags(args: readonly string[]): { args: string[]; provider: string | null; options: string[] } {
  const out: string[] = [];
  const options: string[] = [];
  let provider: string | null = null;
  let firstWord: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--") {
      out.push(...args.slice(i));
      break;
    }
    if (firstWord === null && !a.startsWith("-")) firstWord = a;
    if (firstWord === "provider") {
      out.push(...args.slice(i));
      break;
    }
    if (a === "--provider" || a === "--opt") {
      const next = args[i + 1];
      if (next === undefined) {
        out.push(a);
        continue;
      }
      if (a === "--provider") provider = next;
      else options.push(next);
      i++;
      continue;
    }
    if (a.startsWith("--provider=")) {
      provider = a.slice("--provider=".length);
      continue;
    }
    if (a.startsWith("--opt=")) {
      options.push(a.slice("--opt=".length));
      continue;
    }
    out.push(a);
  }
  return { args: out, provider, options };
}

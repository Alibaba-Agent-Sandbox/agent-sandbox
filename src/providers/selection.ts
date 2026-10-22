/**
 * Per-invocation provider selection made on the command line: the global `--provider ID` and repeatable
 * `--opt KEY=VALUE`. The API layer (`Sandbox.create/connect/list/killById`) uses it as the default when a caller does not
 * pass `provider` / `provider_options` explicitly, so every command picks it up without per-command plumbing.
 */

import { ProviderConfigError } from "../models/provider_errors.js";

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
        suggestion: "Example: --opt region=cn-shanghai (see 'abx provider info ID' for the options).",
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
 * terminator, or the sandbox ID of exec) and return the remaining arguments. Within the `provider` group,
 * only --provider is global; its subcommands (`provider test`, `provider run`) own --opt.
 */
export function extractProviderFlags(args: readonly string[]): { args: string[]; provider: string | null; options: string[] } {
  const out: string[] = [];
  const options: string[] = [];
  let provider: string | null = null;
  let firstWord: string | null = null;
  let execResourceExpected = false;
  let execOptionValueExpected = false;
  const execValuedOptions = new Set(["--cwd", "-c", "--env", "-e", "--timeout", "-t", "--user", "-u"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--") {
      out.push(...args.slice(i));
      break;
    }
    if (firstWord === null && a === "--log-level" && args[i + 1] !== undefined) {
      out.push(a, args[++i]!);
      continue;
    }
    if (firstWord === null && !a.startsWith("-")) firstWord = a;
    if (firstWord === "provider" && a !== "--provider" && !a.startsWith("--provider=")) {
      out.push(a);
      continue;
    }
    if (execOptionValueExpected) {
      out.push(a);
      execOptionValueExpected = false;
      continue;
    }
    if (execResourceExpected && execValuedOptions.has(a)) {
      out.push(a);
      execOptionValueExpected = true;
      continue;
    }
    if (execResourceExpected && !a.startsWith("-")) {
      // Provider selection ends at the sandbox ID. Remote agent flags cannot select a backend.
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
    const sandboxGroup = firstWord === "sandbox" || firstWord === "sbx";
    if ((a === "exec" && firstWord === "exec") ||
      (sandboxGroup && (a === "exec" || a === "ex") && out.at(-2) === firstWord)) {
      execResourceExpected = true;
    }
  }
  return { args: out, provider, options };
}

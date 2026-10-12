/**
 * Shared coding-agent helpers for the `create` and `deploy` commands (port of `cli/commands/_coding_agent.py`).
 *
 * Both `ebx create "<description>"` and the agent-driven `ebx deploy` route drive the same pluggable backend
 * (`agent/coding_agent.ts`): they must locate (or install) the agent executable and resolve model credentials
 * identically -- same prompts, same non-interactive behaviour, same error codes, same secret handling. This internal
 * module is the single home of that front half of the flow; the command modules keep the orchestration and the
 * user-facing composition around it.
 *
 * Deliberate constraints (inherited from the sandbox command these helpers were extracted from):
 *
 * - the backend boundary is imported through `agent/coding_agent.ts`, whose adapters import their implementation
 *   modules lazily, so tests keep intercepting `qwen_code.seams.*`, `codegen.seams.*` and `clarify.seams.*`;
 * - `config_cmd` imports stay function-local -- this module must never import a sibling command module at import
 *   time, or the `cli.commands` import graph grows a cycle;
 * - every message is byte-identical to the previous sandbox-local helpers, so existing CLI goldens and assertions stay
 *   valid;
 * - secrets are never echoed: the interactive key prompt is hidden, only the config key name is reported (never the
 *   key itself), and the env variable name comes from the backend.
 *
 * Nothing here is registered as a command; only the command implementations that share these helpers import this
 * module.
 *
 * Port notes: Python's module-level `sys` (`monkeypatch.setattr("...._coding_agent.sys", _FakeSys())`) is the
 * {@link codingAgentSeams} object -- `stdinIsatty` is the single place the TTY decision is made, and
 * `resolveBackend` stands in for `easy_sandbox.agent.coding_agent.resolve_coding_agent_backend` (patched by the
 * Python tests).
 */

import { type Context, confirm, prompt, sys } from "../../framework/index.js";
import {
  type CodingAgentBackend,
  type CodingAgentCredentials,
  resolveCodingAgentBackend as resolveBackendImpl,
} from "../../agent/coding_agent.js";
import { pyStrip } from "../../utils/_pyformat.js";
import { getOutput, type OutputManager } from "../output.js";

export const __all__ = ["ensureCodingAgentBinary", "resolveCodingAgentBackend", "resolveCodingAgentCredentials"] as const;

/** Patch points (the TypeScript counterparts of the module attributes the Python tests monkeypatch). */
export const codingAgentSeams: {
  /** `sys.stdin.isatty()` of the Python module. */
  stdinIsatty: () => boolean;
  /** `easy_sandbox.agent.coding_agent.resolve_coding_agent_backend`. */
  resolveBackend: (name?: string) => CodingAgentBackend;
} = {
  stdinIsatty: () => sys.stdin.isatty(),
  resolveBackend: (...args) => (args.length === 0 ? resolveBackendImpl() : resolveBackendImpl(args[0])),
};

/** Backend-provided Quick Setup for the AI template path; `reason` is `"not-installed"` or `"no-credentials"`. */
async function _printQuickSetup(out: OutputManager, opts: { backend: CodingAgentBackend; reason: string }): Promise<void> {
  out.info("");
  for (const line of await opts.backend.quickSetupLines({ reason: opts.reason })) out.info(line);
}

/**
 * Instantiate the coding-agent backend selected by `name`.
 *
 * `null`/omitted (the default) selects the default backend -- Qwen Code today. Unknown names throw `ValueError`:
 * nothing silently falls back to a different agent than the caller asked for.
 */
export function resolveCodingAgentBackend(name: string | null = null): CodingAgentBackend {
  if (name === null) {
    // Preserve the original no-argument call shape, so tests that patch the resolver keep asserting
    // `resolveCodingAgentBackend()`.
    return codingAgentSeams.resolveBackend();
  }
  return codingAgentSeams.resolveBackend(name);
}

/**
 * Return a usable coding-agent executable, offering installation if missing.
 *
 * Interactive terminals are offered an automatic install of the official standalone build (SHA256-verified);
 * non-interactive shells without `--yes` get the Quick Setup and a hard error instead of a hang.
 *
 * @throws SandboxCreationError `backend.notInstalledError` when the binary is missing and cannot (or must not) be
 *   installed.
 */
export async function ensureCodingAgentBinary(ctx: Context, opts: { yes: boolean; backend: CodingAgentBackend }): Promise<string> {
  const { yes, backend } = opts;
  const binary = await backend.findBinary();
  if (binary !== null) return binary;

  const out = getOutput(ctx);
  const interactive = codingAgentSeams.stdinIsatty();
  out.warning(`${backend.displayName} CLI was not found on PATH or in ~/.ebx/bin.`);
  await _printQuickSetup(out, { backend, reason: "not-installed" });

  const notInstalled = backend.notInstalledError;
  if (!yes && !interactive) {
    throw new notInstalled(`${backend.displayName} CLI is required for AI template generation but is not installed.`, {
      suggestion:
        "Install it with the official command from Quick Setup above, then retry \u2014 " +
        "or use 'ebx create --template <name>' to skip AI generation.",
    });
  }
  if (interactive && !yes) {
    const proceed = await confirm(`Install the official ${backend.displayName} standalone build into ~/.ebx/bin now?`, { default: true });
    if (!proceed) {
      throw new notInstalled(`Declined to install ${backend.displayName}; AI template generation cannot continue.`, {
        suggestion: "Install it manually (see Quick Setup above) and retry, or use 'ebx create --template <name>'.",
      });
    }
  }
  const feed: string[] = [];
  const live: Array<((summary: string) => void) | null> = [null];

  const note = (message: string): void => {
    // Milestones only (mirror name, checksum, extract). Never the URL query, the archive bytes, or the credential env.
    const cleaned = pyStrip(message);
    if (!cleaned) return;
    const update = live[0] as ((summary: string) => void) | null;
    if (update === null) {
      if (out.verbose && !out.quiet && !out.jsonMode) out.info(cleaned);
      return;
    }
    feed.push(cleaned);
    feed.splice(0, Math.max(0, feed.length - 10));
    update(feed.join("\n"));
  };

  const installed = await out.activity(
    `Installing ${backend.displayName}`,
    async (update) => {
      live[0] = update;
      return backend.install({ onProgress: note });
    },
    { tick: true },
  );
  out.success(`Installed ${backend.displayName}: ${installed}`);
  return installed;
}

/**
 * Resolve coding-agent credentials, prompting once when allowed.
 *
 * Same order as `ebx config list`: a process environment variable (`EBX_LLM_API_KEY`, then vendor
 * `BAILIAN_CODING_PLAN_API_KEY` / `DASHSCOPE_API_KEY` / `OPENAI_API_KEY`, then a legacy `EBX_QWEN_CODE_API_KEY`) wins
 * over the value stored in ~/.ebx. Endpoint and model follow that same env-then-file order. Without `--yes` and on an
 * interactive terminal, one hidden prompt stores the entered key for future runs.
 *
 * @throws SandboxCreationError `backend.credentialError` when nothing usable is found (or the user declined /
 *   cancelled).
 */
export async function resolveCodingAgentCredentials(
  ctx: Context,
  opts: { yes: boolean; backend: CodingAgentBackend; model?: string | null },
): Promise<CodingAgentCredentials> {
  const { yes, backend } = opts;
  const configCmd = await import("./config_cmd.js");

  // Same resolution `ebx config list` uses. Process environment wins over ~/.ebx; endpoint and model follow llm_* and
  // fall back to a previously stored qwen_code_* value. Built-in defaults are left for the backend.
  const [storedKeyRaw] = await configCmd._effectiveValue("llm_api_key");
  const [baseUrl, baseSource] = await configCmd._effectiveValue(backend.baseUrlConfigKey);
  const [model, modelSource] = await configCmd._effectiveValue(backend.modelConfigKey);
  // Stored values are strings (or absent); the config module types them `unknown` because the TOML layer is untyped.
  const storedKey = storedKeyRaw as string | null | undefined;
  const storedBaseUrl = (baseSource === "default" ? null : baseUrl) as string | null | undefined;
  const explicitModel = opts.model != null && pyStrip(opts.model) !== "" ? pyStrip(opts.model) : null;
  const storedModel = (explicitModel ?? (modelSource === "default" ? null : model)) as string | null | undefined;

  try {
    return await backend.resolveCredentials({
      storedApiKey: storedKey,
      storedBaseUrl,
      storedModel,
    });
  } catch (exc) {
    if (!(exc instanceof backend.credentialError)) throw exc;
  }

  const out = getOutput(ctx);
  if (yes || !codingAgentSeams.stdinIsatty()) {
    throw new backend.credentialError(`${backend.displayName} is installed but no model credentials were found.`, {
      suggestion:
        `Store a key with 'ebx config set ${backend.configKey} <KEY>' (or export ` +
        "OPENAI_API_KEY / DASHSCOPE_API_KEY), then retry. Guided setup: " +
        "'ebx config init'.",
    });
  }
  await _printQuickSetup(out, { backend, reason: "no-credentials" });
  const key: string = await prompt(backend.credentialPrompt, { hide_input: true, default: "", show_default: false });
  if (!pyStrip(key)) {
    throw new backend.credentialError(`No ${backend.displayName} API key provided; AI template generation cannot continue.`, {
      suggestion:
        `Store one with 'ebx config set ${backend.configKey} <KEY>' and retry, ` + "or use 'ebx create --template <name>'.",
    });
  }
  await configCmd.writeEnvVar(backend.envVar, pyStrip(key));
  // Same migration as `ebx config set llm_api_key`: drop any legacy [transport] copy once the secure storage is
  // written.
  await configCmd._removeTomlKey("llm_api_key");
  out.success(`Stored ${backend.configKey} in ~/.ebx/.env`);
  return backend.resolveCredentials({
    storedApiKey: pyStrip(key),
    storedBaseUrl,
    storedModel,
  });
}

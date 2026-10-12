/**
 * Shared fixtures for CLI tests (port of `tests/test_cli/conftest.py` plus the per-file autouse fixtures the CLI tests
 * repeat: `_pristine_logging`, `_default_shortcuts_only`, pytest's `capsys`).
 *
 * Every helper that needs setup/teardown registers `beforeEach`/`afterEach` hooks when called at module level.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach } from "vitest";

import { _CORE_COMMANDS, _DEFAULT_SHORTCUTS, cli, mainSeams, type ShortcutConfigApi } from "../../src/cli/main.js";
import { outputSeams } from "../../src/cli/output.js";
import { sys } from "../../src/framework/io.js";
import type { TextOutput } from "../../src/framework/io.js";
import { _isConfigured, _setConfigured, logging } from "../../src/utils/logging.js";
import { CliRunner } from "../helpers/cliRunner.js";

/** `runner` fixture: a fresh Click-style CLI test runner. */
export function runner(): CliRunner {
  return new CliRunner();
}

/** A `stderr`/`stdout` stand-in (`io.StringIO` subclass) that optionally claims to be an interactive terminal. */
export class TTYBuffer implements TextOutput {
  private chunks: string[] = [];
  constructor(private readonly tty = true) {}

  write(text: string): void {
    this.chunks.push(text);
  }
  flush(): void {}
  isatty(): boolean {
    return this.tty;
  }
  getvalue(): string {
    return this.chunks.join("");
  }
  /** `truncate(0); seek(0)`. */
  reset(): void {
    this.chunks = [];
  }
}

export interface CapSys {
  /** `capsys.readouterr()`: everything written since the previous call, per stream. */
  readouterr(): { out: string; err: string };
}

/** pytest `capsys`: replaces the framework `sys.stdout` / `sys.stderr` for the duration of each test. */
export function useCapsys(): CapSys {
  let out = new TTYBuffer(false);
  let err = new TTYBuffer(false);
  let saved: { stdout: TextOutput; stderr: TextOutput } | null = null;
  beforeEach(() => {
    out = new TTYBuffer(false);
    err = new TTYBuffer(false);
    saved = { stdout: sys.stdout, stderr: sys.stderr };
    sys.stdout = out;
    sys.stderr = err;
  });
  afterEach(() => {
    if (saved) {
      sys.stdout = saved.stdout;
      sys.stderr = saved.stderr;
    }
  });
  return {
    readouterr() {
      const r = { out: out.getvalue(), err: err.getvalue() };
      out.reset();
      err.reset();
      return r;
    },
  };
}

/**
 * `_pristine_logging` autouse fixture: every test starts with an empty root / `easy_sandbox` handler list and a
 * not-yet-configured SDK logger; the saved state is restored afterwards.
 */
export function usePristineLogging(): void {
  let state: {
    rootHandlers: unknown[];
    packageHandlers: unknown[];
    packageLevel: number;
    configured: boolean;
    rootLevel: number;
  } | null = null;
  beforeEach(() => {
    const root = logging.getLogger();
    const pkg = logging.getLogger("easy_sandbox");
    state = {
      rootHandlers: [...root.handlers],
      packageHandlers: [...pkg.handlers],
      packageLevel: pkg.level,
      configured: _isConfigured(),
      rootLevel: root.level,
    };
    _setConfigured(false);
    root.handlers.length = 0;
    pkg.handlers.length = 0;
    pkg.setLevel(logging.NOTSET);
  });
  afterEach(() => {
    if (!state) return;
    const root = logging.getLogger();
    const pkg = logging.getLogger("easy_sandbox");
    root.handlers.length = 0;
    pkg.handlers.length = 0;
    pkg.setLevel(state.packageLevel);
    pkg.handlers.push(...(state.packageHandlers as typeof pkg.handlers));
    root.handlers.push(...(state.rootHandlers as typeof root.handlers));
    root.setLevel(state.rootLevel);
    _setConfigured(state.configured);
  });
}

/**
 * `_default_shortcuts_only` autouse fixture: pin the root CLI to the built-in default shortcuts (the real
 * `~/.ebx/config.toml` never leaks in); the previous merge result is restored afterwards.
 */
export function useDefaultShortcutsOnly(): void {
  let original = new Map<string, string>();
  let originalSeam: ShortcutConfigApi | null = null;
  beforeEach(async () => {
    await cli.whenReady();
    original = new Map(cli._lazy_subcommands);
    originalSeam = mainSeams.configCmd;
    mainSeams.configCmd = {
      loadShortcuts: () => ({ ..._DEFAULT_SHORTCUTS }),
      _configFileExists: () => true,
      _createDefaultConfig: () => undefined,
    };
    cli._lazy_subcommands = new Map(Object.entries(_CORE_COMMANDS));
    await cli._mergeUserShortcuts();
  });
  afterEach(() => {
    mainSeams.configCmd = originalSeam;
    cli._lazy_subcommands = original;
  });
}

/** `monkeypatch.setattr(output_mod, ...)`: snapshot the mutable `outputSeams` before each test and restore it after. */
export function useOutputSeams(): typeof outputSeams {
  let saved: typeof outputSeams | null = null;
  beforeEach(() => {
    saved = { ...outputSeams };
  });
  afterEach(() => {
    if (saved) Object.assign(outputSeams, saved);
  });
  return outputSeams;
}

// ---------------------------------------------------------------------------------------------------------------------
// Availability of the command modules written by the later builders
// ---------------------------------------------------------------------------------------------------------------------

/** Every module `main.ts` registers lazily; the root `--help` listing loads all of them. */
export const COMMAND_MODULES = ["sandbox", "config_cmd", "template", "mcp", "deploy", "sandbox_files", "sandbox_process", "sandbox_system"] as const;

/** `true` when `src/cli/commands/<name>.ts` exists (the module has been written). */
export function commandModuleExists(name: string): boolean {
  return fs.existsSync(fileURLToPath(new URL(`../../src/cli/commands/${name}.ts`, import.meta.url)));
}

/**
 * `true` when every command module exists. Tests marked `// BLOCKED-ON: cli/commands/*` use `it.skipIf(!ALL_COMMANDS)`
 * so they switch on by themselves as soon as the last module lands (no edit needed).
 */
export const ALL_COMMANDS: boolean = COMMAND_MODULES.every(commandModuleExists);

/**
 * End-to-end shortcut target hints through a real `ebx` process (port of
 * `tests/integration/test_shortcut_target_hint_e2e.py`).
 *
 * Each invocation is a new process with `HOME` pointed at a temporary directory, so `~/.ebx/config.toml` is read at
 * startup the same way a user shell does. The root command group loads `[shortcuts]` once; an in-process `CliRunner`
 * cannot observe an alias written after that group was built.
 *
 * Run with: npm run test:integration -- tests/integration/test_shortcut_target_hint_e2e.test.ts
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { ebx, ebxEnv, makeTempDir, shown } from "./_support/ebxProcess.js";

let tmp = "";
let ebx_home = "";

/**
 * Temporary `HOME` that the process must actually honour. `config set` writes `~/.ebx/config.toml`: if `HOME` were
 * ignored the command would edit the developer's real config, so the probe runs before any `ebx` invocation.
 */
beforeEach(() => {
  tmp = makeTempDir("ebx-shortcut-e2e-");
  ebx_home = path.join(tmp, "home");
  fs.mkdirSync(ebx_home);
  const probe = spawnSync(process.execPath, ["-e", "console.log(require('os').homedir())"], { cwd: ebx_home, env: ebxEnv(ebx_home), encoding: "utf8" });
  expect(probe.status, probe.stderr).toBe(0);
  expect(probe.stdout.trim()).toBe(ebx_home);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const TIMEOUT = 180_000;

it(
  "test_ebx_prefix_is_rejected_then_the_alias_runs",
  () => {
    // The reported first-use sequence, across process boundaries. "ebx template init" is refused with the command to
    // retry and is not stored. "template init" is stored. A new process then runs the alias as `template init`.
    // Clearing the alias removes it from the next process.
    const rejected = ebx(ebx_home, "config", "set", "shortcuts.aaaaa", "ebx template init");
    const rejected_text = shown(rejected);
    expect(rejected.status, rejected_text).toBe(2);
    expect(rejected_text).toContain("Invalid shortcut target: 'ebx template init'");
    expect(rejected_text).toContain('Drop the leading "ebx"');
    expect(rejected_text).toContain('Try: ebx config set shortcuts.aaaaa "template init"');
    expect(rejected_text).not.toContain("Available targets:");

    const config_path = path.join(ebx_home, ".ebx", "config.toml");
    expect(fs.statSync(config_path).isFile()).toBe(true);
    const stored = fs.readFileSync(config_path, "utf-8");
    expect(stored).not.toContain("aaaaa =");
    expect(stored).toContain('create = "sandbox create"');

    const upper = ebx(ebx_home, "config", "set", "shortcuts.aaaaa", "EBX template init");
    const upper_text = shown(upper);
    expect(upper.status, upper_text).toBe(2);
    expect(upper_text).toContain('Try: ebx config set shortcuts.aaaaa "template init"');

    const unknown = ebx(ebx_home, "config", "set", "shortcuts.aaaaa", "not-a-command");
    const unknown_text = shown(unknown);
    expect(unknown.status, unknown_text).toBe(2);
    expect(unknown_text).toContain('without the "ebx" prefix');
    expect(unknown_text).toContain("template: build, init, install, search");

    const accepted = ebx(ebx_home, "config", "set", "shortcuts.aaaaa", "template init");
    const accepted_text = shown(accepted);
    expect(accepted.status, accepted_text).toBe(0);
    expect(accepted_text).toContain("Set shortcut aaaaa = template init");
    expect(fs.readFileSync(config_path, "utf-8")).toContain('aaaaa = "template init"');

    const fetched = ebx(ebx_home, "config", "get", "shortcuts.aaaaa");
    expect(fetched.status, shown(fetched)).toBe(0);
    expect(fetched.stdout.trim()).toBe("template init");

    const via_alias = ebx(ebx_home, "aaaaa", "--list");
    const via_target = ebx(ebx_home, "template", "init", "--list");
    expect(via_alias.status, shown(via_alias)).toBe(0);
    expect(via_target.status, shown(via_target)).toBe(0);
    expect(via_alias.stdout).toBe(via_target.stdout);
    expect(via_alias.stdout).toContain("python");

    const removed = ebx(ebx_home, "config", "set", "shortcuts.aaaaa", "");
    expect(removed.status, shown(removed)).toBe(0);
    expect(shown(removed)).toContain("Removed shortcut 'aaaaa'");
    const gone = ebx(ebx_home, "aaaaa", "--list");
    const gone_text = shown(gone);
    expect(gone.status, gone_text).toBe(2);
    expect(gone_text).toContain("No such command 'aaaaa'");
  },
  TIMEOUT,
);

it(
  "test_stored_ebx_prefix_is_ignored_and_other_aliases_keep_working",
  () => {
    // A bad line already in the file is skipped; factory aliases still run. The documented recovery path is a hand edit
    // of ~/.ebx/config.toml, then a new process. One invalid alias must not disable `init`.
    const seeded = ebx(ebx_home, "config", "get", "shortcuts");
    expect(seeded.status, shown(seeded)).toBe(0);
    const config_path = path.join(ebx_home, ".ebx", "config.toml");
    fs.writeFileSync(config_path, fs.readFileSync(config_path, "utf-8") + 'aaaaa = "ebx template init"\n', "utf-8");

    const via_init = ebx(ebx_home, "init", "--list");
    const via_target = ebx(ebx_home, "template", "init", "--list");
    expect(via_init.status, shown(via_init)).toBe(0);
    expect(via_target.status, shown(via_target)).toBe(0);
    expect(via_init.stdout).toBe(via_target.stdout);
    expect(via_init.stdout).toContain("python");
    expect(via_init.stderr || "").toContain("Invalid shortcut ignored");
    expect(via_init.stderr || "").toContain('Drop the leading "ebx"');
    expect(via_init.stderr || "").toContain('Try: ebx config set shortcuts.aaaaa "template init"');

    const missing = ebx(ebx_home, "aaaaa", "--list");
    const missing_text = shown(missing);
    expect(missing.status, missing_text).toBe(2);
    expect(missing_text).toContain("No such command 'aaaaa'");
  },
  TIMEOUT,
);

it(
  "test_ebx_prefix_plus_unknown_path_lists_grouped_targets",
  () => {
    // `ebx` plus a path that is still unknown keeps the prefix rule and the list.
    const result = ebx(ebx_home, "config", "set", "shortcuts.aaaaa", "ebx not-a-command");
    const text = shown(result);
    expect(result.status, text).toBe(2);
    expect(text).toContain('Drop the leading "ebx"');
    expect(text).toContain('"not-a-command" is not a command path');
    expect(text).toContain("Available targets:");
    expect(text).toContain("template: build, init, install, search");
    const stored = fs.readFileSync(path.join(ebx_home, ".ebx", "config.toml"), "utf-8");
    expect(stored).not.toContain("aaaaa =");
  },
  TIMEOUT,
);

it(
  "test_config_set_help_states_the_prefix_rule",
  () => {
    // `ebx config set --help` is the description a first attempt can read.
    const result = ebx(ebx_home, "config", "set", "--help");
    const text = shown(result);
    expect(result.status, text).toBe(0);
    expect(text).toContain('without the "ebx" prefix');
    expect(text).toContain('"template init"');
    expect(text).toContain('"ebx template init"');
  },
  TIMEOUT,
);

it(
  "test_unknown_command_shows_a_prefix_free_shortcut_example",
  () => {
    // `ebx ccc` points at a shortcut target that does not start with `ebx`.
    const result = ebx(ebx_home, "ccc");
    const text = shown(result);
    expect(result.status, text).toBe(2);
    expect(text).toContain("No such command 'ccc'");
    expect(text).toContain('ebx config set shortcuts.NAME "template init"');
    expect(text).toContain("custom_commands");
    expect(text).toContain("ebx run COMMAND");
  },
  TIMEOUT,
);

it(
  "test_json_suggestion_names_the_corrected_command",
  () => {
    // --json returns the same correction without the text-mode indent.
    const result = ebx(ebx_home, "--json", "config", "set", "shortcuts.aaaaa", "ebx template init");
    const text = shown(result);
    expect(result.status, text).toBe(2);
    expect(text).toContain('"status": "error"');
    expect(text).toContain('Try: ebx config set shortcuts.aaaaa \\"template init\\"');
    expect(text).not.toContain("              Try:");
  },
  TIMEOUT,
);

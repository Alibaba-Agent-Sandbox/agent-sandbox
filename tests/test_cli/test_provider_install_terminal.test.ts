/** Real Git + CLI + terminal evidence for installation wait feedback. */
import "../_support/isolatedHome.js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { TERMINAL_DRIVER } from "../../scripts/terminal-driver.mjs";
import { gitCommitAll, initRepo, writePlugin } from "../_support/plugins.js";

const python = spawnSync("python3", ["-c", "import pty, fcntl, termios"], { encoding: "utf8" });
const terminalTest = it.skipIf(process.platform === "win32" || python.status !== 0);
const entry = fileURLToPath(new URL("../../src/bin/abx.ts", import.meta.url));
terminalTest("shows an elapsed Git stage before a slow real fetch completes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-install-terminal-"));
  try {
    const repo = writePlugin(path.join(root, "source"));
    initRepo(repo);
    gitCommitAll(repo);
    const gitPath = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
    expect(gitPath).not.toBe("");
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    // Delay the real fetch so an elapsed redraw must happen before success.
    fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh\nfor arg do\n  if [ "$arg" = fetch ]; then sleep 2; break; fi\ndone\nexec '${gitPath.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o700 });
    const result = spawnSync("python3", ["-c", TERMINAL_DRIVER, JSON.stringify({
      argv: [process.execPath, "--import", import.meta.resolve("tsx"), entry, "provider", "install", `file://${repo}`,
        "--allow-insecure-transport", "--allow-unpinned", "--yes", "--no-verify"],
      timeout: 25,
    })], { encoding: "utf8", cwd: root, timeout: 35000,
      env: { ...process.env, HOME: root, PATH: `${bin}:${process.env["PATH"]}`, TERM: "xterm-256color", CI: "", GITHUB_ACTIONS: "" } });
    expect(result.status, result.stderr).toBe(0);
    const terminal = JSON.parse(result.stdout) as { status: number; timed_out: boolean; stdout: string; stderr: string };
    expect(terminal.timed_out, terminal.stderr).toBe(false);
    expect(terminal.status, terminal.stderr).toBe(0);
    expect(terminal.stdout).toMatch(/^Installed provider 'demo-prov'/);
    expect(terminal.stdout).not.toContain("Fetching");
    expect(terminal.stderr).toMatch(/Fetching provider source with Git \(timeout: 120s\).*1s/);
    expect(terminal.stderr).toContain("Validating provider files");
    expect(terminal.stderr).not.toContain("Verifying provider handshake");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 40000);

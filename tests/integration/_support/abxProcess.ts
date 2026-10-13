/**
 * Helpers for the integration tests that run a REAL `abx` process (one fresh process per invocation, `HOME` pointed at
 * a temporary directory): the Node counterpart of `subprocess.run([sys.executable, "-c", "from ... import main; main()"])`.
 *
 * The binary under test is `ABX_BIN` when set (`"abx"`, `"/path/abx"` or `"node /path/dist/bin/abx.js"`), otherwise the
 * TypeScript sources through the local `tsx` loader.
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export const CI_ENV_VARS = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "JENKINS_URL", "TRAVIS", "CIRCLECI", "BITBUCKET_PIPELINES", "TF_BUILD", "CODEBUILD_BUILD_ID"];

/** Split `ABX_BIN` into `[cmd, ...args]` (quotes honoured). */
export function parseBin(spec: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(spec); m !== null; m = re.exec(spec)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/** `[cmd, ...args]` of the binary under test. */
export function abxBinary(): string[] {
  const spec = process.env["ABX_BIN"];
  if (spec) return parseBin(spec);
  const tsx = path.join(CLI_ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  return [tsx, path.join(CLI_ROOT, "src", "bin", "abx.ts")];
}

/** Environment for one `abx` process rooted at `home` (CI markers removed so the CLI keeps its human-readable mode). */
export function abxEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env["HOME"] = home;
  env["USERPROFILE"] = home;
  env["NO_COLOR"] = "1";
  env["TERM"] = "dumb";
  env["ABX_NO_KEYCHAIN"] = "1";
  for (const name of CI_ENV_VARS) delete env[name];
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

export type ProcessResult = SpawnSyncReturns<string>;

/** Run `abx <args>` in a fresh process whose home directory (and cwd) is `home`. */
export function abx(home: string, ...args: string[]): ProcessResult {
  const [cmd, ...pre] = abxBinary();
  return spawnSync(cmd as string, [...pre, ...args], { cwd: home, env: abxEnv(home), encoding: "utf8", timeout: 60_000 });
}

/** stdout + stderr of a finished process. */
export const shown = (result: ProcessResult): string => (result.stdout || "") + (result.stderr || "");

export function makeTempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

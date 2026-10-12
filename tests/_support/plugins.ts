/** Builders for throw-away provider plugin trees and git repositories (port of `test_providers/helpers.py`). */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PLUGINS = path.resolve(here, "..", "fixtures", "providers");
export const LOCAL_PROCESS = path.join(FIXTURE_PLUGINS, "local-process");
export const E2B_COMPATIBLE = path.join(FIXTURE_PLUGINS, "e2b-compatible");
export const OPENSANDBOX = path.resolve(here, "..", "..", "..", "python-sdk", "examples", "providers", "opensandbox");

/** Plugins declare `cli >=0.3`; the CLI package is still 0.2.x, so tests pass this host version explicitly. */
export const TEST_HOST_VERSION = "0.3.0";

const MANIFEST = (id: string, version: string, extra: string): string => `\
manifest_version = 1

[provider]
id = "${id}"
name = "${id}"
version = "${version}"

[compat]
requires = { cli = ">=0.3" }

[runtime]
kind = "exec"
command = ["python3", "./provider.py"]

[features]
supported = ["sandbox.lifecycle"]
${extra}
`;

export interface PluginOptions {
  id?: string;
  version?: string;
  extra?: string;
  files?: Record<string, string | Buffer>;
}

export function writePlugin(root: string, opts: PluginOptions = {}): string {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "ebx-provider.toml"), MANIFEST(opts.id ?? "demo-prov", opts.version ?? "0.1.0", opts.extra ?? ""), "utf-8");
  fs.writeFileSync(path.join(root, "provider.py"), "print('plugin')\n", "utf-8");
  for (const [rel, content] of Object.entries(opts.files ?? {})) {
    const target = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

export function copyDir(src: string, dest: string): string {
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

export function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, env: { ...process.env, ...GIT_ENV }, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function gitCommitAll(repo: string, message = "c"): string {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

export function initRepo(repo: string): string {
  fs.mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  return repo;
}

export function pythonAvailable(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

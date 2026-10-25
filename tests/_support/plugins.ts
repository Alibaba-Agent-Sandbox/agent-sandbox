/** Builders for throw-away provider plugin trees and git repositories (port of `test_providers/helpers.py`). */

import { execFileSync } from "node:child_process";
import { hostVersion } from "../../src/providers/host.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PLUGINS = path.resolve(here, "..", "fixtures", "providers");
export const LOCAL_PROCESS = path.join(FIXTURE_PLUGINS, "local-process");
export const E2B_COMPATIBLE = path.join(FIXTURE_PLUGINS, "e2b-compatible");
/** In-repo reference plugins that stay in the Python SDK (not opensandbox). */
export const PY_PROVIDER_EXAMPLES = path.resolve(here, "..", "..", "..", "python-sdk", "examples", "providers");
export const AWESOME_PROVIDERS_URL =
  process.env["ABX_AWESOME_PROVIDERS_URL"] ?? "https://github.com/alibaba-agent-sandbox/awesome-providers.git";

/** The awesome-providers checkout: `ABX_AWESOME_PROVIDERS`, else the sibling `awesome-providers` directory of this repository. */
export function catalogDir(...sub: string[]): string {
  const root = process.env["ABX_AWESOME_PROVIDERS"] || path.resolve(here, "..", "..", "..", "awesome-providers");
  return path.join(root, ...sub);
}

function manifestDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, "abx-provider.toml"));
}

/** A checkout already on disk. Does not clone. */
export function openSandboxFromEnv(): string | null {
  const direct = process.env["ABX_OPENSANDBOX_PLUGIN"];
  if (direct && manifestDir(direct)) return direct;
  const root = process.env["ABX_AWESOME_PROVIDERS"];
  if (root && manifestDir(path.join(root, "opensandbox"))) return path.join(root, "opensandbox");
  const inRepo = catalogDir("opensandbox");
  return manifestDir(inRepo) ? inRepo : null;
}

/**
 * The opensandbox plugin from the awesome-providers catalog.
 * Uses ABX_OPENSANDBOX_PLUGIN / ABX_AWESOME_PROVIDERS, then the `awesome-providers` directory of this repository, else clones the catalog once under the temp dir.
 * Returns null when the catalog cannot be fetched (callers skip).
 */
export function ensureOpenSandboxPlugin(): string | null {
  const fromEnv = openSandboxFromEnv();
  if (fromEnv) return fromEnv;
  const dest = path.join(os.tmpdir(), "abx-awesome-providers");
  const plugin = path.join(dest, "opensandbox");
  if (manifestDir(plugin)) return plugin;
  try {
    fs.rmSync(dest, { recursive: true, force: true });
    execFileSync("git", ["clone", "--depth", "1", AWESOME_PROVIDERS_URL, dest], { stdio: "ignore" });
  } catch {
    return null;
  }
  return manifestDir(plugin) ? plugin : null;
}

/** Install reference plugins against the actual CLI package version. */
export const TEST_HOST_VERSION = hostVersion();

const MANIFEST = (id: string, version: string, extra: string): string => `\
manifest_version = 1
operation_contract_version = 1
[operations]
cli = []
python = []
[workflow]
inputs = ["managed"]
startups = ["none"]

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
  fs.writeFileSync(path.join(root, "abx-provider.toml"), MANIFEST(opts.id ?? "demo-prov", opts.version ?? "0.1.0", opts.extra ?? ""), "utf-8");
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

/**
 * Shared isolation fixture for configuration/provider tests (port of `python-sdk/client-sdk/tests/iso.py`):
 * a throw-away `~/.abx` directory, no recognised credential env vars, no project `.env`, empty provider registry.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach } from "vitest";

import { _resetPaths, _setPaths, resetLayeredConfig } from "../../src/transport/config_layers.js";
import { ALICLOUD_EXPRESS_KEYS, CORE_KEYS, envNames } from "../../src/utils/config_keys.js";
import { resetRegistry } from "../../src/providers/registry.js";

const PREFIXES = ["ABX_", "SANDBOX_", "E2B_", "ALICLOUD_", "ALIBABA_CLOUD_", "OPENAI_"];

function allEnvNames(): Set<string> {
  const names = new Set<string>(["GITHUB_TOKEN", "AccessKey", "AccessKeySecret", "AccessSecret"]);
  for (const key of [...CORE_KEYS, ...ALICLOUD_EXPRESS_KEYS]) for (const n of envNames(key)) names.add(n);
  return names;
}

export interface Iso {
  /** The temporary `~/.abx` directory. */
  readonly home: string;
  /** The temporary directory that contains `home` (also the CWD). */
  readonly root: string;
  readonly toml: string;
  readonly env: string;
  writeToml(text: string): void;
  writeEnv(text: string): void;
  setenv(name: string, value: string): void;
}

export function useIso(): Iso {
  let root = "";
  let home = "";
  const saved = new Map<string, string | undefined>();
  let cwd = "";

  const iso: Iso = {
    get home() {
      return home;
    },
    get root() {
      return root;
    },
    get toml() {
      return path.join(home, "config.toml");
    },
    get env() {
      return path.join(home, ".env");
    },
    writeToml(text) {
      fs.writeFileSync(this.toml, text, "utf-8");
      resetLayeredConfig();
    },
    writeEnv(text) {
      fs.writeFileSync(this.env, text, "utf-8");
      resetLayeredConfig();
    },
    setenv(name, value) {
      if (!saved.has(name)) saved.set(name, process.env[name]);
      process.env[name] = value;
      resetLayeredConfig();
    },
  };

  beforeEach(() => {
    const names = allEnvNames();
    for (const name of Object.keys(process.env)) {
      if (PREFIXES.some((p) => name.startsWith(p)) || names.has(name)) {
        saved.set(name, process.env[name]);
        delete process.env[name];
      }
    }
    root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-iso-"));
    home = path.join(root, ".abx");
    fs.mkdirSync(home);
    cwd = process.cwd();
    process.chdir(root);
    _setPaths({ abxDir: home, configFile: path.join(home, "config.toml"), envFiles: [path.join(home, ".env")] });
    resetLayeredConfig();
    // Load modules before test hooks run. Slow cold imports must not leave an
    // asynchronous registry reset running after this fixture has been torn down.
    resetRegistry();
  });

  afterEach(() => {
    process.chdir(cwd);
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    saved.clear();
    _resetPaths();
    resetLayeredConfig();
    resetRegistry();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return iso;
}

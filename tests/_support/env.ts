/**
 * Port of the autouse fixtures of `tests/conftest.py` + `tests/test_transport/conftest.py`:
 *  - `_suppress_ci_detection`: unset the CI env vars,
 *  - `_isolate_credential_env`: unset credential env vars and point the project `.env` reader at a missing file.
 *
 * Call {@link useIsolatedEnv} at module level of a test file.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach } from "vitest";

import {
  _CONFIG_FILE,
  _ENV_FILE_CANDIDATES,
  _PROJECT_ENV_FILE,
  _setConfigFile,
  _setEnvFileCandidates,
  _setProjectEnvFile,
  resetConfig,
} from "../../src/transport/config.js";

export const _CI_ENV_VARS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "JENKINS_URL",
  "TRAVIS",
  "CIRCLECI",
  "BITBUCKET_PIPELINES",
  "TF_BUILD",
  "CODEBUILD_BUILD_ID",
];

export const _CREDENTIAL_ENV_VARS = [
  "GITHUB_TOKEN",
  "ABX_LLM_API_KEY",
  "ABX_LLM_BASE_URL",
  "ABX_LLM_MODEL",
  "BAILIAN_CODING_PLAN_API_KEY",
  "DASHSCOPE_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
];

export function mkTmpDir(prefix = "abx-test-"): string {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}

/** `monkeypatch` over `process.env`: records the original value on first touch and restores everything on teardown. */
export class EnvPatch {
  private saved = new Map<string, string | undefined>();

  private remember(k: string): void {
    if (!this.saved.has(k)) this.saved.set(k, process.env[k]);
  }
  setenv(k: string, v: string): void {
    this.remember(k);
    process.env[k] = v;
  }
  delenv(k: string): void {
    this.remember(k);
    delete process.env[k];
  }
  private cwd: string | null = null;
  chdir(dir: string): void {
    if (this.cwd === null) this.cwd = process.cwd();
    process.chdir(dir);
  }
  undo(): void {
    if (this.cwd !== null) {
      process.chdir(this.cwd);
      this.cwd = null;
    }
    for (const [k, v] of this.saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    this.saved.clear();
  }
}

export interface Isolation {
  readonly tmp_path: string;
  readonly monkeypatch: EnvPatch;
}

/** Registers `beforeEach`/`afterEach` hooks that apply the autouse fixtures and expose `tmp_path` / `monkeypatch`. */
export function useIsolatedEnv(): Isolation {
  const state = { tmp_path: "", monkeypatch: new EnvPatch() };
  let savedProject = "";
  beforeEach(() => {
    state.tmp_path = mkTmpDir();
    state.monkeypatch = new EnvPatch();
    for (const v of _CI_ENV_VARS) state.monkeypatch.delenv(v);
    for (const v of _CREDENTIAL_ENV_VARS) state.monkeypatch.delenv(v);
    savedProject = _PROJECT_ENV_FILE;
    _setProjectEnvFile(path.join(state.tmp_path, "no-project.env"));
  });
  afterEach(() => {
    _setProjectEnvFile(savedProject);
    state.monkeypatch.undo();
    fs.rmSync(state.tmp_path, { recursive: true, force: true });
  });
  return {
    get tmp_path() {
      return state.tmp_path;
    },
    get monkeypatch() {
      return state.monkeypatch;
    },
  };
}

export const _LEAKY_ENV_VARS = [
  "ABX_SANDBOX_API_KEY",
  "ABX_SANDBOX_BASE_URL",
  "ABX_SANDBOX_DOMAIN",
  "ABX_HTTP_TIMEOUT",
  "ALIBABA_CLOUD_REGION_ID",
  "E2B_API_KEY",
  "E2B_API_URL",
  "E2B_DOMAIN",
  "SANDBOX_API_KEY",
  "SANDBOX_API_BASE_URL",
  "SANDBOX_REGION",
  "SANDBOX_HTTP_TIMEOUT",
  "ALICLOUD_ACCESS_KEY_ID",
  "ALICLOUD_ACCESS_KEY_SECRET",
  "AccessKey",
  "AccessSecret",
];

/**
 * Port of `tests/test_transport/conftest.py::isolate_transport_config` (autouse): `.env` / `config.toml` discovery is
 * redirected at an empty temp dir, recognised credential/config env vars are cleared and the config cache is reset.
 * Must be called AFTER {@link useIsolatedEnv} so `tmp_path` exists when the hook runs.
 */
export function useTransportIsolation(iso: Isolation): void {
  let savedCandidates: string[] = [];
  let savedConfigFile = "";
  beforeEach(() => {
    const isolated_dir = path.join(iso.tmp_path, "config_isolation");
    fs.mkdirSync(isolated_dir);
    savedCandidates = _ENV_FILE_CANDIDATES;
    savedConfigFile = _CONFIG_FILE;
    _setEnvFileCandidates([path.join(isolated_dir, ".env")]);
    _setConfigFile(path.join(isolated_dir, "config.toml"));
    for (const name of _LEAKY_ENV_VARS) iso.monkeypatch.delenv(name);
    resetConfig();
  });
  afterEach(() => {
    resetConfig();
    _setEnvFileCandidates(savedCandidates);
    _setConfigFile(savedConfigFile);
  });
}

/**
 * Shared helpers of the `config_cmd` tests: the Python `patch(...config_cmd._CONFIG_FILE...)` / `patch.dict(os.environ,
 * clear=True)` / `_FakeSys` idioms on top of the mutable {@link configSeams}.
 */

import fs from "node:fs";
import path from "node:path";

import { configSeams } from "../../src/cli/commands/config_cmd.js";
import { sys } from "../../src/cli/io.js";

/** `_CONFIG_ENV_VARS` of `test_config_commands.py`: every variable that changes an effective config value. */
export const CONFIG_ENV_VARS = [
  "ABX_SANDBOX_API_KEY",
  "ABX_SANDBOX_BASE_URL",
  "ABX_SANDBOX_DOMAIN",
  "ABX_HTTP_TIMEOUT",
  "ALIBABA_CLOUD_REGION_ID",
  "E2B_API_KEY",
  "SANDBOX_API_KEY",
  "E2B_API_URL",
  "E2B_DOMAIN",
  "SANDBOX_API_BASE_URL",
  "SANDBOX_REGION",
  "SANDBOX_HTTP_TIMEOUT",
  "ALICLOUD_ACCESS_KEY_ID",
  "ALICLOUD_ACCESS_KEY_SECRET",
  "AccessKey",
  "AccessSecret",
  "ABX_LLM_API_KEY",
  "ABX_LLM_BASE_URL",
  "ABX_LLM_MODEL",
  "BAILIAN_CODING_PLAN_API_KEY",
  "DASHSCOPE_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "GITHUB_TOKEN",
] as const;

/** `_clean_env(**overrides)`: a copy of `process.env` without any config-affecting variable, plus `overrides`. */
export function cleanEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const name of CONFIG_ENV_VARS) delete env[name];
  return { ...env, ...overrides };
}

/** `patch.dict("os.environ", env, clear=True)`. */
export async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
}

type Seams = typeof configSeams;

/** `patch(f"...config_cmd.{attr}", value)` for several attributes at once; returns the undo function. */
export function patchConfig(overrides: Partial<Seams>): () => void {
  const saved: Partial<Seams> = {};
  for (const key of Object.keys(overrides) as Array<keyof Seams>) {
    (saved as Record<string, unknown>)[key] = configSeams[key];
    (configSeams as Record<string, unknown>)[key] = overrides[key];
  }
  return () => {
    Object.assign(configSeams, saved);
  };
}

/** The three storage patches every command test applies: `_CONFIG_FILE`, `_ABX_DIR` (and `_ENV_FILE` when given). */
export function storagePatch(tmp: string, opts: { env?: boolean | string } = {}): Partial<Seams> {
  const patch: Partial<Seams> = {
    _CONFIG_FILE: path.join(tmp, "config.toml"),
    _ABX_DIR: tmp,
  };
  if (opts.env) patch._ENV_FILE = typeof opts.env === "string" ? opts.env : path.join(tmp, ".env");
  return patch;
}

/** `with patch(...): ...` for the config seams. */
export async function withConfig<T>(overrides: Partial<Seams>, fn: () => Promise<T> | T): Promise<T> {
  const undo = patchConfig(overrides);
  try {
    return await fn();
  } finally {
    undo();
  }
}

/** `_FakeSys`: reports an interactive stdin while everything else falls through to the real streams. */
export function fakeTtySys(): Seams["sys"] {
  return {
    stdin: { isatty: () => true },
    get stdout() {
      return sys.stdout;
    },
  };
}

export const readText = (p: string): string => fs.readFileSync(p, "utf8");
export const exists = (p: string): boolean => fs.existsSync(p);

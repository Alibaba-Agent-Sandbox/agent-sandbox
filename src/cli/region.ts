/**
 * Shared command-level `--region` option and resolution (port of `cli/region.py`).
 *
 * `region` is not a global CLI switch (unlike `--json`/`--quiet`/`--verbose`): only commands that actually talk to a
 * regional control plane, the template pipeline (ACR / FC), or MCP deployment accept it.
 *
 * Resolution priority (implemented once in `loadConfig` of `transport/config` via its override mechanism, reused by
 * every command):
 *
 * 1. Command `--region/-r` value
 * 2. `ALIBABA_CLOUD_REGION_ID` process environment (then the same name in `./.env`)
 * 3. `abx config set region` (`~/.abx/config.toml` or `~/.abx/.env`)
 * 4. Default `cn-hangzhou`
 */

import { type Option, option } from "./kit.js";
import { loadConfig } from "../transport/config.js";

/** Fallback region when nothing is configured. */
export const DEFAULT_REGION = "cn-hangzhou";

export const _REGION_HELP = "Region override for this command (default: 'abx config set region' value, else cn-hangzhou)";

/**
 * The shared command-level `--region/-r` option. Add it to a command's `params`:
 * `command("x", { params: [regionOption(), ...] })`. The callback receives `params.region` (`null` when the user did
 * not pass the flag, which then falls back to the configured/persisted region).
 */
export function regionOption(): Option {
  return option(["--region", "-r", "region"], { default: null, metavar: "TEXT", help: _REGION_HELP });
}

/**
 * Return the effective region for a command invocation.
 *
 * Priority: command `--region` > `ALIBABA_CLOUD_REGION_ID` > `abx config set region` > `cn-hangzhou`. Commands that build the
 * full transport config should instead call `loadConfig({ region: cliRegion })` directly -- the same priority
 * applies.
 */
export function resolveRegion(cliRegion: string | null): string {
  return loadConfig({ region: cliRegion }).region;
}

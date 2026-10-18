/**
 * How sandbox commands present provider identity (spec section 4.4).
 *
 * The legacy format (bare ids, no `provider` field) is used only when both the ambient provider (the configured
 * default, ignoring `--provider`) and the effective provider are the built-in one, so scripts that only ever use the
 * built-in provider see no change. In every other case ids are printed qualified (`local-process:sbx-1`) and JSON rows
 * gain `"provider"`.
 */

import { ProviderConfigError } from "../providers/errors.js";
import * as registry from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";
import { BUILTIN_PROVIDER_ID } from "../utils/config_keys.js";

export interface ProviderView {
  /** Provider the command talks to. */
  effective: string;
  /** The configured default (ignores `--provider`). */
  ambient: string;
  /** Bare ids, no `provider` key. */
  legacy: boolean;
}

export function providerView(effective?: string | null): ProviderView {
  const ambient = registry.ambientProviderId();
  const eff = effective ?? cliProvider() ?? ambient;
  return { effective: eff, ambient, legacy: eff === BUILTIN_PROVIDER_ID && ambient === BUILTIN_PROVIDER_ID };
}

/** The id as printed: qualified unless the legacy format applies. */
export function printedId(view: ProviderView, sandboxId: string, providerId: string = view.effective): string {
  return registry.qualify(providerId, sandboxId, { ambient: view.ambient });
}

/**
 * `--region` and the other built-in-provider flags only make sense for providers that declare the key; for a plugin
 * that does declare it the value is forwarded as the provider option.
 */
export function scopedFlagOptions(flag: string, key: string, value: string | null, view: ProviderView): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  const declared = registry.getProvider(view.effective).configFields.some((f) => f.key === key);
  if (!declared) {
    throw new ProviderConfigError(`Option '${flag}' is not supported by provider '${view.effective}'.`, {
      suggestion: `Use '--opt KEY=VALUE' for provider options (see 'abx provider info ${view.effective}').`,
    });
  }
  return { [key]: value };
}

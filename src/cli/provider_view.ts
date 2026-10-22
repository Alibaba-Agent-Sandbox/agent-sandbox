/** Provider identity and option validation for sandbox commands. */

import { ProviderConfigError } from "../models/provider_errors.js";
import * as registry from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";

export interface ProviderView {
  /** Provider the command talks to. */
  effective: string;
  /** The configured default (ignores `--provider`). */
  ambient: string;
}

export function providerView(effective?: string | null): ProviderView {
  const ambient = registry.ambientProviderId();
  const eff = effective ?? cliProvider() ?? ambient;
  return { effective: eff, ambient };
}

/** Provider-qualified printable sandbox id. */
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

/**
 * "Providers in use": true once the user installed a plugin or selected a non-built-in default. Until then the provider
 * surface stays out of the way (`abx --help` and the config help look exactly like they did before providers existed).
 */

import { collectSources, quietly, selectProviderId } from "../transport/config_layers.js";
import { BUILTIN_PROVIDER_ID } from "../utils/config_keys.js";
import * as store from "./store.js";

export function providersInUse(): boolean {
  try {
    if (store.listInstalledIds().length > 0) return true;
  } catch {
    /* unreadable store counts as unused */
  }
  try {
    return quietly(() => selectProviderId(collectSources())) !== BUILTIN_PROVIDER_ID;
  } catch {
    return false;
  }
}

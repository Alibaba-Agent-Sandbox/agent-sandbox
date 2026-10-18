/** Provider-layer loader for the official FC management SDK; independent of the API layer. */
import { createRequire } from "node:module";
import { ProviderConfigError } from "../errors.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Generated model constructors and client are dynamically loaded to keep discovery offline. */
export interface FcManagementSdk {
  models: Record<string, new (input?: Record<string, any>) => any>;
  Client: new (config: any) => any;
  Config: new (input: Record<string, unknown>) => any;
}

const require = createRequire(import.meta.url);

function loadSdk(): FcManagementSdk {
  const models = require("@alicloud/fcsandbox20260509");
  const core = require("@alicloud/openapi-core");
  const Client = models.default ?? models.Client;
  const Config = core.$OpenApiUtil?.Config ?? core.OpenApiUtil?.Config;
  if (typeof Client !== "function" || typeof Config !== "function") throw new Error("Invalid SDK exports");
  return { models, Client, Config };
}

/** Test seam for replacing the client while retaining official generated request models. */
export const _sdkLoader: { load: () => FcManagementSdk } = { load: loadSdk };

/** Load the SDK only after operation and credentials have been validated. */
export function _requireSdk(): FcManagementSdk {
  try {
    return _sdkLoader.load();
  } catch {
    throw new ProviderConfigError("The official FCSandbox management SDK could not be loaded.", {
      suggestion: "Reinstall the CLI with its lockfile dependencies.",
    });
  }
}

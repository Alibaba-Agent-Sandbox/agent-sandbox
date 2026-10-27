/** Express authentication: explicit sandbox API keys; control-plane AK/SK remains separate. */
import { InvalidAPIKeyError } from "../../models/errors.js";
import { CREDENTIAL_ENV_SUGGESTION } from "./credential_names.js";
import { getLogger } from "../../utils/logging.js";
import { ApiKeyAuth, type AuthProvider } from "../../transport/auth_contract.js";
export { ApiKeyAuth, PLATFORM_AUTH_HEADER, type AuthProvider } from "../../transport/auth_contract.js";
export * from "../shared/e2b/auth.js";
const logger = getLogger("transport.auth");
export interface CreateAuthProviderOptions {
  api_key?: string | null;
}

/** Create API-key authentication for sandbox requests. */
export function createAuthProvider(opts: CreateAuthProviderOptions = {}): AuthProvider {
  const { api_key = null } = opts;
  if (api_key) {
    logger.debug("Using API Key authentication");
    return new ApiKeyAuth(api_key);
  }

  const sandbox_key = process.env["ABX_SANDBOX_API_KEY"];
  if (sandbox_key) {
    logger.debug("Using API Key authentication (via ABX_SANDBOX_API_KEY)");
    return new ApiKeyAuth(sandbox_key);
  }

  throw new InvalidAPIKeyError("No authentication credentials provided", {
    suggestion: CREDENTIAL_ENV_SUGGESTION,
  });
}

export { createAuthProvider as create_auth_provider };

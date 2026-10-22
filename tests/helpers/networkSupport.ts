import { NetworkModule, type NetworkModuleInit } from "../../src/api/network.js";
import { createPortAccess } from "../../src/providers/shared/e2b/ports.js";

/** Explicit adapter fixture for tests of the shared E2B wire provider. */
export function providerNetwork(init: Omit<NetworkModuleInit, "port_access">): NetworkModule {
  return new NetworkModule({ ...init, port_access: createPortAccess({
    sandbox_id: init.sandbox_id, domain: init.domain, secure: init.secure ?? true,
    access_token: init.access_token ?? null,
  }, false) });
}

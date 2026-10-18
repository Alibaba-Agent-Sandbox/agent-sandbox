import type { PortAccess, PortContext } from "../../../protocol/port_contract.js";

/** Local addressing belongs only to adapters explicitly selecting this gateway. */
export function createPortAccess(context: PortContext, serverAuth = true): PortAccess {
  const getHost = (port: number): string => `${port}-${context.sandbox_id}.${context.domain}`;
  const getAccessHeaders = (): Record<string, string> => context.secure && context.access_token
    ? { "X-Access-Token": context.access_token } : {};
  return {
    getHost,
    getUrl: (port) => `${context.secure ? "https" : "http"}://${getHost(port)}`,
    getAccessHeaders,
    getServerHeaders: () => serverAuth ? getAccessHeaders() : {},
  };
}

/** Compatibility constructor for the historical standalone NetworkModule. */
export function legacyPortAccess(context: PortContext): PortAccess { return createPortAccess(context, false); }

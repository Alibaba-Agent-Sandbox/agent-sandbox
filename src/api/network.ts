/** Provider-owned port addressing and access headers. */

import { DEFAULT_CAPABILITIES } from "../models/template.js";
import { getLogger } from "../utils/logging.js";
import type { PortAccess } from "../protocol/port_contract.js";
import { legacyPortAccess } from "../providers/bundled_config.js";

const logger = getLogger("api.network");
void logger;

export interface NetworkModuleInit {
  sandbox_id: string;
  domain: string;
  secure?: boolean;
  access_token?: string | null;
  capabilities?: Set<string> | null;
  /** Provider `ports.url` hook: `[url, headers]` for a port; absent for providers that compute URLs locally. */
  port_resolver?: ((port: number) => Promise<[string, Record<string, string>]>) | null;
  port_access?: PortAccess;
}

/** Synchronous adapter access or asynchronous provider discovery via resolve(). */
export class NetworkModule {
  _sandbox_id: string;
  _domain: string;
  _secure: boolean;
  _access_token: string | null;
  _capabilities: Set<string>;
  _port_resolver: ((port: number) => Promise<[string, Record<string, string>]>) | null;
  private readonly _port_access: PortAccess;

  constructor(init: NetworkModuleInit) {
    this._port_resolver = init.port_resolver ?? null;
    this._sandbox_id = init.sandbox_id;
    this._domain = init.domain;
    this._secure = init.secure ?? true;
    this._access_token = init.access_token ?? null;
    this._capabilities = init.capabilities ?? new Set(DEFAULT_CAPABILITIES);
    this._port_access = init.port_access ?? legacyPortAccess({ sandbox_id: this._sandbox_id,
      domain: this._domain, secure: this._secure, access_token: this._access_token });
  }

  /** Return the host supplied by the synchronous adapter hook. */
  getHost(port: number): string {
    return this._port_access.getHost(port);
  }

  /** 获取端口访问的完整 URL。 */
  getUrl(port: number): string {
    return this._port_access.getUrl(port);
  }

  /** Return the access headers supplied by the selected adapter. */
  getAccessHeaders(): Record<string, string> {
    return this._port_access.getAccessHeaders();
  }

  /** `[url, headers]` for `port`: asks the provider when it declares `ports.url`, else the local computation. */
  async resolve(port: number): Promise<[string, Record<string, string>]> {
    if (this._port_resolver !== null) return this._port_resolver(port);
    return [this.getUrl(port), this.getAccessHeaders()];
  }

  /** Like {@link getUrl}, but routed through the provider's `ports.url` when declared. */
  async resolve_url(port: number): Promise<string> {
    return (await this.resolve(port))[0];
  }
}

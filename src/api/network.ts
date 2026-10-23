/** Provider-owned port addressing and access headers. */

import { getLogger } from "../utils/logging.js";
import { validateApplicationEndpoint } from "../transport/application_http.js";
import type { ApplicationEndpoint } from "../protocol/port_contract.js";
import type { PortAccess } from "../protocol/port_contract.js";

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
  port_access: PortAccess;
  provider_id?: string;
  endpoint_resolver?: (port: number) => Promise<ApplicationEndpoint>;
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
  private readonly _provider_id: string;
  private readonly _endpoint_resolver?: (port: number) => Promise<ApplicationEndpoint>;

  constructor(init: NetworkModuleInit) {
    this._port_resolver = init.port_resolver ?? null;
    this._provider_id = init.provider_id ?? "selected";
    this._endpoint_resolver = init.endpoint_resolver;
    this._sandbox_id = init.sandbox_id;
    this._domain = init.domain;
    this._secure = init.secure ?? true;
    this._access_token = init.access_token ?? null;
    this._capabilities = init.capabilities ?? new Set<string>();
    this._port_access = init.port_access;
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

  /** Resolve the exact sandbox/port application binding, independently of the envd transport. */
  async resolveEndpoint(port: number): Promise<ApplicationEndpoint> {
    const endpoint = this._endpoint_resolver ? await this._endpoint_resolver(port) : {
      provider_id: this._provider_id, sandbox_id: this._sandbox_id, port,
      url: this.getUrl(port), headers: this._port_access.getServerHeaders(),
      authentication_audience: "gateway" as const, path_mode: "prefix" as const,
    };
    return validateApplicationEndpoint(endpoint, this._sandbox_id, port);
  }

  /** Like {@link getUrl}, but routed through the provider's `ports.url` when declared. */
  async resolve_url(port: number): Promise<string> {
    return (await this.resolve(port))[0];
  }
}

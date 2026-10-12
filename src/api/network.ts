/**
 * 网络模块 — 端口 URL 计算和访问 (port of `api/network.py`).
 *
 * 端口 URL 由客户端本地计算，格式为：https://{port}-{sandbox_id}.{domain}
 * 其中 sandbox_id 已包含 "sbx-" 前缀（如 "sbx-xxxx"）。
 * 不需要服务端 API 调用。secure 模式下端口访问需要 X-Access-Token header。
 */

import { DEFAULT_CAPABILITIES } from "../models/template.js";
import { getLogger } from "../utils/logging.js";

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
}

/** 高层网络接口 — 端口 URL 计算和访问 header 管理。所有方法均为本地计算，不涉及任何网络请求。 */
export class NetworkModule {
  _sandbox_id: string;
  _domain: string;
  _secure: boolean;
  _access_token: string | null;
  _capabilities: Set<string>;
  _port_resolver: ((port: number) => Promise<[string, Record<string, string>]>) | null;

  constructor(init: NetworkModuleInit) {
    this._port_resolver = init.port_resolver ?? null;
    this._sandbox_id = init.sandbox_id;
    this._domain = init.domain;
    this._secure = init.secure ?? true;
    this._access_token = init.access_token ?? null;
    this._capabilities = init.capabilities ?? new Set(DEFAULT_CAPABILITIES);
  }

  /** 获取端口访问的 host。格式：{port}-{sandbox_id}.{domain} */
  getHost(port: number): string {
    return `${port}-${this._sandbox_id}.${this._domain}`;
  }

  /** 获取端口访问的完整 URL。 */
  getUrl(port: number): string {
    const scheme = this._secure ? "https" : "http";
    return `${scheme}://${this.getHost(port)}`;
  }

  /** 获取端口访问所需的 HTTP headers。secure 模式下需要 X-Access-Token header。 */
  getAccessHeaders(): Record<string, string> {
    if (this._secure && this._access_token) {
      return { "X-Access-Token": this._access_token };
    }
    return {};
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

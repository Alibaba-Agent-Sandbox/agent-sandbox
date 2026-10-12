/**
 * Protocol layer — 端口 URL 本地计算 (port of `protocol/port.py`).
 *
 * 端口 URL 为客户端本地计算，不需要服务端 API 调用。
 * 已实测验证：端口 URL 格式为 https://{port}-{sandbox_id}.{domain}
 * 其中 sandbox_id 已包含 "sbx-" 前缀（如 "sbx-xxxx"）。
 */

import { getLogger } from "../utils/logging.js";

const logger = getLogger("protocol.port");
void logger;

/**
 * 端口 URL 本地计算客户端。
 *
 * 所有方法均为纯本地计算，不涉及任何网络请求。
 */
export class PortClient {
  /** 获取端口访问的 host 地址（已实测验证）。格式为 `{port}-{sandbox_id}.{domain}`。 */
  static getHost(sandbox_id: string, port: number, domain: string): string {
    return `${port}-${sandbox_id}.${domain}`;
  }

  /** 获取端口访问的完整 URL（已实测验证）。格式为 `https://{port}-{sandbox_id}.{domain}`。 */
  static getPortUrl(sandbox_id: string, port: number, domain: string, secure: boolean = true): string {
    const scheme = secure ? "https" : "http";
    const host = PortClient.getHost(sandbox_id, port, domain);
    return `${scheme}://${host}`;
  }
}

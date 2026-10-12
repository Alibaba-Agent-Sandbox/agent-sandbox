/**
 * Minimal `urllib.request.urlopen` counterpart used for the Qwen Code
 * standalone download: redirects (max 10), HTTP errors raised for non-2xx,
 * socket-inactivity timeout, and `http_proxy` / `https_proxy` / `no_proxy`
 * environment proxies (HTTPS through an HTTP `CONNECT` tunnel), which urllib
 * honours automatically and the built-in `fetch` does not.
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as tls from "node:tls";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export class HTTPError extends Error {
  readonly code: number;
  constructor(code: number, reason: string, url: string) {
    super(`HTTP Error ${code}: ${reason}`);
    this.name = "HTTPError";
    this.code = code;
    this.url = url;
  }
  readonly url: string;
}

const MAX_REDIRECTS = 10;

function envProxy(scheme: string): string | null {
  const lower = process.env[`${scheme}_proxy`];
  if (lower) return lower;
  const upper = process.env[`${scheme.toUpperCase()}_PROXY`];
  return upper || null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `urllib.request.proxy_bypass_environment`. */
export function proxyBypass(host: string): boolean {
  const noProxy = process.env.no_proxy ?? process.env.NO_PROXY;
  if (!noProxy) return false;
  if (noProxy === "*") return true;
  const m = /^(.*):(\d*)$/.exec(host);
  const hostOnly = m && /^\d*$/.test(m[2] as string) && m[2] !== "" ? (m[1] as string) : host;
  for (const raw of noProxy.split(",")) {
    let name = raw.trim();
    if (!name) continue;
    name = name.replace(/^\.+/, "");
    const pattern = new RegExp(`^(?:.+\\.)?${escapeRegExp(name)}$`, "i");
    if (pattern.test(hostOnly) || pattern.test(host)) return true;
  }
  return false;
}

function proxyFor(url: URL): URL | null {
  const scheme = url.protocol.replace(":", "");
  const proxy = envProxy(scheme);
  if (!proxy) return null;
  const hostWithPort = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  if (proxyBypass(hostWithPort)) return null;
  try {
    return new URL(proxy.includes("://") ? proxy : `http://${proxy}`);
  } catch {
    return null;
  }
}

function proxyAuthHeader(proxy: URL): Record<string, string> {
  if (!proxy.username) return {};
  const user = decodeURIComponent(proxy.username);
  const pass = decodeURIComponent(proxy.password);
  return { "Proxy-Authorization": `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };
}

function connectTunnel(proxy: URL, target: URL, timeoutMs: number): Promise<import("node:net").Socket> {
  return new Promise((resolve, reject) => {
    const port = target.port || "443";
    const req = http.request({
      host: proxy.hostname,
      port: proxy.port || 80,
      method: "CONNECT",
      path: `${target.hostname}:${port}`,
      headers: { Host: `${target.hostname}:${port}`, ...proxyAuthHeader(proxy) },
      timeout: timeoutMs,
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Tunnel connection failed: ${res.statusCode} ${res.statusMessage ?? ""}`.trim()));
        return;
      }
      resolve(socket);
    });
    req.end();
  });
}

async function requestOnce(url: URL, headers: Record<string, string>, timeoutMs: number): Promise<http.IncomingMessage> {
  const proxy = proxyFor(url);
  const isHttps = url.protocol === "https:";
  const options: https.RequestOptions = { method: "GET", headers: { ...headers }, timeout: timeoutMs };
  let transport: typeof http | typeof https = isHttps ? https : http;

  if (proxy && isHttps) {
    const socket = await connectTunnel(proxy, url, timeoutMs);
    options.createConnection = () =>
      tls.connect({ socket, servername: url.hostname }) as unknown as import("node:net").Socket;
    options.host = url.hostname;
    options.port = url.port || 443;
    options.path = `${url.pathname}${url.search}`;
    options.agent = false;
  } else if (proxy) {
    transport = http;
    options.host = proxy.hostname;
    options.port = proxy.port || 80;
    options.path = url.href;
    options.headers = { ...headers, Host: url.host, ...proxyAuthHeader(proxy) };
  } else {
    options.host = url.hostname;
    options.port = url.port || (isHttps ? 443 : 80);
    options.path = `${url.pathname}${url.search}`;
    if (url.username) {
      const user = decodeURIComponent(url.username);
      const pass = decodeURIComponent(url.password);
      options.headers = {
        ...headers,
        Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
      };
    }
  }

  return await new Promise((resolve, reject) => {
    const req = (transport as typeof http).request(options, resolve);
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

/** `urllib.request.urlopen(Request(url, headers=...), timeout=...)`: the response stream, or an error. */
export async function urlopen(
  url: string,
  options: { headers?: Record<string, string>; timeout: number },
): Promise<http.IncomingMessage> {
  const timeoutMs = options.timeout * 1000;
  let current = new URL(url);
  for (let hop = 0; ; hop += 1) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw new Error(`<urlopen error unknown url type: ${current.protocol.replace(":", "")}>`);
    }
    const res = await requestOnce(current, options.headers ?? {}, timeoutMs);
    const status = res.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
      res.resume();
      if (hop >= MAX_REDIRECTS) {
        throw new HTTPError(status, "The HTTP server returned a redirect error that would lead to an infinite loop.", current.href);
      }
      current = new URL(res.headers.location, current);
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new HTTPError(status, res.statusMessage ?? "", current.href);
    }
    return res;
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** `_http_get_text`: small text resource, decoded as UTF-8 with replacement. */
export async function httpGetText(url: string, userAgent: string, timeout: number): Promise<string> {
  const res = await urlopen(url, { headers: { "User-Agent": userAgent }, timeout });
  const payload = await readAll(res);
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(payload);
}

/** `_download_to_file`: stream the response into `dest`. */
export async function httpDownloadToFile(url: string, dest: string, userAgent: string, timeout: number): Promise<void> {
  const res = await urlopen(url, { headers: { "User-Agent": userAgent }, timeout });
  await pipeline(res, fs.createWriteStream(dest));
}

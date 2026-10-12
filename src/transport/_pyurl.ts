/**
 * `urllib.parse` / `urllib.request` behaviours the WebSocket client depends on (CPython 3.11): `urlparse`, `urljoin`,
 * `quote`, strict `unquote`, `getproxies()` / `proxy_bypass()` for environment proxies.
 */

import * as net from "node:net";
import * as url from "node:url";

import { _utf8DecodeError } from "../utils/_pyos.js";

export class PyValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

export class PyUnicodeDecodeError extends PyValueError {
  constructor(
    readonly reason: string,
    readonly start: number,
    message: string,
  ) {
    super(message);
    this.name = "UnicodeDecodeError";
  }
}

/** Strict UTF-8 decode (`bytes.decode()`), raising Python's `UnicodeDecodeError` with `reason` / `start`. */
export function utf8DecodeStrict(buf: Uint8Array): string {
  const err = _utf8DecodeError(buf);
  if (err !== null) {
    const m = /position (\d+)(?:-\d+)?: (.+)$/.exec(err);
    throw new PyUnicodeDecodeError(m ? (m[2] as string) : "invalid data", m ? Number(m[1]) : 0, err);
  }
  return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString("utf8");
}

const SCHEME_CHARS = /^[A-Za-z0-9+\-.]+$/;
const USES_NETLOC = new Set([
  "", "ftp", "http", "gopher", "nntp", "telnet", "imap", "wais", "file", "mms", "https", "shttp", "snews", "prospero", "rtsp",
  "rtspu", "rsync", "svn", "svn+ssh", "sftp", "nfs", "git", "git+ssh", "ws", "wss",
]);
const USES_RELATIVE = new Set([
  "", "ftp", "http", "gopher", "nntp", "imap", "wais", "file", "https", "shttp", "mms", "prospero", "rtsp", "rtspu", "sftp",
  "svn", "svn+ssh", "ws", "wss",
]);
const USES_PARAMS = new Set([
  "", "ftp", "hdl", "prospero", "http", "imap", "https", "shttp", "rtsp", "rtspu", "sip", "sips", "mms", "sftp", "tel",
]);

export interface SplitResult {
  scheme: string;
  netloc: string;
  path: string;
  query: string;
  fragment: string;
}

function isAsciiAlpha(c: string): boolean {
  return /^[A-Za-z]$/.test(c);
}

function checkNetloc(netloc: string): void {
  if (!netloc || /^[\x00-\x7f]*$/.test(netloc)) return;
  const n = netloc.replace(/[@:#?]/g, "");
  const n2 = n.normalize("NFKC");
  if (n === n2) return;
  if (/[/?#@:]/.test(n2)) throw new PyValueError(`netloc '${netloc}' contains invalid characters under NFKC normalization`);
}

function checkBracketedHost(hostname: string): void {
  if (hostname.startsWith("v")) {
    if (!/^v[a-fA-F0-9]+\..+$/s.test(hostname)) throw new PyValueError("IPvFuture address is invalid");
  } else {
    const fam = net.isIP(hostname);
    if (fam === 0) throw new PyValueError(`'${hostname}' does not appear to be an IPv4 or IPv6 address`);
    if (fam === 4) throw new PyValueError("An IPv4 address cannot be in brackets");
  }
}

function checkBracketedNetloc(netloc: string): void {
  const hostAndPort = netloc.slice(netloc.lastIndexOf("@") + 1);
  const open = hostAndPort.indexOf("[");
  let hostname: string;
  if (open >= 0) {
    if (open > 0) throw new PyValueError("Invalid IPv6 URL");
    const rest = hostAndPort.slice(open + 1);
    const close = rest.indexOf("]");
    hostname = close >= 0 ? rest.slice(0, close) : rest;
    const port = close >= 0 ? rest.slice(close + 1) : "";
    if (port && !port.startsWith(":")) throw new PyValueError("Invalid IPv6 URL");
  } else {
    const c = hostAndPort.indexOf(":");
    hostname = c >= 0 ? hostAndPort.slice(0, c) : hostAndPort;
  }
  checkBracketedHost(hostname);
}

export function urlsplit(input: string, defaultScheme = ""): SplitResult {
  let u = input.replace(/^[\x00-\x20]+/, "");
  let scheme = defaultScheme.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");
  u = u.replace(/[\t\r\n]/g, "");
  scheme = scheme.replace(/[\t\r\n]/g, "");
  let netloc = "";
  let query = "";
  let fragment = "";
  const i = u.indexOf(":");
  if (i > 0 && isAsciiAlpha(u[0] as string) && SCHEME_CHARS.test(u.slice(0, i))) {
    scheme = u.slice(0, i).toLowerCase();
    u = u.slice(i + 1);
  }
  if (u.startsWith("//")) {
    let delim = u.length;
    for (const c of "/?#") {
      const w = u.indexOf(c, 2);
      if (w >= 0 && w < delim) delim = w;
    }
    netloc = u.slice(2, delim);
    u = u.slice(delim);
    if ((netloc.includes("[") && !netloc.includes("]")) || (netloc.includes("]") && !netloc.includes("["))) {
      throw new PyValueError("Invalid IPv6 URL");
    }
    if (netloc.includes("[") && netloc.includes("]")) checkBracketedNetloc(netloc);
  }
  const h = u.indexOf("#");
  if (h >= 0) {
    fragment = u.slice(h + 1);
    u = u.slice(0, h);
  }
  const q = u.indexOf("?");
  if (q >= 0) {
    query = u.slice(q + 1);
    u = u.slice(0, q);
  }
  checkNetloc(netloc);
  return { scheme, netloc, path: u, query, fragment };
}

export interface ParseResult extends SplitResult {
  params: string;
  hostname: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
}

function hostinfo(netloc: string): [string, string | null] {
  const hostinfoStr = netloc.slice(netloc.lastIndexOf("@") + 1);
  const open = hostinfoStr.indexOf("[");
  let hostname: string;
  let port: string;
  if (open >= 0) {
    const bracketed = hostinfoStr.slice(open + 1);
    const close = bracketed.indexOf("]");
    hostname = close >= 0 ? bracketed.slice(0, close) : bracketed;
    const after = close >= 0 ? bracketed.slice(close + 1) : "";
    const c = after.indexOf(":");
    port = c >= 0 ? after.slice(c + 1) : "";
  } else {
    const c = hostinfoStr.indexOf(":");
    hostname = c >= 0 ? hostinfoStr.slice(0, c) : hostinfoStr;
    port = c >= 0 ? hostinfoStr.slice(c + 1) : "";
  }
  return [hostname, port === "" ? null : port];
}

export function urlparse(input: string, defaultScheme = ""): ParseResult {
  const s = urlsplit(input, defaultScheme);
  let pathPart = s.path;
  let params = "";
  if (USES_PARAMS.has(s.scheme) && pathPart.includes(";")) {
    const slash = pathPart.lastIndexOf("/");
    const semi = pathPart.indexOf(";", slash + 1);
    if (semi >= 0) {
      params = pathPart.slice(semi + 1);
      pathPart = pathPart.slice(0, semi);
    }
  }
  const [rawHost, rawPort] = hostinfo(s.netloc);
  let hostname: string | null = null;
  if (rawHost) {
    const pct = rawHost.indexOf("%");
    hostname = pct >= 0 ? rawHost.slice(0, pct).toLowerCase() + rawHost.slice(pct) : rawHost.toLowerCase();
  }
  let port: number | null = null;
  const result: ParseResult = {
    ...s,
    path: pathPart,
    params,
    hostname,
    get port(): number | null {
      if (rawPort === null) return null;
      if (!/^[0-9]+$/.test(rawPort)) throw new PyValueError(`Port could not be cast to integer value as ${pyStrRepr(rawPort)}`);
      const p = Number(rawPort);
      if (p > 65535) throw new PyValueError("Port out of range 0-65535");
      port = p;
      return port;
    },
    username: null,
    password: null,
  };
  const at = s.netloc.lastIndexOf("@");
  if (at >= 0) {
    const userinfo = s.netloc.slice(0, at);
    const c = userinfo.indexOf(":");
    result.username = c >= 0 ? userinfo.slice(0, c) : userinfo;
    result.password = c >= 0 ? userinfo.slice(c + 1) : null;
  }
  return result;
}

function pyStrRepr(s: string): string {
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  return `'${s.replace(/'/g, "\\'")}'`;
}

export function urlunsplit(s: SplitResult): string {
  let u = s.path;
  if (s.netloc || (s.scheme && USES_NETLOC.has(s.scheme)) || u.startsWith("//")) {
    if (u && !u.startsWith("/")) u = "/" + u;
    u = "//" + (s.netloc || "") + u;
  }
  if (s.scheme) u = s.scheme + ":" + u;
  if (s.query) u = u + "?" + s.query;
  if (s.fragment) u = u + "#" + s.fragment;
  return u;
}

function urlunparse(scheme: string, netloc: string, p: string, params: string, query: string, fragment: string): string {
  return urlunsplit({ scheme, netloc, path: params ? `${p};${params}` : p, query, fragment });
}

/** `urllib.parse.urljoin(base, url)`. */
export function urljoin(base: string, target: string): string {
  if (!base) return target;
  if (!target) return base;
  const b = urlparse(base, "");
  const t = urlparse(target, b.scheme);
  let { scheme, netloc, path: p, params, query } = t;
  const fragment = t.fragment;
  if (scheme !== b.scheme || !USES_RELATIVE.has(scheme)) return target;
  if (USES_NETLOC.has(scheme)) {
    if (netloc) return urlunparse(scheme, netloc, p, params, query, fragment);
    netloc = b.netloc;
  }
  if (!p && !params) {
    p = b.path;
    params = b.params;
    if (!query) query = b.query;
    return urlunparse(scheme, netloc, p, params, query, fragment);
  }
  const baseParts = b.path.split("/");
  if (baseParts[baseParts.length - 1] !== "") baseParts.pop();
  let segments: string[];
  if (p.startsWith("/")) segments = p.split("/");
  else {
    segments = [...baseParts, ...p.split("/")];
    const mid = segments.slice(1, -1).filter((x) => x !== "");
    segments = [segments[0] as string, ...mid, ...(segments.length > 1 ? [segments[segments.length - 1] as string] : [])];
  }
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === "..") resolved.pop();
    else if (seg === ".") continue;
    else resolved.push(seg);
  }
  const last = segments[segments.length - 1];
  if (last === "." || last === "..") resolved.push("");
  return urlunparse(scheme, netloc, resolved.join("/") || "/", params, query, fragment);
}

/** `urllib.parse.quote(s, safe=...)`. */
export function quote(s: string, safe: string): string {
  const out: string[] = [];
  for (const byte of Buffer.from(s, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9_.\-~]/.test(ch) || (byte < 0x80 && safe.includes(ch))) out.push(ch);
    else out.push("%" + byte.toString(16).toUpperCase().padStart(2, "0"));
  }
  return out.join("");
}

/** `urllib.parse.unquote(s, errors="strict")`. */
export function unquoteStrict(s: string): string {
  if (!s.includes("%")) return s;
  const bytes: number[] = [];
  const parts = s.split(/(%[0-9a-fA-F]{2})/);
  const out: string[] = [];
  const flush = (): void => {
    if (bytes.length) {
      out.push(utf8DecodeStrict(Buffer.from(bytes)));
      bytes.length = 0;
    }
  };
  for (const part of parts) {
    if (/^%[0-9a-fA-F]{2}$/.test(part)) bytes.push(parseInt(part.slice(1), 16));
    else {
      flush();
      out.push(part);
    }
  }
  flush();
  return out.join("");
}

/** `host.encode("idna").decode()`. */
export function idnaEncode(host: string): string {
  const ascii = url.domainToASCII(host);
  if (ascii === "" && host !== "") throw new PyValueError("label empty or too long");
  return ascii;
}

export function isAscii(s: string): boolean {
  return /^[\x00-\x7f]*$/.test(s);
}

// --- urllib.request environment proxies -------------------------------------------------------------------------------

/** `urllib.request.getproxies_environment()`. */
export function getproxiesEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const proxies: Record<string, string> = {};
  const environment: [string, string, string][] = [];
  for (const name of Object.keys(env)) {
    if (name.length > 5 && name[name.length - 6] === "_" && name.slice(-5).toLowerCase() === "proxy") {
      const value = env[name] ?? "";
      const proxyName = name.slice(0, -6).toLowerCase();
      environment.push([name, value, proxyName]);
      if (value) proxies[proxyName] = value;
    }
  }
  if ("REQUEST_METHOD" in env) delete proxies["http"];
  for (const [name, value, proxyName] of environment) {
    if (name.slice(-6) === "_proxy") {
      if (value) proxies[proxyName] = value;
      else delete proxies[proxyName];
    }
  }
  return proxies;
}

function splitport(host: string): [string, string | null] {
  const m = /^(.*):([0-9]*)$/s.exec(host);
  if (m && m[2]) return [m[1] as string, m[2]];
  return [host, null];
}

/** `urllib.request.proxy_bypass_environment(host)` (Linux `proxy_bypass`). */
export function proxyBypassEnvironment(host: string, proxies: Record<string, string> = getproxiesEnvironment()): boolean {
  const noProxy = proxies["no"];
  if (noProxy === undefined) return false;
  if (noProxy === "*") return true;
  const h = host.toLowerCase();
  const [hostonly] = splitport(h);
  for (const raw of noProxy.split(",")) {
    let name = raw.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, "");
    if (!name) continue;
    name = name.replace(/^\.+/, "").toLowerCase();
    if (hostonly === name || h === name) return true;
    const dotted = "." + name;
    if (hostonly.endsWith(dotted) || h.endsWith(dotted)) return true;
  }
  return false;
}

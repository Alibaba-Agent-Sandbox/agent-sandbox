/**
 * Node counterpart of the subset of `httpx` (0.28.1) that `easy_sandbox` uses.
 *
 * The Python SDK talks to the platform / envd through `httpx.AsyncClient`; its tests drive `httpx.MockTransport`,
 * patch `AsyncClient.__init__` and replace `client.post` / `client.request` on instances.  This module mirrors those
 * seams so that the TypeScript `HttpClient` (and its tests) can keep the same structure:
 *
 *   - `Timeout`, `Limits`, `Headers`, `URL`, `Request`, `Response` (same attribute names: `status_code`, `content`,
 *     `text`, `json()`, `raiseForStatus()`, `aiterBytes()`, ...)
 *   - the exception hierarchy (`HTTPStatusError`, `ConnectError`, `ReadTimeout`, ...; `toString()` == Python `str(exc)`)
 *   - `AsyncClient` (`request/get/post/put/patch/delete/head/stream/send/aclose`, `is_closed`, `base_url` merging,
 *     redirects, per-request `timeout`)
 *   - `MockTransport(handler)` and the real `NodeTransport` (node:http / node:https / node:http2, env proxies,
 *     gzip/deflate/br decoding, per-phase timeouts, error text identical to httpx/anyio/ssl).
 *
 * Test seams (module level, mirroring `unittest.mock.patch`):
 *   `_setAsyncClientInitHook({before, after})`  ~ patching `httpx.AsyncClient.__init__`
 *   `_setDefaultTransportFactory(fn)`            ~ what `pytest-httpx` does to every client without a transport
 */

import * as dns from "node:dns";
import * as http from "node:http";
import * as http2 from "node:http2";
import * as https from "node:https";
import * as net from "node:net";
import * as tls from "node:tls";
import * as zlib from "node:zlib";
import { randomBytes } from "node:crypto";
import { stdGetLogger } from "../utils/logging.js";
import { ValueError } from "../models/_pydantic.js";
import { PyFloat, pyJsonDumps, pyRepr } from "../utils/_pyformat.js";
import { ContentDecodeError, contentDecoderFor } from "./_decoders.js";
import { H11_MAX_INCOMPLETE_EVENT_SIZE, H11_READ_CHUNK, h11ChunkedBodyError, h11HeadError, h11ParsedHeadError } from "./_h11.js";
import { getproxiesEnvironment } from "./_pyurl.js";
import { JSONDecodeError, pyJsonLoadsBytes } from "../utils/_pyjson.js";
import { tlsTrustOptions, type TlsTrust } from "./_tls.js";

export const HTTPX_VERSION = "0.28.1";
export const USER_AGENT = `ebx-node-httpx/${HTTPX_VERSION}`;
export const DEFAULT_TIMEOUT_SECONDS = 5.0;
export const DEFAULT_MAX_REDIRECTS = 20;

// ---------------------------------------------------------------------------------------------------------------------
// Reason phrases (python `http.HTTPStatus` as used by `httpx.codes.get_reason_phrase`)
// ---------------------------------------------------------------------------------------------------------------------

const REASON_PHRASES: Record<number, string> = {
  100: "Continue", 101: "Switching Protocols", 102: "Processing", 103: "Early Hints",
  200: "OK", 201: "Created", 202: "Accepted", 203: "Non-Authoritative Information", 204: "No Content",
  205: "Reset Content", 206: "Partial Content", 207: "Multi-Status", 208: "Already Reported", 226: "IM Used",
  300: "Multiple Choices", 301: "Moved Permanently", 302: "Found", 303: "See Other", 304: "Not Modified",
  305: "Use Proxy", 307: "Temporary Redirect", 308: "Permanent Redirect",
  400: "Bad Request", 401: "Unauthorized", 402: "Payment Required", 403: "Forbidden", 404: "Not Found",
  405: "Method Not Allowed", 406: "Not Acceptable", 407: "Proxy Authentication Required", 408: "Request Timeout",
  409: "Conflict", 410: "Gone", 411: "Length Required", 412: "Precondition Failed", 413: "Request Entity Too Large",
  414: "Request-URI Too Long", 415: "Unsupported Media Type", 416: "Requested Range Not Satisfiable",
  417: "Expectation Failed", 418: "I'm a teapot", 421: "Misdirected Request", 422: "Unprocessable Entity",
  423: "Locked", 424: "Failed Dependency", 425: "Too Early", 426: "Upgrade Required", 428: "Precondition Required",
  429: "Too Many Requests", 431: "Request Header Fields Too Large", 451: "Unavailable For Legal Reasons",
  500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway", 503: "Service Unavailable",
  504: "Gateway Timeout", 505: "HTTP Version Not Supported", 506: "Variant Also Negotiates",
  507: "Insufficient Storage", 508: "Loop Detected", 510: "Not Extended", 511: "Network Authentication Required",
};

/** `httpx.codes.get_reason_phrase`. */
export function getReasonPhrase(statusCode: number): string {
  return REASON_PHRASES[statusCode] ?? "";
}

// ---------------------------------------------------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------------------------------------------------

/** Python `RuntimeError`. */
export class RuntimeError extends Error {
  constructor(message = "") {
    super(message);
    this.name = "RuntimeError";
  }
  override toString(): string {
    return this.message;
  }
}

export class HTTPError extends Error {
  _request: Request | null = null;
  constructor(message = "") {
    super(message);
    this.name = new.target.name;
  }
  get request(): Request {
    if (this._request === null) {
      throw new RuntimeError("The .request property has not been set.");
    }
    return this._request;
  }
  set request(value: Request | null) {
    this._request = value;
  }
  override toString(): string {
    return this.message;
  }
}

export class RequestError extends HTTPError {
  constructor(message = "", opts: { request?: Request | null } = {}) {
    super(message);
    this._request = opts.request ?? null;
  }
}
export class TransportError extends RequestError {}
export class TimeoutException extends TransportError {}
export class ConnectTimeout extends TimeoutException {}
export class ReadTimeout extends TimeoutException {}
export class WriteTimeout extends TimeoutException {}
export class PoolTimeout extends TimeoutException {}
export class NetworkError extends TransportError {}
export class ConnectError extends NetworkError {}
export class ReadError extends NetworkError {}
export class WriteError extends NetworkError {}
export class CloseError extends NetworkError {}
export class ProtocolError extends TransportError {}
export class LocalProtocolError extends ProtocolError {}
export class RemoteProtocolError extends ProtocolError {}
export class ProxyError extends TransportError {}
export class UnsupportedProtocol extends TransportError {}
export class DecodingError extends RequestError {}
export class TooManyRedirects extends RequestError {}

export class HTTPStatusError extends HTTPError {
  readonly response: Response;
  constructor(message: string, opts: { request: Request; response: Response }) {
    super(message);
    this._request = opts.request;
    this.response = opts.response;
  }
}

export class InvalidURL extends Error {
  constructor(message = "") {
    super(message);
    this.name = "InvalidURL";
  }
  override toString(): string {
    return this.message;
  }
}

export class StreamError extends RuntimeError {}
export class StreamConsumed extends StreamError {
  constructor() {
    super(
      "Attempted to read or stream some content, but the content has already been streamed. " +
        "For requests, this could be due to passing a generator as request content, and then receiving a redirect " +
        "response or a secondary request as part of an authentication flow." +
        "For responses, this could be due to attempting to stream the response content more than once.",
    );
  }
}
export class StreamClosed extends StreamError {
  constructor() {
    super("Attempted to read or stream content, but the stream has been closed.");
  }
}
export class ResponseNotRead extends StreamError {
  constructor() {
    super("Attempted to access streaming response content, without having called `read()`.");
  }
}
export class RequestNotRead extends StreamError {
  constructor() {
    super("Attempted to access streaming request content, without having called `read()`.");
  }
}

export { JSONDecodeError };

// ---------------------------------------------------------------------------------------------------------------------
// Timeout / Limits
// ---------------------------------------------------------------------------------------------------------------------

type TimeoutValue = number | null | undefined;

/**
 * `httpx.Timeout`.  `undefined` plays the role of httpx's UNSET, `null` of `None`.
 *   new Timeout(5)                      -> all four 5
 *   new Timeout(null)                   -> all four None
 *   new Timeout(5, { connect: null })   -> connect None, others 5
 *   new Timeout(undefined, {connect: 1, read: 2, write: 3, pool: 4})
 */
export class Timeout {
  readonly connect: number | null;
  readonly read: number | null;
  readonly write: number | null;
  readonly pool: number | null;

  constructor(
    timeout?: TimeoutValue | Timeout,
    opts: { connect?: TimeoutValue; read?: TimeoutValue; write?: TimeoutValue; pool?: TimeoutValue } = {},
  ) {
    const { connect, read, write, pool } = opts;
    if (timeout instanceof Timeout) {
      if (connect !== undefined || read !== undefined || write !== undefined || pool !== undefined) {
        throw new Error("Timeout(...) with a Timeout instance cannot take other arguments");
      }
      this.connect = timeout.connect;
      this.read = timeout.read;
      this.write = timeout.write;
      this.pool = timeout.pool;
      return;
    }
    if (timeout === undefined) {
      if (connect === undefined || read === undefined || write === undefined || pool === undefined) {
        throw new Error(
          "httpx.Timeout must either include a default, or set all four parameters explicitly.",
        );
      }
      this.connect = connect;
      this.read = read;
      this.write = write;
      this.pool = pool;
      return;
    }
    this.connect = connect === undefined ? timeout : connect;
    this.read = read === undefined ? timeout : read;
    this.write = write === undefined ? timeout : write;
    this.pool = pool === undefined ? timeout : pool;
  }

  asDict(): { connect: number | null; read: number | null; write: number | null; pool: number | null } {
    return { connect: this.connect, read: this.read, write: this.write, pool: this.pool };
  }

  equals(other: unknown): boolean {
    return (
      other instanceof Timeout &&
      this.connect === other.connect &&
      this.read === other.read &&
      this.write === other.write &&
      this.pool === other.pool
    );
  }

  toString(): string {
    const fmt = (v: number | null): string => (v === null ? "None" : new PyFloat(v).toString());
    if (this.connect === this.read && this.read === this.write && this.write === this.pool) {
      return `Timeout(timeout=${fmt(this.connect)})`;
    }
    return `Timeout(connect=${fmt(this.connect)}, read=${fmt(this.read)}, write=${fmt(this.write)}, pool=${fmt(this.pool)})`;
  }
}

export class Limits {
  readonly max_connections: number | null;
  readonly max_keepalive_connections: number | null;
  readonly keepalive_expiry: number | null;
  constructor(
    opts: {
      max_connections?: number | null;
      max_keepalive_connections?: number | null;
      keepalive_expiry?: number | null;
    } = {},
  ) {
    this.max_connections = opts.max_connections ?? null;
    this.max_keepalive_connections = opts.max_keepalive_connections ?? null;
    this.keepalive_expiry = opts.keepalive_expiry === undefined ? 5.0 : opts.keepalive_expiry;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------------------------------------------------

export type HeadersInit =
  | Headers
  | Record<string, string>
  | Iterable<readonly [string, string]>
  | null
  | undefined;

/** `httpx.Headers`: case-insensitive multi-dict; keys are reported lower-cased, `raw` keeps the original case. */
export class Headers {
  /** [original-key, lower-key, value] */
  private _list: [string, string, string][] = [];

  constructor(init?: HeadersInit) {
    if (init === null || init === undefined) return;
    if (init instanceof Headers) {
      this._list = init._list.map((e) => [...e] as [string, string, string]);
    } else if (Symbol.iterator in Object(init) && !(typeof init === "string")) {
      for (const [k, v] of init as Iterable<readonly [string, string]>) this._list.push([k, k.toLowerCase(), String(v)]);
    } else {
      for (const [k, v] of Object.entries(init as Record<string, string>)) this._list.push([k, k.toLowerCase(), String(v)]);
    }
  }

  get raw(): [string, string][] {
    return this._list.map(([k, , v]) => [k, v]);
  }

  keys(): string[] {
    return [...new Set(this._list.map((e) => e[1]))];
  }

  values(): string[] {
    return this.items().map(([, v]) => v);
  }

  items(): [string, string][] {
    const out = new Map<string, string[]>();
    for (const [, k, v] of this._list) {
      const arr = out.get(k);
      if (arr) arr.push(v);
      else out.set(k, [v]);
    }
    return [...out].map(([k, vs]) => [k, vs.join(", ")]);
  }

  multiItems(): [string, string][] {
    return this._list.map(([, k, v]) => [k, v]);
  }

  getlist(key: string, splitCommas = false): string[] {
    const lower = key.toLowerCase();
    const vals = this._list.filter((e) => e[1] === lower).map((e) => e[2]);
    if (!splitCommas) return vals;
    return vals.flatMap((v) => v.split(",").map((x) => x.trim()));
  }

  get(key: string, dflt: string | null = null): string | null {
    const lower = key.toLowerCase();
    const vals = this._list.filter((e) => e[1] === lower).map((e) => e[2]);
    return vals.length ? vals.join(", ") : dflt;
  }

  has(key: string): boolean {
    const lower = key.toLowerCase();
    return this._list.some((e) => e[1] === lower);
  }

  /** `headers[key] = value` (replaces every existing value, keeps the position of the first). */
  set(key: string, value: string): void {
    const lower = key.toLowerCase();
    let replaced = false;
    const out: [string, string, string][] = [];
    for (const e of this._list) {
      if (e[1] === lower) {
        if (!replaced) {
          out.push([key, lower, String(value)]);
          replaced = true;
        }
      } else out.push(e);
    }
    if (!replaced) out.push([key, lower, String(value)]);
    this._list = out;
  }

  setdefault(key: string, value: string): string {
    if (!this.has(key)) this.set(key, value);
    return this.get(key) as string;
  }

  append(key: string, value: string): void {
    this._list.push([key, key.toLowerCase(), String(value)]);
  }

  update(other: HeadersInit): void {
    const o = new Headers(other);
    for (const k of o.keys()) {
      this._list = this._list.filter((e) => e[1] !== k);
    }
    for (const [ok, k, v] of o._list) this._list.push([ok, k, v]);
  }

  delete(key: string): void {
    const lower = key.toLowerCase();
    this._list = this._list.filter((e) => e[1] !== lower);
  }

  copy(): Headers {
    return new Headers(this);
  }

  get length(): number {
    return this.keys().length;
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.items()[Symbol.iterator]();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// URL / query params
// ---------------------------------------------------------------------------------------------------------------------

const QUOTE_PLUS_SAFE = /[A-Za-z0-9_.\-~]/;

/** Python `urllib.parse.quote_plus(s, safe="")` on UTF-8. */
export function quotePlus(s: string): string {
  let out = "";
  for (const b of Buffer.from(s, "utf-8")) {
    const ch = String.fromCharCode(b);
    if (b < 128 && QUOTE_PLUS_SAFE.test(ch)) out += ch;
    else if (b === 0x20) out += "+";
    else out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export type ParamValue = string | number | boolean | null | undefined | PyFloat | bigint;
export type QueryParamsInit =
  | Record<string, ParamValue | ParamValue[]>
  | Iterable<readonly [string, ParamValue]>
  | string
  | null
  | undefined;

function primitiveToStr(v: ParamValue): string {
  if (v === true) return "true";
  if (v === false) return "false";
  if (v === null || v === undefined) return "";
  return String(v);
}

function paramItems(params: QueryParamsInit): [string, string][] {
  if (params === null || params === undefined) return [];
  if (typeof params === "string") {
    return params
      .split("&")
      .filter((p) => p !== "")
      .map((p) => {
        const i = p.indexOf("=");
        const dec = (x: string): string => {
          try {
            return decodeURIComponent(x.replace(/\+/g, " "));
          } catch {
            return x;
          }
        };
        return i < 0 ? [dec(p), ""] : [dec(p.slice(0, i)), dec(p.slice(i + 1))];
      });
  }
  const out: [string, string][] = [];
  if (Symbol.iterator in Object(params)) {
    for (const [k, v] of params as Iterable<readonly [string, ParamValue]>) out.push([k, primitiveToStr(v)]);
    return out;
  }
  for (const [k, v] of Object.entries(params as Record<string, ParamValue | ParamValue[]>)) {
    if (Array.isArray(v)) for (const x of v) out.push([k, primitiveToStr(x)]);
    else out.push([k, primitiveToStr(v)]);
  }
  return out;
}

export function encodeParams(params: QueryParamsInit): string {
  return paramItems(params)
    .map(([k, v]) => `${quotePlus(k)}=${quotePlus(v)}`)
    .join("&");
}

const httpxLogger = stdGetLogger("httpx");

/** Why the transport (not the URL parser) fails for an `http(s)`/`ws(s)` URL the WHATWG parser rejected, or `null`. */
function deferredUrlFailure(text: string): "host" | "port" | null {
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):(?:\/\/([^/?#]*))?/.exec(text);
  if (!m || !["http", "https", "ws", "wss"].includes((m[1] as string).toLowerCase())) return null;
  const authority = m[2];
  if (authority === undefined) return "host";
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  const pm = /^(.*):([0-9]+)$/.exec(hostPort);
  if (pm && Number(pm[2]) > 65535) return "port";
  const host = pm ? (pm[1] as string) : hostPort.replace(/:$/, "");
  if (host === "" || /[\s<>^|\\%]/.test(host)) return "host";
  return null;
}

/** httpx builds `BasicAuth` from the userinfo of the request URL (it replaces any `Authorization` header). */
function basicAuthFromUrl(url: URL_): string | null {
  if (url._schemeless !== null || url._deferred !== null) return null;
  const decode = (v: string): string => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  const username = decode(url._u.username);
  const password = decode(url._u.password);
  if (!username && !password) return null;
  return `Basic ${Buffer.from(`${username}:${password}`, "utf-8").toString("base64")}`;
}

/** `httpx.URL` (backed by the WHATWG URL parser; `str(url)` == `toString()`). */
export class URL_ {
  readonly _u: globalThis.URL;
  /** The original text of a URL without a scheme (`127.0.0.1:9`, `/x`); httpx parses it, the request later fails. */
  _schemeless: string | null = null;
  /**
   * httpx accepts hosts / ports that the WHATWG parser rejects (`http://a b:1`, `http://`, port 99999) and the request
   * fails later in the transport: the original text and the failure to raise then.
   */
  _deferred: { text: string; kind: "host" | "port" } | null = null;
  constructor(url: string | URL_ | globalThis.URL) {
    if (url instanceof URL_) {
      this._u = new globalThis.URL(url._u.href);
      this._schemeless = url._schemeless;
      this._deferred = url._deferred;
      return;
    }
    if (url instanceof globalThis.URL) {
      this._u = new globalThis.URL(url.href);
      return;
    }
    try {
      this._u = new globalThis.URL(url);
    } catch {
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) {
        const kind = deferredUrlFailure(url);
        if (kind === null) throw new InvalidURL(`Invalid URL ${JSON.stringify(url)}`);
        this._u = new globalThis.URL(`${url.slice(0, url.indexOf(":")).toLowerCase()}://__deferred__/`);
        this._deferred = { text: url, kind };
        return;
      }
      this._u = new globalThis.URL("http://__schemeless__/");
      this._schemeless = url;
    }
  }
  get scheme(): string {
    return this._schemeless === null ? this._u.protocol.replace(/:$/, "") : "";
  }
  get host(): string {
    return this._u.hostname.replace(/^\[|\]$/g, "");
  }
  get port(): number | null {
    return this._u.port === "" ? null : Number(this._u.port);
  }
  get path(): string {
    try {
      return decodeURIComponent(this._u.pathname);
    } catch {
      return this._u.pathname;
    }
  }
  get raw_path(): string {
    return this._u.pathname + this._u.search;
  }
  get query(): string {
    return this._u.search.replace(/^\?/, "");
  }
  get fragment(): string {
    return this._u.hash.replace(/^#/, "");
  }
  get netloc(): string {
    return this._u.host;
  }
  get userinfo(): string {
    return this._u.username ? `${this._u.username}${this._u.password ? ":" + this._u.password : ""}` : "";
  }
  get params(): [string, string][] {
    return paramItems(this.query);
  }
  copyWith(opts: { params?: QueryParamsInit; path?: string; query?: string }): URL_ {
    const u = new globalThis.URL(this._u.href);
    if (opts.params !== undefined) u.search = encodeParams(opts.params);
    if (opts.query !== undefined) u.search = opts.query;
    if (opts.path !== undefined) u.pathname = opts.path;
    const copy = new URL_(u);
    copy._schemeless = this._schemeless;
    copy._deferred = this._deferred;
    return copy;
  }
  toString(): string {
    return this._schemeless ?? this._deferred?.text ?? this._u.href;
  }
  toJSON(): string {
    return this.toString();
  }
  equals(other: unknown): boolean {
    return other instanceof URL_ ? this.toString() === other.toString() : this.toString() === String(other);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------------------------------

export type Bytes = Uint8Array;
export type ByteStream = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
export type FileValue = Uint8Array | string | readonly [string | null, Uint8Array | string] | readonly [string | null, Uint8Array | string, string];

export interface RequestExtensions {
  timeout?: { connect: number | null; read: number | null; write: number | null; pool: number | null };
  [k: string]: unknown;
}

export interface RequestOptions {
  params?: QueryParamsInit;
  headers?: HeadersInit;
  content?: string | Uint8Array | ByteStream | null;
  data?: Record<string, ParamValue | ParamValue[]> | null;
  files?: Record<string, FileValue> | null;
  json?: unknown;
  timeout?: Timeout | number | null;
  follow_redirects?: boolean;
  extensions?: RequestExtensions;
}

function mimeGuess(filename: string | null): string {
  const ext = (filename ?? "").includes(".") ? (filename as string).split(".").pop()?.toLowerCase() : "";
  const table: Record<string, string> = {
    txt: "text/plain", json: "application/json", html: "text/html", htm: "text/html", css: "text/css",
    js: "text/javascript", csv: "text/csv", xml: "text/xml", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", gif: "image/gif", pdf: "application/pdf", zip: "application/zip",
    gz: "application/gzip", tar: "application/x-tar", py: "text/x-python", md: "text/markdown",
    yaml: "application/yaml", yml: "application/yaml", svg: "image/svg+xml",
  };
  return (ext && table[ext]) || "application/octet-stream";
}

function toBuffer(v: string | Uint8Array): Buffer {
  return typeof v === "string" ? Buffer.from(v, "utf-8") : Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function isByteStream(v: unknown): v is ByteStream {
  return (
    v !== null &&
    typeof v === "object" &&
    !(v instanceof Uint8Array) &&
    (Symbol.asyncIterator in (v as object) || Symbol.iterator in (v as object))
  );
}

function encodeMultipart(
  data: Record<string, ParamValue | ParamValue[]> | null | undefined,
  files: Record<string, FileValue>,
): { body: Buffer; contentType: string } {
  const boundary = randomBytes(16).toString("hex");
  const chunks: Buffer[] = [];
  const escape = (s: string): string => s.replace(/"/g, "%22").replace(/\\/g, "\\\\");
  const dataEntries: [string, string][] = [];
  for (const [k, v] of Object.entries(data ?? {})) {
    if (Array.isArray(v)) for (const x of v) dataEntries.push([k, primitiveToStr(x)]);
    else dataEntries.push([k, primitiveToStr(v)]);
  }
  for (const [name, value] of dataEntries) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${escape(name)}"\r\n\r\n${value}\r\n`, "utf-8"),
    );
  }
  for (const [name, spec] of Object.entries(files)) {
    let filename: string | null;
    let content: Uint8Array | string;
    let ctype: string | undefined;
    if (typeof spec === "string" || spec instanceof Uint8Array) {
      filename = name;
      content = spec;
    } else {
      filename = spec[0];
      content = spec[1];
      ctype = (spec as readonly unknown[])[2] as string | undefined;
    }
    const ct = ctype ?? mimeGuess(filename);
    const disp =
      filename === null
        ? `form-data; name="${escape(name)}"`
        : `form-data; name="${escape(name)}"; filename="${escape(filename)}"`;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disp}\r\nContent-Type: ${ct}\r\n\r\n`, "utf-8"));
    if (typeof content !== "string" && !(content instanceof Uint8Array)) {
      const kind =
        content === null || content === undefined
          ? "NoneType"
          : Array.isArray(content)
            ? "list"
            : (content as unknown) instanceof PyFloat
              ? "float"
              : typeof content === "bigint"
                ? "int"
            : typeof content === "object"
              ? "dict"
              : typeof content === "boolean"
                ? "bool"
                : typeof content === "number"
                  ? Number.isInteger(content)
                    ? "int"
                    : "float"
                  : typeof content;
      throw new TypeError(`'${kind}' object has no attribute 'read'`);
    }
    chunks.push(toBuffer(content));
    chunks.push(Buffer.from("\r\n", "utf-8"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf-8"));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** `setTimeout` that tolerates delays beyond 2**31-1 ms (Node would fire them after 1 ms; Python waits "forever"). */
function clampedTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  return setTimeout(fn, Math.min(ms, 2 ** 31 - 1));
}

/** `httpx.Request`. */
export class Request {
  method: string;
  url: URL_;
  headers: Headers;
  extensions: RequestExtensions;
  _content: Buffer | null = null;
  _stream: ByteStream | null = null;
  _streamConsumed = false;

  constructor(method: string, url: string | URL_, opts: RequestOptions = {}) {
    this.method = method.toUpperCase();
    this.url = url instanceof URL_ ? new URL_(url) : new URL_(url);
    if (opts.params !== undefined && opts.params !== null && paramItems(opts.params).length >= 0) {
      this.url = this.url.copyWith({ params: opts.params });
    }
    this.headers = new Headers(opts.headers);
    this.extensions = { ...(opts.extensions ?? {}) };
    if (opts.timeout !== undefined) {
      const t = opts.timeout instanceof Timeout ? opts.timeout : new Timeout(opts.timeout);
      this.extensions.timeout = t.asDict();
    }

    let contentType: string | null = null;
    let body: Buffer | null = null;
    if (opts.files && Object.keys(opts.files).length) {
      const mp = encodeMultipart(opts.data, opts.files);
      body = mp.body;
      contentType = mp.contentType;
    } else if (opts.data && Object.keys(opts.data).length) {
      body = Buffer.from(encodeParams(opts.data), "utf-8");
      contentType = "application/x-www-form-urlencoded";
    } else if (opts.json !== undefined && opts.json !== null) {
      body = Buffer.from(
        pyJsonDumps(opts.json, { ensure_ascii: false, separators: [",", ":"] }),
        "utf-8",
      );
      contentType = "application/json";
    } else if (opts.content !== undefined && opts.content !== null) {
      if (typeof opts.content === "string" || opts.content instanceof Uint8Array) {
        body = toBuffer(opts.content);
      } else if (isByteStream(opts.content)) {
        this._stream = opts.content;
      }
    }

    if (this.url.host && !this.headers.has("host")) {
      const defaultPort = this.url.scheme === "https" ? 443 : 80;
      const port = this.url.port;
      const host = this.url._u.hostname;
      this.headers = new Headers([["Host", port !== null && port !== defaultPort ? `${host}:${port}` : host], ...this.headers.multiItems()]);
    }
    if (body !== null) {
      this._content = body;
      if (!this.headers.has("content-length") && !this.headers.has("transfer-encoding")) {
        if (body.length > 0 || !["GET", "HEAD", "DELETE", "OPTIONS", "TRACE"].includes(this.method)) {
          this.headers.set("Content-Length", String(body.length));
        }
      }
      if (contentType !== null && !this.headers.has("content-type")) this.headers.set("Content-Type", contentType);
    } else if (this._stream !== null) {
      if (!this.headers.has("content-length") && !this.headers.has("transfer-encoding")) {
        this.headers.set("Transfer-Encoding", "chunked");
      }
    } else if (["POST", "PUT", "PATCH"].includes(this.method) && !this.headers.has("content-length")) {
      this.headers.set("Content-Length", "0");
    }
  }

  get content(): Buffer {
    if (this._content === null) throw new RequestNotRead();
    return this._content;
  }

  async read(): Promise<Buffer> {
    if (this._content === null) {
      const parts: Buffer[] = [];
      for await (const c of this.stream()) parts.push(Buffer.from(c));
      this._content = Buffer.concat(parts);
    }
    return this._content;
  }

  async *stream(): AsyncGenerator<Uint8Array> {
    if (this._content !== null) {
      yield this._content;
      return;
    }
    if (this._stream === null) return;
    if (this._streamConsumed) throw new StreamConsumed();
    this._streamConsumed = true;
    for await (const c of this._stream as AsyncIterable<Uint8Array>) yield c;
  }

  toString(): string {
    return `<Request('${this.method}', '${this.url}')>`;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------------------------------------------------

export interface ResponseOptions {
  content?: string | Uint8Array | ByteStream | null;
  text?: string;
  html?: string;
  json?: unknown;
  headers?: HeadersInit;
  request?: Request | null;
  extensions?: Record<string, unknown>;
  stream?: AsyncIterable<Uint8Array> | null;
  onClose?: (() => Promise<void> | void) | null;
}

function isRedirectStatus(code: number): boolean {
  return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
}

function charsetOf(headers: Headers): string | null {
  const ct = headers.get("content-type");
  if (!ct) return null;
  const m = /charset\s*=\s*"?([^";\s]+)"?/i.exec(ct);
  return m ? (m[1] as string).toLowerCase() : null;
}

/** `httpx.Response`. */
export class Response {
  status_code: number;
  headers: Headers;
  extensions: Record<string, unknown>;
  _request: Request | null;
  private _content: Buffer | null = null;
  private _stream: AsyncIterable<Uint8Array> | null = null;
  private _decode = false;
  private _onClose: (() => Promise<void> | void) | null = null;
  is_closed = false;
  is_stream_consumed = false;
  http_version = "HTTP/1.1";

  constructor(statusCode: number, opts: ResponseOptions = {}) {
    this.status_code = statusCode;
    this.headers = new Headers(opts.headers);
    this._request = opts.request ?? null;
    this.extensions = { ...(opts.extensions ?? {}) };
    if (opts.stream) {
      this._stream = opts.stream;
      this._decode = true;
      this._onClose = opts.onClose ?? null;
      return;
    }
    let body: Buffer | null = null;
    let ctype: string | null = null;
    if (opts.json !== undefined) {
      body = Buffer.from(pyJsonDumps(opts.json, { ensure_ascii: false, separators: [",", ":"] }), "utf-8");
      ctype = "application/json";
    } else if (opts.text !== undefined) {
      body = Buffer.from(opts.text, "utf-8");
      ctype = "text/plain; charset=utf-8";
    } else if (opts.html !== undefined) {
      body = Buffer.from(opts.html, "utf-8");
      ctype = "text/html; charset=utf-8";
    } else if (opts.content !== undefined && opts.content !== null) {
      if (typeof opts.content === "string" || opts.content instanceof Uint8Array) body = toBuffer(opts.content);
      else if (isByteStream(opts.content)) {
        const it = opts.content as ByteStream;
        this._stream = (async function* () {
          for await (const c of it as AsyncIterable<Uint8Array>) yield c;
        })();
        this._decode = true;
        if (!this.headers.has("transfer-encoding") && !this.headers.has("content-length")) {
          this.headers.set("Transfer-Encoding", "chunked");
        }
        return;
      }
    } else {
      body = Buffer.alloc(0);
    }
    this._content = body;
    if (body !== null) {
      if (!this.headers.has("content-length") && !this.headers.has("transfer-encoding") && body.length > 0) {
        this.headers.set("Content-Length", String(body.length));
      }
      if (ctype !== null && !this.headers.has("content-type")) this.headers.set("Content-Type", ctype);
    }
    this.is_stream_consumed = true;
  }

  get request(): Request {
    if (this._request === null) {
      throw new RuntimeError("The request instance has not been set on this response.");
    }
    return this._request;
  }
  set request(value: Request | null) {
    this._request = value;
  }

  get url(): URL_ {
    return this.request.url;
  }

  get reason_phrase(): string {
    const ext = this.extensions["reason_phrase"];
    if (typeof ext === "string") return ext;
    return getReasonPhrase(this.status_code);
  }

  get content(): Buffer {
    if (this._content === null) throw new ResponseNotRead();
    return this._content;
  }

  get encoding(): string {
    return charsetOf(this.headers) ?? "utf-8";
  }

  get text(): string {
    const body = this.content;
    const enc = this.encoding;
    if (enc === "utf-8" || enc === "utf8") return body.toString("utf-8");
    if (enc === "latin-1" || enc === "iso-8859-1" || enc === "latin1") return body.toString("latin1");
    if (enc === "ascii" || enc === "us-ascii") return body.toString("latin1");
    try {
      return new TextDecoder(enc).decode(body);
    } catch {
      return body.toString("utf-8");
    }
  }

  json(): any {
    return pyJsonLoadsBytes(this.content, { floats: "py" });
  }

  get is_informational(): boolean {
    return this.status_code >= 100 && this.status_code < 200;
  }
  get is_success(): boolean {
    return this.status_code >= 200 && this.status_code < 300;
  }
  get is_redirect(): boolean {
    return this.status_code >= 300 && this.status_code < 400;
  }
  get is_client_error(): boolean {
    return this.status_code >= 400 && this.status_code < 500;
  }
  get is_server_error(): boolean {
    return this.status_code >= 500 && this.status_code < 600;
  }
  get is_error(): boolean {
    return this.status_code >= 400 && this.status_code < 600;
  }
  get has_redirect_location(): boolean {
    return isRedirectStatus(this.status_code) && this.headers.has("location");
  }

  raiseForStatus(): Response {
    if (this._request === null) {
      throw new RuntimeError(
        "Cannot call `raise_for_status` as the request instance has not been set on this response.",
      );
    }
    if (this.is_success) return this;
    const cls = Math.floor(this.status_code / 100);
    const types: Record<number, string> = {
      1: "Informational response",
      3: "Redirect response",
      4: "Client error",
      5: "Server error",
    };
    const errorType = types[cls] ?? "Invalid status code";
    let message =
      `${errorType} '${this.status_code} ${this.reason_phrase}' for url '${this.url}'\n`;
    if (this.has_redirect_location) message += `Redirect location: '${this.headers.get("location")}'\n`;
    message += `For more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/${this.status_code}`;
    throw new HTTPStatusError(message, { request: this._request, response: this });
  }

  async aread(): Promise<Buffer> {
    if (this._content === null) {
      const parts: Buffer[] = [];
      for await (const c of this.aiterBytes()) parts.push(Buffer.from(c));
      this._content = Buffer.concat(parts);
    }
    return this._content;
  }

  async *aiterBytes(): AsyncGenerator<Uint8Array> {
    if (this._content !== null) {
      if (this._content.length) yield this._content;
      return;
    }
    if (this.is_stream_consumed) throw new StreamConsumed();
    if (this.is_closed) throw new StreamClosed();
    this.is_stream_consumed = true;
    const stream = this._stream as AsyncIterable<Uint8Array>;
    const decoder = this._decode ? contentDecoderFor(this.headers.get("content-encoding") ?? "") : null;
    try {
      if (decoder !== null) {
        try {
          for await (const c of stream) {
            if (!c.length) continue;
            const decoded = await decoder.decode(Buffer.from(c.buffer, c.byteOffset, c.byteLength));
            if (decoded.length) yield decoded;
          }
          const tail = await decoder.flush();
          if (tail.length) yield tail;
        } catch (e) {
          if (e instanceof ContentDecodeError) throw new DecodingError(e.message);
          throw e;
        }
      } else {
        for await (const c of stream) {
          if (c.length) yield c;
        }
      }
    } finally {
      await this.aclose();
    }
  }

  async aclose(): Promise<void> {
    if (!this.is_closed) {
      this.is_closed = true;
      const cb = this._onClose;
      this._onClose = null;
      const s = this._stream as { return?: () => unknown } | null;
      if (cb) await cb();
      if (s && typeof (s as any).return === "function" && this._content === null && !this.is_stream_consumed) {
        try {
          await (s as any).return();
        } catch {
          /* ignore */
        }
      }
    }
  }

  toString(): string {
    return `<Response [${this.status_code} ${this.reason_phrase}]>`;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------------------------------------------------

export interface AsyncBaseTransport {
  handleAsyncRequest(request: Request): Promise<Response>;
  aclose(): Promise<void>;
}

export type MockHandler = (request: Request) => Response | Promise<Response>;

/** `httpx.MockTransport`. */
export class MockTransport implements AsyncBaseTransport {
  constructor(readonly handler: MockHandler) {}
  async handleAsyncRequest(request: Request): Promise<Response> {
    await request.read();
    const response = await this.handler(request);
    if (!(response instanceof Response)) {
      throw new TypeError("MockTransport handler must return an httpx Response");
    }
    return response;
  }
  async aclose(): Promise<void> {
    /* nothing to release */
  }
}

// --- error mapping -------------------------------------------------------------------------------------------------

const ERRNO: Record<string, [number, string]> = {
  ECONNREFUSED: [111, "Connection refused"],
  ECONNRESET: [104, "Connection reset by peer"],
  ETIMEDOUT: [110, "Connection timed out"],
  EHOSTUNREACH: [113, "No route to host"],
  ENETUNREACH: [101, "Network is unreachable"],
  EPIPE: [32, "Broken pipe"],
  EADDRNOTAVAIL: [99, "Cannot assign requested address"],
  ECONNABORTED: [103, "Software caused connection abort"],
  EACCES: [13, "Permission denied"],
  ENOENT: [2, "No such file or directory"],
};

/** anyio's `connect_tcp` (httpx/httpcore) hides every OS-level TCP connect failure behind this one message. */
const CONNECT_PHASE_ERRNO = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EADDRNOTAVAIL",
  "ECONNABORTED",
  "EACCES",
]);

const TLS_REASONS: Record<string, string> = {
  DEPTH_ZERO_SELF_SIGNED_CERT: "self-signed certificate",
  SELF_SIGNED_CERT_IN_CHAIN: "self-signed certificate in certificate chain",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "unable to get local issuer certificate",
  UNABLE_TO_GET_ISSUER_CERT: "unable to get issuer certificate",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "unable to get local issuer certificate",
  CERT_HAS_EXPIRED: "certificate has expired",
  CERT_NOT_YET_VALID: "certificate is not yet valid",
  CERT_REVOKED: "certificate revoked",
  CERT_UNTRUSTED: "certificate not trusted",
  HOSTNAME_MISMATCH: "Hostname mismatch",
};

function errCode(err: unknown): string {
  return String((err as NodeJS.ErrnoException)?.code ?? "");
}

/** Text of the OS-level exception that Python/anyio would have raised for this Node connect error. */
export function connectErrorText(err: unknown, hostname = ""): string {
  const e = err as NodeJS.ErrnoException & { errors?: unknown[] };
  if (Array.isArray(e.errors) && e.errors.length > 1) return "All connection attempts failed";
  const code = errCode(e.errors && e.errors.length === 1 ? e.errors[0] : e);
  if (code === "ENOTFOUND") return "[Errno -2] Name or service not known";
  if (code === "EAI_NONAME") return "[Errno -2] Name or service not known";
  if (code === "EAI_AGAIN") return "[Errno -3] Temporary failure in name resolution";
  if (CONNECT_PHASE_ERRNO.has(code)) return "All connection attempts failed";
  if (code in ERRNO) {
    const [n, s] = ERRNO[code] as [number, string];
    return `[Errno ${n}] ${s}`;
  }
  if (TLS_REASONS[code] !== undefined || code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    let reason = TLS_REASONS[code] ?? "Hostname mismatch";
    if (code === "ERR_TLS_CERT_ALTNAME_INVALID") {
      reason = `Hostname mismatch, certificate is not valid for '${hostname}'.`;
    }
    return `[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: ${reason} (_ssl.c:1006)`;
  }
  if (/^ERR_SSL|^ERR_TLS|^ERR_OSSL/.test(code) || /ssl|tls/i.test(e.message ?? "")) {
    return `[SSL] ${e.message} (_ssl.c:1006)`;
  }
  return e.message ?? String(err);
}

function mapReadErrorText(err: unknown): string {
  const code = errCode(err);
  if (code in ERRNO) {
    const [n, s] = ERRNO[code] as [number, string];
    return `[Errno ${n}] ${s}`;
  }
  return (err as Error)?.message ?? "";
}

// --- proxies -------------------------------------------------------------------------------------------------------

function isIpHostname(hostname: string, version: 4 | 6): boolean {
  const h = hostname.split("/")[0] as string;
  return net.isIP(h) === version && !/%/.test(h);
}

/** `httpx._utils.URLPattern`. */
class URLPattern {
  readonly scheme: string;
  readonly host: string;
  readonly port: number | null;
  private readonly hostRegex: RegExp | null;

  constructor(readonly pattern: string) {
    const m = /^([A-Za-z][A-Za-z0-9+.-]*):(?:\/\/([^/?#]*))?/.exec(pattern);
    const scheme = (m?.[1] ?? "").toLowerCase();
    const authority = (m?.[2] ?? "").slice((m?.[2] ?? "").lastIndexOf("@") + 1);
    const pm = /^(.*?):([0-9]+)$/.exec(authority);
    const host = (pm ? (pm[1] as string) : authority).toLowerCase();
    this.scheme = scheme === "all" ? "" : scheme;
    this.host = host === "*" ? "" : host;
    this.port = pm ? Number(pm[2]) : null;
    if (!host || host === "*") this.hostRegex = null;
    else if (host.startsWith("*.")) this.hostRegex = new RegExp(`^.+\\.${escapeRe(host.slice(2))}$`);
    else if (host.startsWith("*")) this.hostRegex = new RegExp(`^(.+\\.)?${escapeRe(host.slice(1))}$`);
    else this.hostRegex = new RegExp(`^${escapeRe(host)}$`);
  }

  matches(url: URL_): boolean {
    if (this.scheme && this.scheme !== url.scheme) return false;
    if (this.host && this.hostRegex !== null && !this.hostRegex.test(url.host.toLowerCase())) return false;
    if (this.port !== null && this.port !== url.port) return false;
    return true;
  }

  get priority(): [number, number, number] {
    return [this.port !== null ? 0 : 1, -this.host.length, -this.scheme.length];
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `httpx._utils.get_environment_proxies()`: `[pattern, proxy URL | null]` in insertion order. */
function environmentProxyMounts(): [string, string | null][] {
  const info = getproxiesEnvironment();
  const mounts = new Map<string, string | null>();
  for (const scheme of ["http", "https", "all"]) {
    const raw = info[scheme];
    if (raw) mounts.set(`${scheme}://`, raw.includes("://") ? raw : `http://${raw}`);
  }
  for (const entry of (info["no"] ?? "").split(",")) {
    const hostname = entry.trim();
    if (hostname === "*") return [];
    if (!hostname) continue;
    if (hostname.includes("://")) mounts.set(hostname, null);
    else if (isIpHostname(hostname, 4)) mounts.set(`all://${hostname}`, null);
    else if (isIpHostname(hostname, 6)) mounts.set(`all://[${hostname}]`, null);
    else if (hostname.toLowerCase() === "localhost") mounts.set(`all://${hostname}`, null);
    else mounts.set(`all://*${hostname}`, null);
  }
  return [...mounts];
}

/** The environment proxy httpx's mounts select for `url` (`null`: direct connection). */
export const UNRESOLVABLE_PROXY: unique symbol = Symbol("unresolvable proxy");

/** `UNRESOLVABLE_PROXY`: the proxy URL httpx accepts but whose host can never be looked up (`http://[bad`). */
export function proxyForUrl(url: URL_): globalThis.URL | null | typeof UNRESOLVABLE_PROXY {
  const mounts = environmentProxyMounts()
    .map(([pattern, proxy], i) => ({ pattern: new URLPattern(pattern), proxy, i }))
    .sort((a, b) => {
      for (let k = 0; k < 3; k++) {
        const d = (a.pattern.priority[k] as number) - (b.pattern.priority[k] as number);
        if (d !== 0) return d;
      }
      return a.i - b.i;
    });
  for (const m of mounts) {
    if (!m.pattern.matches(url)) continue;
    if (m.proxy === null) return null;
    try {
      return new globalThis.URL(m.proxy);
    } catch {
      return UNRESOLVABLE_PROXY;
    }
  }
  return null;
}

/** `httpx.URL.__repr__` for a proxy URL (the password is masked; an empty path stays empty). */
function httpxUrlRepr(raw: string): string {
  const masked = raw.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#@:]*:)[^/?#@]*(@)/, "$1[secure]$2");
  return `URL(${pyRepr(masked)})`;
}

/**
 * What `httpx.AsyncClient.__init__` does with the environment proxies (`trust_env` and no explicit transport): each
 * `http_proxy` / `https_proxy` / `all_proxy` value becomes a `Proxy`, whose scheme is validated up front
 * (`ValueError`), then one transport per proxy is built (a SOCKS proxy needs the optional `socksio` package).
 */
export function validateEnvProxies(): void {
  const info = getproxiesEnvironment();
  if ((info["no"] ?? "").split(",").some((h) => h.trim() === "*")) return;
  const proxies: string[] = [];
  for (const key of ["http", "https", "all"]) {
    const raw = info[key];
    if (!raw) continue;
    const text = raw.includes("://") ? raw : `http://${raw}`;
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(text)?.[1]?.toLowerCase() ?? "";
    if (!["http", "https", "socks5", "socks5h"].includes(scheme)) {
      throw new ValueError(`Unknown scheme for proxy URL ${httpxUrlRepr(text)}`);
    }
    proxies.push(scheme);
  }
  if (proxies.some((scheme) => scheme.startsWith("socks"))) {
    const err = new Error(
      "Using SOCKS proxy, but the 'socksio' package is not installed. Make sure to install httpx using `pip install httpx[socks]`.",
    );
    err.name = "ImportError";
    throw err;
  }
}

// --- NodeTransport -------------------------------------------------------------------------------------------------

export interface NodeTransportOptions {
  http2?: boolean;
  limits?: Limits;
  verify?: boolean;
  trust_env?: boolean;
}

type TimeoutDict = { connect: number | null; read: number | null; write: number | null; pool: number | null };

function secs(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : v * 1000;
}

function withTimeout<T>(p: Promise<T>, ms: number | null, make: () => Error): Promise<T> {
  if (ms === null) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = clampedTimeout(() => reject(make()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Single-valued headers must stay plain strings: node:http rejects an array-valued `Host` (`ERR_INVALID_ARG_TYPE`). */
function outgoingHeaders(request: Request): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of request.headers.multiItems()) {
    const existing = out[k];
    if (existing === undefined) out[k] = v;
    else out[k] = Array.isArray(existing) ? [...existing, v] : [existing, v];
  }
  return out;
}

/** The real network transport (`httpx.AsyncHTTPTransport` on top of node:http/https/http2). */
export class NodeTransport implements AsyncBaseTransport {
  private readonly http2Enabled: boolean;
  private readonly httpAgent: http.Agent;
  private readonly httpsAgent: https.Agent;
  private readonly verify: boolean;
  private readonly trustEnv: boolean;
  private readonly tlsTrust: TlsTrust;
  private readonly h2Sessions = new Map<string, http2.ClientHttp2Session>();
  private readonly h1Origins = new Set<string>();
  private closed = false;

  constructor(opts: NodeTransportOptions = {}) {
    this.http2Enabled = opts.http2 ?? false;
    this.verify = opts.verify ?? true;
    this.trustEnv = opts.trust_env ?? true;
    const limits = opts.limits ?? new Limits({ max_connections: 100, max_keepalive_connections: 20, keepalive_expiry: 5.0 });
    const agentOpts: http.AgentOptions = {
      keepAlive: true,
      maxSockets: limits.max_connections ?? Infinity,
      maxFreeSockets: limits.max_keepalive_connections ?? 256,
      timeout: limits.keepalive_expiry === null ? undefined : limits.keepalive_expiry * 1000,
    };
    this.httpAgent = new http.Agent(agentOpts);
    this.tlsTrust = tlsTrustOptions(this.verify, this.trustEnv);
    this.httpsAgent = new https.Agent({ ...agentOpts, rejectUnauthorized: this.verify, ...this.tlsTrust });
  }

  async aclose(): Promise<void> {
    this.closed = true;
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
    for (const s of this.h2Sessions.values()) {
      try {
        s.close();
      } catch {
        /* ignore */
      }
    }
    this.h2Sessions.clear();
  }

  async handleAsyncRequest(request: Request): Promise<Response> {
    const scheme = request.url.scheme;
    if (request.url._deferred !== null && (scheme === "http" || scheme === "https" || scheme === "ws" || scheme === "wss")) {
      if (request.url._deferred.kind === "port") throw new Error("unhandled errors in a TaskGroup (1 sub-exception)");
      throw new ConnectError("[Errno -2] Name or service not known", { request });
    }
    if (scheme !== "http" && scheme !== "https" && scheme !== "ws" && scheme !== "wss") {
      throw new UnsupportedProtocol(
        scheme === ""
          ? "Request URL is missing an 'http://' or 'https://' protocol."
          : `Request URL has an unsupported protocol '${scheme}://'.`,
        { request },
      );
    }
    const t: TimeoutDict = request.extensions.timeout ?? {
      connect: DEFAULT_TIMEOUT_SECONDS,
      read: DEFAULT_TIMEOUT_SECONDS,
      write: DEFAULT_TIMEOUT_SECONDS,
      pool: DEFAULT_TIMEOUT_SECONDS,
    };
    // anyio's `fail_after(<= 0)` expires at the first checkpoint, before anything is sent
    if (t.connect !== null && t.connect <= 0) throw new ConnectTimeout("", { request });
    const selected = this.trustEnv ? proxyForUrl(request.url) : null;
    if (selected === UNRESOLVABLE_PROXY) throw new ConnectError("[Errno -2] Name or service not known", { request });
    const proxy = selected;
    if (!proxy && (scheme === "https" || scheme === "wss") && this.http2Enabled) {
      const origin = request.url._u.origin;
      if (!this.h1Origins.has(origin)) {
        const viaH2 = await this.tryHttp2(request, t, origin);
        if (viaH2) return viaH2;
      }
    }
    return this.http1(request, t, proxy);
  }

  // ---- HTTP/1.1 ----

  /** httpcore's `TunnelHTTPConnection`: `CONNECT host:port` over a fresh connection to the proxy. */
  private async openTunnel(request: Request, proxy: globalThis.URL, t: TimeoutDict): Promise<net.Socket> {
    const target = request.url._u;
    const authority = `${target.hostname}:${target.port || "443"}`;
    const lines = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`, "Accept: */*"];
    if (proxy.username) {
      const cred = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
      lines.push(`Proxy-Authorization: Basic ${Buffer.from(cred, "utf-8").toString("base64")}`);
    }
    const proxyHost = proxy.hostname.replace(/^\[|\]$/g, "");
    const proxyPort = Number(proxy.port || (proxy.protocol === "https:" ? 443 : 80));

    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const sock =
        proxy.protocol === "https:"
          ? tls.connect({ host: proxyHost, port: proxyPort, servername: net.isIP(proxyHost) ? undefined : proxyHost, rejectUnauthorized: this.verify, ...this.tlsTrust })
          : net.connect({ host: proxyHost, port: proxyPort });
      const timer = t.connect === null ? null : clampedTimeout(() => {
        sock.destroy();
        reject(new ConnectTimeout("", { request }));
      }, t.connect * 1000);
      sock.once(proxy.protocol === "https:" ? "secureConnect" : "connect", () => {
        if (timer) clearTimeout(timer);
        sock.removeAllListeners("error");
        resolve(sock);
      });
      sock.once("error", (e) => {
        if (timer) clearTimeout(timer);
        sock.destroy();
        reject(new ConnectError(connectErrorText(e, proxy.hostname), { request }));
      });
    });

    return new Promise<net.Socket>((resolve, reject) => {
      let received: Buffer = Buffer.alloc(0);
      let timer: NodeJS.Timeout | null = null;
      const done = (fn: () => void): void => {
        if (timer) clearTimeout(timer);
        socket.off("data", onData);
        socket.off("end", onEnd);
        socket.off("close", onEnd);
        socket.off("error", onError);
        fn();
      };
      const armRead = (): void => {
        if (timer) clearTimeout(timer);
        if (t.read === null) return;
        timer = clampedTimeout(() => done(() => { socket.destroy(); reject(new ReadTimeout("", { request })); }), t.read * 1000);
      };
      const onData = (chunk: Buffer): void => {
        received = Buffer.concat([received, chunk]);
        const bad = h11HeadError(received);
        if (bad !== null) {
          done(() => { socket.destroy(); reject(new RemoteProtocolError(bad, { request })); });
          return;
        }
        const blank = /\n\r?\n/.exec(received.toString("latin1"));
        if (blank === null) {
          armRead();
          return;
        }
        const headEnd = blank.index + blank[0].length;
        const statusLine = received.toString("latin1", 0, received.indexOf(0x0a)).replace(/\r$/, "");
        const sm = /^HTTP\/[0-9]\.[0-9] ([0-9]{3})(?: (.*))?$/s.exec(statusLine);
        const status = Number(sm?.[1] ?? 0);
        const reason = (sm?.[2] ?? "").replace(/[^\x00-\x7f]/g, "");
        done(() => {
          if (status < 200 || status > 299) {
            socket.destroy();
            reject(new ProxyError(`${status} ${reason}`, { request }));
            return;
          }
          const rest = received.subarray(headEnd);
          socket.pause();
          if (rest.length) socket.unshift(rest);
          resolve(socket);
        });
      };
      const onEnd = (): void =>
        done(() => {
          socket.destroy();
          reject(new RemoteProtocolError("Server disconnected without sending a response.", { request }));
        });
      const onError = (e: NodeJS.ErrnoException): void =>
        done(() => {
          socket.destroy();
          reject(e.code === "ECONNRESET" ? new ReadError("", { request }) : new ReadError(mapReadErrorText(e), { request }));
        });
      socket.on("data", onData);
      socket.on("end", onEnd);
      socket.on("close", onEnd);
      socket.on("error", onError);
      armRead();
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    });
  }

  private async http1(request: Request, t: TimeoutDict, proxy: globalThis.URL | null): Promise<Response> {
    const u = request.url._u;
    const isHttps = u.protocol === "https:" || u.protocol === "wss:";
    const headers = outgoingHeaders(request);
    let agent: http.Agent | false | undefined = isHttps ? this.httpsAgent : this.httpAgent;
    const reqOpts: https.RequestOptions & { createConnection?: unknown } = {
      method: request.method,
      headers: headers as http.OutgoingHttpHeaders,
      setHost: false,
      insecureHTTPParser: true,
      maxHeaderSize: H11_MAX_INCOMPLETE_EVENT_SIZE + H11_READ_CHUNK,
    };
    let socketForTunnel: net.Socket | null = null;

    if (proxy && isHttps) {
      socketForTunnel = await this.openTunnel(request, proxy, t);
      const tunnelAgent = new https.Agent({ keepAlive: false });
      (tunnelAgent as { createConnection: unknown }).createConnection = () =>
        tls.connect({
          socket: socketForTunnel as net.Socket,
          servername: net.isIP(u.hostname) ? undefined : u.hostname,
          rejectUnauthorized: this.verify,
          ...this.tlsTrust,
        });
      agent = tunnelAgent;
      reqOpts.host = u.hostname.replace(/^\[|\]$/g, "");
      reqOpts.port = u.port || 443;
      reqOpts.path = u.pathname + u.search;
      reqOpts.servername = net.isIP(u.hostname) ? undefined : u.hostname;
    } else if (proxy) {
      reqOpts.host = proxy.hostname.replace(/^\[|\]$/g, "");
      reqOpts.port = proxy.port || 80;
      reqOpts.path = u.href;
      if (proxy.username) {
        headers["Proxy-Authorization"] =
          "Basic " + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64");
      }
    } else {
      reqOpts.host = u.hostname.replace(/^\[|\]$/g, "");
      reqOpts.port = u.port || (isHttps ? 443 : 80);
      reqOpts.path = u.pathname + u.search;
      if (isHttps && !net.isIP(u.hostname)) reqOpts.servername = u.hostname;
    }
    reqOpts.agent = agent;
    if (proxy === null && isHttps) {
      (reqOpts as https.RequestOptions).rejectUnauthorized = this.verify;
      Object.assign(reqOpts, this.tlsTrust);
    }

    const lib = isHttps ? https : http;
    const hostForErr = u.hostname;

    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const tunnelled = proxy !== null && isHttps;
      let connected = false;
      let connectTimer: NodeJS.Timeout | null = null;
      let readTimer: NodeJS.Timeout | null = null;
      let responseStarted = false;
      let bodySent = false;
      let bodyParseError: string | null = null;

      const clearTimers = (): void => {
        if (connectTimer) clearTimeout(connectTimer);
        if (readTimer) clearTimeout(readTimer);
        connectTimer = readTimer = null;
      };
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        reject(err);
      };
      const req = lib.request(reqOpts as https.RequestOptions);

      const armRead = (): void => {
        if (readTimer) clearTimeout(readTimer);
        if (t.read === null) return;
        readTimer = clampedTimeout(() => {
          const err = new ReadTimeout("", { request });
          req.destroy();
          fail(err);
        }, t.read * 1000);
      };

      req.on("socket", (socket) => {
        const alreadyConnected = !tunnelled && !(socket as net.Socket).connecting && (socket as any).readyState === "open";
        if (alreadyConnected) {
          connected = true;
          return;
        }
        if (t.connect !== null) {
          connectTimer = clampedTimeout(() => {
            const err = new ConnectTimeout("", { request });
            req.destroy();
            fail(err);
          }, t.connect * 1000);
        }
        const onConnected = (): void => {
          connected = true;
          if (connectTimer) clearTimeout(connectTimer);
          connectTimer = null;
        };
        if (isHttps) socket.once("secureConnect", onConnected);
        else socket.once("connect", onConnected);
      });

      req.on("error", (err: NodeJS.ErrnoException & { rawPacket?: Buffer }) => {
        if (settled) {
          if (/^HPE_/.test(err.code ?? "") && err.rawPacket) bodyParseError = h11ChunkedBodyError(err.rawPacket);
          return;
        }
        if (!connected && !responseStarted) {
          const tunnelHandshake = tunnelled && /^ERR_SSL/.test(err.code ?? "");
          fail(new ConnectError(tunnelHandshake ? "" : connectErrorText(err, hostForErr), { request }));
        } else if (!responseStarted && /^HPE_/.test(err.code ?? "")) {
          const detail = err.code === "HPE_HEADER_OVERFLOW" ? "Receive buffer too long" : h11HeadError(err.rawPacket ?? Buffer.alloc(0));
          fail(new RemoteProtocolError(detail ?? "Server disconnected without sending a response.", { request }));
        } else if (!responseStarted && err.code === "ECONNRESET" && err.syscall === "read") {
          fail(new ReadError("", { request }));
        } else if (!responseStarted && (err.code === "ECONNRESET" || err.message === "socket hang up") && bodySent) {
          fail(new RemoteProtocolError("Server disconnected without sending a response.", { request }));
        } else if (!responseStarted) {
          fail(bodySent ? new ReadError(mapReadErrorText(err), { request }) : new WriteError(mapReadErrorText(err), { request }));
        } else {
          fail(new ReadError(mapReadErrorText(err), { request }));
        }
      });

      req.on("information", (info) => {
        if (info.statusCode === 101) {
          fail(new RemoteProtocolError("Received server _SWITCH_UPGRADE event without a pending proposal", { request }));
          req.destroy();
        }
      });
      req.on("upgrade", (res, sock) => {
        sock.destroy();
        res.destroy();
        fail(new RemoteProtocolError("Received server _SWITCH_UPGRADE event without a pending proposal", { request }));
      });

      req.on("response", (res) => {
        if (settled) return;
        const invalidHead = h11ParsedHeadError(res.statusCode ?? 0, res.rawHeaders);
        if (invalidHead !== null) {
          res.destroy();
          req.destroy();
          fail(new RemoteProtocolError(invalidHead, { request }));
          return;
        }
        responseStarted = true;
        settled = true;
        if (readTimer) clearTimeout(readTimer);
        readTimer = null;
        const headers: [string, string][] = [];
        for (let i = 0; i < res.rawHeaders.length; i += 2) headers.push([res.rawHeaders[i] as string, res.rawHeaders[i + 1] as string]);
        const iterator = res[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
        const readMs = secs(t.read);
        let received = 0;
        const body = (async function* (): AsyncGenerator<Uint8Array> {
          try {
            for (;;) {
              let r: IteratorResult<Buffer>;
              try {
                r = await withTimeout(iterator.next(), readMs, () => new ReadTimeout("", { request }));
              } catch (e) {
                if (e instanceof ReadTimeout) throw e;
                if (bodyParseError !== null) throw new RemoteProtocolError(bodyParseError, { request });
                const code = errCode(e);
                if (code === "ERR_STREAM_PREMATURE_CLOSE" || (e as Error).message === "aborted") {
                  const declared = headers.find(([k]) => k.toLowerCase() === "content-length")?.[1]?.trim();
                  const chunked = headers.some(([k, v]) => k.toLowerCase() === "transfer-encoding" && /chunked/i.test(v));
                  const detail = !chunked && declared !== undefined ? `received ${received} bytes, expected ${declared}` : "incomplete chunked read";
                  throw new RemoteProtocolError(`peer closed connection without sending complete message body (${detail})`, { request });
                }
                throw new ReadError(mapReadErrorText(e), { request });
              }
              if (r.done) return;
              received += r.value.length;
              yield r.value;
            }
          } finally {
            if (!res.complete || !res.destroyed) res.destroy();
          }
        })();
        const response = new Response(res.statusCode ?? 0, {
          headers,
          stream: body,
          request,
          extensions: { reason_phrase: res.statusMessage ?? "", http_version: `HTTP/${res.httpVersion}` },
          onClose: () => {
            res.destroy();
          },
        });
        response.http_version = `HTTP/${res.httpVersion}`;
        resolve(response);
      });

      // write the body, bounded by the write timeout
      const writeMs = secs(t.write);
      const writeBody = async (): Promise<void> => {
        for await (const chunk of request.stream()) {
          const ok = req.write(chunk);
          if (!ok) {
            await withTimeout(
              new Promise<void>((r) => req.once("drain", () => r())),
              writeMs,
              () => new WriteTimeout("", { request }),
            );
          }
        }
        req.end();
      };
      writeBody().then(
        () => {
          bodySent = true;
          armRead();
        },
        (e) => {
          req.destroy();
          fail(e instanceof Error ? e : new WriteError(String(e), { request }));
        },
      );
    });
  }

  // ---- HTTP/2 over ALPN ----

  private async tryHttp2(request: Request, t: TimeoutDict, origin: string): Promise<Response | null> {
    let session = this.h2Sessions.get(origin);
    if (session && (session.closed || session.destroyed)) {
      this.h2Sessions.delete(origin);
      session = undefined;
    }
    if (!session) {
      const u = request.url._u;
      const port = Number(u.port || 443);
      const host = u.hostname.replace(/^\[|\]$/g, "");
      let socket: tls.TLSSocket;
      try {
        socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
          const s = tls.connect({
            host,
            port,
            servername: net.isIP(host) ? undefined : host,
            ALPNProtocols: ["h2", "http/1.1"],
            rejectUnauthorized: this.verify,
            ...this.tlsTrust,
          });
          const timer = t.connect === null ? null : clampedTimeout(() => {
            s.destroy();
            reject(new ConnectTimeout("", { request }));
          }, t.connect * 1000);
          s.once("secureConnect", () => {
            if (timer) clearTimeout(timer);
            resolve(s);
          });
          s.once("error", (e) => {
            if (timer) clearTimeout(timer);
            reject(new ConnectError(connectErrorText(e, host), { request }));
          });
        });
      } catch (e) {
        throw e;
      }
      if (socket.alpnProtocol !== "h2") {
        socket.destroy();
        this.h1Origins.add(origin);
        return null;
      }
      session = http2.connect(origin, { createConnection: () => socket });
      session.on("error", () => {
        this.h2Sessions.delete(origin);
      });
      session.on("close", () => {
        this.h2Sessions.delete(origin);
      });
      this.h2Sessions.set(origin, session);
    }
    return this.h2Request(session, request, t);
  }

  private h2Request(session: http2.ClientHttp2Session, request: Request, t: TimeoutDict): Promise<Response> {
    const u = request.url._u;
    const hdrs: http2.OutgoingHttpHeaders = {
      ":method": request.method,
      ":path": u.pathname + u.search,
      ":scheme": "https",
      ":authority": u.host,
    };
    for (const [k, v] of request.headers.multiItems()) {
      if (["host", "connection", "transfer-encoding", "keep-alive", "upgrade", "proxy-connection"].includes(k)) continue;
      const prev = hdrs[k];
      hdrs[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [String(prev), v];
    }
    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      let readTimer: NodeJS.Timeout | null = null;
      const fail = (e: Error): void => {
        if (settled) return;
        settled = true;
        if (readTimer) clearTimeout(readTimer);
        reject(e);
      };
      let stream: http2.ClientHttp2Stream;
      try {
        stream = session.request(hdrs);
      } catch (e) {
        fail(new ConnectError((e as Error).message, { request }));
        return;
      }
      if (t.read !== null) {
        readTimer = clampedTimeout(() => {
          stream.close(http2.constants.NGHTTP2_CANCEL);
          fail(new ReadTimeout("", { request }));
        }, t.read * 1000);
      }
      stream.on("error", (e) => fail(new ReadError(mapReadErrorText(e), { request })));
      stream.on("response", (h) => {
        if (settled) return;
        settled = true;
        if (readTimer) clearTimeout(readTimer);
        const headers: [string, string][] = [];
        for (const [k, v] of Object.entries(h)) {
          if (k.startsWith(":")) continue;
          if (Array.isArray(v)) for (const x of v) headers.push([k, x]);
          else if (v !== undefined) headers.push([k, String(v)]);
        }
        const iterator = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
        const readMs = secs(t.read);
        const body = (async function* (): AsyncGenerator<Uint8Array> {
          try {
            for (;;) {
              let r: IteratorResult<Buffer>;
              try {
                r = await withTimeout(iterator.next(), readMs, () => new ReadTimeout("", { request }));
              } catch (e) {
                if (e instanceof ReadTimeout) throw e;
                throw new ReadError(mapReadErrorText(e), { request });
              }
              if (r.done) return;
              yield r.value;
            }
          } finally {
            if (!stream.closed) stream.close();
          }
        })();
        const response = new Response(Number(h[":status"] ?? 0), {
          headers,
          stream: body,
          request,
          onClose: () => {
            if (!stream.closed) stream.close();
          },
        });
        response.http_version = "HTTP/2";
        resolve(response);
      });
      (async () => {
        try {
          for await (const chunk of request.stream()) stream.write(chunk);
          stream.end();
        } catch (e) {
          stream.close();
          fail(e instanceof Error ? e : new WriteError(String(e), { request }));
        }
      })();
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// AsyncClient
// ---------------------------------------------------------------------------------------------------------------------

export interface AsyncClientOptions {
  base_url?: string | URL_;
  http2?: boolean;
  timeout?: Timeout | number | null;
  limits?: Limits;
  follow_redirects?: boolean;
  max_redirects?: number;
  headers?: HeadersInit;
  params?: QueryParamsInit;
  transport?: AsyncBaseTransport | null;
  verify?: boolean;
  trust_env?: boolean;
  [k: string]: unknown;
}

export interface AsyncClientInitHook {
  /** Runs before the client is initialised; may mutate `options` (e.g. inject `transport`). */
  before?: (options: AsyncClientOptions) => void;
  /** Runs after initialisation with the fresh client. */
  after?: (client: AsyncClient, options: AsyncClientOptions) => void;
}

let clientInitHook: AsyncClientInitHook | null = null;
let defaultTransportFactory: ((options: AsyncClientOptions) => AsyncBaseTransport | null) | null = null;

/** Test seam, `patch.object(httpx.AsyncClient, "__init__", ...)`.  Pass `null` to restore. */
export function _setAsyncClientInitHook(hook: AsyncClientInitHook | null): AsyncClientInitHook | null {
  const prev = clientInitHook;
  clientInitHook = hook;
  return prev;
}

/** Test seam used by the pytest-httpx style helper: supplies the transport of clients created without one. */
export function _setDefaultTransportFactory(
  fn: ((options: AsyncClientOptions) => AsyncBaseTransport | null) | null,
): void {
  defaultTransportFactory = fn;
}

export interface SendOptions {
  stream?: boolean;
  follow_redirects?: boolean;
}

function sameOrigin(a: URL_, b: URL_): boolean {
  return a.scheme === b.scheme && a.host === b.host && (a.port ?? (a.scheme === "https" ? 443 : 80)) === (b.port ?? (b.scheme === "https" ? 443 : 80));
}

/** `httpx.AsyncClient` (the parts the SDK uses). */
export class AsyncClient {
  readonly base_url: URL_;
  readonly headers: Headers;
  readonly timeout: Timeout;
  readonly follow_redirects: boolean;
  readonly max_redirects: number;
  readonly http2: boolean;
  readonly limits: Limits;
  private _params: QueryParamsInit;
  private _transport: AsyncBaseTransport;
  private _closed = false;

  constructor(options: AsyncClientOptions = {}) {
    const opts: AsyncClientOptions = { ...options };
    clientInitHook?.before?.(opts);
    const baseUrl = opts.base_url === undefined || opts.base_url === "" ? "" : opts.base_url;
    const parsedBase = baseUrl === "" ? null : new URL_(baseUrl as string | URL_);
    this.base_url =
      parsedBase === null
        ? new URL_("http://__placeholder__/")
        : parsedBase._schemeless !== null || parsedBase._deferred !== null
          ? parsedBase
          : new URL_(this._enforceTrailingSlash(parsedBase));
    this._hasBase = baseUrl !== "";
    this.http2 = opts.http2 ?? false;
    this.limits = opts.limits ?? new Limits({ max_connections: 100, max_keepalive_connections: 20, keepalive_expiry: 5.0 });
    this.timeout =
      opts.timeout === undefined ? new Timeout(DEFAULT_TIMEOUT_SECONDS) : opts.timeout instanceof Timeout ? opts.timeout : new Timeout(opts.timeout);
    this.follow_redirects = opts.follow_redirects ?? false;
    this.max_redirects = opts.max_redirects ?? DEFAULT_MAX_REDIRECTS;
    const h = new Headers([
      ["Accept", "*/*"],
      ["Accept-Encoding", "gzip, deflate, br"],
      ["Connection", "keep-alive"],
      ["User-Agent", USER_AGENT],
    ]);
    h.update(opts.headers);
    this.headers = h;
    this._params = opts.params;
    if (!opts.transport && opts.trust_env !== false && !opts.proxy) validateEnvProxies();
    const injected = opts.transport ?? defaultTransportFactory?.(opts) ?? null;
    this._transport =
      injected ??
      new NodeTransport({ http2: this.http2, limits: this.limits, verify: opts.verify as boolean | undefined, trust_env: opts.trust_env as boolean | undefined });
    clientInitHook?.after?.(this, opts);
  }

  private _hasBase: boolean;

  private _enforceTrailingSlash(url: URL_): string {
    const u = new globalThis.URL(url.toString());
    if (u.search !== "" && !u.search.endsWith("/")) u.search = `${u.search}/`;
    else if (u.search === "" && !u.pathname.endsWith("/")) u.pathname += "/";
    return u.href;
  }

  get is_closed(): boolean {
    return this._closed;
  }

  mergeUrl(url: string | URL_): URL_ {
    const raw = url.toString();
    if (!this._hasBase) return new URL_(raw);
    if ((this.base_url._schemeless !== null || this.base_url._deferred !== null) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) return this.base_url;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) return new URL_(raw);
    const base = new globalThis.URL(this.base_url.toString());
    const hashIdx = raw.indexOf("#");
    const noFrag = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    const qIdx = noFrag.indexOf("?");
    const rawPath = qIdx >= 0 ? noFrag.slice(0, qIdx) : noFrag;
    const rawQuery = qIdx >= 0 ? noFrag.slice(qIdx + 1) : null;
    const rawBase = base.pathname + base.search;
    const merged = rawBase + `${rawPath}${rawQuery !== null ? `?${rawQuery}` : ""}`.replace(/^\/+/, "");
    const split = merged.indexOf("?");
    base.pathname = split >= 0 ? merged.slice(0, split) : merged;
    base.search = split >= 0 ? merged.slice(split + 1) : "";
    if (hashIdx >= 0) base.hash = raw.slice(hashIdx);
    return new URL_(base);
  }

  buildRequest(method: string, url: string | URL_, opts: RequestOptions = {}): Request {
    const merged = this.mergeUrl(url);
    const headers = this.headers.copy();
    headers.update(opts.headers);
    let params: QueryParamsInit = opts.params;
    const hasParams = (p: QueryParamsInit): boolean => paramItems(p).length > 0;
    if (hasParams(params) || hasParams(this._params)) {
      const mergedParams: [string, string][] = paramItems(this._params).filter(([k]) => !paramItems(params).some(([k2]) => k2 === k));
      params = [...mergedParams, ...paramItems(params)];
    } else {
      params = undefined;
    }
    const extensions: RequestExtensions = { ...(opts.extensions ?? {}) };
    const timeout = opts.timeout === undefined ? this.timeout : opts.timeout instanceof Timeout ? opts.timeout : new Timeout(opts.timeout);
    extensions.timeout = timeout.asDict();
    return new Request(method, merged, {
      params,
      headers,
      content: opts.content,
      data: opts.data,
      files: opts.files,
      json: opts.json,
      extensions,
    });
  }

  async send(request: Request, opts: SendOptions = {}): Promise<Response> {
    if (this._closed) {
      throw new RuntimeError("Cannot send a request, as the client has been closed.");
    }
    const follow = opts.follow_redirects ?? this.follow_redirects;
    let response: Response;
    try {
      response = await this._sendHandlingRedirects(request, follow);
    } catch (e) {
      if (e instanceof HTTPError && (e as HTTPError)._request === null) (e as HTTPError)._request = request;
      throw e;
    }
    if (!opts.stream) {
      try {
        await response.aread();
      } catch (e) {
        await response.aclose();
        throw e;
      }
      await response.aclose();
    }
    return response;
  }

  private async _sendHandlingRedirects(request: Request, follow: boolean): Promise<Response> {
    const history: Response[] = [];
    let current = request;
    for (;;) {
      if (history.length > this.max_redirects) throw new TooManyRedirects("Exceeded maximum allowed redirects.", { request: current });
      const userinfoAuth = basicAuthFromUrl(current.url);
      if (userinfoAuth !== null) current.headers.set("Authorization", userinfoAuth);
      const response = await this._transport.handleAsyncRequest(current);
      response.request = current;
      httpxLogger.info('HTTP Request: %s %s "%s %d %s"', current.method, current.url.toString(), response.http_version, response.status_code, response.reason_phrase);
      if (!response.has_redirect_location || !follow) return response;
      const nextReq = this._buildRedirectRequest(current, response);
      try {
        await response.aread();
      } catch (e) {
        await response.aclose();
        throw e;
      }
      await response.aclose();
      history.push(response);
      current = nextReq;
    }
  }

  private _buildRedirectRequest(request: Request, response: Response): Request {
    const location = response.headers.get("location") as string;
    let url: URL_;
    try {
      url = new URL_(new globalThis.URL(location, request.url.toString()).href);
    } catch {
      throw new RemoteProtocolError(`Invalid URL in location header: ${location}.`, { request });
    }
    if (request.url._u.hash && !url._u.hash) url._u.hash = request.url._u.hash;
    let method = request.method;
    const status = response.status_code;
    if (status === 303 && method !== "HEAD") method = "GET";
    if (status === 302 && method !== "HEAD") method = "GET";
    if (status === 301 && method === "POST") method = "GET";
    const headers = request.headers.copy();
    if (!sameOrigin(request.url, url)) headers.delete("authorization");
    headers.delete("host");
    const defaultPort = url.scheme === "https" ? 443 : 80;
    headers.set("Host", url.port !== null && url.port !== defaultPort ? `${url._u.hostname}:${url.port}` : url._u.hostname);
    let content: Uint8Array | undefined;
    if (method !== request.method && method === "GET") {
      headers.delete("content-length");
      headers.delete("transfer-encoding");
      headers.delete("content-type");
    } else if (request._content !== null) {
      content = request._content;
    }
    const next = new Request(method, url, { headers, content, extensions: { ...request.extensions } });
    if (request._stream !== null && method === request.method) {
      next._stream = request._stream;
      next._streamConsumed = request._streamConsumed;
    }
    return next;
  }

  async request(method: string, url: string | URL_, opts: RequestOptions = {}): Promise<Response> {
    const request = this.buildRequest(method, url, opts);
    return this.send(request, { follow_redirects: opts.follow_redirects });
  }

  get(url: string | URL_, opts: RequestOptions = {}): Promise<Response> {
    return this.request("GET", url, opts);
  }
  head(url: string | URL_, opts: RequestOptions = {}): Promise<Response> {
    return this.request("HEAD", url, opts);
  }
  options(url: string | URL_, opts: RequestOptions = {}): Promise<Response> {
    return this.request("OPTIONS", url, opts);
  }
  post(url: string | URL_, opts: RequestOptions = {}): Promise<Response> {
    return this.request("POST", url, opts);
  }
  put(url: string | URL_, opts: RequestOptions = {}): Promise<Response> {
    return this.request("PUT", url, opts);
  }
  patch(url: string | URL_, opts: RequestOptions = {}): Promise<Response> {
    return this.request("PATCH", url, opts);
  }
  delete(url: string | URL_, opts: RequestOptions = {}): Promise<Response> {
    return this.request("DELETE", url, opts);
  }

  /** `client.stream(...)`: an async context manager (`__aenter__` -> response, `__aexit__` closes it). */
  stream(method: string, url: string | URL_, opts: RequestOptions = {}): StreamContext {
    return new StreamContext(this, method, url, opts);
  }

  async aclose(): Promise<void> {
    if (!this._closed) {
      this._closed = true;
      await this._transport.aclose();
    }
  }

  async __aenter__(): Promise<AsyncClient> {
    return this;
  }
  async __aexit__(): Promise<void> {
    await this.aclose();
  }
}

export class StreamContext {
  private response: Response | null = null;
  constructor(
    private readonly client: AsyncClient,
    private readonly method: string,
    private readonly url: string | URL_,
    private readonly opts: RequestOptions,
  ) {}

  async __aenter__(): Promise<Response> {
    const request = this.client.buildRequest(this.method, this.url, this.opts);
    this.response = await this.client.send(request, { stream: true, follow_redirects: this.opts.follow_redirects });
    return this.response;
  }

  async __aexit__(): Promise<void> {
    if (this.response) await this.response.aclose();
  }
}

/** Run `fn` inside `async with client.stream(...) as response` semantics. */
export async function withStream<T>(ctx: StreamContext, fn: (response: Response) => Promise<T>): Promise<T> {
  const response = await ctx.__aenter__();
  try {
    return await fn(response);
  } finally {
    await ctx.__aexit__();
  }
}

/** Resolve a hostname to check connectivity-independent facts (kept as a seam for tests). */
export const _dnsLookup = dns.promises.lookup;

/**
 * Mutable namespace object standing in for the Python `httpx` module.  Library code reaches the client through this
 * object at call time (`new httpx.AsyncClient(...)`) so that tests can replace members exactly like
 * `patch("httpx.AsyncClient", ...)` does.
 */
export const httpx = {
  AsyncClient,
  Timeout,
  Limits,
  Headers,
  Request,
  Response,
  MockTransport,
  NodeTransport,
  URL: URL_,
};

/** `async with cm as value:` helper: `__aenter__`, run the body, `__aexit__` (also on error). */
export async function asyncWith<C extends { __aenter__(): Promise<any>; __aexit__(...args: any[]): Promise<any> }, T>(
  cm: C,
  fn: (value: Awaited<ReturnType<C["__aenter__"]>>) => Promise<T>,
): Promise<T> {
  const value = await cm.__aenter__();
  let ok = false;
  try {
    const result = await fn(value);
    ok = true;
    return result;
  } finally {
    if (ok) await cm.__aexit__(null, null, null);
    else await cm.__aexit__(Error, null, null);
  }
}

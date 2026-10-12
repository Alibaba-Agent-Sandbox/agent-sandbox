/**
 * Port of the `websockets` 17.2 client the Python SDK drives (`websockets.asyncio.client.connect`): sans-IO protocol
 * state machine (HTTP/1.1 handshake response parser, frame parser, close/fail semantics, permessage-deflate), the
 * asyncio connection layer (recv/send/close contexts, keepalive, close timeouts), redirects (max 10), environment
 * proxies (HTTP CONNECT tunnel; SOCKS needs `python-socks`, which the SDK does not bundle) and URI/proxy validation.
 *
 * Exception `message`s equal Python's `str(exc)` so the SDK wrapper can interpolate them unchanged.
 */

import * as crypto from "node:crypto";
import * as dns from "node:dns";
import * as net from "node:net";
import * as os from "node:os";
import * as tls from "node:tls";
import * as zlib from "node:zlib";

import { getLogger } from "../utils/logging.js";
import { connectErrorText } from "./_httpx.js";
import {
  PyUnicodeDecodeError,
  PyValueError,
  getproxiesEnvironment,
  idnaEncode,
  isAscii,
  proxyBypassEnvironment,
  quote,
  unquoteStrict,
  urljoin,
  urlparse,
  utf8DecodeStrict,
} from "./_pyurl.js";
import { defaultContextTrustOptions } from "./_tls.js";

const logger = getLogger("websockets.client");

export const USER_AGENT = "Python/3.11 websockets/17.2";
const MAX_NUM_HEADERS = 128;
const MAX_LINE_LENGTH = 8192;
const MAX_BODY_SIZE = 1_048_576;
const MAX_REDIRECTS = 10;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// --- exceptions ------------------------------------------------------------------------------------------------------

export class WebSocketException extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class InvalidURI extends WebSocketException {
  constructor(uri: string, msg: string) {
    super(`${uri} isn't a valid URI: ${msg}`);
  }
}
export class InvalidProxy extends WebSocketException {
  constructor(proxy: string, msg: string) {
    super(`${proxy} isn't a valid proxy: ${msg}`);
  }
}
export class InvalidHandshake extends WebSocketException {}
export class SecurityError extends InvalidHandshake {}
export class StatusLineTooLong extends SecurityError {}
export class HeaderLineTooLong extends SecurityError {}
export class TooManyHeaders extends SecurityError {}
export class ProxyError extends InvalidHandshake {}
export class InvalidProxyMessage extends ProxyError {}
export class InvalidProxyStatus extends ProxyError {
  constructor(readonly response: Response) {
    super(`proxy rejected connection: HTTP ${response.statusCode}`);
  }
}
export class InvalidMessage extends InvalidHandshake {}
export class InvalidStatus extends InvalidHandshake {
  constructor(readonly response: Response) {
    super(`server rejected WebSocket connection: HTTP ${response.statusCode}`);
  }
}
export class InvalidHeader extends InvalidHandshake {
  constructor(name: string, value: string | null = null) {
    super(value === null ? `missing ${name} header` : value === "" ? `empty ${name} header` : `invalid ${name} header: ${value}`);
  }
}
export class InvalidHeaderFormat extends InvalidHeader {
  constructor(name: string, error: string, header: string, pos: number) {
    super(name, `${error} at ${pos} in ${header}`);
  }
}
export class InvalidHeaderValue extends InvalidHeader {}
export class InvalidUpgrade extends InvalidHeader {}
export class NegotiationError extends InvalidHandshake {}
export class ProtocolError extends WebSocketException {}
export class PayloadTooBig extends WebSocketException {
  private currentSize: number | null = null;
  constructor(
    private readonly size: number | null,
    private maxSize: number,
  ) {
    super("");
    this.refresh();
  }
  setCurrentSize(current: number | null): void {
    this.currentSize = current;
    if (current !== null) this.maxSize += current;
    this.refresh();
  }
  private refresh(): void {
    let m = "frame ";
    if (this.size !== null) m += `with ${this.size} bytes `;
    if (this.currentSize !== null) m += `after reading ${this.currentSize} bytes `;
    this.message = m + `exceeds limit of ${this.maxSize} bytes`;
  }
}
export class EOFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EOFError";
  }
}
export class PyOSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OSError";
  }
}
export class PyTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}
export class PyImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}
export class PyAssertionError extends Error {
  constructor(message = "") {
    super(message);
    this.name = "AssertionError";
  }
}
class CancelledError extends Error {}

export interface Close {
  code: number;
  reason: string;
}

const CLOSE_CODE_EXPLANATIONS: Record<number, string> = {
  1000: "OK",
  1001: "going away",
  1002: "protocol error",
  1003: "unsupported data",
  1005: "no status received [internal]",
  1006: "abnormal closure [internal]",
  1007: "invalid frame payload data",
  1008: "policy violation",
  1009: "message too big",
  1010: "mandatory extension",
  1011: "internal error",
  1012: "service restart",
  1013: "try again later",
  1014: "bad gateway",
  1015: "TLS handshake failure [internal]",
};
const EXTERNAL_CLOSE_CODES = new Set([1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014]);
const OK_CLOSE_CODES = new Set([1000, 1001, 1005]);

export function closeStr(c: Close): string {
  let explanation: string;
  if (c.code >= 3000 && c.code < 4000) explanation = "registered";
  else if (c.code >= 4000 && c.code < 5000) explanation = "private use";
  else explanation = CLOSE_CODE_EXPLANATIONS[c.code] ?? "unknown";
  const result = `${c.code} (${explanation})`;
  return c.reason ? `${result} ${c.reason}` : result;
}

export class ConnectionClosed extends WebSocketException {
  constructor(
    readonly rcvd: Close | null,
    readonly sent: Close | null,
    readonly rcvdThenSent: boolean | null,
    readonly ok: boolean,
  ) {
    super(ConnectionClosed.describe(rcvd, sent, rcvdThenSent));
  }
  static describe(rcvd: Close | null, sent: Close | null, rcvdThenSent: boolean | null): string {
    if (rcvd === null) return sent === null ? "no close frame received or sent" : `sent ${closeStr(sent)}; no close frame received`;
    if (sent === null) return `received ${closeStr(rcvd)}; no close frame sent`;
    return rcvdThenSent ? `received ${closeStr(rcvd)}; then sent ${closeStr(sent)}` : `sent ${closeStr(sent)}; then received ${closeStr(rcvd)}`;
  }
}

// --- headers ---------------------------------------------------------------------------------------------------------

const VALUE_RE = /^[\t\x20-\x7e\x80-\xff]*$/;
const TOKEN_RE = /^[-!#$%&'*+.^_`|~0-9a-zA-Z]+$/;

class MultipleValuesError extends Error {
  constructor(key: string) {
    super(`'${key}'`);
    this.name = "MultipleValuesError";
  }
}

export class Headers {
  private dict = new Map<string, string[]>();
  private list: [string, string][] = [];

  set(key: string, value: string): void {
    if (!VALUE_RE.test(String(value))) throw new InvalidHeaderValue(key, value);
    this.setInsecure(key, value);
  }
  setInsecure(key: string, value: string): void {
    const k = key.toLowerCase();
    const arr = this.dict.get(k);
    if (arr) arr.push(value);
    else this.dict.set(k, [value]);
    this.list.push([key, value]);
  }
  update(items: Record<string, string> | null | undefined): void {
    for (const [k, v] of Object.entries(items ?? {})) this.set(k, v);
  }
  has(key: string): boolean {
    return this.dict.has(key.toLowerCase());
  }
  getAll(key: string): string[] {
    return this.dict.get(key.toLowerCase()) ?? [];
  }
  /** `headers[key]`: raises `KeyError` (returns undefined) / `MultipleValuesError`. */
  get(key: string): string | undefined {
    const v = this.dict.get(key.toLowerCase());
    if (v === undefined) return undefined;
    if (v.length === 1) return v[0];
    throw new MultipleValuesError(key);
  }
  serialize(): Buffer {
    return Buffer.from(this.list.map(([k, v]) => `${k}: ${v}\r\n`).join("") + "\r\n", "latin1");
  }
}

function peekAhead(header: string, pos: number): string | null {
  return pos === header.length ? null : (header[pos] as string);
}
function parseOWS(header: string, pos: number): number {
  const m = /[\t ]*/y;
  m.lastIndex = pos;
  m.exec(header);
  return m.lastIndex;
}
function parseToken(header: string, pos: number, name: string): [string, number] {
  const m = /[-!#$%&'*+.^_`|~0-9a-zA-Z]+/y;
  m.lastIndex = pos;
  const r = m.exec(header);
  if (!r) throw new InvalidHeaderFormat(name, "expected token", header, pos);
  return [r[0], m.lastIndex];
}
function parseQuotedString(header: string, pos: number, name: string): [string, number] {
  const m = /"(?:[\x09\x20-\x21\x23-\x5b\x5d-\x7e]|\\[\x09\x20-\x7e\x80-\xff])*"/y;
  m.lastIndex = pos;
  const r = m.exec(header);
  if (!r) throw new InvalidHeaderFormat(name, "expected quoted string", header, pos);
  return [r[0].slice(1, -1).replace(/\\([\x09\x20-\x7e\x80-\xff])/g, "$1"), m.lastIndex];
}
function parseList<T>(parseItem: (h: string, p: number, n: string) => [T, number], header: string, start: number, name: string): T[] {
  let pos = start;
  while (peekAhead(header, pos) === ",") pos = parseOWS(header, pos + 1);
  const items: T[] = [];
  for (;;) {
    const [item, p] = parseItem(header, pos, name);
    pos = p;
    items.push(item);
    pos = parseOWS(header, pos);
    if (pos === header.length) break;
    if (peekAhead(header, pos) === ",") pos = parseOWS(header, pos + 1);
    else throw new InvalidHeaderFormat(name, "expected comma", header, pos);
    while (peekAhead(header, pos) === ",") pos = parseOWS(header, pos + 1);
    if (pos === header.length) break;
  }
  return items;
}
const parseConnection = (h: string): string[] => parseList(parseToken, h, 0, "Connection");
function parseUpgradeProtocol(header: string, pos: number, name: string): [string, number] {
  const m = /[-!#$%&'*+.^_`|~0-9a-zA-Z]+(?:\/[-!#$%&'*+.^_`|~0-9a-zA-Z]+)?/y;
  m.lastIndex = pos;
  const r = m.exec(header);
  if (!r) throw new InvalidHeaderFormat(name, "expected protocol", header, pos);
  return [r[0], m.lastIndex];
}
const parseUpgrade = (h: string): string[] => parseList(parseUpgradeProtocol, h, 0, "Upgrade");

type ExtensionParam = [string, string | null];
type ExtensionHeader = [string, ExtensionParam[]];
function parseExtensionItemParam(header: string, start: number, name: string): [ExtensionParam, number] {
  let [pname, pos] = parseToken(header, start, name);
  pos = parseOWS(header, pos);
  let value: string | null = null;
  if (peekAhead(header, pos) === "=") {
    pos = parseOWS(header, pos + 1);
    if (peekAhead(header, pos) === '"') {
      const before = pos;
      [value, pos] = parseQuotedString(header, pos, name);
      if (!TOKEN_RE.test(value)) throw new InvalidHeaderFormat(name, "invalid quoted header content", header, before);
    } else {
      [value, pos] = parseToken(header, pos, name);
    }
    pos = parseOWS(header, pos);
  }
  return [[pname, value], pos];
}
function parseExtensionItem(header: string, start: number, name: string): [ExtensionHeader, number] {
  let [ename, pos] = parseToken(header, start, name);
  pos = parseOWS(header, pos);
  const params: ExtensionParam[] = [];
  while (peekAhead(header, pos) === ";") {
    pos = parseOWS(header, pos + 1);
    const [p, np] = parseExtensionItemParam(header, pos, name);
    params.push(p);
    pos = np;
  }
  return [[ename, params], pos];
}
const parseExtension = (h: string): ExtensionHeader[] => parseList(parseExtensionItem, h, 0, "Sec-WebSocket-Extensions");
const parseSubprotocol = (h: string): string[] => parseList(parseToken, h, 0, "Sec-WebSocket-Protocol");

function buildHost(host: string, port: number, secure: boolean, alwaysIncludePort = false): string {
  let h = host;
  if (net.isIPv6(h)) h = `[${h}]`;
  if (alwaysIncludePort || port !== (secure ? 443 : 80)) h = `${h}:${port}`;
  return h;
}
function buildAuthorizationBasic(username: string, password: string): string {
  return "Basic " + Buffer.from(`${username}:${password}`, "utf8").toString("base64");
}

// --- URI / proxy ----------------------------------------------------------------------------------------------------

export interface WebSocketURI {
  secure: boolean;
  host: string;
  port: number;
  path: string;
  query: string;
  username: string | null;
  password: string | null;
}
const resourceName = (u: WebSocketURI): string => (u.path || "/") + (u.query ? "?" + u.query : "");

const DELIMS = ":/?#[]@!$&'()*+,;=";

export function parseUri(uri: string): WebSocketURI {
  const parsed = urlparse(uri);
  if (parsed.scheme !== "ws" && parsed.scheme !== "wss") throw new InvalidURI(uri, "scheme isn't ws or wss");
  if (parsed.hostname === null) throw new InvalidURI(uri, "hostname isn't provided");
  if (parsed.fragment !== "") throw new InvalidURI(uri, "fragment identifier is meaningless");
  const secure = parsed.scheme === "wss";
  let host = parsed.hostname;
  const port = parsed.port || (secure ? 443 : 80);
  let path = parsed.path;
  let query = parsed.query;
  let username = parsed.username;
  let password = parsed.password;
  if (username !== null) {
    if (password === null) throw new InvalidURI(uri, "username provided without password");
    username = unquoteStrict(username);
    password = unquoteStrict(password);
  }
  if (!isAscii(uri)) {
    host = idnaEncode(host);
    path = quote(path, DELIMS);
    query = quote(query, DELIMS);
  }
  return { secure, host, port, path, query, username, password };
}

interface Proxy {
  scheme: string;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

function parseProxy(proxy: string): Proxy {
  const parsed = urlparse(proxy);
  if (!["socks5h", "socks5", "socks4a", "socks4", "https", "http"].includes(parsed.scheme)) {
    throw new InvalidProxy(proxy, `scheme ${parsed.scheme} isn't supported`);
  }
  if (parsed.hostname === null) throw new InvalidProxy(proxy, "hostname isn't provided");
  if (parsed.path !== "" && parsed.path !== "/") throw new InvalidProxy(proxy, "path is meaningless");
  if (parsed.query !== "") throw new InvalidProxy(proxy, "query is meaningless");
  if (parsed.fragment !== "") throw new InvalidProxy(proxy, "fragment is meaningless");
  let host = parsed.hostname;
  const port = parsed.port || (parsed.scheme === "https" ? 443 : 80);
  let username = parsed.username;
  let password = parsed.password;
  if (username !== null) {
    if (password === null) throw new InvalidProxy(proxy, "username provided without password");
    username = unquoteStrict(username);
    password = unquoteStrict(password);
  }
  if (!isAscii(proxy)) host = idnaEncode(host);
  return { scheme: parsed.scheme, host, port, username, password };
}

function getProxy(uri: WebSocketURI): string | null {
  const proxies = getproxiesEnvironment();
  if (proxyBypassEnvironment(`${uri.host}:${uri.port}`, proxies)) return null;
  const schemes = uri.secure ? ["wss", "socks", "https"] : ["ws", "socks", "https", "http"];
  for (const scheme of schemes) {
    let proxy = proxies[scheme];
    if (proxy !== undefined) {
      if (scheme === "socks" && proxy.startsWith("http://")) proxy = "socks5h://" + proxy.slice(7);
      return proxy;
    }
  }
  return null;
}

// --- sans-IO: stream reader, HTTP response -------------------------------------------------------------------------

type Gen<T> = Generator<void, T, void>;

function find(buf: Buffer, byte: number, from: number): number {
  return buf.indexOf(byte, from);
}

export class StreamReader {
  buffer: Buffer = Buffer.alloc(0);
  eof = false;

  *readLine(m: number, tooLong: new (msg: string) => Error): Gen<Buffer> {
    let p = 0;
    let n = 0;
    for (;;) {
      n = find(this.buffer, 0x0a, p) + 1;
      if (n > 0) break;
      p = this.buffer.length;
      if (p > m) throw new tooLong(`read ${p} bytes, expected no more than ${m} bytes`);
      if (this.eof) throw new EOFError(`stream ends after ${p} bytes, before end of line`);
      yield;
    }
    if (n > m) throw new tooLong(`read ${n} bytes, expected no more than ${m} bytes`);
    const r = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(n);
    return r;
  }

  *readExact(n: number): Gen<Buffer> {
    while (this.buffer.length < n) {
      if (this.eof) throw new EOFError(`stream ends after ${this.buffer.length} bytes, expected ${n} bytes`);
      yield;
    }
    const r = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(n);
    return r;
  }

  *readToEof(m: number, tooLong: new (msg: string) => Error): Gen<Buffer> {
    while (!this.eof) {
      const p = this.buffer.length;
      if (p > m) throw new tooLong(`read ${p} bytes, expected no more than ${m} bytes`);
      yield;
    }
    const r = this.buffer;
    this.buffer = Buffer.alloc(0);
    return r;
  }

  *atEof(): Gen<boolean> {
    for (;;) {
      if (this.buffer.length) return false;
      if (this.eof) return true;
      yield;
    }
  }

  feedData(data: Buffer): void {
    if (this.eof) throw new EOFError("stream ended");
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, data]) : Buffer.from(data);
  }
  feedEof(): void {
    if (this.eof) throw new EOFError("stream ended");
    this.eof = true;
  }
  discard(): void {
    this.buffer = Buffer.alloc(0);
  }
}

export interface Response {
  statusCode: number;
  reasonPhrase: string;
  headers: Headers;
  body: Buffer;
}

function pyIntBytes(raw: Buffer, base: 10 | 16): number {
  const s = raw.toString("latin1");
  const digits = base === 10 ? "[0-9]" : "[0-9a-fA-F]";
  const re = new RegExp(`^[ \\t\\n\\r\\f\\v]*[+-]?(?:0[xX])?${digits}+(?:_${digits}+)*[ \\t\\n\\r\\f\\v]*$`);
  if (!re.test(s) || (base === 10 && /0[xX]/.test(s))) throw new PyValueError(`invalid literal for int() with base ${base}: ${JSON.stringify(s)}`);
  return parseInt(s.replace(/_/g, "").trim(), base);
}

function* parseLine(reader: StreamReader, tooLong: new (msg: string) => Error): Gen<Buffer> {
  const line = yield* reader.readLine(MAX_LINE_LENGTH, tooLong);
  if (!(line.length >= 2 && line[line.length - 2] === 0x0d && line[line.length - 1] === 0x0a)) throw new EOFError("line without CRLF");
  return line.subarray(0, line.length - 2);
}

function* parseHeaders(reader: StreamReader): Gen<Headers> {
  const headers = new Headers();
  let done = false;
  for (let i = 0; i < MAX_NUM_HEADERS + 1; i++) {
    let line: Buffer;
    try {
      line = yield* parseLine(reader, HeaderLineTooLong);
    } catch (e) {
      if (e instanceof EOFError) throw new EOFError("connection closed while reading HTTP headers");
      throw e;
    }
    if (line.length === 0) {
      done = true;
      break;
    }
    const colon = line.indexOf(0x3a);
    if (colon < 0) throw new PyValueError(`invalid HTTP header line: ${line.toString("latin1")}`);
    const rawName = line.subarray(0, colon).toString("latin1");
    let rawValue = line.subarray(colon + 1).toString("latin1");
    if (!TOKEN_RE.test(rawName)) throw new PyValueError(`invalid HTTP header name: ${rawName}`);
    rawValue = rawValue.replace(/^[ \t]+|[ \t]+$/g, "");
    if (!VALUE_RE.test(rawValue)) throw new PyValueError(`invalid HTTP header value: ${rawValue}`);
    headers.setInsecure(rawName, rawValue);
  }
  if (!done) throw new TooManyHeaders(`expected no more than ${MAX_NUM_HEADERS} headers`);
  return headers;
}

function* readBody(status: number, headers: Headers, reader: StreamReader): Gen<Buffer> {
  if ((status >= 100 && status < 200) || status === 204 || status === 304) return Buffer.alloc(0);
  const coding = headers.get("Transfer-Encoding");
  if (coding !== undefined) {
    if (coding !== "chunked") throw new Error(`transfer coding ${coding} isn't supported`);
    const parts: Buffer[] = [];
    let size = 0;
    for (;;) {
      const sizeLine = yield* parseLine(reader, SecurityError);
      const semi = sizeLine.indexOf(0x3b);
      const rawChunkSize = semi >= 0 ? sizeLine.subarray(0, semi) : sizeLine;
      if (rawChunkSize.length > 15) throw new SecurityError(`chunk too large: 0x${rawChunkSize.toString("latin1")} bytes`);
      const chunkSize = pyIntBytes(rawChunkSize, 16);
      if (chunkSize === 0) break;
      if (size + chunkSize > MAX_BODY_SIZE) throw new SecurityError(`chunk too large: ${chunkSize} bytes after ${size} bytes`);
      parts.push(Buffer.from(yield* reader.readExact(chunkSize)));
      size += chunkSize;
      const crlf = yield* reader.readExact(2);
      if (crlf[0] !== 0x0d || crlf[1] !== 0x0a) throw new PyValueError("chunk without CRLF");
    }
    yield* parseHeaders(reader);
    return Buffer.concat(parts);
  }
  const rawLength = headers.get("Content-Length");
  if (rawLength !== undefined) {
    if (rawLength.length > 18) throw new SecurityError(`body too large: ${rawLength} bytes`);
    const length = pyIntBytes(Buffer.from(rawLength, "latin1"), 10);
    if (length > MAX_BODY_SIZE) throw new SecurityError(`body too large: ${length} bytes`);
    return Buffer.from(yield* reader.readExact(length));
  }
  return Buffer.from(yield* reader.readToEof(MAX_BODY_SIZE, SecurityError));
}

function* parseResponse(reader: StreamReader, proxy = false): Gen<Response> {
  let statusLine: Buffer;
  try {
    statusLine = yield* parseLine(reader, StatusLineTooLong);
  } catch (e) {
    if (e instanceof EOFError) throw new EOFError("connection closed while reading HTTP status line");
    throw e;
  }
  const first = statusLine.indexOf(0x20);
  const second = first < 0 ? -1 : statusLine.indexOf(0x20, first + 1);
  if (first < 0 || second < 0) throw new PyValueError(`invalid HTTP status line: ${statusLine.toString("latin1")}`);
  const protocol = statusLine.subarray(0, first).toString("latin1");
  const rawStatus = statusLine.subarray(first + 1, second);
  const rawReason = statusLine.subarray(second + 1);
  if (proxy ? protocol !== "HTTP/1.1" && protocol !== "HTTP/1.0" : protocol !== "HTTP/1.1") {
    throw new PyValueError(`unsupported protocol: ${statusLine.toString("latin1")}`);
  }
  const statusCode = pyIntBytes(rawStatus, 10);
  if (!(statusCode >= 100 && statusCode < 600)) throw new PyValueError(`invalid status code; expected 100–599; got ${rawStatus.toString("latin1")}`);
  if (!VALUE_RE.test(rawReason.toString("latin1"))) throw new PyValueError(`invalid HTTP reason phrase: ${rawReason.toString("latin1")}`);
  const headers = yield* parseHeaders(reader);
  const body = proxy ? Buffer.alloc(0) : yield* readBody(statusCode, headers, reader);
  return { statusCode, reasonPhrase: rawReason.toString("latin1"), headers, body };
}

// --- frames --------------------------------------------------------------------------------------------------------

const CONT = 0x00;
const TEXT = 0x01;
const BINARY = 0x02;
const CLOSE = 0x08;
const PING = 0x09;
const PONG = 0x0a;
const VALID_OPCODES = new Set([CONT, TEXT, BINARY, CLOSE, PING, PONG]);

export interface Frame {
  opcode: number;
  data: Buffer;
  fin: boolean;
  rsv1: boolean;
  rsv2: boolean;
  rsv3: boolean;
}
const frame = (opcode: number, data: Buffer, fin = true): Frame => ({ opcode, data, fin, rsv1: false, rsv2: false, rsv3: false });
const isCtrl = (op: number): boolean => op === CLOSE || op === PING || op === PONG;

function checkFrame(f: Frame): void {
  if (f.rsv1 || f.rsv2 || f.rsv3) throw new ProtocolError("reserved bits must be 0");
  if (isCtrl(f.opcode)) {
    if (f.data.length > 125) throw new ProtocolError("control frame too long");
    if (!f.fin) throw new ProtocolError("fragmented control frame");
  }
}

function checkClose(c: Close): void {
  if (!(EXTERNAL_CLOSE_CODES.has(c.code) || (c.code >= 3000 && c.code < 5000))) throw new ProtocolError("invalid status code");
}

function parseClose(data: Buffer): Close {
  if (data.length >= 2) {
    const code = data.readUInt16BE(0);
    const reason = utf8DecodeStrict(data.subarray(2));
    const close = { code, reason };
    checkClose(close);
    return close;
  }
  if (data.length === 0) return { code: 1005, reason: "" };
  throw new ProtocolError("close frame too short");
}

function serializeClose(c: Close): Buffer {
  checkClose(c);
  const reason = Buffer.from(c.reason, "utf8");
  const out = Buffer.alloc(2 + reason.length);
  out.writeUInt16BE(c.code, 0);
  reason.copy(out, 2);
  return out;
}

function serializeFrame(f: Frame, ext: PerMessageDeflate | null): Buffer {
  checkFrame(f);
  let fr = f;
  if (ext) fr = ext.encode(fr);
  const head1 = (fr.fin ? 0x80 : 0) | (fr.rsv1 ? 0x40 : 0) | (fr.rsv2 ? 0x20 : 0) | (fr.rsv3 ? 0x10 : 0) | fr.opcode;
  const length = fr.data.length;
  let head: Buffer;
  if (length < 126) head = Buffer.from([head1, 0x80 | length]);
  else if (length < 65536) {
    head = Buffer.alloc(4);
    head[0] = head1;
    head[1] = 0x80 | 126;
    head.writeUInt16BE(length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = head1;
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(BigInt(length), 2);
  }
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(length);
  for (let i = 0; i < length; i++) masked[i] = (fr.data[i] as number) ^ (mask[i & 3] as number);
  return Buffer.concat([head, mask, masked]);
}

function* parseFrame(read: StreamReader, maxSize: number | null, ext: PerMessageDeflate | null): Gen<Frame> {
  const head = yield* read.readExact(2);
  const head1 = head[0] as number;
  const head2 = head[1] as number;
  const fin = (head1 & 0x80) !== 0;
  const rsv1 = (head1 & 0x40) !== 0;
  const rsv2 = (head1 & 0x20) !== 0;
  const rsv3 = (head1 & 0x10) !== 0;
  const opcode = head1 & 0x0f;
  if (!VALID_OPCODES.has(opcode)) throw new ProtocolError("invalid opcode");
  if ((head2 & 0x80) !== 0) throw new ProtocolError("incorrect masking");
  let length = head2 & 0x7f;
  if (length === 126) length = (yield* read.readExact(2)).readUInt16BE(0);
  else if (length === 127) length = Number((yield* read.readExact(8)).readBigUInt64BE(0));
  if (maxSize !== null && length > maxSize) throw new PayloadTooBig(length, maxSize);
  const data = Buffer.from(yield* read.readExact(length));
  let fr: Frame = { opcode, data, fin, rsv1, rsv2, rsv3 };
  if (ext) fr = ext.decode(fr, maxSize);
  checkFrame(fr);
  return fr;
}

// --- permessage-deflate ----------------------------------------------------------------------------------------------

const EMPTY_BLOCK = Buffer.from([0x00, 0x00, 0xff, 0xff]);

/**
 * Client side of RFC 7692.  Incoming messages are inflated one at a time with the previous output as the preset
 * dictionary (equivalent to a persistent decoder for whole messages); fragmented compressed messages are inflated when
 * their last fragment arrives.  Outgoing messages are deflated independently (valid under context takeover).
 */
class PerMessageDeflate {
  private window = Buffer.alloc(0);
  private pending: Buffer[] = [];
  private decodeContData = false;
  constructor(
    private readonly remoteNoContextTakeover: boolean,
    private readonly localNoContextTakeover: boolean,
    private readonly remoteMaxWindowBits: number,
    private readonly localMaxWindowBits: number,
  ) {}

  decode(f: Frame, maxSize: number | null): Frame {
    if (isCtrl(f.opcode)) return f;
    if (f.opcode === CONT) {
      if (!this.decodeContData) return f;
      if (f.rsv1) throw new ProtocolError("RSV1 bit set in continuation frame");
      if (f.fin) this.decodeContData = false;
    } else {
      if (!f.rsv1) return f;
      if (!f.fin) this.decodeContData = true;
      if (this.remoteNoContextTakeover) this.window = Buffer.alloc(0);
    }
    this.pending.push(f.data);
    if (!f.fin) return { ...f, data: Buffer.alloc(0), rsv1: false };
    const input = Buffer.concat([...this.pending, EMPTY_BLOCK]);
    this.pending = [];
    let out: Buffer;
    try {
      out = zlib.inflateRawSync(input, {
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
        windowBits: Math.max(9, this.remoteMaxWindowBits),
        maxOutputLength: maxSize === null ? 2 ** 31 - 1 : Math.max(1, maxSize),
        ...(this.window.length ? { dictionary: this.window } : {}),
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") throw new PayloadTooBig(null, maxSize ?? 0);
      throw new ProtocolError("decompression failed");
    }
    this.window = this.remoteNoContextTakeover
      ? Buffer.alloc(0)
      : Buffer.concat([this.window, out]).subarray(-(1 << this.remoteMaxWindowBits));
    return { opcode: f.opcode, data: out, fin: f.fin, rsv1: false, rsv2: f.rsv2, rsv3: f.rsv3 };
  }

  encode(f: Frame): Frame {
    if (isCtrl(f.opcode)) return f;
    const out = zlib.deflateRawSync(f.data, {
      finishFlush: zlib.constants.Z_SYNC_FLUSH,
      windowBits: Math.max(9, this.localMaxWindowBits),
      memLevel: 5,
    });
    const data = f.fin ? out.subarray(0, out.length - 4) : out;
    return { opcode: f.opcode, data, fin: f.fin, rsv1: f.opcode !== CONT, rsv2: f.rsv2, rsv3: f.rsv3 };
  }
}

const MAX_WINDOW_BITS_VALUES = ["8", "9", "10", "11", "12", "13", "14", "15"];

function processDeflateResponse(params: ExtensionParam[], accepted: string[]): PerMessageDeflate {
  if (accepted.includes("permessage-deflate")) throw new NegotiationError("received duplicate permessage-deflate");
  let serverNoCtx = false;
  let clientNoCtx = false;
  let serverBits: number | null = null;
  let clientBits: number | null = null;
  for (const [name, value] of params) {
    if (name === "server_no_context_takeover") {
      if (serverNoCtx) throw new NegotiationError(`duplicate parameter: ${name}`);
      if (value === null) serverNoCtx = true;
      else throw new NegotiationError(invalidParam(name, value));
    } else if (name === "client_no_context_takeover") {
      if (clientNoCtx) throw new NegotiationError(`duplicate parameter: ${name}`);
      if (value === null) clientNoCtx = true;
      else throw new NegotiationError(invalidParam(name, value));
    } else if (name === "server_max_window_bits") {
      if (serverBits !== null) throw new NegotiationError(`duplicate parameter: ${name}`);
      if (value !== null && MAX_WINDOW_BITS_VALUES.includes(value)) serverBits = Number(value);
      else throw new NegotiationError(invalidParam(name, value));
    } else if (name === "client_max_window_bits") {
      if (clientBits !== null) throw new NegotiationError(`duplicate parameter: ${name}`);
      if (value !== null && MAX_WINDOW_BITS_VALUES.includes(value)) clientBits = Number(value);
      else throw new NegotiationError(invalidParam(name, value));
    } else {
      throw new NegotiationError(`invalid parameter name: ${name}`);
    }
  }
  if (clientBits === 8) throw new NegotiationError("unsupported client_max_window_bits = 8, use 9");
  return new PerMessageDeflate(serverNoCtx, clientNoCtx, serverBits ?? 15, clientBits ?? 15);
}

function invalidParam(name: string, value: string | null): string {
  if (value === null) return `missing value for parameter ${name}`;
  if (value === "") return `empty value for parameter ${name}`;
  return `invalid value for parameter ${name}: ${value}`;
}

// --- sans-IO protocol ----------------------------------------------------------------------------------------------

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;
const SEND_EOF = Buffer.alloc(0);

class ClientProtocol {
  state = CONNECTING;
  readonly key = crypto.randomBytes(16).toString("base64");
  readonly reader = new StreamReader();
  readonly events: (Response | Frame)[] = [];
  writes: Buffer[] = [];
  extension: PerMessageDeflate | null = null;
  closeRcvd: Close | null = null;
  closeSent: Close | null = null;
  closeRcvdThenSent: boolean | null = null;
  handshakeExc: Error | null = null;
  eofSent = false;
  currentSize: number | null = null;
  expectContinuationFrame = false;
  parserExc: Error | null = null;
  parser: Generator<void, void, void>;

  constructor(
    readonly uri: WebSocketURI,
    readonly maxSize: number | null = 2 ** 20,
  ) {
    this.parser = this.parse();
    this.parser.next();
  }

  get closeExc(): ConnectionClosed {
    const ok =
      this.closeRcvd !== null &&
      this.closeSent !== null &&
      OK_CLOSE_CODES.has(this.closeRcvd.code) &&
      OK_CLOSE_CODES.has(this.closeSent.code);
    return new ConnectionClosed(this.closeRcvd, this.closeSent, this.closeRcvdThenSent, ok);
  }

  connectRequest(): { path: string; headers: Headers } {
    const headers = new Headers();
    headers.set("Host", buildHost(this.uri.host, this.uri.port, this.uri.secure));
    if (this.uri.username !== null) headers.set("Authorization", buildAuthorizationBasic(this.uri.username, this.uri.password as string));
    headers.set("Upgrade", "websocket");
    headers.set("Connection", "Upgrade");
    headers.set("Sec-WebSocket-Key", this.key);
    headers.set("Sec-WebSocket-Version", "13");
    headers.set("Sec-WebSocket-Extensions", "permessage-deflate; client_max_window_bits");
    return { path: resourceName(this.uri), headers };
  }

  processResponse(response: Response): void {
    if (response.statusCode !== 101) throw new InvalidStatus(response);
    const headers = response.headers;
    const connection = headers.getAll("Connection").flatMap(parseConnection);
    if (!connection.some((v) => v.toLowerCase() === "upgrade")) throw new InvalidUpgrade("Connection", connection.length ? connection.join(", ") : null);
    const upgrade = headers.getAll("Upgrade").flatMap(parseUpgrade);
    if (!(upgrade.length === 1 && (upgrade[0] as string).toLowerCase() === "websocket")) {
      throw new InvalidUpgrade("Upgrade", upgrade.length ? upgrade.join(", ") : null);
    }
    let accept: string | undefined;
    try {
      accept = headers.get("Sec-WebSocket-Accept");
    } catch (e) {
      if (e instanceof MultipleValuesError) throw new InvalidHeader("Sec-WebSocket-Accept", "multiple values");
      throw e;
    }
    if (accept === undefined) throw new InvalidHeader("Sec-WebSocket-Accept");
    const expected = crypto
      .createHash("sha1")
      .update(this.key + GUID)
      .digest("base64");
    if (accept !== expected) throw new InvalidHeaderValue("Sec-WebSocket-Accept", accept);
    this.extension = this.processExtensions(headers);
    this.processSubprotocol(headers);
  }

  private processExtensions(headers: Headers): PerMessageDeflate | null {
    const values = headers.getAll("Sec-WebSocket-Extensions");
    let accepted: PerMessageDeflate | null = null;
    if (values.length) {
      const parsed = values.flatMap(parseExtension);
      const names: string[] = [];
      for (const [name, params] of parsed) {
        if (name !== "permessage-deflate") {
          throw new NegotiationError(`Unsupported extension: name = ${name}, params = ${pyParamsRepr(params)}`);
        }
        try {
          accepted = processDeflateResponse(params, names);
          names.push(name);
        } catch (e) {
          if (e instanceof NegotiationError) {
            throw new NegotiationError(`Unsupported extension: name = ${name}, params = ${pyParamsRepr(params)}`);
          }
          throw e;
        }
      }
    }
    return accepted;
  }

  private processSubprotocol(headers: Headers): void {
    const values = headers.getAll("Sec-WebSocket-Protocol");
    if (values.length) {
      values.flatMap(parseSubprotocol);
      throw new NegotiationError("no subprotocols supported");
    }
  }

  receiveData(data: Buffer): void {
    this.reader.feedData(data);
    this.parser.next();
  }

  receiveEof(): void {
    if (this.reader.eof) return;
    this.reader.feedEof();
    this.parser.next();
  }

  sendText(data: Buffer): void {
    if (this.expectContinuationFrame) throw new ProtocolError("expected a continuation frame");
    this.sendFrame(frame(TEXT, data));
  }
  sendBinary(data: Buffer): void {
    if (this.expectContinuationFrame) throw new ProtocolError("expected a continuation frame");
    this.sendFrame(frame(BINARY, data));
  }
  sendClose(code: number | null, reason = ""): void {
    let close: Close;
    let data: Buffer;
    if (code === null) {
      close = { code: 1005, reason: "" };
      data = Buffer.alloc(0);
    } else {
      close = { code, reason };
      data = serializeClose(close);
    }
    this.sendFrame(frame(CLOSE, data));
    this.closeSent = close;
    this.state = CLOSING;
  }
  sendPing(data: Buffer): void {
    this.sendFrame(frame(PING, data));
  }

  fail(code: number, reason = ""): void {
    if (this.state === OPEN) {
      if (code !== 1006) {
        const close = { code, reason };
        const data = serializeClose(close);
        this.sendFrame(frame(CLOSE, data));
        this.closeSent = close;
        if (this.closeRcvd !== null) this.closeRcvdThenSent = true;
        this.state = CLOSING;
      }
    }
    this.parser = this.discard();
    this.parser.next();
  }

  closeExpected(): boolean {
    if (this.state === OPEN) return false;
    if (this.state === CLOSING) return true;
    if (this.state === CLOSED) return false;
    return this.eofSent;
  }

  private *parse(): Generator<void, void, void> {
    try {
      if (this.state === CONNECTING) {
        let response: Response | null = null;
        try {
          response = yield* parseResponse(this.reader);
        } catch (exc) {
          if (exc instanceof StatusLineTooLong) {
            this.handshakeExc = exc;
          } else {
            this.handshakeExc = new InvalidMessage("did not receive a valid HTTP response");
          }
          this.sendEof();
          this.parser = this.discard();
          this.parser.next();
          yield;
        }
        try {
          this.processResponse(response as Response);
        } catch (exc) {
          if (exc instanceof InvalidHandshake) {
            this.events.push(response as Response);
            this.handshakeExc = exc;
            this.sendEof();
            this.parser = this.discard();
            this.parser.next();
            yield;
          } else throw exc;
        }
        this.state = OPEN;
        this.events.push(response as Response);
      }
      for (;;) {
        if (yield* this.reader.atEof()) throw new EOFError("unexpected end of stream");
        let maxSize: number | null = null;
        if (this.maxSize !== null) maxSize = this.currentSize === null ? this.maxSize : this.maxSize - this.currentSize;
        const f = yield* parseFrame(this.reader, maxSize, this.extension);
        this.recvFrame(f);
      }
    } catch (exc) {
      if (exc instanceof ProtocolError) {
        this.fail(1002, exc.message);
        this.parserExc = exc;
      } else if (exc instanceof EOFError) {
        this.fail(1006, exc.message);
        this.parserExc = exc;
      } else if (exc instanceof PyUnicodeDecodeError) {
        this.fail(1007, `${exc.reason} at position ${exc.start}`);
        this.parserExc = exc;
      } else if (exc instanceof PayloadTooBig) {
        exc.setCurrentSize(this.currentSize);
        this.fail(1009, exc.message);
        this.parserExc = exc;
      } else {
        logger.error("parser failed %s", (exc as Error).stack ?? String(exc));
        this.fail(1011);
        this.parserExc = exc as Error;
      }
    }
    yield;
    throw new PyAssertionError("parse() shouldn't step after error");
  }

  private *discard(): Generator<void, void, void> {
    while (!(yield* this.reader.atEof())) this.reader.discard();
    if (this.state !== CONNECTING) this.sendEof();
    this.state = CLOSED;
    yield;
    throw new PyAssertionError("discard() shouldn't step after EOF");
  }

  private recvFrame(f: Frame): void {
    if (f.opcode === TEXT || f.opcode === BINARY) {
      if (this.currentSize !== null) throw new ProtocolError("expected a continuation frame");
      if (!f.fin) this.currentSize = f.data.length;
    } else if (f.opcode === CONT) {
      if (this.currentSize === null) throw new ProtocolError("unexpected continuation frame");
      if (f.fin) this.currentSize = null;
      else this.currentSize += f.data.length;
    } else if (f.opcode === PING) {
      this.sendFrame(frame(PONG, f.data));
    } else if (f.opcode === PONG) {
      /* nothing */
    } else if (f.opcode === CLOSE) {
      this.closeRcvd = parseClose(f.data);
      if (this.state === CLOSING) this.closeRcvdThenSent = false;
      if (this.currentSize !== null) throw new ProtocolError("incomplete fragmented message");
      if (this.state === OPEN) {
        this.sendFrame(frame(CLOSE, f.data));
        this.closeSent = this.closeRcvd;
        this.closeRcvdThenSent = true;
        this.state = CLOSING;
      }
      this.parser = this.discard();
      this.parser.next();
    } else {
      throw new PyAssertionError(`unexpected opcode: ${f.opcode.toString(16).padStart(2, "0")}`);
    }
    this.events.push(f);
  }

  private sendFrame(f: Frame): void {
    this.writes.push(serializeFrame(f, this.extension));
  }

  private sendEof(): void {
    this.eofSent = true;
    this.writes.push(SEND_EOF);
  }
}

function pyParamsRepr(params: ExtensionParam[]): string {
  const q = (s: string): string => `'${s}'`;
  return `[${params.map(([n, v]) => `(${q(n)}, ${v === null ? "None" : q(v)})`).join(", ")}]`;
}

// --- asyncio-like helpers ------------------------------------------------------------------------------------------

function sleep(ms: number, signal: { aborted: boolean; onAbort(cb: () => void): void }): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, Math.max(0, ms));
    t.unref();
    signal.onAbort(() => {
      clearTimeout(t);
      reject(new CancelledError());
    });
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, makeError: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(makeError()), Math.max(0, ms));
    t.unref();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

class Signal {
  aborted = false;
  private cbs: (() => void)[] = [];
  onAbort(cb: () => void): void {
    if (this.aborted) cb();
    else this.cbs.push(cb);
  }
  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    for (const cb of this.cbs.splice(0)) cb();
  }
}

/** Frames of the current message stream (`websockets.asyncio.messages.Assembler`). */
class Assembler {
  private queue: Frame[] = [];
  private waiter: { resolve: () => void; reject: (e: Error) => void } | null = null;
  closed = false;

  put(f: Frame): void {
    this.queue.push(f);
    this.waiter?.resolve();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.waiter?.reject(new EOFError("stream of frames ended"));
  }

  private async next(signal: Signal | null): Promise<Frame> {
    if (!this.queue.length) {
      if (this.closed) throw new EOFError("stream of frames ended");
      await new Promise<void>((resolve, reject) => {
        this.waiter = { resolve, reject };
        signal?.onAbort(() => reject(new CancelledError()));
      }).finally(() => {
        this.waiter = null;
      });
    }
    return this.queue.shift() as Frame;
  }

  async get(signal: Signal | null): Promise<string | Buffer> {
    const frames: Frame[] = [];
    try {
      let f = await this.next(signal);
      frames.push(f);
      while (!f.fin) {
        f = await this.next(signal);
        frames.push(f);
      }
    } catch (e) {
      if (e instanceof CancelledError) this.queue.unshift(...frames);
      throw e;
    }
    const data = frames.length === 1 ? (frames[0] as Frame).data : Buffer.concat(frames.map((x) => x.data));
    if ((frames[0] as Frame).opcode === TEXT) return utf8DecodeStrict(data);
    return data;
  }
}

// --- connection ----------------------------------------------------------------------------------------------------

export { CancelledError };

function tlsErrorText(e: NodeJS.ErrnoException, host: string): string {
  const code = e.code ?? "";
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID" && net.isIP(host)) {
    return `[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: IP address mismatch, certificate is not valid for '${host}'. (_ssl.c:1016)`;
  }
  const m = /^ERR_SSL_(.+)$/.exec(code);
  if (m) return `[SSL: ${m[1]}] ${(m[1] as string).toLowerCase().replace(/_/g, " ")} (_ssl.c:1016)`;
  return connectErrorText(e, host).replace("(_ssl.c:1006)", "(_ssl.c:1016)");
}

function errnoNumber(code: string | undefined): number {
  const n = code ? (os.constants.errno as Record<string, number>)[code] : undefined;
  return n ?? 0;
}

async function resolveAddresses(host: string): Promise<{ address: string; family: number }[]> {
  const fam = net.isIP(host);
  if (fam) return [{ address: host, family: fam }];
  try {
    return await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EAI_AGAIN") throw new PyOSError("[Errno -3] Temporary failure in name resolution");
    if (code === "ENOTFOUND" || code === "EAI_NONAME") throw new PyOSError("[Errno -2] Name or service not known");
    throw new PyOSError(connectErrorText(e, host));
  }
}

function connectOne(address: string, family: number, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: address, port, family, autoSelectFamily: false });
    const onError = (e: NodeJS.ErrnoException): void => {
      sock.destroy();
      const where = family === 6 ? `('${address}', ${port}, 0, 0)` : `('${address}', ${port})`;
      reject(new PyOSError(`[Errno ${errnoNumber(e.code)}] Connect call failed ${where}`));
    };
    sock.once("error", onError);
    sock.once("connect", () => {
      sock.removeListener("error", onError);
      sock.setNoDelay(true);
      resolve(sock);
    });
  });
}

/** `loop.create_connection(host, port)`: every resolved address is tried in order. */
async function connectTcp(host: string, port: number): Promise<net.Socket> {
  const addrs = await resolveAddresses(host);
  const errors: PyOSError[] = [];
  for (const a of addrs) {
    try {
      return await connectOne(a.address, a.family, port);
    } catch (e) {
      errors.push(e as PyOSError);
    }
  }
  if (errors.length === 1) throw errors[0];
  const first = (errors[0] as PyOSError).message;
  if (errors.every((e) => e.message === first)) throw errors[0];
  throw new PyOSError(`Multiple exceptions: ${errors.map((e) => e.message).join(", ")}`);
}

function startTls(socket: net.Socket, host: string): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    let trust: tls.ConnectionOptions;
    try {
      trust = defaultContextTrustOptions();
    } catch (e) {
      socket.destroy();
      reject(e);
      return;
    }
    const opts: tls.ConnectionOptions = { socket, host, ...trust };
    if (!net.isIP(host)) opts.servername = host;
    const t = tls.connect(opts);
    const onError = (e: NodeJS.ErrnoException): void => {
      t.destroy();
      socket.destroy();
      reject(new PyOSError(tlsErrorText(e, host)));
    };
    t.once("error", onError);
    t.once("secureConnect", () => {
      t.removeListener("error", onError);
      resolve(t);
    });
  });
}

function connectHttpProxy(proxy: Proxy, uri: WebSocketURI): Promise<net.Socket> {
  return (async () => {
    let sock: net.Socket = await connectTcp(proxy.host, proxy.port);
    if (proxy.scheme === "https") sock = await startTls(sock, proxy.host);
    const reader = new StreamReader();
    const parser = parseResponse(reader, true);
    const headers = new Headers();
    headers.set("Host", buildHost(uri.host, uri.port, uri.secure));
    headers.set("User-Agent", USER_AGENT);
    if (proxy.username !== null) headers.set("Proxy-Authorization", buildAuthorizationBasic(proxy.username, proxy.password as string));
    const request = Buffer.concat([
      Buffer.from(`CONNECT ${buildHost(uri.host, uri.port, uri.secure, true)} HTTP/1.1\r\n`),
      headers.serialize(),
    ]);
    return await new Promise<net.Socket>((resolve, reject) => {
      let settled = false;
      const finish = (err: Error | null): void => {
        if (settled) return;
        settled = true;
        sock.removeAllListeners("data");
        sock.removeAllListeners("end");
        sock.removeAllListeners("close");
        sock.removeAllListeners("error");
        if (err) {
          sock.destroy();
          reject(err);
        } else {
          sock.pause();
          resolve(sock);
        }
      };
      const run = (): void => {
        if (settled) return;
        try {
          const r = parser.next();
          if (r.done) {
            const response = r.value;
            if (response.statusCode >= 200 && response.statusCode < 300) finish(null);
            else finish(new InvalidProxyStatus(response));
          }
        } catch {
          finish(new InvalidProxyMessage("did not receive a valid HTTP response from proxy"));
        }
      };
      parser.next();
      sock.on("data", (d: Buffer) => {
        reader.feedData(d);
        run();
      });
      const lost = (): void => {
        if (!reader.eof) reader.feedEof();
        run();
      };
      sock.on("end", lost);
      sock.on("close", lost);
      sock.on("error", () => {
        /* connection_lost follows */
      });
      sock.write(request);
    });
  })();
}

const pyErrorStrOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface ConnectOptions {
  additionalHeaders?: Record<string, string> | null;
  pingInterval: number | null;
  pingTimeout: number | null;
  closeTimeout: number | null;
  openTimeout: number | null;
}

export class Connection {
  protocol: ClientProtocol;
  private socket: net.Socket | null = null;
  private tlsSocket = false;
  private readonly assembler = new Assembler();
  private recvExc: unknown = null;
  private closeDeadline: number | null = null;
  private lostResolve!: () => void;
  readonly connectionLost: Promise<void>;
  private lost = false;
  private responseRcvdResolve!: () => void;
  private readonly responseRcvd: Promise<void>;
  private response: Response | null = null;
  private readonly pendingPings = new Map<string, { resolve: (latency: number) => void; reject: (e: Error) => void; at: number }>();
  private readonly keepaliveSignal = new Signal();

  constructor(
    uri: WebSocketURI,
    private readonly opts: ConnectOptions,
  ) {
    this.protocol = new ClientProtocol(uri);
    this.connectionLost = new Promise<void>((r) => (this.lostResolve = r));
    this.responseRcvd = new Promise<void>((r) => (this.responseRcvdResolve = r));
  }

  attach(socket: net.Socket, isTls: boolean): void {
    this.socket = socket;
    this.tlsSocket = isTls;
    socket.removeAllListeners();
    socket.on("data", (d: Buffer) => this.dataReceived(d));
    socket.on("end", () => this.eofReceived());
    socket.on("error", (e: Error) => {
      this.recvExc ??= e;
    });
    socket.on("close", () => this.connectionLostCb());
    socket.resume();
  }

  abort(): void {
    this.socket?.destroy();
  }

  private sendData(): void {
    for (const data of this.protocol.writes.splice(0)) {
      if (data.length) {
        if (this.socket && !this.socket.destroyed && this.socket.writable) this.socket.write(data);
      } else if (!this.tlsSocket && this.socket && !this.socket.destroyed) {
        try {
          this.socket.end();
        } catch {
          /* ignore */
        }
      }
    }
  }

  private dataReceived(data: Buffer): void {
    this.protocol.receiveData(data);
    const events = this.protocol.events.splice(0);
    try {
      this.sendData();
    } catch (e) {
      this.recvExc ??= e;
    }
    if (this.protocol.closeExpected() && this.closeDeadline === null && this.opts.closeTimeout !== null) {
      this.closeDeadline = Date.now() + this.opts.closeTimeout * 1000;
    }
    for (const ev of events) this.processEvent(ev);
  }

  private eofReceived(): void {
    this.protocol.receiveEof();
    const events = this.protocol.events.splice(0);
    this.sendData();
    for (const ev of events) this.processEvent(ev);
    this.socket?.destroy();
  }

  private connectionLostCb(): void {
    if (this.lost) return;
    this.lost = true;
    this.protocol.receiveEof();
    const events = this.protocol.events.splice(0);
    for (const ev of events) this.processEvent(ev);
    this.assembler.close();
    const exc = this.protocol.closeExc;
    for (const p of this.pendingPings.values()) p.reject(exc);
    this.pendingPings.clear();
    this.keepaliveSignal.abort();
    this.lostResolve();
  }

  private processEvent(ev: Response | Frame): void {
    if (this.response === null) {
      this.response = ev as Response;
      this.responseRcvdResolve();
      return;
    }
    const f = ev as Frame;
    if (f.opcode === TEXT || f.opcode === BINARY || f.opcode === CONT) this.assembler.put(f);
    if (f.opcode === PONG) this.acknowledgePings(f.data.toString("latin1"));
  }

  private acknowledgePings(data: string): void {
    if (!this.pendingPings.has(data)) return;
    const now = Date.now();
    const ids: string[] = [];
    for (const [id, p] of this.pendingPings) {
      ids.push(id);
      p.resolve((now - p.at) / 1000);
      if (id === data) break;
    }
    for (const id of ids) this.pendingPings.delete(id);
  }

  async handshake(headersIn: Record<string, string> | null | undefined, userAgent: string): Promise<void> {
    const request = this.protocol.connectRequest();
    request.headers.update(headersIn);
    if (!request.headers.has("User-Agent")) request.headers.set("User-Agent", userAgent);
    await this.sendContext(
      () => {
        this.protocol.writes.push(Buffer.concat([Buffer.from(`GET ${request.path} HTTP/1.1\r\n`, "ascii"), request.headers.serialize()]));
      },
      CONNECTING,
    );
    await Promise.race([this.responseRcvd, this.connectionLost]);
    if (this.protocol.handshakeExc !== null) throw this.protocol.handshakeExc;
  }

  /** `Connection.send_context()`: run `fn`, flush, and surface `ConnectionClosed` when the connection is not usable. */
  async sendContext(fn: () => void, expected = OPEN): Promise<void> {
    let waitForClose = false;
    let raiseCloseExc = false;
    let originalExc: unknown = null;
    if (this.protocol.state === expected) {
      let failed = false;
      try {
        fn();
      } catch (exc) {
        if (exc instanceof ProtocolError) throw exc;
        logger.error("unexpected internal error %s", String(exc));
        raiseCloseExc = true;
        originalExc = exc;
        failed = true;
      }
      if (!failed) {
        if (this.protocol.closeExpected()) {
          waitForClose = true;
          if (this.opts.closeTimeout !== null) this.closeDeadline = Date.now() + this.opts.closeTimeout * 1000;
        }
        try {
          this.sendData();
        } catch (exc) {
          waitForClose = false;
          raiseCloseExc = true;
          originalExc = exc;
        }
      }
    } else {
      waitForClose = true;
      if (this.closeDeadline === null && this.opts.closeTimeout !== null) this.closeDeadline = Date.now() + this.opts.closeTimeout * 1000;
      raiseCloseExc = true;
    }
    if (waitForClose) {
      try {
        if (this.closeDeadline === null) await this.connectionLost;
        else await withTimeout(this.connectionLost, this.closeDeadline - Date.now(), () => new PyTimeoutError("timed out while closing connection"));
      } catch (exc) {
        originalExc = exc;
        raiseCloseExc = true;
        this.recvExc ??= exc;
      }
    }
    if (raiseCloseExc) {
      this.socket?.destroy();
      await this.connectionLost;
      throw this.protocol.closeExc;
    }
  }

  /** `Connection.recv()`; `signal` cancels a pending read without losing data. */
  async recv(signal: Signal | null = null): Promise<string | Buffer> {
    try {
      return await this.assembler.get(signal);
    } catch (e) {
      if (e instanceof CancelledError) throw e;
      if (e instanceof PyUnicodeDecodeError) {
        await this.sendContext(() => this.protocol.fail(1007, `${e.reason} at position ${e.start}`));
      } else if (!(e instanceof EOFError)) throw e;
    }
    await this.connectionLost;
    throw this.protocol.closeExc;
  }

  async send(data: string | Uint8Array): Promise<void> {
    await this.sendContext(() => {
      if (typeof data === "string") this.protocol.sendText(Buffer.from(data, "utf8"));
      else this.protocol.sendBinary(Buffer.from(data));
    });
  }

  async close(code = 1000, reason = ""): Promise<void> {
    try {
      await this.sendContext(() => this.protocol.sendClose(code, reason));
    } catch (e) {
      if (!(e instanceof ConnectionClosed)) throw e;
    }
  }

  private async ping(): Promise<{ pong: Promise<number> }> {
    let id: string;
    do {
      id = crypto.randomBytes(4).toString("latin1");
    } while (this.pendingPings.has(id));
    const pong = new Promise<number>((resolve, reject) => {
      this.pendingPings.set(id, { resolve, reject, at: Date.now() });
    });
    pong.catch(() => {});
    await this.sendContext(() => this.protocol.sendPing(Buffer.from(id, "latin1")));
    return { pong };
  }

  startKeepalive(): void {
    if (this.opts.pingInterval === null) return;
    void this.keepalive();
  }

  private async keepalive(): Promise<void> {
    const interval = this.opts.pingInterval as number;
    let latency = 0;
    try {
      for (;;) {
        await sleep((interval - latency) * 1000, this.keepaliveSignal);
        const { pong: pongReceived } = await this.ping();
        if (this.opts.pingTimeout !== null) {
          try {
            latency = await withTimeout(pongReceived, this.opts.pingTimeout * 1000, () => new PyTimeoutError(""));
          } catch (e) {
            if (!(e instanceof PyTimeoutError)) throw e;
            await this.sendContext(() => this.protocol.fail(1011, "keepalive ping timeout"));
            throw new PyAssertionError("send_context() should wait for connection_lost(), which cancels keepalive()");
          }
        }
      }
    } catch (e) {
      if (!(e instanceof CancelledError) && !(e instanceof ConnectionClosed)) logger.error("keepalive ping failed %s", pyErrorStrOf(e));
    }
  }
}

export { Signal as CancelSignal };

// --- connect() -----------------------------------------------------------------------------------------------------

interface ConnectState {
  uri: string;
  wsUri: WebSocketURI;
  additionalHeaders: Record<string, string> | null;
  active: Connection | null;
  activeSocket: net.Socket | null;
}

async function openTcpConnection(state: ConnectState, opts: ConnectOptions): Promise<Connection> {
  const wsUri = state.wsUri;
  const proxyStr = getProxy(wsUri);
  const connection = new Connection(wsUri, opts);
  const track = (s: net.Socket): void => {
    state.activeSocket = s;
  };
  if (proxyStr !== null) {
    const proxy = parseProxy(proxyStr);
    if (proxy.scheme.startsWith("socks")) throw new PyImportError("connecting through a SOCKS proxy requires python-socks");
    let sock: net.Socket = await connectHttpProxy(proxy, wsUri);
    track(sock);
    let isTls = false;
    if (wsUri.secure) {
      sock = await startTls(sock, wsUri.host);
      isTls = true;
      track(sock);
    }
    connection.attach(sock, isTls);
    return connection;
  }
  let sock: net.Socket = await connectTcp(wsUri.host, wsUri.port);
  track(sock);
  let isTls = false;
  if (wsUri.secure) {
    sock = await startTls(sock, wsUri.host);
    isTls = true;
    track(sock);
  }
  connection.attach(sock, isTls);
  return connection;
}

function processRedirect(state: ConnectState, exc: unknown): Error | string {
  if (
    !(
      exc instanceof InvalidStatus &&
      [300, 301, 302, 303, 307, 308].includes(exc.response.statusCode) &&
      exc.response.headers.has("Location")
    )
  ) {
    return exc as Error;
  }
  const oldWsUri = state.wsUri;
  const location = exc.response.headers.get("Location") as string;
  const newUri = urljoin(state.uri, location);
  const newWsUri = parseUri(newUri);
  if (oldWsUri.secure && !newWsUri.secure) return new SecurityError(`cannot follow redirect to non-secure URI ${newUri}`);
  if (oldWsUri.secure !== newWsUri.secure || oldWsUri.host !== newWsUri.host || oldWsUri.port !== newWsUri.port) {
    if (state.additionalHeaders !== null) {
      const kept: Record<string, string> = {};
      for (const [k, v] of Object.entries(state.additionalHeaders)) {
        if (!["authorization", "cookie", "proxy-authorization"].includes(k.toLowerCase())) kept[k] = v;
      }
      state.additionalHeaders = kept;
    }
  }
  return newUri;
}

/** `websockets.asyncio.client.connect(uri, additional_headers=..., ping_interval=..., ping_timeout=..., close_timeout=10)`. */
export async function connect(
  uri: string,
  opts: {
    additionalHeaders?: Record<string, string> | null;
    pingInterval: number | null;
    pingTimeout: number | null;
    closeTimeout?: number | null;
    openTimeout?: number | null;
  },
): Promise<Connection> {
  const wsUri = parseUri(uri);
  const state: ConnectState = {
    uri,
    wsUri,
    additionalHeaders: opts.additionalHeaders ?? null,
    active: null,
    activeSocket: null,
  };
  const copts: ConnectOptions = {
    additionalHeaders: opts.additionalHeaders,
    pingInterval: opts.pingInterval,
    pingTimeout: opts.pingTimeout,
    closeTimeout: opts.closeTimeout === undefined ? 10 : opts.closeTimeout,
    openTimeout: opts.openTimeout === undefined ? 10 : opts.openTimeout,
  };
  const run = async (): Promise<Connection> => {
    for (let i = 0; i < MAX_REDIRECTS; i++) {
      const connection = await openTcpConnection(state, copts);
      state.active = connection;
      try {
        await connection.handshake(state.additionalHeaders, USER_AGENT);
      } catch (exc) {
        connection.abort();
        const next = processRedirect(state, exc);
        if (next instanceof Error) throw next;
        state.uri = next;
        state.wsUri = parseUri(next);
        continue;
      }
      connection.startKeepalive();
      return connection;
    }
    throw new SecurityError(`more than ${MAX_REDIRECTS} redirects`);
  };
  if (copts.openTimeout === null) return run();
  try {
    return await withTimeout(run(), copts.openTimeout * 1000, () => new PyTimeoutError("timed out during opening handshake"));
  } catch (e) {
    if (e instanceof PyTimeoutError) {
      state.active?.abort();
      state.activeSocket?.destroy();
    }
    throw e;
  }
}

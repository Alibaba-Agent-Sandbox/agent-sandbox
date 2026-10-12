/**
 * The response-head validation `h11` (0.16, the HTTP/1.1 parser behind httpcore/httpx) performs, used to classify and
 * word the errors of heads that Node's llhttp rejects or accepts differently.
 *
 * Python reports every h11 `LocalProtocolError` raised while parsing the response as
 * `httpx.RemoteProtocolError(str(exc))` (CLI code E5003), with texts such as `illegal status line: bytearray(b'...')`.
 */

import { pyBytesRepr } from "../api/_pyerrors.js";

/** httpcore's `MAX_INCOMPLETE_EVENT_SIZE`. */
export const H11_MAX_INCOMPLETE_EVENT_SIZE = 100 * 1024;
/** anyio's `receive(max_bytes=65536)` chunk: a head completing within the chunk that crosses the limit is accepted. */
export const H11_READ_CHUNK = 65536;
const CONTENT_LENGTH_MAX_DIGITS = 20;

const FIELD_VCHAR = "[^\\x00 \\t\\n\\r\\f\\v]";
const TOKEN = "[-!#$%&'*+.^_`|~0-9a-zA-Z]+";
const FIELD_CONTENT = `${FIELD_VCHAR}+(?:[ \\t]+${FIELD_VCHAR}+)*`;
const TOKEN_RE = new RegExp(`^${TOKEN}$`);
const HEADER_RE = new RegExp(`^(${TOKEN}):[ \\t]*(?:(${FIELD_CONTENT}))?[ \\t]*$`);
const STATUS_LINE_RE = new RegExp(`^HTTP/[0-9]\\.[0-9] ([0-9]{3})(?: (?:[ \\t]|${FIELD_VCHAR})*)?$`);

function bytearrayRepr(line: string): string {
  return `bytearray(${pyBytesRepr(Buffer.from(line, "latin1"))})`;
}

/** `_decode_header_lines` + `normalize_and_validate` + the `Response` event checks, over already-split head lines. */
function validateHead(lines: string[]): string | null {
  const status = STATUS_LINE_RE.exec(lines[0] as string);
  if (!status) return `illegal status line: ${bytearrayRepr(lines[0] as string)}`;

  const folded: string[] = [];
  for (const line of lines.slice(1)) {
    const m = /^[ \t]+/.exec(line);
    if (m) {
      if (folded.length === 0) return "continuation line at start of headers";
      folded[folded.length - 1] += ` ${line.slice(m[0].length)}`;
    } else {
      folded.push(line);
    }
  }
  const fields: [string, string][] = [];
  for (const line of folded) {
    const m = HEADER_RE.exec(line);
    if (!m) return `illegal header line: ${bytearrayRepr(line)}`;
    fields.push([m[1] as string, m[2] ?? ""]);
  }

  const code = Number(status[1]);
  if (code < 100) return `InformationalResponse status_code should be in range [100, 200), not ${code}`;
  return normalizeAndValidate(fields);
}

function normalizeAndValidate(fields: [string, string][]): string | null {
  let seenContentLength: string | null = null;
  let sawTransferEncoding = false;
  for (const [rawName, rawValue] of fields) {
    const name = rawName.toLowerCase();
    if (name === "content-length") {
      const lengths = new Set(rawValue.split(",").map((v) => v.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, "")));
      if (lengths.size !== 1) return "conflicting Content-Length headers";
      const value = [...lengths][0] as string;
      if (!/^[0-9]+$/.test(value)) return "bad Content-Length";
      if (value.length > CONTENT_LENGTH_MAX_DIGITS) return "bad Content-Length";
      if (seenContentLength === null) seenContentLength = value;
      else if (seenContentLength !== value) return "conflicting Content-Length headers";
    } else if (name === "transfer-encoding") {
      if (sawTransferEncoding) return "multiple Transfer-Encoding headers";
      if (rawValue.toLowerCase() !== "chunked") return "Only Transfer-Encoding: chunked is supported";
      sawTransferEncoding = true;
    }
  }
  return null;
}

/**
 * The text of the `RemoteProtocolError` Python raises for the response bytes `received` (the start of a response head),
 * or `null` when h11 accepts the head (or needs more data).
 */
export function h11HeadError(received: Buffer): string | null {
  const s = received.toString("latin1");
  if (s.startsWith("\n") || s.startsWith("\r\n")) return "no response line received";
  const blank = /\n\r?\n/.exec(s);
  if (blank === null) {
    if (s.length > 0 && s.charCodeAt(0) < 0x21) return "illegal request line";
    if (s.length > H11_MAX_INCOMPLETE_EVENT_SIZE) return "Receive buffer too long";
    return null;
  }
  const head = s.slice(0, blank.index + blank[0].length);
  const lines = head.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  lines.splice(-2, 2);
  return validateHead(lines);
}

/** The `Response`-event checks over a head Node's parser accepted (`statusCode`, flat `rawHeaders`). */
export function h11ParsedHeadError(statusCode: number, rawHeaders: string[]): string | null {
  if (statusCode < 100) return `InformationalResponse status_code should be in range [100, 200), not ${statusCode}`;
  const fields: [string, string][] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i] as string;
    const value = rawHeaders[i + 1] as string;
    if (!TOKEN_RE.test(name)) return `illegal header line: ${bytearrayRepr(`${name}: ${value}`)}`;
    fields.push([name, value]);
  }
  return normalizeAndValidate(fields);
}

/**
 * The `illegal chunk header` text h11 raises for a malformed chunk-size line in `received` (the packet Node's parser
 * rejected, normally starting with the response head), or `null` when it cannot be determined.
 */
export function h11ChunkedBodyError(received: Buffer): string | null {
  const s = received.toString("latin1");
  const blank = /\n\r?\n/.exec(s);
  if (blank === null) return null;
  const head = s.slice(0, blank.index);
  if (!/^transfer-encoding:[ \t]*chunked[ \t]*$/im.test(head)) return null;
  let pos = blank.index + blank[0].length;
  for (;;) {
    const eol = s.indexOf("\r\n", pos);
    if (eol < 0) return null;
    const line = s.slice(pos, eol + 2);
    const m = /^([0-9A-Fa-f]{1,20})(?:;.*)?\r\n$/s.exec(line);
    if (!m) return `illegal chunk header: ${bytearrayRepr(line)}`;
    const size = parseInt(m[1] as string, 16);
    if (size === 0) return null;
    pos = eol + 2 + size + 2;
    if (pos > s.length) return null;
  }
}

/**
 * envd API protocol — filesystem operations (Connect protocol + HTTP file API) (port of `protocol/filesystem.py`).
 *
 * Connect RPC endpoints（已实测验证）:
 * - /filesystem.Filesystem/Stat — Get file/dir info
 * - /filesystem.Filesystem/MakeDir — Create directory
 * - /filesystem.Filesystem/ListDir — List directory contents
 * - /filesystem.Filesystem/Remove — Remove file/directory
 * - /filesystem.Filesystem/Move — Move/rename file
 * - /filesystem.Filesystem/WatchDir (streaming) — Watch for changes
 *
 * HTTP file API（非 Connect RPC，已实测验证）:
 * - POST /files?path={path}&username=user (multipart) — Upload file → 201
 * - GET /files?path={path}&username=user — Download file → 200
 */

import { FileInfo, FileType, WatchEvent, WatchEventType } from "../../../models/filesystem.js";
import { ConnectCodec } from "../../../transport/codec.js";
import { StreamReader } from "../../../transport/streaming.js";
import { FileNotFoundError_, FileOperationError, PermissionDeniedError } from "../../../models/errors.js";
import type { DataPlaneAuth as EnvdTokenManager } from "../../../transport/auth_contract.js";
import { HTTPStatusError, TimeoutException, type HttpClient } from "../../../transport/http.js";
import { dictGet } from "../../../utils/_pyerrors.js";
import { PyFloat, pyStr } from "../../../utils/_pyformat.js";
import { getLogger } from "../../../utils/logging.js";

const logger = getLogger("protocol.filesystem");
void logger;

const _codec = new ConnectCodec();

// RPC paths（已实测验证）
const _STAT = _codec.buildRpcPath("filesystem", "Filesystem", "Stat");
const _MAKE_DIR = _codec.buildRpcPath("filesystem", "Filesystem", "MakeDir");
const _LIST_DIR = _codec.buildRpcPath("filesystem", "Filesystem", "ListDir");
const _REMOVE = _codec.buildRpcPath("filesystem", "Filesystem", "Remove");
const _MOVE = _codec.buildRpcPath("filesystem", "Filesystem", "Move");
const _WATCH_DIR = _codec.buildRpcPath("filesystem", "Filesystem", "WatchDir");

/**
 * Extract the last valid path segment from `path`.
 *
 * Handles Unix paths, Windows-style back-slashes, trailing separators, and root-only paths. Returns `""` when no
 * meaningful segment exists (e.g. `"/"` or `""` or `"C:\\"`).
 */
export function _nameFromPath(path: string): string {
  if (!path) return "";
  const stripped = path.replace(/[/\\]+$/, "");
  if (!stripped) {
    // Root-only path (e.g. "/", "//", "\\")
    return "";
  }
  const last_sep = Math.max(stripped.lastIndexOf("/"), stripped.lastIndexOf("\\"));
  return last_sep >= 0 ? stripped.slice(last_sep + 1) : stripped;
}

/**
 * envd `EntryInfo.type` is the protobuf enum FILE_TYPE_FILE = 1 / FILE_TYPE_DIRECTORY = 2 and is serialised as a number
 * by envd (0.5.2); the enum names are accepted for other JSON encoders (KI-002).
 */
const _DIRECTORY_TYPES: ReadonlySet<string> = new Set(["2", "FILE_TYPE_DIRECTORY", "DIRECTORY"]);

function _isDirectory(data: Record<string, any>): boolean {
  if (pyTruthy(dictGet(data, "isDir"))) return true;
  const raw = dictGet(data, "type");
  return raw !== null && raw !== undefined && _DIRECTORY_TYPES.has(pyStr(raw).trim().toUpperCase());
}

/** `size` is an int64: protobuf-JSON may render it as a string; anything unparsable is `0` (Python `int(raw)`). */
export function _parseSize(raw: unknown): number {
  if (typeof raw === "boolean") return raw ? 1 : 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.trunc(raw) : 0;
  if (typeof raw === "bigint") return Number(raw);
  if (raw instanceof PyFloat) return Number.isFinite(raw.value) ? Math.trunc(raw.value) : 0;
  if (typeof raw === "string" && /^\s*[+-]?\d+(_\d+)*\s*$/.test(raw)) return Number(raw.replace(/_/g, "").trim());
  return 0;
}

/** Return the entry dict of a `Stat` response (`{"entry": {...}}`; the flat shape is kept for other servers). */
export function _unwrapEntry(response: Record<string, any>): Record<string, any> {
  const data = dictGet(response, "result", response);
  const entry = dictGet(data, "entry");
  return entry !== null && typeof entry === "object" && !Array.isArray(entry) ? entry : data;
}

/**
 * Parse a file info dict from the API response.
 *
 * - **name**: prefers an explicit non-empty `name` from the server; falls back to the last path segment of `path`.
 * - **type**: DIRECTORY when envd's numeric/enum `type` says so (`2` / `FILE_TYPE_DIRECTORY`), or `isDir` is truthy, or
 *   `type == "directory"`.
 */
export function _parseFileInfo(data: Record<string, any>): FileInfo {
  const file_type = _isDirectory(data) ? FileType.DIRECTORY : FileType.FILE;

  let name = dictGet(data, "name") || "";
  if (!name) {
    name = _nameFromPath(dictGet(data, "path", ""));
  }

  return new FileInfo({
    name,
    path: dictGet(data, "path", ""),
    type: file_type,
    size: _parseSize(dictGet(data, "size", 0)),
  });
}

/** A transfer outlived the HTTP timeout (slow link / gateway); say so and name the knob (KI-008). */
function _raiseTransferTimeout(_exc: unknown, verb: string, path: string, size: number): never {
  const sized = size >= 0 ? ` (${size} bytes)` : "";
  throw new FileOperationError(`${verb} ${path}${sized} timed out; the transfer took longer than the HTTP timeout.`, {
    suggestion: "Raise the HTTP timeout (ABX_HTTP_TIMEOUT / http_timeout) or transfer smaller chunks.",
  });
}

/** Translate an envd HTTP error into the SDK's filesystem errors (no URL in the text) (KI-005). */
function _raiseFileError(exc: HTTPStatusError, path: string): never {
  const status = exc.response.status_code;
  if (status === 404) throw new FileNotFoundError_(`File or directory not found in the sandbox: ${path}`);
  if (status === 403) throw new PermissionDeniedError(`Permission denied in the sandbox: ${path}`);
  const detail = Buffer.from(exc.response.content).toString("utf-8").trim().slice(0, 200);
  const message = `envd file operation failed (HTTP ${status}) for ${path}`;
  throw new FileOperationError(detail ? `${message}: ${detail}` : message);
}

function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

const WATCH_TYPE_MAP: Record<string, WatchEventType> = {
  created: WatchEventType.CREATED,
  modified: WatchEventType.MODIFIED,
  deleted: WatchEventType.DELETED,
  renamed: WatchEventType.RENAMED,
  create: WatchEventType.CREATED,
  modify: WatchEventType.MODIFIED,
  delete: WatchEventType.DELETED,
  rename: WatchEventType.RENAMED,
};

const _ENVD_WATCH_TYPES: Readonly<Record<string, WatchEventType>> = {
  EVENT_TYPE_CREATE: WatchEventType.CREATED,
  EVENT_TYPE_WRITE: WatchEventType.MODIFIED,
  EVENT_TYPE_REMOVE: WatchEventType.DELETED,
  EVENT_TYPE_RENAME: WatchEventType.RENAMED,
  EVENT_TYPE_CHMOD: WatchEventType.MODIFIED,
};

/** Parse a streaming watch event frame. */
export function _parseWatchEvent(frame: Record<string, any>): WatchEvent {
  const data = dictGet(frame, "result", frame);
  const filesystem = data !== null && typeof data === "object" ? dictGet(data, "filesystem") : null;
  if (filesystem !== null && typeof filesystem === "object" && !Array.isArray(filesystem)) {
    const raw = String(dictGet(filesystem, "type", "") || "");
    const event_type = Object.prototype.hasOwnProperty.call(_ENVD_WATCH_TYPES, raw) ? _ENVD_WATCH_TYPES[raw]! : WatchEventType.MODIFIED;
    return new WatchEvent({ type: event_type, path: String(dictGet(filesystem, "name", "") || "") });
  }
  const event_type_str = dictGet(data, "type", dictGet(data, "eventType", "modified"));
  const event_type =
    typeof event_type_str === "string" && Object.prototype.hasOwnProperty.call(WATCH_TYPE_MAP, event_type_str)
      ? (WATCH_TYPE_MAP[event_type_str] as WatchEventType)
      : WatchEventType.MODIFIED;

  return new WatchEvent({
    type: event_type,
    path: dictGet(data, "path", ""),
    old_path: dictGet(data, "oldPath"),
  });
}

/**
 * Typed wrapper for envd filesystem operations (Connect protocol + HTTP file API).
 *
 * Connect RPC 用于目录操作；HTTP API 用于文件上传/下载（已实测验证）。
 */
export class FilesystemProtocol {
  _http: HttpClient;

  constructor(http_client: HttpClient) {
    this._http = http_client;
  }

  // --- Connect RPC methods（已实测验证）---

  /** Unary envd call; HTTP errors become SDK filesystem errors for `path`. */
  async _rpc(
    envd_url: string,
    envd_token: EnvdTokenManager,
    rpc_path: string,
    path: string,
    payload: Record<string, unknown> | null = null,
  ): Promise<Record<string, any>> {
    try {
      return await this._http.envdRequest(envd_url, rpc_path, { payload: payload ?? { path }, envd_token });
    } catch (exc) {
      if (exc instanceof HTTPStatusError) _raiseFileError(exc, path);
      throw exc;
    }
  }

  /** Get info about a file or directory. POST envd_url + /filesystem.Filesystem/Stat（已实测验证） */
  async stat(envd_url: string, envd_token: EnvdTokenManager, opts: { path: string }): Promise<FileInfo> {
    const response = await this._rpc(envd_url, envd_token, _STAT, opts.path);
    return _parseFileInfo(_unwrapEntry(response));
  }

  /** List directory contents. POST envd_url + /filesystem.Filesystem/ListDir（已实测验证） */
  async listDir(envd_url: string, envd_token: EnvdTokenManager, opts: { path?: string } = {}): Promise<FileInfo[]> {
    const path = opts.path ?? "/";
    const response = await this._rpc(envd_url, envd_token, _LIST_DIR, path);

    const entries: Array<Record<string, any>> = dictGet(
      response,
      "entries",
      dictGet(dictGet(response, "result", {}), "entries", []),
    );
    if (!entries || !entries.length) {
      // envd answers HTTP 200 with no entries for a missing path (KI-007); Stat tells the cases apart (it raises
      // FileNotFoundError_ when the path does not exist).
      await this.stat(envd_url, envd_token, { path });
    }
    return (entries ?? []).map((entry) => _parseFileInfo(entry));
  }

  /** Create a directory (and parents). POST envd_url + /filesystem.Filesystem/MakeDir（已实测验证） */
  async makeDir(envd_url: string, envd_token: EnvdTokenManager, opts: { path: string }): Promise<void> {
    await this._rpc(envd_url, envd_token, _MAKE_DIR, opts.path);
  }

  /** Remove a file or directory. POST envd_url + /filesystem.Filesystem/Remove（已实测验证） */
  async remove(envd_url: string, envd_token: EnvdTokenManager, opts: { path: string }): Promise<void> {
    await this._rpc(envd_url, envd_token, _REMOVE, opts.path);
  }

  /** Move/rename a file or directory. POST envd_url + /filesystem.Filesystem/Move（已实测验证） */
  async move(
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: { source: string; destination: string },
  ): Promise<void> {
    await this._rpc(envd_url, envd_token, _MOVE, opts.source, {
      source: opts.source,
      destination: opts.destination,
    });
  }

  /**
   * Watch a directory for changes (streaming).
   *
   * POST envd_url + /filesystem.Filesystem/WatchDir (Connect streaming, 已实测验证)
   */
  async watchDir(
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: { path: string },
  ): Promise<StreamReader<WatchEvent>> {
    const raw_stream = this._http.envdStream(envd_url, _WATCH_DIR, { payload: { path: opts.path }, envd_token });
    return new StreamReader(raw_stream, _parseWatchEvent);
  }

  // --- HTTP file API（非 Connect RPC，已实测验证）---

  /**
   * Upload a file via HTTP multipart POST.
   *
   * POST envd_url/files?path={path}&username=user → 201（已实测验证）
   */
  async uploadFile(
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: { path: string; content: Uint8Array; username?: string },
  ): Promise<void> {
    const { path, content, username = "user" } = opts;
    try {
      await this._http.envdHttpRequest(envd_url, "POST", "/files", {
        envd_token,
        params: { path, username },
        files: { file: ["file", content] },
      });
    } catch (exc) {
      if (exc instanceof HTTPStatusError) _raiseFileError(exc, path);
      if (exc instanceof TimeoutException) _raiseTransferTimeout(exc, "Upload to", path, content.length);
      throw exc;
    }
  }

  /**
   * Download a file via HTTP GET.
   *
   * GET envd_url/files?path={path}&username=user → 200（已实测验证）
   */
  async downloadFile(
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: { path: string; username?: string },
  ): Promise<Uint8Array> {
    const { path, username = "user" } = opts;
    try {
      const response = await this._http.envdHttpRequest(envd_url, "GET", "/files", {
        envd_token,
        params: { path, username },
      });
      return response.content;
    } catch (exc) {
      if (exc instanceof HTTPStatusError) _raiseFileError(exc, path);
      if (exc instanceof TimeoutException) _raiseTransferTimeout(exc, "Download of", path, -1);
      throw exc;
    }
  }

  // --- convenience wrappers ---

  /** Check if a file or directory exists (via Stat). */
  async exists(envd_url: string, envd_token: EnvdTokenManager, opts: { path: string }): Promise<boolean> {
    try {
      await this.stat(envd_url, envd_token, opts);
      return true;
    } catch {
      return false;
    }
  }

  /** Alias for stat(). Kept for backward compatibility. */
  async getInfo(envd_url: string, envd_token: EnvdTokenManager, opts: { path: string }): Promise<FileInfo> {
    return this.stat(envd_url, envd_token, opts);
  }

  /** Read file content via HTTP download API. */
  async read(envd_url: string, envd_token: EnvdTokenManager, opts: { path: string }): Promise<Uint8Array> {
    return this.downloadFile(envd_url, envd_token, { path: opts.path });
  }

  /** Read file content as text. */
  async readText(
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: { path: string; encoding?: unknown },
  ): Promise<string> {
    const raw = await this.read(envd_url, envd_token, { path: opts.path });
    return decodeBytes(raw, opts.encoding === undefined ? "utf-8" : opts.encoding);
  }

  /** Write content to a file via HTTP upload API. */
  async write(
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: { path: string; content: string | Uint8Array },
  ): Promise<void> {
    const raw_bytes = typeof opts.content === "string" ? new TextEncoder().encode(opts.content) : opts.content;
    await this.uploadFile(envd_url, envd_token, { path: opts.path, content: raw_bytes });
  }

  /** Deprecated: use move(). Kept for backward compatibility. */
  async rename(
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: { old_path: string; new_path: string },
  ): Promise<void> {
    await this.move(envd_url, envd_token, { source: opts.old_path, destination: opts.new_path });
  }
}

const UTF8_ALIASES = new Set(["utf_8", "utf8", "u8", "utf", "utf8_ucs2", "utf8_ucs4", "cp65001"]);
const UTF8_SIG_ALIASES = new Set(["utf_8_sig"]);
const ASCII_ALIASES = new Set([
  "ascii", "us_ascii", "646", "ansi_x3.4_1968", "ansi_x3_4_1968", "ansi_x3.4_1986", "cp367", "csascii", "ibm367",
  "iso646_us", "iso_646.irv_1991", "iso_ir_6", "us",
]);
const LATIN1_ALIASES = new Set([
  "latin_1", "latin1", "latin", "l1", "iso8859_1", "iso_8859_1", "iso_8859_1_1987", "8859", "cp819", "ibm819",
  "iso_ir_100", "csisolatin1",
]);

function pyTypeName(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (Array.isArray(value)) return "list";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "bigint") return "int";
  if (value instanceof PyFloat) return "float";
  if (typeof value === "object") return "dict";
  return typeof value;
}

/** CPython's UTF-8 decoder error (`start`, `end`, reason) for the first invalid sequence, or `null` when valid. */
function utf8Error(raw: Uint8Array): { start: number; end: number; reason: string } | null {
  const n = raw.length;
  const cont = (i: number, lo = 0x80, hi = 0xbf): boolean => raw[i]! >= lo && raw[i]! <= hi;
  let i = 0;
  while (i < n) {
    const b = raw[i]!;
    if (b < 0x80) {
      i += 1;
      continue;
    }
    if (b < 0xc2 || b > 0xf4) return { start: i, end: i + 1, reason: "invalid start byte" };
    const need = b < 0xe0 ? 1 : b < 0xf0 ? 2 : 3;
    for (let k = 1; k <= need; k += 1) {
      if (i + k >= n) return { start: i, end: n, reason: "unexpected end of data" };
      let lo = 0x80;
      let hi = 0xbf;
      if (k === 1) {
        if (b === 0xe0) lo = 0xa0;
        else if (b === 0xed) hi = 0x9f;
        else if (b === 0xf0) lo = 0x90;
        else if (b === 0xf4) hi = 0x8f;
      }
      if (!cont(i + k, lo, hi)) return { start: i, end: i + k, reason: "invalid continuation byte" };
    }
    i += need + 1;
  }
  return null;
}

/**
 * Python `bytes.decode(encoding)` (strict): exact `TypeError` / `LookupError` / `UnicodeDecodeError` texts for
 * `utf-8` and `ascii`; other codecs go through Node's `TextDecoder` (message text approximated).
 */
export function decodeBytes(raw: Uint8Array, encoding: unknown): string {
  if (typeof encoding !== "string") {
    throw new TypeError(`decode() argument 'encoding' must be str, not ${pyTypeName(encoding)}`);
  }
  if (raw.length === 0) return "";
  const norm = encoding.toLowerCase().replace(/[^a-z0-9.]+/g, "_").replace(/^_+|_+$/g, "");
  if (UTF8_ALIASES.has(norm) || UTF8_SIG_ALIASES.has(norm)) {
    const err = utf8Error(raw);
    if (err) throw new UnicodeDecodeError("utf-8", raw, err.reason, err.start, err.end);
    const text = Buffer.from(raw).toString("utf8");
    return UTF8_SIG_ALIASES.has(norm) && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }
  if (ASCII_ALIASES.has(norm)) {
    for (let i = 0; i < raw.length; i += 1) {
      if (raw[i]! > 0x7f) throw new UnicodeDecodeError("ascii", raw, "ordinal not in range(128)", i, i + 1);
    }
    return Buffer.from(raw).toString("latin1");
  }
  if (LATIN1_ALIASES.has(norm)) return Buffer.from(raw).toString("latin1");
  try {
    return new TextDecoder(norm.replace(/_/g, "-"), { fatal: true, ignoreBOM: true }).decode(raw);
  } catch (err) {
    if (err instanceof RangeError) throw new LookupError(`unknown encoding: ${encoding}`);
    throw new UnicodeDecodeError(encoding, raw, "invalid data", 0, 1);
  }
}

/** Python `UnicodeDecodeError` stand-in (`str()` text identical to CPython). */
export class UnicodeDecodeError extends Error {
  constructor(
    public readonly encoding: string,
    public readonly object: Uint8Array,
    public readonly reason: string,
    public readonly start: number = 0,
    public readonly end: number = 1,
  ) {
    super(
      end === start + 1
        ? `'${encoding}' codec can't decode byte 0x${(object[start] ?? 0).toString(16).padStart(2, "0")} in position ${start}: ${reason}`
        : `'${encoding}' codec can't decode bytes in position ${start}-${end - 1}: ${reason}`,
    );
    this.name = "UnicodeDecodeError";
  }
}

/** Python `LookupError` stand-in (unknown codec). */
export class LookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LookupError";
  }
}

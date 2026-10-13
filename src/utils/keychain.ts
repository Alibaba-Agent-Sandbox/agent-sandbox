/**
 * 密钥安全存储 (port of `utils/keychain.py`).
 *
 * 使用本地 JSON 文件 (~/.abx/secrets.json) 存储密钥，用文件权限 (chmod 600) 保护。
 *
 * WARNING: 存储为 **明文 JSON** 文件，不提供加密保护。在生产环境中请使用其他安全的密钥管理方案。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ValueError } from "../models/value_error.js";
import { _utf8DecodeError, UnicodeDecodeError } from "./_pyos.js";
import { pyJsonDumps, pySorted } from "./_pyformat.js";
import { stdGetLogger } from "./logging.js";

const logger = stdGetLogger("agent_sandbox.utils.keychain");

export const SERVICE_NAME = "agent-sandbox";
export const SECRETS_FILE = path.join(os.homedir(), ".abx", "secrets.json");

/**
 * 密钥存储 — 本地明文 JSON 文件 (chmod 600 保护)。
 *
 * WARNING: 存储为明文 JSON，不提供加密。仅依靠文件系统权限 (chmod 600) 限制访问。仅适合本地开发环境。
 *
 * NOTE: **并发限制**：本实现不使用文件锁，仅适合单进程使用。多进程并发写入可能导致数据丢失。
 *
 * Methods are synchronous (like the Python class). `list_names` -> `listNames`.
 */
export class SecretStore {
  _secrets_file: string;

  constructor(secretsFile?: string | null) {
    this._secrets_file = secretsFile || SECRETS_FILE;
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  /** 存储密钥。 */
  set(name: string, value: string): void {
    this._set_file(name, value);
  }

  /** 获取密钥。 */
  get(name: string): string | null {
    return this._get_file(name);
  }

  /** 删除密钥，返回是否成功删除。 */
  delete(name: string): boolean {
    return this._delete_file(name);
  }

  /** 列出所有密钥名称。 */
  listNames(): string[] {
    const secrets = this._load_file();
    return pySorted(Object.keys(secrets));
  }

  // ---------------------------------------------------------------
  // File-based storage
  // ---------------------------------------------------------------

  private _write_restricted(secrets: Record<string, string>): void {
    // 以受限权限创建文件，避免权限窗口
    const fd = fs.openSync(
      this._secrets_file,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC,
      0o600,
    );
    try {
      fs.writeSync(fd, Buffer.from(pyJsonDumps(secrets, { indent: 2 })));
    } finally {
      fs.closeSync(fd);
    }
  }

  /** 本地文件存储（chmod 600 保护）。 */
  _set_file(name: string, value: string): void {
    fs.mkdirSync(path.dirname(this._secrets_file), { recursive: true });
    const secrets = this._load_file();
    secrets[name] = value;
    this._write_restricted(secrets);
    try {
      fs.chmodSync(this._secrets_file, 0o600);
    } catch {
      logger.warning(
        "Cannot set file permissions (chmod 600) on %s. " +
          "The secrets file is NOT protected by POSIX permissions. " +
          "This is expected on Windows but means secrets are readable " +
          "by other users on this system.",
        this._secrets_file,
      );
    }
  }

  /** 从本地文件读取。 */
  _get_file(name: string): string | null {
    const secrets = this._load_file();
    return Object.prototype.hasOwnProperty.call(secrets, name) ? (secrets[name] as string) : null;
  }

  /** 从本地文件删除，返回是否删除了。 */
  _delete_file(name: string): boolean {
    const secrets = this._load_file();
    if (Object.prototype.hasOwnProperty.call(secrets, name)) {
      delete secrets[name];
      this._write_restricted(secrets);
      try {
        fs.chmodSync(this._secrets_file, 0o600);
      } catch {
        logger.warning(
          "Cannot set file permissions (chmod 600) on %s. " + "The secrets file is NOT protected by POSIX permissions.",
          this._secrets_file,
        );
      }
      return true;
    }
    return false;
  }

  /** 加载本地文件中的所有密钥。 */
  _load_file(): Record<string, string> {
    if (fs.existsSync(this._secrets_file)) {
      let buf: Buffer;
      try {
        buf = fs.readFileSync(this._secrets_file);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== undefined) return {};
        throw e;
      }
      const bad = _utf8DecodeError(buf);
      if (bad !== null) throw new UnicodeDecodeError(bad);
      let data: unknown;
      try {
        data = JSON.parse(buf.toString("utf8"));
      } catch (e) {
        if (e instanceof SyntaxError) return {};
        throw e;
      }
      return pyDict(data);
    }
    return Object.create(null) as Record<string, string>;
  }
}

/** Python `dict(obj)` for a decoded JSON document (mapping, or iterable of 2-item sequences). */
function pyDict(data: unknown): Record<string, string> {
  const out = Object.create(null) as Record<string, string>;
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data)) out[k] = v as string;
    return out;
  }
  if (Array.isArray(data) || typeof data === "string") {
    const items: unknown[] = Array.isArray(data) ? data : Array.from(data);
    items.forEach((item, idx) => {
      let pair: unknown[];
      if (Array.isArray(item)) pair = item;
      else if (typeof item === "string") pair = Array.from(item);
      else throw new TypeError(`cannot convert dictionary update sequence element #${idx} to a sequence`);
      if (pair.length !== 2) {
        throw new ValueError(`dictionary update sequence element #${idx} has length ${pair.length}; 2 is required`);
      }
      const key = pair[0];
      if (key !== null && typeof key === "object") throw new TypeError(`unhashable type: '${Array.isArray(key) ? "list" : "dict"}'`);
      out[typeof key === "string" ? key : pyJsonDumps(key)] = pair[1] as string;
    });
    return out;
  }
  throw new TypeError(`'${data === null ? "NoneType" : typeof data === "number" ? (Number.isInteger(data) ? "int" : "float") : "bool"}' object is not iterable`);
}

/** Files module — filesystem operations in sandboxes (port of `api/files.py`). */

import * as fs from "node:fs";

import type { FileInfo, WatchEvent } from "../models/filesystem.js";
import { DEFAULT_CAPABILITIES } from "../models/template.js";
import type { FilesystemProtocol } from "../protocol/filesystem.js";
import type { SandboxProtocol } from "../protocol/sandbox.js";
import type { EnvdTokenManager } from "../transport/auth.js";
import type { StreamReader } from "../transport/streaming.js";
import { getLogger } from "../utils/logging.js";
import { toOSError } from "../utils/_pyos.js";

const logger = getLogger("api.files");

/**
 * High-level interface for filesystem operations in a sandbox.
 *
 * Wraps FilesystemProtocol and provides convenient file I/O methods including upload/download between local and
 * sandbox filesystems.
 */
export class FilesModule {
  _envd_url: string;
  _envd_token: EnvdTokenManager;
  _fs: FilesystemProtocol;
  _sandbox_protocol: SandboxProtocol | null;
  _sandbox_id: string | null;
  _capabilities: Set<string>;

  constructor(
    envd_url: string,
    envd_token: EnvdTokenManager,
    filesystem_protocol: FilesystemProtocol,
    sandbox_protocol: SandboxProtocol | null = null,
    sandbox_id: string | null = null,
    capabilities: Set<string> | null = null,
  ) {
    this._envd_url = envd_url;
    this._envd_token = envd_token;
    this._fs = filesystem_protocol;
    this._sandbox_protocol = sandbox_protocol;
    this._sandbox_id = sandbox_id;
    this._capabilities = capabilities !== null ? capabilities : new Set(DEFAULT_CAPABILITIES);
  }

  /** Read a file as text (`encoding` default: utf-8). */
  async read(path: string, opts: { encoding?: string } = {}): Promise<string> {
    return this._fs.readText(this._envd_url, this._envd_token, { path, encoding: opts.encoding === undefined ? "utf-8" : opts.encoding });
  }

  /** Read a file as raw bytes. */
  async readBytes(path: string): Promise<Uint8Array> {
    return this._fs.read(this._envd_url, this._envd_token, { path });
  }

  /** Write content (string or bytes) to a file in the sandbox. */
  async write(path: string, content: string | Uint8Array): Promise<void> {
    await this._fs.write(this._envd_url, this._envd_token, { path, content });
  }

  /** List directory contents (default: root). */
  async list(path: string = "/"): Promise<FileInfo[]> {
    return this._fs.listDir(this._envd_url, this._envd_token, { path });
  }

  /** Remove a file or directory. */
  async remove(path: string): Promise<void> {
    await this._fs.remove(this._envd_url, this._envd_token, { path });
  }

  /** Check if a file or directory exists. */
  async exists(path: string): Promise<boolean> {
    return this._fs.exists(this._envd_url, this._envd_token, { path });
  }

  /** Create a directory (including parents). */
  async makeDir(path: string): Promise<void> {
    await this._fs.makeDir(this._envd_url, this._envd_token, { path });
  }

  /** Upload a local file to the sandbox: reads the local file and writes its contents to the sandbox. */
  async upload(local_path: string, remote_path: string): Promise<void> {
    const data = fs.readFileSync(local_path);
    await this.write(remote_path, data);
    logger.debug("Uploaded %s -> %s", local_path, remote_path);
  }

  /** Download a file from the sandbox to local filesystem. */
  async download(remote_path: string, local_path: string): Promise<void> {
    const data = await this.readBytes(remote_path);
    const fd = fs.openSync(local_path, "w");
    try {
      let off = 0;
      while (off < data.length) off += fs.writeSync(fd, data, off, data.length - off);
    } catch (e) {
      // Python's `write_bytes`: only a failed open names the file, a failed write does not
      throw toOSError(e, null);
    } finally {
      fs.closeSync(fd);
    }
    logger.debug("Downloaded %s -> %s", remote_path, local_path);
  }

  /** Watch a directory for filesystem changes. Returns a StreamReader yielding WatchEvent items. */
  async watch(path: string): Promise<StreamReader<WatchEvent>> {
    return this._fs.watchDir(this._envd_url, this._envd_token, { path });
  }

  /** Rename or move a file/directory. Deprecated: use move() instead. */
  async rename(old_path: string, new_path: string): Promise<void> {
    await this.move(old_path, new_path);
  }

  /** Move/rename a file or directory. */
  async move(source: string, destination: string): Promise<void> {
    await this._fs.move(this._envd_url, this._envd_token, { source, destination });
  }

  /** Get info about a file or directory (FileInfo with name, path, type, size). */
  async getInfo(path: string): Promise<FileInfo> {
    return this._fs.getInfo(this._envd_url, this._envd_token, { path });
  }

  /**
   * Get a pre-signed upload URL for a file. Kept for backward compatibility.
   *
   * Warning: returns a URL that requires an `X-Access-Token` header for access.
   */
  async uploadUrl(path: string): Promise<string> {
    return `${this._envd_url}/files?path=${path}&username=user`;
  }

  /**
   * Get a download URL for a file. Kept for backward compatibility.
   *
   * Warning: returns a URL that requires an `X-Access-Token` header for access.
   */
  async downloadUrl(path: string): Promise<string> {
    return `${this._envd_url}/files?path=${path}&username=user`;
  }
}

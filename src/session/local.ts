/**
 * Local filesystem session store (port of `session/local.py`).
 *
 * Sessions are persisted as JSON files under `~/.abx/sessions/`. Concurrent access is protected by a lock beside each
 * file: the Python original used `filelock` (`flock` on `<file>.lock`, 5 s timeout). Node has no `flock`, so the
 * `<file>.lock` file is still created (same artefact on disk) and mutual exclusion is taken through an atomic
 * `mkdir <file>.lock.d` with the same 5 s timeout (see parity/KNOWN-GAPS.md).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SessionInfo } from "../models/session.js";
import { pyJsonDumps } from "../utils/_pyformat.js";
import { _utf8DecodeError, UnicodeDecodeError } from "../utils/_pyos.js";

export const DEFAULT_DIR: string = path.join(os.homedir(), ".abx", "sessions");

const LOCK_TIMEOUT_MS = 5000;
const LOCK_POLL_MS = 50;

export class LockTimeout extends Error {
  constructor(lock_file: string) {
    super(`The file lock '${lock_file}' could not be acquired.`);
    this.name = "Timeout";
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run `fn` while holding the cross-process lock for `file_path` (the lock file is `<file_path>.lock`). */
export function _withLock<T>(file_path: string, fn: () => T): T {
  const lock_file = `${file_path}.lock`;
  const lock_dir = `${lock_file}.d`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lock_dir);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        const age = Date.now() - fs.statSync(lock_dir).mtimeMs;
        if (age > LOCK_TIMEOUT_MS) {
          fs.rmdirSync(lock_dir);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) throw new LockTimeout(lock_file);
      sleepSync(LOCK_POLL_MS);
    }
  }
  try {
    fs.closeSync(fs.openSync(lock_file, "a", 0o644));
    return fn();
  } finally {
    try {
      fs.rmdirSync(lock_dir);
    } catch {
      // already gone
    }
  }
}

function isAlnum(ch: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(ch);
}

/** File-backed session store (`~/.abx/sessions/`). */
export class LocalSessionStore {
  _base_dir: string;

  constructor(base_dir: string | null = null) {
    this._base_dir = base_dir || DEFAULT_DIR;
    fs.mkdirSync(this._base_dir, { recursive: true });
  }

  _pathFor(name: string): string {
    // Sanitise: replace anything non-alphanumeric / dash / underscore
    const safe = Array.from(name)
      .map((c) => (isAlnum(c) || "-_".includes(c) ? c : "_"))
      .join("");
    return path.join(this._base_dir, `${safe}.json`);
  }

  async save(name: string, session: SessionInfo): Promise<void> {
    const fpath = this._pathFor(name);
    const data = session.modelDump({ mode: "json", by_alias: true });
    _withLock(fpath, () => {
      fs.writeFileSync(fpath, pyJsonDumps(data, { indent: 2, default: (o) => String(o) }), { encoding: "utf8" });
    });
  }

  async load(name: string): Promise<SessionInfo | null> {
    const fpath = this._pathFor(name);
    if (!fs.existsSync(fpath)) return null;
    const raw = _withLock(fpath, () => readTextStrict(fpath));
    return SessionInfo.modelValidateJson(raw);
  }

  async delete(name: string): Promise<void> {
    const fpath = this._pathFor(name);
    const lock_path = `${fpath}.lock`;
    try {
      fs.rmSync(fpath, { force: true });
    } catch {
      // contextlib.suppress(OSError)
    }
    try {
      fs.rmSync(lock_path, { force: true });
    } catch {
      // contextlib.suppress(OSError)
    }
  }

  async listAll(): Promise<SessionInfo[]> {
    const sessions: SessionInfo[] = [];
    let names: string[];
    try {
      names = fs.readdirSync(this._base_dir);
    } catch {
      return sessions;
    }
    const files = names.filter((n) => n.endsWith(".json") && isFile(path.join(this._base_dir, n)));
    files.sort(compareCodePoints);
    for (const fp of files) {
      try {
        const raw = readTextStrict(path.join(this._base_dir, fp));
        sessions.push(SessionInfo.modelValidateJson(raw));
      } catch {
        continue;
      }
    }
    return sessions;
  }
}

/** Python `Path.read_text(encoding="utf-8")`: undecodable bytes raise `UnicodeDecodeError`. */
function readTextStrict(p: string): string {
  const buf = fs.readFileSync(p);
  const bad = _utf8DecodeError(buf);
  if (bad !== null) throw new UnicodeDecodeError(bad);
  return buf.toString("utf8").replace(/\r\n?/g, "\n");
}

/** Python string ordering (by code point) rather than UTF-16 code unit. */
function compareCodePoints(a: string, b: string): number {
  const ca = Array.from(a, (c) => c.codePointAt(0) as number);
  const cb = Array.from(b, (c) => c.codePointAt(0) as number);
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) if (ca[i] !== cb[i]) return (ca[i] as number) < (cb[i] as number) ? -1 : 1;
  return ca.length - cb.length;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

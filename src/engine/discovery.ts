/**
 * Where a running engine announces itself. Clients read this file to find the port and the token; `serve` holds a lock
 * file beside it so concurrent starts leave one engine.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { paths } from "../transport/config_layers.js";

export const ENGINE_PROTOCOL = "abx-engine/1";

export interface EngineRecord {
  protocol: string;
  pid: number;
  host: string;
  port: number;
  token: string;
  version: string;
  started_at: string;
}

export const engineFile = (): string => path.join(paths.abxDir, "engine.json");
export const lockFile = (): string => path.join(paths.abxDir, "engine.lock");
export const logFile = (): string => path.join(paths.abxDir, "engine.log");

export function readRecord(): EngineRecord | null {
  try {
    const data = JSON.parse(fs.readFileSync(engineFile(), "utf-8")) as Partial<EngineRecord>;
    if (data.protocol !== ENGINE_PROTOCOL || typeof data.port !== "number" || typeof data.token !== "string") return null;
    return data as EngineRecord;
  } catch {
    return null;
  }
}

export function writeRecord(record: EngineRecord): void {
  fs.mkdirSync(paths.abxDir, { recursive: true, mode: 0o700 });
  const tmp = `${engineFile()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
  fs.renameSync(tmp, engineFile());
}

export function removeRecord(pid: number): void {
  const current = readRecord();
  if (current !== null && current.pid === pid) fs.rmSync(engineFile(), { force: true });
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (exc) {
    return (exc as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Take the single-engine lock. `null` when a live process already holds it. */
export function acquireLock(): (() => void) | null {
  fs.mkdirSync(paths.abxDir, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = fs.openSync(lockFile(), "wx", 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => {
        try {
          if (fs.readFileSync(lockFile(), "utf-8").trim() === String(process.pid)) fs.rmSync(lockFile(), { force: true });
        } catch {
          /* already gone */
        }
      };
    } catch (exc) {
      if ((exc as NodeJS.ErrnoException).code !== "EEXIST") throw exc;
      const holder = Number.parseInt(safeRead(lockFile()), 10);
      if (Number.isInteger(holder) && holder > 0 && pidAlive(holder)) return null;
      fs.rmSync(lockFile(), { force: true });
    }
  }
  return null;
}

function safeRead(file: string): string {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return "";
  }
}

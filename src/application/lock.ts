/** Host-local file-operation exclusion. Shared deployers must serialize across hosts separately. */
import fs from "node:fs";
import path from "node:path";
import { ApplicationError, digest } from "./config.js";
export async function withApplicationLock<T>(directory: string, identity: string, work: () => Promise<T>): Promise<T> {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${digest(identity).slice(0, 32)}.lock`);
  let handle: number;
  try { handle = fs.openSync(file, "wx", 0o600); } catch { throw new ApplicationError("This application or build is locked by another operation. Confirm that process stopped before removing its local lock."); }
  fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); fs.fsyncSync(handle);
  try { return await work(); } finally { fs.closeSync(handle); fs.rmSync(file, { force: true }); }
}

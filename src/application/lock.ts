/** Host-local file-operation exclusion. Shared deployers must serialize across hosts separately. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ApplicationError, digest } from "./config.js";
export async function withApplicationLock<T>(directory: string, identity: string, work: () => Promise<T>): Promise<T> {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${digest(identity).slice(0, 32)}.lock`);
  let handle: number;
  try { handle = fs.openSync(file, "wx", 0o600); } catch { throw new ApplicationError("This application or build is locked by another operation. Confirm that process stopped before removing its local lock."); }
  try {
    fs.writeFileSync(handle, JSON.stringify({ hostname: os.hostname(), pid: process.pid, createdAt: new Date().toISOString() })); fs.fsyncSync(handle);
    return await work();
  } finally { fs.closeSync(handle); fs.rmSync(file, { force: true }); }
}

/** Recover only a lock whose process is proved absent on this host. No cloud effects are replayed. */
export function releaseStoppedApplicationLock(directory: string, identity: string): boolean {
  const file = path.join(directory, `${digest(identity).slice(0, 32)}.lock`);
  if (!fs.existsSync(file)) return false;
  const recovery = `${file}.recovery`;
  let handle: number;
  try { handle = fs.openSync(recovery, "wx", 0o600); }
  catch { throw new ApplicationError("A local lock recovery is already in progress. Confirm its process stopped before removing the recovery lock."); }
  const own = fs.fstatSync(handle);
  try {
    if (!fs.existsSync(file)) return false;
    const before = fs.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink()) throw new ApplicationError("Deployment lock is not a regular file.");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (saved.hostname !== os.hostname() || !Number.isInteger(saved.pid) || saved.pid < 1) throw new ApplicationError("The lock owner cannot be verified on this host. Confirm the original process stopped before removing its local lock.");
    try { process.kill(saved.pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw new ApplicationError("Cannot prove the lock owner stopped; the lock was preserved.");
      const current = fs.lstatSync(file);
      if (current.ino !== before.ino || current.dev !== before.dev || current.mtimeMs !== before.mtimeMs) throw new ApplicationError("Deployment lock changed during recovery.");
      fs.unlinkSync(file); return true;
    }
    throw new ApplicationError("The deployment lock owner is still running; wait for it to finish.");
  } finally {
    fs.closeSync(handle);
    const current = fs.lstatSync(recovery);
    if (current.ino === own.ino && current.dev === own.dev) fs.unlinkSync(recovery);
  }
}

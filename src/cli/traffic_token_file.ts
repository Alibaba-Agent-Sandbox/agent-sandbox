/** Explicit private gateway-token files; they are never a default persistent credential. */
import fs from "node:fs";
import { UsageError } from "./errors.js";

/** Read a regular, private file without following a symlink or including its content in diagnostics. */
export function readTrafficTokenFile(filename: string): string {
  let fd: number | undefined;
  try {
    if (fs.lstatSync(filename).isSymbolicLink()) throw new Error();
    fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536 || process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error();
    const token = fs.readFileSync(fd, "utf8").trim();
    if (!token || /[\r\n\0]/.test(token)) throw new Error();
    return token;
  } catch { throw new UsageError("Traffic token input must be a private regular file (0600), containing one nonempty token."); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** Reserve an exclusive 0600 output before cloud work; remove only our own empty file on failure. */
export async function withTrafficTokenOutput<T>(filename: string | null, action: (save: (token: string | null) => void) => Promise<T>): Promise<T> {
  if (filename === null) return action(() => undefined);
  let fd: number;
  try { fd = fs.openSync(filename, "wx", 0o600); }
  catch { throw new UsageError("Traffic token output must be a new file in an existing directory; existing files are never replaced."); }
  const identity = fs.fstatSync(fd);
  let written = false;
  try {
    return await action((token) => {
      if (!token || /[\r\n\0]/.test(token)) throw new UsageError("The created sandbox did not return a usable traffic token; token output was not saved.");
      const current = fs.lstatSync(filename);
      if (current.ino !== identity.ino || current.dev !== identity.dev) throw new UsageError("Traffic token output path changed; no credential was written.");
      fs.writeFileSync(fd, `${token}\n`, "utf8"); fs.fsyncSync(fd);
      const after = fs.lstatSync(filename);
      if (after.ino !== identity.ino || after.dev !== identity.dev) throw new UsageError("Traffic token output path changed while writing; inspect the private file before retrying.");
      written = true;
    });
  } finally {
    fs.closeSync(fd);
    if (!written) {
      try {
        const current = fs.lstatSync(filename);
        if (current.ino === identity.ino && current.dev === identity.dev && current.size === 0) fs.unlinkSync(filename);
      } catch { /* Never remove a replacement path or another owner's file. */ }
    }
  }
}

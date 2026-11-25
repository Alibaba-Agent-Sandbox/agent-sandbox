/** Private source snapshots used by deployment; image builds use Provider-owned local construction. */
import fs from "node:fs";
import path from "node:path";
import {ApplicationError, sourceDigest} from "../application/config.js";

const ignored = new Set([".git", ".abx", ".agents", "node_modules", ".venv", "__pycache__", ".pytest_cache"]);

/** Copy only regular source inputs into a private snapshot, preserving container-readable source modes. */
export function snapshotTemplateSource(source: string, destination: string): string {
  const relative = path.relative(fs.realpathSync(source), path.resolve(destination));
  if (relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative) && !relative.split(path.sep).includes(".abx")) {
    throw new ApplicationError("Keep source snapshots outside the source directory or under .abx.");
  }
  const before = sourceDigest(source);
  if (fs.existsSync(destination)) throw new ApplicationError("Source snapshot already exists; choose a new build output.");
  const copy = (from: string, to: string, root = false): void => {
    fs.mkdirSync(to, { mode: root ? 0o700 : (fs.statSync(from).mode & 0o777) });
    fs.chmodSync(to, root ? 0o700 : (fs.statSync(from).mode & 0o777));
    for (const name of fs.readdirSync(from)) {
      if (ignored.has(name) || name === ".env" || name.startsWith(".env.")) continue;
      const input = path.join(from, name), output = path.join(to, name), stat = fs.lstatSync(input);
      if (stat.isSymbolicLink()) throw new ApplicationError("Symlinked template inputs are unsupported.");
      if (stat.isDirectory()) copy(input, output);
      else if (stat.isFile()) { fs.copyFileSync(input, output, fs.constants.COPYFILE_EXCL); fs.chmodSync(output, stat.mode & 0o777); }
      else throw new ApplicationError("Template inputs must be regular files.");
    }
  };
  copy(source, destination, true);
  if (sourceDigest(destination) !== before) throw new ApplicationError("Source changed during snapshot preparation; no build has started.");
  return before;
}

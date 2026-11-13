/** Private Docker context staging without rewriting Dockerfile or ignore semantics. */
import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { DockerBuildError } from "../../models/errors.js";

/** These local control files never become implicit COPY/ADD inputs. */
export function privateBuildPath(name: string): boolean {
  return [".git", ".abx", ".agents", ".env"].includes(name) || name.startsWith(".env.") || /^\.sandbox-session.*\.json$/.test(name);
}
function inside(root: string, value: string): boolean {
  const relative = path.relative(root, value);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function copyRegular(source: string, target: string): void {
  const input = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(input);
    if (!stat.isFile()) throw new DockerBuildError("Docker build inputs must be regular files.");
    const output = fs.openSync(target, "wx", stat.mode & 0o777);
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let length: number;
      while ((length = fs.readSync(input, buffer)) > 0) {
        let offset = 0;
        while (offset < length) offset += fs.writeSync(output, buffer, offset, length - offset);
      }
      fs.fchmodSync(output, stat.mode & 0o777);
    } finally { fs.closeSync(output); }
  } finally { fs.closeSync(input); }
}

/** Conservative identity of every staged input; Docker's ignore rules may later omit more. */
export function privateBuildFingerprint(context: string, dockerfile: string): string {
  const original = fs.realpathSync(context), recipe = fs.realpathSync(dockerfile);
  if (inside(original, recipe) && path.relative(original, recipe).split(path.sep).some(privateBuildPath)) throw new DockerBuildError("Dockerfile cannot be a private control file.");
  const digest = createHash("sha256");
  const append = (row: unknown[]): void => {digest.update(JSON.stringify(row)); digest.update("\n");};
  const hashFile = (file: string): string => {
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      if (!fs.fstatSync(descriptor).isFile()) throw new DockerBuildError("Docker build inputs must be regular files.");
      const hash = createHash("sha256"), buffer = Buffer.allocUnsafe(64 * 1024);
      let length: number;
      while ((length = fs.readSync(descriptor, buffer)) > 0) hash.update(buffer.subarray(0, length));
      return hash.digest("hex");
    } finally {fs.closeSync(descriptor);}
  };
  const walk = (file: string, relative: string): void => {
    const stat = fs.lstatSync(file), mode = stat.mode & 0o777;
    if (stat.isSymbolicLink()) {
      const link = fs.readlinkSync(file);
      if (path.isAbsolute(link) || !inside(original, path.resolve(path.dirname(file), link))) throw new DockerBuildError("Docker context symlinks must remain relative and inside the context.");
      append([relative, "symlink", link]);
    } else if (stat.isDirectory()) {
      append([relative, "directory", mode]);
      for (const name of fs.readdirSync(file).sort()) if (!privateBuildPath(name)) walk(path.join(file, name), `${relative}/${name}`);
    } else if (stat.isFile()) append([relative, "file", mode, hashFile(file)]);
    else throw new DockerBuildError("Docker context contains an unsupported special file.");
  };
  walk(original, ".");
  append(["selected-dockerfile", inside(original, recipe) ? path.relative(original, recipe).split(path.sep).join("/") : `external/${path.basename(recipe)}`]);
  if (!inside(original, recipe)) {
    append(["external-dockerfile", fs.statSync(recipe).mode & 0o777, hashFile(recipe)]);
    if (fs.existsSync(`${recipe}.dockerignore`)) append(["external-dockerfile-ignore", fs.statSync(`${recipe}.dockerignore`).mode & 0o777, hashFile(`${recipe}.dockerignore`)]);
  }
  return digest.digest("hex");
}

export interface PrivateBuildContext { context: string; dockerfile: string }
/**
 * Stage public inputs in a 0700 temporary directory, then always remove that directory.
 * Docker remains responsible for the unmodified .dockerignore rules. Dockerfiles outside
 * the context remain outside it; their specific ignore file is copied beside the recipe.
 */
export async function withPrivateBuildContext<T>(context: string, dockerfile: string, use: (staged: PrivateBuildContext) => Promise<T>): Promise<T> {
  const original = fs.realpathSync(context), recipe = fs.realpathSync(dockerfile);
  if (!fs.statSync(original).isDirectory() || !fs.statSync(recipe).isFile()) throw new DockerBuildError("Expected a Docker context directory and Dockerfile.");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "abx-docker-context-"));
  fs.chmodSync(temporary, 0o700);
  const staged = path.join(temporary, "context");
  const copy = (source: string, target: string): void => {
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) {
      const link = fs.readlinkSync(source);
      if (path.isAbsolute(link) || !inside(original, path.resolve(path.dirname(source), link))) throw new DockerBuildError("Docker context symlinks must remain relative and inside the context.");
      // Preserve the link itself; never read linked data into the context.
      fs.symlinkSync(link, target);
    } else if (stat.isDirectory()) {
      fs.mkdirSync(target, {mode: 0o700});
      for (const name of fs.readdirSync(source)) if (!privateBuildPath(name)) copy(path.join(source, name), path.join(target, name));
      fs.chmodSync(target, stat.mode & 0o777);
    } else if (stat.isFile()) copyRegular(source, target);
    else throw new DockerBuildError("Docker context contains an unsupported special file.");
  };
  try {
    copy(original, staged);
    let selected: string;
    if (inside(original, recipe)) {
      const relative = path.relative(original, recipe);
      if (relative.split(path.sep).some(privateBuildPath)) throw new DockerBuildError("Dockerfile cannot be a private control file.");
      selected = path.join(staged, relative);
    } else {
      const recipes = path.join(temporary, "recipe"); fs.mkdirSync(recipes, {mode: 0o700});
      selected = path.join(recipes, path.basename(recipe)); copyRegular(recipe, selected);
      const specificIgnore = `${recipe}.dockerignore`;
      if (fs.existsSync(specificIgnore)) copyRegular(specificIgnore, `${selected}.dockerignore`);
    }
    return await use({context: staged, dockerfile: selected});
  } finally {
    // Source permissions may be read-only; restoring owner access is confined to
    // the private tree and never follows symlinks into the project or elsewhere.
    const writable = (directory: string): void => {
      fs.chmodSync(directory, 0o700);
      for (const name of fs.readdirSync(directory)) {
        const child = path.join(directory, name);
        if (fs.lstatSync(child).isDirectory()) writable(child);
      }
    };
    writable(temporary);
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}

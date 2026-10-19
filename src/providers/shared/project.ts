/** Generic local project/OCI primitives. Backend policy and authentication stay in adapters. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { ProviderConfigError } from "../../models/provider_errors.js";

export interface ProjectStageOptions { base_image?: string; ensure_user?: string; optional_copy?: readonly string[] }
export interface StagedProject { directory: string; digest: string; close(): Promise<void> }
export interface ImageBuildOptions extends ProjectStageOptions {
  image_repository: string; name: string; timeout?: number;
}
/** Run a local tool without a shell. Raw tool output/errors are never included in public exceptions. */
export function runTool(command: string, args: readonly string[], options: { cwd?: string; input?: string; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, [...args], { cwd: options.cwd, timeout: Math.ceil((options.timeout ?? 600) * 1000),
      maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) reject(new ProviderConfigError("Project preparation tool failed. Check the tool installation, registry access and provider configuration; a submitted operation may still exist."));
      else resolve(stdout);
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(options.input);
  });
}
/** Stage a source tree without changing it. An explicit base replaces the first FROM only. */
export async function stageProject(directory: string, options: ProjectStageOptions = {}): Promise<StagedProject> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "abx-project-"));
  const staged = path.join(root, "source");
  try {
    await fs.cp(directory, staged, { recursive: true, filter: async (source) => {
      const name = path.basename(source);
      if (name === ".git" || name === ".abx" || name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return false;
      if ((await fs.lstat(source)).isSymbolicLink()) throw new ProviderConfigError("Project preparation does not accept symbolic links.");
      return true;
    } });
    const file = path.join(staged, "Dockerfile");
    let dockerfile = await fs.readFile(file, "utf8");
    if (options.base_image) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/.test(options.base_image) || options.base_image.includes("://")) throw new ProviderConfigError("Invalid project base image.");
      dockerfile = dockerfile.replace(/^FROM\s+(?:--platform=\S+\s+)?\S+(.*)$/im, `FROM ${options.base_image}$1`);
      if (options.ensure_user) {
        if (!/^[a-z_][a-z0-9_-]*$/.test(options.ensure_user)) throw new ProviderConfigError("Invalid project build user.");
        dockerfile = dockerfile.replace(/^(FROM[^\n]*\n)/im, `$1USER root\nRUN id -u ${options.ensure_user} >/dev/null 2>&1 || useradd --create-home --shell /bin/sh ${options.ensure_user}\n`);
      }
    }
    // Providers may explicitly identify optional build inputs with a Dockerfile fallback.
    for (const pattern of options.optional_copy ?? []) {
      if (!/^\*\.[a-zA-Z0-9]+$/.test(pattern)) throw new ProviderConfigError("Optional copy inputs must be simple extension patterns.");
      const suffix = pattern.slice(1);
      if (!(await fs.readdir(staged)).some(name => name.endsWith(suffix))) {
        const lines = dockerfile.split("\n");
        dockerfile = lines.filter(line => !(line.trim().startsWith("COPY ") && line.trim().split(/\s+/)[1] === pattern)).join("\n");
      }
    }
    if (!/^FROM\s+/im.test(dockerfile) || /^FROM[^\n]*[<>]/im.test(dockerfile)) throw new ProviderConfigError("Configure this provider's build_base_image before preparing a template with an unresolved base image.");
    await fs.writeFile(file, dockerfile);
    const hash = createHash("sha256");
    async function visit(folder: string): Promise<void> {
      for (const name of (await fs.readdir(folder)).sort()) {
        const item = path.join(folder, name), stat = await fs.stat(item);
        hash.update(JSON.stringify([path.relative(staged, item), stat.isDirectory() ? "directory" : "file", stat.size, stat.mode & 0o777]));
        if (stat.isDirectory()) await visit(item);
        else hash.update(await fs.readFile(item));
      }
    }
    await visit(staged);
    return { directory: staged, digest: hash.digest("hex"), close: () => fs.rm(root, { recursive: true, force: true }) };
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    if (error instanceof ProviderConfigError) throw error;
    throw new ProviderConfigError("Project preparation needs a readable source directory and Dockerfile.");
  }
}
/** Build and push an immutable project image using the user's existing Docker registry login. */
export async function buildProjectImage(directory: string, options: ImageBuildOptions): Promise<string> {
  if (typeof options.image_repository !== "string" || !/^[a-z0-9][a-z0-9._:/-]*$/.test(options.image_repository) || options.image_repository.includes("://") || !options.image_repository.includes("/") || options.image_repository.split("/").at(-1)!.includes(":")) throw new ProviderConfigError("Configure image_repository as a registry/repository without a tag or credentials.");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.name)) throw new ProviderConfigError("Project alias must be a lowercase name of at most 63 characters.");
  const timeout = options.timeout ?? 600;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 3600) throw new ProviderConfigError("Project build timeout must be greater than 0 and at most 3600 seconds.");
  const deadline = Date.now() + timeout * 1000;
  const stage = await stageProject(directory, options);
  try {
    const image = `${options.image_repository}:${options.name}-${stage.digest.slice(0, 16)}`;
    const buildRemaining = (deadline - Date.now()) / 1000;
    if (buildRemaining <= 0) throw new ProviderConfigError("Project staging exceeded the build deadline.");
    await runTool("docker", ["build", "--platform", "linux/amd64", "-t", image, "."], { cwd: stage.directory, timeout: buildRemaining });
    const remaining = (deadline - Date.now()) / 1000;
    if (remaining <= 0) throw new ProviderConfigError("Project build timed out before image publication.");
    await runTool("docker", ["push", image], { timeout: remaining });
    return image;
  } finally { await stage.close(); }
}

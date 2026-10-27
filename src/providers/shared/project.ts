/** Generic local project/OCI primitives. Backend policy and authentication stay in adapters. */
import type { ResourceJournalCallbacks } from "../../template/resource_journal.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { DockerBuildError } from "../../models/errors.js";
import { ProviderConfigError } from "../../models/provider_errors.js";
import { materializeSourceRecipe } from "./source_recipe.js";

export interface ProjectStageOptions { dockerfile?: string | null; resolveDockerfile?: (source: string) => string }
export interface StagedProject { directory: string; digest: string; verify(): Promise<void>; close(): Promise<void> }
export interface ImageBuildOptions {
  dockerfile?: string;
  image_repository: string; name: string; timeout?: number; journal?: ResourceJournalCallbacks;
}
/** A host-tool failure with fixed diagnostic text, never subprocess output or arguments. */
export class ProjectToolError extends ProviderConfigError {
  constructor(command: string, operation: string | undefined, error: { code?: string | number | null; killed?: boolean }) {
    const tool = command === "docker" && ["build", "push", "image"].includes(operation ?? "") ? `Docker ${operation}` : command === "git" ? "Git source inspection" : "Project preparation tool";
    const reason = error.code === "ENOENT" ? "is not installed or is not on PATH" : error.killed ? "exceeded its time limit" : "failed";
    super(`${tool} ${reason}. Check the tool installation, image registry access and provider configuration.`);
  }
}
/** A read-only Docker prerequisite failure with controlled, safe user guidance. */
export class DockerSetupError extends DockerBuildError {
  constructor(reason: "missing" | "unavailable" | "cancelled") {
    const messages = {
      missing: "Docker CLI was not found in PATH. Install Docker and start Docker Desktop/the daemon. No build has started.",
      unavailable: "Docker is installed, but its daemon or selected context is not accessible. Start Docker Desktop/the daemon and check docker context and permissions. No build has started.",
      cancelled: "Docker setup cancelled. No build has started.",
    };
    super(messages[reason], { suggestion: "Run docker info to check the selected context and permissions, then retry. No build has started." });
  }
}

/** Fixed build diagnostics derived from tool output; never includes that output or its credentials. */
export class DockerBuildFailure extends DockerBuildError {
  constructor(output: string, exitCode: number) {
    // Network evidence takes precedence: pip can report "no matching distribution" after index timeouts.
    const [reason, action] = /certificate verify failed|CERTIFICATE_VERIFY_FAILED|x509:|unknown authority/i.test(output)
      ? ["TLS certificate verification failed", "Check the build container's CA trust and registry or package-index certificates. Keep TLS verification enabled."]
      : /timed? ?out|ReadTimeout|ETIMEDOUT|TLS handshake timeout|Temporary failure in name resolution|Could not resolve|ENOTFOUND|network is unreachable|connection (?:reset|refused)/i.test(output)
      ? ["network access failed or timed out", "Check DNS, proxy and outbound HTTPS inside Docker, including the Docker network MTU; host connectivity alone does not prove build connectivity."]
      : /No matching distribution found|Could not find a version that satisfies|npm ERR! code (?:ETARGET|ERESOLVE)|npm error code (?:ETARGET|ERESOLVE)|Unable to locate package/i.test(output)
      ? ["dependency resolution failed", "Check the configured package index, pinned versions and the build image's Python or Node version and architecture."]
      : /no space left on device/i.test(output)
      ? ["Docker storage is full", "Check Docker disk usage and remove only disposable build resources."]
      : /dockerfile parse error|unknown instruction:|failed to read dockerfile/i.test(output)
      ? ["the Dockerfile could not be read or parsed", "Check the selected Dockerfile and build context."]
      : ["a build instruction failed", "Inspect the Docker build output and the failing instruction. Use --verbose on an intentional retry after checking the recovery journal."];
    super(`Docker build failed (exit ${Number.isInteger(exitCode) ? exitCode : -1}): ${reason}.`, { suggestion: action });
  }
}

/** Run a local tool without a shell. Raw tool output/errors are never included in public exceptions. */
export function runTool(command: string, args: readonly string[], options: { cwd?: string; input?: string; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, [...args], { cwd: options.cwd, timeout: Math.ceil((options.timeout ?? 600) * 1000),
      maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) reject(new ProjectToolError(command, args[0], error));
      else resolve(stdout);
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(options.input);
  });
}
/** Snapshot the source and materialize its declared official recipe in the temporary copy. */
export async function stageProject(directory: string, options: ProjectStageOptions = {}): Promise<StagedProject> {
  if (Object.keys(options).some(key => !["dockerfile", "resolveDockerfile"].includes(key)) || (options.dockerfile != null && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.dockerfile))) throw new ProviderConfigError("Build profile must select a root Dockerfile without rewriting source.");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "abx-project-"));
  const staged = path.join(root, "source");
  try {
    let eligible: Set<string> | null = null;
    try { eligible = new Set((await runTool("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {cwd: directory})).split("\0").filter(Boolean)); }
    catch { /* A non-Git local source has no tracked/ignored distinction. */ }
    const eligiblePaths = eligible === null ? null : new Set([...eligible].flatMap(file => {
      const parts=file.split("/");return parts.map((_part,index)=>parts.slice(0,index+1).join("/"));
    }));
    await fs.cp(directory, staged, { recursive: true, filter: async (source) => {
      const relative=path.relative(directory,source).split(path.sep).join("/");
      if(relative && eligiblePaths && !eligiblePaths.has(relative))return false;
      const name = path.basename(source);
      if (name === ".git" || name === ".abx" || name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return false;
      const stat = await fs.lstat(source);
      if (stat.isSymbolicLink()) throw new ProviderConfigError("Project preparation does not accept symbolic links.");
      if (stat.isFile() && eligible && !eligible.has(path.relative(directory, source).split(path.sep).join("/"))) return false;
      return true;
    } });
    if (options.dockerfile !== null) {
    const file = path.join(staged, options.dockerfile ?? "Dockerfile");
    const original = await fs.readFile(file, "utf8");
    const pinFile = path.join(staged, "server-sdk.commit");
    const serverCommit = await fs.readFile(pinFile, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
    const dockerfile = options.resolveDockerfile?.(original) ?? materializeSourceRecipe(original, {
      serverCommit, hasWheels: (await fs.readdir(staged)).some(name => name.endsWith(".whl")),
    });
    if (!/^FROM\s+/im.test(dockerfile) || /^FROM[^\n]*[<>]/im.test(dockerfile)) throw new ProviderConfigError("The selected Dockerfile has an unresolved base image. Use an explicit image or the official <region>/<tag> base recipe.");
    if (dockerfile !== original) await fs.writeFile(file, dockerfile);
    }
    async function digest(): Promise<string> {
    const hash = createHash("sha256");
    async function visit(folder: string): Promise<void> {
      for (const name of (await fs.readdir(folder)).sort()) {
        const item = path.join(folder, name), stat = await fs.stat(item);
        if (stat.isDirectory()) await visit(item);
        else { hash.update(path.relative(staged, item).split(path.sep).join("/")); hash.update("\0"); hash.update(await fs.readFile(item)); hash.update("\0"); }
      }
    }
    await visit(staged);
    return hash.digest("hex");
    }
    const snapshotDigest = await digest();
    return { directory: staged, digest: snapshotDigest, verify: async () => {
      if (await digest() !== snapshotDigest) throw new ProviderConfigError("Execution snapshot changed; recompute the plan before preparing resources.");
    }, close: () => fs.rm(root, { recursive: true, force: true }) };
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
  if (!options.journal) throw new ProviderConfigError("Project image preparation requires an owned-resource journal.");
  const deadline = Date.now() + timeout * 1000;
  const stage = await stageProject(directory, { dockerfile: options.dockerfile });
  try {
    const image = `${options.image_repository}:${options.name}-${stage.digest.slice(0, 16)}`;
    const buildRemaining = (deadline - Date.now()) / 1000;
    if (buildRemaining <= 0) throw new ProviderConfigError("Project staging exceeded the build deadline.");
    await stage.verify();
    const localIntent = await options.journal.intent({ kind: "image", correlation_key: image, cleanup: "manual" });
    await runTool("docker", ["build", "--platform", "linux/amd64", "-f", options.dockerfile ?? "Dockerfile", "-t", image, "."], { cwd: stage.directory, timeout: buildRemaining });
    await options.journal.created(localIntent, image);
    const remaining = (deadline - Date.now()) / 1000;
    if (remaining <= 0) throw new ProviderConfigError("Project build timed out before image publication.");
    const pushIntent = await options.journal.intent({ kind: "image", correlation_key: image, cleanup: "manual" });
    await runTool("docker", ["push", image], { timeout: remaining });
    const digests = JSON.parse(await runTool("docker", ["image", "inspect", "--format", "{{json .RepoDigests}}", image], { timeout: Math.max(0.01, (deadline - Date.now()) / 1000) })) as unknown;
    const immutable = Array.isArray(digests) ? digests.find(value => typeof value === "string" && value.startsWith(`${options.image_repository}@sha256:`) && /@sha256:[a-f0-9]{64}$/.test(value)) : undefined;
    if (!immutable) throw new ProviderConfigError("Published image has no observable immutable digest; inspect the resource journal before retrying.");
    await options.journal.created(pushIntent, immutable);
    return immutable;
  } finally { await stage.close(); }
}

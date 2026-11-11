/** Locked direct Serverless Devs component invocation and pre-plan image preparation. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { releaseStoppedApplicationLock } from "../../../application/lock.js";
import { ApplicationError, contained, record, sourceDigest, toolDigest, verifyTools, writeJson } from "../../../application/config.js";
import { execute } from "../../../application/process.js";
import { COMPONENT_RUNNER_SOURCE } from "../../../application/component_runner.js";
import type { ApplicationTemplate, BuildReceipt, OwnedServerImage, ToolchainLock } from "../../../application/types.js";
import type { CredentialSnapshot } from "../../../application/bindings.js";
import { explainConfig, paths } from "../../../transport/config_layers.js";
import { ResourceJournal } from "../../../template/resource_journal.js";
import { createRegistryClient, type RegistryClient } from "./registry.js";
import { setTimeout as delay } from "node:timers/promises";
import { withApplicationLock } from "../../../application/lock.js";

const require = createRequire(import.meta.url);
export interface ComponentInvocation { command: "deploy" | "info" | "remove" | "logs"; resource: string; props: Record<string, unknown>; credential: CredentialSnapshot }

/** Build children inherit only explicitly useful host settings, never unrelated API keys. */
export function childEnvironment(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: home, USERPROFILE: home, serverless_devs_config_home: home,
    CI: "1", SERVERLESS_DEVS_CICD: "1", S_INTERACTIVE: "0", NO_COLOR: "1" };
  for (const key of ["PATH", "SYSTEMROOT", "TMPDIR", "TMP", "TEMP", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"]) if (process.env[key]) env[key] = process.env[key];
  return env;
}
async function runComponent(node: string, loaderPath: string, component: string, home: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "abx-component-"));
  try {
    const runner = path.join(scratch, "runner.cjs"); fs.writeFileSync(runner, COMPONENT_RUNNER_SOURCE, { mode: 0o600 });
    const output = await execute({ argv: [node, runner], cwd: scratch, env: childEnvironment(home), input: JSON.stringify({ loaderPath, component, cwd: scratch, name: "managed-agents", ...request }), timeoutSeconds: 300, maxBytes: 2 * 1024 * 1024, privateResult: true });
    const value = JSON.parse(output);
    if (!record(value)) throw new ApplicationError("Component returned an invalid lifecycle result.");
    if (value.error) throw new ApplicationError(`Component ${value.stage === "invoke" ? "invocation" : "loading"} failed (credential callbacks: ${Number(value.credentialRequests) || 0}${typeof value.code === "string" ? `; code: ${value.code}` : ""}); raw output withheld.`);
    return value;
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
/** Download/load the exact component before plan freeze, then lock every dependency byte. */
export async function prepareTools(project: string, component: string): Promise<ToolchainLock> {
  if (!/^fc3@\d+\.\d+\.\d+$/.test(component)) throw new ApplicationError("Managed applications require one exact fc3 component version.");
  const node = process.env.ABX_APP_NODE || process.execPath;
  const home = path.join(project, ".abx", "app", "tools"); fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const loaderPath = require.resolve("@serverless-devs/load-component"), packagePath = require.resolve("@serverless-devs/load-component/package.json");
  const loaderDirectory = path.resolve(path.dirname(packagePath), "../..");
  const version = JSON.parse(fs.readFileSync(packagePath, "utf8")).version as string;
  if (version !== "0.0.10-beta.7") throw new ApplicationError("The installed component loader does not match the supported locked version.");
  const nodeVersion = (await execute({ argv: [node, "--version"], cwd: home, env: childEnvironment(home), timeoutSeconds: 10 })).trim();
  if (!/^v(?:2[0-9]|[3-9][0-9])\./.test(nodeVersion)) throw new ApplicationError("Component execution requires an explicit Node.js 20+ runtime.");
  const loaded = await runComponent(node, loaderPath, component, home, { action: "prepare" });
  if (typeof loaded.componentPath !== "string" || loaded.version !== component.split("@")[1]) throw new ApplicationError("Downloaded component identity does not match the requested version.");
  const componentDirectory = fs.realpathSync(loaded.componentPath);
  const relative = path.relative(fs.realpathSync(home), componentDirectory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new ApplicationError("Component loader escaped the application tool cache.");
  return { schemaVersion: 1, node: { path: node, version: nodeVersion, sha256: createHash("sha256").update(fs.readFileSync(node)).digest("hex") },
    loader: { path: loaderPath, directory: loaderDirectory, version, sha256: toolDigest(loaderDirectory) },
    component: { reference: component, directory: componentDirectory, sha256: toolDigest(componentDirectory) } };
}
/** A fixed local bundle is used after freeze; component resolution cannot update the cache. */
export async function invokeComponent(lock: ToolchainLock, invocation: ComponentInvocation): Promise<unknown> {
  verifyTools(lock);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "abx-component-home-"));
  try {
    const value = await runComponent(lock.node.path, lock.loader.path, lock.component.directory, home,
      { action: "invoke", command: invocation.command, resource: invocation.resource, props: invocation.props, credential: invocation.credential });
    verifyTools(lock); return invocation.command === "logs" ? value.logs : value.result;
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
/** Prepare a digest-pinned server image and its lock before any immutable plan is generated. */
export interface BuildDependencies { registry?: RegistryClient; run?: typeof execute; tools?: typeof prepareTools; namespace?: string; metadataTimeoutSeconds?: number }
export async function buildApplication(template: ApplicationTemplate, project: string, credential: CredentialSnapshot, output: string, dependencies: BuildDependencies = {}): Promise<BuildReceipt> {
  if (fs.existsSync(output)) throw new ApplicationError("Build receipt already exists; retain or clean it and choose a new output path.");
  const before = sourceDigest(project), deployment = template.application.deployment;
  const toolchain = await (dependencies.tools ?? prepareTools)(project, deployment.component), run = dependencies.run ?? execute;
  const receipt: BuildReceipt = { schemaVersion: 1, kind: "ManagedApplicationBuild", sourceDigest: before, image: deployment.serverImage ?? "", toolchain, createdAt: new Date().toISOString(), status: "building", accessRef: deployment.accessRef };
  if (!receipt.image) {
    const recipe = deployment.serverBuildRecipe!;
    const namespace = dependencies.namespace ?? String(explainConfig({ provider: "alicloud-express" }).acr_namespace?.value ?? process.env.ACR_NAMESPACE ?? "");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(namespace)) throw new ApplicationError("Configure an ACR namespace before building the application server.");
    const repository = `registry.${deployment.region}.aliyuncs.com/${namespace}/${template.name}-server`;
    const tagName = `build-${randomBytes(12).toString("hex")}`, tag = `${repository}:${tagName}`, registry = dependencies.registry ?? createRegistryClient(credential, deployment.region);
    if (await registry.inspect(namespace, `${template.name}-server`, tagName)) throw new ApplicationError("Generated image tag already exists; no resource was adopted.");
    const journal = new ResourceJournal("alicloud-express", before), intentId = await journal.intent({ kind: "image", correlation_key: tag, cleanup: "manual" });
    const owned: OwnedServerImage = { accountId: credential.AccountID, region: deployment.region, namespace, repository: `${template.name}-server`, tag: tagName, localTag: tag, journalId: journal.id, intentId, state: "intent" };
    receipt.ownedServerImage = owned; writeJson(output, receipt);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "abx-app-image-"));
    try {
      const context = path.join(scratch, "source");
      fs.cpSync(project, context, { recursive: true, filter: source => ![".git", ".abx", ".agents", "node_modules", ".venv", "__pycache__", ".pytest_cache", ".env"].includes(path.basename(source)) && !path.basename(source).startsWith(".env.") });
      if (sourceDigest(context) !== before) throw new ApplicationError("Application source changed before image snapshot preparation.");
      const env = childEnvironment(scratch); env.DOCKER_CONFIG = path.join(scratch, "docker");
      fs.mkdirSync(env.DOCKER_CONFIG, { recursive: true, mode: 0o700 });
      await run({ argv: ["docker", "build", "--platform", "linux/amd64", "-f", contained(context, recipe.dockerfile), "-t", tag, context], cwd: scratch, env, timeoutSeconds: 1800, maxBytes: 8 * 1024 * 1024 });
      owned.localImageId = (await run({ argv: ["docker", "image", "inspect", "--format", "{{.Id}}", tag], cwd: scratch, env, timeoutSeconds: 30 })).trim();
      if (!/^sha256:[a-f0-9]{64}$/.test(owned.localImageId)) throw new ApplicationError("Local image creation identity could not be confirmed.");
      owned.state = "local-built"; writeJson(output, receipt);
      const login = await registry.token();
      await run({ argv: ["docker", "login", "--username", login.username, "--password-stdin", `registry.${deployment.region}.aliyuncs.com`], input: login.password, cwd: scratch, env, timeoutSeconds: 60 });
      owned.state = "push-started"; writeJson(output, receipt);
      await run({ argv: ["docker", "push", tag], cwd: scratch, env, timeoutSeconds: 1800, maxBytes: 8 * 1024 * 1024 });
      const deadline = Date.now() + (dependencies.metadataTimeoutSeconds ?? 10) * 1000;
      let remote: Awaited<ReturnType<RegistryClient["inspect"]>>;
      // Only metadata reads repeat; missing fields never establish absence or authorize another push.
      for (;;) {
        const remaining = deadline - Date.now(); if (remaining <= 0) throw new ApplicationError("Published ACR image metadata remains incomplete; retain the native tag and journal for reconciliation.");
        remote = await registry.inspect(namespace, owned.repository, tagName, remaining / 1000);
        if (remote?.imageId && remote.imageId !== owned.localImageId.replace(/^sha256:/, "")) throw new ApplicationError("Published image does not match the observed local creation identity.");
        if (remote?.digest && remote.imageId) break;
        await delay(Math.min(1000, Math.max(1, deadline - Date.now())));
      }
      owned.digest = remote.digest; owned.state = "confirmed"; receipt.image = `${repository}@${remote.digest}`;
      await journal.created(intentId, receipt.image); writeJson(output, receipt);
    } catch (error) { receipt.status = "requires_reconcile"; if (owned.state === "push-started") await journal.mark(intentId, "uncertain"); writeJson(output, receipt); throw error; }
    finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
  if (sourceDigest(project) !== before) { receipt.status = "requires_reconcile"; writeJson(output, receipt); throw new ApplicationError("Application source changed during build; retain the image receipt and freeze a new build."); }
  receipt.status = "ready";
  writeJson(output, receipt); return receipt;
}
/** Remove only an exact local tag; shared images and other tags are never forced away. */
export async function removeOwnedImage(image: OwnedServerImage, credential: CredentialSnapshot, dependencies: BuildDependencies = {}): Promise<void> {
  const registry = dependencies.registry ?? createRegistryClient(credential, image.region), run = dependencies.run ?? execute;
  if (image.state !== "confirmed" && image.state !== "local-built") throw new ApplicationError("Image ownership is uncertain; inspect the saved native tag/journal before cleanup.");
  if (image.state === "confirmed") await registry.remove(image);
  if (image.localImageId) {
    const raw = await run({ argv: ["docker", "image", "ls", "--no-trunc", "--format", "{{json .}}", "--filter", `reference=${image.localTag}`], cwd: os.tmpdir(), timeoutSeconds: 30 });
    const rows = raw.trim() ? raw.trim().split("\n").map(line => JSON.parse(line)) : [];
    if (rows.length && (rows.length !== 1 || rows[0].ID !== image.localImageId)) throw new ApplicationError("Local Docker tag identity changed; refusing to remove a replacement.");
    if (rows.length) await run({ argv: ["docker", "image", "rm", "--no-prune", image.localTag], cwd: os.tmpdir(), timeoutSeconds: 30 });
    const remaining = await run({ argv: ["docker", "image", "ls", "--no-trunc", "--format", "{{json .}}", "--filter", `reference=${image.localTag}`], cwd: os.tmpdir(), timeoutSeconds: 30 });
    if (remaining.trim()) throw new ApplicationError("Owned local Docker tag remains visible after cleanup.");
  }
  if (!/^[a-f0-9-]{36}$/.test(image.journalId)) throw new ApplicationError("Owned image journal identity is invalid.");
  const file = path.join(paths.abxDir, "resource-journal", `${image.journalId}.json`), journal = JSON.parse(fs.readFileSync(file, "utf8"));
  const entry = Array.isArray(journal.entries) ? journal.entries.find((item: unknown) => record(item) && item.intent_id === image.intentId && item.kind === "image" && item.correlation_key === image.localTag) : null;
  if (journal.id !== image.journalId || !entry) throw new ApplicationError("Owned image journal does not match its cleanup receipt.");
  entry.state = "deleted"; writeJson(file, journal);
}
/** A build that entered an application lifecycle must be cleaned through its retained-resource graph. */
export async function cleanBuild(file: string, credential: CredentialSnapshot, dependencies: BuildDependencies = {}): Promise<BuildReceipt> {
  releaseStoppedApplicationLock(path.join(paths.abxDir, "build-locks"), fs.realpathSync(file));
  return await withApplicationLock(path.join(paths.abxDir, "build-locks"), fs.realpathSync(file), async () => await cleanBuildUnlocked(file, credential, dependencies));
}
async function cleanBuildUnlocked(file: string, credential: CredentialSnapshot, dependencies: BuildDependencies): Promise<BuildReceipt> {
  const receipt = JSON.parse(fs.readFileSync(file, "utf8")) as BuildReceipt;
  if (receipt.kind !== "ManagedApplicationBuild" || receipt.schemaVersion !== 1) throw new ApplicationError("Invalid application build receipt.");
  if (receipt.usedBy?.length) throw new ApplicationError("This build entered an application lifecycle; use its app destroy/retire receipts instead of clean-build.");
  if (!receipt.ownedServerImage) return receipt;
  if (receipt.ownedServerImage.accountId !== credential.AccountID) throw new ApplicationError("Build owner differs from the verified deployment account.");
  if (receipt.status === "cleaned") return receipt;
  await removeOwnedImage(receipt.ownedServerImage, credential, dependencies); receipt.ownedServerImage.state = "deleted"; receipt.status = "cleaned"; writeJson(file, receipt); return receipt;
}

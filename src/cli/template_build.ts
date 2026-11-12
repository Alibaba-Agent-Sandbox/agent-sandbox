/** Reusable build artifacts; preparation never starts an application instance. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Context, Params } from "./kit.js";
import { getFormatter } from "./formatters.js";
import { UsageError } from "./errors.js";
import { acquireTemplateSource, _findTemplateYaml } from "./template_catalog.js";
import { executeTemplateLaunch } from "./template_launch.js";
import { ApplicationError, readTemplate, readYaml, record, sourceDigest, writeJson } from "../application/config.js";
import { cleanupResourceJournal, type CleanupTarget } from "../template/cleanup.js";
import { paths } from "../transport/config_layers.js";
import { buildApplication, cleanBuild } from "../application/tools.js";
import { withApplicationLock } from "../application/lock.js";
import { resolveDeployCredentials } from "../application/fc.js";
import { cliProvider } from "../providers/selection.js";
import { resolveProviderId } from "../providers/registry.js";

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

export const templateBuildSeams = { launch: executeTemplateLaunch, buildApplication, cleanBuild, cleanup: cleanupResourceJournal, credentials: resolveDeployCredentials };

/** Build a source template once and retain its source and resource ownership receipt. */
export async function buildTemplate(ctx: Context, params: Params): Promise<void> {
  if (!params.yes) throw new UsageError("Review the build target and pass --yes to permit preparation or cleanup.");
  if (params.clean) return cleanTemplateBuild(ctx, String(params.clean));
  const acquired = await acquireTemplateSource(ctx, String(params.source ?? "."));
  if (!acquired.directory) throw new UsageError("This catalog entry has no source to build.");
  const source = fs.realpathSync(acquired.directory), id = randomUUID();
  const output = path.resolve(String(params.out ?? path.join(acquired.ref.registry_type === "local" ? source : process.cwd(), ".abx", `build-${id}.json`)));
  if (fs.existsSync(output)) throw new ApplicationError("Build artifact already exists; retain its resources/journal and choose a new --out path.");
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const snapshotDirectory = path.join(acquired.ref.registry_type === "local" ? source : process.cwd(), ".abx");
  fs.mkdirSync(snapshotDirectory, { recursive: true, mode: 0o700 });
  const projectRoot = path.join(snapshotDirectory, `build-source-${id}`);
  const hash = snapshotTemplateSource(source, projectRoot), manifest = _findTemplateYaml(projectRoot);
  if (!manifest) throw new UsageError("Template source has no template.yaml.");
  const raw = readYaml(manifest);
  if (record(raw) && raw.application) {
    const template = readTemplate(manifest, { configurationSource: source }), credential = await templateBuildSeams.credentials(template.application.deployment.accessRef);
    const receipt = await templateBuildSeams.buildApplication(template, projectRoot, credential, output);
    writeJson(output, { ...receipt, projectRoot, configurationSource: source });
    getFormatter(ctx).printDict({ status: "built", build: output, kind: receipt.kind, image: receipt.image });
    return;
  }
  const base = { kind: "SandboxTemplateBuild", version: 1, provider: resolveProviderId(cliProvider()), projectRoot, configurationSource: source, sourceDigest: hash };
  let journalId: string | undefined, journalFile: string | undefined, target: CleanupTarget | undefined;
  const progress = (status: string) => ({ ...base, journal_id: journalId, journal_file: journalFile, target, status });
  try {
    const result = await templateBuildSeams.launch(ctx, { template_ref: projectRoot, timeout: params.timeout ?? 600,
      build_profile: params.build_profile, alias: params.alias, yes: true }, { prepareOnly: true, configurationSource: source,
      onTarget: value => { target = value; if (journalId) writeJson(output, progress("building")); },
      onJournal: journal => { journalId = journal.id; journalFile = journal.file; writeJson(output, progress("building")); } });
    if (sourceDigest(projectRoot) !== hash) throw new ApplicationError("Source changed during build; retain the journal and build a fresh snapshot.");
    writeJson(output, { ...result.receipt, ...base, journal_file: journalFile, status: "ready" });
    getFormatter(ctx).printDict({ status: "built", build: output, kind: base.kind, provider: base.provider, journal_id: result.receipt.journal_id });
  } catch (error) {
    if (journalId) writeJson(output, progress("requires_reconcile"));
    throw error;
  }
}

/** Clean only an unused build's owned resources, retaining its recovery record. */
export async function cleanTemplateBuild(ctx: Context, input: string): Promise<void> {
  const file = fs.realpathSync(input);
  return withApplicationLock(path.join(paths.abxDir, "template-build-locks"), file, async () => {
  const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
  if (artifact.usedBy?.length || artifact.consumers?.length) throw new UsageError("This build is used by an application; remove its consumers before cleaning the build.");
  if (artifact.kind === "ManagedApplicationBuild") {
    const credential = await templateBuildSeams.credentials(String(artifact.accessRef ?? "abx"));
    const result = await templateBuildSeams.cleanBuild(file, credential);
    getFormatter(ctx).printDict({ status: result.status ?? "borrowed", build: file });
    return;
  }
  if (artifact.kind !== "SandboxTemplateBuild" || artifact.version !== 1 ||
      !["ready", "building", "requires_reconcile", "cleaned"].includes(artifact.status) ||
      !record(artifact.target) || artifact.target.provider !== artifact.provider || typeof artifact.journal_id !== "string") {
    throw new UsageError("Expected a build artifact with a matching target and resource journal.");
  }
  if (cliProvider() && resolveProviderId(cliProvider()) !== artifact.provider) throw new UsageError("Selected Provider differs from the build owner.");
  const journal = String(artifact.journal_file ?? path.join(paths.abxDir, "resource-journal", `${artifact.journal_id}.json`));
  const result = await templateBuildSeams.cleanup(journal, artifact.target as CleanupTarget);
  artifact.status = result.complete ? "cleaned" : "requires_reconcile";
  writeJson(file, artifact);
  getFormatter(ctx).printDict({ status: artifact.status, build: file, retained: result.retained, failures: result.failures });
  if (!result.complete) throw new ApplicationError("Some build resources could not be cleaned; retain the artifact and journal for recovery.");
  });
}

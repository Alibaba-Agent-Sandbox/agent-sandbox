import { withGuidedConfiguration, canGuideConfiguration } from "./config_guidance.js";
import { confirm } from "./prompts.js";
/** Download, ask the selected adapter to prepare, then create using its returned reference. */
import fs from "node:fs";
import { pyExpandUser } from "../utils/_pyos.js";
import type { Provider } from "../providers/base.js";
import { loadYaml, isMapping } from "../utils/yaml_io.js";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Context } from "./kit.js";
import { getFormatter } from "./formatters.js";
import { getOutput } from "./output.js";
import { UsageError } from "./errors.js";
import { providerCliExtension } from "./provider_extensions.js";
import { getProvider, resolveProviderId } from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";
import { ProviderConfigError, ProviderFeatureNotSupportedError } from "../providers/errors.js";
import { loadLayeredConfig } from "../transport/config_layers.js";
import { RegistryClient, loadTemplateFromYaml } from "../utils/registry.js";
import { _findTemplateYaml, _resolveIndexName, _withGithubRateLimitRetry } from "./template_catalog.js";
import { resolveGithubToken } from "./commands/config_cmd.js";
import { Sandbox, _effectiveOptions } from "../api/sandbox.js";
import type { PreparedTemplate, ProjectTemplateOptions, ProviderTemplateManager } from "../providers/template_contract.js";

const requiredFeatures: Record<string, string> = { shell: "exec.run", files: "files.rw", code: "code.interpret", terminal: "pty", ports: "ports.url" };
export const launchSeams = { create: (options: Parameters<typeof Sandbox.create>[0]) => Sandbox.create(options) };

/** Validate a known local source before any credential prompt; remote sources are validated once after acquisition. */
function readLaunchProject(provider: Provider, directory: string, params: Record<string, unknown>) {
  const yaml = _findTemplateYaml(directory);
  if (!yaml) throw new ProviderConfigError("Template source has no template.yaml.");
  // The YAML's parent is the build context even when a repository contains several projects.
  directory = path.dirname(yaml);
  const template = loadTemplateFromYaml(yaml);
  const capabilities = template.capabilities ?? ["shell", "files", "code"];
  const raw = loadYaml(fs.readFileSync(yaml, "utf8"));
  const sourceMetadata = isMapping(raw) ? raw as Record<string, unknown> : {};
  for (const field of ["start_cmd", "ready_cmd"]) if (sourceMetadata[field] !== undefined && (typeof sourceMetadata[field] !== "string" || !sourceMetadata[field].trim())) throw new ProviderConfigError("Template start/ready commands must be nonempty strings.");
  for (const capability of capabilities) provider.require(requiredFeatures[capability] ?? capability);
  const alias = String(params["alias"] ?? template.name);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(alias)) throw new ProviderConfigError("Template alias must be a lowercase name of at most 63 characters.");
  const timeout = Number(params["timeout"] ?? 600);
  const options: ProjectTemplateOptions = { alias, timeout, template: { name: template.name,
    capabilities, cpu: template.cpu_count ?? 2, memory: template.memory_mb ?? 2048,
    start_cmd: sourceMetadata["start_cmd"] as string | undefined ?? null, ready_cmd: sourceMetadata["ready_cmd"] as string | undefined ?? null } };
  return { directory, template, options };
}

/** One explicit operation; never guesses an ID or falls back to another backend. */
export async function launchTemplate(ctx: Context, params: Record<string, unknown>): Promise<void> {
  if (!params["yes"] && !canGuideConfiguration(ctx, false)) throw new UsageError("Pass --yes to build/register the template and create a billable sandbox.");
  const provider = getProvider(resolveProviderId(cliProvider()));
  provider.require("templates.build");
  provider.require("sandbox.lifecycle");
  const timeoutInput = Number(params["timeout"] ?? 600), sandboxTimeoutInput = Number(params["sandbox_timeout"] ?? 300);
  if (!Number.isFinite(timeoutInput) || timeoutInput <= 0 || timeoutInput > 3600 || !Number.isFinite(sandboxTimeoutInput) || sandboxTimeoutInput <= 0) throw new ProviderConfigError("Build timeout must be in (0, 3600] and sandbox timeout must be positive.");
  const source = String(params["template_ref"]);
  const initialDirectory = path.resolve(pyExpandUser(source));
  const exists = fs.existsSync(initialDirectory);
  const isLocal = exists && fs.statSync(initialDirectory).isDirectory();
  if (exists && !isLocal) throw new UsageError("Template project source is not a directory.");
  if (!exists && (path.isAbsolute(source) || source.startsWith("./") || source.startsWith("../") || source.startsWith("~/"))) throw new UsageError("Template project directory does not exist. Create it with 'abx template scaffold DIRECTORY' or choose an existing template source.");
  const localProject = isLocal ? readLaunchProject(provider, initialDirectory, params) : null;
  return withGuidedConfiguration(ctx, { operation: "Prepare template and create sandbox", provider: provider.id, yes: Boolean(params["yes"]),
    requirements: provider.id === "alicloud-express" ? ["sandbox_api_key"] : undefined }, async () => {
  const fmt = getFormatter(ctx), out = getOutput(ctx);
  let directory = initialDirectory;
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    const token = await resolveGithubToken(null);
    directory = await _withGithubRateLimitRetry(async (active) => {
      const registry = new RegistryClient("https://github.com", active);
      let ref = await registry.resolve(source);
      if (ref.is_builtin) ref = await registry.resolve(await _resolveIndexName(source, { token: active, fmt, out }));
      return registry.fetch(ref);
    }, { token, fmt, out });
  }
  const project = localProject ?? readLaunchProject(provider, directory, params);
  directory = project.directory;
  const { template, options } = project;
  const sandboxTimeout = sandboxTimeoutInput;
  const providerOptions = _effectiveOptions(provider, null) ?? {};
  const config = loadLayeredConfig({ provider: provider.id, provider_options: providerOptions });
  provider.validateConfig(config);
  let manager: ProviderTemplateManager | undefined;
  let prepared: PreparedTemplate;
  try {
    const extension = providerCliExtension(provider.id);
    if (extension?.prepareProject) prepared = await extension.prepareProject(directory, options, ctx);
    else {
      if (!params["yes"]) await confirm("Build/register this template and create a billable sandbox?", { abort: true, err: true });
      manager = await provider.buildTemplateManager(config);
      if (!manager.prepareProject) throw new ProviderFeatureNotSupportedError(provider.id, "templates.build");
      prepared = await manager.prepareProject(directory, options);
    }
  } finally { await manager?.close?.(); }
  const reference = prepared?.reference;
  for (const command of [prepared?.startup_command, prepared?.ready_command]) if (command !== undefined && (typeof command !== "string" || !command.trim())) throw new ProviderConfigError("Provider preparation returned an invalid service command.");
  if (prepared?.metadata !== undefined && (typeof prepared.metadata !== "object" || prepared.metadata === null || Array.isArray(prepared.metadata) || Object.values(prepared.metadata).some(v => typeof v !== "string"))) throw new ProviderConfigError("Provider preparation returned invalid creation metadata.");
  if (prepared?.provider_options !== undefined) {
    const fields = new Map(provider.configFields.map(f => [f.key, f]));
    if (typeof prepared.provider_options !== "object" || prepared.provider_options === null || Array.isArray(prepared.provider_options) || Object.keys(prepared.provider_options).some(k => !fields.has(k) || fields.get(k)!.secret)) throw new ProviderConfigError("Provider preparation cannot override credentials or undeclared provider options.");
  }
  const secrets = provider.configFields.filter(f => f.secret).map(f => config.provider_options[f.key]).filter((v): v is string => typeof v === "string" && Boolean(v));
  if (prepared?.status !== "ready" || typeof reference !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,1023}$/.test(reference) || reference.includes("://") ||
    secrets.some(secret => reference.includes(secret))) throw new ProviderConfigError("Provider preparation returned an invalid ready reference.");
  const sandbox = await launchSeams.create({ provider: provider.id, template: reference,
    provider_options: { ...providerOptions, ...prepared.provider_options }, metadata: prepared.metadata,
    envs: Object.fromEntries(Object.entries(template.env).map(([key, value]) => [key, value || process.env[key] || ""])),
    timeout: sandboxTimeout, cpu: template.cpu_count, memory: template.memory_mb });
  try {
    const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'";
    if (prepared.startup_command) {
      const result = await sandbox.commands.run(`nohup /bin/sh -c ${quote(prepared.startup_command)} >/tmp/abx-template-server.log 2>&1 </dev/null &`, { timeout: 10 });
      if (!("exit_code" in result) || result.exit_code !== 0) throw new Error("Startup failed");
    }
    if (prepared.ready_command) {
      const deadline = Date.now() + Math.min(options.timeout, 60) * 1000;
      for (;;) {
        const remaining = Math.max(0.01, Math.min(5, (deadline - Date.now()) / 1000));
        const result = await sandbox.commands.run(prepared.ready_command, { timeout: remaining });
        if ("exit_code" in result && result.exit_code === 0) break;
        if (Date.now() >= deadline) throw new Error("Readiness timed out");
        await delay(250);
      }
    }
    fmt.printData({ sandbox_id: sandbox.id, provider: provider.id, template_reference: reference });
  } catch {
    let cleaned = false;
    try { await sandbox.kill(); cleaned = true; } catch { /* Report the owned ID if cleanup could not be confirmed. */ }
    throw new ProviderConfigError(`Template startup failed; owned sandbox ${sandbox.id} cleanup ${cleaned ? "completed" : "could not be confirmed"}.`);
  } finally { await sandbox.close(); }
  });
}

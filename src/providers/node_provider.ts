import { stageProject, buildProjectImage, runTool } from "./shared/project.js";
import type { ProviderTemplateManager } from "./template_contract.js";
import { loadTemplate } from "./shared/e2b/template_sdk.js";
import { sessionAuth as e2bSessionAuth, openTerminal as e2bOpenTerminal } from "./shared/e2b/session.js";
import type { SandboxInfo as SessionInfo } from "../models/sandbox.js";
import type { TerminalContext as SessionTerminalContext, ProviderInfra as SessionInfra } from "./base.js";
/**
 * `node` providers: an ES module that `abx` loads in process (`[runtime] kind = "node"`, `protocol = "node/1"`).
 *
 * The manifest declares identity, features, config fields and credentials. The module only builds the protocol objects
 * for one resolved configuration. It receives the host's building blocks (the kit) as an argument, so a plugin
 * directory has no imports to resolve and nothing to install.
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { InvalidAPIKeyError } from "../models/errors.js";
import { CodeInterpreterProtocol } from "./shared/e2b/code_interpreter.js";
import { FilesystemProtocol } from "./shared/e2b/filesystem.js";
import { ProcessProtocol } from "./shared/e2b/process.js";
import { SandboxProtocol } from "./shared/e2b/sandbox.js";
import type { AuthProvider } from "../transport/auth_contract.js";
import type { LayeredConfig } from "../transport/config_layers.js";
import { HttpClient, HTTPStatusError } from "../transport/http.js";
import { Provider, consentedInherit, type ProviderInfra, type ProviderTemplates } from "./base.js";
import { unsupportedAdapter } from "./exec_provider.js";
import { ProviderConfigError, ProviderFeatureNotSupportedError, ProviderProtocolError } from "./errors.js";
import { CODE_RULES, FILESYSTEM_RULES, PROCESS_RULES, SANDBOX_RULES, gateProtocol } from "./feature_gate.js";
import { hostVersion } from "./host.js";
import { eppInfra, type EppFactory } from "./node_epp.js";
import type { Manifest } from "./manifest.js";
import { HeaderKeyAuth } from "./rest_provider.js";
import * as store from "./store.js";

type Dict = Record<string, unknown>;

/** What a plugin module returns from `buildInfra`. Missing protocols answer `E8004`. */
export interface NodeInfra {
  /** Provider management operations; only manifest-declared command ids are callable. */
  provider_commands?: ProviderInfra["provider_commands"];
  sandbox_protocol: object;
  process_protocol?: object | null;
  filesystem_protocol?: object | null;
  code_interpreter_protocol?: object | null;
  http_client?: HttpClient | null;
  auth?: AuthProvider | null;
  /** The endpoint the sandbox object reports (`domain` builds port hosts such as `49983-{id}.{domain}`). */
  endpoint?: { base_url?: string; domain?: string };
  envd_auth?: { allow_missing?: boolean; basic_user?: string };
  close?: () => Promise<void>;
}

export interface HttpOptions {
  base_url: string;
  domain: string;
  auth?: AuthProvider | null;
  envelope_connect?: boolean;
  envd_dial?: readonly [string, number] | null;
}

/** What `buildInfra` receives: the resolved configuration of this provider and constructors bound to it. */
export interface NodeContext {
  id: string;
  features: ReadonlySet<string>;
  /** Every declared field of the manifest, resolved (explicit, environment, `.env`, `config.toml`, default). */
  options: Readonly<Record<string, unknown>>;
  /** The generic keys the manifest's `[core] inherit` lists and the user consented to. */
  core: Readonly<Record<string, unknown>>;
  /** Option keys whose values are secrets (redacted from errors). */
  secretKeys: readonly string[];
  /** Seconds a single provider call may take. */
  callTimeout: number;
  http(opts: HttpOptions): HttpClient;
  headerKeyAuth(key: string, header?: string): AuthProvider;
  noAuth(): AuthProvider;
}

export interface NodePlugin {
  buildTemplates?(ctx: NodeContext): Promise<ProviderTemplates>;
  buildInfra(ctx: NodeContext): Promise<NodeInfra>;
  /** Optional template factory; authentication, API mapping and polling stay in the plugin. */
  buildTemplateManager?(ctx: NodeContext): Promise<ProviderTemplateManager>;
}

/** Building blocks handed to `create(kit)`. */
export interface ProviderKit {
  hostVersion: string;
  project: { stage: typeof stageProject; buildImage: typeof buildProjectImage; runTool: typeof runTool };
  SandboxProtocol: typeof SandboxProtocol;
  ProcessProtocol: typeof ProcessProtocol;
  FilesystemProtocol: typeof FilesystemProtocol;
  CodeInterpreterProtocol: typeof CodeInterpreterProtocol;
  errors: { InvalidAPIKeyError: typeof InvalidAPIKeyError; ProviderConfigError: typeof ProviderConfigError; ProviderFeatureNotSupportedError: typeof ProviderFeatureNotSupportedError };
  e2b: {
    loadTemplate(): Promise<unknown>;
    resumeConnect<T extends SandboxProtocol>(inner: T, paths?: readonly string[]): T;
    withDefault<T extends object>(inner: T, option: string, value: string, methods: readonly string[]): T;
    overlay<T extends object, O extends object>(inner: T, overrides: O): T & O;
    parseExecution(raw: string): { stdout: string; stderr: string; text: string; exitCode: number };
  };
  /** Run a module that speaks EPP/1 (an exported dispatcher) in this process and adapt it to the protocol objects. */
  epp: { infra(ctx: NodeContext, factory: EppFactory): Promise<NodeInfra> };
}

class NoAuth implements AuthProvider {
  async getHeaders(): Promise<Record<string, string>> {
    return {};
  }
  async refresh(): Promise<void> {
    return undefined;
  }
}

/** Resume a paused sandbox the way E2B-shaped backends do: `POST` the connect routes in order, then fall back to `GET`. */
export function resumeConnect<T extends SandboxProtocol>(inner: T, paths: readonly string[] = ["/sandboxes/{id}/connect"]): T {
  const connect = async (sandboxId: string): Promise<unknown> => {
    for (const pattern of paths) {
      let response;
      try {
        response = await inner._http.platformRequest("POST", pattern.replace("{id}", sandboxId), { json: {} });
      } catch (exc) {
        if (exc instanceof HTTPStatusError && [404, 405].includes(exc.response.status_code)) continue;
        throw exc;
      }
      if (response.status_code === 204 || response.content.length === 0) return inner.getInfo(sandboxId);
      return inner._info(response.json());
    }
    return inner.connect(sandboxId);
  };
  return new Proxy(inner, {
    get(target, prop) {
      if (prop === "connect") return connect;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** Fill `option` in the options object (last argument) of the listed methods when the caller left it empty. */
export function withDefault<T extends object>(inner: T, option: string, value: string, methods: readonly string[]): T {
  return new Proxy(inner, {
    get(target, prop) {
      const member: unknown = Reflect.get(target, prop, target);
      if (typeof member !== "function") return member;
      if (typeof prop !== "string" || !methods.includes(prop)) return (member as (...a: unknown[]) => unknown).bind(target);
      return (...args: unknown[]) => {
        const last = args[args.length - 1];
        if (last !== null && typeof last === "object" && !Array.isArray(last) && !(last as Dict)[option]) {
          args[args.length - 1] = { ...(last as Dict), [option]: value };
        }
        return (member as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

/** `inner` with some members replaced; every other member is `inner`'s own, bound to it. */
export function overlay<T extends object, O extends object>(inner: T, overrides: O): T & O {
  return new Proxy(inner, {
    get(target, prop) {
      if (Object.prototype.hasOwnProperty.call(overrides, prop)) return Reflect.get(overrides, prop) as unknown;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
    has(target, prop) {
      return Object.prototype.hasOwnProperty.call(overrides, prop) || Reflect.has(target, prop);
    },
  }) as T & O;
}

/** Read a Jupyter-style `/execute` ndjson body into the code-result shape. */
export function parseExecution(raw: string): { stdout: string; stderr: string; text: string; exitCode: number } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let text = "";
  let exitCode = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      stdout.push(trimmed);
      continue;
    }
    if (event === null || typeof event !== "object" || Array.isArray(event)) continue;
    const e = event as Dict;
    const kind = String(e["type"] ?? "");
    const piece = String(e["text"] ?? "");
    if (kind === "stderr") stderr.push(piece);
    else if (kind === "result" || kind === "end") text = piece || text;
    else if (kind === "error") {
      exitCode = 1;
      stderr.push(piece || String(e["value"] ?? e["evalue"] ?? ""));
    } else stdout.push(piece);
  }
  return { stdout: stdout.join(""), stderr: stderr.join(""), text: text || stdout.join("").trim(), exitCode };
}

export function providerKit(): ProviderKit {
  return {
    hostVersion: hostVersion(),
    project: { stage: stageProject, buildImage: buildProjectImage, runTool },
    SandboxProtocol,
    ProcessProtocol,
    FilesystemProtocol,
    CodeInterpreterProtocol,
    errors: { InvalidAPIKeyError, ProviderConfigError, ProviderFeatureNotSupportedError },
    e2b: { resumeConnect, withDefault, overlay, parseExecution, loadTemplate },
    epp: { infra: eppInfra },
  };
}

const loaded = new Map<string, NodePlugin>();

/** Import the plugin module once per installed tree digest; an update gets a fresh module. */
async function loadPlugin(id: string, root: string, entry: string, digest: string): Promise<NodePlugin> {
  const file = path.resolve(root, entry);
  const key = `${file}#${digest}`;
  const cached = loaded.get(key);
  if (cached !== undefined) return cached;
  const url = `${pathToFileURL(file).href}?v=${encodeURIComponent(digest || "link")}`;
  const mod = (await import(url)) as { default?: unknown; create?: unknown };
  const factory = typeof mod.create === "function" ? mod.create : mod.default;
  if (typeof factory !== "function") {
    throw new ProviderConfigError(`Provider '${id}': ${entry} must export a function (default or "create") that takes the kit.`);
  }
  const plugin = (await (factory as (kit: ProviderKit) => unknown)(providerKit())) as NodePlugin | null;
  if (plugin === null || typeof plugin !== "object" || typeof plugin.buildInfra !== "function") {
    throw new ProviderConfigError(`Provider '${id}': ${entry} must return an object with buildInfra(ctx).`);
  }
  loaded.set(key, plugin);
  return plugin;
}

/** A provider whose backend code is an installed ES module. */
export class NodeProvider extends Provider {
  override createSessionAuth(info: SessionInfo, infra?: SessionInfra) { return e2bSessionAuth(info, infra); }
  override async openTerminal(context: SessionTerminalContext, opts: { cols: number; rows: number; shell: string }) {
    this.require("pty");
    if (context.url.startsWith("epp://")) return super.openTerminal(context, opts);
    return e2bOpenTerminal(context, opts);
  }
  override kind = "node" as const;
  readonly id: string;

  constructor(
    readonly manifest: Manifest,
    readonly pluginRoot: string,
    readonly receipt: Dict | null = null,
  ) {
    super();
    this.id = manifest.id;
    this.displayName = manifest.name;
    this.displayNameZh = manifest.name_zh;
    this.version = manifest.version;
    this.features = new Set(manifest.features);
    this.commands = manifest.commands;
    this.commandTimeoutMs = manifest.call_timeout_ms;
    this.configFields = manifest.fields;
    this.authAnyOf = manifest.auth_any_of;
    this.inherit = consentedInherit(manifest.inherit, receipt);
  }

  private async context(config: LayeredConfig) {
    this.validateConfig(config);
    if (this.receipt !== null && this.receipt["trust"] !== "link") store.verifyIntegrity(this.id);
    const digest = String(this.receipt?.["tree_sha256"] ?? "");
    const plugin = await loadPlugin(this.id, this.pluginRoot, this.manifest.entry, digest);

    const options: Dict = {};
    for (const f of this.configFields) {
      const v = config.provider_options[f.key];
      if (v !== undefined && v !== null) options[f.key] = v;
    }
    const core: Dict = {};
    for (const key of this.inherit) {
      const v = (config as unknown as Dict)[key];
      if (v !== undefined && v !== null) core[key] = v;
    }
    core["http_timeout"] = config.http_timeout;
    core["max_retries"] = config.max_retries;

    const transport = (endpoint: { base_url?: string; domain?: string }) => {
      const copy: LayeredConfig = Object.assign(Object.create(Object.getPrototypeOf(config) as object) as LayeredConfig, config);
      if (endpoint.base_url) copy.sandbox_base_url = endpoint.base_url;
      if (endpoint.domain) copy.sandbox_domain = endpoint.domain;
      return copy;
    };
    const clients: HttpClient[] = [];
    const ctx: NodeContext = {
      id: this.id,
      features: this.features,
      options,
      core,
      secretKeys: this.configFields.filter((f) => f.secret).map((f) => f.key),
      callTimeout: this.manifest.call_timeout_ms / 1000,
      http: (o) => {
        const client = new HttpClient(transport(o).toTransportConfig(), o.auth ?? new NoAuth(), {
          envelope_connect: o.envelope_connect ?? false,
          envd_dial: o.envd_dial ?? null,
        });
        clients.push(client);
        return client;
      },
      headerKeyAuth: (key, header = "X-API-Key") => new HeaderKeyAuth(key, "header", header),
      noAuth: () => new NoAuth(),
    };

    return { plugin, ctx, transport, clients };
  }

  override async buildTemplates(config: LayeredConfig): Promise<ProviderTemplates> {
    this.require("templates.deploy");
    const { plugin, ctx, clients } = await this.context(config);
    let built: ProviderTemplates | undefined;
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      const results = await Promise.allSettled([
        Promise.resolve().then(() => built?.close?.()),
        ...clients.map(client => Promise.resolve().then(() => client.close())),
      ]);
      if (results.some(result => result.status === "rejected")) throw new ProviderConfigError("Provider template resources could not be closed.");
    };
    try {
      if (!plugin.buildTemplates) throw new ProviderFeatureNotSupportedError(this.id, "templates.deploy");
      built = await plugin.buildTemplates(ctx);
      if (!built || typeof built.deploy !== "function") throw new ProviderConfigError("Provider returned an invalid template factory.");
      return { deploy: input => built!.deploy(input), close };
    } catch (error) {
      await close().catch(() => undefined);
      throw error;
    }
  }

  override async buildTemplateManager(config: LayeredConfig, feature = "templates.build"): Promise<ProviderTemplateManager> {
    this.require(feature);
    const { plugin, ctx, clients } = await this.context(config);
    let manager: ProviderTemplateManager | undefined;
    const close = async () => {
      const results = await Promise.allSettled([
        ...(manager?.close ? [Promise.resolve().then(() => manager!.close!())] : []),
        ...clients.map(client => Promise.resolve().then(() => client.close())),
      ]);
      if (results.some(result => result.status === "rejected")) throw new ProviderProtocolError(`Provider '${this.id}' resource cleanup failed.`);
    };
    try {
      if (!plugin.buildTemplateManager) throw new ProviderFeatureNotSupportedError(this.id, feature);
      const result = await plugin.buildTemplateManager(ctx);
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new ProviderProtocolError(`Provider '${this.id}' returned invalid template infrastructure.`);
      manager = result;
      const gated = gateProtocol(manager, this.id, {
        list: ["templates.read"], get: ["templates.read"],
        prepareProject: ["templates.build"], build: ["templates.build"], buildProject: ["templates.build"],
        delete: ["templates.build"], create: ["templates.build"], push: ["templates.build"],
      }, this.features);
      return new Proxy(gated, { get(target, key) { return key === "close" ? close : Reflect.get(target, key); } });
    } catch (error) {
      await close();
      throw error;
    }
  }

  async buildInfra(config: LayeredConfig): Promise<ProviderInfra> {
    const { plugin, ctx, transport, clients } = await this.context(config);
    let built: NodeInfra;
    try {
      built = await plugin.buildInfra(ctx);
      if (built === null || typeof built !== "object" || Array.isArray(built)) {
        throw new ProviderProtocolError(`Provider '${this.id}' returned invalid infrastructure.`);
      }
    } catch (exc) {
      await Promise.allSettled(clients.map((client) => client.close()));
      throw exc;
    }
    const gate = <T extends object>(protocol: T | null | undefined, rules: Parameters<typeof gateProtocol>[2], feature: string): T =>
      protocol ? gateProtocol(protocol, this.id, rules, this.features) : (unsupportedAdapter(this.id, feature) as unknown as T);
    const own = built.http_client ?? null;
    return {
      provider_commands: built.provider_commands,
      config: transport(built.endpoint ?? {}),
      auth: built.auth ?? null,
      http_client: own,
      sandbox_protocol: gate(built.sandbox_protocol, SANDBOX_RULES, "sandbox.lifecycle") as never,
      process_protocol: gate(built.process_protocol, PROCESS_RULES, "exec.run") as never,
      filesystem_protocol: gate(built.filesystem_protocol, FILESYSTEM_RULES, "files.rw") as never,
      code_interpreter_protocol: gate(built.code_interpreter_protocol, CODE_RULES, "code.interpret") as never,
      envd_auth: built.envd_auth,
      close: async () => {
        const cleanup = await Promise.allSettled([
          ...(built.close ? [Promise.resolve().then(() => built.close!())] : []),
          ...clients.map((client) => Promise.resolve().then(() => client.close())),
          ...(own !== null && !clients.includes(own) ? [Promise.resolve().then(() => own.close())] : []),
        ]);
        if (cleanup.some((result) => result.status === "rejected")) throw new ProviderProtocolError(`Provider '${this.id}' resource cleanup failed.`);
      },
    };
  }
}

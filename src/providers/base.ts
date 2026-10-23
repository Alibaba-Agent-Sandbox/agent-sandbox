import type { OperationDeclaration } from "./operations.js";
import { unsupportedProtocol } from "./unsupported.js";
import type { PortAccess, PortContext } from "../protocol/port_contract.js";
export type { PortAccess, PortContext } from "../protocol/port_contract.js";
import type { ProviderTemplateManager } from "./template_contract.js";
/**
 * Provider contract: identity, feature matrix, config schema, infrastructure factory
 * (port of `agent_sandbox/providers/base.py`).
 */

import { InvalidCredentialsError } from "../models/errors.js";
import type { CodeInterpreterProtocol } from "../protocol/contracts.js";
import type { FilesystemProtocol } from "../protocol/contracts.js";
import type { ProcessProtocol } from "../protocol/contracts.js";
import type { SandboxProtocol } from "../protocol/contracts.js";
import type { AuthProvider, DataPlaneAuth } from "../transport/auth_contract.js";
import type { LayeredConfig } from "../transport/config_layers.js";
import type { HttpClient } from "../transport/http.js";
import type { TransportConfig } from "../transport/config.js";
import type { SandboxInfo } from "../models/sandbox.js";

import type { TerminalSession } from "../protocol/contracts.js";

import {
  GENERIC_ENDPOINT_KEYS,
  providerEnvName,
  type Alias,
  type ConfigKey,
  type KeyType,
  type Storage,
} from "../utils/config_keys.js";
import { ProviderConfigError, ProviderFeatureNotSupportedError } from "../models/provider_errors.js";
import type { ProviderCommand, ProviderCommandRunner } from "./command_contract.js";

/** Feature registry (design section 7.2). Values are the stable wire/manifest ids. */
export const FEATURES = [
  "sandbox.lifecycle",
  "sandbox.timeout",
  "sandbox.pause",
  "exec.run",
  "exec.stream",
  "process.manage",
  "pty",
  "files.rw",
  "files.watch",
  "files.transfer",
  "templates.read",
  "templates.build",
  "ports.url",
  "ports.domain",
  "storage.mount",
  "network.vpc",
  "sessions",
] as const;
export type ProviderFeature = (typeof FEATURES)[number];

/** Feature ids in registry order; ids the host does not know come last, sorted. */
export function orderedFeatures(features: Iterable<string>): string[] {
  const have = new Set(features);
  const known = FEATURES.filter((f) => have.has(f));
  const extra = [...have].filter((f) => !(FEATURES as readonly string[]).includes(f)).sort();
  return [...known, ...extra];
}

/** `sandbox.lifecycle, sandbox.pause, pty` -> `sandbox(lifecycle,pause) pty`: one line per provider in listings. */
export function compactFeatures(features: Iterable<string>): string {
  const groups = new Map<string, string[]>();
  for (const feature of orderedFeatures(features)) {
    const dot = feature.indexOf(".");
    const head = dot < 0 ? feature : feature.slice(0, dot);
    const list = groups.get(head) ?? [];
    if (dot >= 0) list.push(feature.slice(dot + 1));
    groups.set(head, list);
  }
  return [...groups].map(([head, tails]) => (tails.length ? `${head}(${tails.join(",")})` : head)).join(" ");
}

/** Template capability token implied by a provider feature (design section 7.2). */
export const FEATURE_TO_CAPABILITY: Readonly<Record<string, string>> = {
  "exec.run": "shell",
  "files.rw": "files",
  pty: "terminal",
  "ports.url": "ports",
};

export type ProviderKind = "builtin" | "rest" | "exec" | "node" | "python";

/** One provider-scoped configuration field (`[config.fields.<key>]`). */
export interface ConfigField {
  key: string;
  type?: string;
  required?: boolean;
  secret?: boolean;
  credential?: boolean;
  default?: string | number | boolean | null;
  description?: string;
  description_zh?: string;
  env?: readonly string[];
  choices?: readonly string[];
}

const KEY_TYPE_SET = new Set<string>(["str", "url", "int", "float", "bool", "enum", "path", "csv"]);

/** The registry record the resolver uses for a manifest field. */
export function configFieldToKey(field: ConfigField, providerId: string): ConfigKey {
  const storage: Storage = field.secret
    ? { file: "env", name: providerEnvName(providerId, field.key) }
    : { file: "toml", name: field.key, section: `providers.${providerId}` };
  const aliases: Alias[] = (field.env ?? []).map((name) => ({ name, kind: "native", surface: "env" }));
  const type = (KEY_TYPE_SET.has(field.type ?? "str") ? field.type ?? "str" : "str") as KeyType;
  return {
    key: field.key,
    scope: providerId,
    type,
    secret: Boolean(field.secret),
    credential: Boolean(field.credential),
    settable: true,
    env: providerEnvName(providerId, field.key),
    aliases,
    env_names: [],
    toml_section: null,
    storage: storage,
    default: field.default ?? null,
    choices: field.choices ?? [],
    group: "",
    description: field.description ?? "",
    required: Boolean(field.required),
    description_zh: field.description_zh ?? "",
  };
}

/** Generic endpoint keys a manifest-driven provider may read: declared in `[core] inherit` and consented to at install. */
export function consentedInherit(declared: readonly string[], receipt: Readonly<Record<string, unknown>> | null): Set<string> {
  if (receipt === null) return new Set(declared);
  const consented = ((receipt["consented"] as { inherit?: string[] } | undefined)?.inherit ?? []) as string[];
  return new Set(declared.filter((k) => consented.includes(k)));
}

type Loose<T> = Omit<T, "_http" | "_handleCreateError">;

/** What a sandbox needs from a provider (the protocol objects of the built-in transport or EPP adapters). */
export interface ProviderInfra {
  /** Optional dispatcher for management commands declared in static metadata. */
  provider_commands?: Omit<ProviderCommandRunner, "close">;
  config: LayeredConfig;
  auth: AuthProvider | null;
  http_client: HttpClient | null;
  sandbox_protocol: Loose<SandboxProtocol>;
  process_protocol: Loose<ProcessProtocol> | null;
  filesystem_protocol: Loose<FilesystemProtocol> | null;
  code_interpreter_protocol: Loose<CodeInterpreterProtocol> | null;
  /** Releases the plugin process / HTTP client; call on every exit path. */
  close?: () => Promise<void>;
  /** How this backend wants its envd token handled (a missing token, a Basic user other than `user`). */
  envd_auth?: { allow_missing?: boolean; basic_user?: string };
}

/** Session behavior supplied by the backend, never reconstructed by Sandbox. */
export interface SessionProtocols {
  sandbox_protocol: ProviderInfra["sandbox_protocol"];
  process_protocol: ProviderInfra["process_protocol"];
  filesystem_protocol: ProviderInfra["filesystem_protocol"];
  code_interpreter_protocol: ProviderInfra["code_interpreter_protocol"];
}
export interface TerminalContext {
  url: string;
  token: DataPlaneAuth;
  config: TransportConfig;
  http: HttpClient | null;
  process: ProviderInfra["process_protocol"];
}
export interface ProviderDescription {
  id: string;
  name: string;
  name_zh: string;
  version: string;
  kind: ProviderKind;
  features: string[];
  operation_contract_version: 1;
  operations: OperationDeclaration;
  workflow_inputs: readonly string[];
  startup_modes: readonly string[];
  config_fields: Array<{
    key: string;
    type: string;
    secret: boolean;
    credential: boolean;
    required: boolean;
    default: unknown;
    env: string;
    aliases: string[];
    description: string;
    description_zh: string;
  }>;
  inherit: string[];
}

/**
 * A sandbox backend. This package implements the built-in provider and the manifest-driven `node`, `rest` and `exec`
 * providers. A manifest with `kind = "python"` is rejected. In-code subclasses may still set `kind` to `"python"` and
 * register programmatically; that is not an installable catalog plugin.
 */
export abstract class Provider {
  abstract readonly id: string;
  displayName = "";
  displayNameZh = "";
  version = "0.0.0";
  kind: ProviderKind = "python";
  features: ReadonlySet<string> = new Set();
  readonly operation_contract_version = 1 as const;
  operations: OperationDeclaration = { cli: [], python: [] };
  workflow_inputs: readonly string[] = [];
  startup_modes: readonly string[] = [];
  commands: readonly ProviderCommand[] = [];
  commandTimeoutMs = 60_000;
  configFields: readonly ConfigField[] = [];
  /** Generic keys (`sandbox_api_key`, `sandbox_base_url`, `sandbox_domain`) it reads. */
  inherit: ReadonlySet<string> = new Set();
  /** `[auth] any_of` groups of config-field keys; empty = no credential check. */
  authAnyOf: ReadonlyArray<readonly string[]> = [];
  /** `[endpoint.derive]` templates (key -> template with `{region}`-style fields). */
  derive: Readonly<Record<string, string>> = {};
  /** Static endpoint defaults (`sandbox_base_url` / `sandbox_domain`) of declarative providers. */
  endpointDefaults: Readonly<Record<string, string>> = {};

  /** Throws `ProviderFeatureNotSupportedError` (E8004) unless `feature` is implemented. */
  require(feature: string): void {
    if (!this.features.has(feature)) throw new ProviderFeatureNotSupportedError(this.id, feature);
  }

  supports(feature: string): boolean {
    return this.features.has(feature);
  }

  /** Throws when required fields or every credential group of `authAnyOf` are missing. */
  validateConfig(config: LayeredConfig): void {
    const opts = config.provider_options;
    const have = (name: string): boolean => {
      if (GENERIC_ENDPOINT_KEYS.includes(name)) {
        return Boolean((config as unknown as Record<string, unknown>)[name]) && this.inherit.has(name);
      }
      const v = opts[name];
      return v !== null && v !== undefined && v !== "";
    };
    for (const f of this.configFields) {
      if (f.required && !have(f.key)) {
        const names = [providerEnvName(this.id, f.key), ...(f.env ?? [])].join(", ");
        const Cls = f.credential ? InvalidCredentialsError : ProviderConfigError;
        throw new Cls(
          `Provider '${this.id}' needs '${f.key}' (set ${names} or 'abx config set providers.${this.id}.${f.key} ...').`,
          { suggestion: `Run 'abx provider info ${this.id}' for all options.` },
        );
      }
    }
    if (this.authAnyOf.length > 0 && !this.authAnyOf.some((grp) => grp.every(have))) {
      const wanted = this.authAnyOf
        .map((grp) => grp.map((n) => (GENERIC_ENDPOINT_KEYS.includes(n) ? n : providerEnvName(this.id, n))).join(" + "))
        .join(" or ");
      throw new InvalidCredentialsError(`Provider '${this.id}' is missing credentials (set ${wanted}).`, {
        suggestion: `Run 'abx provider info ${this.id}' for details.`,
      });
    }
  }

  configKeys(): readonly ConfigKey[] {
    return this.configFields.map((f) => configFieldToKey(f, this.id));
  }

  /** Build the protocol objects for `config` (already resolved for this provider). */
  abstract buildInfra(config: LayeredConfig): Promise<ProviderInfra>;

  /** Explicit optional create inputs; implementations opt in before any I/O. */
  createOptions: ReadonlySet<string> = new Set();

  buildSessionProtocols(_http: HttpClient): SessionProtocols {
    return { sandbox_protocol: unsupportedProtocol(this.id, "sandbox.lifecycle"),
      process_protocol: unsupportedProtocol(this.id, "exec.run"), filesystem_protocol: unsupportedProtocol(this.id, "files.rw"),
      code_interpreter_protocol: unsupportedProtocol(this.id, "code.execute") } as unknown as SessionProtocols;
  }

  createSessionAuth(info: SandboxInfo, infra?: ProviderInfra): DataPlaneAuth {
    const protocol = infra?.sandbox_protocol as { createSessionAuth?: (info: SandboxInfo) => DataPlaneAuth } | undefined;
    if (protocol && "createSessionAuth" in protocol && typeof protocol.createSessionAuth === "function") return protocol.createSessionAuth(info);
    return { token: info.envd_access_token, sandbox_id: info.sandbox_id,
      getHeaders: () => ({}), setToken: () => undefined, clear: () => undefined };
  }

  resolveSessionUrl(info: SandboxInfo, config: TransportConfig, protocol?: ProviderInfra["sandbox_protocol"]): string {
    const resolver = protocol as { resolveSessionUrl?: (info: SandboxInfo, config: TransportConfig) => string } | undefined;
    if (resolver && "resolveSessionUrl" in resolver && typeof resolver.resolveSessionUrl === "function") return resolver.resolveSessionUrl(info, config);
    return info.envd_url ?? "";
  }

  async resolveSessionCapabilities(_template: string, _info: SandboxInfo): Promise<{ capabilities: Set<string> } | null> {
    return null;
  }

  createPortAccess(context: PortContext, protocol?: ProviderInfra["sandbox_protocol"]): PortAccess {
    const factory = protocol as { createPortAccess?: (context: PortContext) => PortAccess } | undefined;
    if (typeof factory?.createPortAccess === "function") return factory.createPortAccess(context);
    const unsupported = (): never => { throw new ProviderFeatureNotSupportedError(this.id, "ports.url", {
      suggestion: "Use await sandbox.network.resolve(port) for providers with asynchronous port discovery.",
    }); };
    return { getHost: unsupported, getUrl: unsupported, getAccessHeaders: unsupported, getServerHeaders: unsupported };
  }

  async openTerminal(context: TerminalContext, opts: { cols: number; rows: number; shell: string }): Promise<TerminalSession> {
    this.require("pty");
    const protocol = context.process as unknown as { openTerminal?: (url: string, opts: { cols: number; rows: number }) => Promise<TerminalSession> };
    if (typeof protocol?.openTerminal !== "function") throw new ProviderFeatureNotSupportedError(this.id, "pty");
    return protocol.openTerminal(context.url, opts);
  }

  /** Templates are optional per provider, independent of sandbox transport. */
  async buildTemplateManager(_config: LayeredConfig, feature = "templates.build"): Promise<ProviderTemplateManager> {
    throw new ProviderFeatureNotSupportedError(this.id, feature);
  }

  /** Management resources are closed independently of sandbox sessions. */
  async buildCommandRunner(config: LayeredConfig): Promise<ProviderCommandRunner> {
    const infra = await this.buildInfra(config);
    try {
      const dispatcher = infra.provider_commands;
      const run = dispatcher?.run;
      if (typeof run !== "function") throw new ProviderFeatureNotSupportedError(this.id, "provider.commands");
      return { run: run.bind(dispatcher), close: infra.close };
    } catch (exc) {
      await infra.close?.();
      throw exc;
    }
  }

  /** Template capability tokens implied by this provider's features. */
  capabilities(): ReadonlySet<string> {
    const discovery = new Set(Object.entries(FEATURE_TO_CAPABILITY).filter(([feature]) => this.features.has(feature)).map(([, token]) => token));
    if (this.operations.cli.some(operation => operation.startsWith("code."))) discovery.add("code");
    return discovery;
  }

  /** JSON-friendly summary (`abx provider info --json`). */
  describe(): ProviderDescription {
    return {
      id: this.id,
      name: this.displayName,
      name_zh: this.displayNameZh,
      version: this.version,
      kind: this.kind,
      features: [...this.features].sort(),
      operation_contract_version: 1, operations: this.operations,
      workflow_inputs: this.workflow_inputs, startup_modes: this.startup_modes,
      config_fields: this.configFields.map((f) => ({
        key: f.key,
        type: f.type ?? "str",
        secret: Boolean(f.secret),
        credential: Boolean(f.credential),
        required: Boolean(f.required),
        default: f.default ?? null,
        env: providerEnvName(this.id, f.key),
        aliases: [...(f.env ?? [])],
        description: f.description ?? "",
        description_zh: f.description_zh ?? "",
      })),
      inherit: [...this.inherit].sort(),
    };
  }
}

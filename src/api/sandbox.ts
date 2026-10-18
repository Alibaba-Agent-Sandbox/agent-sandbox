/**
 * Sandbox — the primary user-facing class (port of `api/sandbox.py`).
 *
 * Usage:
 *
 *     const sb = await Sandbox.create("python-base");   // or Sandbox.create({ template: "python-base" })
 *     const result = await sb.runCode("print('hello')");
 *     console.log(result.text);
 *     await sb.kill();
 *
 * The Python `*_sync` variants (`make_sync`) do not exist in Node: every call is a Promise.
 */

import { ResolvedCapabilities, resolveCapabilities } from "./capability.js";
import { CommandNotFoundError, ConnectionError_ } from "../models/errors.js";
import { setActiveProvider, trackOpenInfra } from "../providers/active.js";
import { DEFAULT_CAPABILITIES } from "../models/template.js";
import type { Provider, ProviderInfra } from "../providers/base.js";
import { ProviderConfigError, ProviderFeatureNotSupportedError, ProviderMismatchError } from "../providers/errors.js";
import { cliOptions, cliProvider } from "../providers/selection.js";
import { getProvider, parseSandboxRef, registerProvider, resolveProviderId } from "../providers/registry.js";
import { BUILTIN_PROVIDER_ID, providerEnvName } from "../utils/config_keys.js";
import { loadLayeredConfig } from "../transport/config_layers.js";
import { CodeResult, CommandResult, ProcessResult, type ProcessChunk } from "../models/process.js";
import { SandboxConfig, SandboxInfo, type SandboxStatus } from "../models/sandbox.js";
import { CodeInterpreterProtocol } from "../protocol/code_interpreter.js";
import { FilesystemProtocol } from "../protocol/filesystem.js";
import { ProcessProtocol } from "../protocol/process.js";
import { SandboxProtocol } from "../protocol/sandbox.js";
import { TerminalSession } from "../protocol/terminal.js";
import { createAuthProvider, EnvdTokenManager, type AuthProvider } from "../transport/auth.js";
import { loadConfig, type TransportConfig } from "../transport/config.js";
import { HttpClient, RequestError } from "../transport/http.js";
import type { StreamReader } from "../transport/streaming.js";
import { ExcInfo, getLogger } from "../utils/logging.js";
import { PyFloat, pyRepr, pySorted, pyStr, pyStrip, pyTruthy } from "../utils/_pyformat.js";
import { AttributeError } from "../utils/_pyos.js";
import { NotImplementedError, RuntimeError, ValueError, dictGet, pyExcStr, pyTypeName } from "./_pyerrors.js";
import { CodeContextModule } from "./code.js";
import { CommandsModule } from "./commands.js";
import { FilesModule } from "./files.js";
import { NetworkModule } from "./network.js";

const logger = getLogger("api.sandbox");

export const _seams = {
  warn: (message: string, category: string): void => {
    process.emitWarning(message, category);
  },
};

/** Python `frozenset`: a `Set` whose mutators are disabled. */
export class FrozenSet<T> extends Set<T> {
  constructor(values?: Iterable<T> | null) {
    super();
    if (values) for (const v of values) Set.prototype.add.call(this, v);
  }

  override add(_value: T): this {
    void _value;
    throw new TypeError("'frozenset' object has no attribute 'add'");
  }

  override delete(_value: T): boolean {
    void _value;
    throw new TypeError("'frozenset' object has no attribute 'discard'");
  }

  override clear(): void {
    throw new TypeError("'frozenset' object has no attribute 'clear'");
  }
}

export interface BuildInfraOptions {
  api_key?: string | null;
  api_url?: string | null;
  access_key_id?: string | null;
  access_key_secret?: string | null;
  /** Provider id (or a `Provider` object). Default: `ABX_PROVIDER` / `[core] provider` / `alicloud-express`. */
  provider?: string | Provider | null;
  /** Provider-scoped option values (see `abx provider info`); exec providers receive them minus secret fields. */
  provider_options?: Record<string, unknown> | null;
}

/**
 * Python `":" in sandbox_id`. Strings use substring search; lists and dicts use membership. An int (and anything else
 * that is not a container) raises `TypeError: argument of type 'int' is not iterable`, which the CLI reports as an
 * unexpected error with exit code 1.
 */
function _refContainsColon(sandbox_id: unknown): boolean {
  if (typeof sandbox_id === "string" || Array.isArray(sandbox_id)) return sandbox_id.includes(":");
  if (sandbox_id instanceof Set) {
    for (const item of sandbox_id) if (item === ":") return true;
    return false;
  }
  if (sandbox_id instanceof Map) return sandbox_id.has(":");
  if (sandbox_id !== null && typeof sandbox_id === "object" && !(sandbox_id instanceof PyFloat)) {
    return Object.prototype.hasOwnProperty.call(sandbox_id, ":");
  }
  throw new TypeError(`argument of type '${pyTypeName(sandbox_id)}' is not iterable`);
}

/**
 * Resolve the effective provider; `[null, id]` is the built-in default path. Also splits a qualified `provider:sandbox_id`
 * reference. A qualified prefix that contradicts an explicit provider raises `ProviderMismatchError` (E8030).
 */
export function _selectProvider(provider: string | Provider | null | undefined, sandbox_id?: unknown): [Provider | null, string | null] {
  let bare: unknown = sandbox_id ?? null;
  let refProvider: string | null = null;
  if (pyTruthy(sandbox_id) && _refContainsColon(sandbox_id)) {
    if (typeof sandbox_id !== "string") {
      throw new AttributeError(`'${pyTypeName(sandbox_id)}' object has no attribute 'partition'`);
    }
    [refProvider, bare] = parseSandboxRef(sandbox_id);
  }
  const cli = cliProvider();
  let explicit: string | null = null;
  if (provider && typeof provider === "object") {
    registerProvider(provider, { replace: true });
    explicit = provider.id;
  } else if (provider) {
    explicit = provider;
  }
  if (!explicit && cli && refProvider && cli !== refProvider) explicit = cli;
  if (explicit && refProvider && explicit !== refProvider) {
    throw new ProviderMismatchError(`Sandbox reference '${sandbox_id}' conflicts with provider '${explicit}'.`, {
      suggestion: "Drop the 'provider:' prefix or the provider argument.",
    });
  }
  const pid = resolveProviderId(explicit ?? refProvider ?? cliProvider());
  setActiveProvider(pid);
  if (pid === BUILTIN_PROVIDER_ID) return [null, bare as string | null];
  return [getProvider(pid), bare as string | null];
}

/** Stands in for `HttpClient.close()` so a `Sandbox` can release provider resources (plugin process, HTTP client). */
/**
 * Capability set the module gates use for a provider sandbox: the defaults plus whatever the provider declares. A feature
 * the provider lacks is refused by its protocol gate with E8004 naming the feature, not by a template-flavoured E3004.
 */
function providerCapabilities(prov: Provider): ResolvedCapabilities {
  return new ResolvedCapabilities({ capabilities: [...DEFAULT_CAPABILITIES, ...prov.capabilities()] });
}

class InfraCloser {
  private readonly untrack: () => void;

  constructor(private readonly infra: ProviderInfra) {
    this.untrack = trackOpenInfra(() => this.close());
  }

  /** The provider's own HTTP client when it has one (REST providers); `null` for plugins that route over EPP. */
  get httpClient(): HttpClient | null {
    return this.infra.http_client;
  }

  async close(): Promise<void> {
    this.untrack();
    if (this.infra.close) await this.infra.close();
    else if (this.infra.http_client) await this.infra.http_client.close();
  }
}

/** `--opt` values given on the command line (validated against the provider's schema) merged under explicit options. */
export function _effectiveOptions(prov: Provider | null, options: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const cli = cliOptions();
  if (Object.keys(cli).length === 0) return options ?? null;
  const schema = prov ?? getProvider(resolveProviderId(cliProvider()));
  const known = new Map(schema.configFields.map((f) => [f.key, f]));
  for (const key of Object.keys(cli)) {
    const f = known.get(key);
    if (f === undefined && !schema.inherit.has(key)) {
      throw new ProviderConfigError(`Unknown option '${key}' for provider '${schema.id}'.`, {
        suggestion: `Run 'abx provider info ${schema.id}' to see its options.`,
      });
    }
    if (f?.secret) {
      throw new ProviderConfigError(`Field '${key}' is secret; set it with 'abx provider config ${schema.id} set ${key}' or the ${providerEnvName(schema.id, key)} environment variable.`);
    }
  }
  return { ...cli, ...(options ?? {}) };
}

async function _providerInfra(prov: Provider, opts: BuildInfraOptions): Promise<ProviderInfra> {
  const overrides: Record<string, unknown> = { provider: prov.id, provider_options: opts.provider_options ?? {} };
  if (opts.api_key) overrides["sandbox_api_key"] = opts.api_key;
  if (opts.api_url) overrides["sandbox_base_url"] = opts.api_url;
  if (opts.access_key_id) overrides["access_key_id"] = opts.access_key_id;
  if (opts.access_key_secret) overrides["access_key_secret"] = opts.access_key_secret;
  return prov.buildInfra(loadLayeredConfig(overrides));
}

/**
 * Build config, auth, http client, and sandbox protocol from credentials. Shared helper for class methods that need
 * standalone infra.
 */
export function _buildInfra(opts: BuildInfraOptions = {}): [TransportConfig, AuthProvider, HttpClient, SandboxProtocol] {
  const { api_key = null, api_url = null, access_key_id = null, access_key_secret = null } = opts;
  const config_overrides: Record<string, unknown> = {};
  if (api_key !== null) config_overrides["api_key"] = api_key;
  if (api_url !== null) config_overrides["api_url"] = api_url;
  if (access_key_id !== null) config_overrides["access_key_id"] = access_key_id;
  if (access_key_secret !== null) config_overrides["access_key_secret"] = access_key_secret;
  const region = opts.provider_options?.["region"];
  if (typeof region === "string" && region) config_overrides["region"] = region;

  const config = loadConfig(config_overrides);
  const auth = createAuthProvider({
    api_key: config.api_key,
    access_key_id: config.access_key_id,
    access_key_secret: config.access_key_secret,
  });
  // The built-in Express envd reads streaming RPCs as Connect envelopes. Plain JSON is parsed as a
  // length prefix and the command output is lost.
  const http_client = new HttpClient(config, auth, { envelope_connect: true });
  const sandbox_protocol = new SandboxProtocol(http_client);
  return [config, auth, http_client, sandbox_protocol];
}

export interface SandboxInit {
  info: SandboxInfo;
  config: TransportConfig;
  http_client: HttpClient;
  auth: AuthProvider;
  envd_token: EnvdTokenManager;
  sandbox_protocol?: SandboxProtocol | null;
  process_protocol?: ProcessProtocol | null;
  filesystem_protocol?: FilesystemProtocol | null;
  code_interpreter_protocol?: CodeInterpreterProtocol | null;
  domain?: string;
  secure?: boolean;
  resolved_capabilities?: ResolvedCapabilities | null;
  /** The capability set a provider declares (reported by `capabilities`; the module gates stay permissive so the provider answers E8004). */
  declared_capabilities?: ReadonlySet<string> | null;
  provider_id?: string;
}

export interface CreateOptions extends BuildInfraOptions {
  template?: string;
  timeout?: number;
  request_timeout?: number | null;
  metadata?: Record<string, string> | null;
  envs?: Record<string, string> | null;
  cpu?: number | null;
  memory?: number | null;
  disk?: number | null;
  gpu?: string | null;
  description?: string | null;
  secure?: boolean;
  domain?: string | null;
}

export interface ConnectOptions extends BuildInfraOptions {
  sandbox_id?: string;
  domain?: string | null;
}

export interface ListOptions extends BuildInfraOptions {
  status?: SandboxStatus | null;
  limit?: number;
  offset?: number;
}

export interface RunCodeOptions {
  language?: string;
  timeout?: number;
  envs?: Record<string, string> | null;
  on_stdout?: ((s: string) => void) | null;
  on_stderr?: ((s: string) => void) | null;
  on_result?: ((r: any) => void) | null;
}

interface EnvdClientLike {
  post(url: string, opts: { json?: unknown; headers?: Record<string, string> }): Promise<HttpResponseLike>;
  get(url: string, opts: { headers?: Record<string, string> }): Promise<HttpResponseLike>;
}

interface HttpResponseLike {
  is_success: boolean;
  status_code: number;
  text: string;
  json(): any;
}

function isJsonDecodeError(e: unknown): boolean {
  return e instanceof SyntaxError || e instanceof ValueError;
}

function withCause<T extends Error>(err: T, cause: unknown): T {
  (err as { cause?: unknown }).cause = cause;
  return err;
}

function isPlainOptions(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Primary user-facing class for sandbox lifecycle management.
 *
 * Provides convenient access to commands, files, network, and code sub-modules.
 */
export class Sandbox {
  _info: SandboxInfo;
  _config: TransportConfig;
  _http_client: HttpClient;
  _auth: AuthProvider;
  _envd_token: EnvdTokenManager;
  _domain: string;
  _secure: boolean;
  _sandbox_protocol: SandboxProtocol;
  _process_protocol: ProcessProtocol;
  _filesystem_protocol: FilesystemProtocol;
  _code_interpreter_protocol: CodeInterpreterProtocol;
  _resolved: ResolvedCapabilities;
  _capabilities: Set<string>;
  _declared_capabilities: ReadonlySet<string> | null;
  _provider_id: string;
  _killed: boolean;

  private _commands?: CommandsModule;
  private _files?: FilesModule;
  private _network?: NetworkModule;
  private _code?: CodeContextModule;

  constructor(init: SandboxInit) {
    this._info = init.info;
    this._config = init.config;
    this._provider_id = init.provider_id ?? BUILTIN_PROVIDER_ID;

    // Derive envd URL when the platform response omits it (Bug 1 fix)
    if (!this._info.envd_url && this._info.sandbox_id) {
      this._info.envd_url = this._config.buildEnvdUrl(this._info.sandbox_id);
    }
    this._http_client = init.http_client;
    this._killed = false;
    this._auth = init.auth;
    this._envd_token = init.envd_token;
    this._domain = init.domain ?? "e2b.dev";
    this._secure = init.secure ?? true;
    this._sandbox_protocol = init.sandbox_protocol || new SandboxProtocol(init.http_client);
    this._process_protocol = init.process_protocol || new ProcessProtocol(init.http_client);
    this._filesystem_protocol = init.filesystem_protocol || new FilesystemProtocol(init.http_client);
    this._code_interpreter_protocol = init.code_interpreter_protocol || new CodeInterpreterProtocol(init.http_client);

    // Capability model
    if (init.resolved_capabilities !== undefined && init.resolved_capabilities !== null) {
      this._resolved = init.resolved_capabilities;
    } else {
      this._resolved = new ResolvedCapabilities();
    }
    this._capabilities = new Set(this._resolved.capabilities);
    this._declared_capabilities = init.declared_capabilities ?? null;
  }

  // ---- Properties ----

  /** Sandbox ID. */
  get id(): string {
    return this._info.sandbox_id;
  }

  /** Id of the provider that owns this sandbox (`alicloud-express` by default). */
  get provider(): string {
    return this._provider_id;
  }

  /** Current sandbox status (cached, call refreshInfo() to update). */
  get status(): SandboxStatus {
    return this._info.status;
  }

  /** The envd URL for this sandbox. */
  get url(): string {
    return this._info.envd_url || "";
  }

  /** Full sandbox info. */
  get info(): SandboxInfo {
    return this._info;
  }

  /** Effective capability set for this sandbox. */
  get capabilities(): ReadonlySet<string> {
    return new FrozenSet(this._declared_capabilities ?? this._capabilities);
  }

  // ---- Sub-modules (lazy cached properties) ----

  /** Commands sub-module for running shell commands. */
  get commands(): CommandsModule {
    if (this._commands === undefined) {
      this._commands = new CommandsModule(this.url, this._envd_token, this._process_protocol, this._capabilities);
    }
    return this._commands;
  }

  /** Files sub-module for filesystem operations. */
  get files(): FilesModule {
    if (this._files === undefined) {
      this._files = new FilesModule(
        this.url,
        this._envd_token,
        this._filesystem_protocol,
        this._sandbox_protocol,
        this.id,
        this._capabilities,
      );
    }
    return this._files;
  }

  /** Bind the provider's `ports.url` (if it declares one) to this sandbox's id. */
  private _portResolver(): ((port: number) => Promise<[string, Record<string, string>]>) | null {
    const proto = this._sandbox_protocol as unknown as {
      portUrl?: (id: string, port: number) => Promise<[string, Record<string, string>]>;
      hasPortUrl?: boolean;
    };
    if (typeof proto.portUrl !== "function" || !proto.hasPortUrl) return null;
    const sandbox_id = this.id;
    return (port) => (proto.portUrl as NonNullable<typeof proto.portUrl>).call(proto, sandbox_id, port);
  }

  /** Network sub-module for port URL calculation. */
  get network(): NetworkModule {
    if (this._network === undefined) {
      this._network = new NetworkModule({
        sandbox_id: this.id,
        domain: this._domain,
        secure: this._secure,
        access_token: this._envd_token ? this._envd_token.token : null,
        capabilities: this._capabilities,
        port_resolver: this._portResolver(),
      });
    }
    return this._network;
  }

  /** Code sub-module for code interpretation. */
  get code(): CodeContextModule {
    if (this._code === undefined) {
      this._code = new CodeContextModule(
        this.id,
        this.url,
        this._envd_token,
        this._code_interpreter_protocol,
        this._capabilities,
        this._process_protocol,
      );
    }
    return this._code;
  }

  // ---- Factory classmethods ----

  /**
   * Create a new sandbox. Accepts `create("tpl", {...})` (Python `Sandbox.create("tpl", timeout=...)`) or
   * `create({ template: "tpl", ... })`.
   *
   * `timeout`: sandbox lifetime (TTL) in seconds (not an HTTP timeout); `request_timeout`: per-request HTTP timeout
   * override (seconds) applied only to the `POST /sandboxes` create call. `envs`: environment variables injected into
   * the envd root process. `secure`: whether to enable secure mode (default true).
   *
   * Throws `ValueError` if `request_timeout` is not null and not a positive number.
   */
  static async create(template?: string | CreateOptions, options: CreateOptions = {}): Promise<Sandbox> {
    let opts: CreateOptions;
    if (isPlainOptions(template)) {
      opts = { ...template, ...options };
    } else {
      opts = { ...options };
      if (typeof template === "string") opts.template = template;
    }
    const {
      template: tpl = "base",
      timeout = 300,
      request_timeout = null,
      metadata = null,
      envs = null,
      cpu = null,
      memory = null,
      disk = null,
      gpu = null,
      description = null,
      secure = true,
      api_key = null,
      api_url = null,
      domain = null,
      access_key_id = null,
      access_key_secret = null,
      provider = null,
      provider_options = null,
    } = opts;
    const secure_hint: boolean | null = opts.secure === undefined ? null : opts.secure;

    if (request_timeout !== null && request_timeout <= 0) {
      throw new ValueError(`request_timeout must be a positive number of seconds, got ${pyRepr(request_timeout)}`);
    }

    // NL-first hint: when description is given but template is still the default, log a hint so the user knows they
    // can pick a more specific template.
    const effective_template = tpl;
    const effective_cpu = cpu;
    const effective_memory = memory;
    if (description && tpl === "base") {
      logger.info(
        "description provided with default template 'base'; " +
          "consider using --template to select a more specific " +
          "template for better resource defaults.",
      );
    }

    const [prov] = _selectProvider(provider);
    const popts = _effectiveOptions(prov, provider_options);
    if (prov !== null) {
      return this._createViaProvider(prov, {
        template: effective_template,
        timeout,
        request_timeout,
        metadata,
        envs,
        cpu: effective_cpu,
        memory: effective_memory,
        disk,
        gpu,
        secure: secure_hint,
        domain,
        build: { api_key, api_url, access_key_id, access_key_secret, provider_options: popts },
      });
    }

    const [config, auth, http_client, sandbox_protocol] = _buildInfra({ api_key, api_url, access_key_id, access_key_secret, provider_options: popts });

    try {
      const sandbox_config = new SandboxConfig({
        template: effective_template,
        timeout,
        metadata: metadata && Object.keys(metadata).length ? metadata : {},
        env_vars: pyTruthy(envs) ? envs : {},
        cpu: effective_cpu,
        memory: effective_memory,
        disk,
        gpu,
      });
      const info = await sandbox_protocol.create(sandbox_config, { request_timeout });

      const envd_token = new EnvdTokenManager(info.envd_access_token, info.sandbox_id);

      logger.info("Sandbox created: %s", info.sandbox_id);

      // Resolve capabilities for the template
      const resolved = await resolveCapabilities(effective_template);

      return new this({
        info,
        config,
        http_client,
        auth,
        envd_token,
        sandbox_protocol,
        domain: domain || config.domain,
        secure,
        resolved_capabilities: resolved,
      });
    } catch (e) {
      await http_client.close();
      throw e;
    }
  }

  /** Connect to an existing sandbox by ID. Accepts `connect("sbx-1", {...})` or `connect({ sandbox_id, ... })`. */
  static async connect(sandbox_id: string | ConnectOptions, options: ConnectOptions = {}): Promise<Sandbox> {
    let sid: string;
    let opts: ConnectOptions;
    if (isPlainOptions(sandbox_id)) {
      opts = { ...sandbox_id, ...options };
      sid = opts.sandbox_id as string;
    } else {
      opts = { ...options };
      sid = sandbox_id;
    }
    const { api_key = null, api_url = null, domain = null, access_key_id = null, access_key_secret = null, provider = null, provider_options = null } = opts;
    const [prov, bare_id] = _selectProvider(provider, sid);
    const popts = _effectiveOptions(prov, provider_options);
    if (prov !== null) {
      return this._connectViaProvider(prov, bare_id as string, {
        domain,
        build: { api_key, api_url, access_key_id, access_key_secret, provider_options: popts },
      });
    }
    sid = bare_id as string;
    const [config, auth, http_client, sandbox_protocol] = _buildInfra({ api_key, api_url, access_key_id, access_key_secret, provider_options: popts });

    try {
      const info = await sandbox_protocol.connect(sid);
      const envd_token = new EnvdTokenManager(info.envd_access_token, info.sandbox_id);

      logger.info("Connected to sandbox: %s", sid);

      // Resolve capabilities for the template
      const resolved = await resolveCapabilities(info.template);

      return new this({
        info,
        config,
        http_client,
        auth,
        envd_token,
        sandbox_protocol,
        domain: domain || config.domain,
        resolved_capabilities: resolved,
      });
    } catch (e) {
      await http_client.close();
      throw e;
    }
  }

  /** Query a resource without connecting its data plane, resolving a template or changing lifetime. */
  static async getInfoById(sandbox_id: string, options: BuildInfraOptions = {}): Promise<SandboxInfo> {
    const { api_key = null, api_url = null, access_key_id = null, access_key_secret = null, provider = null, provider_options = null } = options;
    const [prov, bare_id] = _selectProvider(provider, sandbox_id);
    const popts = _effectiveOptions(prov, provider_options);
    if (prov !== null) {
      const infra = await _providerInfra(prov, { api_key, api_url, access_key_id, access_key_secret, provider_options: popts });
      try { return await infra.sandbox_protocol.getInfo(bare_id as string); }
      finally { await new InfraCloser(infra).close(); }
    }
    const [, , http_client, sandbox_protocol] = _buildInfra({ api_key, api_url, access_key_id, access_key_secret, provider_options: popts });
    try { return await sandbox_protocol.getInfo(bare_id as string); }
    finally { await http_client.close(); }
  }

  /** List sandboxes (class method, no instance required). */
  static async list(options: ListOptions = {}): Promise<SandboxInfo[]> {
    const { status = null, limit = 100, offset = 0, api_key = null, api_url = null, access_key_id = null, access_key_secret = null, provider = null, provider_options = null } = options;
    const [prov] = _selectProvider(provider);
    const popts = _effectiveOptions(prov, provider_options);
    if (prov !== null) {
      const infra = await _providerInfra(prov, { api_key, api_url, access_key_id, access_key_secret, provider_options: popts });
      try {
        return await infra.sandbox_protocol.list({ status, limit, offset });
      } finally {
        await new InfraCloser(infra).close();
      }
    }
    const [, , http_client, sandbox_protocol] = _buildInfra({ api_key, api_url, access_key_id, access_key_secret, provider_options: popts });
    try {
      return await sandbox_protocol.list({ status, limit, offset });
    } finally {
      await http_client.close();
    }
  }

  /** Kill a sandbox by ID (class method, no instance required). */
  static async killById(sandbox_id: string, options: BuildInfraOptions = {}): Promise<void> {
    const { api_key = null, api_url = null, access_key_id = null, access_key_secret = null, provider = null, provider_options = null } = options;
    const [prov, bare_id] = _selectProvider(provider, sandbox_id);
    sandbox_id = bare_id as string;
    const popts = _effectiveOptions(prov, provider_options);
    if (prov !== null) {
      const infra = await _providerInfra(prov, { api_key, api_url, access_key_id, access_key_secret, provider_options: popts });
      try {
        await infra.sandbox_protocol.kill(sandbox_id);
        logger.info("Sandbox killed (by ID): %s", sandbox_id);
      } finally {
        await new InfraCloser(infra).close();
      }
      return;
    }
    const [, , http_client, sandbox_protocol] = _buildInfra({ api_key, api_url, access_key_id, access_key_secret, provider_options: popts });
    try {
      await sandbox_protocol.kill(sandbox_id);
      logger.info("Sandbox killed (by ID): %s", sandbox_id);
    } finally {
      await http_client.close();
    }
  }

  private static async _createViaProvider(
    prov: Provider,
    p: {
      template: string;
      timeout: number;
      request_timeout: number | null;
      metadata: Record<string, string> | null;
      envs: Record<string, string> | null;
      cpu: number | null;
      memory: number | null;
      disk: number | null;
      gpu: string | null;
      secure: boolean | null;
      domain: string | null;
      build: BuildInfraOptions;
    },
  ): Promise<Sandbox> {
    const infra = await _providerInfra(prov, p.build);
    const closer = new InfraCloser(infra);
    try {
      const sandbox_config = new SandboxConfig({
        template: p.template,
        timeout: p.timeout,
        metadata: p.metadata && Object.keys(p.metadata).length ? p.metadata : {},
        env_vars: pyTruthy(p.envs) ? p.envs : {},
        cpu: p.cpu,
        memory: p.memory,
        disk: p.disk,
        gpu: p.gpu,
        secure: p.secure,
        provider_options: { ...(p.build.provider_options ?? {}) },
      });
      const info = await infra.sandbox_protocol.create(sandbox_config, { request_timeout: p.request_timeout });
      const envd_token = new EnvdTokenManager(info.envd_access_token, info.sandbox_id, infra.envd_auth);
      logger.info("Sandbox created: %s (provider %s)", info.sandbox_id, prov.id);
      const resolved = providerCapabilities(prov);
      return new Sandbox({
        info,
        config: infra.config.toTransportConfig(),
        http_client: closer as unknown as HttpClient,
        auth: infra.auth as AuthProvider,
        envd_token,
        sandbox_protocol: infra.sandbox_protocol as unknown as SandboxProtocol,
        process_protocol: infra.process_protocol as unknown as ProcessProtocol | null,
        filesystem_protocol: infra.filesystem_protocol as unknown as FilesystemProtocol | null,
        code_interpreter_protocol: infra.code_interpreter_protocol as unknown as CodeInterpreterProtocol | null,
        domain: p.domain || infra.config.sandbox_domain,
        secure: p.secure === null ? true : p.secure,
        resolved_capabilities: resolved,
        declared_capabilities: prov.capabilities(),
        provider_id: prov.id,
      });
    } catch (e) {
      await closer.close();
      throw e;
    }
  }

  private static async _connectViaProvider(prov: Provider, sandbox_id: string, p: { domain: string | null; build: BuildInfraOptions }): Promise<Sandbox> {
    const infra = await _providerInfra(prov, p.build);
    const closer = new InfraCloser(infra);
    try {
      const info = await infra.sandbox_protocol.connect(sandbox_id);
      const envd_token = new EnvdTokenManager(info.envd_access_token, info.sandbox_id, infra.envd_auth);
      logger.info("Connected to sandbox: %s (provider %s)", sandbox_id, prov.id);
      const resolved = providerCapabilities(prov);
      return new Sandbox({
        info,
        config: infra.config.toTransportConfig(),
        http_client: closer as unknown as HttpClient,
        auth: infra.auth as AuthProvider,
        envd_token,
        sandbox_protocol: infra.sandbox_protocol as unknown as SandboxProtocol,
        process_protocol: infra.process_protocol as unknown as ProcessProtocol | null,
        filesystem_protocol: infra.filesystem_protocol as unknown as FilesystemProtocol | null,
        code_interpreter_protocol: infra.code_interpreter_protocol as unknown as CodeInterpreterProtocol | null,
        domain: p.domain || infra.config.sandbox_domain,
        resolved_capabilities: resolved,
        declared_capabilities: prov.capabilities(),
        provider_id: prov.id,
      });
    } catch (e) {
      await closer.close();
      throw e;
    }
  }

  // ---- Lifecycle ----

  /** Release client-side resources (connections, plugin process); the sandbox stays up. */
  async close(): Promise<void> {
    await this._http_client.close();
  }

  /** Kill the sandbox and release resources. A second call is a no-op: the first call closes the client. */
  async kill(): Promise<void> {
    if (this._killed) return;
    try {
      await this._sandbox_protocol.kill(this.id);
      this._killed = true;
      logger.info("Sandbox killed: %s", this.id);
    } finally {
      await this._http_client.close();
    }
  }

  /** Update sandbox timeout. */
  async setTimeout(timeout: number): Promise<void> {
    await this._sandbox_protocol.setTimeout(this.id, timeout);
  }

  /** Check if the sandbox is currently running (makes API call). */
  async isRunning(): Promise<boolean> {
    return this._sandbox_protocol.isRunning(this.id);
  }

  /** Pause the sandbox. */
  async pause(): Promise<void> {
    await this._sandbox_protocol.pause(this.id);
    logger.info("Sandbox paused: %s", this.id);
  }

  /** Resume a paused sandbox. */
  async resume(): Promise<void> {
    await this._sandbox_protocol.resume(this.id);
    logger.info("Sandbox resumed: %s", this.id);
  }

  /** Refresh sandbox info from the platform. */
  async refreshInfo(): Promise<SandboxInfo> {
    this._info = await this._sandbox_protocol.getInfo(this.id);
    // Re-derive envd URL if the platform still omits it
    if (!this._info.envd_url && this._info.sandbox_id) {
      this._info.envd_url = this._config.buildEnvdUrl(this._info.sandbox_id);
    }
    return this._info;
  }

  // ---- Convenience methods ----

  /** Run code in the sandbox using the code interpreter. */
  async runCode(code: string, opts: RunCodeOptions = {}): Promise<CodeResult> {
    const { language = "python", timeout = 30, envs = null, on_stdout = null, on_stderr = null, on_result = null } = opts;
    return this.code.run(code, { language, timeout, envs, on_stdout, on_stderr, on_result });
  }

  /** Open an interactive PTY terminal session (WebSocket). */
  async getTerminal(opts: { cols?: number; rows?: number; shell?: string } = {}): Promise<TerminalSession> {
    const { cols = 80, rows = 24, shell = "/bin/bash" } = opts;
    const hosted = (this._process_protocol as { openTerminal?: (url: string, o: { cols: number; rows: number }) => Promise<unknown> }).openTerminal;
    if (typeof hosted === "function" && this.url.startsWith("epp://")) {
      return (await hosted.call(this._process_protocol, this.url, { cols, rows })) as TerminalSession;
    }
    const hc = this._http_client instanceof InfraCloser ? this._http_client.httpClient : this._http_client;
    return TerminalSession.create(this.url, this._envd_token, this._config, { cols, rows, shell, dial: hc?._dial ?? null });
  }

  // ---- Named commands (registered on the in-sandbox SandboxServer) ----

  /**
   * List the named commands registered on the sandbox's SandboxServer (`GET /commands` on `server_port`).
   *
   * Each entry is `{name, description, args: [{name, type, required, default, description}]}`.
   *
   * Throws `ConnectionError_` when no SandboxServer is reachable, and `TokenExpiredError` if the sandbox is not
   * authenticated.
   */
  async listCommands(opts: { server_port?: number } = {}): Promise<Record<string, any>[]> {
    const { server_port = 9000 } = opts;
    Sandbox._requireHttpDataPlane(this, "named commands");
    this._envd_token.getHeaders();
    try {
      return await this._fetchServerCommands(server_port);
    } catch (exc) {
      if (exc instanceof RequestError) throw this._serverUnreachable(server_port, exc);
      throw exc;
    }
  }

  /**
   * Call a named command registered on the sandbox's SandboxServer: `POST /commands/{name}` on `server_port` with
   * `kwargs` as the JSON body. This is the only way to run a named command; for a raw shell command use
   * `commands.run()`.
   *
   * Throws `CommandNotFoundError` when the server has no command `name`, and `ConnectionError_` when no SandboxServer is
   * reachable. A command that exists but fails validation/execution resolves to a `CommandResult` with `exit_code` 1.
   */
  async runCommand(name: string, kwargs: Record<string, any> = {}, opts: { server_port?: number } = {}): Promise<CommandResult> {
    const { server_port = 9000 } = opts;
    Sandbox._requireHttpDataPlane(this, "named commands");
    let response: HttpResponseLike;
    let body: Record<string, any>;
    try {
      [response, body] = await this._callServerCommand(name, server_port, kwargs);
    } catch (exc) {
      if (exc instanceof RequestError) throw this._serverUnreachable(server_port, exc);
      if (exc instanceof RuntimeError) {
        // Non-JSON response (e.g. 502 Bad Gateway when no server is listening on the port).
        throw this._serverUnreachable(server_port, exc);
      }
      throw exc;
    }

    if (response.is_success) {
      return new CommandResult({ value: dictGet(body, "result"), exit_code: 0 });
    }

    if (response.status_code === 404) {
      throw new CommandNotFoundError(name, {
        server_status: "HTTP 404",
        suggestion: "List the registered commands with 'abx sandbox command list SANDBOX_ID'.",
      });
    }

    const error_msg = pyStr(dictGet(body, "error", "Unknown error"));
    const error_type = pyStr(dictGet(body, "type", "UnknownError"));
    return new CommandResult({
      value: dictGet(body, "result"),
      stderr: `${error_type}: ${error_msg}`,
      exit_code: 1,
    });
  }

  // ---- Named command internals ----

  /**
   * Fails with E8004 naming `feature` when the sandbox has no HTTP data plane: a provider that routes over EPP (envd URL
   * `epp://...`) or has no HTTP client of its own cannot reach an in-sandbox server.
   */
  static _requireHttpDataPlane(sb: { _info: SandboxInfo; _provider_id: string; _http_client: unknown }, feature: string): void {
    if (String(sb._info?.envd_url ?? "").startsWith("epp://")) throw new ProviderFeatureNotSupportedError(sb._provider_id, feature);
    if (sb._http_client instanceof InfraCloser && typeof (sb._http_client.httpClient as { _createEnvdClient?: unknown } | null)?._createEnvdClient !== "function") {
      throw new ProviderFeatureNotSupportedError(sb._provider_id, feature);
    }
  }

  private _envdClientFactory(feature: string): (url: string) => EnvdClientLike {
    Sandbox._requireHttpDataPlane(this, feature);
    const hc = this._http_client instanceof InfraCloser ? this._http_client.httpClient : this._http_client;
    const factory = (hc as unknown as { _createEnvdClient: (u: string) => EnvdClientLike })._createEnvdClient;
    return (url) => factory.call(hc, url);
  }

  private _serverUnreachable(server_port: number, cause: unknown): ConnectionError_ {
    return withCause(
      new ConnectionError_(`No SandboxServer reachable in sandbox ${this.id} on port ${server_port} (${pyExcStr(cause)}).`, {
        suggestion:
          "Named commands are registered on the SandboxServer inside the sandbox; use a template that starts it, " +
          "or pass --server-port if it listens elsewhere.",
      }),
      cause,
    );
  }

  /**
   * POST `/commands/{name}` to the in-sandbox SandboxServer.
   *
   * Returns the raw `[response, parsed_body]` pair so the caller can map status codes to `CommandResult` semantics.
   *
   * Throws `RequestError` if the request cannot be delivered, and `RuntimeError` if the server returns a non-JSON body.
   */
  async _callServerCommand(
    name: string,
    server_port: number,
    kwargs: Record<string, any>,
  ): Promise<[HttpResponseLike, Record<string, any>]> {
    const url = this.network.getUrl(server_port);
    const access_headers = this.network.getAccessHeaders();
    const client = this._envdClientFactory("named commands")(url);
    const first = await this._postServerCommand(client, name, kwargs, access_headers);
    // Express does not set ABX_SERVER_TOKEN. A presented credential that matches nothing is HTTP 401,
    // while the same request with no credential is the anonymous identity. Retry once without it.
    if (first[0].status_code === 401 && Object.keys(access_headers).length > 0) {
      return this._postServerCommand(client, name, kwargs, {});
    }
    return first;
  }

  private async _postServerCommand(
    client: EnvdClientLike,
    name: string,
    kwargs: Record<string, any>,
    access_headers: Record<string, string>,
  ): Promise<[HttpResponseLike, Record<string, any>]> {
    const headers = { "Content-Type": "application/json", ...access_headers };
    const response = await client.post(`/commands/${encodeURIComponent(name)}`, { json: kwargs, headers });

    let body: Record<string, any>;
    try {
      body = response.json();
    } catch (exc) {
      if (isJsonDecodeError(exc)) {
        throw withCause(
          new RuntimeError(
            `Sandbox server returned non-JSON response (status ${response.status_code}): ${response.text.slice(0, 200)}`,
          ),
          exc,
        );
      }
      throw exc;
    }

    return [response, body];
  }

  /**
   * GET `/commands` from the in-sandbox SandboxServer.
   *
   * Returns the `commands` list from the JSON body, or an empty list when the response is malformed. Connection errors
   * propagate as `RequestError`.
   */
  async _fetchServerCommands(server_port: number): Promise<Record<string, any>[]> {
    const url = this.network.getUrl(server_port);
    const access_headers = this.network.getAccessHeaders();

    const client = this._envdClientFactory("named commands")(url);
    let response = await client.get("/commands", { headers: access_headers });
    if (response.status_code === 401 && Object.keys(access_headers).length > 0) {
      response = await client.get("/commands", { headers: {} });
    }

    if (!response.is_success) {
      throw new RuntimeError(`Sandbox server answered GET /commands with HTTP ${response.status_code}`);
    }
    let body: Record<string, any>;
    try {
      body = response.json();
    } catch (exc) {
      if (isJsonDecodeError(exc)) return [];
      throw exc;
    }
    const commands = dictGet(body, "commands", []);
    return Array.isArray(commands) ? commands : [];
  }

  // ---- E2B-compatible URL stubs ----

  /** Return a pre-signed upload URL. E2B-compatible. */
  async getUploadUrl(path: string): Promise<string> {
    void path;
    throw new NotImplementedError("get_upload_url is not yet implemented; use files.write() instead");
  }

  /** Return a pre-signed download URL. E2B-compatible. */
  async getDownloadUrl(path: string): Promise<string> {
    void path;
    throw new NotImplementedError("get_download_url is not yet implemented; use files.read() instead");
  }

  // ---- Context manager ----

  async __aenter__(): Promise<this> {
    return this;
  }

  /** Kill the sandbox on scope exit; cleanup errors are logged, never raised. */
  async __aexit__(): Promise<void> {
    try {
      await this.kill();
    } catch (e) {
      logger.warning("Error during sandbox cleanup on __aexit__", new ExcInfo(e));
    }
  }

  __repr__(): string {
    return `<Sandbox id=${pyRepr(this.id)} status=${pyRepr(this.status)}>`;
  }
}

const asyncDispose: symbol | undefined = (Symbol as unknown as { asyncDispose?: symbol }).asyncDispose;
if (asyncDispose !== undefined) {
  (Sandbox.prototype as unknown as Record<symbol, unknown>)[asyncDispose] = function (this: Sandbox): Promise<void> {
    return this.__aexit__();
  };
}

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
 *
 * `api/deploy.py` (`Sandbox.deploy`) is SDK-only and not reached by the CLI; it is intentionally not ported.
 */

import { ResolvedCapabilities, resolveCapabilities } from "./capability.js";
import { CommandNotFoundError } from "../models/errors.js";
import { setActiveProvider, trackOpenInfra } from "../providers/active.js";
import type { Provider, ProviderInfra } from "../providers/base.js";
import { ProviderConfigError, ProviderMismatchError } from "../providers/errors.js";
import { cliOptions, cliProvider } from "../providers/selection.js";
import { getProvider, parseSandboxRef, registerProvider, resolveProviderId } from "../providers/registry.js";
import { BUILTIN_PROVIDER_ID, providerEnvName } from "../utils/config_keys.js";
import { loadLayeredConfig } from "../transport/config_layers.js";
import { CodeResult, CommandResult, ProcessResult, type ProcessChunk } from "../models/process.js";
import { SandboxConfig, SandboxInfo, type SandboxStatus } from "../models/sandbox.js";
import type { CustomCommand } from "../models/template.js";
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
import { shlexQuote } from "./_shlex.js";
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
  /** Provider id (or a `Provider` object). Default: `EBX_PROVIDER` / `[core] provider` / `alicloud-express`. */
  provider?: string | Provider | null;
  /** Provider-scoped option values (see `ebx provider info`); exec providers receive them minus secret fields. */
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
class InfraCloser {
  private readonly untrack: () => void;

  constructor(private readonly infra: ProviderInfra) {
    this.untrack = trackOpenInfra(() => this.close());
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
        suggestion: `Run 'ebx provider info ${schema.id}' to see its options.`,
      });
    }
    if (f?.secret) {
      throw new ProviderConfigError(`Field '${key}' is secret; set it with 'ebx provider config ${schema.id} set ${key}' or the ${providerEnvName(schema.id, key)} environment variable.`);
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
  const http_client = new HttpClient(config, auth);
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

export interface SandboxRunOptions {
  timeout?: number;
  env?: Record<string, string> | null;
  cwd?: string;
  user?: string;
  background?: boolean;
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

const PLACEHOLDER_RE = /\{([\p{L}\p{N}_]+)\}/gu;

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
  _custom_commands: Record<string, CustomCommand>;
  _server_probe_failed: boolean;
  _provider_id: string;

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
    this._custom_commands = { ...this._resolved.custom_commands };

    // Cache flag for mechanism-B (SandboxServer) reachability. Once a connection attempt fails, subsequent custom()
    // calls skip the probe to avoid repeated connect-timeout stalls. Reset via resetServerProbe().
    this._server_probe_failed = false;
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
    return new FrozenSet(this._capabilities);
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
      const envd_token = new EnvdTokenManager(info.envd_access_token, info.sandbox_id);
      logger.info("Sandbox created: %s (provider %s)", info.sandbox_id, prov.id);
      const resolved = new ResolvedCapabilities(); // a plugin template is a backend image, not a catalog template
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
      const envd_token = new EnvdTokenManager(info.envd_access_token, info.sandbox_id);
      logger.info("Connected to sandbox: %s (provider %s)", sandbox_id, prov.id);
      const resolved = new ResolvedCapabilities();
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

  /** Kill the sandbox and release resources. */
  async kill(): Promise<void> {
    try {
      await this._sandbox_protocol.kill(this.id);
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
    return TerminalSession.create(this.url, this._envd_token, this._config, { cols, rows, shell });
  }

  // ---- Custom command dispatch ----

  /**
   * Return the merged command catalogue (template + server).
   *
   * Each entry is `{name, source: "template"|"server", description, args: [{name, required, default, description,
   * type}], shadowed}`. Template commands take priority: a server command whose name also exists in the template
   * catalogue is marked `shadowed=true`.
   *
   * Throws `TokenExpiredError` if the sandbox is not authenticated.
   */
  async listCommands(opts: { server_port?: number } = {}): Promise<Record<string, any>[]> {
    const { server_port = 9000 } = opts;
    // Verify sandbox authentication (raises TokenExpiredError if invalid)
    this._envd_token.getHeaders();

    const template_names = new Set(Object.keys(this._custom_commands));
    const results: Record<string, any>[] = Object.entries(this._custom_commands).map(([name, cmd]) => ({
      name,
      source: "template",
      description: cmd.description,
      args: cmd.args.map((arg) => ({
        name: arg.name,
        required: arg.required,
        default: arg.default,
        description: arg.description,
        type: arg.type,
      })),
      shadowed: false,
    }));

    // Server commands (best-effort; never raise on connection failure).
    let server_cmds: Record<string, any>[];
    try {
      server_cmds = await this._fetchServerCommands(server_port);
    } catch (exc) {
      if (!(exc instanceof RequestError)) throw exc;
      logger.debug("Could not fetch server commands (server may be down): %s", pyExcStr(exc));
      server_cmds = [];
    }

    for (const cmd_entry of server_cmds) {
      const srv_name = pyStr(dictGet(cmd_entry, "name", ""));
      results.push({
        name: srv_name,
        source: "server",
        description: dictGet(cmd_entry, "description", ""),
        args: dictGet(cmd_entry, "args", []),
        shadowed: template_names.has(srv_name),
      });
    }

    return results;
  }

  /**
   * Run a bare shell command — top-level shortcut for `commands.run`.
   *
   * To execute a *named* command (template `custom_commands` or a SandboxServer registry function) use `custom()`.
   */
  async run(cmd: string, opts: SandboxRunOptions = {}): Promise<ProcessResult | StreamReader<ProcessChunk>> {
    const { timeout = 60, env = null, cwd = "", user = "", background = false } = opts;
    return this.commands.run(cmd, { timeout, env, cwd, user, background });
  }

  // ---- Named command dispatch (template A → server B) ----

  /**
   * Execute a named command, resolving template (A) then server (B).
   *
   * 1. Template `custom_commands` (mechanism A): fills `{placeholder}` tokens with `kwargs` (shlex-quoted) and runs the
   *    resulting shell command over envd.
   * 2. Server registry (mechanism B): `POST /commands/{name}` to a SandboxServer on `server_port` (default 9000),
   *    forwarding `kwargs` as JSON.
   *
   * `kwargs.server_port` is consumed as the SandboxServer port (like the Python keyword-only parameter).
   *
   * Throws `CommandNotFoundError` if `name` is unknown in both sources or the SandboxServer cannot be reached, and
   * `ValueError` if a template command's arguments are invalid.
   */
  async custom(name: string, kwargs: Record<string, any> = {}): Promise<CommandResult> {
    const { server_port = 9000, ...rest } = kwargs;
    return this._custom(name, server_port, rest);
  }

  private async _custom(name: string, server_port: number, kwargs: Record<string, any>): Promise<CommandResult> {
    // Phase 1: template custom_commands (A).
    if (Object.prototype.hasOwnProperty.call(this._custom_commands, name)) {
      const process_result = await this._runTemplateCommand(name, kwargs);
      return new CommandResult({
        value: pyStrip(process_result.stdout),
        stdout: process_result.stdout,
        stderr: process_result.stderr,
        exit_code: process_result.exit_code,
        execution_time: process_result.execution_time,
        source: "template",
      });
    }

    const checked = ["template custom_commands", "sandbox server"];

    // Phase 2: server registry (B). Skip if a prior probe already failed.
    if (this._server_probe_failed) {
      throw new CommandNotFoundError(name, {
        checked,
        template_commands: Object.keys(this._custom_commands),
        server_status: "skipped after a previous connection failure; is the SandboxServer running?",
      });
    }

    let response: HttpResponseLike;
    let body: Record<string, any>;
    try {
      [response, body] = await this._callServerCommand(name, server_port, kwargs);
    } catch (exc) {
      if (exc instanceof RequestError) {
        this._server_probe_failed = true;
        throw withCause(
          new CommandNotFoundError(name, {
            checked,
            template_commands: Object.keys(this._custom_commands),
            server_status: `connection failed (${pyExcStr(exc)}); is the SandboxServer running?`,
          }),
          exc,
        );
      }
      if (exc instanceof RuntimeError) {
        // Non-JSON response (e.g. 502 Bad Gateway when server is not running). Treat as server-unreachable so the
        // user gets a friendly CommandNotFoundError instead of a raw RuntimeError.
        this._server_probe_failed = true;
        throw withCause(
          new CommandNotFoundError(name, {
            checked,
            template_commands: Object.keys(this._custom_commands),
            server_status: `server returned an invalid response (${pyExcStr(exc)}); is the SandboxServer running?`,
          }),
          exc,
        );
      }
      throw exc;
    }

    if (response.is_success) {
      return new CommandResult({ value: dictGet(body, "result"), exit_code: 0, source: "server" });
    }

    if ((response as { status_code?: number } | null)?.status_code === 404) {
      throw new CommandNotFoundError(name, {
        checked,
        template_commands: Object.keys(this._custom_commands),
        server_status: "reachable but command not found (HTTP 404)",
      });
    }

    // Reachable, command exists, but validation/execution failed.
    const error_msg = pyStr(dictGet(body, "error", "Unknown error"));
    const error_type = pyStr(dictGet(body, "type", "UnknownError"));
    return new CommandResult({
      value: dictGet(body, "result"),
      stderr: `${error_type}: ${error_msg}`,
      exit_code: 1,
      source: "server",
    });
  }

  /** Clear the cached SandboxServer-unreachable flag, so a subsequent `custom()` retries mechanism B. */
  resetServerProbe(): void {
    this._server_probe_failed = false;
  }

  /**
   * Deprecated alias for `custom()` returning only `.value`.
   *
   * `kwargs.server_port` is consumed as the SandboxServer port.
   */
  async runCommand(name: string, kwargs: Record<string, any> = {}): Promise<any> {
    _seams.warn("Sandbox.run_command() is deprecated; use Sandbox.custom() instead.", "DeprecationWarning");
    const { server_port = 9000, ...rest } = kwargs;
    const result = await this._custom(name, server_port, rest);
    return result.value;
  }

  // ---- Named command internals ----

  /**
   * Run a template `custom_commands` entry (mechanism A).
   *
   * Fills `{placeholder}` tokens using `kwargs` (shlex-quoted) and runs the resulting shell command. Preserves the
   * single-pass substitution that closes the argv-injection hole.
   *
   * Throws `ValueError` on undeclared/missing args or unfilled placeholders.
   */
  async _runTemplateCommand(name: string, kwargs: Record<string, any>): Promise<ProcessResult> {
    const cmd_def = this._custom_commands[name]!;

    const declared = new Set(cmd_def.args.map((arg) => arg.name));
    const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(kwargs, k);

    // Reject undeclared kwargs rather than silently dropping them, so typos surface immediately.
    const undeclared = pySorted(Object.keys(kwargs).filter((k) => !declared.has(k)));
    if (undeclared.length) {
      const declared_sorted = pySorted(declared);
      throw new ValueError(
        `Unexpected argument(s) ${pyRepr(undeclared)} for custom command ` +
          `${pyRepr(name)}; declared args: ${declared_sorted.length ? pyRepr(declared_sorted) : "(none)"}`,
      );
    }

    // Validate required args
    for (const arg of cmd_def.args) {
      if (arg.required && !has(arg.name) && arg.default === null) {
        throw new ValueError(`Required argument ${pyRepr(arg.name)} missing for custom command ${pyRepr(name)}`);
      }
    }

    // Build substitution map (declared args only, shlex-quoted).
    const subs = new Map<string, string>();
    for (const arg of cmd_def.args) {
      if (has(arg.name)) {
        subs.set(arg.name, shlexQuote(pyStr(kwargs[arg.name])));
      } else if (arg.default !== null) {
        subs.set(arg.name, shlexQuote(arg.default));
      }
    }

    // Single-pass substitution over the ORIGINAL template only. Because replace never re-scans inserted text, a user
    // value that itself looks like `{other}` cannot be expanded a second time.
    const cmd_str = cmd_def.cmd.replace(PLACEHOLDER_RE, (m: string, key: string) => subs.get(key) ?? m);

    // Detect unfilled placeholders against the ORIGINAL template (not the substituted string).
    const unfilled = [...cmd_def.cmd.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!).filter((k) => !subs.has(k));
    if (unfilled.length) {
      throw new ValueError(`Unfilled placeholders in command ${pyRepr(name)}: ${pyRepr(unfilled)}`);
    }

    const result = await this.commands.run(cmd_str, {
      timeout: cmd_def.timeout,
      env: cmd_def.env && Object.keys(cmd_def.env).length ? cmd_def.env : null,
      cwd: cmd_def.cwd,
    });
    // commands.run may return StreamReader when background=true, but custom commands always run in foreground.
    return result as ProcessResult;
  }

  /**
   * POST `/commands/{name}` to the in-sandbox SandboxServer (B).
   *
   * Returns the raw `[response, parsed_body]` pair so the caller can map status codes to the unified `CommandResult`
   * semantics.
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

    const client = (this._http_client as unknown as { _createEnvdClient(u: string): EnvdClientLike })._createEnvdClient(url);
    const headers = { "Content-Type": "application/json", ...access_headers };

    const response = await client.post(`/commands/${name}`, { json: kwargs, headers });

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
   * GET `/commands` from the in-sandbox SandboxServer (B).
   *
   * Returns the `commands` list from the JSON body, or an empty list when the response is malformed. Connection errors
   * propagate as `RequestError` for the caller to handle.
   */
  async _fetchServerCommands(server_port: number): Promise<Record<string, any>[]> {
    const url = this.network.getUrl(server_port);
    const access_headers = this.network.getAccessHeaders();

    const client = (this._http_client as unknown as { _createEnvdClient(u: string): EnvdClientLike })._createEnvdClient(url);
    const response = await client.get("/commands", { headers: access_headers });

    if (!response.is_success) return [];
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

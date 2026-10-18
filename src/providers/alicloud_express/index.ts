import { CONFIG_METADATA } from "./metadata.js";
import { TemplateManager } from "./template.js";
/** The built-in provider: Alibaba Cloud Express Edition (`alicloud-express`). */

import { CodeInterpreterProtocol } from "../shared/e2b/code_interpreter.js";
import { FilesystemProtocol } from "../shared/e2b/filesystem.js";
import { ProcessProtocol } from "../shared/e2b/process.js";
import { SandboxProtocol } from "../shared/e2b/sandbox.js";
import { createAuthProvider } from "./auth.js";
import { resolveCapabilities } from "../../api/capability.js";
import type { SandboxInfo } from "../../models/sandbox.js";
import { loadConfig, type TransportConfig } from "../../transport/config.js";
import { EnvdTokenManager } from "../shared/e2b/auth.js";
import { TerminalSession } from "../shared/e2b/terminal.js";
import { envdUrl } from "../shared/e2b/url.js";
import { createPortAccess } from "../shared/e2b/ports.js";
import type { PortContext } from "../../protocol/port_contract.js";
import type { LayeredConfig } from "../../transport/config_layers.js";
import { HttpClient } from "../../transport/http.js";
import {
  ALICLOUD_EXPRESS_KEYS,
  BUILTIN_PROVIDER_ID,
  BUILTIN_PROVIDER_NAME,
  BUILTIN_PROVIDER_NAME_ZH,
  GENERIC_ENDPOINT_KEYS,
  envNames,
} from "../../utils/config_keys.js";
import { hostVersion } from "../host.js";
import { Provider, type ConfigField, type ProviderInfra, type LegacyInfraOptions, type TerminalContext } from "../base.js";
import type { ProviderCommandRunner } from "../command_contract.js";
import { ALICLOUD_COMMANDS, runAlicloudCommand } from "./commands.js";

function fields(): ConfigField[] {
  return ALICLOUD_EXPRESS_KEYS.map((k) => ({
    key: k.key,
    type: k.type,
    secret: k.secret,
    credential: k.credential,
    default: k.default,
    description: k.description,
    description_zh: k.description_zh ?? "",
    env: envNames(k).filter((n) => n !== k.env),
  }));
}

/** Wraps the CLI's existing platform behaviour (`api/`, `protocol/`, `transport/`); it is the default provider. */
export class AlicloudExpressProvider extends Provider {
  readonly id: string = BUILTIN_PROVIDER_ID;

  constructor() {
    super();
    this.displayName = BUILTIN_PROVIDER_NAME;
    this.displayNameZh = BUILTIN_PROVIDER_NAME_ZH;
    this.kind = "builtin";
    this.derive = CONFIG_METADATA.derive;
    this.endpointDefaults = CONFIG_METADATA.endpointDefaults;
    this.version = hostVersion();
    this.features = new Set([
      "sandbox.lifecycle", "sandbox.timeout", "exec.run", "exec.stream", "process.manage", "pty",
      "files.rw", "files.watch", "files.transfer", "code.interpret", "templates.read", "templates.build", "ports.url", "sessions",
    ]);
    this.commands = ALICLOUD_COMMANDS;
    this.inherit = new Set(GENERIC_ENDPOINT_KEYS);
    this.configFields = fields();
  }

  override createOptions = new Set(["volume_mounts"]);

  override buildSessionProtocols(http: HttpClient) {
    return { sandbox_protocol: new SandboxProtocol(http), process_protocol: new ProcessProtocol(http),
      filesystem_protocol: new FilesystemProtocol(http), code_interpreter_protocol: new CodeInterpreterProtocol(http) };
  }

  override createSessionAuth(info: SandboxInfo): EnvdTokenManager {
    return new EnvdTokenManager(info.envd_access_token, info.sandbox_id);
  }

  override resolveSessionUrl(info: SandboxInfo, config: TransportConfig): string {
    return info.envd_url || envdUrl(info.sandbox_id, config.domain);
  }

  override createPortAccess(context: PortContext) { return createPortAccess(context, false); }

  override async resolveSessionCapabilities(template: string, _info: SandboxInfo) {
    return resolveCapabilities(template);
  }

  override async openTerminal(context: TerminalContext, opts: { cols: number; rows: number; shell: string }) {
    return TerminalSession.create(context.url, context.token, context.config, { ...opts, dial: context.http?._dial ?? null });
  }

  override buildLegacyInfra(opts: LegacyInfraOptions): [TransportConfig, ReturnType<typeof createAuthProvider>, HttpClient, SandboxProtocol] {
    const config = loadConfig({ api_key: opts.api_key, api_url: opts.api_url,
      access_key_id: opts.access_key_id, access_key_secret: opts.access_key_secret,
      ...(opts.provider_options?.["region"] ? { region: opts.provider_options["region"] } : {}) });
    const auth = createAuthProvider({ api_key: config.api_key, access_key_id: config.access_key_id,
      access_key_secret: config.access_key_secret, region: config.region });
    const http = new HttpClient(config, auth, { envelope_connect: true });
    return [config, auth, http, new SandboxProtocol(http)];
  }

  override async buildTemplateManager(config: LayeredConfig) {
    const auth = createAuthProvider({ api_key: config.sandbox_api_key, access_key_id: config.access_key_id,
      access_key_secret: config.access_key_secret, region: config.region });
    return new TemplateManager(new HttpClient(config.toTransportConfig(), auth));
  }

  override configKeys(): typeof ALICLOUD_EXPRESS_KEYS {
    return ALICLOUD_EXPRESS_KEYS;
  }

  override async buildCommandRunner(config: LayeredConfig): Promise<ProviderCommandRunner> {
    return { run: (command, input) => runAlicloudCommand(config, command, input) };
  }

  async buildInfra(config: LayeredConfig): Promise<ProviderInfra> {
    const transport = config.toTransportConfig();
    const auth = createAuthProvider({
      api_key: config.sandbox_api_key,
      access_key_id: config.access_key_id,
      access_key_secret: config.access_key_secret,
      region: config.region,
    });
    // Express envd reads streaming RPCs as Connect envelopes. Plain JSON is parsed as a length prefix
    // (`{"pro...` → "promised N bytes") and the command's stdout never arrives.
    const http = new HttpClient(transport, auth, { envelope_connect: true });
    return {
      config,
      auth,
      http_client: http,
      sandbox_protocol: new SandboxProtocol(http),
      process_protocol: new ProcessProtocol(http),
      filesystem_protocol: new FilesystemProtocol(http),
      code_interpreter_protocol: new CodeInterpreterProtocol(http),
      close: () => http.close(),
    };
  }
}

import workflowOperations from "./workflow-operations.json" with { type: "json" };
import { CONFIG_METADATA } from "./metadata.js";
/** The built-in provider: Alibaba Cloud Express Edition (`alicloud-express`). */

import { UnsupportedCodeProtocol } from "../unsupported_code.js";
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
import { Provider, type ConfigField, type ProviderInfra, type TerminalContext } from "../base.js";
import type { ProviderCommandRunner } from "../command_contract.js";
import { ALICLOUD_COMMANDS, runAlicloudCommand } from "./commands.js";
import { CONDITIONAL_COMMANDS, buildConditionalCommandRunner, isConditionalCommand } from "./conditional_commands.js";
import { TEMPLATE_CACHE_COMMANDS, isTemplateCacheCommand, runTemplateCacheCommand } from "./template_cache_commands.js";

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
      "files.rw", "files.watch", "files.transfer", "templates.read", "templates.build", "ports.url", "sessions",
    ]);
    this.operations = workflowOperations.operations;
    this.workflow_inputs = workflowOperations.workflow_inputs;
    this.startup_modes = workflowOperations.startup_modes;
    this.commands = [...ALICLOUD_COMMANDS, ...CONDITIONAL_COMMANDS, ...TEMPLATE_CACHE_COMMANDS];
    // Snapshot create may take300 seconds; this is an outer deadline, not the sandbox TTL.
    this.commandTimeoutMs = 360_000;
    this.inherit = new Set(GENERIC_ENDPOINT_KEYS);
    this.configFields = fields();
  }

  override createOptions = new Set(["volume_mounts"]);

  override buildSessionProtocols(http: HttpClient) {
    return { sandbox_protocol: new SandboxProtocol(http), process_protocol: new ProcessProtocol(http),
      filesystem_protocol: new FilesystemProtocol(http), code_interpreter_protocol: new UnsupportedCodeProtocol(this.id) };
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
    this.require("pty");
    return TerminalSession.create(context.url, context.token, context.config, { ...opts, dial: context.http?._dial ?? null });
  }

  override configKeys(): typeof ALICLOUD_EXPRESS_KEYS {
    return ALICLOUD_EXPRESS_KEYS;
  }

  override async buildCommandRunner(config: LayeredConfig): Promise<ProviderCommandRunner> {
    let conditional: ProviderCommandRunner | undefined;
    return {
      run: (command, input, signal) => {
        if (isTemplateCacheCommand(command)) return runTemplateCacheCommand(config, command, input, signal);
        if (!isConditionalCommand(command)) return runAlicloudCommand(config, command, input);
        conditional ??= buildConditionalCommandRunner(config);
        return conditional.run(command, input, signal);
      },
      close: async () => { await conditional?.close?.(); },
    };
  }

  async buildInfra(config: LayeredConfig): Promise<ProviderInfra> {
    const transport = config.toTransportConfig();
    const auth = createAuthProvider({
      api_key: config.sandbox_api_key,
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
      code_interpreter_protocol: new UnsupportedCodeProtocol(this.id),
      close: () => http.close(),
    };
  }
}

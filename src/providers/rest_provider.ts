import { sessionAuth as e2bSessionAuth, sessionProtocols as e2bSessionProtocols, openTerminal as e2bOpenTerminal } from "./shared/e2b/session.js";
import { envdUrl } from "./shared/e2b/url.js";
import { createPortAccess } from "./shared/e2b/ports.js";
import type { PortContext } from "../protocol/port_contract.js";
import type { SandboxInfo as SessionInfo } from "../models/sandbox.js";
import type { TerminalContext as SessionTerminalContext, ProviderInfra as SessionInfra } from "./base.js";
/** `rest` providers: a declarative endpoint preset for any E2B-protocol backend (no code). */

import { ProviderProtocolError } from "../models/provider_errors.js";
import { InvalidAPIKeyError } from "../models/errors.js";
import { UnsupportedCodeProtocol } from "./unsupported_code.js";
import { FilesystemProtocol } from "./shared/e2b/filesystem.js";
import { ProcessProtocol } from "./shared/e2b/process.js";
import { SandboxProtocol } from "./shared/e2b/sandbox.js";
import type { AuthProvider } from "../transport/auth_contract.js";
import type { LayeredConfig } from "../transport/config_layers.js";
import { HttpClient } from "../transport/http.js";
import { providerEnvName } from "../utils/config_keys.js";
import { Provider, consentedInherit, type ProviderInfra } from "./base.js";
import { FILESYSTEM_RULES, PROCESS_RULES, SANDBOX_RULES, gateProtocol } from "./feature_gate.js";
import type { Manifest } from "./manifest.js";

/** Platform authentication with a bearer token or a custom API-key header. */
export class HeaderKeyAuth implements AuthProvider {
  private readonly key: string;

  constructor(
    key: string,
    private readonly scheme: string = "bearer",
    private readonly header: string = "X-API-Key",
  ) {
    if (!key || !key.trim()) throw new InvalidAPIKeyError("API key cannot be empty");
    this.key = key.trim();
  }

  async getHeaders(): Promise<Record<string, string>> {
    if (this.scheme === "header") return { [this.header]: this.key };
    return { Authorization: `Bearer ${this.key}` };
  }

  async refresh(): Promise<void> {
    return undefined;
  }
}

type Dict = Record<string, unknown>;

/** E2B-protocol backend described entirely by its manifest. */
export class RestProvider extends Provider {
  override createSessionAuth(info: SessionInfo, infra?: SessionInfra) { return e2bSessionAuth(info, infra); }
  override async openTerminal(context: SessionTerminalContext, opts: { cols: number; rows: number; shell: string }) {
    this.require("pty");
    if (context.url.startsWith("epp://")) return super.openTerminal(context, opts);
    return e2bOpenTerminal(context, opts);
  }
  override buildSessionProtocols(http: HttpClient) { return e2bSessionProtocols(http, this.id); }
  override createPortAccess(context: PortContext) { return createPortAccess(context); }
  override resolveSessionUrl(info: SessionInfo, config: import("../transport/config.js").TransportConfig) { return info.envd_url || envdUrl(info.sandbox_id, config.domain); }
  override kind = "rest" as const;
  readonly id: string;
  private readonly authCfg: Dict;

  constructor(
    readonly manifest: Manifest,
    readonly receipt: Dict | null = null,
  ) {
    super();
    this.id = manifest.id;
    this.displayName = manifest.name;
    this.displayNameZh = manifest.name_zh;
    this.version = manifest.version;
    this.features = new Set(manifest.features);
    this.operations = manifest.operations;
    if (Object.values(this.operations).some((operations: readonly string[]) => operations.some((operation: string) => operation.startsWith("code.")))) throw new ProviderProtocolError("REST presets have no verified interpreter transport.");
    this.workflow_inputs = manifest.workflow_inputs;
    this.startup_modes = manifest.startup_modes;
    this.configFields = manifest.fields;
    this.authAnyOf = manifest.auth_any_of;
    this.inherit = consentedInherit(manifest.inherit, receipt);
    const ep = manifest.endpoint;
    const defaults: Record<string, string> = {};
    if (ep["base_url"]) defaults["sandbox_base_url"] = String(ep["base_url"]);
    if (ep["domain"]) defaults["sandbox_domain"] = String(ep["domain"]);
    this.endpointDefaults = defaults;
    this.derive = { ...((ep["derive"] as Record<string, string> | undefined) ?? {}) };
    this.authCfg = { ...((ep["auth"] as Dict | undefined) ?? { scheme: "bearer" }) };
  }

  async buildInfra(config: LayeredConfig): Promise<ProviderInfra> {
    this.validateConfig(config);
    const opts = config.provider_options;
    const key = opts["api_key"] || (this.inherit.has("sandbox_api_key") ? config.sandbox_api_key : null);
    if (!key) {
      throw new InvalidAPIKeyError(`Provider '${this.id}' has no API key.`, {
        suggestion: `Set ${providerEnvName(this.id, "api_key")}.`,
      });
    }
    const auth = new HeaderKeyAuth(String(key), String(this.authCfg["scheme"] ?? "bearer"), String(this.authCfg["header"] ?? "X-API-Key"));
    const http = new HttpClient(config.toTransportConfig(), auth);
    const gate = <T extends object>(protocol: T, rules: Parameters<typeof gateProtocol>[2]): T => gateProtocol(protocol, this.id, rules, this.features);
    return {
      config,
      auth,
      http_client: http,
      sandbox_protocol: gate(new SandboxProtocol(http, { unknownIfAbsent: true }), SANDBOX_RULES),
      process_protocol: gate(new ProcessProtocol(http), PROCESS_RULES),
      filesystem_protocol: gate(new FilesystemProtocol(http), FILESYSTEM_RULES),
      code_interpreter_protocol: new UnsupportedCodeProtocol(this.id),
      close: () => http.close(),
    };
  }
}

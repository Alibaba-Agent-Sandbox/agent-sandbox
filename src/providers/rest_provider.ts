/** `rest` providers: a declarative endpoint preset for any E2B-protocol backend (no code). */

import { InvalidAPIKeyError } from "../models/errors.js";
import { CodeInterpreterProtocol } from "../protocol/code_interpreter.js";
import { FilesystemProtocol } from "../protocol/filesystem.js";
import { ProcessProtocol } from "../protocol/process.js";
import { SandboxProtocol } from "../protocol/sandbox.js";
import type { AuthProvider } from "../transport/auth.js";
import type { LayeredConfig } from "../transport/config_layers.js";
import { HttpClient } from "../transport/http.js";
import { providerEnvName } from "../utils/config_keys.js";
import { Provider, type ProviderInfra } from "./base.js";
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
    this.configFields = manifest.fields;
    this.authAnyOf = manifest.auth_any_of;
    const consented = new Set<string>(
      receipt === null ? manifest.inherit : (((receipt["consented"] as Dict | undefined)?.["inherit"] as string[] | undefined) ?? []),
    );
    this.inherit = new Set(manifest.inherit.filter((k) => consented.has(k)));
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

/** The built-in provider: Alibaba Cloud Express Edition (`alicloud-express`). */

import { CodeInterpreterProtocol } from "../protocol/code_interpreter.js";
import { FilesystemProtocol } from "../protocol/filesystem.js";
import { ProcessProtocol } from "../protocol/process.js";
import { SandboxProtocol } from "../protocol/sandbox.js";
import { createAuthProvider } from "../transport/auth.js";
import type { LayeredConfig } from "../transport/config_layers.js";
import { HttpClient } from "../transport/http.js";
import {
  ALICLOUD_EXPRESS_KEYS,
  BUILTIN_PROVIDER_ID,
  BUILTIN_PROVIDER_NAME,
  BUILTIN_PROVIDER_NAME_ZH,
  GENERIC_ENDPOINT_KEYS,
  envNames,
} from "../utils/config_keys.js";
import { hostVersion } from "./host.js";
import { Provider, type ConfigField, type ProviderInfra } from "./base.js";

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
    this.version = hostVersion();
    this.features = new Set([
      "sandbox.lifecycle", "sandbox.timeout", "exec.run", "exec.stream", "process.manage", "pty",
      "files.rw", "files.watch", "files.transfer", "code.interpret", "templates.read", "templates.build", "ports.url", "sessions",
    ]);
    this.inherit = new Set(GENERIC_ENDPOINT_KEYS);
    this.configFields = fields();
  }

  override configKeys(): typeof ALICLOUD_EXPRESS_KEYS {
    return ALICLOUD_EXPRESS_KEYS;
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

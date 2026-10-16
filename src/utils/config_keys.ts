/**
 * Canonical configuration-key registry (GENERATED - do not edit).
 *
 * Source of truth: docs/design/fixtures/config-keys.json (exported by the Python SDK with
 * `python -m agent_sandbox.utils.config_keys --json`). Regenerate with `node scripts/gen-config-keys.mjs`;
 * `tests/test_utils/test_config_keys.test.ts` fails when this file drifts from the JSON.
 *
 * The pure layered resolver lives in `./config_resolver.ts`.
 *
 * Keys only the CLI reads (`llm_*`, `acr_*`, `team_id`) are declared by hand in `./cli_config_keys.ts` and appended
 * to the shared keys at load time; `exportSchema()` and the JSON contain the shared keys only.
 */

import { CLI_BUILTIN_KEYS, CLI_CORE_KEYS } from "./cli_config_keys.js";

const SCHEMA: ConfigKeysSchema = {
  "schema_version": 1,
  "builtin_provider": {
    "id": "alicloud-express",
    "name": "Alibaba Cloud Express Edition",
    "name_zh": "阿里云极速版"
  },
  "reserved_provider_ids": [
    "alicloud-express",
    "default",
    "all",
    "none",
    "builtin",
    "shortcuts",
    "core",
    "transport",
    "providers"
  ],
  "reserved_provider_prefixes": [
    "abx-",
    "alicloud-",
    "shortcuts"
  ],
  "generic_endpoint_keys": [
    "sandbox_api_key",
    "sandbox_base_url",
    "sandbox_domain"
  ],
  "tuning_keys": [
    "http_timeout",
    "http2",
    "max_retries",
    "max_connections",
    "max_keepalive_connections",
    "keepalive_expiry",
    "ws_ping_interval",
    "retry_base_delay"
  ],
  "keys": [
    {
      "key": "provider",
      "scope": "core",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ABX_PROVIDER",
      "aliases": [],
      "env_names": [
        "ABX_PROVIDER"
      ],
      "toml_section": "core",
      "storage_phase1": {
        "file": "toml",
        "name": "provider",
        "section": "core"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "provider",
        "section": "core"
      },
      "default": "alicloud-express",
      "choices": [],
      "group": "Provider",
      "description": "Default provider id (see 'abx provider list')"
    },
    {
      "key": "sandbox_api_key",
      "scope": "core",
      "type": "str",
      "secret": true,
      "credential": true,
      "settable": true,
      "env": "E2B_API_KEY",
      "aliases": [],
      "env_names": [
        "E2B_API_KEY"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "env",
        "name": "E2B_API_KEY"
      },
      "storage_phase2": {
        "file": "env",
        "name": "E2B_API_KEY"
      },
      "default": null,
      "choices": [],
      "group": "Sandbox authentication",
      "description": "Agent Sandbox API key of the active provider"
    },
    {
      "key": "sandbox_base_url",
      "scope": "core",
      "type": "url",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "E2B_API_URL",
      "aliases": [],
      "env_names": [
        "E2B_API_URL"
      ],
      "toml_section": "transport",
      "storage_phase1": {
        "file": "toml",
        "name": "sandbox_base_url",
        "section": "transport"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "sandbox_base_url",
        "section": "transport"
      },
      "default": "https://api.cn-hangzhou.e2b.fc.aliyuncs.com",
      "choices": [],
      "group": "Connection",
      "description": "Agent Sandbox API endpoint of the active provider"
    },
    {
      "key": "sandbox_domain",
      "scope": "core",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "E2B_DOMAIN",
      "aliases": [],
      "env_names": [
        "E2B_DOMAIN"
      ],
      "toml_section": "transport",
      "storage_phase1": {
        "file": "toml",
        "name": "sandbox_domain",
        "section": "transport"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "sandbox_domain",
        "section": "transport"
      },
      "default": "cn-hangzhou.e2b.fc.aliyuncs.com",
      "choices": [],
      "group": "Connection",
      "description": "Envd data-plane domain"
    },
    {
      "key": "http_timeout",
      "scope": "core",
      "type": "float",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ABX_HTTP_TIMEOUT",
      "aliases": [],
      "env_names": [
        "ABX_HTTP_TIMEOUT"
      ],
      "toml_section": "transport",
      "storage_phase1": {
        "file": "toml",
        "name": "http_timeout",
        "section": "transport"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "http_timeout",
        "section": "transport"
      },
      "default": 30,
      "choices": [],
      "group": "Connection",
      "description": "HTTP request timeout in seconds"
    },
    {
      "key": "http2",
      "scope": "core",
      "type": "bool",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ABX_HTTP2",
      "aliases": [],
      "env_names": [
        "ABX_HTTP2"
      ],
      "toml_section": "transport",
      "storage_phase1": {
        "file": "toml",
        "name": "http2",
        "section": "transport"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "http2",
        "section": "transport"
      },
      "default": true,
      "choices": [],
      "group": "Connection",
      "description": "Use HTTP/2"
    },
    {
      "key": "max_retries",
      "scope": "core",
      "type": "int",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ABX_MAX_RETRIES",
      "aliases": [],
      "env_names": [
        "ABX_MAX_RETRIES"
      ],
      "toml_section": "transport",
      "storage_phase1": {
        "file": "toml",
        "name": "max_retries",
        "section": "transport"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "max_retries",
        "section": "transport"
      },
      "default": 3,
      "choices": [],
      "group": "Connection",
      "description": "Maximum automatic retries"
    },
    {
      "key": "max_connections",
      "scope": "core",
      "type": "int",
      "secret": false,
      "credential": false,
      "settable": false,
      "env": "ABX_MAX_CONNECTIONS",
      "aliases": [],
      "env_names": [
        "ABX_MAX_CONNECTIONS"
      ],
      "toml_section": "transport",
      "storage_phase1": null,
      "storage_phase2": null,
      "default": 100,
      "choices": [],
      "group": "",
      "description": ""
    },
    {
      "key": "max_keepalive_connections",
      "scope": "core",
      "type": "int",
      "secret": false,
      "credential": false,
      "settable": false,
      "env": "ABX_MAX_KEEPALIVE_CONNECTIONS",
      "aliases": [],
      "env_names": [
        "ABX_MAX_KEEPALIVE_CONNECTIONS"
      ],
      "toml_section": "transport",
      "storage_phase1": null,
      "storage_phase2": null,
      "default": 20,
      "choices": [],
      "group": "",
      "description": ""
    },
    {
      "key": "keepalive_expiry",
      "scope": "core",
      "type": "float",
      "secret": false,
      "credential": false,
      "settable": false,
      "env": "ABX_KEEPALIVE_EXPIRY",
      "aliases": [],
      "env_names": [
        "ABX_KEEPALIVE_EXPIRY"
      ],
      "toml_section": "transport",
      "storage_phase1": null,
      "storage_phase2": null,
      "default": 30,
      "choices": [],
      "group": "",
      "description": ""
    },
    {
      "key": "ws_ping_interval",
      "scope": "core",
      "type": "float",
      "secret": false,
      "credential": false,
      "settable": false,
      "env": "ABX_WS_PING_INTERVAL",
      "aliases": [],
      "env_names": [
        "ABX_WS_PING_INTERVAL"
      ],
      "toml_section": "transport",
      "storage_phase1": null,
      "storage_phase2": null,
      "default": 30,
      "choices": [],
      "group": "",
      "description": ""
    },
    {
      "key": "retry_base_delay",
      "scope": "core",
      "type": "float",
      "secret": false,
      "credential": false,
      "settable": false,
      "env": "ABX_RETRY_BASE_DELAY",
      "aliases": [],
      "env_names": [
        "ABX_RETRY_BASE_DELAY"
      ],
      "toml_section": "transport",
      "storage_phase1": null,
      "storage_phase2": null,
      "default": 1,
      "choices": [],
      "group": "",
      "description": ""
    },
    {
      "key": "log_level",
      "scope": "core",
      "type": "enum",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ABX_LOG_LEVEL",
      "aliases": [],
      "env_names": [
        "ABX_LOG_LEVEL"
      ],
      "toml_section": "transport",
      "storage_phase1": {
        "file": "toml",
        "name": "log_level",
        "section": "transport"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "log_level",
        "section": "transport"
      },
      "default": "WARNING",
      "choices": [
        "DEBUG",
        "INFO",
        "WARNING",
        "ERROR",
        "CRITICAL"
      ],
      "group": "",
      "description": "Log level"
    },
    {
      "key": "default_template",
      "scope": "core",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ABX_DEFAULT_TEMPLATE",
      "aliases": [],
      "env_names": [
        "ABX_DEFAULT_TEMPLATE"
      ],
      "toml_section": "transport",
      "storage_phase1": {
        "file": "toml",
        "name": "default_template",
        "section": "transport"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "default_template",
        "section": "transport"
      },
      "default": "base",
      "choices": [],
      "group": "",
      "description": "Template used when none is given"
    },
    {
      "key": "github_token",
      "scope": "core",
      "type": "str",
      "secret": true,
      "credential": false,
      "settable": true,
      "env": "GITHUB_TOKEN",
      "aliases": [],
      "env_names": [
        "GITHUB_TOKEN"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "env",
        "name": "GITHUB_TOKEN"
      },
      "storage_phase2": {
        "file": "env",
        "name": "GITHUB_TOKEN"
      },
      "default": null,
      "choices": [],
      "group": "Integrations",
      "description": "GitHub token for the template index"
    },
    {
      "key": "template_index_url",
      "scope": "core",
      "type": "url",
      "secret": false,
      "credential": false,
      "settable": false,
      "env": "ABX_TEMPLATE_INDEX_URL",
      "aliases": [],
      "env_names": [
        "ABX_TEMPLATE_INDEX_URL"
      ],
      "toml_section": null,
      "storage_phase1": null,
      "storage_phase2": null,
      "default": null,
      "choices": [],
      "group": "",
      "description": ""
    },
    {
      "key": "template_dir",
      "scope": "core",
      "type": "path",
      "secret": false,
      "credential": false,
      "settable": false,
      "env": "ABX_TEMPLATE_DIR",
      "aliases": [],
      "env_names": [
        "ABX_TEMPLATE_DIR"
      ],
      "toml_section": null,
      "storage_phase1": null,
      "storage_phase2": null,
      "default": null,
      "choices": [],
      "group": "",
      "description": ""
    },
    {
      "key": "mcp_auth_token",
      "scope": "core",
      "type": "str",
      "secret": true,
      "credential": false,
      "settable": false,
      "env": "ABX_MCP_AUTH_TOKEN",
      "aliases": [],
      "env_names": [
        "ABX_MCP_AUTH_TOKEN"
      ],
      "toml_section": null,
      "storage_phase1": null,
      "storage_phase2": null,
      "default": null,
      "choices": [],
      "group": "",
      "description": ""
    },
    {
      "key": "mcp_allowed_origins",
      "scope": "core",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": false,
      "env": "ABX_MCP_ALLOWED_ORIGINS",
      "aliases": [],
      "env_names": [
        "ABX_MCP_ALLOWED_ORIGINS"
      ],
      "toml_section": null,
      "storage_phase1": null,
      "storage_phase2": null,
      "default": null,
      "choices": [],
      "group": "",
      "description": ""
    },
    {
      "key": "mcp_runtime_dir",
      "scope": "core",
      "type": "path",
      "secret": false,
      "credential": false,
      "settable": false,
      "env": "ABX_MCP_RUNTIME_DIR",
      "aliases": [],
      "env_names": [
        "ABX_MCP_RUNTIME_DIR"
      ],
      "toml_section": null,
      "storage_phase1": null,
      "storage_phase2": null,
      "default": null,
      "choices": [],
      "group": "",
      "description": ""
    },
    {
      "key": "region",
      "scope": "alicloud-express",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ALIBABA_CLOUD_REGION_ID",
      "aliases": [],
      "env_names": [
        "ALIBABA_CLOUD_REGION_ID"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "toml",
        "name": "region",
        "section": "transport"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "region",
        "section": "transport"
      },
      "default": "cn-hangzhou",
      "choices": [],
      "group": "Connection",
      "description": "Region id (derives the API URL and domain)"
    },
    {
      "key": "access_key_id",
      "scope": "alicloud-express",
      "type": "str",
      "secret": false,
      "credential": true,
      "settable": true,
      "env": "ALICLOUD_ACCESS_KEY_ID",
      "aliases": [],
      "env_names": [
        "ALICLOUD_ACCESS_KEY_ID"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "env",
        "name": "ALICLOUD_ACCESS_KEY_ID"
      },
      "storage_phase2": {
        "file": "env",
        "name": "ALICLOUD_ACCESS_KEY_ID"
      },
      "default": null,
      "choices": [],
      "group": "Alibaba Cloud credentials",
      "description": "Alibaba Cloud AccessKey ID"
    },
    {
      "key": "access_key_secret",
      "scope": "alicloud-express",
      "type": "str",
      "secret": true,
      "credential": true,
      "settable": true,
      "env": "ALICLOUD_ACCESS_KEY_SECRET",
      "aliases": [],
      "env_names": [
        "ALICLOUD_ACCESS_KEY_SECRET"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "env",
        "name": "ALICLOUD_ACCESS_KEY_SECRET"
      },
      "storage_phase2": {
        "file": "env",
        "name": "ALICLOUD_ACCESS_KEY_SECRET"
      },
      "default": null,
      "choices": [],
      "group": "Alibaba Cloud credentials",
      "description": "Alibaba Cloud AccessKey secret"
    }
  ]
} as ConfigKeysSchema;

export type KeyType = "str" | "url" | "int" | "float" | "bool" | "enum" | "path" | "csv";
export type AliasKind = "compat" | "native" | "legacy";
export type AliasSurface = "env" | "config" | "kwarg" | "flag";

export interface Alias {
  readonly name: string;
  readonly kind: AliasKind;
  readonly surface: AliasSurface;
}

export interface Storage {
  readonly file: "env" | "toml";
  readonly name: string;
  readonly section?: string;
}

/** One configuration key; `scope` is "core" or a provider id. */
export interface ConfigKey {
  readonly key: string;
  readonly scope: string;
  readonly type: KeyType;
  readonly secret: boolean;
  readonly credential: boolean;
  readonly settable: boolean;
  readonly env: string;
  readonly aliases: readonly Alias[];
  readonly env_names: readonly string[];
  readonly toml_section: string | null;
  readonly storage_phase1: Storage | null;
  readonly storage_phase2: Storage | null;
  readonly default: string | number | boolean | null;
  readonly choices: readonly string[];
  readonly group: string;
  readonly description: string;
  /** Optional, provider-declared (manifest fields); the generated registry never sets it. */
  readonly required?: boolean;
  readonly description_zh?: string;
}

export interface ConfigKeysSchema {
  readonly schema_version: number;
  readonly builtin_provider: { readonly id: string; readonly name: string; readonly name_zh: string };
  readonly reserved_provider_ids: readonly string[];
  readonly reserved_provider_prefixes: readonly string[];
  readonly generic_endpoint_keys: readonly string[];
  readonly tuning_keys: readonly string[];
  readonly keys: readonly ConfigKey[];
}

export const BUILTIN_PROVIDER_ID: string = SCHEMA.builtin_provider.id;
export const BUILTIN_PROVIDER_NAME: string = SCHEMA.builtin_provider.name;
export const BUILTIN_PROVIDER_NAME_ZH: string = SCHEMA.builtin_provider.name_zh;
export const RESERVED_PROVIDER_IDS: readonly string[] = SCHEMA.reserved_provider_ids;
export const RESERVED_PROVIDER_PREFIXES: readonly string[] = SCHEMA.reserved_provider_prefixes;
export const GENERIC_ENDPOINT_KEYS: readonly string[] = SCHEMA.generic_endpoint_keys;
/** Core keys whose value reaches every provider (non-secret tuning). */
export const TUNING_KEYS: readonly string[] = SCHEMA.tuning_keys;

/** Official catalog ids. Must match Python `OFFICIAL_CATALOG_IDS`. */
export const OFFICIAL_CATALOG_IDS: readonly string[] = ["opensandbox", "cubesandbox", "e2b", "alicloud-container"];

export const PROVIDER_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;

export const KEY_TYPES: readonly KeyType[] = ["str", "url", "int", "float", "bool", "enum", "path", "csv"];
export const ALIAS_KINDS: readonly AliasKind[] = ["compat", "native", "legacy"];
export const ALIAS_SURFACES: readonly AliasSurface[] = ["env", "config", "kwarg", "flag"];

/** Shared keys followed by the CLI-only keys (`cli_config_keys.ts`). */
export const CORE_KEYS: readonly ConfigKey[] = [...SCHEMA.keys.filter((k) => k.scope === "core"), ...CLI_CORE_KEYS];
export const ALICLOUD_EXPRESS_KEYS: readonly ConfigKey[] = [
  ...SCHEMA.keys.filter((k) => k.scope === BUILTIN_PROVIDER_ID),
  ...CLI_BUILTIN_KEYS,
];
export const CORE_KEY_NAMES: readonly string[] = CORE_KEYS.map((k) => k.key);

const BY_KEY = new Map<string, ConfigKey>([...CORE_KEYS, ...ALICLOUD_EXPRESS_KEYS, ...SCHEMA.keys.filter((k) => k.scope !== "core" && k.scope !== BUILTIN_PROVIDER_ID)].map((k) => [`${k.scope}\u0000${k.key}`, k]));

export function getKey(key: string, scope = "core"): ConfigKey | undefined {
  return BY_KEY.get(`${scope}\u0000${key}`);
}

export function builtinKeys(): readonly ConfigKey[] {
  return ALICLOUD_EXPRESS_KEYS;
}

export function providerEnvPrefix(providerId: string): string {
  return "ABX_" + providerId.toUpperCase().replaceAll("-", "_") + "_";
}

export function providerEnvName(providerId: string, key: string): string {
  return providerEnvPrefix(providerId) + key.toUpperCase();
}

/** Return an error message when `providerId` is not a valid third-party id, else `null`. */
export function validateProviderId(providerId: string): string | null {
  if (providerId.length < 2 || providerId.length > 40 || !PROVIDER_ID_RE.test(providerId)) {
    return "provider id must be 2-40 chars of lowercase letters, digits and single hyphens, starting with a letter";
  }
  if (OFFICIAL_CATALOG_IDS.includes(providerId)) return null;
  if (RESERVED_PROVIDER_IDS.includes(providerId) || RESERVED_PROVIDER_PREFIXES.some((p) => providerId.startsWith(p))) {
    return `provider id '${providerId}' is reserved`;
  }
  return null;
}

export function aliasNames(key: ConfigKey, surface: AliasSurface, ...kinds: AliasKind[]): string[] {
  return key.aliases.filter((a) => a.surface === surface && (kinds.length === 0 || kinds.includes(a.kind))).map((a) => a.name);
}

/** Look up a core key by canonical name or by an alias on `surface`. */
export function findKeyByAlias(name: string, surface: AliasSurface): ConfigKey | undefined {
  for (const k of CORE_KEYS) if (k.key === name) return k;
  for (const k of [...CORE_KEYS, ...ALICLOUD_EXPRESS_KEYS]) {
    if (aliasNames(k, surface).includes(name)) return k;
  }
  return undefined;
}

/**
 * Environment names for `key`, most specific first: [provider-scoped override], canonical, compat/native, legacy.
 * `scopedFor` adds the provider-scoped override name for an inherited core key.
 */
export function envNames(key: ConfigKey, opts: { scopedFor?: string | null } = {}): string[] {
  const names: string[] = [];
  if (opts.scopedFor && key.scope === "core") names.push(providerEnvName(opts.scopedFor, key.key));
  names.push(key.env);
  names.push(...key.aliases.filter((a) => a.surface === "env" && (a.kind === "compat" || a.kind === "native")).map((a) => a.name));
  names.push(...key.aliases.filter((a) => a.surface === "env" && a.kind === "legacy").map((a) => a.name));
  return [...new Set(names)];
}

/** Language-neutral schema export of the shared keys (identical to docs/design/fixtures/config-keys.json). */
export function exportSchema(extraProviderKeys: readonly ConfigKey[] = []): ConfigKeysSchema {
  return {
    ...SCHEMA,
    keys: [...SCHEMA.keys, ...extraProviderKeys],
  };
}

/**
 * Canonical configuration-key registry (GENERATED - do not edit).
 *
 * Source of truth: docs/design/fixtures/config-keys.json (exported by the Python SDK with
 * `python -m easy_sandbox.utils.config_keys --json`). Regenerate with `node scripts/gen-config-keys.mjs`;
 * `tests/test_utils/test_config_keys.test.ts` fails when this file drifts from the JSON.
 *
 * The pure layered resolver lives in `./config_resolver.ts`.
 */

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
    "providers",
    "e2b"
  ],
  "reserved_provider_prefixes": [
    "ebx-",
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
      "env": "EBX_PROVIDER",
      "aliases": [],
      "env_names": [
        "EBX_PROVIDER"
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
      "description": "Default provider id (see 'ebx provider list')"
    },
    {
      "key": "sandbox_api_key",
      "scope": "core",
      "type": "str",
      "secret": true,
      "credential": true,
      "settable": true,
      "env": "EBX_SANDBOX_API_KEY",
      "aliases": [],
      "env_names": [
        "EBX_SANDBOX_API_KEY"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "env",
        "name": "EBX_SANDBOX_API_KEY"
      },
      "storage_phase2": {
        "file": "env",
        "name": "EBX_SANDBOX_API_KEY"
      },
      "default": null,
      "choices": [],
      "group": "Sandbox authentication",
      "description": "Sandbox API key (any E2B-protocol endpoint)"
    },
    {
      "key": "sandbox_base_url",
      "scope": "core",
      "type": "url",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "EBX_SANDBOX_BASE_URL",
      "aliases": [],
      "env_names": [
        "EBX_SANDBOX_BASE_URL"
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
      "description": "Platform API URL, any E2B-protocol endpoint"
    },
    {
      "key": "sandbox_domain",
      "scope": "core",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "EBX_SANDBOX_DOMAIN",
      "aliases": [],
      "env_names": [
        "EBX_SANDBOX_DOMAIN"
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
      "env": "EBX_HTTP_TIMEOUT",
      "aliases": [],
      "env_names": [
        "EBX_HTTP_TIMEOUT"
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
      "env": "EBX_HTTP2",
      "aliases": [],
      "env_names": [
        "EBX_HTTP2"
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
      "env": "EBX_MAX_RETRIES",
      "aliases": [],
      "env_names": [
        "EBX_MAX_RETRIES"
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
      "env": "EBX_MAX_CONNECTIONS",
      "aliases": [],
      "env_names": [
        "EBX_MAX_CONNECTIONS"
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
      "env": "EBX_MAX_KEEPALIVE_CONNECTIONS",
      "aliases": [],
      "env_names": [
        "EBX_MAX_KEEPALIVE_CONNECTIONS"
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
      "env": "EBX_KEEPALIVE_EXPIRY",
      "aliases": [],
      "env_names": [
        "EBX_KEEPALIVE_EXPIRY"
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
      "env": "EBX_WS_PING_INTERVAL",
      "aliases": [],
      "env_names": [
        "EBX_WS_PING_INTERVAL"
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
      "env": "EBX_RETRY_BASE_DELAY",
      "aliases": [],
      "env_names": [
        "EBX_RETRY_BASE_DELAY"
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
      "env": "EBX_LOG_LEVEL",
      "aliases": [],
      "env_names": [
        "EBX_LOG_LEVEL"
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
      "env": "EBX_DEFAULT_TEMPLATE",
      "aliases": [],
      "env_names": [
        "EBX_DEFAULT_TEMPLATE"
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
      "key": "llm_api_key",
      "scope": "core",
      "type": "str",
      "secret": true,
      "credential": false,
      "settable": true,
      "env": "EBX_LLM_API_KEY",
      "aliases": [],
      "env_names": [
        "EBX_LLM_API_KEY"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "env",
        "name": "EBX_LLM_API_KEY"
      },
      "storage_phase2": {
        "file": "env",
        "name": "EBX_LLM_API_KEY"
      },
      "default": null,
      "choices": [],
      "group": "LLM",
      "description": "LLM API key for AI codegen"
    },
    {
      "key": "llm_base_url",
      "scope": "core",
      "type": "url",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "EBX_LLM_BASE_URL",
      "aliases": [],
      "env_names": [
        "EBX_LLM_BASE_URL"
      ],
      "toml_section": "transport",
      "storage_phase1": {
        "file": "toml",
        "name": "llm_base_url",
        "section": "transport"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "llm_base_url",
        "section": "transport"
      },
      "default": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "choices": [],
      "group": "LLM",
      "description": "LLM endpoint (OpenAI-compatible)"
    },
    {
      "key": "llm_model",
      "scope": "core",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "EBX_LLM_MODEL",
      "aliases": [],
      "env_names": [
        "EBX_LLM_MODEL"
      ],
      "toml_section": "transport",
      "storage_phase1": {
        "file": "toml",
        "name": "llm_model",
        "section": "transport"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "llm_model",
        "section": "transport"
      },
      "default": "qwen3-coder-plus",
      "choices": [],
      "group": "LLM",
      "description": "LLM model name"
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
      "env": "EBX_TEMPLATE_INDEX_URL",
      "aliases": [],
      "env_names": [
        "EBX_TEMPLATE_INDEX_URL"
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
      "env": "EBX_TEMPLATE_DIR",
      "aliases": [],
      "env_names": [
        "EBX_TEMPLATE_DIR"
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
      "env": "EBX_MCP_AUTH_TOKEN",
      "aliases": [],
      "env_names": [
        "EBX_MCP_AUTH_TOKEN"
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
      "env": "EBX_MCP_ALLOWED_ORIGINS",
      "aliases": [],
      "env_names": [
        "EBX_MCP_ALLOWED_ORIGINS"
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
      "env": "EBX_MCP_RUNTIME_DIR",
      "aliases": [],
      "env_names": [
        "EBX_MCP_RUNTIME_DIR"
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
    },
    {
      "key": "acr_namespace",
      "scope": "alicloud-express",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ACR_NAMESPACE",
      "aliases": [],
      "env_names": [
        "ACR_NAMESPACE"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "env",
        "name": "ACR_NAMESPACE"
      },
      "storage_phase2": {
        "file": "env",
        "name": "ACR_NAMESPACE"
      },
      "default": null,
      "choices": [],
      "group": "Alibaba Cloud credentials",
      "description": "ACR namespace"
    },
    {
      "key": "acr_registry",
      "scope": "alicloud-express",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ACR_REGISTRY",
      "aliases": [],
      "env_names": [
        "ACR_REGISTRY"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "toml",
        "name": "acr_registry",
        "section": "providers.alicloud-express"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "acr_registry",
        "section": "providers.alicloud-express"
      },
      "default": null,
      "choices": [],
      "group": "Alibaba Cloud registry (ACR)",
      "description": "ACR registry host"
    },
    {
      "key": "acr_repo",
      "scope": "alicloud-express",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ACR_REPO",
      "aliases": [],
      "env_names": [
        "ACR_REPO"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "toml",
        "name": "acr_repo",
        "section": "providers.alicloud-express"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "acr_repo",
        "section": "providers.alicloud-express"
      },
      "default": null,
      "choices": [],
      "group": "Alibaba Cloud registry (ACR)",
      "description": "ACR repository"
    },
    {
      "key": "acr_username",
      "scope": "alicloud-express",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ACR_USERNAME",
      "aliases": [],
      "env_names": [
        "ACR_USERNAME"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "toml",
        "name": "acr_username",
        "section": "providers.alicloud-express"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "acr_username",
        "section": "providers.alicloud-express"
      },
      "default": null,
      "choices": [],
      "group": "Alibaba Cloud registry (ACR)",
      "description": "ACR username"
    },
    {
      "key": "acr_password",
      "scope": "alicloud-express",
      "type": "str",
      "secret": true,
      "credential": false,
      "settable": true,
      "env": "ACR_PASSWORD",
      "aliases": [],
      "env_names": [
        "ACR_PASSWORD"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "env",
        "name": "ACR_PASSWORD"
      },
      "storage_phase2": {
        "file": "env",
        "name": "ACR_PASSWORD"
      },
      "default": null,
      "choices": [],
      "group": "Alibaba Cloud registry (ACR)",
      "description": "ACR password"
    },
    {
      "key": "acr_instance_id",
      "scope": "alicloud-express",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ACREE_INSTANCE_ID",
      "aliases": [],
      "env_names": [
        "ACREE_INSTANCE_ID"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "toml",
        "name": "acr_instance_id",
        "section": "providers.alicloud-express"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "acr_instance_id",
        "section": "providers.alicloud-express"
      },
      "default": null,
      "choices": [],
      "group": "Alibaba Cloud registry (ACR)",
      "description": "ACR Enterprise instance id"
    },
    {
      "key": "acr_vpc_id",
      "scope": "alicloud-express",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ACR_VPC_ID",
      "aliases": [],
      "env_names": [
        "ACR_VPC_ID"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "toml",
        "name": "acr_vpc_id",
        "section": "providers.alicloud-express"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "acr_vpc_id",
        "section": "providers.alicloud-express"
      },
      "default": null,
      "choices": [],
      "group": "Alibaba Cloud registry (ACR)",
      "description": "ACR VPC id"
    },
    {
      "key": "acr_vswitch_ids",
      "scope": "alicloud-express",
      "type": "csv",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ACR_VSWITCH_IDS",
      "aliases": [],
      "env_names": [
        "ACR_VSWITCH_IDS"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "toml",
        "name": "acr_vswitch_ids",
        "section": "providers.alicloud-express"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "acr_vswitch_ids",
        "section": "providers.alicloud-express"
      },
      "default": null,
      "choices": [],
      "group": "Alibaba Cloud registry (ACR)",
      "description": "ACR vSwitch ids (comma-separated)"
    },
    {
      "key": "acr_security_group_id",
      "scope": "alicloud-express",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "ACR_SECURITY_GROUP_ID",
      "aliases": [],
      "env_names": [
        "ACR_SECURITY_GROUP_ID"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "toml",
        "name": "acr_security_group_id",
        "section": "providers.alicloud-express"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "acr_security_group_id",
        "section": "providers.alicloud-express"
      },
      "default": null,
      "choices": [],
      "group": "Alibaba Cloud registry (ACR)",
      "description": "ACR security group id"
    },
    {
      "key": "team_id",
      "scope": "alicloud-express",
      "type": "str",
      "secret": false,
      "credential": false,
      "settable": true,
      "env": "EBX_ALICLOUD_EXPRESS_TEAM_ID",
      "aliases": [],
      "env_names": [
        "EBX_ALICLOUD_EXPRESS_TEAM_ID"
      ],
      "toml_section": null,
      "storage_phase1": {
        "file": "toml",
        "name": "team_id",
        "section": "providers.alicloud-express"
      },
      "storage_phase2": {
        "file": "toml",
        "name": "team_id",
        "section": "providers.alicloud-express"
      },
      "default": null,
      "choices": [],
      "group": "Alibaba Cloud registry (ACR)",
      "description": "Team id"
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

export const PROVIDER_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;

export const KEY_TYPES: readonly KeyType[] = ["str", "url", "int", "float", "bool", "enum", "path", "csv"];
export const ALIAS_KINDS: readonly AliasKind[] = ["compat", "native", "legacy"];
export const ALIAS_SURFACES: readonly AliasSurface[] = ["env", "config", "kwarg", "flag"];

export const CORE_KEYS: readonly ConfigKey[] = SCHEMA.keys.filter((k) => k.scope === "core");
export const ALICLOUD_EXPRESS_KEYS: readonly ConfigKey[] = SCHEMA.keys.filter((k) => k.scope === BUILTIN_PROVIDER_ID);
export const CORE_KEY_NAMES: readonly string[] = CORE_KEYS.map((k) => k.key);

const BY_KEY = new Map<string, ConfigKey>(SCHEMA.keys.map((k) => [`${k.scope}\u0000${k.key}`, k]));

export function getKey(key: string, scope = "core"): ConfigKey | undefined {
  return BY_KEY.get(`${scope}\u0000${key}`);
}

export function builtinKeys(): readonly ConfigKey[] {
  return ALICLOUD_EXPRESS_KEYS;
}

export function providerEnvPrefix(providerId: string): string {
  return "EBX_" + providerId.toUpperCase().replaceAll("-", "_") + "_";
}

export function providerEnvName(providerId: string, key: string): string {
  return providerEnvPrefix(providerId) + key.toUpperCase();
}

/** Return an error message when `providerId` is not a valid third-party id, else `null`. */
export function validateProviderId(providerId: string): string | null {
  if (providerId.length < 2 || providerId.length > 40 || !PROVIDER_ID_RE.test(providerId)) {
    return "provider id must be 2-40 chars of lowercase letters, digits and single hyphens, starting with a letter";
  }
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

/** Language-neutral schema export (identical to docs/design/fixtures/config-keys.json). */
export function exportSchema(extraProviderKeys: readonly ConfigKey[] = []): ConfigKeysSchema {
  return {
    ...SCHEMA,
    keys: [...SCHEMA.keys, ...extraProviderKeys],
  };
}

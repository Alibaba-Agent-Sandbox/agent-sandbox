/**
 * Sandbox-related data models (port of `models/sandbox.py`).
 *
 * 字段命名与 camelCase alias 已根据真实 API 实测验证。
 */

import {
  BaseModel,
  type ModelInput,
  any,
  bool,
  datetime,
  dict,
  enumOf,
  field,
  int,
  optional,
  str,
  union,
  type PyDatetime,
} from "./_pydantic.js";

/** Sandbox lifecycle status. */
export const SandboxStatus = {
  CREATING: "creating", // SDK 自定义过渡态
  RUNNING: "running", // 已实测验证
  PAUSED: "paused",
  STOPPING: "stopping", // SDK 自定义过渡态
  STOPPED: "stopped",
  ERROR: "error",
} as const;
export type SandboxStatus = (typeof SandboxStatus)[keyof typeof SandboxStatus];

/**
 * Configuration for creating a sandbox.
 *
 * 请求体字段使用 camelCase（已实测验证）:
 * templateID, timeout, autoPause, metadata, envVars
 */
export class SandboxConfig extends BaseModel {
  static override modelConfig = { populate_by_name: true };
  static override modelFields = {
    template: field(str(), { alias: "templateID", default: "base" }),
    timeout: field(int({ ge: 1, le: 86400 }), { default: 300 }), // Sandbox timeout in seconds
    auto_pause: field(bool(), { alias: "autoPause", default: false }), // 是否自动暂停
    metadata: field(dict(str(), str()), { default_factory: () => ({}) }),
    env_vars: field(dict(str(), str()), { alias: "envVars", default_factory: () => ({}) }), // 环境变量键值对（已实测验证）

    // Resource configuration (optional — only sent when explicitly set)
    cpu: field(optional(int()), { default: null }), // CPU 核数
    memory: field(optional(int()), { default: null }), // 内存大小 (MB)
    disk: field(optional(int()), { default: null }), // 磁盘大小 (MB)
    gpu: field(optional(str()), { default: null }), // GPU 规格，如 'A10'

    // Provider-layer hints; never in the built-in create payload (toCreatePayload is explicit)
    secure: field(optional(bool()), { default: null, exclude: true }), // User-requested secure mode; null = not specified
    provider_options: field(dict(str(), any()), { default_factory: () => ({}), exclude: true }), // Per-create provider options forwarded to plugin providers as 'options'
  };

  declare template: string;
  declare timeout: number;
  declare auto_pause: boolean;
  declare metadata: Record<string, string>;
  declare env_vars: Record<string, string>;
  declare cpu: number | null;
  declare memory: number | null;
  declare disk: number | null;
  declare gpu: string | null;
  declare secure: boolean | null;
  declare provider_options: Record<string, unknown>;

  constructor(data: ModelInput = {}) {
    super(data);
  }

  /** Build the camelCase request payload for sandbox creation（已实测验证）. (`to_create_payload`) */
  toCreatePayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      templateID: this.template,
      timeout: this.timeout,
      autoPause: this.auto_pause,
      metadata: this.metadata,
      envVars: this.env_vars,
    };
    if (this.cpu !== null) payload["cpuCount"] = this.cpu;
    if (this.memory !== null) payload["memoryMB"] = this.memory;
    if (this.disk !== null) payload["diskSizeMB"] = this.disk;
    if (this.gpu !== null) payload["gpu"] = this.gpu;
    return payload;
  }
}

/**
 * Information about an existing sandbox.
 *
 * 响应字段使用 camelCase（已实测验证）:
 * sandboxID, templateID, envdAccessToken, envdVersion, clientID, etc.
 */
export class SandboxInfo extends BaseModel {
  static override modelConfig = { populate_by_name: true };
  static override modelFields = {
    sandbox_id: field(str(), { alias: "sandboxID" }),
    template: field(str(), { alias: "templateID", default: "" }),
    alias_name: field(optional(str()), { alias: "alias", default: null }),
    status: field(enumOf(SandboxStatus), { alias: "state", default: SandboxStatus.RUNNING }),

    // 认证与版本信息（已实测验证）
    envd_access_token: field(optional(str()), { alias: "envdAccessToken", default: null }),
    envd_version: field(optional(str()), { alias: "envdVersion", default: null }),
    client_id: field(optional(str()), { alias: "clientID", default: null }),
    account_id: field(optional(str()), { alias: "accountID", default: null }),
    user_id: field(optional(str()), { alias: "userID", default: null }),

    // 时间与资源信息（get_info 额外字段，已实测验证）
    started_at: field(optional(datetime()), { alias: "startedAt", default: null }),
    end_at: field(optional(datetime()), { alias: "endAt", default: null }),
    cpu_count: field(optional(int()), { alias: "cpuCount", default: null }),
    memory_mb: field(optional(int()), { alias: "memoryMB", default: null }),
    disk_size_mb: field(optional(int()), { alias: "diskSizeMB", default: null }),
    lifecycle: field(optional(union([["dict[str,any]", dict(str(), any())], ["str", str()]])), { default: null }),

    // 通用字段
    metadata: field(dict(str(), str()), { default_factory: () => ({}) }),
    timeout: field(int(), { default: 300 }),
    region: field(str(), { default: "cn-hangzhou" }),
    envd_url: field(optional(str()), { alias: "envdUrl", default: null }),
  };

  declare sandbox_id: string;
  declare template: string;
  declare alias_name: string | null;
  declare status: SandboxStatus;
  declare envd_access_token: string | null;
  declare envd_version: string | null;
  declare client_id: string | null;
  declare account_id: string | null;
  declare user_id: string | null;
  declare started_at: PyDatetime | null;
  declare end_at: PyDatetime | null;
  declare cpu_count: number | null;
  declare memory_mb: number | null;
  declare disk_size_mb: number | null;
  declare lifecycle: Record<string, unknown> | string | null;
  declare metadata: Record<string, string>;
  declare timeout: number;
  declare region: string;
  declare envd_url: string | null;

  constructor(data: ModelInput = {}) {
    super(data);
  }
}

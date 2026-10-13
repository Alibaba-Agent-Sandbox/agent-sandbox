/**
 * Sandbox-related data models.
 *
 * 字段命名与 camelCase alias 已根据真实 API 实测验证。
 */

import { z } from "zod";

import { defineModel, lax } from "./base.js";

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
export class SandboxConfig extends defineModel(
  z.object({
    template: z.string().default("base"),
    timeout: lax.int(1, 86400).default(300), // Sandbox timeout in seconds
    auto_pause: lax.bool().default(false), // 是否自动暂停
    metadata: lax.stringMap().default(() => ({})),
    env_vars: lax.stringMap().default(() => ({})), // 环境变量键值对（已实测验证）

    // Resource configuration (optional — only sent when explicitly set)
    cpu: lax.int().nullable().default(null), // CPU 核数
    memory: lax.int().nullable().default(null), // 内存大小 (MB)
    disk: lax.int().nullable().default(null), // 磁盘大小 (MB)
    gpu: z.string().nullable().default(null), // GPU 规格，如 'A10'

    // Provider-layer hints; never in the built-in create payload (toCreatePayload is explicit)
    secure: lax.bool().nullable().default(null), // User-requested secure mode; null = not specified
    provider_options: z.record(z.string(), z.unknown()).default(() => ({})), // Per-create provider options forwarded to plugin providers as 'options'
  }),
  {
    aliases: { template: "templateID", auto_pause: "autoPause", env_vars: "envVars" },
    internal: ["secure", "provider_options"],
  },
) {
  /** Build the camelCase request payload for sandbox creation（已实测验证）. */
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
export class SandboxInfo extends defineModel(
  z.object({
    sandbox_id: z.string(),
    template: z.string().default(""),
    alias_name: z.string().nullable().default(null),
    status: z.enum(SandboxStatus).default(SandboxStatus.RUNNING),

    // 认证与版本信息（已实测验证）
    envd_access_token: z.string().nullable().default(null),
    envd_version: z.string().nullable().default(null),
    client_id: z.string().nullable().default(null),
    account_id: z.string().nullable().default(null),
    user_id: z.string().nullable().default(null),

    // 时间与资源信息（get_info 额外字段，已实测验证）
    started_at: lax.date().nullable().default(null),
    end_at: lax.date().nullable().default(null),
    cpu_count: lax.int().nullable().default(null),
    memory_mb: lax.int().nullable().default(null),
    disk_size_mb: lax.int().nullable().default(null),
    lifecycle: z.union([z.record(z.string(), z.unknown()), z.string()]).nullable().default(null),

    // 通用字段
    metadata: lax.stringMap().default(() => ({})),
    timeout: lax.int().default(300),
    region: z.string().default("cn-hangzhou"),
    envd_url: z.string().nullable().default(null),
  }),
  {
    aliases: {
      sandbox_id: "sandboxID",
      template: "templateID",
      alias_name: "alias",
      status: "state",
      envd_access_token: "envdAccessToken",
      envd_version: "envdVersion",
      client_id: "clientID",
      account_id: "accountID",
      user_id: "userID",
      started_at: "startedAt",
      end_at: "endAt",
      cpu_count: "cpuCount",
      memory_mb: "memoryMB",
      disk_size_mb: "diskSizeMB",
      envd_url: "envdUrl",
    },
  },
) {}

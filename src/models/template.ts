/**
 * Template-related data models.
 *
 * 模板管理 API 响应字段使用 camelCase（已实测验证 POST /templates 返回 templateID, buildID）。
 */

import { validateTemplateManifest } from "../template/launch_plan.mjs";
import { z } from "zod";

import { defineModel, lax } from "./base.js";

// ---------------------------------------------------------------------------
// Standard capability vocabulary
// ---------------------------------------------------------------------------

/** All recognised capability tokens. Extensible in future phases. */
export const STANDARD_CAPABILITIES: ReadonlySet<string> = new Set(["shell", "files", "code", "terminal", "ports"]);

/** Template build lifecycle status. */
export const BuildStatus = {
  BUILDING: "building",
  READY: "ready",
  ERROR: "error",
} as const;
export type BuildStatus = (typeof BuildStatus)[keyof typeof BuildStatus];

/** API may return aliases as a string, list, or None. */
function coerceAliases(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.map((item) => String(item));
  return [String(v)];
}

/**
 * Information about a template.
 *
 * API 响应字段使用 camelCase: templateID, buildID, aliases, public, cpuCount, memoryMB, etc.
 */
export class TemplateInfo extends defineModel(
  z.object({
    template_id: z.string(),
    build_id: z.string().nullable().default(null),
    aliases: z.preprocess(coerceAliases, z.array(z.string())).default(() => []),
    public: lax.bool().default(false),
    cpu_count: lax.int().nullable().default(null),
    memory_mb: lax.int().nullable().default(null),
    disk_size_mb: lax.int().nullable().default(null),
    start_cmd: z.string().nullable().default(null),
    build_status: z.enum(BuildStatus).default(BuildStatus.BUILDING),
    created_at: lax.date().nullable().default(null),
    updated_at: lax.date().nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default(() => ({})),
  }),
  {
    aliases: {
      template_id: "templateID",
      build_id: "buildID",
      cpu_count: "cpuCount",
      memory_mb: "memoryMB",
      disk_size_mb: "diskSizeMB",
      start_cmd: "startCmd",
      created_at: "createdAt",
      updated_at: "updatedAt",
    },
  },
) {}

/**
 * Information about a template build.
 *
 * GET /templates/{id}/builds/{buildId}/status 响应体。
 */
export class BuildInfo extends defineModel(
  z.object({
    build_id: z.string(),
    template_id: z.string().default(""),
    status: z.enum(BuildStatus).default(BuildStatus.BUILDING),
    logs: z.array(z.string()).default(() => []),
    finished_at: lax.date().nullable().default(null),
    error: z.string().nullable().default(null),
  }),
  { aliases: { build_id: "buildID", template_id: "templateID", finished_at: "finishedAt" } },
) {}

// ---- Template model (used by utils/registry.ts, api/capability.ts) ----

/**
 * template.yaml 的数据模型。
 *
 * 构建相关字段（base, system_packages, python_packages, node_packages, commands, copy_files）已移除——实际构建流程直接使用
 * Dockerfile + 语言原生依赖文件（requirements.txt / package.json）。未知字段被忽略。
 */
export class SandboxTemplate extends defineModel(
  z.object({
    name: z.string(),
    version: z.string().default("1.0.0"),
    description: z.string().default(""),

    // 环境变量
    env: lax.stringMap().default(() => ({})),

    // 资源规格（可选）
    cpu_count: lax.int().nullable().default(null),
    memory_mb: lax.int().nullable().default(null),

    // 端口列表
    ports: z.array(lax.int()).default(() => []),

    // 元信息
    author: z.string().default(""),
    license: z.string().default(""),
    tags: z.array(z.string()).default(() => []),

    spec_version: z.literal(5),
    provides: z.record(z.string(), z.unknown()),
    workflow_contract_version: z.never().optional(),
    default_workflow: z.never().optional(),
    workflows: z.never().optional(),
    image: z.string().optional(),
    provider: z.string().optional(),
    template_id: z.string().optional(),
    start_cmd: z.string().optional(),
    ready_cmd: z.string().optional(),
    capabilities: z.never().optional(),
    tested_on: z.never().optional(),
    providers: z.never().optional(),
  }).superRefine((value, ctx) => {
    try { validateTemplateManifest(value); } catch (error) { ctx.addIssue({code: "custom",message: String(error)}); }
  }),
) {}

/** 模板引用解析结果（向后兼容）。 */
export class TemplateRef extends defineModel(
  z.object({
    owner: z.string().nullable().default(null),
    repo: z.string().nullable().default(null),
    tag: z.string().nullable().default(null),
    path: z.string().nullable().default(null), // 仓库内子目录路径
    is_builtin: lax.bool().default(false),
    registry_url: z.string().default("https://github.com"),
    registry_type: z.string().default("github"), // "github" | "local"
    local_path: z.string().nullable().default(null), // 本地目录绝对路径
  }),
) {}

export const __all__ = [
  "STANDARD_CAPABILITIES",
  "BuildStatus",
  "TemplateInfo",
  "BuildInfo",
  "SandboxTemplate",
  "TemplateRef",
] as const;

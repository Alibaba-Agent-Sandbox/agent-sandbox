/**
 * Template-related data models (port of `models/template.py`).
 *
 * 模板管理 API 响应字段使用 camelCase（已实测验证 POST /templates 返回 templateID, buildID）。
 */

import { pyRepr, pySorted, pyStr } from "../utils/_pyformat.js";
import {
  BaseModel,
  ValueError,
  type ModelInput,
  any,
  bool,
  datetime,
  dict,
  enumOf,
  field,
  int,
  list,
  modelOf,
  optional,
  str,
  withValidators,
  type PyDatetime,
} from "./_pydantic.js";

// ---------------------------------------------------------------------------
// Standard capability vocabulary
// ---------------------------------------------------------------------------

/** All recognised capability tokens. Extensible in future phases. */
export const STANDARD_CAPABILITIES: ReadonlySet<string> = new Set(["shell", "files", "code", "terminal", "ports"]);

/**
 * System default baseline — applied when a template declares no capabilities.
 *
 * `terminal` and `ports` must be declared explicitly by the template.
 */
export const DEFAULT_CAPABILITIES: ReadonlySet<string> = new Set(["shell", "files", "code"]);

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
  if (Array.isArray(v)) return v.map((item) => pyStr(item));
  return [pyStr(v)];
}

/**
 * Information about a template.
 *
 * API 响应字段使用 camelCase: templateID, buildID, aliases, public, cpuCount, memoryMB, etc.
 */
export class TemplateInfo extends BaseModel {
  static override modelConfig = { populate_by_name: true };
  static override modelFields = {
    template_id: field(str(), { alias: "templateID" }),
    build_id: field(optional(str()), { alias: "buildID", default: null }),
    aliases: field(withValidators(list(str()), { before: coerceAliases }), {
      alias: "aliases",
      default_factory: () => [],
    }),
    public: field(bool(), { default: false }),
    cpu_count: field(optional(int()), { alias: "cpuCount", default: null }),
    memory_mb: field(optional(int()), { alias: "memoryMB", default: null }),
    disk_size_mb: field(optional(int()), { alias: "diskSizeMB", default: null }),
    start_cmd: field(optional(str()), { alias: "startCmd", default: null }),
    build_status: field(enumOf(BuildStatus), { default: BuildStatus.BUILDING }),
    created_at: field(optional(datetime()), { alias: "createdAt", default: null }),
    updated_at: field(optional(datetime()), { alias: "updatedAt", default: null }),
    metadata: field(dict(str(), any()), { default_factory: () => ({}) }),
  };

  declare template_id: string;
  declare build_id: string | null;
  declare aliases: string[];
  declare public: boolean;
  declare cpu_count: number | null;
  declare memory_mb: number | null;
  declare disk_size_mb: number | null;
  declare start_cmd: string | null;
  declare build_status: BuildStatus;
  declare created_at: PyDatetime | null;
  declare updated_at: PyDatetime | null;
  declare metadata: Record<string, unknown>;

  constructor(data: ModelInput = {}) {
    super(data);
  }
}

/**
 * Information about a template build.
 *
 * GET /templates/{id}/builds/{buildId}/status 响应体。
 */
export class BuildInfo extends BaseModel {
  static override modelConfig = { populate_by_name: true };
  static override modelFields = {
    build_id: field(str(), { alias: "buildID" }),
    template_id: field(str(), { alias: "templateID", default: "" }),
    status: field(enumOf(BuildStatus), { default: BuildStatus.BUILDING }),
    logs: field(list(str()), { default_factory: () => [] }),
    finished_at: field(optional(datetime()), { alias: "finishedAt", default: null }),
    error: field(optional(str()), { default: null }),
  };

  declare build_id: string;
  declare template_id: string;
  declare status: BuildStatus;
  declare logs: string[];
  declare finished_at: PyDatetime | null;
  declare error: string | null;

  constructor(data: ModelInput = {}) {
    super(data);
  }
}

// ---- Custom command models ----

/** Allowed values for `CustomCommandArg.type`. */
export const _VALID_ARG_TYPES: ReadonlySet<string> = new Set(["string", "integer", "float", "boolean"]);

/** A single argument for a custom command. */
export class CustomCommandArg extends BaseModel {
  static override modelFields = {
    name: field(str()),
    default: field(optional(str()), { default: null }),
    required: field(bool(), { default: false }),
    description: field(str(), { default: "" }),
    /** Scalar type hint: `string` | `integer` | `float` | `boolean`. */
    type: field(
      withValidators(str(), {
        after(v) {
          if (!_VALID_ARG_TYPES.has(v as string)) {
            throw new ValueError(`Invalid arg type ${pyRepr(v)}; allowed: ${pyRepr(pySorted(_VALID_ARG_TYPES))}`);
          }
          return v;
        },
      }),
      { default: "string" },
    ),
  };

  declare name: string;
  declare default: string | null;
  declare required: boolean;
  declare description: string;
  declare type: string;

  constructor(data: ModelInput = {}) {
    super(data);
  }
}

/**
 * A named command exposed by a template.
 *
 * `cmd` supports `{placeholder}` tokens that are filled at runtime from the matching `CustomCommandArg` entries.
 */
export class CustomCommand extends BaseModel {
  static override modelFields = {
    cmd: field(str()),
    description: field(str(), { default: "" }),
    cwd: field(str(), { default: "/app" }),
    env: field(dict(str(), str()), { default_factory: () => ({}) }),
    timeout: field(int(), { default: 60 }),
    args: field(list(modelOf(() => CustomCommandArg)), { default_factory: () => [] }),
  };

  declare cmd: string;
  declare description: string;
  declare cwd: string;
  declare env: Record<string, string>;
  declare timeout: number;
  declare args: CustomCommandArg[];

  constructor(data: ModelInput = {}) {
    super(data);
  }
}

// ---- Template model (used by utils/registry.py, api/capability.py) ----

/**
 * template.yaml 的 Pydantic 模型。
 *
 * 构建相关字段（base, system_packages, python_packages, node_packages, commands, copy_files）已移除——实际构建流程直接使用
 * Dockerfile + 语言原生依赖文件（requirements.txt / package.json）。
 */
export class SandboxTemplate extends BaseModel {
  static override modelConfig = { extra: "ignore" as const };
  static override modelFields = {
    name: field(str()),
    version: field(str(), { default: "1.0.0" }),
    description: field(str(), { default: "" }),

    // 环境变量
    env: field(dict(str(), str()), { default_factory: () => ({}) }),

    // 资源规格（可选）
    cpu_count: field(optional(int()), { default: null }),
    memory_mb: field(optional(int()), { default: null }),

    // 端口列表
    ports: field(list(int()), { default_factory: () => [] }),

    // 元信息
    author: field(str(), { default: "" }),
    license: field(str(), { default: "" }),
    tags: field(list(str()), { default_factory: () => [] }),

    // ---- Capability model (Phase 1) ----
    /**
     * Runtime capabilities. `null` (Python `None`) → inherit `DEFAULT_CAPABILITIES`; an explicit list overrides the
     * default (may be a subset or include `terminal` / `ports`).
     */
    capabilities: field(
      withValidators(optional(list(str())), {
        after(v) {
          if (v !== null) {
            for (const cap of v as string[]) {
              if (!STANDARD_CAPABILITIES.has(cap)) {
                throw new ValueError(
                  `Unknown capability ${pyRepr(cap)}; allowed: ${pyRepr(pySorted(STANDARD_CAPABILITIES))}`,
                );
              }
            }
          }
          return v;
        },
      }),
      { default: null },
    ),

    /** Named commands exposed by this template. */
    custom_commands: field(dict(str(), modelOf(() => CustomCommand)), { default_factory: () => ({}) }),
  };

  declare name: string;
  declare version: string;
  declare description: string;
  declare env: Record<string, string>;
  declare cpu_count: number | null;
  declare memory_mb: number | null;
  declare ports: number[];
  declare author: string;
  declare license: string;
  declare tags: string[];
  declare capabilities: string[] | null;
  declare custom_commands: Record<string, CustomCommand>;

  constructor(data: ModelInput = {}) {
    super(data);
  }
}

/** 模板引用解析结果（向后兼容）。 */
export class TemplateRef extends BaseModel {
  static override modelFields = {
    owner: field(optional(str()), { default: null }),
    repo: field(optional(str()), { default: null }),
    tag: field(optional(str()), { default: null }),
    path: field(optional(str()), { default: null }), // 仓库内子目录路径
    is_builtin: field(bool(), { default: false }),
    registry_url: field(str(), { default: "https://github.com" }),
    registry_type: field(str(), { default: "github" }), // "github" | "local"
    local_path: field(optional(str()), { default: null }), // 本地目录绝对路径
  };

  declare owner: string | null;
  declare repo: string | null;
  declare tag: string | null;
  declare path: string | null;
  declare is_builtin: boolean;
  declare registry_url: string;
  declare registry_type: string;
  declare local_path: string | null;

  constructor(data: ModelInput = {}) {
    super(data);
  }
}

export const __all__ = [
  "STANDARD_CAPABILITIES",
  "DEFAULT_CAPABILITIES",
  "BuildStatus",
  "TemplateInfo",
  "BuildInfo",
  "SandboxTemplate",
  "TemplateRef",
  "CustomCommandArg",
  "CustomCommand",
  "_VALID_ARG_TYPES",
] as const;

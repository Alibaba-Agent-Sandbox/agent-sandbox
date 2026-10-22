import { BorrowedSandboxError } from "./lifecycle_errors.js";
import { ValidationError } from "../models/base.js";
import { AuthenticationError, SandboxError, SandboxNotFoundError, QuotaExceededError, TemplateNotFoundError } from "../models/errors.js";
import { ProviderFeatureNotSupportedError, ProviderResourceNotFoundError } from "../models/provider_errors.js";
import { HTTPStatusError, TimeoutException, RequestError } from "../transport/http.js";
/**
 * MCP tool definitions: seven compatible core tools and fourteen workflow operations.
 *
 * 每个 Tool 包含：
 * - TOOL_SCHEMA: MCP Tool schema（name, description, inputSchema）
 * - handler 异步函数：接收参数 + sandbox manager，返回 dict 结果
 *
 * Port of `agent_sandbox/agent/tools.py`.
 */

import { z } from "zod";
import { templateSchemas, handleTemplateOperation } from "./template_operations.js";
import { OPERATION_SCHEMAS, operationInputs, handleOperation } from "./operations.js";
import { pyExcStr } from "../utils/_pyerrors.js";
import { ExcInfo, getLogger } from "../utils/logging.js";
import { KeyError, ValueError, isDict, pyStrip, pyTruthy, pyTypeName, type JsonObject } from "./_py.js";
import type { SandboxManager } from "./mcp.js";

const logger = getLogger("agent.tools");

// ---------------------------------------------------------------------------
// Tool schemas (MCP format)
// ---------------------------------------------------------------------------

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

const CORE_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "create_sandbox",
    description:
      "创建一个云端沙箱，并将其设为当前会话的默认沙箱。" +
      "之后省略 sandbox_id 的工具调用都作用在这只沙箱上。" +
      "省略 template 时使用 MCP server 配置的模板" +
      "（abx mcp start 默认为 code-interpreter-v1）。",
    inputSchema: {
      type: "object",
      properties: {
        template: {
          type: "string",
          description: "沙箱模板名称，省略时使用 server 配置的模板",
        },
        timeout: {
          type: "integer",
          description: "沙箱超时时间（秒），默认 300",
          default: 300,
        },
        envs: {
          type: "object",
          description: "环境变量键值对",
          additionalProperties: { type: "string" },
        },
      },
    },
  },
  {
    name: "run_code",
    description:
      "在沙箱中执行代码（通过 Code Interpreter）。" +
      "支持 Python、JavaScript 等语言。省略 sandbox_id 时使用默认沙箱。",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "要执行的代码" },
        language: {
          type: "string",
          description: "编程语言，默认 python",
          default: "python",
          enum: ["python", "javascript", "shell", "typescript", "r"],
        },
        sandbox_id: {
          type: "string",
          description: "沙箱 ID，省略时使用默认沙箱",
        },
        timeout: {
          type: "integer",
          description: "执行超时（秒），默认 30",
          default: 30,
        },
      },
      required: ["code"],
    },
  },
  {
    name: "run_command",
    description:
      "在沙箱中通过 sh -c 执行命令，因此支持管道、&&、$VAR 和 cd。" +
      "省略 sandbox_id 时使用默认沙箱。" +
      "省略 cwd 时使用镜像自己的工作目录。" +
      "timeout 是本次调用等待的秒数；非零退出码会标成工具错误。",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "交给 sh -c 的命令" },
        sandbox_id: { type: "string", description: "沙箱 ID" },
        cwd: {
          type: "string",
          description: "工作目录，省略时使用镜像工作目录",
        },
        timeout: {
          type: "integer",
          description: "执行超时（秒），默认 60",
          default: 60,
        },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "读取沙箱中的文件内容。省略 sandbox_id 时使用默认沙箱。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件绝对路径" },
        sandbox_id: { type: "string", description: "沙箱 ID" },
        encoding: {
          type: "string",
          description: "文件编码，默认 utf-8",
          default: "utf-8",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "在沙箱中创建或覆写文件。省略 sandbox_id 时使用默认沙箱。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件绝对路径" },
        content: { type: "string", description: "文件内容" },
        sandbox_id: { type: "string", description: "沙箱 ID" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_files",
    description: "列出沙箱中指定目录的文件和子目录。省略 sandbox_id 时使用默认沙箱。",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "目录路径，省略时列出 /",
          default: "/",
        },
        sandbox_id: { type: "string", description: "沙箱 ID" },
      },
    },
  },
  {
    name: "kill_sandbox",
    description:
      "销毁指定沙箱。省略 sandbox_id 时销毁默认沙箱；当前没有默认沙箱时返回错误，而不是成功。",
    inputSchema: {
      type: "object",
      properties: {
        sandbox_id: {
          type: "string",
          description: "要销毁的沙箱 ID，省略时销毁默认沙箱",
        },
      },
    },
  },
  ...OPERATION_SCHEMAS,
];

/** Live discovery view: reusing the module must not retain another provider's schemas. */
export function toolSchemas(): ToolSchema[] { return [...CORE_TOOL_SCHEMAS, ...templateSchemas()]; }
export const TOOL_SCHEMAS: ToolSchema[] = new Proxy([] as ToolSchema[], {
  get(_target, key) { const current = toolSchemas(); const value = Reflect.get(current, key); return typeof value === "function" ? value.bind(current) : value; },
});

Object.assign(CORE_TOOL_SCHEMAS[0]!.inputSchema.properties as JsonObject, {
  cpu: { type: "integer", minimum: 1 }, memory: { type: "integer", minimum: 1 },
  region: { type: "string", minLength: 1 }, retain: { type: "boolean", default: false },
});
TOOL_SCHEMAS[0]!.inputSchema.additionalProperties = false;

const createInput = z.strictObject({
  template: z.string().min(1).optional(), timeout: z.number().int().min(1).max(86400).optional(),
  envs: z.record(z.string(), z.string()).optional(), cpu: z.number().int().min(1).optional(),
  memory: z.number().int().min(1).optional(), region: z.string().min(1).optional(), retain: z.boolean().optional(),
});

/** Quick lookup by name. */
export const TOOL_SCHEMA_MAP: Record<string, ToolSchema> = new Proxy({} as Record<string, ToolSchema>, {
  get(_target, key) { return toolSchemas().find((schema) => schema.name === key); },
  ownKeys() { return toolSchemas().map((schema) => schema.name); },
  getOwnPropertyDescriptor(_target, key) { const value = toolSchemas().find((schema) => schema.name === key); return value ? { value, enumerable: true, configurable: true } : undefined; },
});

// ---------------------------------------------------------------------------
// Helpers mirroring dict / enum access in the Python handlers
// ---------------------------------------------------------------------------

type ToolParams = JsonObject;
type ToolResult = JsonObject;

/** `params[key]` — raises `KeyError` when the key is absent. */
function require(params: ToolParams, key: string): unknown {
  if (!Object.hasOwn(params, key)) throw new KeyError(key);
  return params[key];
}

/** `params.get(key, default)`. */
function get(params: ToolParams, key: string, fallback?: unknown): unknown {
  return Object.hasOwn(params, key) ? params[key] : (fallback ?? null);
}

/** `params.get(key) or None`. */
function getOrNone(params: ToolParams, key: string): string | null {
  const value = get(params, key);
  return pyTruthy(value) ? (value as string) : null;
}

/** `member.value` of a Python `Enum` (string enums are plain strings in TS). */
function enumValue(member: unknown): unknown {
  if (typeof member === "object" && member !== null && "value" in member) {
    return (member as { value: unknown }).value;
  }
  return member;
}

// ---------------------------------------------------------------------------
// Tool handler functions
// ---------------------------------------------------------------------------

// The sandbox objects are the SDK `Sandbox` (src/api/sandbox.ts); the handlers
// only need the surface the Python handlers touch.
/* eslint-disable @typescript-eslint/no-explicit-any */
type SandboxHandle = any;

export async function handleCreateSandbox(
  params: ToolParams,
  manager: SandboxManager,
): Promise<ToolResult> {
  const rawTemplate = get(params, "template");
  const template = typeof rawTemplate === "string" && rawTemplate ? rawTemplate : null;
  const timeout = get(params, "timeout", 300);
  const envs = pyTruthy(get(params, "envs")) ? get(params, "envs") : {};

  const sandbox: SandboxHandle = await manager.createSandbox({
    template,
    timeout: timeout as number,
    envs: envs as Record<string, string>,
    ...(params.cpu !== undefined ? { cpu: params.cpu as number } : {}),
    ...(params.memory !== undefined ? { memory: params.memory as number } : {}),
    ...(params.region !== undefined ? { region: params.region as string } : {}),
    ...(params.retain !== undefined ? { retain: params.retain as boolean } : {}),
  });
  return {
    sandbox_id: typeof manager.reference === "function" ? manager.reference(sandbox) : sandbox.id,
    status: enumValue(sandbox.status),
    url: sandbox.url,
  };
}

export async function handleRunCode(
  params: ToolParams,
  manager: SandboxManager,
): Promise<ToolResult> {
  const code = require(params, "code");
  const language = get(params, "language", "python");
  const timeout = get(params, "timeout", 30);
  const sandboxId = getOrNone(params, "sandbox_id");

  const sandbox: SandboxHandle = await manager.getSandbox(sandboxId);
  const result = await sandbox.runCode(code, { language, timeout });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    output_files: (result.output_files as Array<{ name: string; path: string; size: number }>).map(
      (f) => ({ name: f.name, path: f.path, size: f.size }),
    ),
  };
}

export async function handleRunCommand(
  params: ToolParams,
  manager: SandboxManager,
): Promise<ToolResult> {
  const command = require(params, "command");
  const timeout = get(params, "timeout", 60);
  const cwd = pyTruthy(get(params, "cwd")) ? get(params, "cwd") : "";
  const sandboxId = getOrNone(params, "sandbox_id");

  const sandbox: SandboxHandle = await manager.getSandbox(sandboxId);
  const result = await sandbox.commands.run(command, { timeout, cwd, shell: true });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  };
}

export async function handleReadFile(
  params: ToolParams,
  manager: SandboxManager,
): Promise<ToolResult> {
  const path = require(params, "path");
  const encoding = get(params, "encoding", "utf-8");
  const sandboxId = getOrNone(params, "sandbox_id");

  const sandbox: SandboxHandle = await manager.getSandbox(sandboxId);
  const content = await sandbox.files.read(path, { encoding });
  return { content };
}

export async function handleWriteFile(
  params: ToolParams,
  manager: SandboxManager,
): Promise<ToolResult> {
  const path = require(params, "path");
  const content = require(params, "content");
  const sandboxId = getOrNone(params, "sandbox_id");

  const sandbox: SandboxHandle = await manager.getSandbox(sandboxId);
  await sandbox.files.write(path, content);
  if (typeof content !== "string") {
    throw new Error(`'${pyTypeName(content)}' object has no attribute 'encode'`);
  }
  return { success: true, bytes_written: Buffer.byteLength(content, "utf-8") };
}

export async function handleListFiles(
  params: ToolParams,
  manager: SandboxManager,
): Promise<ToolResult> {
  const path = pyTruthy(get(params, "path")) ? get(params, "path") : "/";
  const sandboxId = getOrNone(params, "sandbox_id");

  const sandbox: SandboxHandle = await manager.getSandbox(sandboxId);
  const files = (await sandbox.files.list(path)) as Array<{
    name: string;
    path: string;
    type: unknown;
    size: number;
  }>;
  return {
    files: files.map((f) => ({
      name: f.name,
      path: f.path,
      type: enumValue(f.type),
      size: f.size,
    })),
  };
}

export async function handleKillSandbox(
  params: ToolParams,
  manager: SandboxManager,
): Promise<ToolResult> {
  const rawId = get(params, "sandbox_id");
  const sandboxId = typeof rawId === "string" && rawId ? rawId : null;
  const killed = await manager.killSandbox(sandboxId);
  if (!killed) {
    return {
      success: false,
      error:
        "No sandbox to destroy. Call create_sandbox or another tool " +
        "before kill_sandbox without sandbox_id.",
    };
  }
  return { success: true, sandbox_id: killed };
}

type ToolHandler = (params: ToolParams, manager: SandboxManager) => Promise<ToolResult>;

/** Handler dispatch table. */
const CORE_TOOL_HANDLERS: Record<string, ToolHandler> = {
  create_sandbox: handleCreateSandbox,
  run_code: handleRunCode,
  run_command: handleRunCommand,
  read_file: handleReadFile,
  write_file: handleWriteFile,
  list_files: handleListFiles,
  kill_sandbox: handleKillSandbox,
  ...Object.fromEntries(Object.keys(operationInputs).map(name => [name, (params: ToolParams, manager: SandboxManager) => handleOperation(name as keyof typeof operationInputs, params, manager)])),
};

/** Handler discovery follows the selected provider without keeping stale names. */
export const TOOL_HANDLERS: Record<string, ToolHandler> = new Proxy(CORE_TOOL_HANDLERS, {
  get(target, key) {
    if (typeof key === "string" && Object.hasOwn(target, key)) return target[key];
    return templateSchemas().some(schema => schema.name === key)
      ? (params: ToolParams, manager: SandboxManager) => handleTemplateOperation(String(key), params, manager)
      : undefined;
  },
  ownKeys(target) { return [...Object.keys(target), ...templateSchemas().map(schema => schema.name)]; },
  getOwnPropertyDescriptor(target, key) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor) return descriptor;
    return templateSchemas().some(schema => schema.name === key)
      ? { enumerable: true, configurable: true } : undefined;
  },
});

/**
 * Dispatch a tool call to its handler.
 *
 * @throws ValueError if the tool name is not recognized.
 */
export async function dispatchTool(
  name: string,
  params: ToolParams,
  manager: SandboxManager,
): Promise<ToolResult> {
  const handler = Object.hasOwn(TOOL_HANDLERS, name) ? TOOL_HANDLERS[name] : undefined;
  const operation = Object.hasOwn(operationInputs, name);
  const template = templateSchemas().some((schema) => schema.name === name);
  if (handler === undefined && !operation && !template) {
    throw new ValueError(`Unknown tool: ${name}`);
  }
  try {
    if (template) return await handleTemplateOperation(name, params, manager);
    if (operation) return await handleOperation(name as keyof typeof operationInputs, params, manager);
    if (name === "create_sandbox") createInput.parse(params);
    return await handler!(params, manager);
  } catch (exc) {
    if (isCancellation(exc)) throw exc;
    if (["create_sandbox", "list_sandboxes", "get_sandbox", "set_sandbox_timeout", "retain_sandbox"].includes(name)) {
      const payload = formatLifecycleError(exc);
      logger.error("Tool %s failed: %s", name, payload.error);
      return payload;
    }
    logger.error("Tool %s failed: %s", name, errorText(exc), new ExcInfo(exc));
    return _formatToolError(exc);
  }
}

/** Fixed failure categories: provider messages/suggestions/URLs can contain secrets. */
function formatLifecycleError(exc: unknown): ToolResult {
  if (exc instanceof BorrowedSandboxError) return { error: "Connected sandboxes are borrowed; retention cannot transfer cleanup ownership." };
  if (exc instanceof z.ZodError) return { error: "Invalid sandbox lifecycle arguments. Check the tool schema." };
  if (exc instanceof ValidationError) return { error: "The platform returned invalid sandbox metadata." };
  if (exc instanceof HTTPStatusError) return { error: `Sandbox lifecycle request failed (HTTP ${exc.response.status_code}).` };
  if (exc instanceof TimeoutException) return { error: "Sandbox lifecycle request timed out." };
  if (exc instanceof RequestError) return { error: "Sandbox lifecycle request could not reach the platform." };
  if (exc instanceof SandboxError) {
    let message = "Sandbox lifecycle operation failed.";
    let suggestion = "Check the sandbox, provider configuration, and platform permissions.";
    if (exc instanceof AuthenticationError) {
      message = "Sandbox authentication failed."; suggestion = "Check the authorized provider credential configuration.";
    } else if (exc instanceof SandboxNotFoundError || exc instanceof ProviderResourceNotFoundError) {
      message = "Sandbox was not found."; suggestion = "List sandboxes and use an existing sandbox ID.";
    } else if (exc instanceof ProviderFeatureNotSupportedError) {
      message = "The provider does not support this lifecycle operation."; suggestion = "Choose a provider that supports this operation.";
    } else if (exc instanceof QuotaExceededError) {
      message = "Sandbox quota exceeded."; suggestion = "Remove unused sandboxes or request additional quota.";
    } else if (exc instanceof TemplateNotFoundError) {
      message = "Sandbox template was not found."; suggestion = "Choose an available template.";
    }
    if (/^E[0-9]{4}$/.test(exc.code)) message = `[${exc.code}] ${message}`;
    return { error: message, suggestion };
  }
  return { error: "Sandbox lifecycle operation failed." };
}

function isCancellation(exc: unknown): boolean {
  return exc instanceof Error && exc.name === "CancelledError";
}

function errorText(exc: unknown): string {
  return pyExcStr(exc);
}

function isSystemError(exc: unknown): boolean {
  return (
    exc instanceof Error &&
    ("syscall" in exc || "errno" in exc) // Node fs/net errors carry a string `code` too
  );
}

/**
 * Turn an exception into a short tool payload for the model.
 *
 * SDK errors keep their code, message, and suggestion. Transport errors
 * drop the trailing HTTP documentation link that `httpx` appends.
 */
export function _formatToolError(exc: unknown): ToolResult {
  const holder = (isDict(exc) || exc instanceof Error ? exc : {}) as Record<string, unknown>;
  const code = isSystemError(exc) ? undefined : holder.code;
  const message = holder.message;
  const suggestion = holder.suggestion;
  if (typeof code === "string" && typeof message === "string" && message) {
    const payload: ToolResult = { error: `[${code}] ${message}` };
    if (typeof suggestion === "string" && suggestion) {
      payload.suggestion = suggestion;
    }
    return payload;
  }
  let text = errorText(exc);
  const marker = "For more information check:";
  if (text.includes(marker)) {
    text = pyStrip(text.split(marker, 1)[0] ?? "");
  }
  const typeName =
    exc instanceof Error ? (exc.constructor?.name ?? exc.name) : exc === null ? "NoneType" : typeof exc;
  return { error: text || typeName };
}

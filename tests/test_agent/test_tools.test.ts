/** Tests for MCP tool schemas and handlers. */

import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  TOOL_HANDLERS,
  TOOL_SCHEMA_MAP,
  TOOL_SCHEMAS,
  dispatchTool,
  handleCreateSandbox,
  handleKillSandbox,
  handleListFiles,
  handleReadFile,
  handleRunCode,
  handleRunCommand,
  handleWriteFile,
} from "../../src/agent/tools.js";
import type { SandboxManager } from "../../src/agent/mcp.js";

// ---------------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------------

describe("TestToolSchemas", () => {
  it("test_all_7_tools_defined", () => {
    // All 7 P0 core tools should be defined.
    expect(TOOL_SCHEMAS.length).toBe(7);
  });

  it("test_tool_names", () => {
    // Tool names match expected set.
    const names = new Set(TOOL_SCHEMAS.map((t) => t.name));
    const expected = new Set([
      "create_sandbox",
      "run_code",
      "run_command",
      "read_file",
      "write_file",
      "list_files",
      "kill_sandbox",
    ]);
    expect(names).toEqual(expected);
  });

  it("test_each_tool_has_required_fields", () => {
    // Each tool has name, description, inputSchema.
    for (const tool of TOOL_SCHEMAS) {
      expect(tool, `Tool missing name: ${JSON.stringify(tool)}`).toHaveProperty("name");
      expect(tool, `Tool ${tool.name} missing description`).toHaveProperty("description");
      expect(tool, `Tool ${tool.name} missing inputSchema`).toHaveProperty("inputSchema");
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("test_schema_map_matches_list", () => {
    // TOOL_SCHEMA_MAP should have same keys as TOOL_SCHEMAS names.
    expect(new Set(Object.keys(TOOL_SCHEMA_MAP))).toEqual(new Set(TOOL_SCHEMAS.map((t) => t.name)));
  });

  it("test_handler_map_matches_schemas", () => {
    // Every schema should have a handler.
    for (const tool of TOOL_SCHEMAS) {
      expect(Object.hasOwn(TOOL_HANDLERS, tool.name), `No handler for ${tool.name}`).toBe(true);
    }
  });

  it("test_run_code_requires_code", () => {
    // run_code should have 'code' as required parameter.
    const schema = TOOL_SCHEMA_MAP.run_code!;
    expect((schema.inputSchema.required as string[] | undefined) ?? []).toContain("code");
  });

  it("test_run_command_requires_command", () => {
    // run_command should have 'command' as required parameter.
    const schema = TOOL_SCHEMA_MAP.run_command!;
    expect((schema.inputSchema.required as string[] | undefined) ?? []).toContain("command");
  });

  it("test_read_file_requires_path", () => {
    // read_file should have 'path' as required parameter.
    const schema = TOOL_SCHEMA_MAP.read_file!;
    expect((schema.inputSchema.required as string[] | undefined) ?? []).toContain("path");
  });

  it("test_write_file_requires_path_and_content", () => {
    // write_file should have 'path' and 'content' as required.
    const schema = TOOL_SCHEMA_MAP.write_file!;
    const required = (schema.inputSchema.required as string[] | undefined) ?? [];
    expect(required).toContain("path");
    expect(required).toContain("content");
  });

  it("test_create_sandbox_has_template_param", () => {
    // create_sandbox should accept 'template' parameter.
    const schema = TOOL_SCHEMA_MAP.create_sandbox!;
    expect(schema.inputSchema.properties).toHaveProperty("template");
  });

  it("test_kill_sandbox_has_sandbox_id", () => {
    // kill_sandbox should accept optional sandbox_id.
    const schema = TOOL_SCHEMA_MAP.kill_sandbox!;
    expect(schema.inputSchema.properties).toHaveProperty("sandbox_id");
  });
});

// ---------------------------------------------------------------------------
// Handler tests
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeMockManager(): any {
  const sandbox: any = {
    id: "sbx-test-001",
    status: { value: "running" },
    url: "https://49983-sbx-test-001.cn-hangzhou.e2b.fc.aliyuncs.com",
    commands: {
      run: vi.fn(async () => ({
        stdout: "hello\n",
        stderr: "",
        exit_code: 0,
        execution_time: 0.5,
      })),
    },
    runCode: vi.fn(async () => ({
      text: "42",
      stdout: "42\n",
      stderr: "",
      exit_code: 0,
      output_files: [],
      execution_time: 0.3,
    })),
    files: {
      read: vi.fn(async () => "file content here"),
      write: vi.fn(async () => null),
      list: vi.fn(async () => [
        { name: "main.py", path: "/app/main.py", type: "file", size: 128 },
        { name: "data", path: "/app/data", type: "directory", size: 0 },
      ]),
    },
  };

  const manager: any = {
    createSandbox: vi.fn(async () => sandbox),
    getSandbox: vi.fn(async () => sandbox),
    killSandbox: vi.fn(async (sandboxId: string | null = null) => sandboxId || "sbx-test-001"),
  };
  return manager;
}

describe("TestToolHandlers", () => {
  let manager: any;
  beforeEach(() => {
    manager = makeMockManager();
  });

  it("test_create_sandbox", async () => {
    const result = await handleCreateSandbox({ template: "python-base", timeout: 300 }, manager);
    expect(result.sandbox_id).toBe("sbx-test-001");
    expect(result.status).toBe("running");
    expect(manager.createSandbox).toHaveBeenCalledTimes(1);
    expect(manager.createSandbox).toHaveBeenCalledWith({
      template: "python-base",
      timeout: 300,
      envs: {},
    });
  });

  it("test_create_sandbox_defaults", async () => {
    const result = await handleCreateSandbox({}, manager);
    expect(result.sandbox_id).toBe("sbx-test-001");
    expect(manager.createSandbox).toHaveBeenCalledTimes(1);
    expect(manager.createSandbox).toHaveBeenCalledWith({
      template: null,
      timeout: 300,
      envs: {},
    });
  });

  it("test_run_code", async () => {
    const result = await handleRunCode({ code: "print(42)", language: "python" }, manager);
    expect(result.stdout).toBe("42\n");
    expect(result.exit_code).toBe(0);
    expect(manager.getSandbox).toHaveBeenCalledTimes(1);
    expect(manager.getSandbox).toHaveBeenCalledWith(null);
  });

  it("test_run_code_with_sandbox_id", async () => {
    await handleRunCode({ code: "1+1", sandbox_id: "sbx-specific" }, manager);
    expect(manager.getSandbox).toHaveBeenCalledTimes(1);
    expect(manager.getSandbox).toHaveBeenCalledWith("sbx-specific");
  });

  it("test_run_command", async () => {
    const result = await handleRunCommand({ command: "echo hello" }, manager);
    expect(result.stdout).toBe("hello\n");
    expect(result.exit_code).toBe(0);
  });

  it("test_run_command_with_cwd", async () => {
    await handleRunCommand({ command: "ls", cwd: "/tmp", timeout: 10 }, manager);
    const sandbox = await manager.getSandbox(null);
    expect(sandbox.commands.run).toHaveBeenLastCalledWith("ls", {
      timeout: 10,
      cwd: "/tmp",
      shell: true,
    });
  });

  it("test_read_file", async () => {
    const result = await handleReadFile({ path: "/app/main.py" }, manager);
    expect(result.content).toBe("file content here");
  });

  it("test_write_file", async () => {
    const result = await handleWriteFile({ path: "/app/test.py", content: "print('hi')" }, manager);
    expect(result.success).toBe(true);
    expect(result.bytes_written).toBe(Buffer.from("print('hi')").length);
  });

  it("test_list_files", async () => {
    const result = await handleListFiles({ path: "/app" }, manager);
    const files = result.files as Array<Record<string, unknown>>;
    expect(files.length).toBe(2);
    expect(files[0]!.name).toBe("main.py");
    expect(files[0]!.type).toBe("file");
    expect(files[1]!.name).toBe("data");
    expect(files[1]!.type).toBe("directory");
  });

  it("test_list_files_default_path", async () => {
    await handleListFiles({}, manager);
    const sandbox = await manager.getSandbox(null);
    expect(sandbox.files.list).toHaveBeenLastCalledWith("/");
  });

  it("test_kill_sandbox", async () => {
    const result = await handleKillSandbox({}, manager);
    expect(result.success).toBe(true);
    expect(manager.killSandbox).toHaveBeenCalledTimes(1);
    expect(manager.killSandbox).toHaveBeenCalledWith(null);
  });

  it("test_kill_sandbox_specific", async () => {
    const result = await handleKillSandbox({ sandbox_id: "sbx-002" }, manager);
    expect(result.success).toBe(true);
    expect(manager.killSandbox).toHaveBeenCalledTimes(1);
    expect(manager.killSandbox).toHaveBeenCalledWith("sbx-002");
  });
});

describe("TestDispatch", () => {
  it("test_dispatch_known_tool", async () => {
    const manager = makeMockManager();
    const result = await dispatchTool("run_code", { code: "1+1" }, manager as SandboxManager);
    expect(result).toHaveProperty("stdout");
  });

  it("test_dispatch_unknown_tool", async () => {
    const manager = makeMockManager();
    await expect(dispatchTool("nonexistent_tool", {}, manager as SandboxManager)).rejects.toThrow(
      /Unknown tool/,
    );
  });

  it("test_dispatch_handler_error_returns_error", async () => {
    // If a handler raises, dispatch_tool returns error dict.
    const manager = makeMockManager();
    manager.getSandbox = vi.fn(async () => {
      throw new Error("connection failed");
    });
    const result = await dispatchTool("run_code", { code: "x" }, manager as SandboxManager);
    expect(result).toHaveProperty("error");
    expect(result.error as string).toContain("connection failed");
  });
});

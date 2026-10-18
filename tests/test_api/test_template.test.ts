/** Tests for api.template module — TemplateManager high-level API. */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TemplateManager } from "../../src/providers/alicloud_express/template.js";
import { BuildStatus, TemplateInfo } from "../../src/models/template.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- Sample data ---

const _CREATE_RESPONSE = { templateID: "tpl-abc123", buildID: "bld-xyz789" };

const _TEMPLATE_DATA = {
  templateID: "tpl-abc123",
  buildID: "bld-xyz789",
  aliases: "my-template",
  public: false,
  cpuCount: 2,
  memoryMB: 4096,
};

const _BUILD_STATUS_READY = { buildID: "bld-xyz789", templateID: "tpl-abc123", status: "ready" };

let mock_protocol: any;
let manager: TemplateManager;

beforeEach(() => {
  const mock_http_client: any = { close: vi.fn(), platformRequest: vi.fn() };
  mock_protocol = {
    create: vi.fn(async () => _CREATE_RESPONSE),
    list: vi.fn(async () => [_TEMPLATE_DATA]),
    get: vi.fn(async () => _TEMPLATE_DATA),
    delete: vi.fn(async () => null),
    getBuildStatus: vi.fn(async () => _BUILD_STATUS_READY),
    waitForBuild: vi.fn(async () => _BUILD_STATUS_READY),
    createV3: vi.fn(),
    triggerBuildV2: vi.fn(),
    getBuildLogs: vi.fn(),
  };
  manager = new TemplateManager(mock_http_client);
  manager._protocol = mock_protocol;
});

describe("TestBuild", () => {
  // Test TemplateManager.build().
  it("test_build_returns_template_info", async () => {
    const result = await manager.build("FROM python:3.11\nRUN pip install flask");

    expect(result).toBeInstanceOf(TemplateInfo);
    expect(result.template_id).toBe("tpl-abc123");
    expect(result.build_status).toBe(BuildStatus.READY);

    expect(mock_protocol.create).toHaveBeenCalledTimes(1);
    expect(mock_protocol.waitForBuild).toHaveBeenCalledTimes(1);
    expect(mock_protocol.get).toHaveBeenCalledTimes(1);
    expect(mock_protocol.get).toHaveBeenCalledWith("tpl-abc123");
  });

  it("test_build_with_alias", async () => {
    await manager.build("FROM python:3.11", { alias: "my-app", cpu_count: 4, memory_mb: 8192 });
    const call_kwargs = mock_protocol.create.mock.calls[0][1];
    expect(call_kwargs["alias"]).toBe("my-app");
    expect(call_kwargs["cpu_count"]).toBe(4);
    expect(call_kwargs["memory_mb"]).toBe(8192);
  });
});

describe("TestBuildInBackground", () => {
  // Test TemplateManager.build_in_background().
  it("test_returns_ids", async () => {
    const [template_id, build_id] = await manager.buildInBackground("FROM python:3.11");
    expect(template_id).toBe("tpl-abc123");
    expect(build_id).toBe("bld-xyz789");
    expect(mock_protocol.create).toHaveBeenCalledTimes(1);
    expect(mock_protocol.waitForBuild).not.toHaveBeenCalled();
  });
});

describe("TestList", () => {
  // Test TemplateManager.list().
  it("test_list_returns_template_infos", async () => {
    const result = await manager.list();
    expect(result.length).toBe(1);
    expect(result[0]).toBeInstanceOf(TemplateInfo);
    expect(result[0]!.template_id).toBe("tpl-abc123");
  });

  it("test_list_empty", async () => {
    mock_protocol.list.mockResolvedValue([]);
    const result = await manager.list();
    expect(result).toEqual([]);
  });
});

describe("TestGet", () => {
  // Test TemplateManager.get().
  it("test_get_returns_template_info", async () => {
    const result = await manager.get("tpl-abc123");
    expect(result).toBeInstanceOf(TemplateInfo);
    expect(result.template_id).toBe("tpl-abc123");
    expect(mock_protocol.get).toHaveBeenCalledTimes(1);
    expect(mock_protocol.get).toHaveBeenCalledWith("tpl-abc123");
  });
});

describe("TestDelete", () => {
  // Test TemplateManager.delete().
  it("test_delete", async () => {
    await manager.delete("tpl-abc123");
    expect(mock_protocol.delete).toHaveBeenCalledTimes(1);
    expect(mock_protocol.delete).toHaveBeenCalledWith("tpl-abc123");
  });
});

describe("TestGetBuildStatus", () => {
  // Test TemplateManager.get_build_status().
  it("test_get_build_status", async () => {
    const result = await manager.getBuildStatus("tpl-abc123", "bld-xyz789");
    expect(result["status"]).toBe("ready");
    expect(mock_protocol.getBuildStatus).toHaveBeenCalledTimes(1);
    expect(mock_protocol.getBuildStatus).toHaveBeenCalledWith("tpl-abc123", "bld-xyz789");
  });
});

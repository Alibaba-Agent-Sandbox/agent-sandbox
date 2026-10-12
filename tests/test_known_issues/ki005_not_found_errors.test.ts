/** KI-005: not-found conditions raise SDK errors, not raw `HTTPStatusError`. */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FilesModule } from "../../src/api/files.js";
import { Sandbox } from "../../src/api/sandbox.js";
import * as errors from "../../src/models/errors.js";
import {
  FileNotFoundError_,
  FileOperationError,
  PermissionDeniedError,
  SandboxError,
  SandboxNotFoundError,
} from "../../src/models/errors.js";
import * as models from "../../src/models/index.js";
import { FilesystemProtocol } from "../../src/protocol/filesystem.js";
import { SandboxProtocol } from "../../src/protocol/sandbox.js";
import { exitCodeFor } from "../../src/providers/epp.js";
import { HTTPError } from "../../src/transport/http.js";
import { useIsolatedEnv, useTransportIsolation } from "../_support/env.js";
import { useHttpxMock } from "../helpers/httpxMock.js";
import { API, ENVD, makeHttp, raises, token } from "./_helpers.js";

const iso = useIsolatedEnv();
useTransportIsolation(iso);
const httpx_mock = useHttpxMock();

const FILES_URL = `${ENVD}/files?path=%2Ftmp%2Fnope.txt&username=user`;
const files = () => new FilesModule(ENVD, token(), new FilesystemProtocol(makeHttp()));

describe("KI-005 files", () => {
  it("test_read_missing_file_raises_file_not_found", async () => {
    httpx_mock.add_response({ url: FILES_URL, method: "GET", status_code: 404, json: { message: "no" } });
    const err = await raises(() => files().read("/tmp/nope.txt"), FileNotFoundError_);
    expect(String(err.message)).toContain("/tmp/nope.txt");
    expect(err.message).toBe("File or directory not found in the sandbox: /tmp/nope.txt");
    expect(err).not.toBeInstanceOf(HTTPError);
  });

  it("test_read_bytes_and_download_map_the_same_way", async () => {
    for (let i = 0; i < 2; i += 1) httpx_mock.add_response({ url: FILES_URL, method: "GET", status_code: 404, content: "" });
    const out = path.join(iso.tmp_path, "out");
    await raises(() => files().readBytes("/tmp/nope.txt"), FileNotFoundError_);
    await raises(() => files().download("/tmp/nope.txt", out), FileNotFoundError_);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("test_forbidden_file_raises_permission_denied", async () => {
    httpx_mock.add_response({ url: FILES_URL, method: "GET", status_code: 403, content: "" });
    const err = await raises(() => files().read("/tmp/nope.txt"), PermissionDeniedError);
    expect(err.message).toBe("Permission denied in the sandbox: /tmp/nope.txt");
  });

  it("test_other_file_http_errors_raise_file_operation_error", async () => {
    httpx_mock.add_response({ url: FILES_URL, method: "GET", status_code: 500, content: "boom" });
    const err = await raises(() => files().read("/tmp/nope.txt"), FileOperationError);
    expect(err.message).toBe("envd file operation failed (HTTP 500) for /tmp/nope.txt: boom");
    expect(err).not.toBeInstanceOf(FileNotFoundError_);
  });

  it("test_error_detail_is_cut_at_200_characters", async () => {
    httpx_mock.add_response({ url: FILES_URL, method: "GET", status_code: 500, content: "x".repeat(900) });
    const err = await raises(() => files().read("/tmp/nope.txt"), FileOperationError);
    expect(err.message).toBe(`envd file operation failed (HTTP 500) for /tmp/nope.txt: ${"x".repeat(200)}`);
  });

  it("test_upload_failure_raises_file_operation_error", async () => {
    httpx_mock.add_response({ method: "POST", status_code: 507, content: "disk full" });
    const err = await raises(() => files().write("/tmp/x.bin", new Uint8Array([100, 97, 116, 97])), FileOperationError);
    expect(String(err.message)).toContain("507");
  });

  it.each(["stat", "remove", "move", "make_dir"])("test_connect_rpc_file_operations_map_404(%s)", async (op) => {
    httpx_mock.add_response({ method: "POST", status_code: 404, content: "" });
    const f = files();
    await raises(async () => {
      if (op === "stat") await f.getInfo("/x");
      else if (op === "remove") await f.remove("/x");
      else if (op === "move") await f.move("/x", "/y");
      else await f.makeDir("/x");
    }, FileNotFoundError_);
  });

  it("test_connect_rpc_403_maps_to_permission_denied", async () => {
    httpx_mock.add_response({ method: "POST", status_code: 403, content: "" });
    await raises(() => files().remove("/root/x"), PermissionDeniedError);
  });

  it("test_exists_is_false_for_a_missing_path", async () => {
    httpx_mock.add_response({ method: "POST", status_code: 404, content: "" });
    expect(await files().exists("/x")).toBe(false);
  });
});

describe("KI-005 sandboxes", () => {
  it.each(["connect", "getInfo"] as const)("test_missing_sandbox_raises_sandbox_not_found(%s)", async (method) => {
    httpx_mock.add_response({ url: `${API}/sandboxes/sbx-0000`, method: "GET", status_code: 404, json: { message: "nope" } });
    const proto = new SandboxProtocol(makeHttp());
    const err = await raises(() => proto[method]("sbx-0000"), SandboxNotFoundError);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.message).toBe("Sandbox 'sbx-0000' was not found.");
    expect(err).not.toBeInstanceOf(HTTPError);
  });

  it.each(["setTimeout", "pause", "resume"] as const)("test_missing_sandbox_on_mutating_calls(%s)", async (method) => {
    httpx_mock.add_response({ method: "POST", status_code: 404, json: { message: "nope" } });
    const proto = new SandboxProtocol(makeHttp());
    await raises(() => (method === "setTimeout" ? proto.setTimeout("sbx-0000", 60) : proto[method]("sbx-0000")), SandboxNotFoundError);
  });

  it("test_kill_of_a_missing_sandbox_stays_idempotent", async () => {
    httpx_mock.add_response({ method: "DELETE", status_code: 404, json: {} });
    await new SandboxProtocol(makeHttp()).kill("sbx-0000");
  });

  it("test_is_running_is_false_for_a_missing_sandbox", async () => {
    httpx_mock.add_response({ method: "GET", status_code: 404, json: {} });
    expect(await new SandboxProtocol(makeHttp()).isRunning("sbx-0000")).toBe(false);
  });

  it("test_sandbox_connect_on_a_missing_sandbox", async () => {
    iso.monkeypatch.setenv("EBX_PROVIDER", "alicloud-express");
    httpx_mock.add_response({ method: "GET", status_code: 404, json: { message: "nope" } });
    await raises(() => Sandbox.connect("sbx-00000000", { api_key: "k", api_url: API }), SandboxNotFoundError);
  });
});

describe("KI-005 the error class", () => {
  it("test_sandbox_not_found_error_contract", () => {
    expect(models.SandboxNotFoundError).toBe(SandboxNotFoundError);
    expect(errors.__all__).toContain("SandboxNotFoundError");
    expect(SandboxNotFoundError.code).toBe("E2009");
    expect(SandboxNotFoundError.suggestion).toBeTruthy();
    const others = errors.__all__
      .filter((n: string) => n !== "SandboxNotFoundError")
      .map((n: string) => (errors as Record<string, any>)[n]?.code);
    expect(others).not.toContain("E2009");
    expect(exitCodeFor(new SandboxNotFoundError("x"))).toBe(4);
  });
});

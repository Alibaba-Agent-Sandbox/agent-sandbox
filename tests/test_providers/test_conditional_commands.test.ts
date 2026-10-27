/** Provider-owned conditional wire mappings and generic consumer discovery. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONDITIONAL_COMMANDS, buildConditionalCommandRunner } from "../../src/providers/alicloud_express/conditional_commands.js";
import { getProviderCommand, listProviderCommands, runProviderCommand } from "../../src/providers/commands.js";
import { parseCommandSection, validateCommandOutput } from "../../src/providers/command_contract.js";
import { LayeredConfig } from "../../src/transport/config_layers.js";
import { HttpClient, HTTPStatusError, ReadTimeout, Request, Response } from "../../src/transport/http.js";
import { useIso } from "../_support/iso.js";

useIso();
afterEach(() => vi.restoreAllMocks());
const config = new LayeredConfig({ sandbox_api_key: "placeholder-runtime-key", sandbox_base_url: "https://api.example.test" });
const snapshotId = "11111111-1111-4111-8111-111111111111";
const signal = () => new AbortController().signal;
function failure(status: number): HTTPStatusError {
  const req = new Request("POST", "https://api.example.test/sandboxes/source/snapshots");
  return new HTTPStatusError("placeholder-private-response", { request: req, response: new Response(status, { request: req }) });
}

describe("Express conditional command registration", () => {
  it("discovers six commands through the generic catalog without credentials or backend calls", () => {
    const network = vi.spyOn(HttpClient.prototype, "platformRequest");
    const parsed = parseCommandSection({ protocol: "provider-commands/1", entries: CONDITIONAL_COMMANDS }, "builtin");
    expect(parsed.map((x) => x.id)).toEqual(["sandbox.pause", "sandbox.resume", "snapshot.create", "snapshot.delete", "snapshot.list", "snapshot.restore"]);
    for (const item of parsed) expect(getProviderCommand("alicloud-express", item.id)).toEqual(item);
    expect(listProviderCommands("alicloud-express")).toHaveLength(32);
    expect(network).not.toHaveBeenCalled();
  });

  it("uses API-key auth, never substituting management AK/SK", () => {
    expect(() => buildConditionalCommandRunner(new LayeredConfig({ access_key_id: "placeholder-ak", access_key_secret: "placeholder-sk" }))).toThrow(/API key/);
  });

  it("pauses with memory and resumes via POST connect, without a guessed resume route", async () => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest").mockResolvedValue(new Response(204));
    const runner = buildConditionalCommandRunner(config);
    expect(await runner.run("sandbox.pause", { sandbox_id: "source" }, signal())).toEqual({ sandbox_id: "source", paused: true });
    expect(call).toHaveBeenLastCalledWith("POST", "/sandboxes/source/pause", { json: { memory: true }, request_timeout: 30 });
    expect(await runner.run("sandbox.resume", { sandbox_id: "source", timeout: 600 }, signal())).toEqual({ sandbox_id: "source", resumed: true });
    expect(call).toHaveBeenLastCalledWith("POST", "/sandboxes/source/connect", { json: { timeout: 600 }, request_timeout: 30 });
    await runner.close?.();
  });

  it("keeps the Snapshot request timeout separate from sandbox lifetime and projects only declared output", async () => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest").mockResolvedValue(new Response(201, { json: { snapshotID: snapshotId, names: ["team/checkpoint:default"], secret: "placeholder-hidden" } }));
    const result = await runProviderCommand("alicloud-express", "snapshot.create", { sandbox_id: "source", name: "checkpoint" }, { sandbox_api_key: config.sandbox_api_key });
    expect(result).toEqual({ snapshot_id: snapshotId, names: ["team/checkpoint:default"] });
    expect(call).toHaveBeenCalledExactlyOnceWith("POST", "/sandboxes/source/snapshots", { json: { name: "checkpoint" }, request_timeout: 300 });
    validateCommandOutput(getProviderCommand("alicloud-express", "snapshot.create"), result);
  });

  it("returns the service pagination cursor and preserves exact filter names", async () => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest").mockResolvedValue(new Response(200, { json: [{ snapshotID: snapshotId, names: [] }], headers: { "x-next-token": "page2" } }));
    const runner = buildConditionalCommandRunner(config);
    expect(await runner.run("snapshot.list", { sandbox_id: "source", name: "checkpoint", limit: 2, next_token: "page1" }, signal())).toEqual({ snapshots: [{ snapshot_id: snapshotId, names: [] }], next_token: "page2" });
    expect(call).toHaveBeenCalledExactlyOnceWith("GET", "/snapshots", { params: { sandboxID: "source", name: "checkpoint", limit: 2, nextToken: "page1" }, request_timeout: 30 });
    await runner.close?.();
  });

  it("restores a new sandbox through create and excludes session tokens from its output", async () => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest").mockResolvedValue(new Response(201, { json: { sandboxID: "clone", envdAccessToken: "placeholder-hidden" } }));
    const runner = buildConditionalCommandRunner(config);
    expect(await runner.run("snapshot.restore", { snapshot_id: snapshotId, timeout: 600 }, signal())).toEqual({ sandbox_id: "clone", snapshot_id: snapshotId });
    expect(call).toHaveBeenCalledExactlyOnceWith("POST", "/sandboxes", { json: { templateID: snapshotId, timeout: 600 }, request_timeout: 30 });
    await runner.close?.();
  });

  it("deletes by returned UUID through the verified template route, and distinguishes404", async () => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest").mockResolvedValueOnce(new Response(204)).mockRejectedValueOnce(failure(404));
    const runner = buildConditionalCommandRunner(config);
    expect(await runner.run("snapshot.delete", { snapshot_id: snapshotId }, signal())).toEqual({ deleted: true });
    expect(call).toHaveBeenLastCalledWith("DELETE", `/templates/${snapshotId}`, { request_timeout: 30 });
    expect(await runner.run("snapshot.delete", { snapshot_id: snapshotId }, signal())).toEqual({ deleted: false });
    await runner.close?.();
  });

  it.each([
    ["sandbox.pause", { sandbox_id: "../other" }],
    ["sandbox.pause", { sandbox_id: "source", keep_memory: false }],
    ["snapshot.create", { sandbox_id: "source", request_timeout: 301 }],
    ["snapshot.restore", { snapshot_id: "team/ordinary-template:default" }],
    ["snapshot.delete", { snapshot_id: "ordinary-template" }],
    ["snapshot.list", { limit: 101 }],
  ])("rejects invalid/unsafe %s input before network I/O %#", async (id, input) => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest");
    const runner = buildConditionalCommandRunner(config);
    await expect(runner.run(id as string, input, signal())).rejects.toMatchObject({ code: "E8002" });
    expect(call).not.toHaveBeenCalled();
    await runner.close?.();
  });

  it.each([403, 409, 429, 500])("reports service admission/transition HTTP%d without replay or capability denial", async (status) => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest").mockRejectedValue(failure(status));
    const runner = buildConditionalCommandRunner(config);
    const task = runner.run("snapshot.create", { sandbox_id: "source" }, signal());
    await expect(task).rejects.toMatchObject({ message: expect.stringContaining(`HTTP${status}`) });
    await expect(task).rejects.not.toMatchObject({ code: "E8004" });
    await expect(task).rejects.not.toThrow("placeholder-private-response");
    expect(call).toHaveBeenCalledOnce();
    await runner.close?.();
  });

  it("retains unknown-outcome timeout semantics and closes provider resources", async () => {
    const call = vi.spyOn(HttpClient.prototype, "platformRequest").mockRejectedValue(new ReadTimeout("placeholder-private-response"));
    const close = vi.spyOn(HttpClient.prototype, "close").mockResolvedValue();
    await expect(runProviderCommand("alicloud-express", "snapshot.create", { sandbox_id: "source" }, { sandbox_api_key: config.sandbox_api_key })).rejects.toMatchObject({ code: "E8022" });
    expect(call).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects malformed service output and never guesses missing Snapshot IDs", async () => {
    vi.spyOn(HttpClient.prototype, "platformRequest").mockResolvedValue(new Response(201, { json: { names: [] } }));
    const runner = buildConditionalCommandRunner(config);
    await expect(runner.run("snapshot.create", { sandbox_id: "source" }, signal())).rejects.toMatchObject({ code: "E8020" });
    await runner.close?.();
  });
});

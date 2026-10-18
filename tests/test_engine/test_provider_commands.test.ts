/** Real loopback HTTP verifies provider command discovery, confirmation and connection isolation. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startEngine, type EngineHandle } from "../../src/engine/server.js";
import { getProviderCommand, listProviderCommands, runProviderCommand } from "../../src/providers/commands.js";
import { ProviderConfigError, ProviderResourceNotFoundError } from "../../src/providers/errors.js";
import { useIso } from "../_support/iso.js";

vi.mock("../../src/providers/commands.js", () => ({
  getProviderCommand: vi.fn(), listProviderCommands: vi.fn(), runProviderCommand: vi.fn(),
}));

useIso();
const descriptor = {
  id: "volumes.list", description: "List volumes", description_zh: "列出存储卷",
  input_schema: { type: "object" }, output_schema: { type: "object" }, effect: "read" as const, idempotent: true,
};
let engine: EngineHandle;
let base: string;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(listProviderCommands).mockReturnValue([descriptor]);
  vi.mocked(getProviderCommand).mockReturnValue(descriptor);
  vi.mocked(runProviderCommand).mockResolvedValue({ volumes: [] });
  engine = await startEngine({ idle_timeout: 0 });
  base = `http://127.0.0.1:${engine.record.port}/v1/providers/alicloud-express/commands`;
});
afterEach(async () => { await engine.close(); });

async function api(method: string, suffix = "", body?: unknown, connection?: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${suffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${engine.record.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(connection === undefined ? {} : { "X-Abx-Connection": Buffer.from(JSON.stringify(connection)).toString("base64url") }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as unknown };
}

describe("engine provider commands", () => {
  it("discovers without invoking the provider or making a sandbox session", async () => {
    expect(await api("GET")).toEqual({ status: 200, body: { commands: [descriptor] } });
    expect(await api("GET", "/volumes.list")).toEqual({ status: 200, body: descriptor });
    expect(runProviderCommand).not.toHaveBeenCalled();
  });

  it("requires the existing engine bearer authentication", async () => {
    expect((await fetch(base)).status).toBe(401);
    expect(listProviderCommands).not.toHaveBeenCalled();
  });

  it("forwards each caller's resolved connection to the shared command API", async () => {
    const connection = { provider: "alicloud-express", provider_options: { endpoint: "https://example.test" }, region: "cn-hangzhou", access_key_id: "placeholder-id", access_key_secret: "placeholder-secret" };
    expect(await api("POST", "/volumes.list", { input: { limit: 3 } }, connection)).toEqual({ status: 200, body: { volumes: [] } });
    const { provider: _provider, ...options } = connection;
    void _provider;
    expect(runProviderCommand).toHaveBeenLastCalledWith("alicloud-express", "volumes.list", { limit: 3 }, options);
    await api("POST", "/volumes.list", { input: {}, connection: { provider: "alicloud-express", provider_options: { account: "second" } } });
    expect(runProviderCommand).toHaveBeenLastCalledWith("alicloud-express", "volumes.list", {}, { provider_options: { account: "second" } });
  });

  it("requires literal confirm true for write and delete before executing", async () => {
    for (const effect of ["write", "delete"] as const) {
      vi.mocked(getProviderCommand).mockReturnValue({ ...descriptor, effect });
      for (const confirm of [undefined, false, "true", 1]) {
        const refused = await api("POST", "/volumes.list", { input: {}, confirm });
        expect(refused.status).toBe(400);
        expect(refused.body).toMatchObject({ error: { code: "E8012" } });
      }
    }
    expect(runProviderCommand).not.toHaveBeenCalled();
    expect((await api("POST", "/volumes.list", { input: {}, confirm: true })).status).toBe(200);
    expect(runProviderCommand).toHaveBeenCalledOnce();
  });

  it("rejects path/header/body provider mismatches before discovery or execution", async () => {
    const header = { provider: "other" };
    for (const method of ["GET", "POST"]) {
      const refused = await api(method, "/volumes.list", method === "POST" ? { input: {}, connection: { provider: "alicloud-express" } } : undefined, header);
      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({ error: { code: "E8030" } });
    }
    expect((await api("POST", "/volumes.list", { input: {}, connection: header })).body).toMatchObject({ error: { code: "E8030" } });
    expect(getProviderCommand).not.toHaveBeenCalled();
    expect(runProviderCommand).not.toHaveBeenCalled();
  });

  it("preserves input validation and missing-command errors", async () => {
    vi.mocked(runProviderCommand).mockRejectedValue(new ProviderConfigError("Invalid input."));
    expect(await api("POST", "/volumes.list", { input: [] })).toMatchObject({ status: 400, body: { error: { code: "E8002" } } });
    vi.mocked(getProviderCommand).mockImplementation(() => { throw new ProviderResourceNotFoundError("Unknown command."); });
    expect(await api("GET", "/missing")).toMatchObject({ status: 404, body: { error: { code: "E8005" } } });
  });
});

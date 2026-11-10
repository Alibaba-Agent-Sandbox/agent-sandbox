/** Real executable + local HTTP server: protocol requests use the root configuration and output contract. */
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
const home = mkdtempSync(path.join(os.tmpdir(), "abx-protocol-config-"));
const entry = fileURLToPath(new URL("../../src/bin/abx.ts", import.meta.url));
const tsx = fileURLToPath(new URL("../../node_modules/tsx/dist/esm/index.mjs", import.meta.url));
afterAll(() => rmSync(home, { recursive: true, force: true }));
async function run(args: string[], env: Record<string, string>, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => execFile(process.execPath, ["--import", tsx, entry, ...args], {
    cwd, timeout: 30000, env: { PATH: process.env.PATH, HOME: cwd, USERPROFILE: cwd, NO_COLOR: "1", E2B_API_KEY: "unrelated-key", E2B_API_URL: "https://unrelated.invalid", ...env },
  }, (error, stdout, stderr) => { if (error && typeof error.code !== "number") return reject(error); resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr }); }));
}
describe("single frontend protocol configuration", () => {
  it.each(["environment", "toml", "saved-name"])("uses the selected Express %s endpoint/key and emits root JSON", async source => {
    const calls: Array<{ path: string; key: string | string[] | undefined }> = [];
    const server = createServer((request, response) => {
      calls.push({ path: request.url ?? "", key: request.headers["x-api-key"] });
      response.setHeader("content-type", "application/json"); response.end("[]");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture address");
      const endpoint = `http://127.0.0.1:${address.port}`; const cwd = mkdtempSync(path.join(home, "scoped-"));
      const env: Record<string, string> = { ABX_PROVIDER: "opensandbox", ABX_ALICLOUD_EXPRESS_SANDBOX_API_KEY: "scoped-key" };
      let target = "raw-sandbox";
      if (source === "environment") env["ABX_ALICLOUD_EXPRESS_SANDBOX_BASE_URL"] = endpoint;
      else {
        mkdirSync(path.join(cwd, ".abx"));
        writeFileSync(path.join(cwd, ".abx", "config.toml"), `[providers.alicloud-express]\nsandbox_base_url = "${endpoint}"\n`);
        if (source === "saved-name") {
          env["ABX_ALICLOUD_EXPRESS_SANDBOX_BASE_URL"] = "https://wrong-ambient.invalid";
          target = "named-instance"; const dir = path.join(cwd, ".abx", "deployments", target); mkdirSync(dir, { recursive: true });
          writeFileSync(path.join(dir, "deployment.json"), JSON.stringify({ version: 1, name: target, kind: "sandbox", provider: "alicloud-express", providerOptions: { region: "cn-shanghai" }, connection: { api_url: endpoint }, status: "ready", sandboxId: "raw-sandbox" }));
        }
      }
      const result = await run(["--json", "--provider", "alicloud-express", "sandbox", "metrics", target], env, cwd);
      expect(result.code, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toEqual([]);
      expect(calls).toEqual([{ path: "/sandboxes/raw-sandbox/metrics", key: "scoped-key" }]);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it("writes the snapshot name to the protocol body and returns one JSON value", async () => {
    let body = ""; let route = "";
    const server = createServer((request, response) => { route = request.url!; request.on("data", chunk => { body += chunk; }); request.on("end", () => { response.setHeader("content-type", "application/json"); response.end('{"snapshotID":"snap-fixture","names":["fixture"]}'); }); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture address");
      const result = await run(["--json", "sandbox", "snapshot", "create", "raw-id", "--name", "fixture"], { ABX_SANDBOX_API_KEY: "fixture-key", ABX_SANDBOX_BASE_URL: `http://127.0.0.1:${address.port}` }, home);
      expect(result.code, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toEqual({ snapshotId: "snap-fixture", names: ["fixture"] });
      expect(route).toBe("/sandboxes/raw-id/snapshots"); expect(JSON.parse(body)).toEqual({ name: "fixture" });
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

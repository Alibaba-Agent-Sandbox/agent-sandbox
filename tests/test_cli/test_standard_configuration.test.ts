/** Product-entry regressions for standard routing and provider-scoped credentials. */
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const home = mkdtempSync(path.join(os.tmpdir(), "abx-standard-config-"));
const entry = fileURLToPath(new URL("../../src/bin/abx.ts", import.meta.url));
const tsx = fileURLToPath(new URL("../../node_modules/tsx/dist/esm/index.mjs", import.meta.url));
afterAll(() => rmSync(home, { recursive: true, force: true }));

async function run(args: string[], env: Record<string, string> = {}, cwd = home): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["--import", tsx, entry, ...args], {
      cwd, timeout: 30_000,
      env: { PATH: process.env.PATH, HOME: cwd, USERPROFILE: cwd, NO_COLOR: "1", E2B_API_KEY: "placeholder-canonical", E2B_API_URL: "https://api.example.invalid", E2B_DOMAIN: "example.invalid", ...env },
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") return reject(error);
      resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
    });
  });
}

describe("standard configuration through the shipped entry", () => {
  it.each(["--json", "--quiet", "--verbose", "--no-color", "--ci", "--log-level=INFO"])(
    "rejects native root flag %s instead of selecting native create behavior", async (flag) => {
      const result = await run([flag, "sandbox", "create", "base", "--detach"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("unknown option");
      expect(result.stderr).toContain(flag.split("=")[0]);
      expect(result.stderr).not.toContain("fetch failed");
      expect(result.stderr).not.toContain("No such option: --detach");
    },
  );

  it("keeps explicit cross-provider listing on the native project route", async () => {
    const calls: Array<{ path: string; key: string | string[] | undefined }> = [];
    const server = createServer((request, response) => {
      calls.push({ path: request.url ?? "", key: request.headers["authorization"] });
      response.setHeader("content-type", "application/json");
      response.end("[]");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing local fixture address");
      const result = await run(["--json", "list", "--all-providers"], {
        ABX_SANDBOX_API_KEY: "placeholder-native-list",
        ABX_SANDBOX_BASE_URL: `http://127.0.0.1:${address.port}`,
      });
      expect(result.code, result.stderr).toBe(0);
      expect(result.stderr).not.toContain("unknown option");
      expect(calls).toHaveLength(1);
      expect(calls[0].key).toBe("Bearer placeholder-native-list");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each(["environment", "toml"])("uses the selected Express %s endpoint and key together", async (source) => {
    const calls: Array<{ path: string; key: string | string[] | undefined }> = [];
    const server = createServer((request, response) => {
      calls.push({ path: request.url ?? "", key: request.headers["x-api-key"] });
      response.setHeader("content-type", "application/json");
      response.end("[]");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing local fixture address");
      const endpoint = `http://127.0.0.1:${address.port}`;
      const cwd = mkdtempSync(path.join(home, "scoped-"));
      const env: Record<string, string> = { ABX_PROVIDER: "opensandbox" };
      if (source === "environment") {
        env["ABX_ALICLOUD_EXPRESS_SANDBOX_BASE_URL"] = endpoint;
        env["ABX_ALICLOUD_EXPRESS_SANDBOX_API_KEY"] = "placeholder-scoped";
      } else {
        mkdirSync(path.join(cwd, ".abx"));
        writeFileSync(path.join(cwd, ".abx", "config.toml"), `[providers.alicloud-express]\nsandbox_base_url = "${endpoint}"\nsandbox_api_key = "placeholder-scoped"\n`);
        // TOML is below environment configuration, so leave canonical endpoint/key unset.
        env["E2B_API_URL"] = "";
        env["E2B_API_KEY"] = "";
      }
      const result = await run(["--provider", "alicloud-express", "sandbox", "list", "--format", "json"], env, cwd);
      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([]);
      expect(calls).toHaveLength(1);
      expect(calls[0].path).toMatch(/^\/v2\/sandboxes\?/);
      expect(calls[0].key).toBe("placeholder-scoped");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

/** The official SDK must remain usable after a bundle leaves the checkout. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

it("retains the installed SDK dependency graph's attribution", () => {
  const result = spawnSync(process.execPath, ["scripts/alicloud-sdk-notices.mjs", "--check"], {
    cwd: root, encoding: "utf8", timeout: 30_000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("packages verified");
});

it("loads both lazy official SDK adapters from an isolated CommonJS bundle", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "abx-bundled-sdk-"));
  const bundle = path.join(directory, "sdk.cjs");
  try {
    await build({
      stdin: {
        contents: `
          import { _requireSdk as management } from "./src/providers/alicloud_express/sdk.ts";
          import { _requireSdk as templates } from "./src/providers/alicloud_express/fc_template.ts";
          const result = [management(), templates()].map(sdk => {
            const config = new sdk.Config({ accessKeyId: "placeholder", accessKeySecret: "placeholder", endpoint: "example.invalid" });
            const client = new sdk.Client(config);
            const request = new sdk.models.ListTeamsRequest({});
            return { client: typeof client.listTeams, request: typeof request.toMap };
          });
          process.stdout.write(JSON.stringify(result));
        `,
        resolveDir: root,
        sourcefile: "bundled-sdk-probe.ts",
        loader: "ts",
      },
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node20",
      define: { "import.meta.url": "__abx_import_meta_url" },
      banner: { js: 'const __abx_import_meta_url = require("node:url").pathToFileURL(process.execPath).href;' },
      logLevel: "silent",
    });
    const result = spawnSync(process.execPath, [bundle], {
      cwd: directory,
      env: { ...process.env, NODE_PATH: "" },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      { client: "function", request: "function" },
      { client: "function", request: "function" },
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

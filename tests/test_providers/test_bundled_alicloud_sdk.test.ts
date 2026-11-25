/** The official SDK must remain usable after a bundle leaves the checkout. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

function isolatedEnvironment(directory: string): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TMP", "TEMP", "LANG", "LC_ALL"].includes(key.toUpperCase())));
  return { ...environment, HOME: directory, USERPROFILE: directory, XDG_CONFIG_HOME: directory };
}

function checkAncestors(directory: string): void {
  for (let ancestor = fs.realpathSync(directory);; ancestor = path.dirname(ancestor)) {
    expect(fs.existsSync(path.join(ancestor, "node_modules")), ancestor).toBe(false);
    if (path.dirname(ancestor) === ancestor) break;
  }
}

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
    checkAncestors(directory);
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
      env: isolatedEnvironment(directory),
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

it("bundles the managed SDK closure without eagerly loading credential or STS", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "abx-managed-sdk-"));
  try {
    checkAncestors(directory);
    const bundle = path.join(directory, "managed.cjs");
    const result = await build({
      stdin: {
        contents: `
          import { createRegistryClient } from "./src/providers/alicloud_express/application/registry.ts";
          import { createFcTransport, resolveDeployCredentials } from "./src/providers/alicloud_express/application/fc.ts";
          globalThis.__retainedCredentialResolver = resolveDeployCredentials;
          if (globalThis.__lazySdkLoaded.length) throw new Error("Credential/STS initialization must stay lazy");
          const credential = { AccountID: "123", AccessKeyID: "placeholder", AccessKeySecret: "placeholder" };
          const registry = createRegistryClient(credential, "cn-hangzhou");
          const fc = createFcTransport(credential, "cn-hangzhou");
          process.stdout.write(JSON.stringify({ registry: typeof registry.inspect, fc: typeof fc.describeFunction,
            credentials: typeof globalThis.__retainedCredentialResolver, lazy: globalThis.__lazySdkLoaded }));
        `,
        resolveDir: root, sourcefile: "managed-sdk-probe.ts", loader: "ts",
      },
      outfile: bundle, bundle: true, platform: "node", format: "cjs", target: "node20", metafile: true,
      define: { "import.meta.url": "__abx_import_meta_url" },
      banner: { js: 'globalThis.__lazySdkLoaded=[];const __abx_import_meta_url = require("node:url").pathToFileURL(process.execPath).href;' },
      plugins: [{ name: "observe-lazy-sdk-initialization", setup(context) {
        context.onLoad({ filter: /node_modules[\\/](?:@serverless-devs[\\/]credential|@alicloud[\\/]sts20150401)[\\/].*\.js$/ }, (args) => ({
          contents: fs.readFileSync(args.path, "utf8") + `\nglobalThis.__lazySdkLoaded.push(${JSON.stringify(args.path)});`, loader: "js",
        }));
      } }],
      logLevel: "silent",
    });
    for (const dependency of ["@alicloud/fc20230330", "@alicloud/openapi-core", "@darabonba/typescript", "@serverless-devs/credential", "@alicloud/sts20150401"]) {
      expect(Object.keys(result.metafile!.inputs).some(file => file.replaceAll("\\", "/").includes(`node_modules/${dependency}/`)), dependency).toBe(true);
    }
    const executed = spawnSync(process.execPath, [bundle], { cwd: directory, env: isolatedEnvironment(directory), encoding: "utf8", timeout: 30_000 });
    expect(executed.status, executed.stderr).toBe(0);
    expect(JSON.parse(executed.stdout)).toEqual({ registry: "function", fc: "function", credentials: "function", lazy: [] });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}, 30_000);

it("constructs managed adapters through the compiled npm ESM entry points", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "abx-managed-esm-"));
  try {
    const registryUrl = pathToFileURL(path.join(root, "dist/providers/alicloud_express/application/registry.js")).href;
    const fcUrl = pathToFileURL(path.join(root, "dist/providers/alicloud_express/application/fc.js")).href;
    const script = `
      import { createRegistryClient } from ${JSON.stringify(registryUrl)};
      import { createFcTransport } from ${JSON.stringify(fcUrl)};
      const credential = { AccountID: "123", AccessKeyID: "placeholder", AccessKeySecret: "placeholder" };
      const registry = createRegistryClient(credential, "cn-hangzhou"), fc = createFcTransport(credential, "cn-hangzhou");
      process.stdout.write(JSON.stringify({ registry: typeof registry.inspect, fc: typeof fc.describeFunction }));
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: directory, env: isolatedEnvironment(directory), encoding: "utf8", timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ registry: "function", fc: "function" });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

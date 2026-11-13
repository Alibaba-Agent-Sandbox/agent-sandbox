import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { builtinModules } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = `
import * as stsModule from '@alicloud/sts20150401';
import * as credentialModule from '@serverless-devs/credential';
import { parseArgsStringToArgv } from 'string-argv';
import { nativeModuleExports } from './src/providers/alicloud_express/module_exports.ts';
import { expressResourceApi } from './src/providers/alicloud_express/resource_api.ts';
import { createFcTransport } from './src/providers/alicloud_express/application/fc.ts';
import { createRegistryClient } from './src/providers/alicloud_express/application/registry.ts';
const credential = {AccountID:'123', AccessKeyID:'fixture-ak', AccessKeySecret:'fixture-sk'};
const sts = nativeModuleExports(stsModule), reader = nativeModuleExports(credentialModule);
const stsClient = new sts.default({accessKeyId:'fixture-ak', accessKeySecret:'fixture-sk', endpoint:'sts.cn-hangzhou.aliyuncs.com'});
const credentialReader = new reader.default({logger:{debug(){}, info(){}, warn(){}, error(){}}});
console.log(JSON.stringify({
  express: typeof expressResourceApi(credential,'cn-hangzhou').call,
  fc: typeof createFcTransport(credential,'cn-hangzhou').describeFunction,
  registry: typeof createRegistryClient(credential,'cn-hangzhou').token,
  sts: typeof stsClient.getCallerIdentityWithOptions,
  credentials: typeof credentialReader.get,
  args: parseArgsStringToArgv('build --context "two words"'),
}));`;

it.each(["esm", "cjs"] as const)("constructs real SDKs through static imports in %s", async format => {
  // Native ESM resolves installed packages; the standalone CJS artifact must contain them.
  const output = fs.mkdtempSync(path.join(format === "esm" ? root : os.tmpdir(), ".abx-sdk-interop-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "abx-sdk-home-"));
  try {
    const outfile = path.join(output, `probe.${format === "esm" ? "mjs" : "cjs"}`);
    const result = await build({stdin: {contents: source, resolveDir: root, loader: "ts"}, outfile,
      bundle: true, packages: format === "esm" ? "external" : undefined, format, platform: "node",
      target: "node20", metafile: true, logLevel: "silent",
      ...(format === "cjs" ? {define: {"import.meta.url": JSON.stringify(pathToFileURL(outfile).href)}} : {})});
    expect(result.warnings).toEqual([]);
    if (format === "cjs") {
      const imports = Object.values(result.metafile.outputs).flatMap(value => value.imports).filter(value => value.external);
      // ws probes these optional native accelerators in try/catch; neither is needed by SDK construction.
      const optional = new Set(["bufferutil", "utf-8-validate"]);
      expect(imports.filter(value => !builtinModules.includes(value.path.replace(/^node:/, "")) && !optional.has(value.path))).toEqual([]);
    }
    const processResult = spawnSync(process.execPath, [outfile], {cwd: home, env: {HOME: home, USERPROFILE: home},
      encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024});
    expect(processResult.error).toBeUndefined();
    expect(processResult.status, processResult.stderr).toBe(0);
    expect(JSON.parse(processResult.stdout)).toEqual({express: "function", fc: "function", registry: "function",
      sts: "function", credentials: "function", args: ["build", "--context", "two words"]});
  } finally {
    fs.rmSync(output, {recursive: true, force: true});
    fs.rmSync(home, {recursive: true, force: true});
  }
});

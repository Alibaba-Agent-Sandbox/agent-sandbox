#!/usr/bin/env node
/** Explicit owned-template cache CRUD through the actual CLI, with independent official-SDK cleanup reads. */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { loadCredentials, makeMasker } from "./lib/env.mjs";
import { parseBin, runBinary } from "./lib/exec.mjs";

const credentials = loadCredentials();
const team = process.env.ABX_SKILL_CACHE_TEAM_ID;
const template = process.env.ABX_SKILL_CACHE_TEMPLATE_ID;
assert.ok(team && template, "Set explicit ABX_SKILL_CACHE_TEAM_ID and ABX_SKILL_CACHE_TEMPLATE_ID for a task-owned ready template");
assert.ok(credentials.ALICLOUD_ACCESS_KEY_ID && credentials.ALICLOUD_ACCESS_KEY_SECRET, "Actual AK/SK are required");
const index = process.argv.indexOf("--output");
assert.ok(index >= 0 && process.argv[index + 1], "Pass --output NEW_JSON_RECEIPT");
const output = resolve(process.argv[index + 1]); assert.ok(!existsSync(output), "Choose a new evidence file");
const mask = makeMasker(credentials);
const require = createRequire(import.meta.url);
const sdk = require("@alicloud/sandbox20260820");
const core = require("@alicloud/openapi-core");
const region = credentials.ALIBABA_CLOUD_REGION_ID || "cn-hangzhou";
const client = new sdk.default(new core.$OpenApiUtil.Config({ accessKeyId: credentials.ALICLOUD_ACCESS_KEY_ID,
  accessKeySecret: credentials.ALICLOUD_ACCESS_KEY_SECRET, endpoint: `sandbox.${region}.aliyuncs.com`, retryOptions: { retryable: false } }));
const runtime = { autoretry: false, maxAttempts: 1, readTimeout: 30_000, connectTimeout: 20_000 };
const root = mkdtempSync(join(tmpdir(), "abx-skill-cache-"));
const input = join(root, "request.json"); writeFileSync(input, JSON.stringify({ team_id: team, template_id: template }), { mode: 0o600 });
const report = { api: "2026-08-20", team_id: team, template_id: template, checks: [], observations: [],
  scope: "Actual CLI Provider command cache CRUD, no latency/cost SLA or WarmPool claim" };
const save = () => writeFileSync(output, mask(JSON.stringify(report, null, 2)) + "\n", { mode: 0o600 });
const check = (name, passed, detail = {}) => { report.checks.push({ name, passed, ...detail }); save(); assert.ok(passed, name); };
const request = async (operation, write = false) => {
  const result = await runBinary({ bin: parseBin(process.env.ABX_BIN || `${process.execPath} ${resolve("dist/bin/abx.js")}`),
    argv: ["--json", "provider", "command", "run", "alicloud-express", operation, "--input-file", input, ...(write ? ["--yes"] : [])],
    env: { ...process.env, ...credentials, ABX_PROVIDER_UPDATE_CHECK: "0" }, cwd: root, timeoutMs: 90_000 });
  let value; try { value = JSON.parse(result.stdout); } catch { throw new Error(`Invalid JSON from ${operation} (exit ${result.code}); raw output withheld`); }
  return { ...result, value };
};
const describe = () => client.describeTemplateCacheWithOptions(template, new sdk.DescribeTemplateCacheRequest({ teamID: team }), {}, runtime);
const notFound = error => Number(error?.statusCode ?? error?.data?.statusCode) === 404;
const pause = ms => new Promise(done => setTimeout(done, ms));
let submitted = false; let failure;
save();
try {
  let absent = false; try { await describe(); } catch (error) { if (!notFound(error)) throw error; absent = true; }
  check("independent-existing-cache-absent", absent);
  const initial = await request("template-cache.get");
  check("cli-get-absent-not-found", initial.code === 4 && initial.value.code === "E8005");
  submitted = true; save();
  const created = await request("template-cache.create", true);
  check("cli-cache-create", created.code === 0 && created.value.data?.team_id === team && created.value.data?.template_id === template,
    { returned_status: created.value.data?.status ?? null });
  const deadline = Date.now() + 300_000; let ready = false;
  while (Date.now() < deadline) {
    const got = await request("template-cache.get"); assert.equal(got.code, 0, "Actual CLI cache get failed");
    const cache = got.value.data; report.observations.push({ status: cache.status ?? null, progress: cache.progress ?? null, image_size_mb: cache.image_size_mb ?? null }); save();
    if (cache.status === "ready") { ready = true; break; }
    assert.ok(!["failed", "error", "evicted"].includes(cache.status), "Cache reached a terminal failure state");
    await pause(2000);
  }
  check("cli-observed-cache-ready", ready);
  const listed = await request("template-cache.list");
  check("cli-cache-list-match", listed.code === 0 && listed.value.data.template_caches.some(cache => cache.team_id === team && cache.template_id === template),
    { next_token: listed.value.data?.next_token ?? null });
} catch (error) { failure = error; report.failure = mask(String(error.message)); save(); }
finally {
  if (submitted) {
    try {
      const deleted = await request("template-cache.delete", true);
      check("cli-cache-delete", deleted.code === 0 && typeof deleted.value.data?.deleted === "boolean");
      let absent = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        try { await describe(); } catch (error) { assert.ok(notFound(error), "Independent cache readback failed with a non404 error"); absent = true; break; }
        await pause(2000);
      }
      check("independent-cache-get404", absent);
      const listed = await client.listTemplateCacheWithOptions(new sdk.ListTemplateCacheRequest({ teamID: team, templateID: template, maxResults: 100 }), {}, runtime);
      check("independent-cache-inventory-absent", !listed.body.templateCaches.some(cache => cache.templateID === template));
      const repeated = await request("template-cache.delete", true);
      check("cli-cache-delete-already-absent", repeated.code === 0 && repeated.value.data?.deleted === false);
    } catch (error) { failure ||= error; report.cleanup_error = mask(String(error.message)); save(); }
  }
  report.passed = !failure && report.checks.every(row => row.passed); save();
  if (!report.cleanup_error) rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length }));
if (failure) { console.error(mask(String(failure.message))); process.exitCode = 1; }

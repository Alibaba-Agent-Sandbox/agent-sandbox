#!/usr/bin/env node
/** Real Express whole-template startup, with exact cleanup from the CLI resource journal. */
import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadCredentials, makeMasker} from "./lib/env.mjs";
import {baseEnv, runBinary, parseBin} from "./lib/exec.mjs";
const creds = loadCredentials();
const key = process.env.ABX_SANDBOX_API_KEY || creds.E2B_API_KEY;
const origin = process.env.ABX_SANDBOX_BASE_URL || creds.E2B_API_URL;
assert.ok(key && origin, "Sandbox credentials and endpoint are required");
const root = mkdtempSync(join(tmpdir(), "abx-whole-template-"));
const home = join(root, "home"); mkdirSync(home);
const env = baseEnv({home, creds, extra: {ABX_NO_KEYCHAIN: "1", ABX_SANDBOX_API_KEY: key, ABX_SANDBOX_BASE_URL: origin, ABX_SANDBOX_DOMAIN: process.env.ABX_SANDBOX_DOMAIN || creds.E2B_DOMAIN}});
const mask = makeMasker(creds, [key, origin]);
const bin = parseBin(process.env.ABX_BIN || `${process.execPath} ${new URL("../dist/bin/abx.js", import.meta.url).pathname}`);
const run = argv => runBinary({bin, argv, env, cwd: root, timeoutMs: 660000});
const api = (path, method = "GET") => fetch(`${origin.replace(/\/$/, "")}${path}`, {method, headers: {"X-API-Key": key}, signal: AbortSignal.timeout(30000)});
const journalRoot = join(home, ".abx", "resource-journal");
const journals = () => existsSync(journalRoot) ? readdirSync(journalRoot).filter(name => name.endsWith(".json")).flatMap(name => JSON.parse(readFileSync(join(journalRoot, name), "utf8")).entries) : [];
let failure;
let cleaned = false;
try {
  for (const mode of process.argv.includes("--managed-only") ? ["managed"] : ["managed", "source"]) {
    const directory = join(root, mode); mkdirSync(directory);
    const manifest = mode === "managed" ? {name: "managed-base", spec_version: 5, provides: {}, provider: "alicloud-express", template_id: "base"} : {
      name: "whole-template-source", spec_version: 5, generation: 2,
      base: "fc-e2b-registry.cn-hangzhou.cr.aliyuncs.com/runtime/base:v0.0.49", resources: {cpu: 2, memory: 2048},
      build: {mode: "steps", run: ["printf whole-template-ready > /tmp/abx-whole-template-marker"]},
      start_cmd: "python3 -m http.server 9101 --bind 0.0.0.0 >/tmp/abx-first.log 2>&1 & python3 -m http.server 9102 --bind 0.0.0.0 >/tmp/abx-second.log 2>&1 & wait",
      ready_cmd: "python3 -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:9101'); urllib.request.urlopen('http://127.0.0.1:9102')\"",
      provides: {first: {protocol: "http", version: 1, port: 9101, operations: []}, second: {protocol: "http", version: 1, port: 9102, operations: []}},
    };
    writeFileSync(join(directory, "template.yaml"), JSON.stringify(manifest));
    const launched = await run(["--provider", "alicloud-express", "--json", "template", "launch", directory, "--yes", "--timeout", "600"]);
    if (launched.code !== 0) throw new Error(`${mode} launch failed (exit ${launched.code}); raw response withheld`);
    let result;
    try {result = JSON.parse(launched.stdout);} catch {throw new Error(`${mode} launch returned invalid JSON; raw response withheld`);}
    assert.ok(result.sandbox_id, "launch must return its sandbox ID");
    assert.deepEqual(Object.keys(result.services), Object.keys(manifest.provides));
    const command = mode === "source" ? "test $(cat /tmp/abx-whole-template-marker) = whole-template-ready" : "printf whole-template-ready";
    const execution = await run(["--native", "--provider", "alicloud-express", "--json", "exec", result.sandbox_id, command]);
    if (execution.code !== 0) throw new Error(`${mode} remote command failed: ${mask(execution.stderr || execution.stdout).replace(/https?:\/\/[^\s"<>]+/g, "[URL]").slice(0, 1200)}`);
    console.log(`${mode}: launch, complete service map and remote execution PASS`);
  }
} catch (error) { failure = error; }
finally {
  try {
    const records = journals();
    for (const entry of records.filter(entry => entry.kind === "sandbox" && entry.id)) {
      const deleted = await api(`/sandboxes/${encodeURIComponent(entry.id)}`, "DELETE");
      assert.ok(deleted.ok || deleted.status === 404, "sandbox delete must be accepted");
      const absent = await api(`/sandboxes/${encodeURIComponent(entry.id)}`);
      assert.equal(absent.status, 404, "owned sandbox must be absent");
    }
    const templates = records.filter(entry => entry.kind === "template" && entry.id);
    if (templates.length) {
      const fc = await import("../dist/providers/alicloud_express/fc_template.js");
      const config = {access_key_id: creds.ALICLOUD_ACCESS_KEY_ID, access_key_secret: creds.ALICLOUD_ACCESS_KEY_SECRET, region: creds.ALIBABA_CLOUD_REGION_ID || "cn-hangzhou"};
      for (const entry of templates) await fc.deleteTemplate(entry.id, config);
      const inventory = await fc.listOfficialTemplates(config);
      for (const entry of templates) assert.ok(!inventory.some(item => (item.templateID ?? item.templateId ?? item.id) === entry.id), "owned template must be absent");
    }
    assert.ok(!records.some(entry => !entry.id && ["intent", "uncertain"].includes(entry.state)), "unresolved resource intent requires reconciliation");
    cleaned = true; console.log("owned sandbox/template cleanup: PASS (independent absence checks)");
  } catch { console.error("cleanup: BLOCKED; isolated journals retained for exact resource reconciliation"); process.exitCode = 1; }
  if (cleaned) rmSync(root, {recursive: true, force: true});
}
if (failure) {console.error(failure.message); process.exitCode = 1;}

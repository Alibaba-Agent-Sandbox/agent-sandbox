#!/usr/bin/env node
/** Real OCI/platform-step builds, business artifacts, rollback and failure diagnosis; owned cleanup in finally. */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadCredentials, makeMasker } from "./lib/env.mjs";
import { parseBin, runBinary } from "./lib/exec.mjs";
import * as fc from "../dist/providers/alicloud_express/fc_template.js";

const outputIndex = process.argv.indexOf("--output");
assert.ok(outputIndex >= 0 && process.argv[outputIndex + 1], "Pass --output NEW_JSON_EVIDENCE_FILE");
const output = resolve(process.argv[outputIndex + 1]);
assert.ok(!existsSync(output), "Evidence exists; select a new output path");
const sourceId = process.env.ABX_SKILL_SOURCE_TEMPLATE_ID;
assert.ok(sourceId, "ABX_SKILL_SOURCE_TEMPLATE_ID must identify an existing ready generation-2 source; it is read only");
const credentials = loadCredentials();
assert.ok(credentials.ALICLOUD_ACCESS_KEY_ID && credentials.ALICLOUD_ACCESS_KEY_SECRET && credentials.E2B_API_KEY && credentials.E2B_API_URL,
  "Real AK/SK and sandbox API key/origin are required");
const mask = makeMasker(credentials);
const options = { access_key_id: credentials.ALICLOUD_ACCESS_KEY_ID, access_key_secret: credentials.ALICLOUD_ACCESS_KEY_SECRET,
  region: credentials.ALIBABA_CLOUD_REGION_ID || "cn-hangzhou" };
options.team_id = await fc.getTeamId(options.access_key_id, options.access_key_secret, options.region);
const source = await fc.getTemplate(sourceId, options);
const runtime = source.runtimeConfig;
const config = runtime?.sandboxConfig;
assert.equal(String(source.status?.state).toLowerCase(), "ready");
assert.equal(config?.generation, 2, "Platform RUN steps require generation 2");
assert.ok(typeof config.image === "string" && config.image && !/[<>]/.test(config.image), "Use an actual OCI image");
assert.ok(!config.registryConfig && !config.acrInstanceId, "This fixture does not copy private registry credentials/configuration");
const sdk = fc._requireSdk();
const control = new sdk.Client(new sdk.Config({ accessKeyId: options.access_key_id, accessKeySecret: options.access_key_secret,
  regionId: options.region, endpoint: `fcsandbox.${options.region}.aliyuncs.com` }));
const root = mkdtempSync(join(tmpdir(), "abx-skill-template-"));
const prefix = process.env.ABX_SKILL_RUN_PREFIX || "skills-accept";
assert.match(prefix, /^[a-z0-9][a-z0-9-]{0,31}$/, "Run prefix must use lowercase letters, digits or hyphens (at most 32 characters)");
const run = `${prefix}-${randomBytes(8).toString("hex")}`;
const report = { run, source_image_sha256: createHash("sha256").update(config.image).digest("hex"), checks: [], templates: [], sandboxes: [],
  scope: "OCI source + generation-2 platform RUN build; explicit template-ID selection and rollback; not Dockerfile-local or external VM snapshot acceptance" };
const save = () => writeFileSync(output, mask(JSON.stringify(report, null, 2)) + "\n", { mode: 0o600 });
const check = (name, passed, details = {}) => {
  const row = { name, passed, ...details }; report.checks.push(row); save(); console.log(mask(JSON.stringify(row)));
  assert.ok(passed, name);
};
const request = (argv) => runBinary({ bin: parseBin(process.env.ABX_BIN || `${process.execPath} ${resolve("dist/bin/abx.js")}`),
  argv, env: { ...process.env, ...credentials, ABX_PROVIDER_UPDATE_CHECK: "0" }, cwd: root, timeoutMs: 180_000 });
const platform = async (path, init = {}) => fetch(credentials.E2B_API_URL.replace(/\/$/, "") + path, {
  ...init, headers: { "X-API-Key": credentials.E2B_API_KEY, ...init.headers }, signal: AbortSignal.timeout(30_000), redirect: "error",
});
const inventory = () => fc.listOfficialTemplates(options);
const get = id => control.getTemplate(id, new sdk.models.GetTemplateRequest({ teamID: options.team_id }));
const status = error => Number(error?.statusCode ?? error?.data?.statusCode ?? 0);
let failure;
save();
try {
  for (const version of ["v1", "v2", "bad"]) {
    const name = `${run}-${version}`;
    const directory = join(root, version); mkdirSync(directory);
    const command = version === "bad" ? "echo expected-build-failure-exit42 >&2; exit 42" :
      `mkdir -p /opt/abx-acceptance && printf '%s' '${version}' > /opt/abx-acceptance/version && python3 -c 'import json; print(json.dumps({"result":sum(x*x for x in range(1,11))}))' > /opt/abx-acceptance/business.json`;
    const lines = ["spec_version: 5", "provides: {}", `name: ${name}`, `base: ${JSON.stringify(config.image)}`, "generation: 2",
      "resources:", "  cpu: 2", "  memory: 2048", "build:", "  mode: steps", "  steps:", "    - type: RUN", "      args:",
      `        - ${JSON.stringify(command)}`, "        - root"];
    if (config.startCommand) lines.push(`start_cmd: ${JSON.stringify(config.startCommand)}`);
    if (config.readyCommand) lines.push(`ready_cmd: ${JSON.stringify(config.readyCommand)}`);
    writeFileSync(join(directory, "template.yaml"), lines.join("\n") + "\n");
    assert.ok(!(await inventory()).some(t => t.name === name), "Unique owned template already exists");
    const owned = { version, name, submitted: true }; report.templates.push(owned); save();
    const deployed = await request(["--native", "--json", "template", "deploy", directory, "--build", "steps", "--yes", "--alias", name, "--team-id", options.team_id]);
    if (deployed.code !== 0) throw new Error(`CLI deployment failed (exit ${deployed.code}); inspect the sanitized CLI diagnostic separately`);
    const result = JSON.parse(deployed.stdout); owned.id = result.TemplateID; save();
    check(`register-${version}`, typeof owned.id === "string" && result["Build mode"] === "steps");
    if (version === "bad") {
      let diagnosed = false;
      try { await fc.waitForTemplateReady(owned.id, { ...options, timeout: 480, poll_interval: 3 }); }
      catch (error) {
        diagnosed = error.code === "E7010" && /exited with code 42/.test(error.message) && /expected-build-failure-exit42/.test(error.message);
      }
      const actual = await fc.getTemplate(owned.id, options);
      check("build-failure-correctly-diagnosed", diagnosed && String(actual.status?.state).toLowerCase() === "error", { expected_exit_code: 42 });
    } else {
      await fc.waitForTemplateReady(owned.id, { ...options, timeout: 480, poll_interval: 3 });
      const actual = await fc.getTemplate(owned.id, options);
      check(`ready-${version}`, actual.runtimeConfig?.sandboxConfig?.generation === 2 && String(actual.status?.state).toLowerCase() === "ready");
    }
  }
  for (const version of ["v1", "v2", "v1"]) {
    const template = report.templates.find(t => t.version === version);
    const owned = { version, template_id: template.id, submitted: true }; report.sandboxes.push(owned); save();
    const created = await request(["--native", "--json", "create", template.id, "--timeout", "180", "--metadata", `skills_accept_run=${run}`]);
    assert.equal(created.code, 0, "Native CLI create failed; source must be a valid spec-5 manifest");
    owned.id = JSON.parse(created.stdout).ID; assert.ok(typeof owned.id === "string"); save();
    const execution = await request(["sandbox", "exec", owned.id, "sh", "-c", "cat /opt/abx-acceptance/version; printf '\\n'; cat /opt/abx-acceptance/business.json"]);
    const lines = execution.stdout.trim().split("\n");
    check(`business-artifact-${version}`, execution.code === 0 && lines[0] === version && JSON.parse(lines[1]).result === 385,
      { business_result: 385, artifact_sha256: createHash("sha256").update(lines[1] + "\n").digest("hex") });
    const killed = await platform(`/sandboxes/${encodeURIComponent(owned.id)}`, { method: "DELETE" });
    assert.ok(killed.ok || killed.status === 404);
    owned.absent = (await platform(`/sandboxes/${encodeURIComponent(owned.id)}`)).status === 404;
    check(`sandbox-cleanup-${version}`, owned.absent);
  }
} catch (error) {
  failure = error; report.failure = mask(String(error.message)); save();
} finally {
  for (const owned of report.sandboxes) {
    try {
      if (!owned.id) {
        const listed = await platform("/sandboxes?state=running%2Cpaused&limit=100");
        assert.ok(listed.ok); const rows = await listed.json();
        const matches = rows.filter(row => row.metadata?.skills_accept_run === run);
        assert.equal(matches.length, 1, "Unknown sandbox submission outcome; owned-only reconciliation is required");
        owned.id = matches[0].sandboxID;
      }
      if (!owned.absent) {
        const current = await platform(`/sandboxes/${encodeURIComponent(owned.id)}`);
        if (current.status !== 404) {
          assert.equal(current.status, 200); const data = await current.json();
          assert.equal(data.metadata?.skills_accept_run, run, "Exact sandbox ownership mismatch");
          const deleted = await platform(`/sandboxes/${encodeURIComponent(owned.id)}`, { method: "DELETE" });
          assert.ok(deleted.ok || deleted.status === 404);
        }
        owned.absent = (await platform(`/sandboxes/${encodeURIComponent(owned.id)}`)).status === 404;
      }
      assert.ok(owned.absent);
    } catch (error) { owned.cleanup_error = mask(String(error.message)); failure ||= error; }
    save();
  }
  for (const owned of report.templates) {
    try {
      if (!owned.id) {
        const matches = (await inventory()).filter(t => t.name === owned.name);
        assert.equal(matches.length, 1, "Unknown template submission outcome; inspect owned-only intent before repeating a write");
        owned.id = matches[0].templateID;
      }
      const before = await get(owned.id); assert.equal(before.body.name, owned.name, "Exact template ownership mismatch");
      await control.deleteTemplate(owned.id, new sdk.models.DeleteTemplateRequest({ teamID: options.team_id }));
      try { await get(owned.id); owned.get404 = false; } catch (error) { owned.get404 = status(error) === 404; }
      owned.inventory_absent = !(await inventory()).some(t => t.templateID === owned.id || t.name === owned.name);
      check(`template-cleanup-${owned.version}`, owned.get404 && owned.inventory_absent);
    } catch (error) { owned.cleanup_error = mask(String(error.message)); failure ||= error; save(); }
  }
  report.passed = !failure && report.checks.every(row => row.passed); save();
  if (report.templates.every(t => t.get404 && t.inventory_absent) && report.sandboxes.every(s => s.absent)) rmSync(root, { recursive: true, force: true });
}
if (failure) { console.error(mask(String(failure.message))); process.exitCode = 1; }

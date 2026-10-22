#!/usr/bin/env node
/** Real Express steps deployment from a verified public source, with no ACR/Docker and exact owned-resource cleanup. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCredentials, makeMasker } from "./lib/env.mjs";
import { baseEnv, parseBin, runBinary } from "./lib/exec.mjs";

const inspect = process.argv.includes("--inspect");
const credentials = loadCredentials();
const accessKeyId = credentials.ALICLOUD_ACCESS_KEY_ID;
const accessKeySecret = credentials.ALICLOUD_ACCESS_KEY_SECRET;
const sandboxKey = process.env.ABX_SANDBOX_API_KEY || credentials.E2B_API_KEY;
assert.ok(accessKeyId && accessKeySecret, "Real Alibaba Cloud AccessKeys are required");
if (!inspect) assert.ok(sandboxKey, "A Sandbox API key is required to verify the deployed build marker");
assert.ok(existsSync(new URL("../dist/providers/alicloud_express/fc_template.js", import.meta.url)), "Build the CLI before running this acceptance test");
const fc = await import("../dist/providers/alicloud_express/fc_template.js");
const sdk = fc._requireSdk();
const region = credentials.ALIBABA_CLOUD_REGION_ID || "cn-hangzhou";
const client = new sdk.Client(new sdk.Config({ accessKeyId, accessKeySecret, regionId: region, endpoint: `fcsandbox.${region}.aliyuncs.com` }));
const deadline = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));
const statusCode = (error) => Number(error?.statusCode ?? error?.data?.statusCode ?? 0);
const safe = async (stage, operation) => {
  try { return await operation(); }
  catch (error) {
    // SDK causes may contain registry details or credentials; preserve only the safe failure category.
    // eslint-disable-next-line preserve-caught-error -- Never attach raw private SDK response bodies to stderr.
    throw new Error(`${stage} failed${statusCode(error) ? ` (HTTP ${statusCode(error)})` : ""}; response details withheld`);
  }
};
const team = await safe("Resolve the current team", () => fc.getTeamId(accessKeyId, accessKeySecret, region));
const get = id => client.getTemplate(id, new sdk.models.GetTemplateRequest({ teamID: team }));
const inventory = () => fc.listOfficialTemplates({ access_key_id: accessKeyId, access_key_secret: accessKeySecret, region, team_id: team });
// Resolve the standard public alias to its actual ID before the official, team-scoped detail request.
const sourceReference = process.env.ABX_GUIDED_STEPS_SOURCE_TEMPLATE_ID || "code-interpreter-v1";
const sandboxOrigin = credentials.E2B_API_URL || process.env.ABX_SANDBOX_BASE_URL || (credentials.E2B_DOMAIN ? `https://api.${credentials.E2B_DOMAIN}` : null);
assert.ok(sandboxOrigin && sandboxKey, "A configured Sandbox endpoint/key is required to resolve and verify the existing public source");
const api = (path, options = {}) => fetch(`${sandboxOrigin.replace(/\/$/, "")}${path}`, {
  ...options, headers: { "X-API-Key": sandboxKey, ...options.headers }, redirect: "error", signal: AbortSignal.timeout(30_000),
});
const publicResponse = await safe("Resolve the known public source reference", () => api(`/templates/${encodeURIComponent(sourceReference)}`));
assert.equal(publicResponse.status, 200, "The known public source is not accessible");
const publicSource = await safe("Read the known public source metadata", () => publicResponse.json());
assert.ok(publicSource.public === true && typeof publicSource.templateID === "string", "The source must be an existing public template with an actual ID");
const sourceResponse = await safe("Read the verified template by actual ID", () => get(publicSource.templateID));
const source = sourceResponse.body?.toMap?.() ?? {};
const runtime = source.runtimeConfig;
const config = runtime?.sandboxConfig;
assert.ok(String(source.status?.state).toLowerCase() === "ready", "The known source template must be ready");
assert.ok([1, 2].includes(config?.generation) && typeof config.image === "string" && config.image && !/[<>]/.test(config.image), "The known source must declare an actual image and generation 1 or 2");
const hasPrivateConfiguration = value => value && typeof value === "object" ? Object.values(value).some(hasPrivateConfiguration) : Boolean(value);
assert.ok(!hasPrivateConfiguration(config.registryConfig) && !config.acrInstanceId, "Source requires registry configuration; do not copy its private credentials or network settings");
assert.ok(config.generation !== 1 || !config.startCommand && !config.readyCommand, "Cannot transplant unsupported generation-1 startup/readiness overrides");
assert.ok(Number.isFinite(runtime.cpu) && runtime.cpu > 0 && Number.isFinite(runtime.memorySize) && runtime.memorySize > 0, "The source must declare usable resources");
if (inspect) {
  console.log(`PASS: verified public source exposes a ready generation-${config.generation} image and resources without private registry configuration (values withheld)`);
  if (config.generation !== 2) console.log("BLOCKED: this generation-1 source cannot execute platform RUN steps; the platform requires a verified generation-2 source");
  process.exit(0);
}
assert.equal(config.generation, 2, "BLOCKED: platform RUN steps require an existing verified public generation-2 source; no cloud write was attempted");

const root = mkdtempSync(join(tmpdir(), "abx-guided-steps-"));
const stateFile = join(root, "owned-state.json");
const home = join(root, "home");
const directory = join(root, "project");
const noTools = join(root, "no-local-tools");
for (const path of [home, directory, noTools]) mkdirSync(path);
const alias = `abx-guided-steps-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
const marker = `steps-${randomBytes(12).toString("hex")}`;
const mask = makeMasker(credentials, [accessKeyId, accessKeySecret, sandboxKey, sandboxOrigin, config.image, source.name, publicSource.templateID, team, alias, marker,
  ...(Array.isArray(publicSource.aliases) ? publicSource.aliases.filter(value => typeof value === "string") : []),
  ...(Array.isArray(publicSource.names) ? publicSource.names.filter(value => typeof value === "string") : [])]);
const deployDiagnostic = result => {
  let error;
  try { const value = JSON.parse(result.stdout); error = value.error ?? value; } catch { /* Raw output is never printed. */ }
  const message = typeof error?.message === "string" ? mask(error.message).replace(/https?:\/\/[^\s"<>]+/g, "[URL]").slice(0, 1500) : "No structured error message; raw output withheld";
  const code = typeof error?.code === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(error.code) ? error.code : "unknown";
  return { stage: "steps-deploy", exit: result.code, code, message };
};
const binary = parseBin(process.env.ABX_BIN || "abx");
const base = { ALICLOUD_ACCESS_KEY_ID: accessKeyId, ALICLOUD_ACCESS_KEY_SECRET: accessKeySecret, ALIBABA_CLOUD_REGION_ID: region };
const deployEnvironment = baseEnv({ home, creds: base, extra: { PATH: noTools, ABX_NO_KEYCHAIN: "1", ABX_PROVIDER: "alicloud-express" } });
const sandboxEnvironment = baseEnv({ home, creds: { ...base, E2B_API_KEY: sandboxKey, ABX_SANDBOX_API_KEY: sandboxKey,
  E2B_API_URL: sandboxOrigin, ABX_SANDBOX_BASE_URL: sandboxOrigin,
  ...(credentials.E2B_DOMAIN ? { E2B_DOMAIN: credentials.E2B_DOMAIN, ABX_SANDBOX_DOMAIN: credentials.E2B_DOMAIN } : {}) },
  extra: { ABX_NO_KEYCHAIN: "1", ABX_PROVIDER: "alicloud-express" } });
assert.ok(!deployEnvironment.ACR_NAMESPACE && !deployEnvironment.ACR_USERNAME && !deployEnvironment.ACR_PASSWORD && !deployEnvironment.E2B_API_KEY && !deployEnvironment.ABX_SANDBOX_API_KEY);
const yaml = [
  `name: ${alias}`, `base: ${JSON.stringify(config.image)}`, `generation: ${config.generation}`, "resources:", `  cpu: ${runtime.cpu}`, `  memory: ${runtime.memorySize}`,
  "build:", "  mode: steps", "  run:", `    - ${JSON.stringify(`printf '%s' '${marker}' > /tmp/abx-guided-steps-marker`)}`,
];
if (config.startCommand) yaml.push(`start_cmd: ${JSON.stringify(config.startCommand)}`);
if (config.readyCommand) yaml.push(`ready_cmd: ${JSON.stringify(config.readyCommand)}`);
writeFileSync(join(directory, "template.yaml"), yaml.join("\n") + "\n", { mode: 0o600 });
let template;
let sandbox;
let submitted = false;
let sandboxSubmitted = false;
let sourceSandbox;
let sourceSubmitted = false;
let failure;
let cleanupFailure;
const validSandboxId = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{5,}$/.test(value);
const validTemplateId = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{2,255}$/.test(value);
const persistOwnedState = () => writeFileSync(stateFile, JSON.stringify({ alias, template, sandbox, submitted, sandboxSubmitted,
  sourceTemplate: publicSource.templateID, sourceSandbox, sourceSubmitted }), { mode: 0o600 });
const request = (argv, env, timeoutMs = 180_000) => runBinary({ bin: binary, argv, env, cwd: directory, timeoutMs });
const ownedTemplates = async () => (await inventory()).filter(value => value.name === alias);
const templateReferences = new Map();
const isTemplateReference = async (reference, expected) => {
  if (reference === expected) return true;
  if (typeof reference !== "string" || !reference) return false;
  if (!templateReferences.has(reference)) {
    const response = await safe("Resolve the runtime template reference", () => api(`/templates/${encodeURIComponent(reference)}`));
    assert.equal(response.status, 200, "Runtime template reference could not be resolved");
    const value = await safe("Read the runtime template reference", () => response.json());
    templateReferences.set(reference, value.templateID);
  }
  return templateReferences.get(reference) === expected;
};
const cleanupSandboxes = async (templateReference, runAlias, known) => {
  const listed = await request(["sandbox", "list", "--template", templateReference, "--metadata", `abx_guided_steps_run=${runAlias}`, "--format", "json", "--limit", "0", "--state", "running,paused"], sandboxEnvironment, 60_000);
  assert.equal(listed.code, 0, "Could not reconcile the owned sandbox inventory");
  let values;
  try { values = JSON.parse(listed.stdout); } catch { assert.fail("Owned sandbox inventory is not a JSON array"); }
  assert.ok(Array.isArray(values), "Owned sandbox inventory must be an array");
  // Some backends return aliases as template IDs or ignore server-side list filters.
  // Restrict metadata locally, then resolve the actual runtime reference before trusting an ID.
  const owned = values.filter(item => item.metadata?.abx_guided_steps_run === runAlias);
  for (const item of owned) {
    assert.ok(validSandboxId(item.sandboxId) && await isTemplateReference(item.templateId, templateReference), "Owned sandbox inventory has an invalid ID or unexpected template");
  }
  const ids = new Set([...owned.map(item => item.sandboxId), ...(known ? [known] : [])]);
  assert.ok(ids.size, "Sandbox submission outcome is unknown; do not claim confirmed cleanup");
  for (const id of ids) {
    assert.ok(validSandboxId(id), "Refusing an invalid sandbox cleanup ID");
    const current = await safe("Verify the exact owned sandbox before deletion", () => api(`/sandboxes/${encodeURIComponent(id)}`));
    if (current.status === 404) continue;
    assert.equal(current.status, 200, "Could not verify the exact owned sandbox");
    const detail = await safe("Read the exact owned sandbox metadata", () => current.json());
    const runMetadata = detail.metadata?.abx_guided_steps_run;
    const metadataMatches = runMetadata === runAlias || id === known && runMetadata === undefined;
    assert.ok(detail.sandboxID === id && metadataMatches && await isTemplateReference(detail.templateID, templateReference), "Exact sandbox ID, metadata or template ownership does not match");
    const killed = await request(["sandbox", "kill", "--", id], sandboxEnvironment, 60_000);
    assert.equal(killed.code, 0, "Owned sandbox deletion failed");
    const response = await safe("Read back owned sandbox absence", () => api(`/sandboxes/${encodeURIComponent(id)}`));
    assert.equal(response.status, 404, "Independent readback did not confirm sandbox absence");
  }
};
try {
  sourceSubmitted = true;
  persistOwnedState();
  const sourceCreated = await request(["--native", "--json", "create", publicSource.templateID, "--timeout", "60", "--metadata", `abx_guided_steps_run=${alias}-source`], sandboxEnvironment);
  assert.equal(sourceCreated.code, 0, "Existing public source did not create a sandbox; response withheld");
  let sourceCreatedResult;
  try { sourceCreatedResult = JSON.parse(sourceCreated.stdout); } catch { throw new Error("Source create did not return one JSON document"); }
  sourceSandbox = sourceCreatedResult.ID;
  assert.ok(validSandboxId(sourceSandbox), "Source create did not return a single sandbox ID");
  persistOwnedState();
  const sourceExecution = await request(["sandbox", "exec", sourceSandbox, "printf", "verified-public-source-ok"], sandboxEnvironment, 60_000);
  assert.equal(sourceExecution.code, 0, "The existing public generation-2 source could not execute");
  assert.equal(sourceExecution.stdout, "verified-public-source-ok", "The existing public source returned unexpected output");
  await cleanupSandboxes(publicSource.templateID, `${alias}-source`, sourceSandbox);
  sourceSubmitted = false;
  persistOwnedState();
  console.log("PASS: existing public generation-2 source creates and executes; its owned sandbox is deleted with independent GET404");
  assert.equal((await safe("Inspect the pre-deploy inventory", ownedTemplates)).length, 0, "The unique owned alias unexpectedly exists");
  submitted = true;
  persistOwnedState();
  const deployed = await request(["--native", "--json", "template", "deploy", directory, "--build", "steps", "--yes", "--alias", alias, "--team-id", team, ...(runtime.diskSize ? ["--disk-size", String(runtime.diskSize)] : [])], deployEnvironment);
  if (deployed.code !== 0) {
    console.error(JSON.stringify(deployDiagnostic(deployed)));
    throw new Error(`Steps deployment exited ${deployed.code}; the exact owned alias will be reconciled without replaying submission`);
  }
  let result;
  try { result = JSON.parse(deployed.stdout); } catch { throw new Error("Steps deploy did not return exactly one JSON result"); }
  template = result.TemplateID;
  assert.ok(validTemplateId(template), "Deployment returned no valid template ID");
  persistOwnedState();
  assert.equal(result["Build mode"], "steps");
  assert.equal(result["ACR Image"], "N/A");
  assert.equal(result.Status, "submitted");
  assert.ok(!/Configuration scope|input hidden|Missing ACR namespace/i.test(deployed.stdout + deployed.stderr), "Steps incorrectly required unrelated setup");
  await safe("Wait for the one submitted steps build", () => fc.waitForTemplateReady(template, { access_key_id: accessKeyId, access_key_secret: accessKeySecret, region, team_id: team, timeout: 360, poll_interval: 2 }));
  const verified = await safe("Read the owned registered template", () => get(template));
  assert.ok(verified.body?.name === alias, "Returned template does not belong to this run");
  console.log("PASS: real CLI steps registration reaches ready with only AccessKeys, no Sandbox API key, no ACR configuration and no local Docker tools");

  sandboxSubmitted = true;
  persistOwnedState();
  const created = await request(["--native", "--json", "create", template, "--timeout", "60", "--metadata", `abx_guided_steps_run=${alias}`], sandboxEnvironment);
  assert.equal(created.code, 0, "Creating the owned build-marker sandbox failed; response withheld");
  let createdResult;
  try { createdResult = JSON.parse(created.stdout); } catch { throw new Error("Sandbox create did not return one JSON document"); }
  const id = createdResult.ID;
  assert.ok(validSandboxId(id), "Create did not return a single sandbox ID");
  sandbox = id;
  persistOwnedState();
  const execution = await request(["sandbox", "exec", sandbox, "cat", "/tmp/abx-guided-steps-marker"], sandboxEnvironment, 60_000);
  assert.equal(execution.code, 0, "Reading the owned sandbox marker failed; response withheld");
  assert.equal(execution.stdout, marker, "The actual platform RUN step did not produce its marker");
  console.log("PASS: a sandbox created from the returned template contains the actual platform build marker");
} catch (error) {
  failure = error;
} finally {
  try {
    if (sourceSubmitted) await cleanupSandboxes(publicSource.templateID, `${alias}-source`, sourceSandbox);
    if (sandboxSubmitted) {
      // Metadata and the new template ID scope reconciliation to this run even if create's response was lost.
      await cleanupSandboxes(template, alias, sandbox);
    }
  } catch (error) { cleanupFailure = error; }
  try {
    if (submitted) {
      // Query-only reconciliation after ambiguous submit; the deployment operation is never replayed.
      if (!template) {
        let matches = [];
        for (let attempt = 0; attempt < 6; attempt++) {
          matches = await safe("Reconcile the unique owned alias", ownedTemplates);
          if (matches.length) break;
          await deadline(2000);
        }
        assert.equal(matches.length, 1, "Submission outcome is unknown; no unique owned template could be reconciled");
        template = matches[0].templateID;
        assert.ok(validTemplateId(template), "Reconciliation did not return a valid template ID");
        persistOwnedState();
      }
      const current = await safe("Verify the exact owned template before deletion", () => get(template));
      assert.ok(current.body?.name === alias && current.body?.templateID === template, "Owned alias/reference mismatch; refusing deletion");
      await safe("Delete the exact owned template", () => client.deleteTemplate(template, new sdk.models.DeleteTemplateRequest({ teamID: team })));
      let absent = false;
      try { await get(template); }
      catch (error) { assert.equal(statusCode(error), 404, "Template cleanup readback failed; response withheld"); absent = true; }
      assert.ok(absent, "Independent GetTemplate did not confirm absence");
      let matches;
      for (let attempt = 0; attempt < 6; attempt++) {
        matches = await safe("Read the final owned-alias inventory", ownedTemplates);
        if (!matches.length) break;
        await deadline(2000);
      }
      assert.equal(matches.length, 0, "Owned template alias remains in inventory");
    }
  } catch (error) { cleanupFailure ||= error; }
  if (cleanupFailure) {
    persistOwnedState();
    console.error(`Cleanup requires reconciliation; owned-only recovery state remains at ${stateFile}. No credentials are stored there.`);
  } else rmSync(root, { recursive: true, force: true });
}
if (cleanupFailure) throw cleanupFailure;
if (failure) throw failure;
console.log("PASS: exact owned sandbox/template cleanup, independent GET404 and final owned-alias inventory absence");

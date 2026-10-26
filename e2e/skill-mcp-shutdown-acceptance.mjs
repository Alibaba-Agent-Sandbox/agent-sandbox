#!/usr/bin/env node
/** Real cloud handles with test-controlled lock scheduling; no sandbox backend response is mocked. */
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { SandboxManager, sdk } from "../dist/agent/mcp.js";
import { loadCredentials, makeMasker } from "./lib/env.mjs";

const credentials = loadCredentials();
assert.ok(credentials.E2B_API_KEY && credentials.E2B_API_URL, "Actual sandbox runtime credentials/origin are required");
const index = process.argv.indexOf("--output");
assert.ok(index >= 0 && process.argv[index + 1], "Pass --output NEW_JSON_RECEIPT");
const output = resolve(process.argv[index + 1]); assert.ok(!existsSync(output), "Select a new evidence file");
const mask = makeMasker(credentials);
const run = `shutdown-accept-${randomBytes(8).toString("hex")}`;
const template = process.env.ABX_SKILL_RUNTIME_TEMPLATE || "code-interpreter-v1";
const originalLoader = sdk.loadSandbox; const real = await originalLoader();
const auth = { api_key: credentials.E2B_API_KEY, api_url: credentials.E2B_API_URL, ...(credentials.E2B_DOMAIN ? { domain: credentials.E2B_DOMAIN } : {}) };
const ids = new Set();
const handles = new Set();
const report = { scope: "Actual Express create/connect/commands/kill; test hooks delay real SDK handle registration to force the shutdown lock interleaving", checks: [], cleanup: [] };
const save = () => writeFileSync(output, mask(JSON.stringify(report, null, 2)) + "\n", { mode: 0o600 });
const check = (name, passed) => { report.checks.push({ name, passed }); save(); assert.ok(passed, name); };
function deferred() {
  let resolvePromise, rejectPromise;
  const promise = new Promise((done, failed) => { resolvePromise = done; rejectPromise = failed; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}
const platform = id => fetch(`${credentials.E2B_API_URL.replace(/\/$/, "")}/sandboxes/${encodeURIComponent(id)}`,
  { headers: { "X-API-Key": credentials.E2B_API_KEY }, signal: AbortSignal.timeout(30_000), redirect: "error" });
const creationOptions = { ...auth, provider: "alicloud-express", template, timeout: 180,
  metadata: { acceptance_run: run }, on_created: id => { ids.add(id); } };
const base = Object.fromEntries(["create", "connect", "list", "getInfoById", "setTimeoutById", "killById"].map(name => [name, real[name].bind(real)]));
let failure;
save();
try {
  for (const kind of ["create", "connect"]) {
    let external;
    if (kind === "connect") { external = await real.create(creationOptions); ids.add(external.id); handles.add(external); }
    const entered = deferred(); const releaseResponse = deferred();
    let returned; let closes = 0;
    sdk.loadSandbox = async () => ({ ...base, [kind]: async options => {
      try {
        returned = kind === "create" ? await real.create({ ...options, ...creationOptions }) : await real.connect(options);
        handles.add(returned);
        if (kind === "create") ids.add(returned.id);
        const command = await returned.commands.run("printf usable-before-shutdown", { timeout: 20 });
        assert.equal(command.stdout, "usable-before-shutdown");
        const close = returned.close.bind(returned);
        returned.close = async () => { closes++; await close(); };
        entered.resolve(); await releaseResponse.promise; return returned;
      } catch (error) { entered.reject(error); throw error; }
    } });
    const manager = new SandboxManager(auth);
    const pending = kind === "create" ? manager.createSandbox({ template, timeout: 180 }) : manager.getSandbox(`alicloud-express:${external.id}`);
    pending.catch(() => undefined); // Keep early backend errors handled until the owned cleanup block runs.
    await entered.promise;
    const locked = deferred(); const releaseLock = deferred();
    const holder = manager._state_lock.runExclusive(async () => { locked.resolve(); await releaseLock.promise; });
    await locked.promise;
    const shutdown = manager.shutdown();
    releaseResponse.resolve(); await new Promise(done => setImmediate(done)); releaseLock.resolve();
    const results = await Promise.allSettled([holder, shutdown, pending]);
    check(`${kind}-late-registration-cancelled`, results[2].status === "rejected" && results[2].reason?.name === "CancelledError");
    check(`${kind}-session-state-empty`, manager._sandboxes.size === 0 && manager._default_sandbox === null);
    if (kind === "create") check("newly-created-owned-sandbox-independently-absent", (await platform(returned.id)).status === 404);
    else {
      check("late-borrowed-handle-closed", closes === 1);
      const stillAlive = await external.commands.run("printf borrowed-business-survived", { timeout: 20 });
      check("borrowed-sandbox-business-survives", stillAlive.stdout === "borrowed-business-survived" && (await platform(external.id)).status === 200);
    }
    sdk.loadSandbox = originalLoader;
  }
} catch (error) { failure = error; report.failure = mask(String(error.message)); save(); }
finally {
  sdk.loadSandbox = originalLoader;
  for (const id of ids) {
    try {
      if ((await platform(id)).status !== 404) await real.killById(`alicloud-express:${id}`, auth);
      const absent = (await platform(id)).status === 404;
      report.cleanup.push({ absent }); assert.ok(absent, "Owned test resource remains");
    } catch (error) { failure ||= error; report.cleanup.push({ absent: false, error: mask(String(error.message)) }); }
    save();
  }
  for (const handle of handles) {
    try { await handle.close(); }
    catch (error) { failure ||= error; report.cleanup.push({ client_closed: false, error: mask(String(error.message)) }); }
  }
  report.passed = !failure && report.checks.every(row => row.passed) && report.cleanup.every(row => row.absent); save();
}
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, cleanup: report.cleanup.length }));
if (failure) { console.error(mask(String(failure.message))); process.exitCode = 1; }

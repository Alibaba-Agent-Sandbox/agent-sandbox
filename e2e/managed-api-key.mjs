#!/usr/bin/env node
/** Real Express credential preparation, consent, reuse, renewal and owned-resource cleanup. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { loadCredentials, makeMasker } from "./lib/env.mjs";
import { parseBin } from "./lib/exec.mjs";

const terminalHelper = String.raw`"""Answer exactly one managed-key confirmation using a real terminal (POSIX)."""
import errno
import json
import os
import pty
import select
import subprocess
import sys
import time

answer, *command = sys.argv[1:]
master, slave = pty.openpty()
child = subprocess.Popen(command, stdin=slave, stderr=slave, stdout=slave)
os.close(slave)
terminal = bytearray()
answered = False
deadline = time.monotonic() + 90
try:
    while child.poll() is None:
        if time.monotonic() > deadline:
            raise TimeoutError("Managed-key terminal command did not finish")
        for _stream in select.select([master], [], [], 0.1)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                chunk = b""
            terminal.extend(chunk)
        if not answered and b"Continue?" in terminal:
            os.write(master, (answer + "\n").encode())
            answered = True
    assert answered, "Managed-key confirmation prompt was not shown"
    print(json.dumps({"status": child.returncode, "stderr": terminal.decode()}))
finally:
    if child.poll() is None:
        child.kill()
    child.wait()
    os.close(master)
`;

const credentials = loadCredentials();
const ak = credentials.ALICLOUD_ACCESS_KEY_ID, sk = credentials.ALICLOUD_ACCESS_KEY_SECRET;
assert.ok(ak && sk, "Requires configured AccessKeys; no values are printed.");
const region = credentials.ALIBABA_CLOUD_REGION_ID ?? "cn-hangzhou";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "abx-managed-cloud-"));
const bin = parseBin(process.env.ABX_BIN ?? "abx");
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(ABX_|E2B_|ALICLOUD_|ALIBABA_CLOUD_|CI$)/.test(key)));
Object.assign(childEnv, { HOME: home, USERPROFILE: home, NO_COLOR: "1", ALICLOUD_ACCESS_KEY_ID: ak,
  ALICLOUD_ACCESS_KEY_SECRET: sk, ALIBABA_CLOUD_REGION_ID: region,
  ABX_SANDBOX_BASE_URL: credentials.E2B_API_URL ?? `https://api.${credentials.E2B_DOMAIN}`,
  ABX_SANDBOX_DOMAIN: credentials.E2B_DOMAIN });
const require = createRequire(import.meta.url);
const sdk = require("@alicloud/sandbox20260820");
const core = require("@alicloud/openapi-core");
const client = new sdk.default(new core.$OpenApiUtil.Config({ accessKeyId: ak, accessKeySecret: sk,
  endpoint: `sandbox.${region}.aliyuncs.com`, regionId: region }));
let record, recordFile, ownedSandbox;
const mask = text => makeMasker(credentials, [record?.api_key_value])(text);
function execute(args) {
  const result = spawnSync(bin[0], [...bin.slice(1), ...args], { env: childEnv, cwd: home,
    stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 90_000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  return result;
}
function succeeds(args) {
  const result = execute(args);
  assert.equal(result.status, 0, mask(result.stderr));
  assert.ok(!record?.api_key_value || !(result.stdout + result.stderr).includes(record.api_key_value), "Credential leaked in command output");
  return result;
}
function terminal(answer, args) {
  const result = spawnSync("python3", ["-c", terminalHelper, answer, ...bin, ...args], {
    env: childEnv, cwd: home, encoding: "utf8", timeout: 100_000,
  });
  assert.ifError(result.error); assert.equal(result.status, 0, mask(result.stderr));
  return JSON.parse(result.stdout);
}
try {
  const denied = execute(["sandbox", "list", "--format", "json"]);
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /requires confirmation/);
  assert.equal(fs.readdirSync(path.join(home, ".abx", "credentials", "alicloud-express")).length, 0);
  console.log("PASS: no credential creation without consent");
  if (process.platform !== "win32") {
    const declined = terminal("n", ["sandbox", "list"]);
    assert.notEqual(declined.status, 0);
    assert.equal(fs.readdirSync(path.join(home, ".abx", "credentials", "alicloud-express")).length, 0);
    console.log("PASS: declining a real terminal confirmation does not create a key");
  }
  const prepared = succeeds(["--ci", "sandbox", "list", "--format", "json"]);
  JSON.parse(prepared.stdout);
  assert.match(prepared.stderr, /--ci authorized/);
  const directory = path.join(home, ".abx", "credentials", "alicloud-express");
  const files = fs.readdirSync(directory).filter(file => file.endsWith(".json"));
  assert.equal(files.length, 1); recordFile = path.join(directory, files[0]);
  record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  assert.equal(record.state, "ready");
  if (process.platform !== "win32") assert.equal(fs.statSync(recordFile).mode & 0o777, 0o600);
  succeeds(["sandbox", "list", "--format", "json"]);
  assert.equal(fs.readdirSync(directory).filter(file => file.endsWith(".json")).length, 1);
  console.log("PASS: explicit CI preparation, private storage and reuse across processes");
  const created = succeeds(["sandbox", "create", "base", "--detach", "--timeout", "120"]);
  ownedSandbox = created.stdout.trim(); assert.match(ownedSandbox, /^[A-Za-z0-9_-]+$/);
  assert.equal(succeeds(["sandbox", "exec", ownedSandbox, "echo", "managed-auth-ok"]).stdout.trim(), "managed-auth-ok");
  succeeds(["sandbox", "kill", ownedSandbox]);
  const absent = await fetch(`${childEnv.ABX_SANDBOX_BASE_URL}/sandboxes/${ownedSandbox}`, { headers: { "X-API-Key": record.api_key_value } });
  assert.equal(absent.status, 404); ownedSandbox = undefined;
  console.log("PASS: real sandbox create, command execution, kill and independent absence readback");
  await client.updateApiKey(record.api_key_id, new sdk.UpdateApiKeyRequest({ body: new sdk.UpdateApiKeyInput({ expireTime: new Date(Date.now() + 3600_000).toISOString() }) }));
  const renewal = execute(["sandbox", "list", "--format", "json"]);
  assert.notEqual(renewal.status, 0); assert.match(renewal.stderr, /renewal requires confirmation/);
  if (process.platform !== "win32") {
    const confirmed = terminal("y", ["sandbox", "list"]);
    assert.equal(confirmed.status, 0, mask(confirmed.stderr));
    assert.match(confirmed.stderr, /Confirmed/);
    await client.updateApiKey(record.api_key_id, new sdk.UpdateApiKeyRequest({ body: new sdk.UpdateApiKeyInput({ expireTime: new Date(Date.now() + 3600_000).toISOString() }) }));
    console.log("PASS: accepting a real terminal confirmation renews the managed key");
  }
  succeeds(["--ci", "sandbox", "list", "--format", "json"]);
  const renewed = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  assert.equal(renewed.api_key_id, record.api_key_id); assert.equal(renewed.api_key_value, record.api_key_value);
  assert.ok(Date.parse(renewed.expire_time) - Date.now() > 29 * 24 * 3600_000);
  console.log("PASS: near-expiry renewal requires consent and preserves key identity/secret");
} catch (error) {
  console.error(mask(String(error?.message ?? error))); process.exitCode = 1;
} finally {
  if (ownedSandbox) {
    const result = execute(["sandbox", "kill", ownedSandbox]);
    if (result.status !== 0) { console.error("FAIL: owned sandbox cleanup failed"); process.exitCode = 1; }
  }
  if (!recordFile) {
    const directory = path.join(home, ".abx", "credentials", "alicloud-express");
    const file = fs.existsSync(directory) && fs.readdirSync(directory).find(file => file.endsWith(".json"));
    if (file) recordFile = path.join(directory, file);
  }
  if (!record && recordFile) record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  if (record?.api_key_id) {
    try {
      await client.updateApiKey(record.api_key_id, new sdk.UpdateApiKeyRequest({ body: new sdk.UpdateApiKeyInput({ status: "inactive" }) }));
      await client.deleteApiKey(record.api_key_id, new sdk.DeleteApiKeyRequest({}));
      let absent = false;
      try { await client.describeApiKey(record.api_key_id, new sdk.DescribeApiKeyRequest({})); }
      catch (error) { absent = error.statusCode === 404 || /NotFound/i.test(String(error.code)); }
      assert.ok(absent, "Key deletion readback did not confirm absence");
      console.log("PASS: owned managed key disabled/deleted and absence confirmed");
    } catch { console.error("FAIL: owned key cleanup not confirmed; inspect the isolated credential directory"); process.exitCode = 1; }
  }
  if (process.exitCode !== 1) fs.rmSync(home, { recursive: true, force: true });
}

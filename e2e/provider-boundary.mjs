#!/usr/bin/env node
/** Real CLI/filesystem boundary probe; a local fixture is not a real OpenSandbox deployment. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBin } from './lib/exec.mjs';

const root = mkdtempSync(join(tmpdir(), 'abx-provider-boundary-'));
const plugin = join(root, 'fixture');
const marker = join(plugin, 'calls.json');
const [binary, ...prefix] = parseBin(process.env.ABX_BIN || 'abx');
const env = {
  PATH: process.env.PATH, HOME: root, USERPROFILE: root, NO_COLOR: '1',
  ABX_NO_KEYCHAIN: '1', ABX_PROVIDER_UPDATE_CHECK: '0',
  ABX_SANDBOX_API_KEY: 'placeholder-boundary-key', ABX_SANDBOX_BASE_URL: 'http://127.0.0.1:1', ABX_SANDBOX_DOMAIN: 'example.invalid',
};
function run(args, status = 0) {
  try {
    const out = execFileSync(binary, [...prefix, ...args], { env, cwd: root, timeout: 30_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(status, 0);
    return out;
  } catch (error) {
    assert.equal(error.status, status, `unexpected CLI status: ${String(error.stderr).replaceAll('placeholder-boundary-key', '<SECRET>')}`);
    return String(error.stdout) + String(error.stderr);
  }
}
const calls = () => existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')) : [];
try {
  mkdirSync(plugin);
  writeFileSync(join(plugin, 'abx-provider.toml'), `manifest_version = 1
operation_contract_version = 1
[operations]
cli = ["sandbox.get"]
python = []
[workflow]
inputs = ["managed"]
startups = ["none"]
[provider]
id = "boundary-probe"
version = "1.0.0"
[runtime]
kind = "node"
entry = "provider.mjs"
[features]
supported = ["sandbox.lifecycle", "templates.read", "templates.build"]
[core]
inherit = []
`);
  writeFileSync(join(plugin, 'provider.mjs'), `import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const marker = ${JSON.stringify(marker)};
export default () => ({ async buildInfra() { return {
  operation_contract_version: 1, operations: { cli: ["sandbox.get"], python: [] },
  envd_auth: {allow_missing: true},
  sandbox_protocol: { async getInfo(id) {
    const calls = existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')) : [];
    calls.push(id); writeFileSync(marker, JSON.stringify(calls));
    const info = {sandbox_id: id, template: 'fixture', status: 'running', timeout: 300, metadata: {}};
    return { ...info, modelDump: () => ({ ...info }) };
  } },
  async close() {}
}; } });
`);
  run(['provider', 'install', plugin, '--link', '--yes']);
  assert.match(run(["--json", "status", 'boundary-probe:owned-id']), /owned-id/);
  assert.deepEqual(calls(), ['owned-id']);
  console.log('PASS: qualified resource bypasses default Express and reaches its local provider');
  assert.match(run(['--provider', 'alicloud-express', "status", 'boundary-probe:owned-id'], 2), /E8030/);
  assert.match(run(["status", 'unknown-probe:owned-id'], 4), /E8001/);
  assert.match(run(["status", 'boundary-probe:'], 2), /E8002/);
  assert.match(run(['--provider', 'boundary-probe', "sandbox", 'exec', '--unknown-local-option', 'owned-id', 'agent'], 2), /No such option/);
  assert.deepEqual(calls(), ['owned-id']);
  console.log('PASS: conflicting, unknown and empty namespaces fail before provider calls');
  assert.match(run(['--provider', 'boundary-probe', 'provider', 'run', 'template.list'], 1), /E8004/);
  assert.match(run(["--provider", "boundary-probe", "provider", "run", "template.create", "--input", '{"image":"example.invalid/source:v1","team_id":"foreign-field"}', "--yes"], 2), /E8002/);
  assert.deepEqual(calls(), ['owned-id']);
  console.log('PASS: generic template operations fail before foreign backend work');
} finally {
  rmSync(root, { recursive: true, force: true });
}

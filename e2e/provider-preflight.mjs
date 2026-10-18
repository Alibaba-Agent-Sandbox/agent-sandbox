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
    assert.equal(error.status, status, 'unexpected CLI status');
    return String(error.stdout) + String(error.stderr);
  }
}
const calls = () => existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')) : [];
try {
  mkdirSync(plugin);
  writeFileSync(join(plugin, 'abx-provider.toml'), `manifest_version = 1
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
const marker = new URL('./calls.json', import.meta.url);
export default () => ({ async buildInfra() { return {
  envd_auth: {allow_missing: true},
  sandbox_protocol: { async connect(id) {
    const calls = existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')) : [];
    calls.push(id); writeFileSync(marker, JSON.stringify(calls));
    return {sandbox_id: id, template: 'fixture', status: 'running', timeout: 300, metadata: {}};
  } },
  async close() {}
}; } });
`);
  run(['provider', 'install', plugin, '--link', '--yes']);
  assert.match(run(['info', 'boundary-probe:owned-id']), /boundary-probe/);
  assert.deepEqual(calls(), ['owned-id']);
  console.log('PASS: qualified resource bypasses default Express and reaches its local provider');
  assert.match(run(['--provider', 'alicloud-express', 'info', 'boundary-probe:owned-id'], 2), /E8030/);
  assert.deepEqual(calls(), ['owned-id']);
  console.log('PASS: conflicting explicit provider selection fails before backend calls');
  assert.match(run(['--provider', 'boundary-probe', 'template', 'list'], 1), /E8004/);
  assert.match(run(['--provider', 'boundary-probe', 'create', 'test environment', '--yes'], 1), /E8004/);
  assert.deepEqual(calls(), ['owned-id']);
  console.log('PASS: foreign template flags cannot invoke FC/ACR or natural-language deploy');
} finally {
  rmSync(root, { recursive: true, force: true });
}

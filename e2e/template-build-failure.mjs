#!/usr/bin/env node
/** Real local Docker failure; placeholder credentials prevent cloud writes. */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseBin } from './lib/exec.mjs';

const directory = mkdtempSync(join(tmpdir(), 'abx-build-diagnostic-'));
try {
  writeFileSync(join(directory, 'template.yaml'), JSON.stringify({ name: 'diagnostic-failure', spec_version: 5, generation: 2, provides: {} }));
  writeFileSync(join(directory, 'Dockerfile'), 'FROM fc-e2b-registry.cn-hangzhou.cr.aliyuncs.com/runtime/base:v0.0.49\nRUN echo credential-without-a-known-prefix && exit 23\n');
  const [bin, ...args] = parseBin(process.env.ABX_BIN ?? 'abx');
  const env = Object.fromEntries(['PATH', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'BUILDX_CONFIG'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { HOME: directory, USERPROFILE: directory, XDG_CONFIG_HOME: join(directory, '.config'), ABX_NO_KEYCHAIN: '1', ABX_SANDBOX_API_KEY: 'placeholder', ALICLOUD_ACCESS_KEY_ID: 'placeholder', ALICLOUD_ACCESS_KEY_SECRET: 'placeholder', ACR_NAMESPACE: 'placeholder' });
  const result = spawnSync(bin, [...args, '--provider', 'alicloud-express', '--json', 'template', 'launch', directory, '--yes'], { env, cwd: directory, encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  const error = JSON.parse(result.stdout);
  assert.equal(error.code, 'E7020');
  assert.match(error.message, /Docker build failed \(exit 1\): a build instruction failed/);
  assert.match(error.message, /recovery journal/);
  assert.match(error.suggestion, /--verbose/);
  assert.doesNotMatch(result.stdout + result.stderr, /credential-without-a-known-prefix/);
  const journalDirectory = join(directory, '.abx', 'resource-journal');
  const journals = readdirSync(journalDirectory).map(file => JSON.parse(readFileSync(join(journalDirectory, file), 'utf8')));
  assert.equal(journals.length, 1);
  assert.equal(journals[0].entries.length, 1);
  assert.equal(journals[0].entries[0].kind, 'image');
  assert.equal(journals[0].entries[0].id, undefined);
  console.log(JSON.stringify(error));
  console.log('PASS real Docker RUN failure: E7020, recovery, secret omission; journal confirms no push/template/sandbox submission.');
} finally { rmSync(directory, { recursive: true, force: true }); }

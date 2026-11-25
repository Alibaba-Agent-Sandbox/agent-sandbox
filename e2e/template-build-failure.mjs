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
  const argv = [...args, '--provider', 'alicloud-express', '--json', 'deploy', directory, '--yes'];
  const launch = env => spawnSync(bin, argv, { env, cwd: directory, encoding: 'utf8', timeout: 120_000 });
  const incomplete = { ...env };
  delete incomplete.ACR_NAMESPACE;
  const missing = launch(incomplete);
  assert.equal(missing.error, undefined);
  assert.notEqual(missing.status, 0);
  assert.match(JSON.parse(missing.stdout).message, /acr_namespace/);
  assert.doesNotMatch(missing.stdout + missing.stderr, /Inspect recovery journal|Building Docker image/);

  const result = launch(env);
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  const error = JSON.parse(result.stdout);
  assert.equal(error.code, 'E7020');
  assert.match(error.message, /Docker build failed \(exit (?:1|23)\): a build instruction failed/);
  assert.match(error.message, /recovery journal/);
  assert.match(error.suggestion, /--verbose/);
  assert.doesNotMatch(result.stdout + result.stderr, /credential-without-a-known-prefix/);
  const journalDirectory = join(directory, '.abx', 'resource-journal');
  const journals = readdirSync(journalDirectory).map(file => {
    const location = join(journalDirectory, file);
    return { location, ...JSON.parse(readFileSync(location, 'utf8')) };
  });
  assert.equal(journals.length, 2);
  const failed = journals.find(journal => journal.entries.length);
  assert.ok(failed && error.message.includes(failed.location));
  assert.equal(failed.entries.length, 1);
  assert.equal(failed.entries[0].kind, 'image');
  assert.equal(failed.entries[0].id, undefined);
  console.log('PASS missing ACR namespace and same-name retry against a real Docker daemon.');
  console.log('PASS real Docker RUN failure: E7020, recovery path, secret omission and no push/template/sandbox submission.');
} finally { rmSync(directory, { recursive: true, force: true }); }

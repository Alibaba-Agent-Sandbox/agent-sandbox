#!/usr/bin/env node
/** Real local Docker RUN failure through resource deployment; cloud access is limited to identity/Team reads. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseBin } from './lib/exec.mjs';
import { loadCredentials } from './lib/env.mjs';

const credentials = loadCredentials();
assert.ok(credentials.ALICLOUD_ACCESS_KEY_ID && credentials.ALICLOUD_ACCESS_KEY_SECRET,
  'Existing AccessKeys are required for read-only identity and Team resolution');
const docker = spawnSync('which', ['docker'], {encoding: 'utf8'});
assert.equal(docker.status, 0, 'Docker CLI must be installed');
const realDocker = docker.stdout.trim();
const available = spawnSync(realDocker, ['info'], {encoding: 'utf8', timeout: 30_000});
assert.equal(available.status, 0, 'A running Docker daemon is required; no deployment was attempted');
const directory = mkdtempSync(join(tmpdir(), 'abx-build-diagnostic-'));
const target = 'example.invalid/abx/diagnostic-failure:never-published';
const marker = 'credential-without-a-known-prefix';
try {
  const project = join(directory, 'project'), wrappers = join(directory, 'bin'), trace = join(directory, 'docker-trace.jsonl');
  mkdirSync(project); mkdirSync(wrappers);
  writeFileSync(join(project, 'template.yaml'), JSON.stringify({specVersion: 1, name: 'diagnostic-failure', sandbox: {agent: {
    provider: 'alicloud-express', template: {region: credentials.ALIBABA_CLOUD_REGION_ID || 'cn-hangzhou', image: target,
      buildConfig: {dockerfile: 'Dockerfile', context: '.'}}}}}));
  writeFileSync(join(project, 'Dockerfile'), `FROM alpine:3.21\nRUN echo ${marker} && exit 23\n`);
  // Run the real Docker CLI. Record only command type, exit status and marker presence;
  // refuse publication even if a future executor accidentally continues after failure.
  writeFileSync(join(wrappers, 'docker'), `#!${process.execPath}
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const args=process.argv.slice(2),command=args[0];
if(!['build','buildx','version','info'].includes(command)){fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({command,blocked:true})+'\\n');process.exit(97);}
const result=spawnSync(${JSON.stringify(realDocker)},args,{encoding:'utf8',maxBuffer:16*1024*1024,timeout:120000});
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({command,status:result.status,markerSeen:(result.stdout+result.stderr).includes(${JSON.stringify(marker)})})+'\\n');
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??98);
`, {mode: 0o700});
  const [bin, ...args] = parseBin(process.env.ABX_BIN ?? `${process.execPath} ${resolve('dist/bin/abx.js')}`);
  const env = Object.fromEntries(['PATH', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'BUILDX_CONFIG'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, credentials, {PATH: wrappers + delimiter + process.env.PATH, HOME: directory, USERPROFILE: directory,
    XDG_CONFIG_HOME: join(directory, '.config'), ABX_NO_KEYCHAIN: '1', ABX_DIAGNOSTIC_TOKEN: marker});
  const result = spawnSync(bin, [...args, '--provider', 'alicloud-express', '--json', 'deploy', project, '--yes'], {env, cwd: project, encoding: 'utf8', timeout: 180_000});
  assert.equal(result.error, undefined); assert.notEqual(result.status, 0);
  const error = JSON.parse(result.stdout);
  assert.equal(error.code, 'E7020'); assert.match(error.message, /Docker build failed \(exit [1-9][0-9]*\): a build instruction failed/);
  assert.match(error.suggestion, /--verbose/); assert.ok(!(result.stdout + result.stderr).includes(marker), 'Known token must not be printed; raw CLI output withheld');
  const calls = readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.some(call => call.command === 'build' && call.status !== 0 && call.markerSeen), 'The real failing RUN must execute; schema/network/daemon failures are not acceptance');
  assert.ok(calls.every(call => !call.blocked && call.command !== 'push'), 'No registry publication may be attempted');
  const receipt = JSON.parse(readFileSync(join(directory, '.abx', 'deployments', 'diagnostic-failure', 'resources.json'), 'utf8'));
  assert.equal(receipt.kind, 'ResourceDeployment'); assert.equal(receipt.status, 'requires_recovery');
  assert.equal(receipt.resources.length, 1);
  assert.deepEqual({kind: receipt.resources[0].kind, status: receipt.resources[0].status, id: receipt.resources[0].id}, {kind: 'image', status: 'pending', id: target});
  console.log('PASS: real Docker RUN failed with E7020; known secret omitted; no push or template/volume/Serving submission; only pending image intent recorded.');
} finally { rmSync(directory, {recursive: true, force: true}); }

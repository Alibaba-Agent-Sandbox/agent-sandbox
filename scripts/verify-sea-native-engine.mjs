#!/usr/bin/env node
/** Verify a copied SEA's embedded native parser/loader workers without Node or credentials in its environment.
 * Usage: node scripts/verify-sea-native-engine.mjs --binary PATH --component-bundle VERIFIED_FC3_0_1_26_DIRECTORY
 * The caller must verify the official component archive's pinned digest before extraction.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

function argument(name) {
  const index = process.argv.indexOf(name);
  assert.ok(index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), `Provide ${name}`);
  return fs.realpathSync(process.argv[index + 1]);
}
let originalBinary = argument('--binary');
const originalBundle = argument('--component-bundle');
if (fs.statSync(originalBinary).isDirectory()) {
  const files = fs.readdirSync(originalBinary).filter(name => name.startsWith('abx-') && !name.endsWith('.sha256') && fs.statSync(path.join(originalBinary, name)).isFile());
  assert.equal(files.length, 1, '--binary directory must contain exactly one abx-* executable excluding .sha256 files');
  originalBinary = fs.realpathSync(path.join(originalBinary, files[0]));
}
assert.ok(fs.statSync(originalBinary).isFile(), '--binary must be a built SEA executable');
assert.ok(fs.statSync(path.join(originalBundle, 'dist/index.js')).isFile(), 'Verified component bundle must contain dist/index.js');
assert.notEqual(process.platform, 'win32', 'This process-group probe currently runs on Unix CI');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'abx-sea-native-verification-'));
const executable = path.join(root, 'abx'), emptyPath = path.join(root, 'empty-path'), home = path.join(root, 'home');
const bundle = path.join(root, 'component'), project = path.join(root, 'project');
const children = new Set();
const secret = 'sea-probe-fixture-secret-never-a-real-credential';
const accessKey = 'sea-probe-fixture-access';
const log = (check, details = {}) => console.log(JSON.stringify({check, result: 'PASS', ...details}));
let server;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => {
  for (const child of children) killGroup(child);
  server?.closeAllConnections();
  fs.rmSync(root, {recursive: true, force: true});
  process.exit(code);
});

// Only builtin Node modules are used by this controller. The child cannot discover
// the controller's Node executable, source checkout, dotenv or installed packages.
function childEnvironment() {
  return {HOME: home, USERPROFILE: home, PATH: emptyPath, TMPDIR: root,
    serverless_devs_config_home: path.join(home, '.s'), CI: '1', SERVERLESS_DEVS_CICD: '1',
    S_INTERACTIVE: '0', NO_COLOR: '1', NODE_NO_WARNINGS: '1', DEBUG: '',
    SEA_PROBE_VALUE: 'explicit-environment-value'};
}
function killGroup(child) {
  try {process.kill(-child.pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}
}
async function worker(kind, request) {
  assert.equal(request.loaderPath, undefined, 'The SEA must supply its embedded loader');
  assert.equal(request.parserPath, undefined, 'The SEA must supply its embedded parser');
  const scratch = fs.mkdtempSync(path.join(root, `worker-${kind}-`));
  const env = childEnvironment();
  for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'ABX_APP_NODE', 'ALICLOUD_ACCESS_KEY_ID', 'ALICLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_ACCESS_KEY_ID']) assert.equal(env[key], undefined);
  const child = spawn(executable, ['--abx-internal-worker', kind, scratch], {
    cwd: project, env, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
  });
  children.add(child);
  const captures = ['', '', '', '']; let bytes = 0, fault;
  const timer = setTimeout(() => {fault = new Error(`${kind} worker exceeded 45 seconds`); killGroup(child);}, 45_000);
  for (let fd = 1; fd <= 4; fd++) {
    child.stdio[fd].setEncoding('utf8');
    child.stdio[fd].on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 4 * 1024 * 1024) {fault = new Error('Worker output exceeded the bounded capture'); killGroup(child); return;}
      captures[fd - 1] += chunk;
    });
  }
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify(request));
  try {
    const [code, signal] = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => resolve([code, signal]));
    });
    if (fault) throw fault;
    assert.equal(signal, null, `${kind} worker was terminated`);
    assert.equal(code, 0, `${kind} worker exited unsuccessfully; raw output withheld`);
    for (const value of captures) for (const sensitive of [secret, accessKey]) assert.ok(!value.includes(sensitive), 'Fixture credentials leaked; raw output withheld');
    assert.equal(captures[0].trim(), '', 'Worker stdout must not carry protocol results or component logs');
    assert.equal(captures[1].trim(), '', 'Worker stderr must not bypass the log channel');
    assert.ok(captures[2].length > 0, 'Worker FD3 result must be present');
    let result;
    try {result = JSON.parse(captures[2]);} catch {throw new Error('FD3 must contain exactly one JSON result; raw output withheld');}
    const events = captures[3].trim() ? captures[3].trim().split('\n').map(line => JSON.parse(line)) : [];
    return {result, events};
  } finally {
    clearTimeout(timer); killGroup(child); children.delete(child);
    fs.rmSync(scratch, {recursive: true, force: true});
  }
}

try {
  fs.copyFileSync(originalBinary, executable); fs.chmodSync(executable, 0o700);
  for (const directory of [emptyPath, home, project]) fs.mkdirSync(directory);
  // Reject symlinks: a copied fixture must not reach the source checkout's dependencies.
  function checkTree(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      assert.ok(!entry.isSymbolicLink(), 'Component fixture must not contain external symlinks');
      if (entry.isDirectory()) checkTree(path.join(directory, entry.name));
    }
  }
  checkTree(originalBundle); fs.cpSync(originalBundle, bundle, {recursive: true});
  assert.deepEqual(fs.readdirSync(emptyPath), []);
  fs.writeFileSync(path.join(project, 'values.json'), JSON.stringify({label: 'relative-file-value'}));
  fs.writeFileSync(path.join(project, '.env'), 'SEA_PROBE_VALUE=dotenv-must-not-override\nSEA_PROBE_DOTENV=dotenv-value\n', {mode: 0o600});
  fs.writeFileSync(path.join(project, 'template.yaml'), 'specVersion: 1\n');
  const content = {edition: '3.0.0', name: 'sea-native-fixture', vars: {
    literal: 'native-vars-value', environment: "${env('SEA_PROBE_VALUE')}", file: "${json(file('./values.json')).label}", dotenv: "${env('SEA_PROBE_DOTENV')}"},
    resources: {api: {component: 'fc3@0.1.26', props: {literal: '${vars.literal}', environment: '${vars.environment}', file: '${vars.file}', dotenv: '${vars.dotenv}'}}}};
  const parsed = await worker('parser', {command: 'deploy', content: JSON.stringify(content)});
  assert.equal(parsed.result.error, undefined);
  assert.deepEqual(parsed.result.content.resources.api.props, {literal: 'native-vars-value', environment: 'explicit-environment-value', file: 'relative-file-value', dotenv: 'dotenv-value'});
  assert.ok(parsed.result.steps.some(step => step.resource === 'api' && step.component === 'fc3@0.1.26'));
  assert.equal(process.env.SEA_PROBE_DOTENV, undefined, 'Child dotenv must not mutate the controller');
  log('native-parser-vars-env-file-dotenv', {externalNodeAvailable: false});

  let mode, created, calls, unexpected;
  const name = 'sea-guard-fixture';
  const info = {functionName: name, functionId: 'fixture-function-id', functionArn: `acs:fc:cn-hangzhou:123:functions/${name}`,
    createdTime: '2026-11-13T00:00:00Z', runtime: 'custom-container', state: 'Active', lastUpdateStatus: 'Successful', memorySize: 1024, cpu: 1,
    customContainerConfig: {image: 'registry.example.com/fixture/sea:new', port: 9000}, tags: []};
  server = http.createServer((req, res) => {
    const url = req.url.split('?')[0]; calls.push({method: req.method, path: url});
    req.resume(); res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && url === `/2023-03-30/functions/${name}`) {
      if (mode === 'existing' || created) return res.end(JSON.stringify(info));
      res.statusCode = 404; return res.end(JSON.stringify({Code: 'FunctionNotFound', Message: 'fixture absent', RequestId: 'fixture'}));
    }
    if (req.method === 'POST' && url === '/2023-03-30/functions') {
      if (mode === 'conflict') {res.statusCode = 409; return res.end(JSON.stringify({Code: 'FunctionAlreadyExists', Message: 'fixture conflict', RequestId: 'fixture'}));}
      created = true; return res.end(JSON.stringify(info));
    }
    unexpected.push({method: req.method, path: url}); res.statusCode = 500; res.end(JSON.stringify({Code: 'UnexpectedFixtureRequest', Message: 'Not permitted by this probe'}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  for (mode of ['existing', 'conflict', 'success']) {
    created = false; calls = []; unexpected = [];
    const {result, events} = await worker('component', {action: 'invoke', events: true, component: bundle,
      componentReference: 'fc3@0.1.26', command: 'deploy', cwd: project, name: 'sea-fixture', resource: 'api',
      args: ['--assume-yes', '--skip-push', '--function', 'config'], functionCreationGuard: {endpoint, functionName: name},
      props: {region: 'cn-hangzhou', endpoint, functionName: name, runtime: 'custom-container', cpu: 1, memorySize: 1024,
        role: 'acs:ram::123:role/existing', customContainerConfig: {image: info.customContainerConfig.image, port: 9000}},
      credential: {AccountID: '123', AccessKeyID: accessKey, AccessKeySecret: secret}});
    assert.deepEqual(unexpected, [], 'Official component made an unexpected local API request');
    assert.ok(calls.some(call => call.method === 'GET'), 'The official component must actually query the fixture');
    assert.ok(!calls.some(call => ['PUT', 'PATCH', 'DELETE'].includes(call.method)), 'Create guard must not update/delete');
    assert.equal(calls.filter(call => call.method === 'POST').length, mode === 'existing' ? 0 : 1);
    if (mode === 'success') {assert.equal(result.error, undefined); assert.equal(created, true);}
    else {assert.equal(result.code, 'ABX_FC_CREATE_CONFLICT'); assert.equal(created, false);}
    assert.ok(events.length > 0, 'Actual official component logs must reach FD4');
    if (mode === 'success') {
      assert.ok(Number.isInteger(result.logCount) && result.logCount > 0, 'Successful component result must report its log count');
      assert.ok(result.logCount >= events.length, 'Emitted FD4 events cannot exceed counted logs; blank messages may be counted without an event');
    }
    for (const event of events) {
      assert.ok(['debug', 'info', 'warning', 'error'].includes(event.level));
      assert.equal(typeof event.message, 'string'); assert.equal(event.component, 'fc3@0.1.26');
      assert.equal(event.resource, 'api'); assert.equal(event.command, 'deploy');
    }
    log(`native-fc3-${mode}`, {requests: calls.length, localPosts: calls.filter(call => call.method === 'POST').length, logEvents: events.length, cloudWrites: 0});
  }
  log('copied-sea-with-embedded-dependencies', {componentIndexSha256: createHash('sha256').update(fs.readFileSync(path.join(bundle, 'dist/index.js'))).digest('hex')});
} finally {
  for (const child of children) killGroup(child);
  if (server) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
  fs.rmSync(root, {recursive: true, force: true});
  assert.equal(fs.existsSync(root), false, 'Temporary binary, worker assets and component cache must be removed');
  log('temporary-processes-server-files-cleaned');
}

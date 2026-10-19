/** Installed built-host -> catalog adapter -> native CubeAPI, against loopback only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.ABX_CUBESANDBOX_PROVIDER_SOURCE;
assert.ok(source, 'Set ABX_CUBESANDBOX_PROVIDER_SOURCE to the reviewed CubeSandbox adapter directory');
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'abx-template-image-'));
const key = 'cube-fixture-key';
const seen = [];
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  seen.push({ method: req.method, path: req.url, key: req.headers['x-api-key'], body: raw ? JSON.parse(raw) : null });
  res.setHeader('content-type', 'application/json');
  if (req.method === 'POST' && req.url === '/templates') {
    res.statusCode = 202; res.end(JSON.stringify({ templateID: 'tpl-test', jobID: 'bld-test' }));
  } else if (req.method === 'GET' && req.url === '/templates/tpl-test/builds/bld-test/status') {
    res.end(JSON.stringify({ templateID: 'tpl-test', buildID: 'bld-test', status: 'ready' }));
  } else { res.statusCode = 404; res.end('{}'); }
});
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const plugin = path.join(work, 'plugin');
  await fs.cp(source, plugin, { recursive: true });
  const manifest = path.join(plugin, 'abx-provider.toml');
  const original = await fs.readFile(manifest, 'utf8');
  // This local compatibility fixture opts in; the published catalog remains gated.
  await fs.writeFile(manifest, original.replace('supported = [', 'supported = ["templates.deploy", '));
  const env = { PATH: process.env.PATH, HOME: path.join(work, 'home'), NO_COLOR: '1', ABX_NO_KEYCHAIN: '1',
    ABX_CUBESANDBOX_API_KEY: key, ABX_CUBESANDBOX_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    ABX_SANDBOX_API_KEY: 'express-must-not-be-forwarded', E2B_API_KEY: 'native-env-must-not-be-forwarded',
    ABX_IMAGE_REGISTRY_USERNAME: 'fixture-user', ABX_IMAGE_REGISTRY_PASSWORD: 'fixture-password' };
  await fs.mkdir(env.HOME);
  const cli = async (args) => run(process.execPath, [path.join(repo, 'dist/bin/abx.js'), ...args], { cwd: work, env, timeout: 30000, maxBuffer: 1024 * 1024 });
  await cli(['provider', 'install', plugin, '-y']);
  const { stdout, stderr } = await cli(['--provider', 'cubesandbox', '--json', 'template', 'from-image', 'python:3.12-slim', '--name', 'contract', '--cpu', '2', '--memory', '1024', '--timeout', '10', '-y']);
  assert.deepEqual(JSON.parse(stdout), { template_id: 'tpl-test', build_id: 'bld-test', status: 'ready', ref: 'python:3.12-slim' });
  assert.equal(seen.length, 2);
  assert.ok(seen.every((entry) => entry.key === key));
  assert.deepEqual(seen[0].body, { image: 'python:3.12-slim', name: 'contract', cpu: 2000, memory: 1024,
    writableLayerSize: '1G', exposedPorts: [49983], probePort: 49983, probePath: '/health',
    registryUsername: 'fixture-user', registryPassword: 'fixture-password' });
  for (const secret of [key, env.ABX_SANDBOX_API_KEY, env.E2B_API_KEY, env.ABX_IMAGE_REGISTRY_PASSWORD]) assert.ok(!(stdout + stderr).includes(secret));
  console.log('PASS: built CLI, real local install/consent/dispatch, native CubeAPI two-request sequence, millicore conversion, scoped authentication, private registry request, safe ready result');
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(work, { recursive: true, force: true });
}

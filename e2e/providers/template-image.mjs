/** Installed built-host -> catalog adapter -> pinned official SDK, against loopback only. */
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
const source = process.env.ABX_E2B_PROVIDER_SOURCE;
assert.ok(source, 'Set ABX_E2B_PROVIDER_SOURCE to the reviewed E2B adapter directory');
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'abx-template-image-'));
const key = `e2b_${'0'.repeat(40)}`;
const seen = [];
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  seen.push({ method: req.method, path: req.url, key: req.headers['x-api-key'], body: raw ? JSON.parse(raw) : null });
  res.setHeader('content-type', 'application/json');
  if (req.method === 'POST' && req.url === '/v3/templates') {
    res.statusCode = 202; res.end(JSON.stringify({ templateID: 'tpl-test', buildID: 'bld-test', aliases: ['contract'], names: ['contract'], tags: ['latest'] }));
  } else if (req.method === 'POST' && req.url === '/v2/templates/tpl-test/builds/bld-test') {
    res.statusCode = 202; res.end('{}');
  } else if (req.method === 'GET' && req.url.startsWith('/templates/tpl-test/builds/bld-test/status')) {
    res.end(JSON.stringify({ templateID: 'tpl-test', buildID: 'bld-test', status: 'ready', logEntries: [], logs: [] }));
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
    ABX_E2B_API_KEY: key, ABX_E2B_BASE_URL: `http://127.0.0.1:${server.address().port}`, ABX_E2B_DOMAIN: 'e2b.test',
    ABX_SANDBOX_API_KEY: 'express-must-not-be-forwarded', E2B_API_KEY: 'native-env-must-not-be-forwarded',
    ABX_IMAGE_REGISTRY_USERNAME: 'fixture-user', ABX_IMAGE_REGISTRY_PASSWORD: 'fixture-password' };
  await fs.mkdir(env.HOME);
  const cli = async (args) => run(process.execPath, [path.join(repo, 'dist/bin/abx.js'), ...args], { cwd: work, env, timeout: 30000, maxBuffer: 1024 * 1024 });
  await cli(['provider', 'install', plugin, '-y']);
  const { stdout, stderr } = await cli(['--provider', 'e2b', '--json', 'template', 'from-image', 'python:3.12-slim', '--name', 'contract', '--cpu', '2', '--memory', '1024', '--start-cmd', 'python server.py', '--ready-cmd', 'curl localhost:9000', '--timeout', '10', '-y']);
  assert.deepEqual(JSON.parse(stdout), { template_id: 'tpl-test', build_id: 'bld-test', status: 'ready', ref: 'python:3.12-slim' });
  assert.equal(seen.length, 3);
  assert.ok(seen.every((entry) => entry.key === key));
  assert.deepEqual(seen[0].body, { name: 'contract', cpuCount: 2, memoryMB: 1024 });
  assert.equal(seen[1].body.fromImage, 'python:3.12-slim');
  assert.equal(seen[1].body.startCmd, 'python server.py');
  assert.equal(seen[1].body.readyCmd, 'curl localhost:9000');
  assert.deepEqual(seen[1].body.fromImageRegistry, { type: 'registry', username: 'fixture-user', password: 'fixture-password' });
  for (const secret of [key, env.ABX_SANDBOX_API_KEY, env.E2B_API_KEY, env.ABX_IMAGE_REGISTRY_PASSWORD]) assert.ok(!(stdout + stderr).includes(secret));
  console.log('PASS: built CLI, real local install/consent/dispatch, official E2B 2.55 SDK three-request sequence, scoped authentication, private registry request, safe ready result');
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(work, { recursive: true, force: true });
}

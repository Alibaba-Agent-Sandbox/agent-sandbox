/** Scoped cloud acceptance: one existing base template, one temporary Sandbox, no management-key creation. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = process.cwd();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abx-api-cloud-'));
const token = randomBytes(24).toString('hex');
const name = `api-review-${Date.now()}`;
const env = { ...process.env, HOME: directory, USERPROFILE: directory, ABX_NO_KEYCHAIN: '1', REPORT_API_TOKEN: token, ABX_PROVIDER: 'alicloud-express' };
const calls = [];
let admitted = false;
let createdId;
function cli(args, expected = 0) {
  const r = spawnSync(process.execPath, [path.join(root, 'dist/bin/abx.js'), '--json', ...args], { env, cwd: directory, encoding: 'utf8', timeout: 65000, maxBuffer: 2 * 1024 * 1024 });
  calls.push({ command: args[0], exit: r.status });
  if (r.status !== expected) throw new Error(`${args[0]} returned ${r.status}; ${String(r.stderr || r.stdout).replaceAll(token, '<redacted>').slice(0, 800)}`);
  return r.stdout ? JSON.parse(r.stdout) : null;
}
try {
  cli(['list', '--limit', '1']);
  fs.copyFileSync(path.join(root, 'docs/examples/sandbox-api/registry.yaml'), path.join(directory, 'registry.yaml'));
  fs.copyFileSync(path.join(root, 'docs/examples/sandbox-api/openapi.yaml'), path.join(directory, 'openapi.yaml'));
  fs.writeFileSync(path.join(directory, 'request.json'), '{"values":[10,20,30]}');
  // A disposable service, not a model/agent task. Its token expires with the Sandbox.
  fs.writeFileSync(path.join(directory, 'server.py'), `import json\nfrom http.server import BaseHTTPRequestHandler,HTTPServer\nclass H(BaseHTTPRequestHandler):\n def do_POST(self):\n  if self.headers.get('Authorization') != 'Bearer ${token}':\n   self.send_response(401);self.end_headers();return\n  if self.path != '/totals':\n   self.send_response(404);self.end_headers();return\n  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))\n  result=json.dumps({'total':sum(body['values'])}).encode()\n  self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(result)\n def log_message(self,*args): pass\nHTTPServer(('0.0.0.0',9000),H).serve_forever()\n`);
  admitted = true;
  const created = cli(['deploy', '--template-id', 'base', '--name', name, '--sandbox-timeout', '180', '--yes']);
  assert.ok(created.sandbox_id); createdId = created.sandbox_id;
  cli(['upload', name, path.join(directory, 'server.py'), '/tmp/abx-report.py']);
  cli(['exec', name, 'sh', '-c', 'nohup python3 /tmp/abx-report.py >/tmp/abx-report.log 2>&1 </dev/null &']);
  cli(['sandbox', name, '--bind', path.join(directory, 'registry.yaml'), '--credential', 'report.token=env:REPORT_API_TOKEN', '--alias', 'totals=report:report_totals']);
  const help = cli(['sandbox', name, 'totals', '--help']);
  assert.ok(JSON.stringify(help).includes('report_totals'));
  const response = cli(['sandbox', name, 'totals', '--body', `@${path.join(directory, 'request.json')}`]);
  assert.deepEqual(response, {status:200,body:{total:60}});
  const qualified = `alicloud-express:${created.sandbox_id}`;
  const same = cli(['sandbox', qualified, 'report_totals', '--body', '{"values":[1,2]}']);
  assert.deepEqual(same, {status:200,body:{total:3}});
  env.REPORT_API_TOKEN = 'invalid-test-token';
  const denied = cli(['sandbox', name, 'totals', '--body', '{"values":[]}'], 1);
  assert.equal(denied.status, 401);
  console.log(JSON.stringify({result:'PASS',checks:['create','upload','background-service','bind','offline-help','alias-invoke','qualified-id-invoke','401'],calls}));
} finally {
  if (admitted) {
    cli(['delete', name, '--yes']);
    // status returns not found / deleted; list must independently exclude the exact owned ID.
    const result = cli(['list', '--limit', '100']);
    const items = result.items ?? result;
    assert.ok(Array.isArray(items));
    assert.ok(!items.some(item => (item.sandbox_id ?? item.id) === createdId));
    if (createdId) cli(['status', `alicloud-express:${createdId}`], 4);
    console.log(JSON.stringify({cleanup:'delete-and-independent-absence-confirmed'}));
  }
  fs.rmSync(directory, {recursive:true,force:true});
}

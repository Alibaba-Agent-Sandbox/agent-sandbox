/** Opt-in real Registry -> Express workflow acceptance. Never prints credentials or native resource IDs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Sandbox } from '../dist/api/sandbox.js';
import { requestApplication } from '../dist/transport/application_http.js';
import { loadConfig } from '../dist/transport/config.js';
import { listOfficialTemplates, getTemplate, deleteTemplate } from '../dist/providers/alicloud_express/fc_template.js';

const cli = fileURLToPath(new URL('../dist/bin/abx.js', import.meta.url));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abx-express-acceptance-'));
const alias = `workflow-e2e-${randomBytes(6).toString('hex')}`;
const journalDirectory = path.join(os.homedir(), '.abx', 'resource-journal');
const report = { result: 'FAIL', checks: [], cleanup: {}, limitation: 'Only python-hello is live-tested; static compatibility does not certify other template workloads.' };
const config = loadConfig();
const nativeOptions = { access_key_id: config.access_key_id, access_key_secret: config.access_key_secret, region: config.region };
assert.ok(nativeOptions.access_key_id && nativeOptions.access_key_secret && config.api_key && process.env.ACR_NAMESPACE, 'Configure Express Sandbox key, AccessKeys and ACR_NAMESPACE');
process.env.ABX_SERVER_TOKEN ||= randomBytes(32).toString('hex');
let sandbox, launch, error;
async function run(args, json = true) {
  const result = await new Promise(resolve => {
  const child = execFile(process.execPath, [cli, '--native', ...(json ? ['--json'] : []), ...args], { encoding: 'utf8', timeout: 1_500_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ status: error ? error.code ?? 1 : 0, stdout, stderr }));
  child.stdin.end(); // Remote exec reads piped stdin to EOF; this harness supplies no input.
  const phases = new Set();
  child.stderr.on('data', chunk => {
    for (const phase of ['Checking Docker daemon', 'Building Docker image', 'Logging into ACR', 'Pushing to ACR', 'Image pushed to ACR', 'Creating template via official API', 'Waiting for template to become READY']) {
      if (String(chunk).includes(phase) && !phases.has(phase)) { phases.add(phase); console.log(`PROGRESS ${phase}`); }
    }
  });
  });
  if (result.status !== 0) {
    // Raw cloud/build errors can contain signed URLs. Keep only bounded sanitized diagnostics locally.
    const diagnostic = sanitize(result.stderr + result.stdout);
    report.failure_diagnostic = diagnostic;
    report.resource_states = journals().flatMap(j => j.entries.map(({kind,state}) => ({kind,state})));
    fs.writeFileSync(path.join(directory, 'failure.txt'), diagnostic, {mode: 0o600});
    throw new Error(`CLI ${args.slice(0,2).join(' ')} failed (exit ${result.status}); diagnostics retained locally, not uploaded`);
  }
  return json ? JSON.parse(result.stdout) : result.stdout;
}
function sanitize(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  const secrets = Object.entries(process.env).filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD|BASE_URL|DOMAIN|NAMESPACE/.test(key)).map(([, value]) => value).filter(Boolean);
  for (const secret of secrets) text = text.split(secret).join('[redacted]');
  for (const entry of journals().flatMap(j => j.entries)) {
    for (const id of [entry.id, entry.correlation_key].filter(Boolean)) text = text.split(id).join('[owned-resource]');
  }
  return text.replace(/https?:\/\/[^\s"']+/g, '[url]').replace(/\b[0-9]{12,}\b/g, '[account]').replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/g, '[journal]').slice(-8000);
}
function check(name) { report.checks.push(name); console.log(`PASS ${name}`); }
function journals() {
  if (!fs.existsSync(journalDirectory)) return [];
  return fs.readdirSync(journalDirectory).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(fs.readFileSync(path.join(journalDirectory,name),'utf8'))).filter(j=>j.entries.some(e=>e.correlation_key?.startsWith(alias)));
}
try {
  // Same source reference and default build as the Registry's Express instruction.
  launch = await run(['template','launch','Alibaba-Agent-Sandbox/awesome-templates//python-hello','--workflow','application','--alias',alias,'--timeout','1200','--sandbox-timeout',process.env.ABX_WORKFLOW_FULL_E2E === '1' ? '1800' : '600','--yes']);
  assert.equal(launch.provider,'alicloud-express');assert.equal(launch.workflow_id,'application');assert.ok(launch.source_digest);check('Registry source launch');
  const entries = journals().flatMap(j=>j.entries);
  assert.ok(entries.some(e=>e.kind==='template' && e.id===launch.template_reference && e.state==='retained'));
  assert.ok(entries.some(e=>e.kind==='image' && /@sha256:[a-f0-9]{64}$/.test(e.id) && e.state==='retained'));check('exact template handoff and immutable image receipt');
  await run(['info',launch.sandbox_id]);await run(['list']);check('CLI info and list');
  const result = await run(['exec',launch.sandbox_id,'--','python3','-c','print(21 * 2)']);assert.equal(result.exit_code,0);assert.equal(result.stdout.trim(),'42');check('CLI exec');
  const commands = await run(['sandbox','command','list',launch.sandbox_id]);assert.ok(JSON.stringify(commands).includes('hello'));check('CLI command discovery');
  const hello = await run(['sandbox','command','run',launch.sandbox_id,'hello','--arg','name=Workflow']);assert.ok(JSON.stringify(hello).includes('Hello, Workflow!'));check('CLI named command');
  sandbox = await Sandbox.connect(launch.sandbox_id,{provider:'alicloud-express'});
  const endpoint = await sandbox.network.resolveEndpoint(9000);
  const response = await requestApplication(endpoint,'/commands/hello',{method:'POST',json:{name:'HTTP'},application_token:process.env.ABX_SERVER_TOKEN});
  assert.equal(response.status_code,200);assert.equal(response.json().result,'Hello, HTTP!');check('POST /commands/hello');
  const local = path.join(directory,'input.txt'), downloaded=path.join(directory,'output.txt');fs.writeFileSync(local,'workflow file roundtrip');
  await run(['upload',launch.sandbox_id,local,'/tmp/abx-workflow-e2e.txt'],false);
  await run(['download',launch.sandbox_id,'/tmp/abx-workflow-e2e.txt',downloaded],false);assert.equal(fs.readFileSync(downloaded,'utf8'),'workflow file roundtrip');
  await run(['sandbox','files','stat',launch.sandbox_id,'--path','/tmp/abx-workflow-e2e.txt']);
  await run(['sandbox','files','rm',launch.sandbox_id,'--path','/tmp/abx-workflow-e2e.txt'],false);check('CLI upload/download/stat/remove');
  if (process.env.ABX_WORKFLOW_FULL_E2E === '1') {
    const reportFile = path.join(directory,'full-e2e.json');
    const full = spawnSync(process.execPath,[fileURLToPath(new URL('./run.mjs',import.meta.url)),'--json',reportFile],{
      encoding:'utf8',timeout:900_000,maxBuffer:16*1024*1024,
      env:{...process.env,ABX_BIN:`${process.execPath} ${cli}`,ABX_E2E_TEMPLATE:launch.template_reference,
        ABX_E2E_APP_START_COMMAND:'agent-sandbox-server serve --port 9000 --commands /home/user/app/commands.py',
        E2B_API_KEY:process.env.ABX_SANDBOX_API_KEY,E2B_API_URL:process.env.ABX_SANDBOX_BASE_URL,E2B_DOMAIN:process.env.ABX_SANDBOX_DOMAIN}
    });
    if(fs.existsSync(reportFile))report.full_e2e=JSON.parse(fs.readFileSync(reportFile,'utf8'));
    if(full.status !== 0) report.full_e2e_failure_diagnostic=sanitize(full.stdout + full.stderr);
    assert.equal(full.status,0,'Full E2E suite must pass; inspect sanitized report');check('full CLI E2E suite');
  }
  report.result='PASS';
} catch (failure) { error=failure; }
finally {
  try {
    const entries=journals().flatMap(j=>j.entries);
    const ids=new Set(entries.filter(e=>e.kind==='sandbox'&&e.id).map(e=>e.id));if(launch?.sandbox_id)ids.add(launch.sandbox_id);
    for(const id of ids) { const owned=await Sandbox.connect(id,{provider:'alicloud-express'});try{await owned.kill();assert.equal(await owned.isRunning(),false);}finally{await owned.close();} }
    report.cleanup.sandboxes='confirmed deleted';
    const ownedTemplates=(await listOfficialTemplates(nativeOptions)).filter(t=>t.name?.startsWith(`${alias}-`));
    for(const t of ownedTemplates) {
      if(error) {
        const detail = await getTemplate(t.templateID,nativeOptions);
        (report.template_failure_states ||= []).push(sanitize(detail.status));
      }
      await deleteTemplate(t.templateID,nativeOptions);
    }
    assert.equal((await listOfficialTemplates(nativeOptions)).filter(t=>t.name?.startsWith(`${alias}-`)).length,0);
    report.cleanup.templates='confirmed absent from inventory';
    // Registry images have explicit manual cleanup semantics and remain attributable by their unique tag.
    report.cleanup.images='unique-tag ACR images retained; manual cleanup entries in the resource journal';
    check('owned sandbox and template cleanup');
  } catch { report.cleanup.failure='cleanup not confirmed; reconcile the local owned-resource journal';report.result='FAIL'; }
  await sandbox?.close();
  if(error)report.result='FAIL';
  fs.writeFileSync(process.env.ABX_WORKFLOW_REPORT || path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
}
if(error){console.error(error.message);process.exitCode=1;}
if(report.result!=='PASS')process.exitCode=1;

#!/usr/bin/env node
/** Opt-in real Express management acceptance. Never creates or changes API Keys. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { baseEnv, parseBin, runBinary } from './lib/exec.mjs';

const usage = `Usage: node e2e/express-management-completion.mjs [--inspect|--metadata-only|--template-only|--cache-only|--cleanup LEDGER]
ABX_BIN selects the CLI command (source tsx is supported). Supply existing ALICLOUD_ACCESS_KEY_ID/SECRET,
ALIBABA_CLOUD_REGION_ID and optional ALIBABA_CLOUD_SECURITY_TOKEN only through the environment.
Template checks also require ABX_E2E_TEAM_ID for the existing Sandbox API Key and ABX_SANDBOX_API_KEY;
ABX_SANDBOX_BASE_URL/DOMAIN select its existing endpoint. No API Key is acquired or changed.
The default runs both groups. Metadata checks create an exclusive Team and placeholder storage metadata;
they do not create backing storage or prove mounts. --inspect is read-only. --cleanup resumes deletion
from a private ledger; every deletion rechecks resource ownership and independently verifies absence.
Normal writes are submitted once; a deterministic cache 400 plus confirmed absence permits the separately requested official-SDK diagnostic control. Unknown create outcomes are reconciled by unique name, never replayed.`;
if (process.argv.includes('--help')) { console.log(usage); process.exit(0); }
// The generated SDK can attach private request/response objects to exceptions.
// Never allow Node's default unhandled-exception printer to expose those objects.
for (const event of ['uncaughtException', 'unhandledRejection']) process.on(event, () => {
  console.error('FAIL acceptance preflight or control flow; private exception details withheld; inspect the recovery ledger if one was emitted');
  process.exit(1);
});
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--cleanup') { assert.ok(args[++index], '--cleanup requires a ledger'); continue; }
  assert.ok(['--inspect', '--metadata-only', '--template-only', '--cache-only'].includes(args[index]), 'Unknown acceptance option; use --help');
}
const inspect = process.argv.includes('--inspect');
const metadataOnly = process.argv.includes('--metadata-only');
const cacheOnly = process.argv.includes('--cache-only');
const templateOnly = process.argv.includes('--template-only') || cacheOnly;
assert.ok(!(metadataOnly && templateOnly), 'Choose at most one acceptance group');
const cleanupIndex = process.argv.indexOf('--cleanup');
const cleanupPath = cleanupIndex < 0 ? null : process.argv[cleanupIndex + 1];
const first = (...keys) => keys.map(key => process.env[key]).find(Boolean);
const accessKeyId = first('ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALICLOUD_ACCESS_KEY_ID', 'ABX_ACCESS_KEY_ID');
const accessKeySecret = first('ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALICLOUD_ACCESS_KEY_SECRET', 'ABX_ACCESS_KEY_SECRET');
const securityToken = first('ALIBABA_CLOUD_SECURITY_TOKEN');
const region = first('ALIBABA_CLOUD_REGION_ID', 'ABX_REGION') || 'cn-hangzhou';
const sandboxKey = first('ABX_SANDBOX_API_KEY', 'E2B_API_KEY');
const domain = first('ABX_SANDBOX_DOMAIN', 'E2B_DOMAIN');
const origin = first('ABX_SANDBOX_BASE_URL', 'E2B_API_URL') || `https://api.${domain || `${region}.e2b.fc.aliyuncs.com`}`;
const teamId = first('ABX_E2E_TEAM_ID');
assert.ok(accessKeyId && accessKeySecret, 'Supply existing Alibaba Cloud AccessKeys through the child environment');
assert.ok(/^[a-z][a-z0-9-]+$/.test(region), 'Invalid region');
if (!metadataOnly && !cleanupPath) assert.ok(teamId && sandboxKey, 'Supply ABX_E2E_TEAM_ID for the existing Sandbox Key and that Key; no Key is created');
const require = createRequire(import.meta.url);
const sdk = require('@alicloud/sandbox20260820');
const core = require('@alicloud/openapi-core');
const Config = core.$OpenApiUtil?.Config ?? core.OpenApiUtil?.Config;
const client = new (sdk.default ?? sdk.Client)(new Config({ accessKeyId, accessKeySecret, securityToken, regionId: region,
  endpoint: `sandbox.${region}.aliyuncs.com`, retryOptions: { retryable: false }, connectTimeout: 15000, readTimeout: 45000 }));
const runtime = { autoretry: false, maxAttempts: 1, connectTimeout: 15000, readTimeout: 45000 };
const model = (name, values = {}) => new sdk[name](values);
const body = response => response.body?.toMap?.() ?? response.body;
const status = error => Number(error?.statusCode ?? error?.data?.statusCode ?? 0);
const failureCode = error => {
  const code = String(error?.code ?? error?.data?.Code ?? error?.name ?? 'Error');
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(code) && ![accessKeyId, accessKeySecret, securityToken, sandboxKey].filter(Boolean).some(secret => code.includes(secret)) ? code : 'Error';
};
const fail = (stage, detail = 'assertion failed') => { const e = new Error(stage); e.safeDetail = detail; throw e; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function direct(method, ...args) { return body(await client[method](...args, {}, runtime)); }
async function collection(method, requestName, values, field, pagination = 'cursor') {
  const items = []; let nextToken; let pageNumber = 1;
  do {
    const request = pagination === 'page' ? { ...values, pageNumber, pageSize: 100 } : { ...values, maxResults: 100, nextToken };
    const page = await direct(method, model(requestName, request));
    assert.ok(Array.isArray(page[field]), 'Cloud inventory must return a list');
    items.push(...page[field]);
    if (pagination === 'page') { if (items.length >= page.total || page[field].length < 100) break; pageNumber++; }
    else nextToken = page.nextToken || null;
  } while (pagination === 'page' ? pageNumber < 100 : nextToken);
  return items;
}
const teams = () => collection('listTeamsWithOptions', 'ListTeamsRequest', {}, 'teams', 'page');
const templates = team => collection('listTemplatesWithOptions', 'ListTemplatesRequest', { teamID: team }, 'templates');
const volumes = team => collection('listVolumesWithOptions', 'ListVolumesRequest', { teamID: team }, 'volumes');
const quotas = () => collection('listQuotaWithOptions', 'ListQuotaRequest', {}, 'quotas');
const getTemplate = (id, team) => direct('getTemplateWithOptions', id, model('GetTemplateRequest', { teamID: team }));
const getVolume = (id, team) => direct('getVolumeWithOptions', id, model('GetVolumeRequest', { teamID: team }));
const getTeam = id => direct('getTeamWithOptions', id, model('GetTeamRequest'));
async function api(path, options = {}) {
  return fetch(`${origin.replace(/\/$/, '')}${path}`, { ...options, headers: { 'X-API-Key': sandboxKey, ...options.headers },
    redirect: 'error', signal: AbortSignal.timeout(45000) });
}

const root = cleanupPath ? resolve(cleanupPath, '..') : mkdtempSync(join(tmpdir(), 'abx-express-management-'));
chmodSync(root, 0o700);
const home = join(root, 'home'); const project = join(root, 'project');
for (const directory of [home, project]) mkdirSync(directory, { recursive: true, mode: 0o700 });
const ledgerPath = cleanupPath || join(root, 'owned-resources.json');
const ledger = cleanupPath ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {
  version: 1, run: `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`, region, resources: [], attempts: [],
};
assert.equal(ledger.version, 1); assert.equal(ledger.region, region);
assert.match(ledger.run, /^[a-z0-9]+-[a-f0-9]{8}$/);
assert.ok(ledger.resources.every(item => typeof item.name === 'string' && item.name.startsWith(`abx-mgmt-${ledger.run}-`)), 'Recovery ledger contains a resource outside this run namespace');
const save = () => { writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', { mode: 0o600 }); chmodSync(ledgerPath, 0o600); };
const own = (kind, id, name, team) => {
  assert.ok(typeof id === 'string' && id.length > 0, 'Owned resource needs an actual ID');
  const existing = ledger.resources.find(item => item.kind === kind && item.id === id && item.team === team);
  if (existing) return existing;
  const resource = { kind, id, name, team, state: 'owned' }; ledger.resources.push(resource); save(); return resource;
};
const name = suffix => `abx-mgmt-${ledger.run}-${suffix}`;
const binary = parseBin(process.env.ABX_BIN || 'abx');
const env = baseEnv({ home, creds: { ALICLOUD_ACCESS_KEY_ID: accessKeyId, ALICLOUD_ACCESS_KEY_SECRET: accessKeySecret,
  ALIBABA_CLOUD_SECURITY_TOKEN: securityToken, ALIBABA_CLOUD_REGION_ID: region, ABX_SANDBOX_API_KEY: sandboxKey,
  ABX_SANDBOX_BASE_URL: origin, ABX_SANDBOX_DOMAIN: domain }, extra: { ABX_NO_KEYCHAIN: '1', ABX_PROVIDER: 'alicloud-express' } });
let inputNumber = 0;
async function command(id, input, timeoutMs = 90000) {
  assert.ok(!id.startsWith('api-key.'), 'This acceptance script cannot call API Key operations');
  const path = join(root, `input-${++inputNumber}.json`); writeFileSync(path, JSON.stringify(input), { mode: 0o600 });
  const result = await runBinary({ bin: binary, argv: ['--json', 'provider', 'command', 'run', 'alicloud-express', id, '--input-file', path, '--yes'], env, cwd: project, timeoutMs });
  let parsed; try { parsed = JSON.parse(result.stdout); } catch { /* No raw output in diagnostics. */ }
  if (result.code !== 0 || !parsed || parsed.error || parsed.status === 'error') {
    const match = String(parsed?.error?.message ?? parsed?.message ?? '').match(/\(([A-Za-z][A-Za-z0-9_.-]{0,79})(?:; HTTP ([0-9]{3}))?/);
    const code = match?.[1] ?? parsed?.error?.code ?? parsed?.code;
    const error = new Error(id);
    error.safeDetail = `exit=${result.code}; code=${code ? failureCode({ code }) : 'unavailable'}${match?.[2] ? `; HTTP ${match[2]}` : ''}; raw output withheld`;
    error.definiteRejection = Number(match?.[2]) >= 400 && Number(match?.[2]) < 500;
    throw error;
  }
  return parsed.data ?? parsed;
}
async function createOnce(kind, alias, team, input, reconcile, idField) {
  assert.ok(!ledger.attempts.some(item => item.kind === kind && item.name === alias), 'A create attempt must never be replayed');
  const attempt = { kind, name: alias, team, state: 'submitted' }; ledger.attempts.push(attempt); save();
  try {
    const result = await command(`${kind}.create`, input);
    const resource = own(kind, result.data?.[idField] ?? result[idField], alias, team); attempt.state = 'resolved'; save(); return resource;
  } catch (error) {
    const found = (await reconcile()).filter(item => item.name === alias || item.teamName === alias || item.volumeName === alias);
    if (found.length === 1) { own(kind, found[0][idField === 'team_id' ? 'teamID' : idField === 'template_id' ? 'templateID' : 'volumeID'], alias, team); attempt.state = 'resolved'; save(); }
    else if (!found.length) { attempt.state = error.definiteRejection ? 'rejected' : 'unknown'; save(); }
    throw error;
  }
}
async function waitTemplate(resource) {
  const until = Date.now() + Number(process.env.ABX_E2E_BUILD_TIMEOUT_MS || 600000);
  while (Date.now() < until) {
    const data = await getTemplate(resource.id, resource.team); assert.equal(data.name, resource.name, 'Template ownership mismatch');
    const state = String(data.status?.state).toLowerCase();
    if (state === 'ready') return data;
    if (['failed', 'error'].includes(state)) fail('template-build', 'cloud build failed; private status text withheld');
    await delay(5000);
  }
  fail('template-build', 'timed out waiting for ready; no mutation replay');
}
async function sandboxArtifact(template, expected, absent = false) {
  const attempt = { kind: 'sandbox', name: name(`sandbox-${ledger.attempts.length}`), team: template.team, template: template.id, state: 'submitted' };
  ledger.attempts.push(attempt); save();
  const response = await api('/sandboxes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateID: template.id, timeout: 180, secure: true, metadata: { abx_management_run: ledger.run, abx_management_attempt: attempt.name } }) });
  if (!response.ok) fail('sandbox-create', `HTTP ${response.status}; create not replayed`);
  const value = await response.json(); const id = value.sandboxID;
  assert.ok(typeof id === 'string', 'Sandbox create must return ID');
  const resource = own('sandbox', id, attempt.name, template.team); resource.template = template.id; attempt.state = 'resolved'; save();
  const result = await runBinary({ bin: binary, argv: ['sandbox', 'exec', id, 'sh', '-c', absent ? 'test ! -e /tmp/abx-management-marker' : 'cat /tmp/abx-management-marker'], env, cwd: project, timeoutMs: 90000 });
  assert.equal(result.code, 0, 'Independent sandbox artifact command failed; raw output withheld');
  if (!absent) assert.equal(result.stdout.trim(), expected, 'Actual sandbox artifact does not match the requested template build');
  await remove(resource);
}
async function absent(read) {
  const until = Date.now() + 30000;
  do {
    try { await read(); } catch (error) { if (status(error) === 404 || /NotFound$/.test(failureCode(error))) return; throw error; }
    await delay(1000);
  } while (Date.now() < until);
  fail('cleanup', 'resource remains after delete');
}
async function remove(resource) {
  if (resource.state === 'deleted') return;
  const { kind, id, team } = resource;
  if (kind === 'sandbox') {
    const observed = await api(`/sandboxes/${encodeURIComponent(id)}`);
    if (observed.status !== 404) {
      assert.equal(observed.status, 200); const value = await observed.json();
      assert.equal(value.metadata?.abx_management_run, ledger.run, 'Sandbox ownership mismatch');
      const deleted = await api(`/sandboxes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      assert.ok(deleted.ok || deleted.status === 404, 'Sandbox deletion failed');
    }
    assert.equal((await api(`/sandboxes/${encodeURIComponent(id)}`)).status, 404, 'Deleted sandbox still exists');
  } else if (kind === 'template-cache') {
    const template = ledger.resources.find(item => item.kind === 'template' && item.id === id && item.team === team);
    assert.ok(template, 'Cache cleanup requires owned template');
    assert.equal((await getTemplate(id, team)).name, template.name, 'Cache template ownership mismatch');
    await command('template-cache.delete', { team_id: team, template_id: id });
    await absent(() => direct('describeTemplateCacheWithOptions', id, model('DescribeTemplateCacheRequest', { teamID: team })));
  } else if (kind === 'template') {
    const observed = await getTemplate(id, team).catch(error => { if (status(error) === 404) return null; throw error; });
    if (observed) { assert.equal(observed.name, resource.name); await command('template.delete', { team_id: team, template_id: id }); }
    await absent(() => getTemplate(id, team));
  } else if (kind === 'volume') {
    const observed = await getVolume(id, team).catch(error => { if (status(error) === 404) return null; throw error; });
    if (observed) { assert.equal(observed.volume?.volumeName, resource.name); await command('volume.delete', { team_id: team, volume_id: id }); }
    await absent(() => getVolume(id, team));
  } else if (kind === 'quota') {
    const owner = ledger.resources.find(item => item.kind === 'team' && item.id === id);
    assert.ok(owner, 'Quota cleanup requires owned Team');
    assert.equal((await getTeam(id)).team?.teamName, owner.name, 'Quota Team ownership mismatch');
    await command('quota.delete', { team_id: id });
    assert.ok(!(await quotas()).some(item => item.tagValue === id), 'Quota remains after delete');
  } else if (kind === 'team') {
    const observed = await getTeam(id).catch(error => { if (status(error) === 404) return null; throw error; });
    if (observed) { assert.equal(observed.team?.teamName, resource.name); await command('team.delete', { team_id: id }); }
    await absent(() => getTeam(id));
  } else fail('cleanup', 'unknown resource kind');
  resource.state = 'deleted'; save();
}
async function reconcileAttempts() {
  for (const attempt of ledger.attempts.filter(item => ['submitted', 'unknown'].includes(item.state))) {
    let candidates = [];
    if (attempt.kind === 'team') candidates = (await teams()).filter(item => item.teamName === attempt.name).map(item => item.teamID);
    else if (attempt.kind === 'template') candidates = (await templates(attempt.team)).filter(item => item.name === attempt.name).map(item => item.templateID);
    else if (attempt.kind === 'volume') candidates = (await volumes(attempt.team)).filter(item => item.volumeName === attempt.name).map(item => item.volumeID);
    else if (attempt.kind === 'sandbox') {
      const response = await api(`/v2/sandboxes?metadata=${encodeURIComponent(`abx_management_run=${ledger.run}`)}&state=running,paused&limit=100`);
      assert.equal(response.status, 200, 'Unknown sandbox submission requires inventory reconciliation');
      const result = await response.json(); assert.ok(Array.isArray(result));
      candidates = result.filter(item => item.metadata?.abx_management_run === ledger.run && item.metadata?.abx_management_attempt === attempt.name).map(item => item.sandboxID);
    }
    assert.ok(candidates.length <= 1, 'Ambiguous ownership requires manual recovery');
    if (candidates.length) own(attempt.kind, candidates[0], attempt.name, attempt.team);
    attempt.state = candidates.length ? 'resolved' : 'unknown'; save();
  }
}
const results = [];
async function scenario(label, fn) {
  console.log(`RUN ${label}`);
  try { await fn(); results.push({ scenario: label, result: 'PASS' }); console.log(`PASS ${label}`); }
  catch (error) { results.push({ scenario: label, result: 'FAIL', code: failureCode(error), http: status(error) || undefined,
    detail: error.safeDetail || 'assertion or service failure; raw output withheld' }); console.log(`FAIL ${label} (${failureCode(error)}${status(error) ? ` HTTP ${status(error)}` : ''})`); }
}
if (inspect) {
  await teams();
  if (teamId) { const list = await templates(teamId); assert.ok(Array.isArray(list)); }
  console.log('PASS read-only native management preflight; credentials and resource identifiers withheld');
  process.exit(0);
}
save(); console.log(`Recovery ledger: ${ledgerPath}`);
if (!cleanupPath) {
  if (!templateOnly) {
    let ownedTeam;
    await scenario('owned-team-crud', async () => {
      ownedTeam = await createOnce('team', name('team'), undefined, { team_name: name('team'), description: 'Owned Express management acceptance', plan: 'eco' }, teams, 'team_id');
      const reference = { team_id: ownedTeam.id };
      assert.equal((await command('team.get', reference)).team_name, ownedTeam.name);
      await command('team.list', { team_name: ownedTeam.name });
      await command('team.update', { ...reference, description: 'Owned Express management acceptance updated' });
      assert.equal((await getTeam(ownedTeam.id)).team.description, 'Owned Express management acceptance updated');
    });
    if (ownedTeam) {
      await scenario('owned-quota-instance-count', async () => {
        const resource = own('quota', ownedTeam.id, ownedTeam.name, ownedTeam.id);
        for (const count of [2, 0, -1]) {
          await command('quota.update', { team_id: ownedTeam.id, cpu_cores: 0, memory_gb: 0, instance_count: count });
          const actual = await command('quota.get', { team_id: ownedTeam.id });
          if (count >= 0) assert.equal(actual.instance_count, count, 'Quota instance count was lost');
          else assert.ok(actual.instance_count === undefined || actual.instance_count === -1, 'Quota instance count was not cleared');
        }
        await command('quota.list', { max_results: 100 }); await remove(resource);
      });
      const suffix = ledger.run.replace(/[^a-z0-9-]/g, '');
      const configs = {
        oss: { oss_volume_config: { bucket_name: `abx-${suffix}`, bucket_path: '/', endpoint: `https://oss-${region}.aliyuncs.com`, read_only: true } },
        agenticfs: { agentic_fs_volume_config: { server_addr: `ap-${suffix}.example.invalid:/`, user_id: 1000, group_id: 1000 } },
        agenticbucket: { agentic_bucket_volume_config: { agentic_bucket: `abx-${suffix}`, bucket_name: `abx-${suffix}`, bucket_path: '/', endpoint: `https://oss-${region}.aliyuncs.com`, read_only: true } },
        juicefs: { juice_fs_volume_config: { base_url: 'http://127.0.0.1:8080', token: 'owned-metadata-test-token', volume_name: `abx-${suffix}`, remote_dir: '/' } },
      };
      for (const [label, config] of Object.entries(configs)) await scenario(`owned-volume-${label}-metadata-crud`, async () => {
        const resource = await createOnce('volume', name(label), ownedTeam.id, { team_id: ownedTeam.id, volume_name: name(label), ...config }, () => volumes(ownedTeam.id), 'volume_id');
        const reference = { team_id: ownedTeam.id, volume_id: resource.id };
        const actual = await command('volume.get', reference); const raw = (await getVolume(resource.id, ownedTeam.id)).volume;
        assert.equal(raw.volumeName, resource.name); assert.ok(raw.storageClass);
        if (label === 'juicefs' && actual.juice_fs_volume_config?.token !== undefined) assert.equal(actual.juice_fs_volume_config.token, '[REDACTED]');
        const filtered = await command('volume.list', { team_id: ownedTeam.id, storage_class: raw.storageClass, max_results: 100 });
        assert.ok(filtered.volumes.some(item => item.volume_id === resource.id), 'Storage class filter lost owned Volume');
        const changed = structuredClone(config); const value = Object.values(changed)[0];
        if ('read_only' in value) value.read_only = false;
        else if ('user_id' in value) value.user_id = 1001;
        else value.remote_dir = '/updated';
        await command('volume.update', { ...reference, ...changed }); await command('volume.get', reference);
        const updated = (await getVolume(resource.id, ownedTeam.id)).volume;
        const updatedConfig = updated[Object.keys(changed)[0].replace('oss_volume_config', 'ossVolumeConfig').replace('agentic_fs_volume_config', 'agenticFSVolumeConfig').replace('agentic_bucket_volume_config', 'agenticBucketVolumeConfig').replace('juice_fs_volume_config', 'juiceFSVolumeConfig')];
        if ('read_only' in value) assert.equal(updatedConfig?.readOnly, value.read_only, 'Volume update did not change readOnly');
        else if ('user_id' in value) assert.equal(updatedConfig?.userID, value.user_id, 'Volume update did not change userID');
        else assert.equal(updatedConfig?.remoteDir, value.remote_dir, 'Volume update did not change remoteDir');
        await remove(resource);
      });
    }
  }
  if (!metadataOnly) {
    let template;
    await scenario(cacheOnly ? 'owned-ready-template-for-cache-control' : 'template-create-and-actual-steps-v1', async () => {
      const image = `fc-e2b-registry.${region}.cr.aliyuncs.com/runtime-v2/base:v0.0.53`;
      template = await createOnce('template', name('steps'), teamId, { team_id: teamId, name: name('steps'), runtime_config: {
        cpu: 2, memory_size: 2048, disk_size: 15360, sandbox_config: { image, generation: 2,
          steps: [{ type: 'RUN', args: [`printf '%s' 'marker-${ledger.run}-v1' > /tmp/abx-management-marker`] }] } } }, () => templates(teamId), 'template_id');
      await waitTemplate(template); await command('template.list', { team_id: teamId, max_results: 100 });
      await command('template.get', { team_id: teamId, template_id: template.id });
      if (!cacheOnly) await sandboxArtifact(template, `marker-${ledger.run}-v1`);
    });
    if (template) {
      if (!cacheOnly) await scenario('same-name-native-deploy-updates-actual-steps-v2', async () => {
        writeFileSync(join(project, 'template.yaml'), [`name: ${template.name}`, `base: fc-e2b-registry.${region}.cr.aliyuncs.com/runtime-v2/base:v0.0.53`,
          'generation: 2', 'resources:', '  cpu: 2', '  memory: 2048', 'build:', '  mode: steps', '  run:',
          `    - ${JSON.stringify(`printf '%s' 'marker-${ledger.run}-v2' > /tmp/abx-management-marker`)}`, ''].join('\n'), { mode: 0o600 });
        const result = await runBinary({ bin: binary, argv: ['--native', '--json', 'template', 'deploy', project, '--build', 'steps', '--yes', '--alias', template.name,
          '--team-id', teamId, '--generation', '2', '--cpu', '2', '--memory', '2048', '--disk-size', '15360', '--timeout', '600'], env, cwd: project, timeoutMs: 660000 });
        assert.equal(result.code, 0, 'Same-name native deploy failed; raw output withheld');
        await waitTemplate(template); await sandboxArtifact(template, `marker-${ledger.run}-v2`);
      });
      if (!cacheOnly) await scenario('template-update-explicit-empty-steps', async () => {
        await command('template.update', { team_id: teamId, template_id: template.id, runtime_config: { sandbox_config: { steps: [] } } });
        await waitTemplate(template); const observed = await command('template.get', { team_id: teamId, template_id: template.id });
        const remainingSteps = observed.runtime_config?.sandbox_config?.steps;
        assert.ok(remainingSteps === undefined || Array.isArray(remainingSteps) && remainingSteps.length === 0, 'Cleared steps must be absent or empty');
        await sandboxArtifact(template, undefined, true);
      });
      await scenario('owned-template-cache-crud', async () => {
        // Cache ownership is the exclusively owned template; never touches a preexisting template cache.
        const cache = own('template-cache', template.id, template.name, teamId);
        try { await command('template-cache.create', { team_id: teamId, template_id: template.id }); }
        catch (error) {
          if (!error.safeDetail?.includes('HTTP 400')) throw error;
          // An explicit deterministic 400 + independently confirmed absence permits this
          // separately requested SDK control. Unknown outcomes are never replayed.
          await absent(() => direct('describeTemplateCacheWithOptions', template.id, model('DescribeTemplateCacheRequest', { teamID: teamId })));
          try {
            await direct('createTemplateCacheWithOptions', model('CreateTemplateCacheRequest', { body: model('CreateTemplateCacheInput', { teamID: teamId, templateID: template.id }) }));
          } catch (control) {
            const message = String(control?.data?.Message ?? control?.data?.message ?? control?.message ?? '').toLowerCase();
            const reasonTerms = ['team', 'template', 'generation', 'image', 'registry', 'digest', 'sha256', 'acr', 'official', 'unsupported', 'not supported', 'empty', 'required', 'invalid', 'plan', 'permission', 'disabled', 'enabled', 'format'].filter(term => message.includes(term));
            error.safeDetail += `; official SDK same-body control HTTP=${status(control)} code=${failureCode(control)} reason_terms=${reasonTerms.join(',')}`;
            throw error;
          }
          fail('cache-control', 'CLI rejected but official SDK accepted the same body; owned cache retained for cleanup');
        }
        const until = Date.now() + 300000;
        let ready = false;
        while (Date.now() < until) {
          const current = await command('template-cache.get', { team_id: teamId, template_id: template.id });
          if (String(current.status).toLowerCase() === 'ready') { ready = true; break; }
          if (/failed|error/i.test(String(current.status))) fail('cache-build', 'service cache failed; private status text withheld');
          await delay(5000);
        }
        assert.ok(ready, 'Cache must reach ready within the polling deadline');
        const listed = await command('template-cache.list', { team_id: teamId, template_id: template.id, max_results: 100 });
        assert.ok(listed.template_caches.some(item => item.template_id === template.id)); await remove(cache);
      });
    }
  }
}
await scenario('owned-resource-cleanup', async () => {
  await reconcileAttempts(); const errors = [];
  for (const resource of [...ledger.resources].reverse()) {
    try { await remove(resource); } catch (error) { errors.push({ kind: resource.kind, code: failureCode(error), http: status(error) || undefined }); }
  }
  if (errors.length) fail('cleanup', JSON.stringify(errors));
});
const remaining = ledger.resources.filter(item => item.state !== 'deleted').length;
console.log(JSON.stringify({ run: ledger.run, scenarios: results, remaining_owned_resources: remaining,
  unresolved_submissions: ledger.attempts.filter(item => ['submitted', 'unknown'].includes(item.state)).length, ledger: ledgerPath,
  scope: 'Volume metadata only; no backing-storage mount or API Key mutations' }, null, 2));
process.exitCode = results.some(item => item.result !== 'PASS') || remaining || ledger.attempts.some(item => ['submitted', 'unknown'].includes(item.state)) ? 1 : 0;

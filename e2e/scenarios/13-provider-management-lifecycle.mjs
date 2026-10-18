// Opt-in real-cloud metadata lifecycles. No sandbox is created or storage mounted.
// Operator prerequisites:
//   ABX_E2E_PROVIDER_MANAGEMENT_WRITE=1
//   ABX_E2E_MANAGEMENT_TEAM_PLAN=<an explicitly selected eligible plan>
//   ABX_E2E_MANAGEMENT_RESOURCE_GROUP_ID=<an authorized resource group>
// Additional opt-ins: ABX_E2E_MANAGEMENT_QUOTA=1 / ABX_E2E_MANAGEMENT_VOLUME=1.
// The existing-Team key-only scenario instead requires an explicit
// ABX_E2E_MANAGEMENT_EXISTING_TEAM_ID; it never modifies/deletes that Team.
// No existing Team, key, Volume, quota, subscription, or storage data is mutated.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROVIDER = 'alicloud-express';
const STORAGE_KEYS = ['oss_volume_config', 'agentic_fs_volume_config', 'agentic_bucket_volume_config'];

function prerequisites(ctx, extraFlag) {
  if (process.env.ABX_E2E_PROVIDER_MANAGEMENT_WRITE !== '1') ctx.skip('opt-in: set ABX_E2E_PROVIDER_MANAGEMENT_WRITE=1 to create and clean up isolated cloud metadata');
  if (extraFlag && process.env[extraFlag] !== '1') ctx.skip(`opt-in: set ${extraFlag}=1 after checking the account has this backend capability`);
  const plan = process.env.ABX_E2E_MANAGEMENT_TEAM_PLAN?.trim();
  const resourceGroup = process.env.ABX_E2E_MANAGEMENT_RESOURCE_GROUP_ID?.trim();
  if (!plan || !resourceGroup) ctx.skip('an operator-selected eligible Team plan and authorized resource group are required: set ABX_E2E_MANAGEMENT_TEAM_PLAN and ABX_E2E_MANAGEMENT_RESOURCE_GROUP_ID; no subscription plan is guessed or copied');
  return { plan, resource_group_id: resourceGroup };
}

function stateFor(ctx) {
  // Use the short alphanumeric form verified by the real CreateTeam API.
  const name = `abx${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const directory = join(ctx.cwd, name);
  mkdirSync(directory, { mode: 0o700 });
  return {
    name, directory, teamId: null, teamAttempted: false,
    keys: new Set(), keyNames: new Set(), volumes: new Set(), volumeNames: new Set(),
    quotaAttempted: false, secrets: new Set(),
  };
}

function noSecrets(ctx, result, state) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  for (const secret of state.secrets) if (secret && output.includes(secret)) ctx.fail('a generated API key was exposed in CLI output');
  const scan = (value) => {
    if (Array.isArray(value)) return value.forEach(scan);
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (key === 'api_key_value' && child !== '[REDACTED]') ctx.fail('the structured API key value was not redacted');
      scan(child);
    }
  };
  scan(result.json);
}

/** Never include captured cloud output in errors: new keys are not part of the harness masker yet. */
async function invoke(ctx, state, id, input = {}, { missingOkay = false } = {}) {
  const filename = join(state.directory, `input-${randomUUID()}.json`);
  writeFileSync(filename, JSON.stringify(input), { flag: 'wx', mode: 0o600 });
  let result;
  try {
    result = await ctx.rawAbx(['--json', 'provider', 'command', 'run', PROVIDER, id, '--input-file', filename, '--yes'], { timeoutMs: 90_000 });
  } finally {
    rmSync(filename, { force: true });
  }
  result.json = ctx.parseJsonLoose(result.stdout);
  noSecrets(ctx, result, state);
  if (missingOkay && result.code === 4 && result.json?.code === 'E8005') return null;
  if (result.code !== 0 || result.timedOut) {
    const code = /^[A-Z][A-Za-z0-9_.-]{0,79}$/.test(result.json?.code ?? '') ? result.json.code : 'unavailable';
    throw new Error(`${id} failed (exit ${result.code}, error ${code}${result.timedOut ? ', timeout; remote outcome may be unknown' : ''}); raw service output omitted`);
  }
  if (!result.json || typeof result.json.data !== 'object' || result.json.data === null || !('request_id' in result.json)) throw new Error(`${id} returned an invalid management result; raw output omitted`);
  return result;
}

function requiredId(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}$/.test(value)) throw new Error(`${label} returned no usable identifier; cleanup will discover only this run's exact generated name`);
  return value;
}

function assertOwnTeam(ctx, state, resource) {
  if (resource.team_id !== undefined && resource.team_id !== state.teamId) ctx.fail('a resource response belongs to a different Team');
}

async function newTeam(ctx, state, configuration) {
  const before = await invoke(ctx, state, 'team.list', { team_name: state.name, page_size: 100 });
  if (!Array.isArray(before.json.data.teams) || before.json.data.teams.some((team) => team.team_name === state.name)) throw new Error('the generated Team name is not demonstrably unused; no mutation attempted');
  state.teamAttempted = true;
  const result = await invoke(ctx, state, 'team.create', {
    team_name: state.name, description: 'Temporary provider command E2E metadata; delete after this run', ...configuration,
  });
  state.teamId = requiredId(result.json.data.team_id, 'team.create');
  if (result.json.data.team_name !== state.name) ctx.fail('created Team name does not match this run');
  return result.json.data;
}

async function assertGone(ctx, state, command, input) {
  await ctx.eventually(async () => {
    const found = await invoke(ctx, state, command, input, { missingOkay: true });
    if (found !== null) throw new Error(`${command} still finds a resource deleted by this run`);
  }, { timeoutMs: 30_000, intervalMs: 2000, what: 'the test-owned metadata to disappear' });
}

/** This helper is used only for IDs created or recovered by this run, never pre-existing keys. */
async function deleteOwnedKey(ctx, state, id) {
  const current = await invoke(ctx, state, 'api-key.get', { api_key_id: id }, { missingOkay: true });
  if (current === null) return;
  assertOwnTeam(ctx, state, current.json.data);
  if (current.json.data.status === 'active') {
    await invoke(ctx, state, 'api-key.update', { api_key_id: id, status: 'inactive' });
    await ctx.eventually(async () => {
      const disabled = await invoke(ctx, state, 'api-key.get', { api_key_id: id }, { missingOkay: true });
      if (disabled !== null && disabled.json.data.status !== 'inactive') throw new Error('the test-created API key has not become inactive');
    }, { timeoutMs: 30_000, intervalMs: 2000, what: 'the test-created API key to become inactive' });
  } else if (current.json.data.status !== 'inactive') {
    throw new Error('the test-created API key has an unknown status; no transition or deletion was guessed');
  }
  await invoke(ctx, state, 'api-key.delete', { api_key_id: id }, { missingOkay: true });
  await assertGone(ctx, state, 'api-key.get', { api_key_id: id });
}

/** Discovery is read-only; only exact random names inside the new Team may be recovered for cleanup. */
async function cleanup(ctx, state) {
  const errors = [];
  const attempt = async (label, fn) => { try { await fn(); } catch { errors.push(label); } };
  if (!state.teamId && state.teamAttempted) await attempt('recover generated Team ID', async () => {
    const result = await invoke(ctx, state, 'team.list', { team_name: state.name, page_size: 100 });
    const teams = result.json.data.teams.filter((team) => team.team_name === state.name);
    if (teams.length > 1) throw new Error('ambiguous generated Team name');
    if (teams.length === 1) state.teamId = requiredId(teams[0].team_id, 'team.list');
  });
  if (!state.teamId) return errors;
  // An unknown create outcome can omit its response ID. Recover only names planned by this invocation.
  if (state.keyNames.size) await attempt('discover test-created API keys', async () => {
    for (const name of state.keyNames) {
      const result = await invoke(ctx, state, 'api-key.list', { team_id: state.teamId, api_key_name: name, page_size: 100 });
      for (const key of result.json.data.api_keys) if (key.api_key_name === name) {
        assertOwnTeam(ctx, state, key);
        state.keys.add(requiredId(key.api_key_id, 'api-key.list'));
      }
    }
  });
  for (const id of state.keys) await attempt(`delete test API key ${id}`, async () => {
    await deleteOwnedKey(ctx, state, id);
  });
  if (state.volumeNames.size) await attempt('discover test-created Volumes', async () => {
    const result = await invoke(ctx, state, 'volume.list', { team_id: state.teamId, max_results: 100 });
    for (const volume of result.json.data.volumes) if (state.volumeNames.has(volume.volume_name)) {
      assertOwnTeam(ctx, state, volume);
      state.volumes.add(requiredId(volume.volume_id, 'volume.list'));
    }
  });
  for (const id of state.volumes) await attempt(`delete test Volume ${id}`, async () => {
    await invoke(ctx, state, 'volume.delete', { team_id: state.teamId, volume_id: id }, { missingOkay: true });
    await assertGone(ctx, state, 'volume.get', { team_id: state.teamId, volume_id: id });
  });
  if (state.quotaAttempted) await attempt('delete quota for the test-created Team', async () => {
    await invoke(ctx, state, 'quota.delete', { team_id: state.teamId }, { missingOkay: true });
  });
  // Keep an observable owner when child cleanup fails; do not hide leaked children behind Team deletion.
  if (errors.length === 0 && state.teamAttempted) await attempt(`delete test Team ${state.teamId}`, async () => {
    await invoke(ctx, state, 'team.delete', { team_id: state.teamId }, { missingOkay: true });
    await assertGone(ctx, state, 'team.get', { team_id: state.teamId });
  });
  return errors;
}

async function withTeam(ctx, configuration, fn) {
  const state = stateFor(ctx);
  let failure;
  let cleanupErrors;
  try {
    await newTeam(ctx, state, configuration);
    await fn(state);
  } catch (error) {
    failure = error;
  } finally {
    try { cleanupErrors = await cleanup(ctx, state); }
    finally { rmSync(state.directory, { recursive: true, force: true }); }
  }
  if (cleanupErrors.length) throw new Error(`${failure ? `${failure.message}; ` : ''}cleanup failed: ${cleanupErrors.join('; ')}. Only test-owned IDs were targeted; manual cleanup may be required${state.teamId ? ` for Team ${state.teamId}` : ` for exact generated name ${state.name}`}`);
  if (failure) throw failure;
}

function readGeneratedSecret(ctx, state, filename, response) {
  if (!existsSync(filename) || (statSync(filename).mode & 0o777) !== 0o600) ctx.fail('new API key was not stored in an exclusive mode-0600 file');
  const secret = readFileSync(filename, 'utf8').trim();
  if (!secret || secret === '[REDACTED]') ctx.fail('API key file contains no usable generated secret');
  state.secrets.add(secret);
  noSecrets(ctx, response, state);
  if (response.json.data.secret_file !== filename || response.json.data.api_key_value !== '[REDACTED]') ctx.fail('API key result does not report its private file with a redacted key value');
  return secret;
}

async function keyLifecycle(ctx, state) {
  const keyName = `${state.name}-key`;
  state.keyNames.add(keyName);
  const createFile = join(state.directory, 'created-api-key');
  const created = await invoke(ctx, state, 'api-key.create', {
    team_id: state.teamId, api_key_name: keyName, secret_file: createFile,
    expire_time: new Date(Date.now() + 3600_000).toISOString(),
  });
  const keyId = requiredId(created.json.data.api_key_id, 'api-key.create');
  state.keys.add(keyId);
  assertOwnTeam(ctx, state, created.json.data);
  const initialSecret = readGeneratedSecret(ctx, state, createFile, created);
  const key = await invoke(ctx, state, 'api-key.get', { api_key_id: keyId });
  assertOwnTeam(ctx, state, key.json.data);
  const keys = await invoke(ctx, state, 'api-key.list', { team_id: state.teamId, api_key_name: keyName, page_size: 100 });
  if (!keys.json.data.api_keys.some((entry) => entry.api_key_id === keyId)) ctx.fail('api-key.list omitted the disposable key');
  const updatedName = `${keyName}-updated`;
  state.keyNames.add(updatedName);
  await invoke(ctx, state, 'api-key.update', { api_key_id: keyId, api_key_name: updatedName });
  const changed = await invoke(ctx, state, 'api-key.get', { api_key_id: keyId });
  if (changed.json.data.api_key_name !== updatedName) ctx.fail('API key metadata update did not persist');
  const resetFile = join(state.directory, 'rotated-api-key');
  const reset = await invoke(ctx, state, 'api-key.reset', { api_key_id: keyId, secret_file: resetFile });
  if (readGeneratedSecret(ctx, state, resetFile, reset) === initialSecret) ctx.fail('reset did not rotate the disposable key');
  await invoke(ctx, state, 'api-key.get', { api_key_id: keyId });
  await invoke(ctx, state, 'api-key.update', { api_key_id: keyId, status: 'inactive' });
  await deleteOwnedKey(ctx, state, keyId);
  state.keys.delete(keyId);
  state.keyNames.clear();
}

async function cloneSource(ctx, state) {
  const listed = await invoke(ctx, state, 'volume.list', { max_results: 100 });
  const sources = listed.json.data.volumes;
  if (!Array.isArray(sources)) throw new Error('volume.list returned no source list');
  for (const source of sources) {
    if (!source.team_id || !source.volume_id) continue;
    const result = await invoke(ctx, state, 'volume.get', { team_id: source.team_id, volume_id: source.volume_id });
    const config = result.json.data;
    const keys = STORAGE_KEYS.filter((key) => config[key] && Object.keys(config[key]).length);
    if (keys.length !== 1) continue;
    const storage = config[keys[0]];
    if (keys[0] === 'oss_volume_config' && (!storage.bucket_name || !storage.bucket_path || !storage.endpoint || typeof storage.read_only !== 'boolean')) continue;
    if (keys[0] === 'agentic_fs_volume_config' && !storage.server_addr) continue;
    if (keys[0] === 'agentic_bucket_volume_config' && (!storage.agentic_bucket || !storage.bucket_name || !storage.endpoint)) continue;
    return { [keys[0]]: storage, ...(config.mount_config ? { mount_config: config.mount_config } : {}) };
  }
  return null;
}

export default {
  id: 'provider-management-lifecycle',
  title: 'Opt-in isolated Team, API key, quota and Volume metadata lifecycles',
  needs: ['cloud'],
  scenarios: [
    {
      id: 'team-api-key-lifecycle',
      title: 'new Team get/list/update and disposable API key create/get/list/update/reset/delete; private secret files',
      async run(ctx) {
        const configuration = prerequisites(ctx);
        await withTeam(ctx, configuration, async (state) => {
          const team = await invoke(ctx, state, 'team.get', { team_id: state.teamId });
          if (team.json.data.team_name !== state.name) ctx.fail('team.get did not return the test-created Team');
          const list = await invoke(ctx, state, 'team.list', { team_name: state.name, page_size: 100 });
          if (!list.json.data.teams.some((entry) => entry.team_id === state.teamId)) ctx.fail('team.list omitted the test-created Team');
          await invoke(ctx, state, 'team.update', { team_id: state.teamId, description: 'Updated temporary provider command E2E metadata' });
          const updated = await invoke(ctx, state, 'team.get', { team_id: state.teamId });
          if (updated.json.data.description !== 'Updated temporary provider command E2E metadata') ctx.fail('Team description update did not persist');

          await keyLifecycle(ctx, state);
        });
      },
    },
    {
      id: 'existing-team-api-key-lifecycle',
      title: 'disposable API key lifecycle in an explicitly selected existing Team; no Team or existing-key mutation',
      async run(ctx) {
        if (process.env.ABX_E2E_PROVIDER_MANAGEMENT_WRITE !== '1') ctx.skip('opt-in: set ABX_E2E_PROVIDER_MANAGEMENT_WRITE=1 for a disposable API key lifecycle');
        const teamId = process.env.ABX_E2E_MANAGEMENT_EXISTING_TEAM_ID?.trim();
        if (!teamId) ctx.skip('set ABX_E2E_MANAGEMENT_EXISTING_TEAM_ID explicitly; this scenario never selects or changes a Team automatically');
        requiredId(teamId, 'the explicit existing Team selection');
        const state = stateFor(ctx);
        state.teamId = teamId;
        // teamAttempted remains false: common cleanup must never delete this existing Team.
        let failure;
        let cleanupErrors;
        try {
          const team = await invoke(ctx, state, 'team.get', { team_id: teamId });
          if (team.json.data.team_id !== teamId) ctx.fail('team.get does not match the explicit Team selection');
          await keyLifecycle(ctx, state);
        } catch (error) {
          failure = error;
        } finally {
          try { cleanupErrors = await cleanup(ctx, state); }
          finally { rmSync(state.directory, { recursive: true, force: true }); }
        }
        if (cleanupErrors.length) throw new Error(`${failure ? `${failure.message}; ` : ''}disposable API key cleanup failed: ${cleanupErrors.join('; ')}; the existing Team was not changed or deleted`);
        if (failure) throw failure;
      },
    },
    {
      id: 'quota-lifecycle',
      title: 'get/list/set zero CPU and memory/delete quota only for a newly created Team',
      async run(ctx) {
        const configuration = prerequisites(ctx, 'ABX_E2E_MANAGEMENT_QUOTA');
        await withTeam(ctx, configuration, async (state) => {
          await invoke(ctx, state, 'quota.get', { team_id: state.teamId }, { missingOkay: true });
          const before = await invoke(ctx, state, 'quota.list', { max_results: 100 });
          if (!Array.isArray(before.json.data.quotas)) ctx.fail('quota.list returned no quota array');
          state.quotaAttempted = true;
          await invoke(ctx, state, 'quota.update', { team_id: state.teamId, cpu_cores: 0, memory_gb: 0 });
          const quota = await invoke(ctx, state, 'quota.get', { team_id: state.teamId });
          if (quota.json.data.tag_value !== state.teamId || quota.json.data.cpu_cores !== 0 || quota.json.data.memory_gb !== 0) ctx.fail('zero-valued quota did not persist on the test-created Team');
          await invoke(ctx, state, 'quota.delete', { team_id: state.teamId });
          state.quotaAttempted = false;
        });
      },
    },
    {
      id: 'volume-lifecycle',
      title: 'clone an existing readable mount configuration as test metadata; get/list/delete without mounting storage',
      async run(ctx) {
        const configuration = prerequisites(ctx, 'ABX_E2E_MANAGEMENT_VOLUME');
        // Source discovery happens before a new Team is created. A missing backend leaves no resources.
        const probe = stateFor(ctx);
        let source;
        try { source = await cloneSource(ctx, probe); }
        finally { rmSync(probe.directory, { recursive: true, force: true }); }
        if (!source) ctx.skip('no readable Volume with a storage configuration supported by the locked SDK exists in the first source page; provide a real storage prerequisite before Volume lifecycle verification');
        await withTeam(ctx, configuration, async (state) => {
          const volumeName = `${state.name}-volume`;
          state.volumeNames.add(volumeName);
          const created = await invoke(ctx, state, 'volume.create', { team_id: state.teamId, volume_name: volumeName, ...source });
          const volumeId = requiredId(created.json.data.volume_id, 'volume.create');
          state.volumes.add(volumeId);
          assertOwnTeam(ctx, state, created.json.data);
          const volume = await invoke(ctx, state, 'volume.get', { team_id: state.teamId, volume_id: volumeId });
          if (volume.json.data.volume_name !== volumeName) ctx.fail('volume.get did not return the test-created metadata');
          const list = await invoke(ctx, state, 'volume.list', { team_id: state.teamId, max_results: 100 });
          if (!list.json.data.volumes.some((entry) => entry.volume_id === volumeId)) ctx.fail('volume.list omitted the test-created metadata');
          await invoke(ctx, state, 'volume.delete', { team_id: state.teamId, volume_id: volumeId });
          await assertGone(ctx, state, 'volume.get', { team_id: state.teamId, volume_id: volumeId });
          state.volumes.delete(volumeId);
          state.volumeNames.clear();
        });
      },
    },
    {
      id: 'volume-status-update',
      title: 'Volume status mutation needs a documented writable status transition',
      run(ctx) {
        ctx.skip('the locked UpdateVolume model has a status string but no documented writable enum/transition; read-side states are not permission to invent a status mutation');
      },
    },
  ],
};

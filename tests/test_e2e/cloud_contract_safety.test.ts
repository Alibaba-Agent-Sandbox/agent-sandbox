import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const suiteModule = '../../e2e/scenarios/20-cloud-lifecycle.mjs';
const readonlyModule = '../../e2e/scenarios/10-cloud-readonly.mjs';
const { default: readonlySuite } = await import(readonlyModule);
const helperModule = '../../e2e/lib/express-scenarios.mjs';
const runnerModule = '../../e2e/lib/runner.mjs';
const { leakCheck, cleanupTrackedSandboxes, makeContext } = await import(runnerModule);
const cleanupModule = '../../e2e/cleanup.mjs';
const { cleanupRecordedRun } = await import(cleanupModule);
const { default: suite } = await import(suiteModule);
const { configureExpressScenario, trackDetachedCreate } = await import(helperModule);
const directories: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const scenario = (id: string) => suite.scenarios.find((item: { id: string }) => item.id === id);
const fail = (message: string): never => { throw new Error(message); };
const journalFixture = () => ({ beginCreateAttempt: vi.fn(() => 'fixture-attempt'), resolveCreateAttempt: vi.fn() });
const result = (value: unknown, code = 0) => ({ code, stdout: '', stderr: '', out: '', rawJson: () => value });

it('configures each CLI surface from the selected test account without losing negative overrides', async () => {
  const execute = async (...args: [string[], { env: Record<string, string> }]) => ({ argv: args[0] });
  const abx = vi.fn(execute);
  const rawAbx = vi.fn(execute);
  const creds = { E2B_API_KEY: 'placeholder-good', E2B_API_URL: 'https://example.test', E2B_DOMAIN: 'example.test' };
  const ctx = { creds, abx, rawAbx };
  configureExpressScenario(ctx);
  await ctx.abx(['--native', '--json', 'info', 'owned'], { env: { E2B_API_KEY: 'placeholder-invalid' } });
  expect(abx.mock.calls[0]![1].env).toMatchObject({ E2B_API_KEY: 'placeholder-invalid', ABX_SANDBOX_API_KEY: 'placeholder-invalid', ABX_SANDBOX_BASE_URL: 'https://example.test' });
  await ctx.rawAbx(['config', 'list'], { env: { ABX_SANDBOX_API_KEY: 'placeholder-explicit' } });
  expect(rawAbx.mock.calls[0]![1].env.ABX_SANDBOX_API_KEY).toBe('placeholder-explicit');
  expect(creds).not.toHaveProperty('ABX_SANDBOX_API_KEY');
});

it('tracks the real detached ID before info fails, without replaying creation', async () => {
  const track = vi.fn();
  const abx = vi.fn().mockResolvedValueOnce({ code: 0, maskedStdout: 'sbx-owned-test\n', stdout: 'sbx-XXXXX\n' });
  abx.mockImplementationOnce(async () => {
    expect(track).toHaveBeenCalledWith('sbx-owned-test');
    throw new Error('info unavailable');
  });
  await expect(scenario('create-json').run({ ...journalFixture(), state: {}, abx, track, fail })).rejects.toThrow('info unavailable');
  expect(abx).toHaveBeenCalledTimes(2);
  expect(abx.mock.calls[0][0]).toContain('--detach');
  expect(scenario('create-json').retries).toBeUndefined();
});

it('retains a reported detached identity when the child exits unsuccessfully', () => {
  const track = vi.fn();
  expect(() => trackDetachedCreate({ track, fail }, { code: 1, maskedStdout: 'sbx-owned-test\n', out: 'child failed' })).toThrow('create exit 1');
  expect(track).toHaveBeenCalledWith('sbx-owned-test');
});

it('tracks the native-created identity before checking env/files, without replaying creation', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'abx-cloud-contract-'));
  directories.push(cwd);
  const track = vi.fn();
  const abx = vi.fn().mockResolvedValueOnce(result({ ID: 'sbx-native-test' }));
  abx.mockImplementationOnce(async () => {
    expect(track).toHaveBeenCalledWith('sbx-native-test');
    throw new Error('env probe failed');
  });
  await expect(scenario('create-with-env-and-upload').run({ ...journalFixture(), cwd, state: {}, abx, track, fail })).rejects.toThrow('env probe failed');
  expect(abx.mock.calls[0][0].slice(0, 3)).toEqual(['--native', '--json', 'create']);
  expect(scenario('create-with-env-and-upload').retries).toBeUndefined();
});

it('does not mark an owned sandbox cleaned when its absence is unconfirmed', async () => {
  const untrack = vi.fn();
  const ctx = { state: { id: 'sbx-owned-test' }, untrack, fail,
    abx: vi.fn(async () => ({ ...result({}, 1), out: 'network failure' })),
    eventually: async (fn: () => Promise<void>) => fn(),
  };
  await expect(scenario('kill-yes-json').after(ctx)).rejects.toThrow('did not confirm');
  expect(untrack).not.toHaveBeenCalled();
});

it('checks actual owned process disappearance after signalling its backend ID', async () => {
  const abx = vi.fn()
    .mockResolvedValueOnce({ ...result(null), stderr: '987654\n' })
    .mockResolvedValueOnce(result([{ pid: 987654, command: 'sleep 120' }]))
    .mockResolvedValueOnce({ ...result(null), stdout: 'Signal 15 sent to process 987654.' })
    .mockResolvedValueOnce(result([{ pid: 987654, command: 'sleep 120' }]))
    .mockResolvedValueOnce(result([]));
  let retries = 0;
  const ctx = { state: { id: 'sbx-owned-test' }, abx, fail,
    check: (_label: string, actual: string, expected: string) => expect(actual).toContain(expected),
    eventually: async (fn: () => Promise<void>) => { try { await fn(); } catch { retries++; await fn(); } },
  };
  await scenario('process-signal').run(ctx);
  expect(retries).toBe(1);
  expect(abx.mock.calls[2][0]).toEqual(['sandbox', 'process', 'signal', 'sbx-owned-test', '987654', '--signal', '15']);
  expect(abx).toHaveBeenCalledTimes(5);
});

it('attempts owned process cleanup when termination verification fails', async () => {
  const abx = vi.fn()
    .mockResolvedValueOnce({ ...result(null), stderr: '987654\n' })
    .mockResolvedValueOnce(result([{ pid: 987654, command: 'sleep 120' }]))
    .mockResolvedValueOnce({ ...result(null), stdout: 'Signal 15 sent to process 987654.' })
    .mockResolvedValueOnce(result([{ pid: 987654 }]))
    .mockResolvedValueOnce(result(null));
  const ctx = { state: { id: 'sbx-owned-test' }, abx, fail, check() {}, eventually: async (fn: () => Promise<void>) => fn() };
  await expect(scenario('process-signal').run(ctx)).rejects.toThrow('still running');
  expect(abx.mock.calls[4][0]).toEqual(['sandbox', 'process', 'signal', 'sbx-owned-test', '987654', '--signal', '9']);
});

it('does not untrack a sandbox when info is absent but list still reports it', async () => {
  const untrack = vi.fn();
  const abx = vi.fn()
    .mockResolvedValueOnce({ ...result(null, 1), out: "Sandbox wasn't found" })
    .mockResolvedValueOnce(result([{ sandboxId: 'sbx-owned-test' }]));
  const ctx = { state: { id: 'sbx-owned-test' }, abx, untrack, fail, eventually: async (fn: () => Promise<void>) => fn() };
  await expect(scenario('kill-yes-json').after(ctx)).rejects.toThrow('still listed');
  expect(untrack).not.toHaveBeenCalled();
});

it.each(['Error', 'failed', 'sbx-XXXXX', ''])('never tracks a non-resource detached response %j', (output) => {
  const track = vi.fn();
  expect(() => trackDetachedCreate({ track, fail }, { code: 0, maskedStdout: output, out: output })).toThrow('real Express sandbox ID');
  expect(track).not.toHaveBeenCalled();
});

it.each(['Error', 'failed', 'sbx-XXXXX'])('never tracks an invalid native create identity %j', async (id) => {
  const cwd = mkdtempSync(join(tmpdir(), 'abx-cloud-contract-'));
  directories.push(cwd);
  const track = vi.fn();
  const abx = vi.fn(async () => result({ ID: id }));
  await expect(scenario('create-with-env-and-upload').run({ ...journalFixture(), cwd, state: {}, abx, track, fail })).rejects.toThrow('valid owned sandbox identity');
  expect(track).not.toHaveBeenCalled();
  expect(abx).toHaveBeenCalledTimes(1);
});

function subprocessFixture(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'abx-cloud-cleanup-'));
  directories.push(root);
  const file = join(root, 'fixture.mjs');
  writeFileSync(file, source);
  return { root, bin: [process.execPath, file], creds: {}, tracker: { sandboxes: new Set(['sbx-owned-test']), killed: new Set<string>() } };
}

it.each([{}, { status: 'success' }, [{ ID: 'sbx-owned-test' }], [{ sandboxID: 'sbx-owned-test' }], [null], [{ sandboxId: '' }]])('cannot report leak-check PASS for malformed standard inventory %j', async (inventory) => {
  const fixture = subprocessFixture(`process.stdout.write(${JSON.stringify(JSON.stringify(inventory))});`);
  const record = await leakCheck({ ...fixture, cloudOk: true, skipOnlyOffline: false, mask: (value: string) => value });
  expect(record.status).toBe('fail');
  expect(record.reason).toContain('standard inventory');
});

it('confirms empty inventory only with exact owned-ID NotFound', async () => {
  const fixture = subprocessFixture(`if (process.argv.includes('info')) { process.stderr.write("Sandbox wasn't found"); process.exitCode = 1; } else process.stdout.write('[]');`);
  const record = await leakCheck({ ...fixture, cloudOk: true, skipOnlyOffline: false, mask: (value: string) => value });
  expect(record.status).toBe('pass');
});

it.each(['404 from gateway', 'endpoint not found'])('retains an owned sandbox when standard kill fails with %j', async (message) => {
  const fixture = subprocessFixture(`process.stderr.write(${JSON.stringify(message)}); process.exitCode = 1;`);
  const persist = vi.fn();
  await cleanupTrackedSandboxes({ ...fixture, persist });
  expect(fixture.tracker.killed.size).toBe(0);
  expect(persist).toHaveBeenCalledOnce();
});

it('does not treat standard successful/idempotent kill as independent absence proof', async () => {
  const fixture = subprocessFixture(`process.stderr.write("Sandbox wasn't found");`);
  await cleanupTrackedSandboxes({ ...fixture, persist() {} });
  expect(fixture.tracker.killed.has('sbx-owned-test')).toBe(false);
});

it('does not reintroduce credentials into a credential-free negative probe', async () => {
  const execute = vi.fn(async (...args: [string[], { env: Record<string, string>; creds?: boolean | Record<string, string> }]) => args);
  const ctx = { creds: { E2B_API_KEY: 'placeholder-good', E2B_API_URL: 'https://example.test' }, abx: execute, rawAbx: execute };
  configureExpressScenario(ctx);
  await ctx.abx(['--native', 'info', 'owned'], { creds: false, env: {} });
  expect(execute.mock.calls[0]![1].env).not.toHaveProperty('ABX_SANDBOX_API_KEY');
  expect(execute.mock.calls[0]![1].env).not.toHaveProperty('ABX_SANDBOX_BASE_URL');
  await ctx.abx(['--native', 'info', 'owned'], { creds: { E2B_API_KEY: 'placeholder-other' }, env: {} });
  expect(execute.mock.calls[1]![1].env.ABX_SANDBOX_API_KEY).toBe('placeholder-other');
  await ctx.abx(['--native', 'info', 'owned'], { creds: { ABX_SANDBOX_API_KEY: 'placeholder-native' }, env: {} });
  expect(execute.mock.calls[2]![1].env.ABX_SANDBOX_API_KEY).toBe('placeholder-native');
});

it('resolves positive official template info from the same native inventory instead of an alias', async () => {
  const abx = vi.fn()
    .mockResolvedValueOnce(result([{ TemplateID: 'tpl-owned', Name: 'fixture' }]))
    .mockResolvedValueOnce(result({ templateID: 'tpl-owned', statusCode: 200, code: 'Success', name: 'fixture', status: {state: 'Ready'}, runtimeConfig: {cpu: 2} }));
  const testCase = readonlySuite.scenarios.find((item: { id: string }) => item.id === 'template-info');
  await testCase.run({ abx, fail });
  expect(abx.mock.calls[0][0]).toEqual(['--native', '--json', 'template', 'list']);
  expect(abx.mock.calls[1][0]).toEqual(['--native', '--json', 'template', 'info', 'tpl-owned']);
});

it('does not accept a generic network/auth error as a missing official template', () => {
  const testCase = readonlySuite.scenarios.find((item: { id: string }) => item.id === 'template-info-missing-json');
  expect(() => testCase.json({ status: 'error', code: 'E5000', message: 'GetTemplate API call failed: 401 Unauthorized' })).toThrow('official API diagnostic');
  expect(() => testCase.json({ status: 'error', code: 'E5000', message: 'GetTemplate API call failed: TemplateNotFound code: 404' })).not.toThrow();
});

it('starts an explicitly selected application command once and requires its real process before any catalog/payload', async () => {
  vi.stubEnv('ABX_E2E_APP_START_COMMAND', 'fixture-server --port 9000');
  const abx = vi.fn()
    .mockResolvedValueOnce({ ...result(null), stderr: '987654\n' })
    .mockResolvedValueOnce(result([]));
  const ctx = { state: { id: 'sbx-owned-test' }, abx, fail, eventually: async (fn: () => Promise<void>) => fn() };
  await expect(scenario('run-named-command').run(ctx)).rejects.toThrow('application process is not running');
  expect(abx.mock.calls[0][0]).toEqual(['exec', '--background', 'sbx-owned-test', 'fixture-server --port 9000']);
  expect(abx).toHaveBeenCalledTimes(2);
});

it('does not replay application startup or send payloads while catalog readiness fails', async () => {
  vi.stubEnv('ABX_E2E_APP_START_COMMAND', 'fixture-server --port 9000');
  const abx = vi.fn()
    .mockResolvedValueOnce({ ...result(null), stderr: '987654\n' })
    .mockResolvedValueOnce(result([{ pid: 987654 }]))
    .mockResolvedValueOnce({ ...result([], 1), out: 'unready' })
    .mockResolvedValueOnce(result([{ pid: 987654 }]))
    .mockResolvedValueOnce({ ...result([], 1), out: 'unready' });
  const ctx = { state: { id: 'sbx-owned-test' }, abx, fail,
    eventually: async (fn: () => Promise<void>) => { try { await fn(); } catch { await fn(); } },
  };
  await expect(scenario('run-named-command').run(ctx)).rejects.toThrow('must expose protocol v2');
  expect(abx.mock.calls.filter(([argv]) => argv[0] === 'exec')).toHaveLength(1);
  expect(abx.mock.calls.filter(([argv]) => argv[0] === 'run')).toHaveLength(0);
});

it('rejects inconsistent resource measurements and inferred managed capability claims', () => {
  const metrics = scenario('system-metrics');
  expect(() => metrics.json({ cpu_load_1m: 0, cpu_load_5m: 0, cpu_load_15m: 0, disk_total_gb: 10, disk_used_gb: 3, disk_free_gb: 7 })).not.toThrow();
  // shutil exposes available blocks; reserved filesystem blocks may leave a gap.
  expect(() => metrics.json({ cpu_load_1m: 0, cpu_load_5m: 0, cpu_load_15m: 0, disk_total_gb: 10, disk_used_gb: 3, disk_free_gb: 6 })).not.toThrow();
  expect(() => metrics.json({ cpu_load_1m: 0, cpu_load_5m: 0, cpu_load_15m: 0, disk_total_gb: 10, disk_used_gb: 3, disk_free_gb: 9 })).toThrow('capacity');
  expect(() => scenario('capabilities-json').json({ capabilities: [] })).not.toThrow();
  expect(() => scenario('capabilities-json').json({ capabilities: ['shell', 'files'] })).toThrow('undeclared');
});

it('revokes optimistic cleanup, persists a live owned ID through four inventories and finally kill acknowledgement', async () => {
  const fixture = subprocessFixture(`if (process.argv.includes('list')) process.stdout.write('[{"sandboxId":"sbx-owned-test"}]');`);
  fixture.tracker.killed.add('sbx-owned-test');
  const file = join(fixture.root, 'run-residual.json');
  const persist = () => writeFileSync(file, JSON.stringify({ sandboxes: [...fixture.tracker.sandboxes].filter((id) => !fixture.tracker.killed.has(id)) }));
  const wait = vi.fn(async () => {});
  const checked = await leakCheck({ ...fixture, persist, cloudOk: true, skipOnlyOffline: false, wait });
  expect(checked.status).toBe('fail');
  expect(wait).toHaveBeenCalledTimes(3);
  expect(fixture.tracker.killed.has('sbx-owned-test')).toBe(false);
  await cleanupTrackedSandboxes({ ...fixture, persist });
  expect(fixture.tracker.killed.has('sbx-owned-test')).toBe(false);
  expect(JSON.parse(readFileSync(file, 'utf8')).sandboxes).toEqual(['sbx-owned-test']);
  expect([...fixture.tracker.sandboxes].filter((id) => !fixture.tracker.killed.has(id))).toHaveLength(1);
});

it('confirms cleanup only after inventory and exact owned-ID absence', async () => {
  const fixture = subprocessFixture(`if (process.argv.includes('info')) { process.stderr.write("Sandbox wasn't found"); process.exitCode = 1; } else process.stdout.write('[]');`);
  const persist = vi.fn();
  const checked = await leakCheck({ ...fixture, persist, cloudOk: true, skipOnlyOffline: false });
  expect(checked.status).toBe('pass');
  expect(fixture.tracker.killed.has('sbx-owned-test')).toBe(true);
  expect(persist).toHaveBeenCalledOnce();
});

it('standalone recovery preserves live resources and writes partial confirmed progress', async () => {
  const fixture = subprocessFixture(`if (process.argv.includes('list')) process.stdout.write('[{"sandboxId":"sbx-still-live"}]'); else if (process.argv.includes('info') && process.argv.includes('sbx-already-gone')) { process.stderr.write("Sandbox wasn't found"); process.exitCode = 1; }`);
  const record = { runId: 'fixture-run', sandboxes: ['sbx-still-live', 'sbx-already-gone'] };
  const file = join(fixture.root, 'run-fixture.json');
  writeFileSync(file, JSON.stringify(record));
  const creds = { E2B_API_KEY: 'placeholder-test', E2B_API_URL: 'https://example.test' };
  const recovered = await cleanupRecordedRun({ ...fixture, file, record, creds, wait: async () => {} });
  expect(recovered.result.status).toBe('fail');
  expect(recovered.remaining).toEqual(['sbx-still-live']);
  expect(JSON.parse(readFileSync(file, 'utf8')).sandboxes).toEqual(['sbx-still-live']);
});

it('standalone recovery removes its ledger only after independent complete absence', async () => {
  const fixture = subprocessFixture(`if (process.argv.includes('info')) { process.stderr.write("Sandbox wasn't found"); process.exitCode = 1; } else if (process.argv.includes('list')) process.stdout.write('[]');`);
  const record = { runId: 'fixture-run', sandboxes: ['sbx-already-gone'] };
  const file = join(fixture.root, 'run-fixture.json');
  writeFileSync(file, JSON.stringify(record));
  const creds = { E2B_API_KEY: 'placeholder-test', E2B_API_URL: 'https://example.test' };
  const recovered = await cleanupRecordedRun({ ...fixture, file, record, creds, wait: async () => {} });
  expect(recovered.result.status).toBe('pass');
  expect(recovered.remaining).toEqual([]);
  expect(existsSync(file)).toBe(false);
});

it('system ports rejects an authentication error while preserving its exact missing-tools condition', async () => {
  const testCase = scenario('system-ports');
  await expect(testCase.run({ state: { id: 'sbx-owned-test' }, abx: async () => ({ code: 1, out: '401 Unauthorized' }), fail })).rejects.toThrow('documented missing-tools');
  await expect(testCase.run({ state: { id: 'sbx-owned-test' }, abx: async () => ({ code: 1, out: 'Cannot determine listening ports (ss/netstat not available).' }), fail })).resolves.toBeUndefined();
});

it.each(['create-missing-template', 'create-missing-template-json'])('retains an unexpectedly created ID before rejecting negative case %s', async (id) => {
  const journal = journalFixture();
  const track = vi.fn();
  const abx = vi.fn(async () => ({ ...result({ ID: 'sbx-unexpected-create' }), maskedStdout: 'sbx-unexpected-create\n' }));
  const testCase = readonlySuite.scenarios.find((item: { id: string }) => item.id === id);
  await expect(testCase.run({ ...journal, abx, track, fail })).rejects.toThrow('unexpectedly returned');
  expect(track).toHaveBeenCalledWith('sbx-unexpected-create');
  expect(journal.resolveCreateAttempt).toHaveBeenCalledWith('fixture-attempt');
  expect(abx).toHaveBeenCalledOnce();
});

it.each([[{ command: 'sleep' }], [{ pid: null }], [{ pid: 0 }], [{ pid: '  ' }]])('never infers owned process absence from malformed process rows %j', async (malformed) => {
  const abx = vi.fn()
    .mockResolvedValueOnce({ ...result(null), stderr: '987654\n' })
    .mockResolvedValueOnce(result([{ pid: 987654 }]))
    .mockResolvedValueOnce({ ...result(null), stdout: 'Signal 15 sent to process 987654.' })
    .mockResolvedValueOnce(result(malformed))
    .mockResolvedValueOnce(result(null));
  const ctx = { state: { id: 'sbx-owned-test' }, abx, fail, check() {}, eventually: async (fn: () => Promise<void>) => fn() };
  await expect(scenario('process-signal').run(ctx)).rejects.toThrow('invalid process inventory');
  expect(abx.mock.calls[4][0]).toEqual(['sandbox', 'process', 'signal', 'sbx-owned-test', '987654', '--signal', '9']);
});

it('persists create intent before submission and retains an unresolved timeout through cleanup/recovery', async () => {
  const fixture = subprocessFixture(`if (process.argv.includes('info')) { process.stderr.write("Sandbox wasn't found"); process.exitCode = 1; } else process.stdout.write('[]');`);
  const tracker = { sandboxes: new Set<string>(), killed: new Set<string>(), uncertainCreates: new Set<string>() };
  const file = join(fixture.root, 'run-uncertain.json');
  const persist = () => writeFileSync(file, JSON.stringify({ runId: 'fixture-run', sandboxes: [...tracker.sandboxes].filter((id) => !tracker.killed.has(id)), uncertainCreates: [...tracker.uncertainCreates] }));
  const ctx = makeContext({ ...fixture, tracker, persist, state: {}, suite: { id: 'fixture' } });
  ctx.abx = vi.fn(async () => {
    expect(JSON.parse(readFileSync(file, 'utf8')).uncertainCreates).toHaveLength(1);
    return { code: 124, maskedStdout: '', out: 'timed out' };
  });
  await expect(scenario('create-json').run(ctx)).rejects.toThrow('create exit 124');
  const checked = await leakCheck({ ...fixture, tracker, persist, cloudOk: true, skipOnlyOffline: false });
  expect(checked.status).toBe('fail');
  expect(checked.reason).toContain('unresolved create');
  await cleanupTrackedSandboxes({ ...fixture, tracker, persist });
  expect(tracker.uncertainCreates.size).toBe(1);
  const record = JSON.parse(readFileSync(file, 'utf8'));
  const recovered = await cleanupRecordedRun({ ...fixture, tracker, file, record, wait: async () => {} });
  expect(recovered.result.status).toBe('fail');
  expect(recovered.uncertain).toHaveLength(1);
  expect(existsSync(file)).toBe(true);
});

it.each(['create-missing-template', 'create-missing-template-json'])('resolves only a definitive rejected create attempt in %s', async (id) => {
  const journal = journalFixture();
  const native = id.endsWith('json');
  const abx = vi.fn(async () => ({ ...result({ status: 'error', code: 'E2001', message: 'template no-such-template-e2e-xyz not found' }, native ? 4 : 1), maskedStdout: '', out: 'SandboxError: 404: template no-such-template-e2e-xyz not found' }));
  const testCase = readonlySuite.scenarios.find((item: { id: string }) => item.id === id);
  const track = vi.fn();
  await testCase.run({ ...journal, abx, track, fail });
  expect(journal.resolveCreateAttempt).toHaveBeenCalledWith('fixture-attempt');
  expect(track).not.toHaveBeenCalled();
});

it('does not accept an authorization error as a successful package inventory', async () => {
  await expect(scenario('system-packages').run({ state: { id: 'sbx-owned-test' }, abx: async () => ({ ...result({ message: 'packages: 401 Unauthorized' }, 1) }), fail })).rejects.toThrow('pip result');
  await expect(scenario('system-packages').run({ state: { id: 'sbx-owned-test' }, abx: async () => result({ manager: 'pip', packages: [{ name: 'pip', version: '25.0' }] }), fail })).resolves.toBeUndefined();
});

it.each(['create-missing-template', 'create-missing-template-json'])('rejects a created ID even when %s also reports its expected error', async (id) => {
  const journal = journalFixture();
  const native = id.endsWith('json');
  const track = vi.fn();
  const abx = vi.fn(async () => ({ ...result({ ID: 'sbx-unexpected-create', status: 'error', code: 'E2001', message: 'template not found' }, native ? 4 : 1), maskedStdout: 'sbx-unexpected-create\n', out: '404 template not found' }));
  const testCase = readonlySuite.scenarios.find((item: { id: string }) => item.id === id);
  await expect(testCase.run({ ...journal, abx, track, fail })).rejects.toThrow('unexpectedly returned');
  expect(track).toHaveBeenCalledWith('sbx-unexpected-create');
  expect(journal.resolveCreateAttempt).toHaveBeenCalledWith('fixture-attempt');
});

it('keeps option-shaped ledger IDs behind an argument barrier in owned cleanup', async () => {
  const fixture = subprocessFixture("import { writeFileSync } from 'node:fs'; writeFileSync('kill-argv.json', JSON.stringify(process.argv.slice(2))); ");
  fixture.tracker.sandboxes = new Set(['--all']);
  await cleanupTrackedSandboxes({ ...fixture, persist() {} });
  expect(JSON.parse(readFileSync(join(fixture.root, 'kill-argv.json'), 'utf8'))).toEqual(['sandbox', 'kill', '--', '--all']);
});

it('uses the same argument barrier when inventory reconciliation reaps an owned option-shaped ID', async () => {
  const fixture = subprocessFixture(String.raw`import { appendFileSync } from 'node:fs'; if (process.argv.includes('list')) process.stdout.write('[{"sandboxId":"--all"}]'); else appendFileSync('kill-argv.jsonl', JSON.stringify(process.argv.slice(2)) + '\n');`);
  fixture.tracker.sandboxes = new Set(['--all']);
  const checked = await leakCheck({ ...fixture, cloudOk: true, skipOnlyOffline: false, wait: async () => {} });
  expect(checked.status).toBe('fail');
  const calls = readFileSync(join(fixture.root, 'kill-argv.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  expect(calls).toHaveLength(4);
  for (const call of calls) expect(call).toEqual(['sandbox', 'kill', '--', '--all']);
});

it.each([
  { source: 'fixture.py', destination: undefined, startup: 'fixture-server' },
  { source: undefined, destination: '/fixture/app.py', startup: 'fixture-server' },
  { source: 'fixture.py', destination: '/fixture/app.py', startup: undefined },
])('validates paired application upload and explicit startup before any app mutation %#', async ({ source, destination, startup }) => {
  if (source !== undefined) vi.stubEnv('ABX_E2E_APP_UPLOAD_SOURCE', source);
  if (destination !== undefined) vi.stubEnv('ABX_E2E_APP_UPLOAD_DEST', destination);
  if (startup !== undefined) vi.stubEnv('ABX_E2E_APP_START_COMMAND', startup);
  const abx = vi.fn();
  await expect(scenario('run-named-command').run({ state: { id: 'sbx-owned-test' }, abx, fail })).rejects.toThrow('requires source, destination');
  expect(abx).not.toHaveBeenCalled();
});

it('does not attempt startup after an explicit application fixture upload fails', async () => {
  vi.stubEnv('ABX_E2E_APP_UPLOAD_SOURCE', 'fixture.py');
  vi.stubEnv('ABX_E2E_APP_UPLOAD_DEST', '/fixture/app.py');
  vi.stubEnv('ABX_E2E_APP_START_COMMAND', 'fixture-server --port 9000');
  const abx = vi.fn(async () => ({ code: 1 }));
  await expect(scenario('run-named-command').run({ state: { id: 'sbx-owned-test' }, abx, fail })).rejects.toThrow('startup was not attempted');
  expect(abx).toHaveBeenCalledOnce();
});

it('uploads exactly one current fixture before exactly one explicitly selected startup', async () => {
  vi.stubEnv('ABX_E2E_APP_UPLOAD_SOURCE', 'fixture.py');
  vi.stubEnv('ABX_E2E_APP_UPLOAD_DEST', '/fixture/app.py');
  vi.stubEnv('ABX_E2E_APP_START_COMMAND', 'fixture-server --port 9000');
  const abx = vi.fn()
    .mockResolvedValueOnce({ code: 0 })
    .mockResolvedValueOnce({ ...result(null), stderr: '987654\n' })
    .mockResolvedValueOnce(result([]));
  const ctx = { state: { id: 'sbx-owned-test' }, abx, fail, eventually: async (fn: () => Promise<void>) => fn() };
  await expect(scenario('run-named-command').run(ctx)).rejects.toThrow('application process is not running');
  expect(abx.mock.calls[0][0]).toEqual(['upload', 'sbx-owned-test', 'fixture.py', '/fixture/app.py']);
  expect(abx.mock.calls[1][0]).toEqual(['exec', '--background', 'sbx-owned-test', 'fixture-server --port 9000']);
  expect(abx).toHaveBeenCalledTimes(3);
});


it.each(['live', 'network error', 'endpoint not found'])('retains an owned ID when an empty list hides %s from exact info', async (state) => {
  const source = `if (process.argv.includes('list')) process.stdout.write('[]'); else if (process.argv.includes('info')) { process.stderr.write(${JSON.stringify(state)}); process.exitCode = ${state === 'live' ? 0 : 1}; }`;
  const fixture = subprocessFixture(source);
  fixture.tracker.killed.add('sbx-owned-test');
  const checked = await leakCheck({ ...fixture, cloudOk: true, skipOnlyOffline: false, wait: async () => {} });
  expect(checked.status).toBe('fail');
  expect(fixture.tracker.killed.has('sbx-owned-test')).toBe(false);
});

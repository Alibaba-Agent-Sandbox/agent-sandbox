import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const scenarioFile = '../../e2e/scenarios/22-volume-mount.mjs';
const assertions = '../../e2e/lib/assert.mjs';
const { default: suite, volumeMountCommand } = await import(scenarioFile);
const { ScenarioSkip } = await import(assertions);

afterEach(() => vi.unstubAllEnvs());

function context() {
  return {
    creds: { ABX_SANDBOX_API_KEY: 'placeholder-key', ABX_SANDBOX_BASE_URL: 'https://example.test' },
    rawAbx: vi.fn(), track: vi.fn(), untrack: vi.fn(),
    parseJsonLoose: (text: string) => JSON.parse(text),
    skip(reason: string): never { throw new ScenarioSkip(reason); },
    eventually: async (fn: () => Promise<void>) => fn(),
  };
}

it.each([
  { flag: '', name: 'existing-volume', path: '/mnt/abx-e2e/volume' },
  { flag: '1', name: '', path: '/mnt/abx-e2e/volume' },
  { flag: '1', name: 'existing-volume', path: '/' },
  { flag: '1', name: 'existing-volume', path: '/mnt/abx-e2e/../unsafe' },
  { flag: '1', name: 'existing-volume', path: '/mnt/abx-e2e/symlink/../../unsafe' },
])('skips before cloud or filesystem I/O without safe explicit prerequisites %#', async ({ flag, name, path }) => {
  vi.stubEnv('ABX_E2E_VOLUME_MOUNT', flag);
  vi.stubEnv('ABX_E2E_VOLUME_NAME', name);
  vi.stubEnv('ABX_E2E_VOLUME_MOUNT_PATH', path);
  const ctx = context();
  await expect(suite.scenarios[0].run(ctx)).rejects.toBeInstanceOf(ScenarioSkip);
  expect(ctx.rawAbx).not.toHaveBeenCalled();
  expect(ctx.track).not.toHaveBeenCalled();
});

it('requires a configured Team sandbox key before creating anything', async () => {
  vi.stubEnv('ABX_E2E_VOLUME_MOUNT', '1');
  vi.stubEnv('ABX_E2E_VOLUME_NAME', 'existing-volume');
  vi.stubEnv('ABX_E2E_VOLUME_MOUNT_PATH', '/mnt/abx-e2e/volume');
  const ctx = context();
  ctx.creds.ABX_SANDBOX_API_KEY = '';
  await expect(suite.scenarios[0].run(ctx)).rejects.toBeInstanceOf(ScenarioSkip);
  expect(ctx.rawAbx).not.toHaveBeenCalled();
});

it('tracks the sandbox immediately and cleans it when independent mount verification fails', async () => {
  vi.stubEnv('ABX_E2E_VOLUME_MOUNT', '1');
  vi.stubEnv('ABX_E2E_VOLUME_NAME', 'existing-volume');
  vi.stubEnv('ABX_E2E_VOLUME_MOUNT_PATH', '/mnt/abx-e2e/volume');
  const ctx = context();
  ctx.rawAbx.mockResolvedValueOnce({ code: 0, stdout: JSON.stringify({ ID: 'sbx-volume-test' }) });
  ctx.rawAbx.mockImplementationOnce(async () => {
    expect(ctx.track).toHaveBeenCalledWith('sbx-volume-test');
    return { code: 0, stdout: JSON.stringify({ exit_code: 1, stdout: 'private-mount-metadata-placeholder' }) };
  });
  ctx.rawAbx.mockResolvedValueOnce({ code: 0, stdout: '{}' });
  ctx.rawAbx.mockResolvedValueOnce({ code: 4, stdout: '{}' });
  await expect(suite.scenarios[0].run(ctx)).rejects.toThrow('Volume probe did not prove its postcondition; raw command output omitted');
  expect(ctx.rawAbx).toHaveBeenCalledTimes(4);
  expect(ctx.rawAbx.mock.calls[0][0]).toContain('--volume-mount');
  expect(ctx.rawAbx.mock.calls[2][0]).toContain('kill');
  expect(ctx.untrack).toHaveBeenCalledWith('sbx-volume-test');
});

const python = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
it.skipIf(!python)('rejects an ordinary local directory before creating a sentinel', () => {
  const directory = mkdtempSync(join(tmpdir(), 'abx-volume-probe-'));
  try {
    const marker = '.abx-exclusive-marker';
    const result = spawnSync('sh', ['-c', volumeMountCommand(directory, marker, 'placeholder-payload', 'roundtrip')], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('no exact mount-table entry');
    expect(existsSync(join(directory, marker))).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

const temporaryIsMount = existsSync('/proc/self/mountinfo') &&
  readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some((line) => line.split(' ')[4] === tmpdir());
it.skipIf(!python || !temporaryIsMount)('roundtrips only its exclusive sentinel on a real temporary filesystem mount', () => {
  const name = '.abx-volume-safety-' + randomUUID();
  const target = join(tmpdir(), name);
  try {
    const result = spawnSync('sh', ['-c', volumeMountCommand(tmpdir(), name, 'placeholder-own-payload', 'roundtrip')], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('ABX_MOUNT_ROUNDTRIP');
    expect(existsSync(target)).toBe(false);
  } finally { rmSync(target, { force: true }); }
});

it.skipIf(!python || !temporaryIsMount).each(['wrong-content', 'symlink'])('cleanup preserves a pre-existing %s on a real temporary filesystem mount', (kind) => {
  const name = '.abx-volume-safety-' + randomUUID();
  const target = join(tmpdir(), name);
  const backing = target + '-backing';
  try {
    if (kind === 'symlink') {
      writeFileSync(backing, 'existing-data', { flag: 'wx' });
      symlinkSync(backing, target);
    } else writeFileSync(target, 'existing-data', { flag: 'wx' });
    const result = spawnSync('sh', ['-c', volumeMountCommand(tmpdir(), name, 'placeholder-own-payload', 'cleanup')], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(readFileSync(target, 'utf8')).toBe('existing-data');
    expect(lstatSync(target).isSymbolicLink()).toBe(kind === 'symlink');
  } finally {
    rmSync(target, { force: true });
    rmSync(backing, { force: true });
  }
});

import { expect, it, vi } from 'vitest';
const assertions = '../../e2e/lib/assert.mjs';
const runner = '../../e2e/lib/runner.mjs';
const { ScenarioSkip } = await import(assertions);
const { makeContext, runScenario } = await import(runner);

it('records unavailable management prerequisites as a skip without replaying the scenario', async () => {
  const ctx = makeContext({ state: {}, suite: {}, tracker: {}, persist() {} });
  const run = vi.fn(async () => ctx.skip('No verified storage configuration is available.'));
  const record = { attempts: 0, notes: [] };
  await expect(runScenario({ run, retries: 2 }, ctx, record)).rejects.toBeInstanceOf(ScenarioSkip);
  expect(run).toHaveBeenCalledTimes(1);
  expect(record.attempts).toBe(1);
});


it('keeps offline region configuration isolated from the caller', async () => {
  const modulePath = '../../e2e/lib/exec.mjs';
  const { baseEnv } = await import(modulePath);
  vi.stubEnv('ALIBABA_CLOUD_REGION_ID', 'caller-region');
  try {
    const offline = baseEnv({ home: '/tmp/abx-env-fixture', creds: {} });
    expect(offline.ALIBABA_CLOUD_REGION_ID).toBeUndefined();
    const cloud = baseEnv({ home: '/tmp/abx-env-fixture', creds: { ALIBABA_CLOUD_REGION_ID: 'selected-region' } });
    expect(cloud.ALIBABA_CLOUD_REGION_ID).toBe('selected-region');
  } finally {
    vi.unstubAllEnvs();
  }
});

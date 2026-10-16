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

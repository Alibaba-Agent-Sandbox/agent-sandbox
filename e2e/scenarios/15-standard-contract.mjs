// The selected E2B behavior is part of the normal real-component runner.
import { fileURLToPath } from 'node:url';
import { baseEnv, runBinary } from '../lib/exec.mjs';

export default {
  id: 'standard-contract',
  title: 'Pinned E2B migration: actual CLI, Express and local PTY',
  needs: ['cloud'],
  scenarios: [{
    id: 'standard-lifecycle-pty',
    title: 'Create/exec/list/PTY/connect ownership/expiry and cleanup',
    timeoutMs: 240_000,
    async run(ctx) {
      const result = await runBinary({
        bin: [process.execPath],
        argv: [fileURLToPath(new URL('../standard.mjs', import.meta.url))],
        env: baseEnv({ home: ctx.home, creds: ctx.creds, extra: { ABX_BIN: process.env.ABX_BIN || 'abx' } }),
        cwd: ctx.cwd,
        timeoutMs: 240_000,
      });
      if (result.code !== 0 || result.timedOut) ctx.fail(ctx.mask(result.stdout + result.stderr));
      ctx.check('standard result', result.stdout, 'kill and cleanup');
    },
  }],
};

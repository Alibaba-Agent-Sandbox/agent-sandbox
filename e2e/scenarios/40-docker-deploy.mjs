// Template build/deploy pipeline: local docker build -> ACR push -> official CreateTemplate -> sandbox.
// Opt-in (ABX_E2E_DOCKER=1): needs a working docker daemon AND an ACR path with usable upload
// bandwidth; creates (and deletes) real cloud resources.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TPL = `e2e-cli-${Math.random().toString(16).slice(2, 8)}`;
const sid = (ctx) => ctx.state.sandbox;

export default {
  id: 'docker-deploy',
  title: 'Docker: template deploy -> create sandbox -> delete template',
  needs: ['cloud', 'docker'],
  scenarios: [
    {
      id: 'deploy-minimal-template', title: 'template scaffold + deploy --acr-namespace builds, pushes and registers a template', timeoutMs: 1_500_000,
      async run(ctx) {
        const dir = join(ctx.newCwd('deploy'), 'tpl');
        let r = await ctx.abx(['template', 'scaffold', dir, '--template', 'python', '--name', TPL]);
        if (r.code !== 0) ctx.fail(`init exit ${r.code}\n${r.out}`);
        r = await ctx.abx(['--json', 'template', 'deploy', dir, '--acr-namespace', ctx.creds.ACR_NAMESPACE, '--yes'], { timeoutMs: 1_400_000 });
        if (r.code !== 0) ctx.fail(`deploy exit ${r.code}\n${r.out}`);
        ctx.state.templateOut = r.maskedStdout;
        const list = await ctx.abx(['--json', 'template', 'list']);
        if (list.code !== 0) ctx.fail('template list failed after deploy');
      },
    },
    {
      id: 'create-from-deployed-template', title: 'create --template <deployed alias> then exec', requires: ['deploy-minimal-template'], timeoutMs: 300_000,
      async run(ctx) {
        const r = await ctx.abx(['--json', 'create', '--template', TPL, '--timeout', '600']);
        if (r.code !== 0) ctx.fail(`exit ${r.code}\n${r.out}`);
        ctx.state.sandbox = r.rawJson().ID;
        ctx.track(sid(ctx));
        const x = await ctx.abx(['exec', sid(ctx), 'echo deployed-ok']);
        ctx.check('exec', x.stdout, 'deployed-ok');
      },
    },
  ],
  async teardown(ctx) {
    if (sid(ctx)) { await ctx.abx(['kill', sid(ctx), '--yes']); ctx.untrack(sid(ctx)); }
    const info = await ctx.abx(['template', 'info', TPL]);
    const id = /templateID\s+(\S+)/.exec(info.maskedStdout ?? '')?.[1];
    if (id) await ctx.abx(['--json', 'template', 'delete', id, '--yes']);
  },
};

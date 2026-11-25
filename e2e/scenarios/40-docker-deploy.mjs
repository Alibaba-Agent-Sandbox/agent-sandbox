// Existing v5 source path: pure local image build -> source deploy -> named instance.
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {configureExpressScenario, trackDetachedCreate} from '../lib/express-scenarios.mjs';

export default {
  id: 'docker-deploy', title: 'Docker: local build -> source deploy -> owned cleanup',
  needs: ['cloud', 'cloud-management', 'docker'], setup: configureExpressScenario,
  scenarios: [
    {id: 'deploy-minimal-template', title: 'template init and pure local Docker build', timeoutMs: 1_500_000,
      async run(ctx) {
        ctx.state.name = 'e2e-docker-' + randomUUID().slice(0, 12);
        ctx.state.source = join(ctx.newCwd('deploy'), 'tpl');
        const initialized = await ctx.abx(['template', 'init', ctx.state.source, '--template', 'python', '--name', ctx.state.name]);
        if (initialized.code !== 0) ctx.fail(`init exit ${initialized.code}`);
        const built = await ctx.abx(['--json', 'template', 'build', ctx.state.source, '--timeout', '1200'], {timeoutMs: 1_400_000});
        const result = built.rawJson();
        if (built.code !== 0 || result?.status !== 'built' || !Array.isArray(result.images) || !result.images.length) ctx.fail('local Docker build did not produce image IDs');
        ctx.state.localImages = result.images.filter(image => image.cached === false).map(image => image.image_id);
      }},
    {id: 'create-from-deployed-template', title: 'source deploy creates its declared instance and exec runs', requires: ['deploy-minimal-template'], timeoutMs: 1_500_000,
      async run(ctx) {
        ctx.state.deployAttempt = ctx.beginCreateAttempt(ctx.state.name);
        const result = await ctx.abx(['--json', 'deploy', ctx.state.source, '--name', ctx.state.name, '--sandbox-timeout', '600', '--yes'], {timeoutMs: 1_400_000});
        ctx.state.sandbox = trackDetachedCreate(ctx, result, ctx.state.deployAttempt);
        ctx.state.templateId = result.rawJson()?.template;
        ctx.state.deployAttempt = undefined;
        const executed = await ctx.abx(['exec', ctx.state.name, '--', 'echo', 'deployed-ok']);
        if (executed.code !== 0) ctx.fail(`exec exit ${executed.code}`);
        ctx.check('exec', executed.stdout, 'deployed-ok');
      }},
  ],
  async teardown(ctx) {
    let failed = false;
    if (ctx.state.deployAttempt) {
      const recovered = await ctx.abx(['--json', 'recover', ctx.state.name]);
      const id = recovered.rawJson()?.sandbox_id;
      if (typeof id === 'string' && id.startsWith('sbx-')) {ctx.state.sandbox = id; ctx.track(id); ctx.resolveCreateAttempt(ctx.state.deployAttempt); ctx.state.deployAttempt = undefined;}
    }
    if (ctx.state.sandbox || ctx.state.deployAttempt) {
      const removed = await ctx.abx(['--json', 'delete', ctx.state.name, '--yes']), result = removed.rawJson();
      failed = removed.code !== 0 || result?.status !== 'deleted' || (result.retained_resources?.length ?? 0) > 0;
      if (typeof ctx.state.templateId === 'string') {
        const info = await ctx.abx(['--json', 'provider', 'run', 'template.get', '--input', JSON.stringify({template_id: ctx.state.templateId})]);
        failed ||= info.code !== 4 || info.rawJson()?.code !== 'E2001';
      }
    }
    for (const id of ctx.state.localImages ?? []) {
      if (!/^sha256:[a-f0-9]{64}$/.test(id)) {failed = true;continue;}
      const cleanup = spawnSync('docker', ['image', 'rm', id], {stdio: 'ignore', timeout: 30000});
      failed = cleanup.status !== 0 || failed;
    }
    if (failed) ctx.fail('Owned cleanup is incomplete; inspect the named deployment and retained resources.');
  },
};

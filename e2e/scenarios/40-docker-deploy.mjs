// Real Docker build -> reusable template resources -> explicit dynamic Sandbox instance.
// Opt-in only; keep uncertain preparation/deployment records for recovery.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configureExpressScenario, trackDetachedCreate } from '../lib/express-scenarios.mjs';

export default {
  id: 'docker-deploy',
  title: 'Docker: template init/build -> deploy -> independent owned cleanup',
  needs: ['cloud', 'cloud-management', 'docker'],
  setup: configureExpressScenario,
  scenarios: [
    {
      id: 'deploy-minimal-template', title: 'template init and build prepare a real reusable image/template artifact', timeoutMs: 1_500_000,
      async run(ctx) {
        ctx.state.name = 'e2e-docker-' + randomUUID().slice(0, 12);
        ctx.state.source = join(ctx.newCwd('deploy'), 'tpl');
        ctx.state.build = join(ctx.state.source, '.abx', 'build.json');
        const initialized = await ctx.abx(['template', 'init', ctx.state.source, '--template', 'python', '--name', ctx.state.name]);
        if (initialized.code !== 0) ctx.fail(`init exit ${initialized.code}\n${initialized.out}`);
        ctx.state.buildAttempt = ctx.beginCreateAttempt(ctx.state.name + '-build');
        const built = await ctx.abx(['--json', 'template', 'build', ctx.state.source, '--out', ctx.state.build, '--timeout', '1200', '--yes'], { timeoutMs: 1_400_000 });
        if (built.code !== 0) ctx.fail(`build exit ${built.code}\n${built.out}`);
        const artifact = JSON.parse(readFileSync(ctx.state.build, 'utf8'));
        const prepared = artifact.resources?.find(item => item.kind === 'template' && item.name === 'agent');
        if (artifact.kind !== 'ResourceDeployment' || !artifact.buildOnly || artifact.status !== 'ready' || typeof prepared?.id !== 'string') ctx.fail('build did not produce a ready native template artifact');
        ctx.state.templateId = prepared.id;
        const detail = await ctx.abx(['--json', 'provider', 'run', 'template.get', '--input', JSON.stringify({template_id: ctx.state.templateId})]);
        if (detail.code !== 0 || detail.rawJson()?.template?.templateID !== ctx.state.templateId) ctx.fail('native template readback did not confirm the prepared identity');
      },
    },
    {
      id: 'create-from-deployed-template', title: 'deploy prepares the build and sandbox create starts an explicit instance', requires: ['deploy-minimal-template'], timeoutMs: 300_000,
      async run(ctx) {
        const prepared = await ctx.abx(['--json', 'deploy', '--build', ctx.state.build, '--name', ctx.state.name, '--yes']);
        if (prepared.code !== 0) ctx.fail(`prepare exit ${prepared.code}\n${prepared.out}`);
        ctx.state.resourcesPrepared = true;
        ctx.state.deployAttempt = ctx.beginCreateAttempt(ctx.state.name + '-instance');
        const result = await ctx.abx(['--json', 'sandbox', 'create', '--template', ctx.state.templateId, '--timeout', '600', '--yes']);
        ctx.state.sandbox = trackDetachedCreate(ctx, result, ctx.state.deployAttempt);
        ctx.state.deployAttempt = undefined;
        const executed = await ctx.abx(['sandbox', 'exec', ctx.state.sandbox, '--', 'echo', 'deployed-ok']);
        if (executed.code !== 0) ctx.fail(`exec exit ${executed.code}`);
        ctx.check('exec', executed.stdout, 'deployed-ok');
      },
    },
  ],
  async teardown(ctx) {
    let failed = false;
    if (ctx.state.sandbox) {
      const removed = await ctx.abx(['--json', 'sandbox', 'delete', ctx.state.sandbox, '--yes']);
      failed = removed.code !== 0;
    } else if (ctx.state.deployAttempt) {
      // The harness independently retains the uncertain attempt for inventory recovery.
      failed = true;
    }
    if (ctx.state.resourcesPrepared) {
      const removed = await ctx.abx(['--json', 'delete', ctx.state.name, '--yes']);
      failed ||= removed.code !== 0 || removed.rawJson()?.status !== 'deleted';
    }
    if (ctx.state.build && existsSync(ctx.state.build)) {
      const artifact = JSON.parse(readFileSync(ctx.state.build, 'utf8'));
      const id = artifact.resources?.find(item => item.kind === 'template' && item.name === 'agent')?.id;
      const cleaned = await ctx.abx(['--json', 'template', 'build', '--clean', ctx.state.build, '--yes']);
      const result = cleaned.rawJson();
      let absent = false;
      if (typeof id === 'string') {
        const info = await ctx.abx(['--json', 'provider', 'run', 'template.get', '--input', JSON.stringify({template_id: id})]);
        absent = info.code === 4 && info.rawJson()?.code === 'E2001';
      }
      const after = JSON.parse(readFileSync(ctx.state.build, 'utf8'));
      const retainedOwned = after.resources?.some(item => item.owned && (item.retain || item.status === 'retained'));
      if (cleaned.code === 0 && result?.status === 'deleted' && !retainedOwned && absent) ctx.resolveCreateAttempt(ctx.state.buildAttempt);
      else failed = true;
    }
    if (failed) ctx.fail('owned Docker/template cleanup is unconfirmed; preserve the artifact and deployment records');
  },
};

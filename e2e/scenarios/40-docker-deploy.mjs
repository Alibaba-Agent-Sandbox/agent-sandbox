// Real Docker build -> ACR push -> native template -> named Sandbox deployment.
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
        if (artifact.kind !== 'SandboxTemplateBuild' || artifact.status !== 'ready' || typeof artifact.prepared?.reference !== 'string') ctx.fail('build did not produce a ready native template artifact');
        ctx.state.templateId = artifact.prepared.reference;
        const detail = await ctx.abx(['--json', 'provider', 'run', 'template.get', '--input', JSON.stringify({template_id: ctx.state.templateId})]);
        if (detail.code !== 0 || detail.rawJson()?.template?.templateID !== ctx.state.templateId) ctx.fail('native template readback did not confirm the prepared identity');
      },
    },
    {
      id: 'create-from-deployed-template', title: 'deploy reuses the build and sandbox exec runs in the owned instance', requires: ['deploy-minimal-template'], timeoutMs: 300_000,
      async run(ctx) {
        ctx.state.deployAttempt = ctx.beginCreateAttempt(ctx.state.name);
        const result = await ctx.abx(['--json', 'deploy', '--build', ctx.state.build, '--name', ctx.state.name, '--sandbox-timeout', '600', '--yes']);
        ctx.state.sandbox = trackDetachedCreate(ctx, result, ctx.state.deployAttempt);
        ctx.state.deployAttempt = undefined;
        const executed = await ctx.abx(['sandbox', 'exec', ctx.state.name, '--', 'echo', 'deployed-ok']);
        if (executed.code !== 0) ctx.fail(`exec exit ${executed.code}`);
        ctx.check('exec', executed.stdout, 'deployed-ok');
      },
    },
  ],
  async teardown(ctx) {
    let failed = false;
    if (ctx.state.deployAttempt) {
      const recovered = await ctx.abx(['--json', 'recover', ctx.state.name]);
      const id = recovered.rawJson()?.sandbox_id;
      if (typeof id === 'string' && id.startsWith('sbx-')) { ctx.state.sandbox = id; ctx.track(id); ctx.resolveCreateAttempt(ctx.state.deployAttempt); ctx.state.deployAttempt = undefined; }
    }
    if (ctx.state.sandbox || ctx.state.deployAttempt) {
      const removed = await ctx.abx(['--json', 'delete', ctx.state.name, '--yes']);
      failed = removed.code !== 0 || removed.rawJson()?.status !== 'deleted';
      // The runner independently checks each tracked raw ID and complete inventory.
    }
    if (ctx.state.build && existsSync(ctx.state.build)) {
      const artifact = JSON.parse(readFileSync(ctx.state.build, 'utf8'));
      const id = artifact.prepared?.reference;
      const cleaned = await ctx.abx(['--json', 'template', 'build', '--clean', ctx.state.build, '--yes']);
      const result = cleaned.rawJson();
      let absent = false;
      if (typeof id === 'string') {
        const info = await ctx.abx(['--json', 'provider', 'run', 'template.get', '--input', JSON.stringify({template_id: id})]);
        absent = info.code === 4 && info.rawJson()?.code === 'E2001';
      }
      if (cleaned.code === 0 && result?.status === 'cleaned' && Array.isArray(result.retained) && result.retained.length === 0 && absent) ctx.resolveCreateAttempt(ctx.state.buildAttempt);
      else failed = true;
    }
    if (failed) ctx.fail('owned Docker/template cleanup is unconfirmed; preserve the artifact and deployment records');
  },
};

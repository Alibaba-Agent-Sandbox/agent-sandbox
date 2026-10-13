// Black-box checks for CLI capabilities that stay local: version, help, provider list,
// --model on create/template init, template-profile Dockerfiles, and llm_model config.
// Spawns the abx process only. No command-handler imports, no DashScope, no cloud sandbox.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NO_PROFILE = 'e2e-no-profile';

export default {
  id: 'capability',
  title: 'Local CLI capabilities (version, help, provider profile, llm_model)',
  needs: [],
  scenarios: [
    {
      id: 'version-0-3-0',
      title: '--version prints 0.3.0',
      argv: ['--version'],
      creds: false,
      stdout: /^abx, version 0\.3\.0$/m,
    },
    {
      id: 'help-root-and-provider',
      title: 'abx --help and abx provider --help exit 0',
      creds: false,
      async run(ctx) {
        for (const argv of [['--help'], ['provider', '--help']]) {
          const r = await ctx.abx(argv, { creds: false });
          if (r.code !== 0) ctx.fail(`abx ${argv.join(' ')} exit ${r.code}\n--- stdout ---\n${ctx.excerpt(r.stdout)}\n--- stderr ---\n${ctx.excerpt(r.stderr)}`);
          ctx.check(argv.join(' '), r.stdout, /Usage: abx/);
        }
      },
    },
    {
      id: 'provider-list-alicloud',
      title: 'provider list mentions alicloud-express',
      argv: ['provider', 'list'],
      creds: false,
      freshHome: true,
      stdout: 'alicloud-express',
    },
    {
      id: 'create-help-model',
      title: 'create --help mentions --model',
      argv: ['create', '--help'],
      creds: false,
      stdout: '--model',
    },
    {
      id: 'template-init-help-model',
      title: 'template init --help mentions --model',
      argv: ['template', 'init', '--help'],
      creds: false,
      stdout: '--model',
    },
    {
      // `--adopt --dry-run` lists files that would be sent; it does not print Dockerfile guidance.
      // `template init --template` is local: ABX_PROVIDER stays unset (the runner does not forward it)
      // and `--provider` names an id with no installed profile, so the generic Docker profile is written.
      id: 'template-profile-no-network',
      title: 'template init for a provider id with no profile writes the generic Dockerfile and does not call the network',
      creds: false,
      async run(ctx) {
        const home = ctx.newHome('profile');
        const cwd = ctx.newCwd('profile');
        const env = { ABX_PROVIDER: undefined };
        const r = await ctx.abx(
          ['--provider', NO_PROFILE, 'template', 'init', 'noprof', '--template', 'python', '--name', 'nop-tpl'],
          { home, cwd, creds: false, env },
        );
        if (r.code !== 0) ctx.fail(`exit ${r.code}\n--- stdout ---\n${ctx.excerpt(r.stdout)}\n--- stderr ---\n${ctx.excerpt(r.stderr)}`);
        const dockerfilePath = join(cwd, 'noprof', 'Dockerfile');
        if (!existsSync(dockerfilePath)) ctx.fail('Dockerfile was not written');
        const dockerfile = readFileSync(dockerfilePath, 'utf8');
        ctx.check('dockerfile', dockerfile, [
          'FROM python:3.12-slim',
          'WORKDIR /app',
          'CMD ["python3", "commands.py"]',
          { not: 'fc-e2b-registry' },
          { not: 'dashscope' },
        ]);
        ctx.check('output', r.out, [{ not: 'dashscope' }, { not: /https?:\/\// }]);
        const yaml = readFileSync(join(cwd, 'noprof', 'template.yaml'), 'utf8');
        if (!yaml.includes('python:3.12-slim')) ctx.fail(`template.yaml base is not the generic image:\n${yaml}`);
      },
    },
    {
      id: 'config-set-get-llm-model',
      title: 'config set/get llm_model round-trips in the isolated HOME',
      creds: false,
      async run(ctx) {
        const home = ctx.newHome('llm');
        const model = 'qwen-test-e2e';
        let r = await ctx.abx(['config', 'set', 'llm_model', model], { home, creds: false });
        if (r.code !== 0) ctx.fail(`set exit ${r.code}\n${r.out}`);
        ctx.check('set', r.out, `Set llm_model = ${model}`);
        const toml = join(home, '.abx', 'config.toml');
        if (!existsSync(toml)) ctx.fail('~/.abx/config.toml was not created');
        const stored = readFileSync(toml, 'utf8');
        if (!/llm_model\s*=\s*"qwen-test-e2e"/.test(stored)) ctx.fail(`config.toml missing llm_model:\n${stored}`);
        r = await ctx.abx(['config', 'get', 'llm_model'], { home, creds: false });
        if (r.code !== 0) ctx.fail(`get exit ${r.code}\n${r.out}`);
        ctx.check('get', r.stdout, /^qwen-test-e2e$/m);
      },
    },
  ],
};

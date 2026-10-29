// Real child-process / filesystem verification. No cloud credentials or network are needed.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function fixture(directory, { broken = false } = {}) {
  mkdirSync(directory, { recursive: true });
  const marker = join(directory, '..', 'runtime-executions.txt');
  const id = 'operation-help-fixture';
  writeFileSync(join(directory, 'abx-provider.toml'), `
manifest_version = 1
operation_contract_version = 1
[operations]
cli = []
python = []
[workflow]
inputs = ["managed"]
startups = ["none"]
[provider]
id = "${id}"
version = "1.0.0"
[runtime]
kind = "node"
entry = "provider.mjs"
[features]
supported = []
${broken ? '[config.fields.api_key]\ntype = "string"\nrequired = true\nsecret = true\ncredential = true\n' : ''}
[commands]
protocol = "provider-commands/1"
${[['health.check', 'read'], ['install', 'read'], ['resource.create', 'write']].map(([operation, effect]) => `
[[commands.entries]]
id = "${operation}"
description = "Local fixture ${operation}"
description_zh = "本地操作 ${operation}"
effect = "${effect}"
idempotent = true
input_schema = { type = "object", properties = { name = { type = "string" } }, required = ["name"], additionalProperties = false }
output_schema = { type = "object", properties = { operation = { type = "string" }, name = { type = "string" } }, required = ["operation", "name"], additionalProperties = false }
`).join('\n')}`);
  writeFileSync(join(directory, 'provider.mjs'), `
import { appendFileSync } from 'node:fs';
const mark = value => appendFileSync(${JSON.stringify(marker)}, value + '\\n');
mark('import');
${broken ? "throw new Error('Help must not import a Provider runtime');" : ''}
export default () => ({
  async buildInfra() {
    mark('buildInfra');
    return {
      operation_contract_version: 1, operations: { cli: [], python: [] },
      sandbox_protocol: {},
      provider_commands: { async run(operation, input) { mark('run:' + operation); return { operation, name: input.name }; } },
      async close() { mark('close'); }
    };
  }
});
`);
  return { id, marker };
}

async function success(ctx, argv, options) {
  const result = await ctx.abx(argv, { ...options, creds: false });
  if (result.code !== 0) ctx.fail(`abx ${argv.slice(0, 3).join(' ')} exited ${result.code}: ${ctx.excerpt(result.out)}`);
  return result;
}

export default {
  id: 'provider-operation-help-offline',
  title: 'Selected Provider help and invocation with real installed adapters',
  scenarios: [
    {
      id: 'installed-static-help', title: 'an unconfigured adapter with a broken runtime is discoverable without executing code', creds: false,
      async run(ctx) {
        const home = ctx.newHome('static-help');
        const cwd = ctx.newCwd('static-help');
        const source = join(cwd, 'provider');
        const { id, marker } = fixture(source, { broken: true });
        const options = { home, cwd };
        try {
          await success(ctx, ['provider', 'install', source, '--yes', '--no-verify'], options);
          await success(ctx, ['provider', 'default', id], options);
          for (const argv of [['--help'], ['provider', '--help'], ['provider', 'run', '--help'], ['provider', 'run', 'health.check', '-h']]) {
            const result = await success(ctx, argv, options);
            ctx.check('selected Provider', result.out, `Provider: ${id}`);
          }
          const directory = await success(ctx, ['provider', '--help'], options);
          ctx.check('complete operation paths', directory.out, ['abx provider run health.check', 'abx provider run install']);
          const chinese = await success(ctx, ['provider', 'run', 'resource.create', '--help'], { ...options, env: { LC_ALL: 'zh_CN.UTF-8', LANG: 'zh_CN.UTF-8' } });
          ctx.check('localized generated help', chinese.out, ['本地操作 resource.create', 'name', 'string', 'required', 'Input fields', 'Full input/output schemas:', 'abx --json provider command info', '--yes']);
          if (existsSync(marker)) ctx.fail('help imported the Provider runtime');
        } finally {
          rmSync(home, { recursive: true, force: true });
          rmSync(cwd, { recursive: true, force: true });
        }
      },
    },
    {
      id: 'installed-operation-compatibility', title: 'new and legacy invocation share results, opaque ids and pre-execution guards', creds: false,
      async run(ctx) {
        const home = ctx.newHome('operation-execution');
        const cwd = ctx.newCwd('operation-execution');
        const source = join(cwd, 'provider');
        const { id, marker } = fixture(source);
        const options = { home, cwd };
        try {
          await success(ctx, ['provider', 'install', source, '--yes', '--no-verify'], options);
          await success(ctx, ['provider', 'default', id], options);
          for (const argv of [
            ['provider', 'run', 'resource.create', '--input', '{"name":"example"}'],
            ['provider', 'command', 'run', id, 'resource.create', '--input', '{"name":"example"}'],
          ]) {
            const refused = await ctx.abx(argv, { ...options, creds: false });
            if (refused.code !== 2 || !refused.out.includes('E8012')) ctx.fail('write bypassed the confirmation gate');
          }
          const invalid = await ctx.abx(['provider', 'run', 'health.check', '--input', '{}'], { ...options, creds: false });
          if (invalid.code !== 2 || !invalid.out.includes('E8002')) ctx.fail('invalid input bypassed schema validation');
          if (existsSync(marker)) ctx.fail('a refused invocation imported the Provider runtime');
          const input = join(cwd, 'request.json');
          writeFileSync(input, '{"name":"example"}');
          const canonical = await success(ctx, ['--json', 'provider', 'run', 'health.check', '--input-file', input], options);
          const legacy = await success(ctx, ['--json', 'provider', 'command', 'run', id, 'health.check', '--input', '{"name":"example"}'], options);
          if (JSON.stringify(canonical.rawJson()) !== JSON.stringify(legacy.rawJson())) ctx.fail('canonical and legacy execution returned different results');
          const opaque = await success(ctx, ['--json', 'provider', 'run', 'install', '--input-file', input], options);
          if (opaque.rawJson()?.operation !== 'install') ctx.fail('operation id collided with a host management command');
          await success(ctx, ['--json', 'provider', 'run', 'resource.create', '--yes', '--input-file', input], options);
          const executions = readFileSync(marker, 'utf8').split('\n').filter(line => line.startsWith('run:'));
          if (executions.length !== 4) ctx.fail('operation dispatched more or fewer times than requested');
        } finally {
          rmSync(home, { recursive: true, force: true });
          rmSync(cwd, { recursive: true, force: true });
        }
      },
    },
  ],
};

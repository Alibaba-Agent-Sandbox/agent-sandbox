// Template catalog: needs outbound access to raw.githubusercontent.com / github.com (not the sandbox cloud).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkShape, parseJsonLoose } from '../lib/assert.mjs';

export default {
  id: 'catalog',
  title: 'Template catalog (remote index): list / init --from',
  needs: ['github'],
  scenarios: [
    { id: 'search-python', title: 'template list python finds python-hello with its published status', creds: false, freshHome: true, argv: ['template', "list", 'python'], stdout: ['python-hello', 'Status', /\d+ template\(s\) found\./] },
    {
      id: 'search-json-shape', title: 'catalog JSON exposes source locators or managed manifests and filters by the published status', creds: false, freshHome: true,
      async run(ctx) {
        const r = await ctx.abx(['--json', 'template', "list", 'python'], { creds: false });
        if (r.code !== 0) ctx.fail(`search failed: ${r.code}`);
        const entries = parseJsonLoose(r.stdout);
        checkShape(entries, [{ name: 'string', description: 'string', repo: 'string', path: 'string|null', ref: 'string|null', tags: ['string'], author: 'string', manifest: 'object|null', status: 'string' }]);
        const hello = entries.find((entry) => entry.name === 'python-hello');
        if (!hello) ctx.fail('python-hello missing');
        if (hello.manifest !== null || hello.path !== 'python-hello'
            || hello.repo.replace(/\/$/, '').toLowerCase() !== 'https://github.com/alibaba-agent-sandbox/awesome-templates') {
          ctx.fail('python-hello must retain its source locator instead of an invented inline manifest');
        }
        if (entries.some((entry) => 'capabilities' in entry || 'workflow' in entry)) ctx.fail('catalog exposes retired capabilities or workflow metadata');
        const filtered = await ctx.abx(['--json', 'template', "list", 'python', '--status', hello.status], { creds: false });
        if (filtered.code !== 0) ctx.fail(`filtered search failed: ${filtered.code}`);
        const selected = parseJsonLoose(filtered.stdout);
        if (!Array.isArray(selected) || !selected.some((entry) => entry.name === 'python-hello')) ctx.fail('filtered catalog lost python-hello');
        if (selected.some((entry) => entry.status !== hello.status)) ctx.fail('status filter leaked a different status');
      },
    },
    { id: 'search-no-match', title: 'template list with no hits: exit 0 and message', creds: false, freshHome: true, argv: ['template', "list", 'zzzznomatch-e2e'], stdout: "No templates matching 'zzzznomatch-e2e'" },
    {
      id: 'search-caches-index', title: 'template list caches the index under ~/.abx/index and reuses it', creds: false,
      async run(ctx) {
        const home = ctx.newHome('idxcache');
        let r = await ctx.abx(['template', "list", 'python'], { home, creds: false });
        if (r.code !== 0) ctx.fail(`first search exit ${r.code}`);
        if (!existsSync(join(home, '.abx', 'index'))) ctx.fail('no ~/.abx/index cache created');
        if (!readdirSync(join(home, '.abx', 'index')).length) ctx.fail('index cache dir is empty');
        r = await ctx.abx(['template', "list", 'python', '--refresh'], { home, creds: false });
        if (r.code !== 0) ctx.fail(`--refresh exit ${r.code}`);
      },
    },
    {
      id: 'install-download-only', title: 'template init DIR --from python-hello downloads Dockerfile/commands.py/template.yaml', creds: false,
      async run(ctx) {
        const home = ctx.newHome('install');
        const dir = join(ctx.newCwd('install'), 'out');
        const r = await ctx.abx(['template', 'init', dir, '--from', 'python-hello'], { home, creds: false, timeoutMs: 180_000 });
        if (r.code !== 0) ctx.fail(`exit ${r.code}\n${r.out}`);
        ctx.check('output', r.out, ['python-hello', 'created']);
        for (const f of ['Dockerfile', 'commands.py', 'template.yaml']) if (!existsSync(join(dir, f))) ctx.fail(`missing ${f} in ${dir.replace(ctx.root, '<TMP>')}`);
      },
    },
    { id: 'init-unknown-template', title: 'template init from an unknown name fails', creds: false, freshHome: true, argv: ['template', 'init', 'unknown-source', '--from', 'no-such-template-e2e-xyz'], exit: 'nonzero', timeoutMs: 120_000 },
  ],
};

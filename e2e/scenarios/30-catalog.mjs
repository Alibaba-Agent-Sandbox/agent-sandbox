// Template catalog: needs outbound access to raw.githubusercontent.com / github.com (not the sandbox cloud).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkShape, parseJsonLoose } from '../lib/assert.mjs';

export default {
  id: 'catalog',
  title: 'Template catalog (remote index): search / install --download-only',
  needs: ['github'],
  scenarios: [
    { id: 'search-python', title: 'template search python finds python-hello with its published status', creds: false, freshHome: true, argv: ['template', 'search', 'python'], stdout: ['python-hello', 'Status', /\d+ template\(s\) found\./] },
    {
      id: 'search-json-shape', title: 'catalog JSON exposes current workflow metadata and filters by the published status', creds: false, freshHome: true,
      async run(ctx) {
        const r = await ctx.abx(['--json', 'template', 'search', 'python'], { creds: false });
        if (r.code !== 0) ctx.fail(`search failed: ${r.code}`);
        const entries = parseJsonLoose(r.stdout);
        checkShape(entries, [{ name: 'string', description: 'string', repo: 'string', tags: ['string'], author: 'string', workflow: 'string|null', status: 'string' }]);
        const hello = entries.find((entry) => entry.name === 'python-hello');
        if (!hello) ctx.fail('python-hello missing');
        if (entries.some((entry) => 'capabilities' in entry)) ctx.fail('catalog exposes retired capabilities metadata');
        const filtered = await ctx.abx(['--json', 'template', 'search', 'python', '--status', hello.status], { creds: false });
        if (filtered.code !== 0) ctx.fail(`filtered search failed: ${filtered.code}`);
        const selected = parseJsonLoose(filtered.stdout);
        if (!Array.isArray(selected) || !selected.some((entry) => entry.name === 'python-hello')) ctx.fail('filtered catalog lost python-hello');
        if (selected.some((entry) => entry.status !== hello.status)) ctx.fail('status filter leaked a different status');
      },
    },
    { id: 'search-no-match', title: 'template search with no hits: exit 0 and message', creds: false, freshHome: true, argv: ['template', 'search', 'zzzznomatch-e2e'], stdout: "No templates matching 'zzzznomatch-e2e'" },
    {
      id: 'search-caches-index', title: 'template search caches the index under ~/.abx/index and reuses it', creds: false,
      async run(ctx) {
        const home = ctx.newHome('idxcache');
        let r = await ctx.abx(['template', 'search', 'python'], { home, creds: false });
        if (r.code !== 0) ctx.fail(`first search exit ${r.code}`);
        if (!existsSync(join(home, '.abx', 'index'))) ctx.fail('no ~/.abx/index cache created');
        if (!readdirSync(join(home, '.abx', 'index')).length) ctx.fail('index cache dir is empty');
        r = await ctx.abx(['template', 'search', 'python', '--refresh'], { home, creds: false });
        if (r.code !== 0) ctx.fail(`--refresh exit ${r.code}`);
      },
    },
    {
      id: 'install-download-only', title: 'template install python-hello --download-only --dir DIR downloads Dockerfile/commands.py/template.yaml', creds: false,
      async run(ctx) {
        const home = ctx.newHome('install');
        const dir = join(ctx.newCwd('install'), 'out');
        const r = await ctx.abx(['template', 'install', 'python-hello', '--download-only', '--dir', dir], { home, creds: false, timeoutMs: 180_000 });
        if (r.code !== 0) ctx.fail(`exit ${r.code}\n${r.out}`);
        ctx.check('output', r.out, ['python-hello', 'installed-locally']);
        for (const f of ['Dockerfile', 'commands.py', 'template.yaml']) if (!existsSync(join(dir, f))) ctx.fail(`missing ${f} in ${dir.replace(ctx.root, '<TMP>')}`);
      },
    },
    {
      id: 'install-download-only-json', title: 'template install --download-only --json ends with {Alias,Source,Cached,Status:"installed-locally"}', creds: false, freshHome: true, argv: ['--json', 'template', 'install', 'python-hello', '--download-only'], timeoutMs: 180_000,
      json: (j) => { if (j.Status !== 'installed-locally' || j.Alias !== 'python-hello') throw new Error(JSON.stringify(j)); },
    },
    { id: 'install-unknown-template', title: 'template install of an unknown name fails with non-zero exit', creds: false, freshHome: true, argv: ['template', 'install', 'no-such-template-e2e-xyz', '--download-only'], exit: 'nonzero', timeoutMs: 120_000 },
  ],
};

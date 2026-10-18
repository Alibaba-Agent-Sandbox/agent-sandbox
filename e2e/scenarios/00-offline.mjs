// Scenarios that need no cloud: help/version, argument validation, config store, MCP install,
// template scaffolding, local template index. Run with a credential-free environment.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The fixed top-level surface: command groups plus the sandbox shortcuts (see docs/en/reference/cli-commands.md).
const ROOT_COMMANDS = ['config', 'connect', 'create', 'deploy', 'download', 'exec', 'info', 'kill', 'list', 'mcp', 'provider', 'run', 'sandbox', 'template', 'upload'];
const REMOVED_ROOT_COMMANDS = ['init', 'install'];

const INDEX = `templates:
  - name: alpha-py
    description: Alpha python template
    repo: https://github.com/example/alpha
    tags: [python, demo]
    author: me
    capabilities: [shell, files]
    status: official
  - name: beta-node
    description: Beta node template
    repo: https://github.com/example/beta
    tags: [node]
    author: you
    capabilities: [shell]
    status: community
`;

export default {
  id: 'offline',
  title: 'Offline behaviour (no cloud credentials)',
  needs: [],
  scenarios: [
    { id: 'version', title: '--version prints "abx, version X.Y.Z"', argv: ['--version'], creds: false, stdout: /^abx, version \d+\.\d+\.\d+/m },
    { id: 'help-root', title: 'root --help lists every command', argv: ['--help'], creds: false, stdout: ['Usage: abx', '--json', '--quiet', '--ci', 'Command groups:', 'Providers:', 'Sandbox shortcuts:', "Same as 'abx sandbox exec'.", ...ROOT_COMMANDS.map((c) => new RegExp(`^\\s+${c}\\s`, 'm')), ...['--profile', '--timeout'].map((o) => ({ not: o }))] },
    ...REMOVED_ROOT_COMMANDS.map((c) => ({ id: `removed-root-${c}`, title: `top-level \`${c}\` is gone (use \`abx template ${c}\`)`, argv: [c], creds: false, exit: 2, output: 'No such command' })),
    { id: 'removed-shell-stream', title: '`sandbox shell-stream` is gone (use `exec --stream`)', argv: ['sandbox', 'shell-stream', 'sbx-x'], creds: false, exit: 2, output: 'No such command' },
    { id: 'removed-process-start', title: '`sandbox process start` is gone (use `exec --background`)', argv: ['sandbox', 'process', 'start', 'sbx-x'], creds: false, exit: 2, output: 'No such command' },
    { id: 'removed-global-timeout', title: 'there is no global --timeout', argv: ['--timeout', '5', 'list'], creds: false, exit: 2, output: 'No such option' },
    { id: 'help-no-args', title: 'bare `abx` prints usage/help and does not crash', argv: [], creds: false, exit: [0, 2], output: /Usage: abx/ },
    { id: 'help-sandbox', title: 'sandbox --help lists subcommands', argv: ['sandbox', '--help'], creds: false, stdout: ['capabilities', 'command', 'files', 'process', 'system', 'create', 'exec', { not: 'shell-stream' }] },
    { id: 'help-sandbox-files', title: 'sandbox files --help', argv: ['sandbox', 'files', '--help'], creds: false, stdout: ['list', 'mkdir', 'mv', 'rm', 'search', 'stat'] },
    { id: 'help-sandbox-process', title: 'sandbox process --help', argv: ['sandbox', 'process', '--help'], creds: false, stdout: ['info', 'list', 'signal', { not: /^\s+start\s/m }] },
    { id: 'help-sandbox-command', title: 'sandbox command --help', argv: ['sandbox', 'command', '--help'], creds: false, stdout: ['list', 'run'] },
    { id: 'help-sandbox-system', title: 'sandbox system --help', argv: ['sandbox', 'system', '--help'], creds: false, stdout: ['env', 'info', 'metrics', 'packages', 'ports'] },
    { id: 'help-template', title: 'template --help', argv: ['template', '--help'], creds: false, stdout: ['build', 'create', 'delete', 'deploy', 'info', 'init', 'install', 'list', 'push', 'search'] },
    { id: 'help-config', title: 'config --help', argv: ['config', '--help'], creds: false, stdout: ['delete', 'get', 'init', 'list', 'set'] },
    { id: 'help-mcp', title: 'mcp --help', argv: ['mcp', '--help'], creds: false, stdout: ['deploy', 'install', 'start', 'status', 'stop'] },
    { id: 'help-exec', title: 'exec --help documents --cwd/--env/--timeout/--background/--stream', argv: ['exec', '--help'], creds: false, stdout: ['SANDBOX_ID', 'COMMAND', '--cwd', '--env', '--timeout', '--background', '--stream'] },
    { id: 'help-run', title: 'run --help documents --arg/--json-args', argv: ['run', '--help'], creds: false, stdout: ['SANDBOX_ID', 'COMMAND_NAME', '--arg', '--json-args'] },
    { id: 'exec-background-stream-conflict', title: 'exec --background and --stream cannot be combined', argv: ['exec', 'sbx-x', '--background', '--stream', '--', 'true'], creds: false, exit: 2, output: 'cannot be combined' },
    { id: 'help-kill', title: 'kill --help documents --all/--yes', argv: ['kill', '--help'], creds: false, stdout: ['--all', '--yes'] },
    { id: 'help-create', title: 'create --help documents --template/--env/--upload', argv: ['create', '--help'], creds: false, stdout: ['--template', '--env', '--upload'] },

    { id: 'unknown-command', title: 'unknown command exits 2 with "No such command"', argv: ['nosuchcmd'], creds: false, exit: 2, output: 'No such command' },
    { id: 'unknown-command-json', title: 'unknown command under --json still exits 2', argv: ['--json', 'nosuchcmd'], creds: false, exit: 2 },
    { id: 'missing-args-exec', title: 'exec without args exits 2 (usage error)', argv: ['exec'], creds: false, exit: 2, output: /Missing argument/ },
    { id: 'missing-args-run', title: 'run without COMMAND_NAME exits 2', argv: ['run', 'sbx-x'], creds: false, exit: 2, output: 'Missing argument' },
    { id: 'invalid-log-level', title: 'invalid --log-level exits 2', argv: ['--log-level', 'bogus', 'list'], creds: false, exit: 2, output: /not one of/ },
    { id: 'invalid-list-status', title: 'invalid list --status exits 2', argv: ['list', '--status', 'bogus'], creds: false, exit: 2, output: /Invalid value for '--status': 'bogus' is not one of 'running', 'stopped', 'creating', 'paused', 'error'\./ },
    { id: 'invalid-mcp-target', title: 'invalid mcp install --target exits 2', argv: ['mcp', 'install', '--target', 'bogus'], creds: false, exit: 2, output: /Invalid value for '--target': 'bogus' is not one of 'cursor', 'claude', 'vscode'\./ },
    { id: 'upload-missing-local', title: 'upload of a nonexistent local path exits 2 before any network call', argv: ['upload', 'sbx-x', 'does-not-exist.txt', '/tmp/x'], creds: false, exit: 2, output: /does not exist/ },
    { id: 'create-needs-route', title: '`create` with neither DESCRIPTION nor --template exits 2', argv: ['create'], creds: false, exit: 2, output: ['--template base'] },
    { id: 'create-conflict', title: 'DESCRIPTION and --template are mutually exclusive', argv: ['create', 'a thing', '--template', 'base'], creds: false, exit: 'nonzero', output: 'cannot be combined' },
    { id: 'kill-needs-target', title: '`kill` with neither id nor --all exits 2', argv: ['kill'], creds: false, exit: 2, output: 'Either provide a sandbox ID or use --all' },

    { id: 'no-credentials-list', title: 'list without credentials: exit 3, E1001', argv: ['list'], creds: false, exit: 3, output: ['E1001', 'No authentication credentials'] },
    {
      id: 'no-credentials-list-json', title: '--json error envelope without credentials', argv: ['--json', 'list'], creds: false, exit: 3,
      jsonShape: { status: 'string', message: 'string', code: 'string', suggestion: 'string' }, json: (j) => { if (j.status !== 'error' || j.code !== 'E1001') throw new Error(`unexpected envelope ${JSON.stringify(j)}`); },
    },
    { id: 'no-credentials-exec', title: 'exec without credentials: exit 3', argv: ['exec', 'sbx-x', 'echo hi'], creds: false, exit: 3, output: 'E1001' },
    { id: 'no-credentials-template-list', title: 'template list without credentials: exit 3', argv: ['template', 'list'], creds: false, exit: 3, output: 'E1001' },

    // ---- config store (fresh HOME per scenario) -------------------------------------------------
    {
      id: 'config-list-json', title: 'config list --json: documented keys and defaults (no shortcuts table)', argv: ['--json', 'config', 'list'], creds: false, freshHome: true,
      jsonShape: { sandbox_api_key: 'string|null', region: 'string', http_timeout: 'number', http2: 'boolean', max_retries: 'number', llm_model: 'string' },
      json: (j) => {
        if (j.region !== 'cn-hangzhou') throw new Error(`default region should be cn-hangzhou, got ${j.region}`);
        if (j.max_retries !== 3 || j.http_timeout !== 30) throw new Error('unexpected numeric defaults');
        if ('shortcuts' in j) throw new Error('config list must not expose a shortcuts table');
      },
    },
    { id: 'config-list-text', title: 'config list (text): sections and "(default)"/"(not set)" markers', argv: ['config', 'list'], creds: false, freshHome: true, stdout: ['Sandbox authentication', 'sandbox_api_key', '(not set)', 'region', 'cn-hangzhou (default)', { not: 'Shortcuts' }] },
    { id: 'config-get-default', title: 'config get region -> cn-hangzhou', argv: ['config', 'get', 'region'], creds: false, freshHome: true, stdout: /^cn-hangzhou$/m },
    { id: 'config-get-json', title: 'config get --json returns a JSON scalar', argv: ['--json', 'config', 'get', 'region'], creds: false, freshHome: true, stdout: /^"cn-hangzhou"$/m },
    { id: 'config-get-unknown', title: 'config get of an unknown key exits 2 and lists available keys', argv: ['config', 'get', 'nosuchkey'], creds: false, freshHome: true, exit: 2, output: ['Unknown config key', 'region', 'sandbox_api_key'] },
    { id: 'config-set-invalid-number', title: 'config set http_timeout abc exits 2', argv: ['config', 'set', 'http_timeout', 'abc'], creds: false, freshHome: true, exit: 2, output: 'Invalid numeric value' },
    {
      id: 'config-set-get-delete', title: 'config set/get/delete round-trip persists to ~/.abx/config.toml', creds: false,
      async run(ctx) {
        const home = ctx.newHome('cfg-roundtrip');
        let r = await ctx.abx(['config', 'set', 'region', 'cn-shanghai'], { home, creds: false });
        ctx.check('set', r.out, 'Set region = cn-shanghai');
        if (r.code !== 0) ctx.fail(`set exit ${r.code}`);
        const toml = join(home, '.abx', 'config.toml');
        if (!existsSync(toml) || !/region\s*=\s*"cn-shanghai"/.test(readFileSync(toml, 'utf8'))) ctx.fail('config.toml does not contain region = "cn-shanghai"');
        r = await ctx.abx(['config', 'get', 'region'], { home, creds: false });
        ctx.check('get', r.stdout, /^cn-shanghai$/m);
        r = await ctx.abx(['config', 'delete', 'region'], { home, creds: false });
        if (r.code !== 0) ctx.fail(`delete exit ${r.code}`);
        ctx.check('delete', r.out, /cn-hangzhou/);
        r = await ctx.abx(['config', 'get', 'region'], { home, creds: false });
        ctx.check('get after delete', r.stdout, /^cn-hangzhou$/m);
      },
    },
    {
      id: 'config-set-numeric', title: 'config set http_timeout 77 then get -> 77', creds: false,
      async run(ctx) {
        const home = ctx.newHome('cfg-num');
        const r = await ctx.abx(['config', 'set', 'http_timeout', '77'], { home, creds: false });
        if (r.code !== 0) ctx.fail(`set exit ${r.code}\n${r.out}`);
        const g = await ctx.abx(['config', 'get', 'http_timeout'], { home, creds: false });
        ctx.check('get', g.stdout, /^77(\.0)?$/m);
      },
    },
    {
      id: 'config-secret-masked', title: 'config set github_token: value stored, echoed masked, cleared with ""', creds: false,
      async run(ctx) {
        const home = ctx.newHome('cfg-secret');
        const token = 'ghp_fake0123456789abcdef';
        const mask2 = (t) => t.split(token).join('<TOKEN>');
        let r = await ctx.rawAbx(['config', 'set', 'github_token', token], { home, creds: false });
        if (r.code !== 0) ctx.fail(`set exit ${r.code}`);
        if ((r.stdout + r.stderr).includes(token)) ctx.fail('set echoed the secret in clear text');
        r = await ctx.rawAbx(['config', 'get', 'github_token'], { home, creds: false });
        if ((r.stdout + r.stderr).includes(token)) ctx.fail('get printed the secret in clear text');
        r = await ctx.rawAbx(['config', 'list'], { home, creds: false });
        if ((r.stdout + r.stderr).includes(token)) ctx.fail(mask2('list printed the secret in clear text'));
        const stored = readFileSync(join(home, '.abx', '.env'), 'utf8');
        if (!stored.includes(token)) ctx.fail('token was not persisted to ~/.abx/.env');
        r = await ctx.rawAbx(['config', 'set', 'github_token', ''], { home, creds: false });
        if (r.code !== 0) ctx.fail(`clear exit ${r.code}`);
        const after = existsSync(join(home, '.abx', '.env')) ? readFileSync(join(home, '.abx', '.env'), 'utf8') : '';
        if (after.includes(token)) ctx.fail('token still present after clearing');
      },
    },
    {
      id: 'config-env-overrides-store', title: 'environment variable overrides stored value and is reported as (env)', creds: false,
      async run(ctx) {
        const home = ctx.newHome('cfg-env');
        await ctx.abx(['config', 'set', 'region', 'cn-shanghai'], { home, creds: false });
        const r = await ctx.abx(['--json', 'config', 'get', 'api_url'], { home, creds: false, env: { ABX_SANDBOX_BASE_URL: 'https://example.invalid' } });
        ctx.check('api_url', r.stdout, 'example.invalid');
      },
    },
    { id: 'config-init-yes', title: 'config init --yes prints non-interactive commands, exit 0, never blocks', argv: ['config', 'init', '--yes'], creds: false, freshHome: true, stdin: '', timeoutMs: 30000, stdout: ['abx config set sandbox_api_key', 'abx config set region', { not: 'acr_namespace' }, { not: 'llm_api_key' }] },
    { id: 'config-init-yes-build-llm', title: 'config init --yes --build --llm prints the ACR, AccessKey and LLM commands too', argv: ['config', 'init', '--yes', '--build', '--llm'], creds: false, freshHome: true, stdin: '', timeoutMs: 30000, stdout: ['abx config set acr_namespace', 'abx config set access_key_id', 'abx config set llm_api_key'] },
    { id: 'config-init-non-tty', title: 'config init with piped stdin (no TTY) does not prompt', argv: ['config', 'init'], creds: false, freshHome: true, stdin: '', timeoutMs: 30000, stdout: 'abx config set' },
    { id: 'config-init-reset-shortcuts-gone', title: 'config init --reset-shortcuts is gone', argv: ['config', 'init', '--reset-shortcuts'], creds: false, freshHome: true, exit: 2, output: 'No such option' },
    { id: 'config-set-shortcut-key-rejected', title: 'config set shortcuts.NAME is rejected (no shortcut configuration)', argv: ['config', 'set', 'shortcuts.scaf', 'template init'], creds: false, freshHome: true, exit: 2 },
    { id: 'config-init-pointers', title: 'config init (default) asks for credentials + region only and points to --build / --llm', argv: ['config', 'init', '--yes'], creds: false, freshHome: true, stdin: '', stdout: ["abx config init --build", "abx config init --llm"] },

    // ---- MCP config ------------------------------------------------------------------------------
    {
      id: 'mcp-status-json', title: 'mcp status --json shape; nothing installed in a fresh HOME', argv: ['--json', 'mcp', 'status'], creds: false, freshHome: true,
      jsonShape: { server: 'string', transport: 'string', tools_count: 'number', tools: ['string'], auth_configured: 'boolean', mcp_running: 'boolean', installed_cursor: 'boolean', installed_claude: 'boolean', installed_vscode: 'boolean' },
      json: (j) => {
        if (j.server !== 'agent-sandbox' || j.transport !== 'stdio') throw new Error('unexpected server/transport');
        for (const t of ['create_sandbox', 'run_code', 'run_command', 'read_file', 'write_file', 'list_files', 'kill_sandbox']) if (!j.tools.includes(t)) throw new Error(`missing tool ${t}`);
        if (j.auth_configured !== false || j.installed_cursor || j.installed_claude || j.installed_vscode || j.mcp_running) throw new Error('fresh HOME must report nothing configured');
      },
    },
    { id: 'mcp-status-text', title: 'mcp status (text) lists tools and IDE install state', argv: ['mcp', 'status'], creds: false, freshHome: true, stdout: ['agent-sandbox', 'stdio', 'create_sandbox', 'installed_cursor'] },
    { id: 'mcp-stop-not-running', title: 'mcp stop when nothing runs: exit 0 "not running"', argv: ['mcp', 'stop'], creds: false, freshHome: true, output: /not running/i },
    {
      id: 'mcp-install-targets', title: 'mcp install writes cursor/claude/vscode configs into the isolated HOME/cwd and status reflects it',
      async run(ctx) {
        const home = ctx.newHome('mcp');
        const cwd = ctx.newCwd('mcp');
        const key = 'e2e-fake-api-key-0123456789';
        const env = { ABX_SANDBOX_API_KEY: key, ABX_SANDBOX_BASE_URL: 'https://api.example.invalid' };
        const targets = [['cursor', join(home, '.cursor', 'mcp.json')], ['claude', join(home, '.config', 'claude', 'claude_desktop_config.json')], ['vscode', join(cwd, '.vscode', 'mcp.json')]];
        for (const [t, file] of targets) {
          const r = await ctx.abx(['mcp', 'install', '--target', t], { home, cwd, creds: false, env });
          if (r.code !== 0) ctx.fail(`install ${t} exit ${r.code}\n${r.out}`);
          ctx.check(`install ${t}`, r.stdout, ['MCP Server config written', 'create_sandbox', 'kill_sandbox']);
          if (!existsSync(file)) ctx.fail(`${t}: expected config file at ${file.replace(ctx.root, '<TMP>')}`);
          let cfg;
          try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch { ctx.fail(`${t}: config file is not valid JSON`); }
          const servers = cfg.mcpServers ?? cfg.servers;
          const entry = servers?.['agent-sandbox'];
          if (!entry) ctx.fail(`${t}: no agent-sandbox server entry (keys: ${Object.keys(servers ?? cfg).join(',')})`);
          if (!Array.isArray(entry.args) || !entry.args.includes('mcp') || !entry.args.includes('start')) ctx.fail(`${t}: entry.args must run "mcp start"`);
        }
        const r = await ctx.abx(['--json', 'mcp', 'status'], { home, cwd, creds: false, env });
        const j = ctx.parseJsonLoose(r.stdout);
        if (!j?.installed_cursor || !j?.installed_claude || !j?.installed_vscode) ctx.fail(`status after install: ${JSON.stringify({ c: j?.installed_cursor, cl: j?.installed_claude, v: j?.installed_vscode })}`);
        const cursorCfg = JSON.parse(readFileSync(targets[0][1], 'utf8'));
        if (cursorCfg.mcpServers['agent-sandbox'].env?.ABX_SANDBOX_API_KEY !== key) ctx.fail('cursor config should carry the ABX_SANDBOX_API_KEY from the environment');
        const again = await ctx.abx(['mcp', 'install', '--target', 'cursor'], { home, cwd, creds: false, env });
        if (again.code !== 0) ctx.fail('re-install (merge) must be idempotent');
      },
    },
    {
      id: 'mcp-install-merges-existing', title: 'mcp install preserves other servers already present in the IDE config',
      async run(ctx) {
        const home = ctx.newHome('mcp-merge');
        mkdirSync(join(home, '.cursor'), { recursive: true });
        writeFileSync(join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }));
        const r = await ctx.abx(['mcp', 'install', '--target', 'cursor'], { home, creds: false, env: { ABX_SANDBOX_API_KEY: 'e2e-fake-api-key-0123456789' } });
        if (r.code !== 0) ctx.fail(`exit ${r.code}\n${r.out}`);
        const cfg = JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8'));
        if (!cfg.mcpServers.other || !cfg.mcpServers['agent-sandbox']) ctx.fail(`merge lost an entry: ${Object.keys(cfg.mcpServers).join(',')}`);
      },
    },

    {
      id: 'mcp-deploy-client-requirements', title: 'mcp deploy writes the Python client MCP distribution into requirements.txt', creds: false,
      async run(ctx) {
        const cwd = ctx.newCwd('mcp-artifact');
        const out = join(cwd, 'artifact');
        const r = await ctx.abx(['mcp', 'deploy', '--output-dir', out, '--api-key', 'placeholder', '--region', 'cn-hangzhou'], {
          cwd, creds: false, env: { ABX_MCP_AUTH_TOKEN: 'placeholder' },
        });
        if (r.code !== 0) ctx.fail(`mcp deploy exit ${r.code}\n${r.out}`);
        const requirements = readFileSync(join(out, 'requirements.txt'), 'utf8');
        if (requirements !== 'agent-sandbox-client[mcp]\nuvicorn>=0.29\n') ctx.fail('artifact must install agent-sandbox-client[mcp] and uvicorn');
        for (const file of ['app.py', 'config.yaml']) if (!existsSync(join(out, file))) ctx.fail(`missing artifact file ${file}`);
      },
    },

    // ---- template scaffolding -------------------------------------------------------------------
    {
      id: 'template-init-python', title: 'template init DIR --template python --name N scaffolds Dockerfile/commands.py/template.yaml', creds: false,
      async run(ctx) {
        const cwd = ctx.newCwd('tinit');
        const r = await ctx.abx(['template', 'init', 'my-tpl-dir', '--template', 'python', '--name', 'my-tpl'], { cwd, creds: false });
        if (r.code !== 0) ctx.fail(`exit ${r.code}\n${r.out}`);
        for (const f of ['Dockerfile', 'commands.py', 'template.yaml', 'README.md']) if (!existsSync(join(cwd, 'my-tpl-dir', f))) ctx.fail(`missing scaffold file ${f}`);
        const yaml = readFileSync(join(cwd, 'my-tpl-dir', 'template.yaml'), 'utf8');
        if (!yaml.includes('my-tpl')) ctx.fail('template.yaml does not carry the template name');
        ctx.check('output', r.out, ['my-tpl', 'abx template deploy']);
      },
    },
    {
      id: 'template-init-refuses-overwrite', title: 'template init into a non-empty dir does not silently clobber existing files', creds: false,
      async run(ctx) {
        const cwd = ctx.newCwd('tinit2');
        mkdirSync(join(cwd, 'exists'), { recursive: true });
        writeFileSync(join(cwd, 'exists', 'Dockerfile'), '# mine\n');
        await ctx.abx(['template', 'init', 'exists', '--template', 'python', '--name', 'x'], { cwd, creds: false, stdin: 'n\n' });
        if (readFileSync(join(cwd, 'exists', 'Dockerfile'), 'utf8') !== '# mine\n') ctx.fail('existing Dockerfile was overwritten without consent');
      },
    },
    {
      id: 'template-deploy-missing-dir', title: 'template deploy of a nonexistent dir exits 2 before any cloud call', argv: ['template', 'deploy', '/nonexistent/e2e-dir'], creds: false, exit: 2, output: /does not exist/,
    },
    {
      id: 'template-search-local-index', title: 'template search against a local --index-url file (offline, deterministic)', creds: false,
      async run(ctx) {
        const cwd = ctx.newCwd('idx');
        writeFileSync(join(cwd, 'index.yaml'), INDEX);
        let r = await ctx.abx(['template', 'search', 'alpha', '--index-url', join(cwd, 'index.yaml')], { cwd, creds: false });
        if (r.code !== 0) ctx.fail(`exit ${r.code}\n${r.out}`);
        ctx.check('hit', r.stdout, ['alpha-py', '1 template(s) found']);
        ctx.check('miss', r.stdout, [{ not: 'beta-node' }]);
        r = await ctx.abx(['--json', 'template', 'search', 'a', '--index-url', join(cwd, 'index.yaml'), '--status', 'community'], { cwd, creds: false });
        const j = ctx.parseJsonLoose(r.stdout);
        if (!Array.isArray(j) || j.length !== 1 || j[0].name !== 'beta-node') ctx.fail(`status filter: ${JSON.stringify(j)}`);
        r = await ctx.abx(['--json', 'template', 'search', 'node', '--tag', 'node', '--index-url', join(cwd, 'index.yaml')], { cwd, creds: false });
        ctx.check('tag filter', r.stdout, ['beta-node']);
        r = await ctx.abx(['template', 'search', 'zzzznomatch', '--index-url', join(cwd, 'index.yaml')], { cwd, creds: false });
        if (r.code !== 0) ctx.fail(`no-match exit ${r.code}`);
        ctx.check('nomatch', r.stdout, "No templates matching 'zzzznomatch'");
      },
    },
  ],
};

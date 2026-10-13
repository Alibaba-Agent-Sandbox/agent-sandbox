// Differential cases. Seeded from the original Python evidence registry (tests/test_cli_evidence,
// ~100 cases): every case whose behaviour is observable through (argv, env, files, HTTP) is expressed
// here against the stub cloud. Mock-only internals (qwen-code/AI generation, interactive REPL) are
// intentionally not seeded.
//
// Case fields:
//   id, argv[]            identical argv for both binaries
//   world                 stub world overrides (sandboxes, templates, faults, files, dirs)
//   env                   extra environment ({KEY: null} removes a variable)
//   creds:false           run without any credentials
//   setup(home, cwd)      seed files into the isolated HOME/cwd before the run
//   stdin                 text piped to the process
//   artifacts[]           files (relative to HOME or cwd, prefix home:/cwd:) captured after the run
//   wire:false            do not compare the recorded HTTP traffic
//   slow:true             skipped with --fast
//   evidence              original registry case id (provenance)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const write = (root, rel, content) => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); };
const help = (...argv) => ({ id: `help-${argv.filter((a) => a !== '--help').join('-') || 'abx'}`, argv, creds: false, wire: false, evidence: `help-${argv.filter((a) => a !== '--help').join('-') || 'abx'}` });

export const CASES = [
  // ---- offline: help / version -------------------------------------------------------------------
  help('--help'), help('create', '--help'), help('list', '--help'), help('info', '--help'), help('kill', '--help'), help('exec', '--help'),
  help('run', '--help'), help('connect', '--help'), help('upload', '--help'), help('download', '--help'), help('install', '--help'),
  help('config', '--help'), help('config', 'get', '--help'), help('config', 'set', '--help'), help('config', 'list', '--help'), help('config', 'init', '--help'),
  help('template', '--help'), help('template', 'list', '--help'), help('template', 'info', '--help'), help('template', 'build', '--help'),
  help('template', 'init', '--help'), help('template', 'delete', '--help'), help('template', 'install', '--help'),
  help('mcp', '--help'), help('mcp', 'deploy', '--help'), help('mcp', 'install', '--help'), help('mcp', 'start', '--help'), help('mcp', 'stop', '--help'), help('mcp', 'status', '--help'),
  help('deploy', '--help'), help('init', '--help'),
  help('sandbox', '--help'), help('sandbox', 'files', '--help'), help('sandbox', 'process', '--help'), help('sandbox', 'system', '--help'),
  { id: 'version', argv: ['--version'], creds: false, wire: false, evidence: 'version' },

  // ---- offline: usage errors ---------------------------------------------------------------------
  { id: 'error-create-noargs', argv: ['create'], creds: false, wire: false, evidence: 'error-create-noargs' },
  { id: 'error-unknown-suggestion', argv: ['crate'], creds: false, wire: false, evidence: 'error-unknown-suggestion' },
  { id: 'error-unknown-custom-hint', argv: ['frobnicate'], creds: false, wire: false, evidence: 'error-unknown-custom-hint' },
  { id: 'kill-no-id', argv: ['kill'], creds: false, wire: false, evidence: 'kill-no-id' },
  { id: 'create-env-invalid', argv: ['create', '-e', 'INVALID', '--template', 'base'], wire: false, evidence: 'create-env-invalid' },
  { id: 'create-nl-conflict', argv: ['create', '运行 python', '--template', 'base'], wire: false, evidence: 'create-nl-conflict' },
  { id: 'run-invalid-arg', argv: ['run', 'sbx-ev-001', 'dev', '--arg', 'badformat'], wire: false, evidence: 'run-invalid-arg' },
  { id: 'no-credentials-list', argv: ['list'], creds: false, wire: false },
  { id: 'no-credentials-list-json', argv: ['--json', 'list'], creds: false, wire: false },
  { id: 'invalid-list-status', argv: ['list', '--status', 'bogus'], wire: false },

  // ---- offline: config store (HOME-isolated) -------------------------------------------------------
  { id: 'config-get-region', argv: ['config', 'get', 'region'], creds: false, wire: false, evidence: 'config-get-region' },
  { id: 'config-get-apikey-unset', argv: ['config', 'get', 'sandbox_api_key'], creds: false, wire: false, evidence: 'config-get-apikey-unset' },
  { id: 'config-get-apikey-env', argv: ['config', 'get', 'sandbox_api_key'], creds: false, env: { E2B_API_KEY: 'e2b_envkey_0123456789abcdef' }, wire: false, evidence: 'config-get-apikey-env' },
  { id: 'config-get-apikey-stored', argv: ['config', 'get', 'sandbox_api_key'], creds: false, setup: (h) => write(h, '.abx/.env', 'E2B_API_KEY=e2b_stored_0123456789abcdef\n'), wire: false, evidence: 'config-get-apikey-set' },
  { id: 'config-get-unknown', argv: ['config', 'get', 'unknown_key'], creds: false, wire: false, evidence: 'config-get-unknown' },
  { id: 'config-get-llm-model-unset', argv: ['config', 'get', 'llm_model'], creds: false, wire: false, evidence: 'config-get-llm-model-unset' },
  { id: 'config-set-region', argv: ['config', 'set', 'region', 'cn-shanghai'], creds: false, wire: false, artifacts: ['home:.abx/config.toml'], evidence: 'config-set-region' },
  { id: 'config-set-llm-apikey', argv: ['config', 'set', 'llm_api_key', 'sk-mykey12345678'], creds: false, wire: false, artifacts: ['home:.abx/.env'], evidence: 'config-set-llm-apikey' },
  { id: 'config-set-empty-default', argv: ['config', 'set', 'region', ''], creds: false, wire: false, artifacts: ['home:.abx/config.toml'], evidence: 'config-set-empty-default' },
  { id: 'config-set-empty-credential', argv: ['config', 'set', 'sandbox_api_key', ''], creds: false, wire: false, setup: (h) => write(h, '.abx/.env', 'E2B_API_KEY=e2b_stored_0123456789abcdef\n'), artifacts: ['home:.abx/.env'], evidence: 'config-set-empty-credential' },
  { id: 'config-set-invalid-number', argv: ['config', 'set', 'http_timeout', 'abc'], creds: false, wire: false },
  { id: 'config-list', argv: ['config', 'list'], creds: false, wire: false, evidence: 'config-list' },
  { id: 'config-list-json', argv: ['--json', 'config', 'list'], creds: false, wire: false, evidence: 'config-list-json' },
  { id: 'config-list-with-env', argv: ['config', 'list'], creds: false, env: { E2B_API_KEY: 'e2b_envkey_0123456789abcdef', E2B_API_URL: 'http://api.example.test' }, wire: false },
  { id: 'config-init-non-tty', argv: ['config', 'init'], creds: false, stdin: '', wire: false, evidence: 'config-init' },
  { id: 'config-init-yes', argv: ['config', 'init', '--yes'], creds: false, wire: false },
  { id: 'config-set-github-token', argv: ['config', 'set', 'github_token', 'ghp_evidence1234567890'], creds: false, wire: false, artifacts: ['home:.abx/.env'], evidence: 'config-set-github-token' },
  { id: 'config-get-github-token-unset', argv: ['config', 'get', 'github_token'], creds: false, wire: false, evidence: 'config-get-github-token-unset' },
  { id: 'config-get-github-token-set', argv: ['config', 'get', 'github_token'], creds: false, wire: false, setup: (h) => write(h, '.abx/.env', 'GITHUB_TOKEN=ghp_evidence1234567890\n'), evidence: 'config-get-github-token-set' },
  { id: 'config-set-github-token-clear', argv: ['config', 'set', 'github_token', ''], creds: false, wire: false, setup: (h) => write(h, '.abx/.env', 'GITHUB_TOKEN=ghp_evidence1234567890\n'), artifacts: ['home:.abx/.env'], evidence: 'config-set-github-token-clear' },
  { id: 'config-delete-region', argv: ['config', 'delete', 'region'], creds: false, wire: false, setup: (h) => write(h, '.abx/config.toml', '[transport]\nregion = "cn-shanghai"\n'), artifacts: ['home:.abx/config.toml'] },

  // ---- offline: MCP config ------------------------------------------------------------------------------
  { id: 'mcp-install-cursor', argv: ['mcp', 'install', '--target', 'cursor'], env: { E2B_API_KEY: 'e2b_envkey_0123456789abcdef' }, creds: false, wire: false, artifacts: ['home:.cursor/mcp.json'], evidence: 'mcp-install-cursor' },
  { id: 'mcp-install-vscode', argv: ['mcp', 'install', '--target', 'vscode'], env: { E2B_API_KEY: 'e2b_envkey_0123456789abcdef' }, creds: false, wire: false, artifacts: ['cwd:.vscode/mcp.json'] },
  { id: 'mcp-status', argv: ['mcp', 'status'], creds: false, wire: false, evidence: 'mcp-status' },
  { id: 'mcp-status-json', argv: ['--json', 'mcp', 'status'], creds: false, wire: false, evidence: 'mcp-status-json' },
  { id: 'mcp-stop-not-running', argv: ['mcp', 'stop'], creds: false, wire: false },

  // ---- stub cloud: lifecycle ---------------------------------------------------------------------------------
  { id: 'create-template-base', argv: ['create', '--template', 'base'], evidence: 'create-template-base' },
  { id: 'create-template-base-json', argv: ['--json', 'create', '--template', 'base'], evidence: 'create-template-base-json' },
  { id: 'create-env', argv: ['create', '-e', 'FOO=bar', '--template', 'base'], evidence: 'create-env' },
  { id: 'create-metadata', argv: ['create', '-m', 'project=demo', '--template', 'base'], evidence: 'create-metadata' },
  { id: 'create-timeout', argv: ['create', '--template', 'base', '--timeout', '600'] },
  { id: 'list', argv: ['list'], evidence: 'list' },
  { id: 'list-json', argv: ['--json', 'list'], evidence: 'list-json' },
  { id: 'list-running', argv: ['list', '--status', 'running'], evidence: 'list-running' },
  { id: 'list-empty', argv: ['list'], world: { sandboxes: {} }, evidence: 'list-empty' },
  { id: 'list-empty-json', argv: ['--json', 'list'], world: { sandboxes: {} } },
  { id: 'info', argv: ['info', 'sbx-ev-001'], evidence: 'info' },
  { id: 'info-json', argv: ['--json', 'info', 'sbx-ev-001'], evidence: 'info-json' },
  { id: 'info-missing', argv: ['info', 'sbx-nope'] },
  { id: 'info-missing-json', argv: ['--json', 'info', 'sbx-nope'] },
  { id: 'kill-single', argv: ['kill', 'sbx-ev-001', '--yes'], evidence: 'kill-single' },
  { id: 'kill-single-json', argv: ['--json', 'kill', 'sbx-ev-001', '--yes'] },
  { id: 'kill-all', argv: ['kill', '--all', '--yes'], evidence: 'kill-all' },
  { id: 'kill-declined', argv: ['kill', 'sbx-ev-001'], stdin: 'n\n' },
  { id: 'exec-basic', argv: ['exec', 'sbx-ev-001', 'echo hello'], evidence: 'exec-basic' },
  { id: 'exec-json', argv: ['--json', 'exec', 'sbx-ev-001', 'echo hello'], evidence: 'exec-json' },
  { id: 'exec-nonzero', argv: ['exec', 'sbx-ev-001', 'bad_cmd'], evidence: 'exec-nonzero' },
  { id: 'exec-exit-code', argv: ['exec', 'sbx-ev-001', 'echo x; exit 3'] },
  { id: 'exec-timeout-cwd', argv: ['exec', '--timeout', '10', '--cwd', '/tmp', 'sbx-ev-001', 'ls'], evidence: 'exec-timeout-cwd' },
  { id: 'exec-quiet', argv: ['-q', 'exec', 'sbx-ev-001', 'echo hello'] },
  { id: 'exec-ci', argv: ['--ci', 'exec', 'sbx-ev-001', 'echo hello'] },
  { id: 'exec-missing-sandbox', argv: ['exec', 'sbx-nope', 'echo hi'] },
  { id: 'upload-file', argv: ['upload', 'sbx-ev-001', 'local.txt', '/app/script.py'], setup: (h, c) => write(c, 'local.txt', 'print(1)\n'), evidence: 'upload-file' },
  { id: 'upload-dir', argv: ['upload', 'sbx-ev-001', 'updir', '/app/data/'], setup: (h, c) => { write(c, 'updir/a.txt', 'a\n'); write(c, 'updir/sub/b.txt', 'b\n'); }, evidence: 'upload-dir' },
  { id: 'upload-missing-local', argv: ['upload', 'sbx-ev-001', 'nope.txt', '/app/x'], wire: false },
  { id: 'download-file', argv: ['download', 'sbx-ev-001', '/app/result.csv', 'out.csv'], artifacts: ['cwd:out.csv'], evidence: 'download-file' },
  { id: 'download-missing', argv: ['download', 'sbx-ev-001', '/app/missing.csv', 'out2.csv'] },
  { id: 'files-list', argv: ['sandbox', 'files', 'list', 'sbx-ev-001', '--path', '/home/user'] },
  { id: 'files-list-json', argv: ['--json', 'sandbox', 'files', 'list', 'sbx-ev-001', '--path', '/home/user'] },
  { id: 'files-mkdir', argv: ['sandbox', 'files', 'mkdir', 'sbx-ev-001', '--path', '/home/user/new'] },
  { id: 'files-rm-yes', argv: ['sandbox', 'files', 'rm', 'sbx-ev-001', '--path', '/home/user/hello.txt', '--yes'] },
  { id: 'process-start', argv: ['sandbox', 'process', 'start', 'sbx-ev-001', '--command', 'echo started'] },
  { id: 'process-list', argv: ['sandbox', 'process', 'list', 'sbx-ev-001'] },
  { id: 'template-list-backend', argv: ['template', 'list'], evidence: 'template-list-backend' },
  { id: 'template-list-json', argv: ['--json', 'template', 'list'] },
  { id: 'template-info-backend', argv: ['template', 'info', 'tmpl-001'], evidence: 'template-info-backend' },
  { id: 'template-info-missing', argv: ['template', 'info', 'tmpl-nope'] },
  { id: 'template-delete-yes', argv: ['template', 'delete', 'tmpl-001', '--yes'] },

  // ---- stub cloud: failures ---------------------------------------------------------------------------------------
  { id: 'error-auth', argv: ['create', '--template', 'base'], world: { faults: { 'POST /sandboxes': { status: 401, body: { code: 401, message: 'invalid api key' } } } }, evidence: 'error-auth' },
  { id: 'error-auth-list-json', argv: ['--json', 'list'], world: { faults: { 'GET /sandboxes': { status: 401, body: { code: 401, message: 'invalid api key' } } } } },
  { id: 'error-template-not-found', argv: ['create', '--template', 'bad'], world: { faults: { 'POST /sandboxes': { status: 404, body: { code: 404, message: 'template not found' } } } }, evidence: 'error-template-not-found' },
  { id: 'error-quota', argv: ['create', '--template', 'base'], world: { faults: { 'POST /sandboxes': { status: 429, body: { code: 429, message: 'quota exceeded' } } } }, evidence: 'error-quota' },
  { id: 'error-server-500', argv: ['list'], world: { faults: { 'GET /sandboxes': { status: 500, body: { message: 'boom' } } } }, slow: true },
  { id: 'error-timeout', argv: ['exec', '--timeout', '1', 'sbx-ev-001', 'sleep 999'], slow: true, evidence: 'error-timeout' },
];

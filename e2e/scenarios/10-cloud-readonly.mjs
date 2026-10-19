// Invalid authentication sentinel used only for negative E2E cases; not a credential.
const INVALID_API_KEY = `e2b_${"0".repeat(40)}`;
// Real-cloud scenarios that do not create sandboxes: auth, templates, not-found errors.
export default {
  id: 'cloud-readonly',
  title: 'Real cloud, read-only: auth, templates, not-found handling',
  needs: ['cloud'],
  scenarios: [
    {
      id: 'config-list-masks-secrets', title: 'config list never prints credentials in clear text',
      async run(ctx) {
        const r = await ctx.rawAbx(['config', 'list']);
        const all = r.stdout + r.stderr;
        for (const k of ['E2B_API_KEY', 'ALICLOUD_ACCESS_KEY_SECRET', 'ABX_LLM_API_KEY']) if (ctx.creds[k] && all.includes(ctx.creds[k])) ctx.fail(`config list leaked ${k}`);
        const j = await ctx.rawAbx(['--json', 'config', 'list']);
        for (const k of ['E2B_API_KEY', 'ALICLOUD_ACCESS_KEY_SECRET', 'ABX_LLM_API_KEY']) if (ctx.creds[k] && (j.stdout + j.stderr).includes(ctx.creds[k])) ctx.fail(`config list --json leaked ${k}`);
        if (r.code !== 0 || j.code !== 0) ctx.fail('config list failed');
      },
    },
    {
      id: 'auth-wrong-key', title: 'standard list preserves authentication rejection', argv: ['list'], env: { E2B_API_KEY: INVALID_API_KEY }, exit: 1, output: /401|Unauthorized/i,
    },
    {
      id: 'auth-wrong-key-json', title: 'wrong API key under --json: error envelope with code E1000 (original) / E1001 (KI-006 fix)', argv: ['--json', 'info', 'sbx-00000000-0000-0000-0000-000000000000'], env: { E2B_API_KEY: INVALID_API_KEY }, exit: 3,
      jsonShape: { status: 'string', message: 'string', code: 'string', suggestion: 'string' },
      json: (j) => { if (j.status !== 'error' || !['E1000', 'E1001'].includes(j.code)) throw new Error(`unexpected envelope ${JSON.stringify(j)}`); },
    },
    { id: 'auth-wrong-key-template-list', title: 'wrong API key on template list fails (non-zero) and mentions 401', argv: ['template', 'list'], env: { E2B_API_KEY: INVALID_API_KEY }, exit: 'nonzero', output: /401|ERR_UNAUTHORIZED|api key is invalid/i },
    {
      id: 'list-json-shape', title: 'list --json: array of {ID,Template,Status,Region} or a {status,message} note when empty', argv: ['--json', 'list'],
      json: (j) => {
        if (Array.isArray(j)) { for (const s of j) for (const k of ['ID', 'Template', 'Status', 'Region']) if (!(k in s)) throw new Error(`entry missing ${k}`); }
        else if (j.status !== 'success' || !/No sandboxes/.test(j.message)) throw new Error(`unexpected empty form ${JSON.stringify(j)}`);
      },
    },
    { id: 'list-text', title: 'list (text) prints a table or "No sandboxes found."', argv: ['list'], output: /Sandbox ID|No running sandboxes|No sandboxes found/i },
    { id: 'list-status-accepts-valid', title: 'list --status running is accepted', argv: ['--json', 'list', '--status', 'running'] },
    {
      id: 'template-list-json', title: 'template list --json: array of {TemplateID,Alias,Status}', argv: ['--json', 'template', 'list'],
      jsonShape: [{ TemplateID: 'string', Alias: 'string', Status: 'string' }],
      json: (j) => { if (!j.length) throw new Error('account has no templates (expected at least the official ones)'); },
    },
    { id: 'template-list-text', title: 'template list (text) prints a TemplateID table', argv: ['template', 'list'], stdout: ['TEMPLATE ID', 'TEMPLATE NAME', 'VCPUS'] },
    { id: 'template-info', title: 'template info python-hello shows ID, resources, builds', argv: ['template', 'info', 'python-hello'], stdout: ['templateID', 'cpuCount', 'memoryMB', 'builds', 'python-hello'] },
    { id: 'template-info-missing', title: 'template info of unknown id: exit 4, E2001', argv: ['template', 'info', 'tpl-does-not-exist'], exit: 4, output: ['E2001', 'not found'] },
    {
      id: 'template-info-missing-json', title: 'template info unknown id --json envelope', argv: ['--json', 'template', 'info', 'tpl-does-not-exist'], exit: 4,
      jsonShape: { status: 'string', code: 'string', message: 'string' }, json: (j) => { if (j.code !== 'E2001') throw new Error(`code ${j.code}`); },
    },
    { id: 'template-delete-missing', title: 'template delete of unknown id: exit 4, E2001', argv: ['--json', 'template', 'delete', 'tpl-does-not-exist', '--yes'], exit: 4, output: 'E2001' },
    { id: 'create-missing-template', title: 'create --template <unknown>: exit 4, E2001', argv: ['create', 'no-such-template-e2e-xyz', '--detach'], exit: 1, output: /not found|404/i },
    { id: 'create-missing-template-json', title: 'create unknown template --json envelope', argv: ['--json', 'create', '--template', 'no-such-template-e2e-xyz'], exit: 4, jsonShape: { status: 'string', code: 'string' }, json: (j) => { if (j.code !== 'E2001') throw new Error(`code ${j.code}`); } },
    { id: 'info-missing-sandbox', title: 'info of unknown sandbox: exit 4 (E5000/404 originally, E2009 after the KI-005 fix)', argv: ['info', 'sbx-00000000-0000-0000-0000-000000000000'], exit: 1, output: /wasn't found/i },
    {
      id: 'info-missing-sandbox-json', title: 'info unknown sandbox --json envelope', argv: ['--json', 'info', 'sbx-00000000-0000-0000-0000-000000000000'], exit: 4,
      jsonShape: { status: 'string', message: 'string', code: 'string', suggestion: 'string' }, json: (j) => { if (j.status !== 'error') throw new Error('status must be "error"'); },
    },
    { id: 'exec-missing-sandbox', title: 'exec in unknown sandbox: exit 4 (404 originally, E2009 after the KI-005 fix)', argv: ['exec', 'sbx-00000000-0000-0000-0000-000000000000', 'echo hi'], exit: 1, output: /404|not found/i },
    { id: 'kill-missing-sandbox', title: 'kill of an unknown sandbox is idempotent', argv: ['kill', 'sbx-00000000-0000-0000-0000-000000000000'], exit: 0, output: /wasn't found/i },
    { id: 'files-missing-sandbox', title: 'sandbox files list in unknown sandbox: non-zero', argv: ['sandbox', 'files', 'list', 'sbx-00000000-0000-0000-0000-000000000000', '--path', '/tmp'], exit: 'nonzero' },
    // Standard --all acts immediately. Never run it against unrelated account resources.

  ],
};

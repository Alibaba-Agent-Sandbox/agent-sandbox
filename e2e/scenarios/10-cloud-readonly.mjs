import { configureExpressScenario, isExpressSandboxId } from '../lib/express-scenarios.mjs';
// Invalid authentication sentinel used only for negative E2E cases; not a credential.
const INVALID_API_KEY = `e2b_${"0".repeat(40)}`;
// Real-cloud scenarios that do not create sandboxes: auth, templates, not-found errors.
export default {
  id: 'cloud-readonly',
  title: 'Real cloud, read-only: auth, templates, not-found handling',
  needs: ['cloud'],
  setup: configureExpressScenario,
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
      id: 'auth-wrong-key-json', title: 'wrong API key under explicit native --json: error envelope with code E1000 (original) / E1001 (KI-006 fix)', argv: ['--native', '--json', 'info', 'sbx-00000000-0000-0000-0000-000000000000'], env: { E2B_API_KEY: INVALID_API_KEY }, exit: 3,
      jsonShape: { status: 'string', message: 'string', code: 'string', suggestion: 'string' },
      json: (j) => { if (j.status !== 'error' || !['E1000', 'E1001'].includes(j.code)) throw new Error(`unexpected envelope ${JSON.stringify(j)}`); },
    },
    { id: 'auth-wrong-key-template-list', title: 'wrong API key on template list fails (non-zero) and mentions 401', argv: ['template', 'list'], env: { E2B_API_KEY: INVALID_API_KEY }, exit: 'nonzero', output: /401|ERR_UNAUTHORIZED|api key is invalid/i },
    {
      id: 'list-json-shape', title: 'standard list --format json always returns an array', argv: ['list', '--format', 'json'],
      json: (j) => {
        if (!Array.isArray(j)) throw new Error('list must return an array, including when empty');
        for (const entry of j) for (const key of ['sandboxId', 'templateId', 'state', 'startedAt', 'endAt', 'envdVersion']) if (!(key in entry)) throw new Error(`entry missing ${key}`);
      },
    },
    { id: 'list-text', title: 'list (text) prints a table or "No sandboxes found."', argv: ['list'], output: /Sandbox ID|No running sandboxes|No sandboxes found/i },
    { id: 'list-status-accepts-valid', title: 'list --state running is accepted', argv: ['list', '--state', 'running', '--format', 'json'] },
    {
      id: 'template-list-json', title: 'standard template list --format json returns template identities and resources', argv: ['template', 'list', '--format', 'json'],
      jsonShape: [{ templateID: 'string', cpuCount: 'number', memoryMB: 'number' }],
      json: (j) => { if (!j.length) throw new Error('account has no templates (expected at least the official ones)'); },
    },
    { id: 'template-list-text', title: 'template list (text) prints a TemplateID table', argv: ['template', 'list'], stdout: ['TEMPLATE ID', 'TEMPLATE NAME', 'VCPUS'] },
    {
      id: 'template-info', title: 'official template info reads an actual ID from the same-account native inventory',
      async run(ctx) {
        const listed = await ctx.abx(['--native', '--json', 'template', 'list']);
        const templates = listed.rawJson();
        if (listed.code !== 0 || !Array.isArray(templates) || !templates.length) ctx.fail('native template inventory must provide an existing same-account template ID');
        const requested = process.env.ABX_E2E_TEMPLATE_ID;
        const selected = requested ? templates.find((item) => item.TemplateID === requested) : templates.find((item) => typeof item.TemplateID === 'string' && item.TemplateID && item.TemplateID !== 'N/A');
        if (!selected) ctx.fail('requested native template ID was not present in the selected account inventory');
        const detail = await ctx.abx(['--native', '--json', 'template', 'info', selected.TemplateID]);
        const info = detail.rawJson();
        if (detail.code !== 0 || info?.templateID !== selected.TemplateID) ctx.fail('native template info did not confirm the selected inventory identity');
        for (const field of ['code', 'name', 'status', 'runtimeConfig']) if (typeof info[field] !== 'string' || !info[field].trim()) ctx.fail(`template info missing formatted ${field}`);
        if (info.statusCode !== '200' || !info.runtimeConfig.startsWith('{') || !info.runtimeConfig.endsWith('}')) ctx.fail('native template info did not preserve successful official runtime configuration');
      },
    },
    { id: 'template-info-missing', title: 'official template info preserves its current typed network wrapper and exact backend 404 diagnostic', argv: ['--native', 'template', 'info', 'tpl-does-not-exist'], exit: 1, output: ['E5000', 'GetTemplate API call failed', 'TemplateNotFound', '404', 'template not found'] },
    {
      id: 'template-info-missing-json', title: 'official missing template JSON preserves E5000 and the exact backend error', argv: ['--native', '--json', 'template', 'info', 'tpl-does-not-exist'], exit: 1,
      jsonShape: { status: 'string', code: 'string', message: 'string' }, json: (j) => { if (j.status !== 'error' || j.code !== 'E5000' || !/GetTemplate API call failed/.test(j.message) || !/TemplateNotFound/.test(j.message) || !/404/.test(j.message)) throw new Error('missing-template response did not preserve the official API diagnostic'); },
    },
    { id: 'template-delete-missing', title: 'official delete of an unknown template preserves its exact backend 404 diagnostic', argv: ['--native', '--json', 'template', 'delete', 'tpl-does-not-exist', '--yes'], exit: 1, jsonShape: { status: 'string', code: 'string', message: 'string' }, json: (j) => { if (j.status !== 'error' || j.code !== 'E5000' || !/DeleteTemplate API call failed/.test(j.message) || !/TemplateNotFound/.test(j.message) || !/404/.test(j.message)) throw new Error('missing-template delete did not preserve the official API diagnostic'); } },
    {
      id: 'create-missing-template', title: 'standard detached create of an unknown template reports a definitive template rejection',
      async run(ctx) {
        const attempt = ctx.beginCreateAttempt('create-missing-template');
        const result = await ctx.abx(['create', 'no-such-template-e2e-xyz', '--detach']);
        const id = result.maskedStdout.trim();
        if (isExpressSandboxId(id)) { ctx.track(id); ctx.resolveCreateAttempt(attempt); ctx.fail('negative create unexpectedly returned a created sandbox identity'); }
        const rejected = result.code === 1 && /404/.test(result.out) && /template.*(?:not found|not exist)|TemplateNotFound/i.test(result.out);
        if (!isExpressSandboxId(id) && rejected) ctx.resolveCreateAttempt(attempt);
        if (!rejected) ctx.fail('unknown-template create did not produce a definitive template-not-found rejection');
      },
    },
    {
      id: 'create-missing-template-json', title: 'explicit native create rejects an unknown template while retaining any unexpected created ID',
      async run(ctx) {
        const attempt = ctx.beginCreateAttempt('create-missing-template-json');
        const result = await ctx.abx(['--native', '--json', 'create', '--template', 'no-such-template-e2e-xyz']);
        const body = result.rawJson();
        const id = body?.ID;
        if (isExpressSandboxId(id)) { ctx.track(id); ctx.resolveCreateAttempt(attempt); ctx.fail('negative create unexpectedly returned a created sandbox identity'); }
        const rejected = result.code === 4 && body?.status === 'error' && body.code === 'E2001' && /template.*(?:not found|not exist)|TemplateNotFound/i.test(body.message);
        if (!isExpressSandboxId(id) && rejected) ctx.resolveCreateAttempt(attempt);
        if (!rejected) ctx.fail('native unknown-template create did not produce its definitive E2001 rejection');
      },
    },
    { id: 'info-missing-sandbox', title: 'standard info of an unknown sandbox exits 1 with not-found text', argv: ['info', 'sbx-00000000-0000-0000-0000-000000000000'], exit: 1, output: /wasn't found/i },
    {
      id: 'info-missing-sandbox-json', title: 'info unknown sandbox explicit native JSON envelope', argv: ['--native', '--json', 'info', 'sbx-00000000-0000-0000-0000-000000000000'], exit: 4,
      jsonShape: { status: 'string', message: 'string', code: 'string', suggestion: 'string' }, json: (j) => { if (j.status !== 'error') throw new Error('status must be "error"'); },
    },
    { id: 'exec-missing-sandbox', title: 'standard exec in an unknown sandbox preserves not-found failure', argv: ['exec', 'sbx-00000000-0000-0000-0000-000000000000', 'echo hi'], exit: 1, output: /404|not found/i },
    { id: 'kill-missing-sandbox', title: 'kill of an unknown sandbox is idempotent', argv: ['kill', 'sbx-00000000-0000-0000-0000-000000000000'], exit: 0, output: /wasn't found/i },
    { id: 'files-missing-sandbox', title: 'sandbox files list in unknown sandbox: non-zero', argv: ['sandbox', 'files', 'list', 'sbx-00000000-0000-0000-0000-000000000000', '--path', '/tmp'], exit: 'nonzero' },
    // Standard --all acts immediately. Never run it against unrelated account resources.

  ],
};

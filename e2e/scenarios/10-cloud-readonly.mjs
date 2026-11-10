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
      id: 'auth-wrong-key', title: 'list preserves authentication rejection', argv: ['--json', 'list'], env: { E2B_API_KEY: INVALID_API_KEY }, exit: 3, output: /401|Unauthorized|E100[01]/i,
    },
    {
      id: 'auth-wrong-key-json', title: 'wrong API key under explicit native --json: error envelope with code E1000 (original) / E1001 (KI-006 fix)', argv: ['--json', "status", 'sbx-00000000-0000-0000-0000-000000000000'], env: { E2B_API_KEY: INVALID_API_KEY }, exit: 3,
      jsonShape: { status: 'string', message: 'string', code: 'string', suggestion: 'string' },
      json: (j) => { if (j.status !== 'error' || !['E1000', 'E1001'].includes(j.code)) throw new Error(`unexpected envelope ${JSON.stringify(j)}`); },
    },
    { id: 'auth-wrong-key-template-list', title: 'native template read rejects invalid cloud AccessKeys', needs: ['cloud-management'], argv: ['--json', 'provider', 'run', 'template.list', '--input', '{}'], env: { ABX_ACCESS_KEY_ID: 'invalid-e2e-ak', ABX_ACCESS_KEY_SECRET: 'invalid-e2e-secret', ALICLOUD_ACCESS_KEY_ID: 'invalid-e2e-ak', ALICLOUD_ACCESS_KEY_SECRET: 'invalid-e2e-secret' }, exit: 'nonzero', output: /InvalidAccessKey|Unauthorized|Forbidden|E100[01]|E5000/i },
    {
      id: 'list-json-shape', title: 'list JSON reports complete inventory items and provider errors', argv: ['--json', 'list'],
      json: (j) => {
        if (!Array.isArray(j.items) || j.partial !== false || !Array.isArray(j.errors) || j.errors.length) throw new Error('list must return complete items and error metadata');
        for (const entry of j.items) for (const key of ['sandbox_id', 'template', 'status', 'provider']) if (!(key in entry)) throw new Error(`entry missing ${key}`);
      },
    },
    { id: 'list-text', title: 'list (text) prints a table or "No sandboxes found."', argv: ['list'], output: /Sandbox ID|No running sandboxes|No sandboxes found/i },
    { id: 'list-status-accepts-valid', title: 'list --status running is accepted', argv: ['--json', 'list', '--status', 'running'] },
    {
      id: 'template-list-json', title: 'provider template.list returns native template identities', needs: ['cloud-management'], argv: ['--json', 'provider', 'run', 'template.list', '--input', '{}'],
      jsonShape: { templates: [{ templateID: 'string', name: 'string' }] },
      json: (j) => { if (!j.templates.length) throw new Error('account has no templates (expected at least the official ones)'); },
    },
    { id: 'template-list-text', title: 'provider template.list text includes native identities', needs: ['cloud-management'], argv: ['provider', 'run', 'template.list', '--input', '{}'], stdout: ['templateID', 'name'] },
    {
      id: 'template-info', needs: ['cloud-management'], title: 'official template info reads an actual ID from the same-account native inventory',
      async run(ctx) {
        const listed = await ctx.abx(['--json', 'provider', 'run', 'template.list', '--input', '{}']);
        const templates = listed.rawJson()?.templates;
        if (listed.code !== 0 || !Array.isArray(templates) || !templates.length) ctx.fail('native template inventory must provide an existing same-account template ID');
        const requested = process.env.ABX_E2E_TEMPLATE_ID;
        const selected = requested ? templates.find((item) => item.templateID === requested) : templates.find((item) => typeof item.templateID === 'string' && item.templateID && item.templateID !== 'N/A');
        if (!selected) ctx.fail('requested native template ID was not present in the selected account inventory');
        const detail = await ctx.abx(['--json', 'provider', 'run', 'template.get', '--input', JSON.stringify({template_id: selected.templateID})]);
        const info = detail.rawJson()?.template;
        if (detail.code !== 0 || info?.templateID !== selected.templateID) ctx.fail('native template info did not confirm the selected inventory identity');
        for (const field of ['code', 'name']) if (typeof info[field] !== 'string' || !info[field].trim()) ctx.fail(`template info missing ${field}`);
        if (info.statusCode !== 200 || !info.status || typeof info.status !== 'object' || typeof info.status.state !== 'string' ||
            !info.runtimeConfig || typeof info.runtimeConfig !== 'object' || Array.isArray(info.runtimeConfig)) ctx.fail('native template info must preserve successful typed official response');
      },
    },
    { id: 'template-info-missing', needs: ['cloud-management'], title: 'official template info reports typed template absence', argv: ['provider', 'run', 'template.get', '--input', '{"template_id":"tpl-does-not-exist"}'], exit: 4, output: ['E2001', 'was not found'] },
    {
      id: 'template-info-missing-json', needs: ['cloud-management'], title: 'official missing template JSON returns typed E2001', argv: ['--json', 'provider', 'run', 'template.get', '--input', '{"template_id":"tpl-does-not-exist"}'], exit: 4,
      jsonShape: { status: 'string', code: 'string', message: 'string' }, json: (j) => { if (j.status !== 'error' || j.code !== 'E2001') throw new Error('missing-template info must return typed E2001'); },
    },
    { id: 'template-delete-missing', needs: ['cloud-management'], title: 'official delete of an unknown template preserves its exact backend 404 diagnostic', argv: ['--json', 'provider', 'run', 'template.delete', '--input', '{"template_id":"tpl-does-not-exist"}', '--yes'], exit: 1, jsonShape: { status: 'string', code: 'string', message: 'string' }, json: (j) => { if (j.status !== 'error' || j.code !== 'E5000' || !/DeleteTemplate API call failed/.test(j.message) || !/TemplateNotFound/.test(j.message) || !/404/.test(j.message)) throw new Error('missing-template delete did not preserve the official API diagnostic'); } },
    {
      id: 'create-missing-template', title: 'standard detached create of an unknown template reports a definitive template rejection',
      async run(ctx) {
        const attempt = ctx.beginCreateAttempt('create-missing-template');
        const result = await ctx.abx(["--json", "deploy", "--name", "e2e-missing-template", "--template-id", 'no-such-template-e2e-xyz', "--yes"]);
        const id = result.rawJson()?.sandbox_id;
        if (isExpressSandboxId(id)) { ctx.track(id); ctx.resolveCreateAttempt(attempt); ctx.fail('negative create unexpectedly returned a created sandbox identity'); }
        const rejected = result.code === 4 && result.rawJson()?.code === 'E2001' && /template.*(?:not found|not exist)|TemplateNotFound/i.test(result.out);
        if (!isExpressSandboxId(id) && rejected) ctx.resolveCreateAttempt(attempt);
        if (!rejected) ctx.fail('unknown-template create did not produce a definitive template-not-found rejection');
      },
    },
    {
      id: 'create-missing-template-json', title: 'explicit native create rejects an unknown template while retaining any unexpected created ID',
      async run(ctx) {
        const attempt = ctx.beginCreateAttempt('create-missing-template-json');
        const result = await ctx.abx(['--json', "deploy", '--name', 'e2e-missing-template-json', "--template-id", 'no-such-template-e2e-xyz', "--yes"]);
        const body = result.rawJson();
        const id = body?.sandbox_id;
        if (isExpressSandboxId(id)) { ctx.track(id); ctx.resolveCreateAttempt(attempt); ctx.fail('negative create unexpectedly returned a created sandbox identity'); }
        const rejected = result.code === 4 && body?.status === 'error' && body.code === 'E2001' && /template.*(?:not found|not exist)|TemplateNotFound/i.test(body.message);
        if (!isExpressSandboxId(id) && rejected) ctx.resolveCreateAttempt(attempt);
        if (!rejected) ctx.fail('native unknown-template create did not produce its definitive E2001 rejection');
      },
    },
    { id: 'info-missing-sandbox', title: 'standard info of an unknown sandbox exits 1 with not-found text', argv: ['--json', 'status', 'sbx-00000000-0000-0000-0000-000000000000'], exit: 4, output: /E2009/ },
    {
      id: 'info-missing-sandbox-json', title: 'info unknown sandbox explicit native JSON envelope', argv: ['--json', "status", 'sbx-00000000-0000-0000-0000-000000000000'], exit: 4,
      jsonShape: { status: 'string', message: 'string', code: 'string', suggestion: 'string' }, json: (j) => { if (j.status !== 'error') throw new Error('status must be "error"'); },
    },
    { id: 'exec-missing-sandbox', title: 'standard exec in an unknown sandbox preserves not-found failure', argv: ["sandbox", 'exec', 'sbx-00000000-0000-0000-0000-000000000000', 'echo hi'], exit: 1, output: /404|not found/i },
    { id: 'kill-missing-sandbox', title: 'kill of an unknown sandbox is idempotent', argv: ['--json', 'delete', 'sbx-00000000-0000-0000-0000-000000000000', '--yes'], exit: 0, output: /deleted/ },
    { id: 'files-missing-sandbox', title: 'sandbox files list in unknown sandbox: non-zero', argv: ['sandbox', 'files', 'list', 'sbx-00000000-0000-0000-0000-000000000000', '--path', '/tmp'], exit: 'nonzero' },
    // Standard --all acts immediately. Never run it against unrelated account resources.

  ],
};

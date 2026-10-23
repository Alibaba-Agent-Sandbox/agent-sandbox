// Real-cloud sandbox lifecycle: create -> list/info -> exec -> files -> process -> system -> server -> kill.
// One sandbox is shared by the suite; everything created is tracked and destroyed in cleanup().
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { configureExpressScenario, trackDetachedCreate, isExpressSandboxId, readProcessInventory } from '../lib/express-scenarios.mjs';

const TEMPLATE = process.env.ABX_E2E_TEMPLATE || 'python-hello';
const sid = (ctx) => ctx.state.id;
const sha = (b) => createHash('sha256').update(b).digest('hex');

export default {
  id: 'cloud-lifecycle',
  title: `Real cloud: sandbox lifecycle on template "${TEMPLATE}"`,
  needs: ['cloud'],
  setup: configureExpressScenario,
  scenarios: [
    {
      id: 'create-json', title: 'standard detached create returns an owned ID; info confirms its running template', timeoutMs: 180_000,
      async run(ctx) {
        const attempt = ctx.beginCreateAttempt('create-json');
        const r = await ctx.abx(['create', TEMPLATE, '--detach', '--timeout', '900'], { timeoutMs: 180_000 });
        const id = trackDetachedCreate(ctx, r, attempt);
        ctx.state.id = id;
        const info = await ctx.abx(['info', id, '--format', 'json']);
        const j = info.rawJson();
        if (info.code !== 0 || j?.sandboxId !== id || j.state !== 'running' || !j.templateId || !j.envdVersion) ctx.fail('created sandbox info did not confirm its identity and running state');
        ctx.state.templateId = j.templateId;
      },
    },
    {
      id: 'list-contains-sandbox', title: 'standard list JSON contains the owned running sandbox and its template identity', requires: ['create-json'],
      async run(ctx) {
        await ctx.eventually(async () => {
          const r = await ctx.abx(['list', '--format', 'json']);
          const j = r.rawJson();
          const mine = Array.isArray(j) && j.find((s) => s.sandboxId === sid(ctx));
          if (r.code !== 0 || !mine) ctx.fail('new sandbox not yet listed');
          if (mine.templateId !== ctx.state.templateId || mine.state !== 'running' || !mine.envdVersion) ctx.fail(`bad entry ${JSON.stringify(mine)}`);
        }, { timeoutMs: 30_000, what: 'sandbox to appear in list' });
      },
    },
    {
      id: 'list-filter-running', title: 'list --state running includes it', requires: ['create-json'],
      async run(ctx) {
        const r = await ctx.abx(['list', '--state', 'running', '--format', 'json']);
        const j = r.rawJson();
        if (r.code !== 0 || !Array.isArray(j) || !j.some((s) => s.sandboxId === sid(ctx))) ctx.fail('running sandbox missing from filtered list');
      },
    },
    {
      id: 'info-text', title: 'standard info uses the pinned field labels', requires: ['create-json'], argv: (ctx) => ['info', sid(ctx)],
      stdout: ['Sandbox ID', 'Template ID', 'State', 'running', 'Envd version'],
    },
    {
      id: 'info-json', title: 'standard info --format json shape', requires: ['create-json'], argv: (ctx) => ['info', sid(ctx), '--format', 'json'],
      jsonShape: { sandboxId: 'string', templateId: 'string', state: 'string', startedAt: 'string', endAt: 'string', envdVersion: 'string' },
      json: (j, ctx, res) => { const actual = res.rawJson(); if (actual.sandboxId !== sid(ctx) || actual.templateId !== ctx.state.templateId) throw new Error('sandbox/template identity mismatch'); if (j.state !== 'running') throw new Error(`State ${j.state}`); },
    },

    // ---- exec ---------------------------------------------------------------------------------------
    { id: 'exec-basic', title: 'exec prints stdout, exit 0', requires: ['create-json'], retries: 2, retryReason: 'first exec after create can race envd start-up', argv: (ctx) => ['exec', sid(ctx), 'echo hello-e2e'], stdout: /^hello-e2e$/m },
    { id: 'exec-exit-code-propagates', title: 'exec propagates remote exit code (3), shows stdout+stderr', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), 'echo out-line; echo err-line >&2; exit 3'], exit: 3, output: ['out-line', 'err-line'] },
    {
      id: 'exec-json', title: 'native exec --json: {stdout,stderr,exit_code,execution_time}', requires: ['create-json'], argv: (ctx) => ['--native', '--json', 'exec', sid(ctx), 'echo json-out; echo json-err >&2'],
      jsonShape: { stdout: 'string', stderr: 'string', exit_code: 'number', execution_time: 'number' },
      json: (j) => { if (j.stdout !== 'json-out\n' || j.stderr !== 'json-err\n' || j.exit_code !== 0) throw new Error(`unexpected ${JSON.stringify(j)}`); },
    },
    {
      id: 'exec-json-nonzero-exit', title: 'native exec --json with failing command exits with that code and reports exit_code', requires: ['create-json'], argv: (ctx) => ['--native', '--json', 'exec', sid(ctx), 'echo x; exit 7'], exit: 7,
      jsonShape: { exit_code: 'number' }, json: (j) => { if (j.exit_code !== 7) throw new Error(`exit_code ${j.exit_code}`); },
    },
    { id: 'exec-cwd', title: 'exec --cwd changes the working directory', requires: ['create-json'], argv: (ctx) => ['exec', '--cwd', '/tmp', sid(ctx), 'pwd'], stdout: /^\/tmp$/m },
    { id: 'exec-quoting', title: 'exec keeps shell quoting/pipes intact', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), `echo 'a b' "c d" | tr a-z A-Z`], stdout: /^A B C D$/m },
    { id: 'exec-unicode', title: 'exec round-trips UTF-8 output', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), 'echo 你好-é'], stdout: '你好-é' },
    { id: 'exec-quiet', title: 'native exec -q prints the bare output (no decorations)', requires: ['create-json'], argv: (ctx) => ['--native', '-q', 'exec', sid(ctx), 'echo quiet-out'], stdout: /^quiet-out$/m },
    {
      id: 'exec-ci-mode', title: 'native --ci switches to JSON output', requires: ['create-json'], argv: (ctx) => ['--native', '--ci', 'exec', sid(ctx), 'echo ci-out'],
      jsonShape: { stdout: 'string', exit_code: 'number' }, json: (j) => { if (j.stdout !== 'ci-out\n') throw new Error(`stdout ${JSON.stringify(j.stdout)}`); },
    },
    {
      id: 'exec-ci-env-var', title: 'standard exec keeps plain stdout under CI=true', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), 'echo ci-env'], env: { CI: 'true' },
      stdout: /^ci-env$/m,
    },
    {
      id: 'exec-timeout', title: 'standard exec rejects a local timeout option absent from the pinned CLI', requires: ['create-json'], timeoutMs: 240_000,
      argv: (ctx) => ['exec', '--timeout', '2', sid(ctx), 'true'], exit: 1, output: "unknown option '--timeout'",
    },

    // ---- upload / download ----------------------------------------------------------------------------
    {
      id: 'upload-download-binary-roundtrip', title: 'upload a 100 KB binary file then download it: identical sha256', requires: ['create-json'],
      async run(ctx) {
        const local = join(ctx.cwd, 'blob.bin');
        const back = join(ctx.cwd, 'blob.back');
        const data = randomBytes(100 * 1024);
        writeFileSync(local, data);
        let r = await ctx.abx(['upload', sid(ctx), 'blob.bin', '/tmp/e2e/blob.bin']);
        if (r.code !== 0) ctx.fail(`upload exit ${r.code}\n${r.out}`);
        ctx.check('upload', r.stdout, 'Uploaded');
        r = await ctx.abx(['exec', sid(ctx), 'sha256sum /tmp/e2e/blob.bin']);
        ctx.check('remote sha', r.stdout, sha(data));
        r = await ctx.abx(['download', sid(ctx), '/tmp/e2e/blob.bin', 'blob.back']);
        if (r.code !== 0) ctx.fail(`download exit ${r.code}\n${r.out}`);
        ctx.check('download', r.stdout, 'Downloaded');
        if (sha(readFileSync(back)) !== sha(data)) ctx.fail('downloaded bytes differ from uploaded bytes');
      },
    },
    {
      id: 'upload-json', title: 'upload --json: {status:"success",message}', requires: ['create-json'],
      async run(ctx) {
        writeFileSync(join(ctx.cwd, 'a.txt'), 'hello e2e\n');
        const r = await ctx.abx(['--json', 'upload', sid(ctx), 'a.txt', '/tmp/e2e/a.txt']);
        if (r.code !== 0) ctx.fail(`exit ${r.code}\n${r.out}`);
        const j = ctx.parseJsonLoose(r.stdout);
        if (j?.status !== 'success' || !/Uploaded/.test(j.message)) ctx.fail(`envelope ${JSON.stringify(j)}`);
      },
    },
    {
      id: 'upload-directory', title: 'upload DIR REMOTE_DIR/ uploads every file', requires: ['create-json'],
      async run(ctx) {
        mkdirSync(join(ctx.cwd, 'updir'), { recursive: true });
        writeFileSync(join(ctx.cwd, 'updir', 'one.txt'), '1\n');
        writeFileSync(join(ctx.cwd, 'updir', 'two.txt'), '2\n');
        const r = await ctx.abx(['upload', sid(ctx), 'updir', '/tmp/e2e/dir/']);
        if (r.code !== 0) ctx.fail(`exit ${r.code}\n${r.out}`);
        ctx.check('msg', r.stdout, /Uploaded 2 files/);
        const ls = await ctx.abx(['exec', sid(ctx), 'cat /tmp/e2e/dir/one.txt /tmp/e2e/dir/two.txt']);
        ctx.check('content', ls.stdout, /1\n2/);
      },
    },
    {
      id: 'download-json', title: 'download --json writes the file and reports success', requires: ['upload-json'],
      async run(ctx) {
        const r = await ctx.abx(['--json', 'download', sid(ctx), '/tmp/e2e/a.txt', 'dl.txt']);
        if (r.code !== 0) ctx.fail(`exit ${r.code}\n${r.out}`);
        if (readFileSync(join(ctx.cwd, 'dl.txt'), 'utf8') !== 'hello e2e\n') ctx.fail('content mismatch');
        if (ctx.parseJsonLoose(r.stdout)?.status !== 'success') ctx.fail('no success envelope');
      },
    },
    { id: 'download-missing-remote', title: 'download of a missing remote file: exit 4 (404 originally, E4001 after the KI-005 fix)', requires: ['create-json'], argv: (ctx) => ['download', sid(ctx), '/tmp/e2e/missing.txt', 'nope.txt'], exit: 4, output: /404|E4001/ },

    // ---- sandbox files ---------------------------------------------------------------------------------
    {
      id: 'files-list-json', title: 'sandbox files list --json: [{name,type,size}]', requires: ['upload-json'], argv: (ctx) => ['--json', 'sandbox', 'files', 'list', sid(ctx), '--path', '/tmp/e2e'],
      jsonShape: [{ name: 'string', type: 'string', size: 'number' }],
      json: (j) => { if (!j.some((e) => e.name === 'a.txt' && e.size === 10)) throw new Error('a.txt (10 bytes) missing from listing'); },
    },
    { id: 'files-list-text', title: 'sandbox files list prints Name/Type/Size', requires: ['upload-json'], argv: (ctx) => ['sandbox', 'files', 'list', sid(ctx), '--path', '/tmp/e2e'], stdout: ['Name', 'Type', 'Size', 'a.txt'] },
    {
      id: 'files-stat-json', title: 'sandbox files stat --json exposes Name/Path/Type/Size keys (values are template-dependent)', requires: ['upload-json'], argv: (ctx) => ['--json', 'sandbox', 'files', 'stat', sid(ctx), '--path', '/tmp/e2e/a.txt'],
      jsonShape: { Name: 'string', Path: 'string', Type: 'string', Size: 'string|number' },
    },
    { id: 'files-stat-missing', title: 'sandbox files stat of a missing path: exit 4 (404 originally, E4001 after the KI-005 fix)', requires: ['create-json'], argv: (ctx) => ['sandbox', 'files', 'stat', sid(ctx), '--path', '/tmp/e2e/zzz-missing'], exit: 4, output: /404|E4001/ },
    { id: 'files-mkdir', title: 'sandbox files mkdir creates nested dirs', requires: ['create-json'], argv: (ctx) => ['sandbox', 'files', 'mkdir', sid(ctx), '--path', '/tmp/e2e/m/n/o'], stdout: 'Directory created: /tmp/e2e/m/n/o' },
    {
      id: 'files-mv', title: 'sandbox files mv moves a file', requires: ['upload-json', 'files-mkdir'], argv: (ctx) => ['sandbox', 'files', 'mv', sid(ctx), '--source', '/tmp/e2e/a.txt', '--dest', '/tmp/e2e/m/moved.txt'],
      stdout: 'Moved: /tmp/e2e/a.txt -> /tmp/e2e/m/moved.txt',
      async after(ctx) { const r = await ctx.abx(['exec', sid(ctx), 'test ! -e /tmp/e2e/a.txt && cat /tmp/e2e/m/moved.txt']); ctx.check('moved', r.stdout, 'hello e2e'); },
    },
    {
      id: 'files-search', title: 'sandbox files search --pattern finds files (order-insensitive)', requires: ['files-mv'], argv: (ctx) => ['sandbox', 'files', 'search', sid(ctx), '--path', '/tmp/e2e', '--pattern', '*.txt'],
      stdout: ['/tmp/e2e/m/moved.txt', '/tmp/e2e/dir/one.txt', /Found \d+ file\(s\)\./],
    },
    { id: 'files-rm-needs-confirmation', title: 'sandbox files rm without --yes and answer "n" aborts (exit 1) and keeps the file', requires: ['files-mv'], stdin: 'n\n', argv: (ctx) => ['sandbox', 'files', 'rm', sid(ctx), '--path', '/tmp/e2e/m/moved.txt'], exit: 1, output: /Aborted|\[y\/N\]/,
      async after(ctx) { const r = await ctx.abx(['exec', sid(ctx), 'test -e /tmp/e2e/m/moved.txt && echo still-there']); ctx.check('kept', r.stdout, 'still-there'); } },
    {
      id: 'files-rm-yes', title: 'sandbox files rm --yes deletes', requires: ['files-mv'], argv: (ctx) => ['sandbox', 'files', 'rm', sid(ctx), '--path', '/tmp/e2e/m/moved.txt', '--yes'], stdout: 'Deleted: /tmp/e2e/m/moved.txt',
      async after(ctx) { const r = await ctx.abx(['exec', sid(ctx), 'test -e /tmp/e2e/m/moved.txt || echo gone']); ctx.check('deleted', r.stdout, 'gone'); },
    },

    // ---- process -----------------------------------------------------------------------------------------
    { id: 'exec-background-prints-pid', title: 'exec --background prints a numeric pid and returns before the command ends', requires: ['create-json'], argv: (ctx) => ['exec', '--background', sid(ctx), 'sleep', '30'], stderr: /^\d+$/m, timeoutMs: 60_000,
      async after(ctx) { const r = await ctx.abx(['sandbox', 'process', 'list', sid(ctx)]); ctx.check('listed', r.out, /sleep/); } },
    {
      id: 'exec-background-json', title: 'explicit native background JSON contains a backend-issued pid', requires: ['create-json'], argv: (ctx) => ['--native', '--json', 'exec', '--background', sid(ctx), '--', 'sleep', '5'],
      jsonShape: { pid: 'number|string' },
      json: (j) => { if (typeof j.pid === 'number' ? !Number.isSafeInteger(j.pid) || j.pid <= 0 : !j.pid.trim()) throw new Error('invalid backend process ID'); },
    },
    { id: 'exec-env-and-cwd', title: 'exec --env KEY=VAL --cwd DIR reaches the command', requires: ['create-json'], argv: (ctx) => ['exec', '--env', 'E2E_X=42', '--cwd', '/tmp', sid(ctx), 'sh', '-c', 'echo $E2E_X; pwd'], stdout: [/^42$/m, /^\/tmp$/m] },
    { id: 'exec-exit-code-argv', title: 'exec -- CMD... propagates the remote exit code', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), 'sh', '-c', 'echo started; exit 2'], exit: 2, output: 'started' },
    { id: 'process-list', title: 'sandbox process list exits 0 (table or "No processes found.")', requires: ['create-json'], argv: (ctx) => ['sandbox', 'process', 'list', sid(ctx)], output: /PID|No processes found\./ },
    {
      id: 'process-info-owned', title: 'process info inspects a process started by this run', requires: ['create-json'],
      async run(ctx) {
        const started = await ctx.abx(['exec', '--background', sid(ctx), 'sleep', '60']);
        const pid = started.stderr.match(/^\d+$/m)?.[0];
        if (started.code !== 0 || !pid) ctx.fail('background command did not return a PID');
        try {
          const info = await ctx.abx(['sandbox', 'process', 'info', sid(ctx), pid]);
          if (info.code !== 0) ctx.fail(`owned process inspection failed: ${info.out}`);
          ctx.check('owned process', info.stdout, ['PID', 'Command', pid]);
        } finally {
          await ctx.abx(['sandbox', 'process', 'signal', sid(ctx), pid, '--signal', '15']);
        }
      },
    },
    {
      id: 'process-signal', title: 'signal terminates a process started by this run', requires: ['create-json'],
      async run(ctx) {
        const started = await ctx.abx(['exec', '--background', sid(ctx), 'sleep', '120']);
        const pid = started.stderr.match(/^\d+$/m)?.[0];
        if (started.code !== 0 || !pid) ctx.fail('background command did not return a PID');
        let ended = false;
        try {
          await ctx.eventually(async () => {
            const before = await ctx.abx(['--json', 'sandbox', 'process', 'list', sid(ctx)]);
            const processes = readProcessInventory(ctx, before);
            if (before.code !== 0 || !Array.isArray(processes) || !processes.some((p) => String(p.pid) === pid)) ctx.fail('owned process was not visible before signalling');
          }, { timeoutMs: 30_000, what: 'owned process to appear' });
          const sent = await ctx.abx(['sandbox', 'process', 'signal', sid(ctx), pid, '--signal', '15']);
          if (sent.code !== 0) ctx.fail(`signal failed: ${sent.out}`);
          ctx.check('signal acknowledgement', sent.stdout, `Signal 15 sent to process ${pid}.`);
          await ctx.eventually(async () => {
            const listed = await ctx.abx(['--json', 'sandbox', 'process', 'list', sid(ctx)]);
            const processes = readProcessInventory(ctx, listed);
            if (listed.code !== 0) ctx.fail('could not inspect owned process termination');
            if (processes.some((p) => String(p.pid) === pid)) ctx.fail('signalled process is still running');
          }, { timeoutMs: 30_000, what: 'owned process to terminate' });
          ended = true;
        } finally {
          if (!ended) await ctx.abx(['sandbox', 'process', 'signal', sid(ctx), pid, '--signal', '9']);
        }
      },
    },
    {
      id: 'exec-stream', title: 'standard exec streams output and propagates the exit code', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), 'sh', '-c', 'echo s1; echo s2; exit 3'], stdout: [/^s1$/m, /^s2$/m], exit: 3,
    },
    // Real interactive connect/create require a local PTY; covered by e2e/standard.mjs.

    // ---- system / capabilities -----------------------------------------------------------------------------
    { id: 'system-info', title: 'sandbox system info: OS/Arch/Hostname/CPU_Count', requires: ['create-json'], argv: (ctx) => ['sandbox', 'system', 'info', sid(ctx)], stdout: ['OS', 'Linux', 'Arch', 'Hostname', 'CPU_Count'] },
    {
      id: 'system-info-json', title: 'sandbox system info --json', requires: ['create-json'], argv: (ctx) => ['--json', 'sandbox', 'system', 'info', sid(ctx)], jsonShape: { OS: 'string', Arch: 'string', Hostname: 'string' },
      json: (j) => { if (j.OS !== 'Linux') throw new Error(`OS ${j.OS}`); },
    },
    {
      id: 'system-env-filter', title: 'sandbox system env --filter returns only the requested vars', requires: ['create-json'], argv: (ctx) => ['--json', 'sandbox', 'system', 'env', sid(ctx), '--filter', 'HOME,PATH'], jsonShape: { variables: 'object' },
      json: (j) => { const k = Object.keys(j.variables).sort().join(','); if (k !== 'HOME,PATH') throw new Error(`variables: ${k}`); },
    },
    {
      id: 'system-ports', title: 'system ports succeeds or reports the exact missing-tools condition', requires: ['create-json'],
      async run(ctx) {
        const result = await ctx.abx(['sandbox', 'system', 'ports', sid(ctx)]);
        if (result.code !== 0 && !(result.code === 1 && result.out.includes('Cannot determine listening ports (ss/netstat not available).'))) ctx.fail('system ports failed without its documented missing-tools condition');
      },
    },
    {
      id: 'system-metrics', title: 'sandbox system metrics returns structured CPU and disk measurements', requires: ['create-json'], argv: (ctx) => ['--json', 'sandbox', 'system', 'metrics', sid(ctx)],
      jsonShape: { cpu_load_1m: 'number', cpu_load_5m: 'number', cpu_load_15m: 'number', disk_total_gb: 'number', disk_used_gb: 'number', disk_free_gb: 'number' },
      json: (j) => {
        for (const field of ['cpu_load_1m', 'cpu_load_5m', 'cpu_load_15m', 'disk_total_gb', 'disk_used_gb', 'disk_free_gb']) if (!Number.isFinite(j[field]) || j[field] < 0) throw new Error(`invalid metric ${field}`);
        if (j.disk_total_gb <= 0 || j.disk_used_gb > j.disk_total_gb + 0.03 || j.disk_free_gb > j.disk_total_gb + 0.03 || j.disk_used_gb + j.disk_free_gb > j.disk_total_gb + 0.03) throw new Error('disk measurements exceed the total capacity');
      },
    },
    {
      id: 'system-packages', title: 'Python fixture reports a real nonempty pip package inventory', requires: ['create-json'],
      async run(ctx) {
        const result = await ctx.abx(['--json', 'sandbox', 'system', 'packages', sid(ctx)]);
        const inventory = result.rawJson();
        if (result.code !== 0 || inventory?.manager !== 'pip' || !Array.isArray(inventory.packages) || !inventory.packages.length || inventory.packages.some((item) => typeof item?.name !== 'string' || !item.name.trim() || typeof item.version !== 'string' || !item.version.trim())) ctx.fail('Python package inventory did not confirm the documented pip result');
      },
    },
    {
      id: 'capabilities-json', title: 'managed Express capability discovery declares no inferred shell/files baseline', requires: ['create-json'], argv: (ctx) => ['--json', 'sandbox', 'capabilities', sid(ctx)], jsonShape: { capabilities: ['string'] },
      json: (j) => { if (j.capabilities.length !== 0) throw new Error('managed connection inferred undeclared capability groups'); },
    },
    { id: 'capabilities-text', title: 'managed Express discovery text accurately reports no declared groups', requires: ['create-json'], argv: (ctx) => ['sandbox', 'capabilities', sid(ctx)], stdout: 'No capabilities declared.' },

    // ---- in-sandbox server + named commands ---------------------------------------------------------------
    {
      id: 'run-named-command', title: 'deployed template serves current app protocol; `sandbox command list`, `run hello`, --arg and --json-args work; unknown command exits 2 (E3005)', requires: ['create-json'], timeoutMs: 180_000,
      async run(ctx) {
        // A supplied start command is the selected manifest's exact startup:exec contract.
        // Without it, this scenario requires an already serving application.
        const startup = process.env.ABX_E2E_APP_START_COMMAND;
        const uploadSource = process.env.ABX_E2E_APP_UPLOAD_SOURCE;
        const uploadDest = process.env.ABX_E2E_APP_UPLOAD_DEST;
        if (uploadSource !== undefined || uploadDest !== undefined) {
          if (!uploadSource?.trim() || !uploadDest?.trim() || !startup?.trim()) ctx.fail('application fixture upload requires source, destination and an explicit startup command');
          const uploaded = await ctx.abx(['upload', sid(ctx), uploadSource, uploadDest]);
          if (uploaded.code !== 0) ctx.fail('application fixture upload failed; startup was not attempted');
        }
        let startupPid;
        if (startup !== undefined) {
          if (!startup.trim()) ctx.fail('ABX_E2E_APP_START_COMMAND must be an explicit nonempty command');
          const started = await ctx.abx(['exec', '--background', sid(ctx), startup]);
          startupPid = started.stderr.match(/^[1-9]\d*$/m)?.[0];
          if (started.code !== 0 || !startupPid) ctx.fail('application startup did not return a real backend process ID');
        }
        const confirmStartup = async () => {
          if (!startupPid) return;
          const listed = await ctx.abx(['--json', 'sandbox', 'process', 'list', sid(ctx)]);
          const processes = readProcessInventory(ctx, listed);
          if (listed.code !== 0 || !Array.isArray(processes) || !processes.some((item) => String(item.pid) === startupPid)) ctx.fail('the explicitly started application process is not running');
        };
        let r;
        await ctx.eventually(async () => {
          await confirmStartup();
          const catalog = await ctx.abx(['--json', 'sandbox', 'command', 'list', sid(ctx)]);
          const commands = catalog.rawJson();
          if (catalog.code !== 0 || !Array.isArray(commands) || !commands.some((command) => command.name === 'hello')) ctx.fail(`deployed ${TEMPLATE} must expose protocol v2 and hello on port 9000: ${catalog.out.slice(0, 200)}`);
        }, { timeoutMs: 60_000, intervalMs: 3_000, what: 'deployed protocol-v2 command catalog' });
        await confirmStartup();
        r = await ctx.abx(['run', sid(ctx), 'hello']);
        if (r.code !== 0) ctx.fail(`run hello failed: ${r.out}`);
        ctx.check('hello', r.stdout, 'Hello, World!');
        r = await ctx.abx(['run', sid(ctx), 'hello', '--arg', 'name=Bob']);
        if (r.code !== 0) ctx.fail(`run hello --arg failed: ${r.out}`);
        ctx.check('--arg', r.stdout, 'Hello, Bob!');
        r = await ctx.abx(['--json', 'run', sid(ctx), 'hello', '--json-args', '{"name": "Zed"}']);
        const j = ctx.parseJsonLoose(r.stdout);
        if (r.code !== 0) ctx.fail('named command JSON call failed');
        if (j?.result !== 'Hello, Zed!') ctx.fail(`--json-args json: ${JSON.stringify(j)}`);
        r = await ctx.abx(['sandbox', 'command', 'list', sid(ctx)]);
        if (r.code !== 0) ctx.fail('command list failed');
        ctx.check('command list', r.out, 'hello');
        r = await ctx.abx(['run', sid(ctx), 'no-such-command-e2e']);
        if (r.code !== 2) ctx.fail(`unknown command exit ${r.code}, expected 2`);
        ctx.check('E3005', r.out, ['E3005', 'not found']);
      },
    },

    // ---- second sandbox: env injection + upload at create ----------------------------------------------------
    {
      id: 'create-with-env-and-upload', title: 'explicit native create injects sandbox env vars and uploads files', timeoutMs: 180_000,
      async run(ctx) {
        mkdirSync(join(ctx.cwd, 'seed'), { recursive: true });
        writeFileSync(join(ctx.cwd, 'seed', 'seed.txt'), 'seeded\n');
        const attempt = ctx.beginCreateAttempt('create-with-env-and-upload');
        const r = await ctx.abx(['--native', '--json', 'create', '--template', TEMPLATE, '-e', 'E2E_FOO=bar', '-e', 'E2E_N=1', '--upload', 'seed', '--timeout', '600']);
        const id = r.rawJson()?.ID;
        if (isExpressSandboxId(id)) { ctx.track(id); ctx.resolveCreateAttempt(attempt); }
        if (r.code !== 0 || !isExpressSandboxId(id)) ctx.fail('native create did not return a valid owned sandbox identity');
        ctx.state.id2 = id;
        const x = await ctx.abx(['exec', id, 'printenv E2E_FOO E2E_N; cat /home/user/seed.txt || cat /home/user/seed/seed.txt']);
        if (x.code !== 0) ctx.fail('created sandbox env/file verification failed');
        ctx.check('env+file', x.stdout, ['bar', '1', 'seeded']);
        const k = await ctx.abx(['kill', id]);
        if (k.code !== 0) ctx.fail(`kill exit ${k.code}`);
        const absent = await ctx.abx(['info', id, '--format', 'json']);
        if (absent.code !== 1 || !/wasn't found/i.test(absent.out)) ctx.fail('second sandbox deletion was not confirmed');
        const inventory = await ctx.abx(['list', '--format', 'json']);
        const remaining = inventory.rawJson();
        if (inventory.code !== 0 || !Array.isArray(remaining) || remaining.some((s) => s.sandboxId === id)) ctx.fail('second sandbox absence was not confirmed in the inventory');
        ctx.untrack(id);
      },
    },

    // ---- kill ----------------------------------------------------------------------------------------------------
    // Standard kill has no confirmation flag; never exercise account-wide kill here.
    {
      id: 'kill-yes-json', title: 'standard kill succeeds; info and list confirm the owned sandbox is gone', requires: ['create-json'], argv: (ctx) => ['kill', sid(ctx)],
      stdout: /has been killed/,
      async after(ctx) {
        await ctx.eventually(async () => {
          const r = await ctx.abx(['info', sid(ctx), '--format', 'json']);
          if (r.code !== 1 || !/wasn't found/i.test(r.out)) ctx.fail('info did not confirm the owned sandbox is absent');
        }, { timeoutMs: 30_000, what: 'sandbox to disappear' });
        const l = await ctx.abx(['list', '--format', 'json']);
        const j = l.rawJson();
        if (l.code !== 0 || !Array.isArray(j)) ctx.fail('post-kill list did not return a JSON array');
        if (j.some((s) => s.sandboxId === sid(ctx))) ctx.fail('killed sandbox still listed');
        ctx.untrack(sid(ctx));
      },
    },
    { id: 'kill-twice', title: 'killing an already-killed sandbox is idempotent', requires: ['kill-yes-json'], argv: (ctx) => ['kill', sid(ctx)], exit: 0, output: /wasn't found/i },
  ],
};

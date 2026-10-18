// Real-cloud sandbox lifecycle: create -> list/info -> exec -> files -> process -> system -> server -> kill.
// One sandbox is shared by the suite; everything created is tracked and destroyed in cleanup().
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';

const TEMPLATE = process.env.ABX_E2E_TEMPLATE || 'python-hello';
const sid = (ctx) => ctx.state.id;
const sha = (b) => createHash('sha256').update(b).digest('hex');

export default {
  id: 'cloud-lifecycle',
  title: `Real cloud: sandbox lifecycle on template "${TEMPLATE}"`,
  needs: ['cloud'],
  scenarios: [
    {
      id: 'create-json', title: 'create --template --json returns {ID,Status,Template,URL,EnvdVersion}', retries: 1, retryReason: 'cold start of a function instance',
      argv: ['--json', 'create', '--template', TEMPLATE, '--timeout', '900'], timeoutMs: 180_000,
      jsonShape: { ID: 'string', Status: 'string', Template: 'string', URL: 'string', EnvdVersion: 'string' },
      json: (j) => {
        if (!/^sbx-/.test(j.ID)) throw new Error(`ID "${j.ID}" does not look like sbx-...`);
        if (j.Status !== 'running') throw new Error(`Status ${j.Status}`);
        if (j.Template !== TEMPLATE) throw new Error(`Template ${j.Template}`);
        if (!/^https:\/\/49983-sbx-/.test(j.URL)) throw new Error(`URL ${j.URL}`);
      },
      after(ctx, res) { const j = res.rawJson(); ctx.state.id = j.ID; ctx.track(j.ID); },
    },
    {
      id: 'list-contains-sandbox', title: 'list --json contains the new sandbox (Status running, Region set)', requires: ['create-json'],
      async run(ctx) {
        await ctx.eventually(async () => {
          const r = await ctx.abx(['--json', 'list']);
          const j = r.rawJson();
          const mine = Array.isArray(j) && j.find((s) => s.ID === sid(ctx));
          if (!mine) ctx.fail('new sandbox not yet listed');
          if (mine.Template !== TEMPLATE || !mine.Region) ctx.fail(`bad entry ${JSON.stringify(mine)}`);
        }, { timeoutMs: 30_000, what: 'sandbox to appear in list' });
      },
    },
    {
      id: 'list-filter-running', title: 'list --status running includes it', requires: ['create-json'],
      async run(ctx) {
        const r = await ctx.abx(['--json', 'list', '--status', 'running']);
        const j = r.rawJson();
        if (!Array.isArray(j) || !j.some((s) => s.ID === sid(ctx))) ctx.fail('running sandbox missing from filtered list');
      },
    },
    {
      id: 'info-text', title: 'info (text): ID/Template/Status/Region/URL/EnvdVersion rows', requires: ['create-json'], argv: (ctx) => ['info', sid(ctx)],
      stdout: ['ID', 'Template', TEMPLATE, 'Status', 'running', 'Region', 'URL', 'https://49983-sbx-', 'EnvdVersion'],
    },
    {
      id: 'info-json', title: 'info --json shape', requires: ['create-json'], argv: (ctx) => ['--json', 'info', sid(ctx)],
      jsonShape: { ID: 'string', Template: 'string', Status: 'string', Region: 'string', URL: 'string', EnvdVersion: 'string' },
      json: (j, ctx, res) => { if (res.rawJson().ID !== sid(ctx)) throw new Error('ID mismatch'); if (j.Status !== 'running') throw new Error(`Status ${j.Status}`); },
    },

    // ---- exec ---------------------------------------------------------------------------------------
    { id: 'exec-basic', title: 'exec prints stdout, exit 0', requires: ['create-json'], retries: 2, retryReason: 'first exec after create can race envd start-up', argv: (ctx) => ['exec', sid(ctx), 'echo hello-e2e'], stdout: /^hello-e2e$/m },
    { id: 'exec-exit-code-propagates', title: 'exec propagates remote exit code (3), shows stdout+stderr', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), 'echo out-line; echo err-line >&2; exit 3'], exit: 3, output: ['out-line', 'err-line'] },
    {
      id: 'exec-json', title: 'exec --json: {stdout,stderr,exit_code,execution_time}', requires: ['create-json'], argv: (ctx) => ['--json', 'exec', sid(ctx), 'echo json-out; echo json-err >&2'],
      jsonShape: { stdout: 'string', stderr: 'string', exit_code: 'number', execution_time: 'number' },
      json: (j) => { if (j.stdout !== 'json-out\n' || j.stderr !== 'json-err\n' || j.exit_code !== 0) throw new Error(`unexpected ${JSON.stringify(j)}`); },
    },
    {
      id: 'exec-json-nonzero-exit', title: 'exec --json with failing command exits with that code and reports exit_code', requires: ['create-json'], argv: (ctx) => ['--json', 'exec', sid(ctx), 'echo x; exit 7'], exit: 7,
      jsonShape: { exit_code: 'number' }, json: (j) => { if (j.exit_code !== 7) throw new Error(`exit_code ${j.exit_code}`); },
    },
    { id: 'exec-cwd', title: 'exec --cwd changes the working directory', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), 'pwd', '--cwd', '/tmp'], stdout: /^\/tmp$/m },
    { id: 'exec-quoting', title: 'exec keeps shell quoting/pipes intact', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), `echo 'a b' "c d" | tr a-z A-Z`], stdout: /^A B C D$/m },
    { id: 'exec-unicode', title: 'exec round-trips UTF-8 output', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), 'echo 你好-é'], stdout: '你好-é' },
    { id: 'exec-quiet', title: 'exec -q prints the bare output (no decorations)', requires: ['create-json'], argv: (ctx) => ['-q', 'exec', sid(ctx), 'echo quiet-out'], stdout: /^quiet-out$/m },
    {
      id: 'exec-ci-mode', title: '--ci switches to JSON output', requires: ['create-json'], argv: (ctx) => ['--ci', 'exec', sid(ctx), 'echo ci-out'],
      jsonShape: { stdout: 'string', exit_code: 'number' }, json: (j) => { if (j.stdout !== 'ci-out\n') throw new Error(`stdout ${JSON.stringify(j.stdout)}`); },
    },
    {
      id: 'exec-ci-env-var', title: 'CI=true in the environment auto-enables JSON mode', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), 'echo ci-env'], env: { CI: 'true' },
      jsonShape: { stdout: 'string', exit_code: 'number' },
    },
    {
      id: 'exec-timeout', title: 'exec --timeout shorter than the command: exit 5, E3001 "timed out"', requires: ['create-json'], timeoutMs: 240_000,
      argv: (ctx) => ['exec', sid(ctx), 'sleep 25', '--timeout', '2'], exit: 5, output: ['E3001', /timed out/i],
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
    { id: 'exec-background-prints-pid', title: 'exec --background prints a numeric pid and returns before the command ends', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), '--background', '--', 'sleep', '30'], stdout: /^\d+$/m, timeoutMs: 60_000,
      async after(ctx) { const r = await ctx.abx(['sandbox', 'process', 'list', sid(ctx)]); ctx.check('listed', r.out, /sleep/); } },
    {
      id: 'exec-background-json', title: 'exec --background --json: {pid}', requires: ['create-json'], argv: (ctx) => ['--json', 'exec', sid(ctx), '--background', '--', 'sleep', '5'],
      jsonShape: { pid: 'number' },
    },
    { id: 'exec-env-and-cwd', title: 'exec --env KEY=VAL --cwd DIR reaches the command', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), '--env', 'E2E_X=42', '--cwd', '/tmp', '--', 'sh', '-c', 'echo $E2E_X; pwd'], stdout: [/^42$/m, /^\/tmp$/m] },
    { id: 'exec-exit-code-argv', title: 'exec -- CMD... propagates the remote exit code', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), '--', 'sh', '-c', 'echo started; exit 2'], exit: 2, output: 'started' },
    { id: 'process-list', title: 'sandbox process list exits 0 (table or "No processes found.")', requires: ['create-json'], argv: (ctx) => ['sandbox', 'process', 'list', sid(ctx)], output: /PID|No processes found\./ },
    { id: 'process-info-pid1', title: 'sandbox process info 1 shows PID/PPID/User/State/Command', requires: ['create-json'], argv: (ctx) => ['sandbox', 'process', 'info', sid(ctx), '1'], stdout: ['PID', 'PPID', 'User', 'State', 'Command'] },
    { id: 'process-signal', title: 'sandbox process signal acknowledges the signal', requires: ['create-json'], argv: (ctx) => ['sandbox', 'process', 'signal', sid(ctx), '99999', '--signal', '15'], stdout: /Signal 15 sent to process 99999\./ },
    {
      id: 'exec-stream', title: 'exec --stream prints lines as they arrive and propagates the exit code', requires: ['create-json'], argv: (ctx) => ['exec', sid(ctx), '--stream', '--', 'sh', '-c', 'echo s1; echo s2; exit 3'], stdout: [/^s1$/m, /^s2$/m], exit: 3,
    },
    {
      id: 'connect-repl', title: 'connect REPL executes piped commands and exits on "exit"', requires: ['create-json'], stdin: 'echo hi-from-repl\nexit\n', argv: (ctx) => ['connect', sid(ctx)], timeoutMs: 120_000,
      stdout: ['Connected to sandbox', 'hi-from-repl'],
    },

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
    { id: 'system-ports', title: 'sandbox system ports exits 0, or 1 with an explanatory message when ss/netstat are missing', requires: ['create-json'], argv: (ctx) => ['sandbox', 'system', 'ports', sid(ctx)], exit: [0, 1] },
    { id: 'system-metrics', title: 'sandbox system metrics returns measured CPU load and filesystem usage', requires: ['create-json'], argv: (ctx) => ['--json', 'sandbox', 'system', 'metrics', sid(ctx)],
      jsonShape: { cpu_load_1m: 'number', cpu_load_5m: 'number', cpu_load_15m: 'number', disk_total_gb: 'number', disk_used_gb: 'number', disk_free_gb: 'number' },
      json: (j) => { for (const key of ['cpu_load_1m', 'cpu_load_5m', 'cpu_load_15m', 'disk_used_gb', 'disk_free_gb']) if (!Number.isFinite(j[key]) || j[key] < 0) throw new Error(`invalid measurement: ${key}`); if (!(j.disk_total_gb > 0)) throw new Error('disk capacity must be positive'); },
    },
    { id: 'system-packages', title: 'sandbox system packages lists installed packages', requires: ['create-json'], argv: (ctx) => ['sandbox', 'system', 'packages', sid(ctx)], exit: [0, 1], output: /Name|packages|pip/i },
    {
      id: 'capabilities-json', title: 'sandbox capabilities --json: {capabilities:[...]} includes shell and files', requires: ['create-json'], argv: (ctx) => ['--json', 'sandbox', 'capabilities', sid(ctx)], jsonShape: { capabilities: ['string'] },
      json: (j) => { for (const c of ['shell', 'files']) if (!j.capabilities.includes(c)) throw new Error(`missing capability ${c}`); },
    },
    { id: 'capabilities-text', title: 'sandbox capabilities (text)', requires: ['create-json'], argv: (ctx) => ['sandbox', 'capabilities', sid(ctx)], stdout: ['Capabilities:', 'shell', 'files'] },

    // ---- in-sandbox server + named commands ---------------------------------------------------------------
    {
      id: 'run-named-command', title: 'start the in-sandbox server; `sandbox command list`, `run hello`, --arg and --json-args work; unknown command exits 2 (E3005)', requires: ['create-json'], timeoutMs: 180_000,
      async run(ctx) {
        let r = await ctx.abx(['exec', sid(ctx), 'nohup python3 /app/commands.py >/tmp/srv.log 2>&1 &']);
        if (r.code !== 0) ctx.fail(`could not start server: ${r.out}`);
        await ctx.eventually(async () => {
          const x = await ctx.abx(['run', sid(ctx), 'hello']);
          if (x.code !== 0) ctx.fail(`run hello exit ${x.code}: ${x.out.slice(0, 200)}`);
          ctx.check('hello', x.stdout, 'Hello, World!');
        }, { timeoutMs: 60_000, intervalMs: 3_000, what: 'server to answer `run hello`' });
        r = await ctx.abx(['run', sid(ctx), 'hello', '--arg', 'name=Bob']);
        ctx.check('--arg', r.stdout, 'Hello, Bob!');
        r = await ctx.abx(['--json', 'run', sid(ctx), 'hello', '--json-args', '{"name": "Zed"}']);
        const j = ctx.parseJsonLoose(r.stdout);
        if (j?.result !== 'Hello, Zed!') ctx.fail(`--json-args json: ${JSON.stringify(j)}`);
        r = await ctx.abx(['sandbox', 'command', 'list', sid(ctx)]);
        ctx.check('command list', r.out, 'hello');
        r = await ctx.abx(['run', sid(ctx), 'no-such-command-e2e']);
        if (r.code !== 2) ctx.fail(`unknown command exit ${r.code}, expected 2`);
        ctx.check('E3005', r.out, ['E3005', 'not found']);
      },
    },

    // ---- second sandbox: env injection + upload at create ----------------------------------------------------
    {
      id: 'create-with-env-and-upload', title: 'create -e KEY=VAL --upload DIR injects env vars and files', timeoutMs: 180_000, retries: 1, retryReason: 'cold start of a function instance',
      async run(ctx) {
        mkdirSync(join(ctx.cwd, 'seed'), { recursive: true });
        writeFileSync(join(ctx.cwd, 'seed', 'seed.txt'), 'seeded\n');
        const r = await ctx.abx(['--json', 'create', '--template', TEMPLATE, '-e', 'E2E_FOO=bar', '-e', 'E2E_N=1', '--upload', 'seed', '--timeout', '600']);
        if (r.code !== 0) ctx.fail(`exit ${r.code}\n${r.out}`);
        const id = r.rawJson().ID;
        ctx.track(id);
        ctx.state.id2 = id;
        const x = await ctx.abx(['exec', id, 'printenv E2E_FOO E2E_N; cat /home/user/seed.txt || cat /home/user/seed/seed.txt']);
        ctx.check('env+file', x.stdout, ['bar', '1', 'seeded']);
        const k = await ctx.abx(['--json', 'kill', id, '--yes']);
        if (k.code !== 0) ctx.fail(`kill exit ${k.code}`);
        ctx.untrack(id);
      },
    },

    // ---- kill ----------------------------------------------------------------------------------------------------
    { id: 'kill-needs-confirmation', title: 'kill without --yes and answer "n": exit 1, sandbox survives', requires: ['create-json'], stdin: 'n\n', argv: (ctx) => ['kill', sid(ctx)], exit: 1, output: /Aborted|\[y\/N\]/,
      async after(ctx) { const r = await ctx.abx(['--json', 'info', sid(ctx)]); if (r.code !== 0) ctx.fail('sandbox must still exist after declined kill'); } },
    {
      id: 'kill-yes-json', title: 'kill --yes --json: success envelope; sandbox is gone', requires: ['create-json'], argv: (ctx) => ['--json', 'kill', sid(ctx), '--yes'],
      jsonShape: { status: 'string', message: 'string' }, json: (j) => { if (j.status !== 'success' || !/killed/i.test(j.message)) throw new Error(JSON.stringify(j)); },
      async after(ctx) {
        ctx.untrack(sid(ctx));
        await ctx.eventually(async () => {
          const r = await ctx.abx(['--json', 'info', sid(ctx)]);
          if (r.code !== 4) ctx.fail(`info after kill exit ${r.code}, expected 4`);
        }, { timeoutMs: 30_000, what: 'sandbox to disappear' });
        const l = await ctx.abx(['--json', 'list']);
        const j = l.rawJson();
        if (Array.isArray(j) && j.some((s) => s.ID === sid(ctx))) ctx.fail('killed sandbox still listed');
      },
    },
    { id: 'kill-twice', title: 'killing an already-killed sandbox is idempotent', requires: ['kill-yes-json'], argv: (ctx) => ['kill', sid(ctx), '--yes'], exit: 0, output: /killed/i },
  ],
};

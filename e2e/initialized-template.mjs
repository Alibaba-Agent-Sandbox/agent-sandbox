#!/usr/bin/env node
/** Real terminal initialization, catalog selection and Express creation. Creates and cleans up one owned sandbox. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { loadCredentials, makeMasker } from "./lib/env.mjs";
import { parseBin } from "./lib/exec.mjs";

assert.ok(!process.argv.includes("--application") && !process.argv.includes("--guided-application"), "Application runtime verification moved to e2e/express-workflow.mjs using the prepared template source run.py");
const credentials = loadCredentials();
const key = credentials.E2B_API_KEY ?? process.env.ABX_SANDBOX_API_KEY;
assert.ok(key, "A Sandbox API key is required for real guided configuration verification");
assert.ok(credentials.E2B_API_URL ?? process.env.ABX_SANDBOX_BASE_URL ?? credentials.E2B_DOMAIN,
  "An explicit Sandbox API target is required for cleanup readback");
const mask = makeMasker(credentials, [key]);
const probe = String.raw`
import contextlib, errno, fcntl, json, os, pty, re, select, shutil, signal, struct, subprocess, sys, tempfile, termios, time, urllib.error, urllib.request
from pathlib import Path

command = json.loads(sys.argv[1])
credential = os.environ['ABX_GUIDED_VERIFICATION_KEY']
trusted = dict(os.environ)
trusted.pop('ABX_GUIDED_VERIFICATION_KEY', None)
trusted['E2B_API_KEY'] = credential
trusted['ABX_SANDBOX_API_KEY'] = credential
child_env = dict(trusted)
for name in list(child_env):
    if name in ('ABX_SERVER_TOKEN', 'CI', 'ABX_CI', 'GITHUB_ACTIONS', 'E2B_API_KEY', 'ABX_SANDBOX_API_KEY', 'ABX_ALICLOUD_EXPRESS_SANDBOX_API_KEY'):
        child_env.pop(name)
child_env.update(NO_COLOR='1', NO_UPDATE_NOTIFIER='1', TERM='dumb')
owned = None
with contextlib.nullcontext(tempfile.mkdtemp(prefix='abx-guided-cloud-')) as home:
    for env in (trusted, child_env):
        env.update(HOME=home, USERPROFILE=home, XDG_CONFIG_HOME=str(Path(home)/'.config'))
    project = Path(home) / 'application'
    initialized = subprocess.run(command + ['template', 'init', str(project), '--template', 'minimal'], env=child_env, cwd=home, stdin=subprocess.DEVNULL, capture_output=True, timeout=45)
    assert initialized.returncode == 0 and (project / 'template.yaml').is_file(), 'editable scaffold initialization failed'
    preview = subprocess.run(command + ['--json', 'deploy', str(project), '--plan'], env=child_env, cwd=home, stdin=subprocess.DEVNULL, capture_output=True, timeout=45)
    assert preview.returncode == 0 and json.loads(preview.stdout)['createsDynamicInstances'] is False, 'source preview must remain preparation-only'
    args = ['--provider', 'alicloud-express', 'sandbox', 'create', '--template', 'base']
    pid, master = pty.fork()
    if pid == 0:
        os.chdir(home)
        os.execvpe(command[0], command + args, child_env)
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 200, 0, 0))
    output = b''
    step = 0
    steps = [(b'Choose an authentication method', b'1\r'), (b'sandbox_api_key (input hidden)', credential.encode() + b'\r')]
    status = None
    try:
        deadline = time.monotonic() + 150
        while time.monotonic() < deadline:
            ready, _, _ = select.select([master], [], [], 0.2)
            if ready:
                try: chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO: break
                    raise
                if not chunk: break
                output += chunk
                if step < len(steps) and steps[step][0] in output:
                    os.write(master, steps[step][1])
                    step += 1
            result, code = os.waitpid(pid, os.WNOHANG)
            if result:
                status = code
                # Drain output before parsing the owned resource ID.
                while select.select([master], [], [], 0)[0]:
                    try: output += os.read(master, 65536)
                    except OSError: break
                break
        else:
            raise AssertionError('initialization timed out at step %d (raw terminal output withheld)' % step)
        if status is None: _, status = os.waitpid(pid, 0)
        clean = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', output).replace(b'\r', b'')
        candidates = list(set(re.findall(rb'\bsbx-[A-Za-z0-9_-]+\b', clean)))
        if os.waitstatus_to_exitcode(status) == 0 and len(candidates) == 1:
            owned = candidates[0].decode()
            (Path(home) / 'owned-instance.json').write_text(json.dumps({'sandbox_id':owned}))
        assert credential.encode() not in output, 'hidden input was echoed'
        if os.waitstatus_to_exitcode(status) != 0:
            safe = clean.decode(errors='replace').replace(credential, '[SECRET]')
            safe = re.sub(r'[a-f0-9]{64}', '[TOKEN]', safe)
            safe = re.sub(r'sbx-[a-zA-Z0-9_-]+', '[OWNED_SANDBOX]', safe)
            print('Terminal failure (sanitized): ' + safe[-1200:], file=sys.stderr)
        assert os.waitstatus_to_exitcode(status) == 0, 'initialization failed at step %d (raw output withheld)' % step
        assert step == len(steps) and owned, 'explicit creation did not continue through configuration'
        saved = list(Path(home).rglob('.env'))
        assert saved, 'initialization did not save configuration'
        text = saved[0].read_text()
        assert credential in text, 'Sandbox API key not saved'
        assert saved[0].stat().st_mode & 0o777 == 0o600, 'saved credentials must be private'
        client_env=dict(trusted)
        for key in ('E2B_API_KEY','ABX_SANDBOX_API_KEY','ABX_ALICLOUD_EXPRESS_SANDBOX_API_KEY'):
            client_env.pop(key,None)
        result = subprocess.run(command + ['sandbox', 'exec', owned, 'printf', 'guided-cloud-ok'], env=client_env, cwd=home, stdin=subprocess.DEVNULL, capture_output=True, timeout=45)
        if result.returncode != 0 or result.stdout != b'guided-cloud-ok':
            diagnostic = (result.stderr + result.stdout).decode(errors='replace').replace(credential, '[REDACTED]').replace(owned, '[OWNED_SANDBOX]')
            print('Remote exec diagnostic (exit %s): %s' % (result.returncode, diagnostic), file=sys.stderr)
        assert result.returncode == 0 and result.stdout == b'guided-cloud-ok', 'created sandbox did not execute'
        print('PASS: editable scaffold, preparation preview, hidden credential persistence, explicit creation and remote exec')
    finally:
        if not owned:
            candidates = list(set(re.findall(rb'\bsbx-[A-Za-z0-9_-]+\b', output)))
            if candidates: owned = candidates[-1].decode()
            if not owned:
                failure = re.search(rb'owned sandbox ([a-zA-Z0-9_-]+)', output)
                if failure: owned = failure[1].decode()
        os.close(master)
        if status is None:
            try: os.kill(pid, signal.SIGTERM)
            except ProcessLookupError: pass
            os.waitpid(pid, 0)
        if owned:
            result = subprocess.run(command + ['sandbox', 'delete', owned, '--yes'], env=trusted, cwd=home, stdin=subprocess.DEVNULL, capture_output=True, timeout=45)
            assert result.returncode == 0, 'owned sandbox cleanup failed'
            api_url = trusted.get('E2B_API_URL') or trusted.get('ABX_SANDBOX_BASE_URL') or 'https://api.' + trusted['E2B_DOMAIN']
            request = urllib.request.Request(api_url.rstrip('/') + '/sandboxes/' + owned, headers={'X-API-Key': credential})
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    raise AssertionError('owned sandbox still exists after kill')
            except urllib.error.HTTPError as error:
                assert error.code == 404, 'cleanup readback did not confirm absence'
            shutil.rmtree(home)
            print('PASS: owned sandbox cleanup independently confirmed by HTTP 404; isolated configuration removed')
        else:
            raise AssertionError('creation outcome unresolved; isolated configuration retained for recovery')
`;
const result = spawnSync("python3", ["-c", probe, JSON.stringify(parseBin(process.env.ABX_BIN ?? "abx")), "initialization"], {
  env: { ...process.env, ...credentials, ABX_GUIDED_VERIFICATION_KEY: key },
  encoding: "utf8", timeout: 250_000, maxBuffer: 1024 * 1024,
});
process.stdout.write(mask(result.stdout ?? ""));
process.stderr.write(mask(result.stderr ?? ""));
if (result.error) process.stderr.write(mask(`${result.error.message}\n`));
process.exitCode = result.status ?? 1;

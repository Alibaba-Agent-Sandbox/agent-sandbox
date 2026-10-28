#!/usr/bin/env node
/** Real terminal initialization, catalog selection and Express creation. Creates and cleans up one owned sandbox. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { loadCredentials, makeMasker } from "./lib/env.mjs";
import { parseBin } from "./lib/exec.mjs";

const credentials = loadCredentials();
const key = credentials.E2B_API_KEY ?? process.env.ABX_SANDBOX_API_KEY;
assert.ok(key, "A Sandbox API key is required for real guided configuration verification");
assert.ok(credentials.E2B_API_URL ?? process.env.ABX_SANDBOX_BASE_URL ?? credentials.E2B_DOMAIN,
  "An explicit Sandbox API target is required for cleanup readback");
const mask = makeMasker(credentials, [key]);
const probe = String.raw`
import errno, fcntl, json, os, pty, re, select, signal, struct, subprocess, sys, tempfile, termios, time, urllib.error, urllib.request
from pathlib import Path

command = json.loads(sys.argv[1])
application = sys.argv[2] in ('application', 'command-only-application')
command_only = sys.argv[2] == 'command-only-application'
credential = os.environ['ABX_GUIDED_VERIFICATION_KEY']
trusted = dict(os.environ)
trusted.pop('ABX_GUIDED_VERIFICATION_KEY', None)
trusted['E2B_API_KEY'] = credential
trusted['ABX_SANDBOX_API_KEY'] = credential
child_env = dict(trusted)
for name in list(child_env):
    if name in ('ABX_SERVER_TOKEN', 'CI', 'ABX_CI', 'GITHUB_ACTIONS') or command_only and name in ('E2B_API_KEY', 'ABX_SANDBOX_API_KEY', 'ALICLOUD_ACCESS_KEY_ID', 'ALICLOUD_ACCESS_KEY_SECRET', 'ABX_ALICLOUD_EXPRESS_ACCESS_KEY_ID', 'ABX_ALICLOUD_EXPRESS_ACCESS_KEY_SECRET') or not application and name in ('E2B_API_KEY', 'ABX_SANDBOX_API_KEY'):
        child_env.pop(name)
child_env.update(NO_COLOR='1', NO_UPDATE_NOTIFIER='1', TERM='dumb')
owned = None
with tempfile.TemporaryDirectory(prefix='abx-guided-cloud-') as home:
    for env in (trusted, child_env):
        env.update(HOME=home, USERPROFILE=home, XDG_CONFIG_HOME=str(Path(home)/'.config'))
    args = ['--provider', 'alicloud-express', 'config', 'init']
    if application:
        project = Path(home) / 'application'
        project.mkdir()
        (project / 'template.yaml').write_text(json.dumps({
            'name': 'onboarding-application', 'spec_version': 5, 'provider': 'alicloud-express', 'template_id': os.environ.get('ABX_ONBOARDING_APPLICATION_TEMPLATE', 'python-hello'),
            'env': {'ABX_SERVER_TOKEN': ''},
            'start_cmd': 'python3 /app/commands.py',
            'ready_cmd': 'python3 -m agent_sandbox.server healthcheck --port 9000',
            'provides': {'app': {'protocol':'agent-sandbox-server','version':2,'port':9000,'operations':['commands.list']}}
        }))
        args = ['--provider', 'alicloud-express', 'template', 'launch', str(project)]
    pid, master = pty.fork()
    if pid == 0:
        os.chdir(home)
        os.execvpe(command[0], command + args, child_env)
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 200, 0, 0))
    output = b''
    step = 0
    steps = [(b'Sandbox API key (input masked', credential.encode() + b'\r'), (b'2/2 Region', b'\r'), (b'What would you like to do next?', b'\r'), (b'Find a template by name or purpose', b'base\r'), (b'Choose a template', b'\r'), (b'Create a billable sandbox', b'y\r')]
    if application:
        steps = [(b'Create a billable sandbox', b'y\r')]
        if command_only:
            steps = [(b'Choose an authentication method', b'1\r'), (b'Configuration scope', b'1\r'), (b'sandbox_api_key (input hidden)', credential.encode() + b'\r')] + steps
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
        candidates = re.findall(rb"['\"]sandbox_id['\"]\s*:\s*['\"]([A-Za-z0-9_-]+)['\"]", clean)
        if os.waitstatus_to_exitcode(status) == 0 and len(candidates) == 1:
            owned = candidates[0].decode()
        assert credential.encode() not in output, 'hidden input was echoed'
        if os.waitstatus_to_exitcode(status) != 0:
            safe = clean.decode(errors='replace').replace(credential, '[SECRET]')
            safe = re.sub(r'[a-f0-9]{64}', '[TOKEN]', safe)
            safe = re.sub(r'sbx-[a-zA-Z0-9_-]+', '[OWNED_SANDBOX]', safe)
            print('Terminal failure (sanitized): ' + safe[-1200:], file=sys.stderr)
        assert os.waitstatus_to_exitcode(status) == 0, 'initialization failed at step %d (raw output withheld)' % step
        assert step == len(steps) and owned, 'initialization did not continue through catalog selection and creation'
        saved = list(Path(home).rglob('.env'))
        assert saved, 'initialization did not save configuration'
        text = saved[0].read_text()
        if not application: assert credential in text, 'Sandbox API key not saved'
        if command_only:
            assert credential not in text, 'command-only platform key was saved'
            assert b'Application access token (ABX_SERVER_TOKEN)' not in output, 'automatic application authentication asked for a token'
            assert saved[0].stat().st_mode & 0o777 == 0o600, 'application credential file is not private'
        token = re.search(r'^ABX_SERVER_TOKEN=[\"\']?([a-f0-9]{64})', text, re.M)
        assert token, 'application token was not generated and saved'
        assert token[1].encode() not in output, 'generated token was printed'
        result = subprocess.run(command + ['sandbox', 'exec', owned, 'printf', 'guided-cloud-ok'], env=trusted, cwd=home, stdin=subprocess.DEVNULL, capture_output=True, timeout=45)
        if result.returncode != 0 or result.stdout != b'guided-cloud-ok':
            diagnostic = (result.stderr + result.stdout).decode(errors='replace').replace(credential, '[REDACTED]').replace(owned, '[OWNED_SANDBOX]')
            print('Remote exec diagnostic (exit %s): %s' % (result.returncode, diagnostic), file=sys.stderr)
        assert result.returncode == 0 and result.stdout == b'guided-cloud-ok', 'created sandbox did not execute'
        if application:
            result = subprocess.run(command + ['sandbox', 'command', 'list', owned], env=trusted, cwd=home, stdin=subprocess.DEVNULL, capture_output=True, timeout=45)
            assert result.returncode == 0, 'subsequent command discovery did not reuse the saved application token'
            result = subprocess.run(command + ['sandbox', 'command', 'run', owned, 'hello', '--arg', 'name=AutoAuth'], env=trusted, cwd=home, stdin=subprocess.DEVNULL, capture_output=True, timeout=45)
            assert result.returncode == 0 and b'Hello, AutoAuth!' in result.stdout, 'authenticated business command did not reuse generated authentication'
            rejected = subprocess.run(command + ['sandbox', 'command', 'list', owned], env={**trusted, 'ABX_SERVER_TOKEN':'placeholder-wrong-application-token'}, cwd=home, stdin=subprocess.DEVNULL, capture_output=True, timeout=45)
            assert rejected.returncode != 0 and b'401' in rejected.stdout + rejected.stderr, 'incorrect application token was not rejected with HTTP401'
            print('PASS: application authentication automatically generated, injected and reused for discovery and real hello command; wrong-token HTTP401 retained')
        else:
            print('PASS: real terminal initialization, saved hidden input, generated application token, catalog selection, creation and remote exec')
    finally:
        if not owned:
            candidates = re.findall(rb"['\"]sandbox_id['\"]\s*:\s*['\"]([A-Za-z0-9_-]+)['\"]", output)
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
            result = subprocess.run(command + ['sandbox', 'kill', owned], env=trusted, cwd=home, stdin=subprocess.DEVNULL, capture_output=True, timeout=45)
            assert result.returncode == 0, 'owned sandbox cleanup failed'
            api_url = trusted.get('E2B_API_URL') or trusted.get('ABX_SANDBOX_BASE_URL') or 'https://api.' + trusted['E2B_DOMAIN']
            request = urllib.request.Request(api_url.rstrip('/') + '/sandboxes/' + owned, headers={'X-API-Key': credential})
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    raise AssertionError('owned sandbox still exists after kill')
            except urllib.error.HTTPError as error:
                assert error.code == 404, 'cleanup readback did not confirm absence'
            print('PASS: owned sandbox cleanup independently confirmed by HTTP 404; isolated configuration removed')
`;
const result = spawnSync("python3", ["-c", probe, JSON.stringify(parseBin(process.env.ABX_BIN ?? "abx")), process.argv.includes("--command-only-application") ? "command-only-application" : process.argv.includes("--application") ? "application" : "initialization"], {
  env: { ...process.env, ...credentials, ABX_GUIDED_VERIFICATION_KEY: key },
  encoding: "utf8", timeout: 250_000, maxBuffer: 1024 * 1024,
});
process.stdout.write(mask(result.stdout ?? ""));
process.stderr.write(mask(result.stderr ?? ""));
if (result.error) process.stderr.write(mask(`${result.error.message}\n`));
process.exitCode = result.status ?? 1;

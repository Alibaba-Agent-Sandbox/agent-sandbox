#!/usr/bin/env node
/** Real terminal + Express configuration continuation. Creates and cleans up one owned sandbox. */
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
credential = os.environ['ABX_GUIDED_VERIFICATION_KEY']
trusted = dict(os.environ)
trusted.pop('ABX_GUIDED_VERIFICATION_KEY', None)
trusted['E2B_API_KEY'] = credential
trusted['ABX_SANDBOX_API_KEY'] = credential
child_env = dict(trusted)
for name in list(child_env):
    if name in ('E2B_API_KEY', 'ABX_SANDBOX_API_KEY', 'CI', 'ABX_CI', 'GITHUB_ACTIONS'):
        child_env.pop(name)
child_env.update(NO_COLOR='1', NO_UPDATE_NOTIFIER='1', TERM='dumb')
owned = None
with tempfile.TemporaryDirectory(prefix='abx-guided-cloud-') as home:
    for env in (trusted, child_env):
        env.update(HOME=home, USERPROFILE=home, XDG_CONFIG_HOME=str(Path(home)/'.config'))
    pid, master = pty.fork()
    if pid == 0:
        os.chdir(home)
        os.execvpe(command[0], command + ['sandbox', 'create', 'code-interpreter-v1', '--detach', '--timeout', '60'], child_env)
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 200, 0, 0))
    output = b''
    scope_sent = key_sent = False
    status = None
    try:
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            ready, _, _ = select.select([master], [], [], 0.2)
            if ready:
                try: chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO: break
                    raise
                if not chunk: break
                output += chunk
                if not scope_sent and b'Configuration scope:' in output:
                    os.write(master, b'1\n')
                    scope_sent = True
                if scope_sent and not key_sent and b'(input hidden); Enter cancels' in output:
                    os.write(master, credential.encode() + b'\n')
                    key_sent = True
            result, code = os.waitpid(pid, os.WNOHANG)
            if result:
                status = code
                # Drain output before parsing the owned resource ID.
                while select.select([master], [], [], 0)[0]:
                    try: output += os.read(master, 65536)
                    except OSError: break
                break
        else:
            raise AssertionError('guided terminal timed out')
        if status is None: _, status = os.waitpid(pid, 0)
        clean = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', output).replace(b'\r', b'')
        candidates = re.findall(rb'^([A-Za-z0-9][A-Za-z0-9_-]{5,})\s*$', clean, re.M)
        if os.waitstatus_to_exitcode(status) == 0 and len(candidates) == 1:
            owned = candidates[0].decode()
        assert credential.encode() not in output, 'hidden input was echoed'
        assert os.waitstatus_to_exitcode(status) == 0, 'guided create failed (raw output withheld)'
        assert scope_sent and key_sent and owned, 'guidance did not complete and return a sandbox ID'
        assert b'Configuration applies only to this command' in clean
        assert not list(Path(home).rglob('config.toml')), 'operation-only setup persisted configuration'
        assert not list(Path(home).rglob('.env')), 'operation-only setup persisted a credential file'
        result = subprocess.run(command + ['sandbox', 'exec', owned, 'printf', 'guided-cloud-ok'], env=trusted, cwd=home, stdin=subprocess.DEVNULL, capture_output=True, timeout=45)
        if result.returncode != 0 or result.stdout != b'guided-cloud-ok':
            diagnostic = (result.stderr + result.stdout).decode(errors='replace').replace(credential, '[REDACTED]').replace(owned, '[OWNED_SANDBOX]')
            print('Remote exec diagnostic (exit %s): %s' % (result.returncode, diagnostic), file=sys.stderr)
        assert result.returncode == 0 and result.stdout == b'guided-cloud-ok', 'created sandbox did not execute'
        print('PASS: real terminal hidden input, operation-only configuration, create continuation and remote exec')
    finally:
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
            print('PASS: owned sandbox cleanup; no credentials persisted')
`;
const result = spawnSync("python3", ["-c", probe, JSON.stringify(parseBin(process.env.ABX_BIN ?? "abx"))], {
  env: { ...process.env, ...credentials, ABX_GUIDED_VERIFICATION_KEY: key },
  encoding: "utf8", timeout: 250_000, maxBuffer: 1024 * 1024,
});
process.stdout.write(mask(result.stdout ?? ""));
process.stderr.write(mask(result.stderr ?? ""));
if (result.error) process.stderr.write(mask(`${result.error.message}\n`));
process.exitCode = result.status ?? 1;

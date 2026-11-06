#!/usr/bin/env node
/** Real Express migration checks. ABX_BIN points to the built standalone executable. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { loadCredentials, makeMasker } from "./lib/env.mjs";
import { parseBin } from "./lib/exec.mjs";
import { observeTerminalExpiry, readNativeObservation, terminalProbeBudget, releaseOwnedSandbox } from "./lib/terminal-expiry.mjs";

const credentials = loadCredentials();
Object.assign(process.env, credentials);
const mask = makeMasker(credentials);
const apiUrl = credentials.E2B_API_URL ?? `https://api.${credentials.E2B_DOMAIN}`;
const started = performance.now(), observationDeadline = started + 210_000, cleanupDeadline = started + 235_000;
const ledgerFile = process.env.ABX_STANDARD_LEDGER;
let ledgerStarted = false;
function record(stage, fields = {}) {
  if (!ledgerFile) return;
  const fd = fs.openSync(ledgerFile, fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW
    | (ledgerStarted ? fs.constants.O_APPEND : fs.constants.O_CREAT | fs.constants.O_EXCL), 0o600);
  try { fs.writeSync(fd, JSON.stringify({at:new Date().toISOString(), stage, ...fields}) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  ledgerStarted = true;
}
function remaining(deadline, cap) {
  const ms = Math.floor(Math.min(cap, deadline - performance.now()));
  assert.ok(ms > 0, 'standard case exhausted its owned cleanup budget');
  return ms;
}

function execute(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeout ?? 90_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error("child failed"), { code, signal, stdout, stderr }));
    });
  });
}
const [binary, ...binaryPrefix] = parseBin(process.env.ABX_BIN ?? "abx");
const created = new Set();
const deleteAttempted = new Set();

async function run(args, expected = 0, options = {}) {
  try {
    const result = await execute(binary, [...binaryPrefix, ...args], {
      timeout: remaining(options.cleanup ? cleanupDeadline : observationDeadline, options.timeout ?? 90_000),
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(expected, 0, "expected a failing command");
    return result.stdout;
  } catch (error) {
    assert.equal(error.code, expected, `unexpected status for ${args[0]} ${args[1]}`);
    return error.stdout;
  }
}

// The child performs only a direct getInfo call, never connect/resume/renew. Killing it aborts body I/O too.
async function typedAbsent(id, timeoutMs) {
  const sdk = new URL('../dist/api/sandbox.js', import.meta.url).href;
  const errors = new URL('../dist/models/errors.js', import.meta.url).href;
  const code = `import {Sandbox} from ${JSON.stringify(sdk)}; import {SandboxNotFoundError} from ${JSON.stringify(errors)};
try { await Sandbox.getInfoById(process.argv[1], {provider:'alicloud-express',api_key:process.env.E2B_API_KEY,
api_url:process.env.E2B_API_URL,domain:process.env.E2B_DOMAIN}); process.exitCode=2; }
catch(error) { if(error instanceof SandboxNotFoundError) console.log('typed_absent'); else process.exitCode=3; }`;
  try {
    const result = await execute(process.execPath, ['--input-type=module', '-e', code, id], {timeout: timeoutMs});
    return result.stdout === 'typed_absent\n';
  } catch { return false; }
}

async function cleanupOwned(id) {
  return releaseOwnedSandbox({id, attempted:deleteAttempted, onRecord:record,
    prepareRemove:() => {
      const timeout = remaining(cleanupDeadline, 15000);
      return () => execute(binary, [...binaryPrefix, 'sandbox', 'kill', id], {timeout});
    },
    confirmAbsent:() => typedAbsent(id, remaining(cleanupDeadline, 10000)),
    onConfirmed:() => created.delete(id)});
}

// A real local PTY is necessary to test stateful terminal sessions and raw stdin.
const terminalProbe = String.raw`
import errno, fcntl, json, os, pty, re, select, signal, struct, sys, termios, time
pid, master = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], [sys.argv[1], *json.loads(sys.argv[4]), 'sandbox', sys.argv[2], sys.argv[3]])
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
output = b''
sent = False
resource_reported = False
deadline = time.monotonic() + 45
try:
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.2)
        if ready:
            try: chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO: break
                raise
            if not chunk: break
            output += chunk
            if sys.argv[2] == 'create' and not resource_reported:
                match = re.search(rb'with sandbox ID (?:\x1b\[[0-9;]*m)*([A-Za-z0-9_-]+)', output)
                if match:
                    print('RESOURCE ' + match.group(1).decode(), flush=True)
                    resource_reported = True
        # Wait for the remote shell prompt, not merely the local connection banner.
        if not sent and (b'$ ' in output or b'# ' in output):
            os.write(master, b"cd /tmp\nexport ABX_STATE=retained\nprintf 'PTY_STATE:%s:%s\\n' \"$PWD\" \"$ABX_STATE\"\nexit\n")
            sent = True
    else:
        raise AssertionError('terminal probe timed out')
    _, status = os.waitpid(pid, 0)
    assert os.waitstatus_to_exitcode(status) == 0
    assert b'PTY_STATE:/tmp:retained' in output
    print('PTY state and exit: PASS')
finally:
    os.close(master)
    try: os.kill(pid, signal.SIGTERM)
    except ProcessLookupError: pass
`;

async function main() {
let primaryFailure;
record('standard-start', {observationBudgetSeconds:210, cleanupReserveSeconds:30, graceSeconds:90});
try {
  assert.ok(process.env.E2B_API_KEY, "E2B_API_KEY is required");
  const output = await run(["sandbox", "create", "code-interpreter-v1", "--detach", "--timeout", "300"]);
  const id = output.trim();
  assert.match(id, /^[A-Za-z0-9_-]+$/);
  created.add(id);
  record('detached-created', {sandboxId:id});
  console.log("PASS: detached create");
  assert.equal(await run(["sandbox", "exec", id, "printf", "standard-output"]), "standard-output");
  assert.equal(await run(["sandbox", "exec", id, "sh", "-c", "printf standard-error-path; exit 7"], 7), "standard-error-path");
  console.log("PASS: stdout and command failure");
  const templates = JSON.parse(await run(["template", "list", "--format", "json"]));
  assert.ok(Array.isArray(templates));
  console.log("PASS: template list");
  const terminal = await execute("python3", ["-c", terminalProbe, binary, "connect", id, JSON.stringify(binaryPrefix)], { timeout: terminalProbeBudget(observationDeadline) });
  assert.match(terminal.stdout, /PTY state and exit: PASS/);
  // Connect must preserve the existing sandbox after the shell exits.
  assert.equal(await run(["sandbox", "exec", id, "printf", "still-alive"]), "still-alive");
  let automatic;
  try {
    const result = await execute("python3", ["-c", terminalProbe, binary, "create", "code-interpreter-v1", JSON.stringify(binaryPrefix)], { timeout: terminalProbeBudget(observationDeadline) });
    automatic = /RESOURCE ([A-Za-z0-9_-]+)/.exec(result.stdout)?.[1];
    assert.ok(automatic, "create must report its sandbox ID");
    created.add(automatic);
    record('interactive-created', {sandboxId:automatic});
  } catch (error) {
    const leaked = /RESOURCE ([A-Za-z0-9_-]+)/.exec(error.stdout ?? "")?.[1];
    if (leaked) { created.add(leaked); record('interactive-create-identity-before-failure', {sandboxId:leaked}); }
    throw error;
  }
  // Counted polls spent part of their budget inside the valid native lease. Freeze its clock once.
  const expiry = await observeTerminalExpiry({sandboxId:automatic, hardDeadline:observationDeadline,
    read: timeoutMs => readNativeObservation(`${apiUrl}/sandboxes/${automatic}`, credentials.E2B_API_KEY, timeoutMs),
    confirmAbsent: timeoutMs => typedAbsent(automatic, timeoutMs),
    onObservation: observation => record('expiry-observation', observation)});
  record('natural-expiry-confirmed', expiry);
  console.log('PASS: post-terminal lease shortened and natural expiry independently confirmed');
  created.delete(automatic);
  await cleanupOwned(id);
  const list = JSON.parse(await run(["sandbox", "list", "--format", "json"], 0, {cleanup:true, timeout:5000}));
  assert.ok(!list.some((item) => item.sandboxId === id || item.sandboxID === id));
  console.log("PASS: detached create, stdout, command failure, templates, stateful PTY, connect retention, create expiry, kill and cleanup");
} catch (error) { primaryFailure = error; }
finally {
  const cleanup = await Promise.allSettled([...created].map((id) => cleanupOwned(id)));
  const failed = cleanup.filter((result) => result.status === 'rejected').length;
  try { record('standard-cleanup-finished', {confirmed:failed===0, unresolvedOwnedIds:[...created]}); }
  catch (error) { if (!primaryFailure) primaryFailure = error; }
  if (failed) {
    if (primaryFailure) console.error('Additional owned cleanup is unconfirmed; the original failure is preserved.');
    else primaryFailure = Error('tracked sandbox cleanup failed');
  }
}
if (primaryFailure) throw primaryFailure;
}

try { await main(); } catch (error) {
  console.error(mask(error.stack ?? String(error)));
  process.exitCode = 1;
}

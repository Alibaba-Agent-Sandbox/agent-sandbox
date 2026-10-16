#!/usr/bin/env node
/** Real Express migration checks. ABX_BIN points to the built standalone executable. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

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
const binary = process.env.ABX_BIN ?? "abx";
const created = new Set();

async function run(args, expected = 0) {
  try {
    const result = await execute(binary, args, { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(expected, 0, "expected a failing command");
    return result.stdout;
  } catch (error) {
    assert.equal(error.code, expected, `unexpected status for ${args[0]} ${args[1]}`);
    return error.stdout;
  }
}

// A real local PTY is necessary to test stateful terminal sessions and raw stdin.
const terminalProbe = String.raw`
import errno, fcntl, os, pty, re, select, signal, struct, sys, termios, time
pid, master = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], [sys.argv[1], 'sandbox', sys.argv[2], sys.argv[3]])
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

try {
  assert.ok(process.env.E2B_API_KEY, "E2B_API_KEY is required");
  const output = await run(["sandbox", "create", "code-interpreter-v1", "--detach", "--timeout", "300"]);
  const id = output.trim();
  assert.match(id, /^[A-Za-z0-9_-]+$/);
  created.add(id);
  console.log("PASS: detached create");
  assert.equal(await run(["sandbox", "exec", id, "printf", "standard-output"]), "standard-output");
  assert.equal(await run(["sandbox", "exec", id, "sh", "-c", "printf standard-error-path; exit 7"], 7), "standard-error-path");
  console.log("PASS: stdout and command failure");
  const templates = JSON.parse(await run(["template", "list", "--format", "json"]));
  assert.ok(Array.isArray(templates));
  console.log("PASS: template list");
  const terminal = await execute("python3", ["-c", terminalProbe, binary, "connect", id], { timeout: 60_000 });
  assert.match(terminal.stdout, /PTY state and exit: PASS/);
  // Connect must preserve the existing sandbox after the shell exits.
  assert.equal(await run(["sandbox", "exec", id, "printf", "still-alive"]), "still-alive");
  let automatic;
  try {
    const result = await execute("python3", ["-c", terminalProbe, binary, "create", "code-interpreter-v1"], { timeout: 60_000 });
    automatic = /RESOURCE ([A-Za-z0-9_-]+)/.exec(result.stdout)?.[1];
    assert.ok(automatic, "create must report its sandbox ID");
    created.add(automatic);
  } catch (error) {
    const leaked = /RESOURCE ([A-Za-z0-9_-]+)/.exec(error.stdout ?? "")?.[1];
    if (leaked) created.add(leaked);
    throw error;
  }
  // Reference create requests one second; Express currently rounds this to its minimum lease.
  let removed = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    const response = await fetch(`${process.env.E2B_API_URL}/sandboxes/${automatic}`, { headers: { "X-API-Key": process.env.E2B_API_KEY } });
    if (response.status === 404) { removed = true; break; }
    assert.equal(response.status, 200);
    const detail = await response.json();
    if (attempt === 0) {
      const remaining = Math.round((Date.parse(detail.endAt) - Date.parse(response.headers.get("date"))) / 1000);
      assert.ok(remaining <= 60, "backend must shorten the post-terminal lease");
      console.log("PASS: post-terminal lease shortened (backend minimum applies)");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(removed, "default interactive create must expire after terminal exit");
  created.delete(automatic);
  await run(["sandbox", "kill", id]);
  created.delete(id);
  const list = JSON.parse(await run(["sandbox", "list", "--format", "json"]));
  assert.ok(!list.some((item) => item.sandboxId === id || item.sandboxID === id));
  console.log("PASS: detached create, stdout, command failure, templates, stateful PTY, connect retention, create expiry, kill and cleanup");
} finally {
  for (const id of created) await run(["sandbox", "kill", id]);
}

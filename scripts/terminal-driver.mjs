// Test-only POSIX terminal driver, evaluated by python3 -c. No native Node dependency.
export const TERMINAL_DRIVER = String.raw`"""Drive real POSIX terminal behavior without a Node native PTY dependency."""
import errno
import fcntl
import json
import os
import pty
import select
import subprocess
import sys
import termios
import time

spec = json.loads(sys.argv[1])
master, slave = pty.openpty()

def terminal_session():
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

script = spec.get("script")
proc = subprocess.Popen(
    spec["argv"], stdin=subprocess.PIPE if script else slave,
    stdout=slave if spec.get("stdout_terminal") else subprocess.PIPE, stderr=slave, preexec_fn=terminal_session,
)
os.close(slave)
if script:
    with open(script, "rb") as source:
        proc.stdin.write(source.read())
    proc.stdin.close()

out, err = bytearray(), bytearray()
fds = {master: err}
if proc.stdout:
    fds[proc.stdout.fileno()] = out
steps = iter(spec.get("steps", []))
step = next(steps, None)
deadline = time.monotonic() + spec.get("timeout", 45)
timed_out = False
try:
    while fds:
        if time.monotonic() >= deadline:
            timed_out = True
            break
        ready, _, _ = select.select(list(fds), [], [], 0.05)
        for fd in ready:
            try:
                chunk = os.read(fd, 65536)
            except OSError as exc:
                if exc.errno != errno.EIO:
                    raise
                chunk = b""
            if chunk:
                fds[fd].extend(chunk)
            else:
                del fds[fd]
        if step and step["wait_for"].encode() in err:
            os.write(master, step["keys"].encode())
            step = next(steps, None)
finally:
    try:
        proc.wait(timeout=1)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
    os.close(master)
print(json.dumps({"stdout": out.decode(errors="replace"), "stderr": err.decode(errors="replace"),
                  "status": proc.returncode, "timed_out": timed_out}))
`;

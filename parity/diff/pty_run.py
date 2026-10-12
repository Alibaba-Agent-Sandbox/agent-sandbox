#!/usr/bin/env python3
"""Run a command on a pseudo terminal and drive it with scripted keystrokes.

Used by the differential harnesses to exercise the interactive (TTY) branches of the CLI for both the Python oracle
and the Node port with exactly the same input.

    pty_run.py '<json spec>'

spec = {"argv": [...], "cwd": str, "env": {...}, "steps": [{"expect": str, "send": str}], "timeout": seconds,
        "signal_after": {"expect": str, "signal": "INT"}?}

Each step waits until its ``expect`` text shows up in the output produced since the previous step (or the timeout
elapses), then writes ``send`` to the terminal (``\\x03`` is Ctrl-C and ``\\x04`` Ctrl-D through the terminal driver).
The result is one JSON document on stdout: {"code": int, "output": str, "timed_out": bool}. stdout and stderr of the
child are merged by the terminal, exactly as a user would see them.
"""

import json
import os
import pty
import select
import sys
import time


def main() -> int:
    spec = json.loads(sys.argv[1])
    argv = spec["argv"]
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(spec["cwd"])
        os.execvpe(argv[0], argv, spec["env"])
        os._exit(127)

    import fcntl
    import struct
    import termios

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))

    buffer = ""
    pending = ""
    deadline = time.time() + spec.get("timeout", 90)
    timed_out = False

    def pump(wait: float) -> bool:
        nonlocal buffer, pending
        ready, _, _ = select.select([fd], [], [], wait)
        if not ready:
            return True
        try:
            data = os.read(fd, 65536)
        except OSError:
            return False
        if not data:
            return False
        text = data.decode("utf-8", errors="replace")
        buffer += text
        pending += text
        return True

    alive = True
    for step in spec.get("steps", []):
        while alive and step["expect"] not in pending and time.time() < deadline:
            alive = pump(0.05)
        if step["expect"] not in pending:
            timed_out = alive
            break
        pending = ""
        time.sleep(step.get("delay", 0.15))
        os.write(fd, step["send"].encode("utf-8"))

    while alive and not timed_out and time.time() < deadline:
        alive = pump(0.05)
    if alive:
        timed_out = True
        try:
            os.kill(pid, 9)
        except OSError:
            pass
    _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status)
    print(json.dumps({"code": code, "output": buffer, "timed_out": timed_out}))
    return 0


if __name__ == "__main__":
    sys.exit(main())

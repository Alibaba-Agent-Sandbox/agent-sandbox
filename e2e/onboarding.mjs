// Exercise real terminal prompts with the Python stdlib PTY harness on POSIX.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = String.raw`"""Real POSIX-terminal acceptance for local template onboarding; no cloud credentials."""
import os
import sys
import fcntl
import struct
import termios
from pathlib import Path
import pty
import re
import select
import shlex
import shutil
import subprocess
import tempfile
import time


def main():
    repository = Path(sys.argv[1])
    command = shlex.split(os.environ.get("ABX_BIN", "")) or [shutil.which("node"), str(repository / "dist/bin/abx.js")]
    with tempfile.TemporaryDirectory(prefix="abx-onboarding-pty-") as temporary:
        root = Path(temporary)
        home = root / "home"
        home.mkdir()
        environment = {"PATH": os.environ["PATH"], "HOME": str(home), "XDG_CONFIG_HOME": str(home / ".config"),
                       "TERM": "xterm", "NO_COLOR": "1", "LANG": "C.UTF-8"}

        def invoke(arguments, answers):
            master, slave = pty.openpty()
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 200, 0, 0))
            child = subprocess.Popen(command + arguments, stdin=slave, stdout=slave, stderr=slave,
                                     cwd=root, env=environment, start_new_session=True)
            os.close(slave)
            output = bytearray()

            def read():
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        output.extend(os.read(master, 65536))
                    except OSError:
                        pass

            try:
                for marker, answer in answers:
                    deadline = time.monotonic() + 15
                    while marker.encode() not in output:
                        read()
                        if marker.encode() in output:
                            break
                        assert child.poll() is None, f"Command exited before {marker}"
                        assert time.monotonic() < deadline, f"Timed out before {marker}"
                    if child.poll() is None:
                        os.write(master, answer)
                deadline = time.monotonic() + 15
                while child.poll() is None:
                    read()
                    assert time.monotonic() < deadline, "Command did not exit"
                read()
                return child.returncode, output.decode(errors="replace")
            except Exception:
                text = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", output.decode(errors="replace"))
                print(text.replace(str(root), "<TMP>"))
                raise
            finally:
                if child.poll() is None:
                    child.kill()
                child.wait()
                os.close(master)

        project = root / "dev-services"
        status, output = invoke(["template", "deploy", str(project)], [
            ("Create a template project here?", b"y\r"), ("Select a case", b"\r"),
        ])
        assert status == 0, "Project creation failed"
        assert (project / "template.yaml").is_file()
        assert "Review the generated files, then deploy:" in output
        print("PASS: actual terminal creates a selected project and stops for review")

        dockerfile = project / "Dockerfile"
        dockerfile.write_text("original file\n")
        (project / "notes.txt").write_text("preserve unrelated data\n")
        arguments = ["template", "scaffold", "--template", "python", str(project)]
        status, _ = invoke(arguments, [("Overwrite these existing entries?", b"n\r")])
        assert status == 1 and dockerfile.read_text() == "original file\n"
        print("PASS: actual terminal decline preserves the original file")

        status, output = invoke(arguments, [("Overwrite these existing entries?", b"y\r")])
        assert status == 0 and "FROM" in dockerfile.read_text()
        assert (project / "notes.txt").read_text() == "preserve unrelated data\n"
        assert "Replaced files:" in output
        print("PASS: actual terminal confirmation replaces selected entries and keeps unrelated data")


if __name__ == "__main__":
    main()
`;
const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync("python3", ["-c", source, root], { stdio: "inherit", env: process.env, timeout: 50000 });
if (result.error) throw result.error;
process.exit(result.status ?? 1);

// Exercise real terminal prompts with the Python stdlib PTY harness on POSIX.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = String.raw`"""Real POSIX-terminal acceptance for local template onboarding; no cloud credentials."""
import os
import json
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
                       "TERM": "xterm", "NO_COLOR": "1", "LANG": "C.UTF-8", "ABX_NO_KEYCHAIN": "1", "USERPROFILE": str(home)}

        def invoke(arguments, answers, *, stdout_pipe=False, extra_environment=None):
            master, slave = pty.openpty()
            original_mode = termios.tcgetattr(slave)
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 200, 0, 0))
            child = subprocess.Popen(command + arguments, stdin=slave, stdout=subprocess.PIPE if stdout_pipe else slave, stderr=slave,
                                     cwd=root, env={**environment, **(extra_environment or {})}, start_new_session=True)
            os.close(slave)
            output = bytearray()
            piped = bytearray()

            def read():
                streams = [master] + ([child.stdout] if stdout_pipe else [])
                for ready in select.select(streams, [], [], 0.1)[0]:
                    try:
                        chunk = os.read(master if ready == master else ready.fileno(), 65536)
                        (output if ready == master else piped).extend(chunk)
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
                if any(b"\x03" in answer for _, answer in answers):
                    restored = termios.tcgetattr(master)
                    mask = termios.ECHO | termios.ICANON
                    assert restored[3] & mask == original_mode[3] & mask, "Cancelling input must restore echo and canonical terminal mode"
                return child.returncode, output.decode(errors="replace"), piped.decode(errors="replace")
            except Exception:
                text = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", output.decode(errors="replace"))
                print(text.replace(str(root), "<TMP>"))
                raise
            finally:
                if child.poll() is None:
                    child.kill()
                child.wait()
                os.close(master)
                if child.stdout is not None:
                    child.stdout.close()

        project = root / "dev-services"
        status, output, _ = invoke(["template", "deploy", str(project), "--acr-namespace", "onboarding-test"], [
            ("Create a template project here and continue?", b"y\r"), ("Select a case", b"\r"),
            ("Configuration scope", b"3\r"),
        ])
        assert status == 1 and "Configuration scope" in output and "access_key_id" in output and "access_key_secret" in output, "Must continue into unified configuration guidance"
        assert "Aborted" in output and "Building Docker" not in output and "Creating template" not in output, "Cancelling configuration must stop before cloud submission"
        assert (project / "template.yaml").is_file()
        assert "Created template project" in output
        print("PASS: actual terminal creates a selected project, reaches configuration setup and cancels before cloud submission")

        dockerfile = project / "Dockerfile"
        dockerfile.write_text("original file\n")
        (project / "notes.txt").write_text("preserve unrelated data\n")
        arguments = ["template", "scaffold", "--template", "python", str(project)]
        status, _, _ = invoke(arguments, [("Overwrite these existing entries?", b"n\r")])
        assert status == 1 and dockerfile.read_text() == "original file\n"
        print("PASS: actual terminal decline preserves the original file")

        status, output, _ = invoke(arguments, [("Overwrite these existing entries?", b"y\r")])
        assert status == 0 and "FROM" in dockerfile.read_text()
        assert (project / "notes.txt").read_text() == "preserve unrelated data\n"
        assert "Replaced files:" in output
        print("PASS: actual terminal confirmation replaces selected entries and keeps unrelated data")

        secret_fixture = "hidden-cancel-fixture-do-not-save"
        status, output, _ = invoke(["create", "base"], [
            ("Configuration scope", b"1\r"),
            ("input hidden", secret_fixture.encode() + b"\x03"),
        ])
        assert status != 0 and secret_fixture not in output, "Hidden input and Ctrl-C must not expose the entered value"
        for path in home.rglob("*"):
            if path.is_file():
                assert secret_fixture.encode() not in path.read_bytes(), "Cancelling credential input must not persist a secret"
        print("PASS: actual hidden input restores the terminal on Ctrl-C without echoing or saving the partial key")

        cases = [
            (["--native", "--json", "create", "base"], {}),
            (["--native", "create", "base"], {"CI": "1"}),
            (["--native", "--quiet", "create", "base"], {}),
            (["--native", "create", "base", "-y"], {}),
        ]
        for arguments, extra in cases:
            status, output, _ = invoke(arguments, [], extra_environment=extra)
            assert status == 1 and "Missing configuration" in output, "Automation must report missing values without waiting"
            assert "Configuration scope" not in output and "input hidden" not in output, "TTY must not enable automation credential prompts"
            if "--json" in arguments or extra.get("CI"):
                assert "sandbox_api_key" in json.loads(output)["message"], "Machine mode must emit exactly one final JSON result"
        print("PASS: real TTY plus JSON, CI, quiet and -y never asks for configuration")

        status, terminal, result = invoke(["--native", "create", "base"], [], stdout_pipe=True)
        assert status == 1 and "Missing configuration" in terminal + result
        assert "Configuration scope" not in terminal + result and "input hidden" not in terminal + result, "Piped stdout must not enable credential input"
        status, terminal, result = invoke(["--native", "--json", "create", "base"], [], stdout_pipe=True)
        assert status == 1 and "sandbox_api_key" in json.loads(result)["message"]
        assert "Configuration scope" not in terminal + result
        print("PASS: real TTY stdin/stderr with stdout piped never prompts and preserves one JSON document")


if __name__ == "__main__":
    main()
`;
const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync("python3", ["-c", source, root], { stdio: "inherit", env: process.env, timeout: 90000 });
if (result.error) throw result.error;
process.exit(result.status ?? 1);

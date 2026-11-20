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
import http.server
import threading


def main():
    repository = Path(sys.argv[1])
    command = shlex.split(os.environ.get("ABX_BIN", "")) or [shutil.which("node"), str(repository / "dist/bin/abx.js")]
    requests = []
    class Boundary(http.server.BaseHTTPRequestHandler):
        def respond(self):
            requests.append(self.command)
            self.send_response(503)
            self.end_headers()
            self.wfile.write(b"local request boundary; no cloud backend")
        do_GET = do_POST = do_DELETE = do_PATCH = do_PUT = respond
        def log_message(self, *_args):
            pass
    boundary = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Boundary)
    threading.Thread(target=boundary.serve_forever, daemon=True).start()
    endpoint = "http://127.0.0.1:" + str(boundary.server_port)
    with tempfile.TemporaryDirectory(prefix="abx-onboarding-pty-") as temporary:
        root = Path(temporary)
        home = root / "home"
        home.mkdir()
        environment = {"PATH": os.environ["PATH"], "HOME": str(home), "XDG_CONFIG_HOME": str(home / ".config"),
                       "TERM": "xterm", "NO_COLOR": "1", "LANG": "C.UTF-8", "ABX_NO_KEYCHAIN": "1", "USERPROFILE": str(home),
                       "ABX_SANDBOX_BASE_URL": endpoint, "ABX_ALICLOUD_EXPRESS_SANDBOX_BASE_URL": endpoint}

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
        status, output, _ = invoke(["template", "init", str(project)], [("Select a case", b"\r")])
        assert status == 0 and (project / "template.yaml").is_file()
        assert "input hidden" not in output
        assert not (home / ".abx/resource-journal").exists()
        print("PASS: actual terminal initializes editable source without cloud configuration or submission")

        dockerfile = project / "Dockerfile"
        dockerfile.write_text("original file\n")
        (project / "notes.txt").write_text("preserve unrelated data\n")
        arguments = ["template", "init", "--template", "python", str(project)]
        status, _, _ = invoke(arguments, [("Overwrite these existing entries?", b"n\r")])
        assert status == 1 and dockerfile.read_text() == "original file\n"
        print("PASS: actual terminal decline preserves the original file")

        status, output, _ = invoke(arguments, [("Overwrite these existing entries?", b"y\r")])
        assert status == 0 and "FROM" in dockerfile.read_text()
        assert (project / "notes.txt").read_text() == "preserve unrelated data\n"
        assert "Replaced files:" in output
        print("PASS: actual terminal confirmation replaces selected entries and keeps unrelated data")

        secret_fixture = "hidden-cancel-fixture-do-not-save"
        status, output, _ = invoke(["sandbox", "create", "--template", "base"], [
            ("Choose an authentication method", b"1\r"),
            ("sandbox_api_key (input hidden)", secret_fixture.encode() + b"\x03"),
        ])
        assert status != 0 and secret_fixture not in output, "Hidden input and Ctrl-C must not expose the entered value"
        for path in home.rglob("*"):
            if path.is_file():
                assert secret_fixture.encode() not in path.read_bytes(), "Cancelling credential input must not persist a secret"
        assert requests == [], "Cancelling native credentials must not submit a request"
        assert not (home / ".abx/resource-journal").exists()
        print("PASS: explicit sandbox creation preserves hidden credential input and Ctrl-C stops before requests or secret persistence")

        application = root / "application"
        shutil.copytree(project, application)
        (application / "template.yaml").write_text(json.dumps({
            "name": "application", "specVersion": 1,
            "sandbox": {"agent": {"provider": "alicloud-express", "template": {
                "region": "cn-hangzhou", "image": "example.test/app:v1"}}},
        }))
        status, output, _ = invoke(["deploy", str(application), "--name", "preview", "--plan"], [])
        assert status == 0 and "preview" in output and "agent" in output
        assert "input hidden" not in output and requests == []
        assert not (home / ".abx/deployments/preview").exists()
        print("PASS: named template preview needs no credentials and writes no resource intent")
        status, output, _ = invoke(["deploy", str(application), "--name", "unapproved"], [])
        assert status != 0 and "--yes" in output
        assert requests == [] and "input hidden" not in output
        assert not (home / ".abx/deployments/unapproved").exists()
        print("PASS: resource preparation without approval stops before credentials or resource requests")

        cases = [
            (["--json", "sandbox", "create", "--template", "base", "--yes"], {}),
            (["sandbox", "create", "--template", "base", "--yes"], {"CI": "1"}),
            (["--quiet", "sandbox", "create", "--template", "base", "--yes"], {}),
            (["sandbox", "create", "--template", "base", "-y"], {}),
        ]
        for arguments, extra in cases:
            status, output, _ = invoke(arguments, [], extra_environment=extra)
            assert status == 1 and "Missing configuration" in output, "Automation must report missing values without waiting"
            assert "Configuration scope" not in output and "input hidden" not in output, "TTY must not enable automation credential prompts"
            assert "sandbox:CreateApiKey" not in output and "30 days" not in output, "Ordinary missing-key recovery must not expand managed-key details"
            assert "abx config set providers.alicloud-express.sandbox_api_key" in output and "Agent Sandbox console" in output
            if "--json" in arguments or extra.get("CI"):
                assert "sandbox_api_key" in json.loads(output)["message"], "Machine mode must emit exactly one final JSON result"
        print("PASS: real TTY plus JSON, CI, quiet and -y never asks for configuration")

        status, terminal, result = invoke(["sandbox", "create", "--template", "base", "--yes"], [], stdout_pipe=True)
        assert status == 1 and "Missing configuration" in terminal + result
        assert "Configuration scope" not in terminal + result and "input hidden" not in terminal + result, "Piped stdout must not enable credential input"
        status, terminal, result = invoke(["--json", "sandbox", "create", "--template", "base", "--yes"], [], stdout_pipe=True)
        assert status == 1 and "sandbox_api_key" in json.loads(result)["message"]
        assert "Configuration scope" not in terminal + result
        assert requests == [], "The whole fixture must stay before the first backend request"
        print("PASS: real TTY stdin/stderr with stdout piped never prompts and preserves one JSON document")
    boundary.shutdown()
    boundary.server_close()


if __name__ == "__main__":
    main()
`;
const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync("python3", ["-c", source, root], { stdio: "inherit", env: process.env, timeout: 90000 });
if (result.error) throw result.error;
process.exit(result.status ?? 1);

"""Real Express application timeout regression; creates and deletes one owned sandbox.

Install agent-sandbox-client==0.3.1a5, configure Express through environment,
then pass executable argv strings with --baseline and --candidate. No raw cloud
responses, identifiers, endpoint URLs or credentials are written to the report.
"""
import argparse
import asyncio
import hashlib
import json
import os
import secrets
import shlex
import subprocess
import time
import urllib.request

from agent_sandbox import ProviderSandbox
from agent_sandbox.models.errors import SandboxNotFoundError

SERVER = '''import threading,time
from agent_sandbox.server import SandboxServer,ServerPolicy,command
calls=0
lock=threading.Lock()
@command("slow")
def slow(seconds: int) -> int:
    global calls
    with lock:
        calls+=1
    time.sleep(seconds)
    return 42
@command("count")
def count() -> int:
    with lock:
        return calls
SandboxServer(policy=ServerPolicy.only("run_command", "list_commands")).serve(9100)
'''
SERVER_SHA256 = "96405446aa84d4eb939536d90355f614bce468b745784def823b29781c638a1a"


async def verify(args):
    report = {"provider": "alicloud-express", "template": "base", "result": "FAIL",
              "checks": [], "cleanup": "not created", "server_version": "0.3.1a5"}
    sb = client = None
    try:
        with urllib.request.urlopen("https://pypi.org/pypi/agent-sandbox-server/0.3.1a5/json", timeout=30) as response:
            wheel = next(f for f in json.load(response)["urls"] if f["filename"].endswith(".whl"))
        with urllib.request.urlopen(wheel["url"], timeout=30) as response:
            data = response.read()
        assert hashlib.sha256(data).hexdigest() == wheel["digests"]["sha256"] == SERVER_SHA256
        report["server_wheel_sha256"] = SERVER_SHA256
        nonce = "timeout-review-" + secrets.token_hex(8)
        token = secrets.token_hex(24)
        remote = "/tmp/" + nonce
        sb = await ProviderSandbox.create(provider="alicloud-express", template="base",
                                          timeout=300, metadata={"verification": nonce})
        result = await sb.commands.run("mkdir -p " + shlex.quote(remote), timeout=30)
        assert result.exit_code == 0
        await sb.files.write(remote + "/server.whl", data)
        await sb.files.write(remote + "/app.py", SERVER)
        result = await sb.commands.run("python3 -m zipfile -e " + shlex.quote(remote + "/server.whl")
                                       + " " + shlex.quote(remote + "/runtime"), timeout=30)
        assert result.exit_code == 0
        start = ("nohup env PYTHONPATH=" + shlex.quote(remote + "/runtime") + " python3 "
                 + shlex.quote(remote + "/app.py") + " > /dev/null 2>&1 < /dev/null &")
        result = await sb.commands.run("sh -c " + shlex.quote(start), env={"ABX_SERVER_TOKEN": token}, timeout=30)
        assert result.exit_code == 0
        # Only readiness is polled; command POSTs are never retried.
        for _ in range(40):
            try:
                client = await sb.application_client(9100, token=token, timeout=10)
                assert await client.commands.run("count") == 0
                break
            except Exception:
                if client:
                    await client.aclose()
                    client = None
                await asyncio.sleep(0.5)
        else:
            raise AssertionError("owned application readiness")

        async def invoke(label, argv, timeout, seconds):
            env = {**os.environ, "ABX_HTTP_TIMEOUT": str(timeout), "ABX_SERVER_TOKEN": token}
            started = time.monotonic()
            result = await asyncio.to_thread(subprocess.run, argv + ["--provider", "alicloud-express",
                "--json", "run", sb.id, "slow", "--server-port", "9100", "--json-args",
                json.dumps({"seconds": seconds})], env=env, capture_output=True, text=True, timeout=65)
            elapsed = time.monotonic() - started
            report["checks"].append({"case": label, "http_timeout_seconds": timeout,
                "server_delay_seconds": seconds, "returncode": result.returncode,
                "elapsed_seconds": round(elapsed, 2)})
            return result, elapsed

        result, elapsed = await invoke("public-0416-ignores-configured-40", args.baseline, 40, 35)
        assert result.returncode != 0 and 28 < elapsed < 35
        assert await client.commands.run("count") == 1
        result, elapsed = await invoke("candidate-honors-configured-40", args.candidate, 40, 35)
        assert result.returncode == 0 and json.loads(result.stdout)["result"] == 42 and elapsed >= 35
        assert await client.commands.run("count") == 2
        result, elapsed = await invoke("candidate-honors-short-1", args.candidate, 1, 3)
        assert result.returncode != 0 and elapsed < 3
        assert await client.commands.run("count") == 3
        report["application_result"] = "PASS"
    except Exception as error:
        report["error_type"] = type(error).__name__
    finally:
        if sb:
            try:
                await sb.kill()
                try:
                    await ProviderSandbox.get_info_by_id(sb.id, provider="alicloud-express")
                except SandboxNotFoundError:
                    report["cleanup"] = "confirmed absent"
                else:
                    report["cleanup"] = "absence not confirmed"
                inventory = await ProviderSandbox.list(provider="alicloud-express")
                report["absent_from_inventory"] = all(item.sandbox_id != sb.id for item in inventory)
            except Exception as error:
                report["cleanup"] = "failed"
                report["cleanup_error_type"] = type(error).__name__
        for resource in (client, sb):
            if resource:
                try:
                    await (resource.aclose() if resource is client else resource.close())
                except Exception as error:
                    report["close_error_type"] = type(error).__name__
    if (report.get("application_result") == "PASS" and report["cleanup"] == "confirmed absent"
            and report.get("absent_from_inventory") and "close_error_type" not in report):
        report["result"] = "PASS"
    print(json.dumps(report, indent=2))
    return 0 if report["result"] == "PASS" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, type=shlex.split, help="CLI 0.4.16 executable argv")
    parser.add_argument("--candidate", required=True, type=shlex.split, help="Candidate CLI executable argv")
    raise SystemExit(asyncio.run(verify(parser.parse_args())))

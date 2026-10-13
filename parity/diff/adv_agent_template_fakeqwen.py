#!/usr/bin/env python3
"""Scriptable stand-in for the `qwen` coding-agent CLI used by the adversarial adopt / qwen-code differentials.

Behaviour comes from `$HOME/.fakeq/scenario.json` (HOME survives the scrubbed environment); every invocation appends one JSON
line to `$HOME/.fakeq/log.jsonl` (argv with the prompt reduced to length + sha1, cwd, env names, process facts). Both the
original and the port run this exact file, so any difference in the log or in the files left behind is a behavioural difference
of the host side.

Scenario keys (all optional): actions: list of steps, executed in order:
  {"write": rel, "content": str, "mode": octal-int}   {"write_bytes": rel, "hex": str}   {"mkdir": rel}
  {"symlink": rel, "target": str}   {"rm": rel}   {"append": rel, "content": str}   {"chmod": rel, "mode": int}
  {"stdout": str}  {"stderr": str}  {"flush": true}  {"sleep": seconds}
  {"result": str, "is_error": bool, "extra": {..}}   final `result` message (json array in json mode, ndjson in stream mode)
  {"stream_events": [obj, ...]}                     only emitted when --output-format stream-json
  {"big_stderr": n} / {"big_stdout": n}             n bytes of filler
  {"spawn_bg": {"sleep": s, "pidfile": rel_to_HOME}}  detached grandchild (survives unless the process group is killed)
  {"exit": code}   {"kill_self": "SIGKILL"}   {"ignore_term": true}
  {"reject_stream": true}                           exit 1 + stderr mentioning --include-partial-messages when asked for stream-json
  {"read": rel, "log_as": key}                      record a file's content (to see what the host passed along)
Env: FAKEQ_NAME is irrelevant.
"""
import hashlib
import json
import os
import signal
import subprocess
import sys
import time

home = os.environ.get("HOME", "")
cfg_dir = os.path.join(home, ".fakeq")
os.makedirs(cfg_dir, exist_ok=True)
try:
    scenario = json.load(open(os.path.join(cfg_dir, "scenario.json")))
except Exception:
    scenario = {}

argv = sys.argv[1:]
prompt = argv[0] if argv else ""
# Documented intentional deviation (KNOWN-GAPS.md, template_guide): the SDK install hint names `agent-sandbox-server`.
prompt = prompt.replace("安装 agent-sandbox-server，", "安装 agent-sandbox SDK，").replace("agent-sandbox-server wheel", "SDK wheel").replace("pip install --no-cache-dir agent-sandbox-server;", "pip install --no-cache-dir agent-sandbox;")
prompt = "\n".join(sorted(prompt.split("\n")))
stream = "stream-json" in argv
cwd = os.getcwd()


def scrub(s):
    return s.replace(cwd, "<CWD>")


record = {
    "argv": [("<prompt len=%d sha1=%s>" % (len(prompt), hashlib.sha1(prompt.encode("utf-8", "replace")).hexdigest()[:12])) if i == 0 else a for i, a in enumerate(argv)],
    "cwd_base_prefix": os.path.basename(cwd).rsplit("-", 1)[0] if cwd else "",
    "cwd_mode": oct(os.stat(cwd).st_mode & 0o777),
    "env_names": sorted(k for k in os.environ if k not in ("PWD", "SHLVL", "_", "OLDPWD", "LC_CTYPE")),
    "env_values": {k: os.environ.get(k) for k in scenario.get("log_env", [])},
    "stdin_is_null": os.fstat(0).st_rdev == os.stat("/dev/null").st_rdev,
    "pgid_is_pid": os.getpgrp() == os.getpid(),
    "sid_is_pid": os.getsid(0) == os.getpid(),
    "ppid_alive": True,
    "stream": stream,
    "ls": sorted(os.listdir(".")),
}
logs = []
exit_code = 0


def log_line(obj):
    with open(os.path.join(cfg_dir, "log.jsonl"), "a") as fh:
        fh.write(json.dumps(obj, sort_keys=True).replace(json.dumps(home)[1:-1], "<HOME>").replace(cwd, "<CWD>") + "\n")


log_line(record)
_n = len([f for f in os.listdir(cfg_dir) if f.startswith("prompt-")]) + 1
with open(os.path.join(cfg_dir, "prompt-%d.txt" % _n), "w", encoding="utf-8", errors="replace") as _fh:
    _fh.write(prompt.replace(home, "<HOME>"))


def emit_result(result, is_error=False, extra=None):
    msg = {"type": "result", "subtype": "success", "is_error": is_error, "result": result, "session_id": scenario.get("session_id", "")}
    msg.update(extra or {})
    if stream:
        sys.stdout.write(json.dumps({"type": "system", "subtype": "init"}) + "\n")
        sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    else:
        sys.stdout.write(json.dumps([{"type": "system"}, msg], ensure_ascii=False) + "\n")
    sys.stdout.flush()


def path_in_cwd(rel):
    return rel if os.path.isabs(rel) else os.path.join(cwd, rel)


for step in scenario.get("actions", []):
    if "write" in step:
        p = path_in_cwd(step["write"])
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8", newline="") as fh:
            fh.write(step["content"])
        if "mode" in step:
            os.chmod(p, step["mode"])
    elif "write_bytes" in step:
        p = path_in_cwd(step["write_bytes"])
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "wb").write(bytes.fromhex(step["hex"]))
    elif "mkdir" in step:
        os.makedirs(path_in_cwd(step["mkdir"]), exist_ok=True)
    elif "symlink" in step:
        p = path_in_cwd(step["symlink"])
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if os.path.lexists(p):
            os.unlink(p)
        os.symlink(step["target"].replace("@@CWD@@", cwd).replace("@@HOME@@", home), p)
    elif "rm" in step:
        p = path_in_cwd(step["rm"])
        if os.path.isdir(p) and not os.path.islink(p):
            import shutil

            shutil.rmtree(p)
        elif os.path.lexists(p):
            os.unlink(p)
    elif "append" in step:
        with open(path_in_cwd(step["append"]), "a", encoding="utf-8") as fh:
            fh.write(step["content"])
    elif "chmod" in step:
        os.chmod(path_in_cwd(step["chmod"]), step["mode"])
    elif "stdout" in step:
        sys.stdout.write(step["stdout"])
        sys.stdout.flush()
    elif "stderr" in step:
        sys.stderr.write(step["stderr"])
        sys.stderr.flush()
    elif "flush" in step:
        sys.stdout.flush()
        sys.stderr.flush()
    elif "sleep" in step:
        time.sleep(step["sleep"])
    elif "result" in step:
        emit_result(step["result"], step.get("is_error", False), step.get("extra"))
    elif "stream_events" in step:
        if stream:
            for ev in step["stream_events"]:
                sys.stdout.write(json.dumps(ev, ensure_ascii=False) + "\n")
                sys.stdout.flush()
    elif "big_stderr" in step:
        n = step["big_stderr"]
        chunk = "e" * 1023 + "\n"
        for _ in range(n // 1024):
            sys.stderr.write(chunk)
        sys.stderr.flush()
    elif "big_stdout" in step:
        n = step["big_stdout"]
        chunk = "o" * 1023 + "\n"
        for _ in range(n // 1024):
            sys.stdout.write(chunk)
        sys.stdout.flush()
    elif "spawn_bg" in step:
        cfg = step["spawn_bg"]
        pidfile = os.path.join(home, cfg["pidfile"])
        child = subprocess.Popen(
            [sys.executable, "-c", "import os,sys,time;open(sys.argv[1],'w').write(str(os.getpid()));time.sleep(float(sys.argv[2]))", pidfile, str(cfg.get("sleep", 300))],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for _ in range(100):
            if os.path.exists(pidfile) and os.path.getsize(pidfile):
                break
            time.sleep(0.02)
        logs.append({"bg_started": True})
    elif "exit" in step:
        exit_code = step["exit"]
        break
    elif "kill_self" in step:
        os.kill(os.getpid(), getattr(signal, step["kill_self"]))
        time.sleep(1)
    elif "ignore_term" in step:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    elif "reject_stream" in step:
        if stream:
            sys.stderr.write("error: unknown option '--include-partial-messages' for --output-format stream-json\n")
            sys.stdout.write(json.dumps([{"type": "result", "is_error": True, "result": "rejected"}]) + "\n")
            sys.stdout.flush()
            log_line({"rejected_stream": True})
            sys.exit(1)
    elif "read" in step:
        try:
            logs.append({step.get("log_as", step["read"]): open(path_in_cwd(step["read"]), "rb").read().decode("utf-8", "replace")})
        except OSError as exc:
            logs.append({step.get("log_as", step["read"]): "ERR %s" % type(exc).__name__})

log_line({"end": logs, "exit": exit_code})
sys.exit(exit_code)

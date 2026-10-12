#!/usr/bin/env python3
"""Generate `mcp_pyjson_cases.json` (consumed by `tests/test_agent/test_mcp_pyjson_oracle.test.ts`).

    HOME=$(mktemp -d) /path/to/oracle-venv/bin/python parity/diff/mcp_pyjson_gen.py [--out FILE]

Drives the original stdio MCP server (`python -m easy_sandbox.agent.mcp`) with raw request lines whose JSON number
spellings matter (`1.0`, `1e400`, big ints, `NaN`) and objects with integer-like keys, using only requests that are
answered without reaching a sandbox platform. Records `[request line, response line]` pairs.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

LINES = [
    '{"jsonrpc":"2.0","id":1.0,"method":"tools/list"}',
    '{"jsonrpc":"2.0","id":1e400,"method":"ping"}',
    '{"jsonrpc":"2.0","id":-1e400,"method":"ping"}',
    '{"jsonrpc":"2.0","id":-0.0,"method":"ping"}',
    '{"jsonrpc":"2.0","id":-0,"method":"ping"}',
    '{"jsonrpc":"2.0","id":1E2,"method":"ping"}',
    '{"jsonrpc":"2.0","id":12345678901234567890,"method":"ping"}',
    '{"jsonrpc":"2.0","id":123456789012345678901234567890,"method":"ping"}',
    '{"jsonrpc":"2.0","id":0.1,"method":"ping"}',
    '{"jsonrpc":"2.0","id":1e16,"method":"ping"}',
    '{"jsonrpc":"2.0","id":1e15,"method":"ping"}',
    '{"jsonrpc":"2.0","id":9007199254740993,"method":"ping"}',
    '{"jsonrpc":"2.0","id":123456789.123456789,"method":"ping"}',
    '{"jsonrpc":"2.0","id":1.7976931348623157e308,"method":"ping"}',
    '{"jsonrpc":"2.0","id":5e-324,"method":"ping"}',
    '{"jsonrpc":"2.0","id":1e-7,"method":"ping"}',
    '{"jsonrpc":"2.0","id":NaN,"method":"ping"}',
    '{"jsonrpc":"2.0","id":Infinity,"method":"ping"}',
    '{"jsonrpc":"2.0","id":-Infinity,"method":"ping"}',
    '{"jsonrpc":"2.0","id":[1.0,2,3.5,{"k":4.0}],"method":"ping"}',
    '{"jsonrpc":"2.0","id":{"2":1,"1":2.0,"b":3,"0":4},"method":"ping"}',
    '{"jsonrpc":"2.0","id":{"10":1,"9":2,"a":3,"1":{"3":1,"2":2}},"method":"initialize","params":{}}',
    '{"jsonrpc":"2.0","id":{"1":1,"1":2},"method":"ping"}',
    '{"jsonrpc":"2.0","id":{"a":1,"1":2,"a":3},"method":"ping"}',
    '{"jsonrpc":"2.0","id":4294967295,"method":"ping"}',
    '{"jsonrpc":"2.0","id":{"4294967295":1,"4294967294":2,"4294967296":3},"method":"ping"}',
    '{"jsonrpc":"2.0","id":{"01":1,"1":2,"-1":3,"1.5":4},"method":"ping"}',
    '{"jsonrpc":"2.0","id":2.0,"method":"no/such"}',
    '{"jsonrpc":"2.0","id":2.0,"method":1.0}',
    '{"jsonrpc":"2.0","id":3.0,"method":"tools/call","params":1.0}',
    '{"jsonrpc":"2.0","id":3.5,"method":"tools/call","params":{"name":1.0,"arguments":{}}}',
    '{"jsonrpc":"2.0","id":4.0,"method":"tools/call","params":{"name":"run_code","arguments":2.0}}',
    '{"jsonrpc":"2.0","id":5.0,"method":"tools/call","params":{"name":"no_tool","arguments":{"timeout":30.0}}}',
    '{"jsonrpc":"2.0","id":6.0,"method":"tools/call","params":{"name":"run_code","arguments":{"timeout":30.0}}}',
    '{"jsonrpc":"2.0","id":7.0,"method":"tools/call","params":{"name":"run_code","arguments":{"code":2.0}}}',
    '{"jsonrpc":"2.0","id":8.0,"method":"tools/call","params":{"name":"read_file","arguments":{}}}',
    '{"jsonrpc":"2.0","id":9.0,"method":"tools/call","params":{"name":"write_file","arguments":{"path":"/a"}}}',
    '{"jsonrpc":"2.0","id":10.0,"method":"tools/call","params":{"name":"run_command","arguments":{"command":2.0}}}',
    '{"jsonrpc":"2.0","id":11.0,"method":"tools/call","params":{"name":"run_command","arguments":{"command":12345678901234567890}}}',
    '{"jsonrpc":"2.0","id":[1.0],"method":"tools/call","params":{"name":"run_code","arguments":[1.0]}}',
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{"x":1.0}}',
    '{"jsonrpc":"2.0","id":13.0,"method":"initialize","params":{"protocolVersion":2.0,"capabilities":{"2":1,"1":2},"clientInfo":{"name":"c","version":1.0}}}',
    '{"jsonrpc":"2.0","id":14.0,"method":"ping","params":{"b":1.0,"a":2.0}}',
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    home = tempfile.mkdtemp(prefix="ebx-mcp-gen-")
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": home,
        "EBX_NO_KEYCHAIN": "1",
        "E2B_API_KEY": "stub-key",
        "E2B_API_URL": "http://127.0.0.1:1",
        "SANDBOX_TEMPLATE": "stub-template",
        "NO_PROXY": "*",
        "no_proxy": "*",
    }
    proc = subprocess.Popen([sys.executable, "-m", "easy_sandbox.agent.mcp"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, cwd=home, text=True)
    cases = []
    for line in LINES:
        proc.stdin.write(line + "\n")
        proc.stdin.flush()
        if '"id"' not in line:
            cases.append([line, None])
            continue
        cases.append([line, proc.stdout.readline().rstrip("\n")])
    proc.stdin.close()
    proc.wait(timeout=20)
    out = json.dumps({"cases": cases}, ensure_ascii=False, indent=0)
    (open(args.out, "w", encoding="utf-8") if args.out else sys.stdout).write(out)


if __name__ == "__main__":
    main()

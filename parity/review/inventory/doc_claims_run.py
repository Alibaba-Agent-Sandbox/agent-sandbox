#!/usr/bin/env python3
"""Run every documented `ebx ...` line (from doc_claims.py --json) with `--help` appended against the Node CLI
(and the Python oracle when ORACLE_VENV is set) in an isolated HOME and compare exit code + stdout + stderr.
`--help` is eager, so this validates option syntax / command resolution at *runtime* without any network or side effect.

Usage: python3 doc_claims_run.py claims.json [--node dist/bin/ebx.js] [--limit N] [--user-facing-only]
Env:   ORACLE_VENV (optional)
"""
import json, os, subprocess, sys, tempfile, concurrent.futures as cf
from pathlib import Path
root = Path(__file__).resolve().parents[3]
claims = json.load(open(sys.argv[1]))
node_bin = root / "dist/bin/ebx.js"
if "--node" in sys.argv: node_bin = Path(sys.argv[sys.argv.index("--node") + 1])
if not node_bin.exists(): print("dist missing: npm run build", file=sys.stderr); sys.exit(0)
oracle = (Path(os.environ["ORACLE_VENV"]) / "bin/ebx") if os.environ.get("ORACLE_VENV") else None
if oracle and not oracle.exists(): oracle = None
def user_facing(f): return not ("/design/" in f or "/.agents" in f or f.startswith("docs/design") or "providers-and-credentials" in f)
seen = {}
for c in claims:
    if "--user-facing-only" in sys.argv and not user_facing(c["file"]): continue
    argv = [a for a in c["argv"] if a != "--help"]
    argv = ["X" if (a.startswith(("<", "[", "{", "$")) or a in ("...", "…", "---") or "…" in a) else a for a in argv]
    seen.setdefault(tuple(argv), c)
items = list(seen.items())
if "--limit" in sys.argv: items = items[: int(sys.argv[sys.argv.index("--limit") + 1])]

def clean_env(home):
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "LANG", "LC_ALL", "TERM")}
    env.update({"HOME": home, "EBX_NO_KEYCHAIN": "1", "NO_COLOR": "1", "COLUMNS": "100", "CI": "1"})
    return env
def run(cmd, argv):
    with tempfile.TemporaryDirectory() as home:
        try:
            p = subprocess.run(cmd + list(argv) + ["--help"], capture_output=True, text=True, timeout=40, env=clean_env(home), cwd=home, stdin=subprocess.DEVNULL)
            return p.returncode, p.stdout, p.stderr
        except subprocess.TimeoutExpired:
            return -999, "", "TIMEOUT"
def job(it):
    argv, c = it
    n = run(["node", str(node_bin)], argv)
    o = run([str(oracle)], argv) if oracle else None
    return argv, c, n, o
bad_node = []; diffs = []; n_ok = 0
with cf.ThreadPoolExecutor(6) as ex:
    for argv, c, n, o in ex.map(job, items):
        if n[0] != 0: bad_node.append((argv, c, n, o))
        if o is not None and n != o: diffs.append((argv, c, n, o))
        n_ok += n[0] == 0
print(f"distinct documented commands run with --help: {len(items)}; node exit 0: {n_ok}; node non-zero: {len(bad_node)}; node!=oracle: {len(diffs)}")
for argv, c, n, o in bad_node:
    print(f"NODE-NONZERO rc={n[0]} (oracle rc={o[0] if o else 'n/a'}) {c['file']}:{c['line']}: ebx {' '.join(argv)}  stderr={n[2].strip()[:120]!r}")
for argv, c, n, o in diffs:
    print(f"DIFF {c['file']}:{c['line']}: ebx {' '.join(argv)}  node rc={n[0]} oracle rc={o[0]}  stdout_same={n[1]==o[1]} stderr_same={n[2]==o[2]}")

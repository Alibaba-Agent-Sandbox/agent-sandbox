#!/usr/bin/env python3
"""Multiset comparison of exit-code call sites per module: Python (sys.exit/_sys.exit/raise SystemExit/ctx.exit) vs TS (sysExit/new SystemExit/ctx.exit).
Usage: ORIG_REPO=... python3 exit_sites.py   (TS side read from ../../../src)"""
import os, re, sys, collections
from pathlib import Path
o = os.environ.get("ORIG_REPO")
if not o: print("ORIG_REPO not set: skipping", file=sys.stderr); sys.exit(0)
py_root = Path(o) / "src/agent_sandbox"; ts_root = Path(__file__).resolve().parents[3] / "src"
PY = re.compile(r"\b_?sys\.exit\(([^()]*(?:\([^()]*\))?[^()]*)\)|raise SystemExit\(([^()]*)\)|ctx\.exit\(([^()]*)\)|raise SystemExit\b(?!\()")
TS = re.compile(r"\bsysExit\(([^()]*(?:\([^()]*\))?[^()]*)\)|new SystemExit\(([^()]*)\)|ctx\.exit\(([^()]*)\)")
def norm(a):
    a = (a or "").strip()
    return {"": "0/None"}.get(a, a.replace("result.exit_code", "result.exit_code").replace("result.exit_code", "RC"))
tot_py = tot_ts = 0; diffs = 0
for pf in sorted(py_root.rglob("*.py")):
    rel = pf.relative_to(py_root).with_suffix("")
    tf = ts_root / (str(rel) + ".ts")
    pc = collections.Counter(norm(next((g for g in m.groups() if g is not None), "")) for m in PY.finditer(pf.read_text()))
    if not pc: continue
    tc = collections.Counter()
    if tf.exists():
        tc = collections.Counter(norm(next((g for g in m.groups() if g is not None), "")) for m in TS.finditer(tf.read_text()))
    tot_py += sum(pc.values()); tot_ts += sum(tc.values())
    print(f"{rel}: python={dict(pc)}  node={dict(tc)}")
print("total python exit sites", tot_py, "node", tot_ts)

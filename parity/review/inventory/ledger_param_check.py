#!/usr/bin/env python3
"""Check that every raw ledger id (incl. each pytest parameter) has >= as many Node test instances as Python had.
Reads parity/.vitest-report.json (run `npm run parity:coverage` first) and parity/python-tests-to-port.txt.
For ledger entry  tests/a/b.py::Cls::test_x[p1]  the Node file is tests/a/b.test.ts, ancestor titles [Cls], title test_x*.
Groups by base id: python param count vs Node instance count.
"""
import json, re, sys, collections
from pathlib import Path
root = Path(__file__).resolve().parents[3]
rep = root / "parity/.vitest-report.json"
if not rep.exists():
    print("no vitest report; run npm run parity:coverage", file=sys.stderr); sys.exit(0)
data = json.load(open(rep))
node = collections.defaultdict(int)
node_titles = collections.defaultdict(list)
for f in data["testResults"]:
    rel = f["name"][len(str(root)) + 1:]
    for t in f["assertionResults"]:
        anc = tuple(t.get("ancestorTitles") or [])
        title = t["title"]
        base = re.sub(r"\s*\[.*$", "", title, flags=re.S)
        key = (rel, anc, base)
        node[key] += 1
        node_titles[key].append(title)
py = collections.defaultdict(list)
for line in (root / "parity/python-tests-to-port.txt").read_text().splitlines():
    line = line.strip()
    if not line: continue
    base = re.sub(r"\[.*$", "", line, flags=re.S)
    py[base].append(line)
short = []; ok = 0; total_py = 0; total_node_matched = 0
moved = set(l.split(" -> ")[0].strip().split("[")[0] for l in (root/"parity/moved-to-python-sdk.txt").read_text().splitlines() if "->" in l and not l.startswith("#"))
for base, lines in sorted(py.items()):
    if base in moved: continue
    parts = base.split("::")
    f = parts[0][:-3] + ".test.ts" if parts[0].endswith(".py") else parts[0]
    anc = tuple(parts[1:-1]); name = parts[-1]
    n = node.get((f, anc, name), 0)
    total_py += len(lines); total_node_matched += min(n, len(lines))
    if n < len(lines):
        short.append((base, len(lines), n))
    else:
        ok += 1
print(f"base ids: {len(py)-len(moved & set(py))}  fully matched (node instances >= python params): {ok}  short: {len(short)}")
print(f"python raw ids (non-moved): {total_py}  node instances matched: {total_node_matched}")
for b, p, n in short: print(f"SHORT {b}: python params={p} node instances={n}")

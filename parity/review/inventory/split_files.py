#!/usr/bin/env python3
"""File-level inventory: every git-tracked file of the ORIGINAL repo -> where it lives after the split.

Usage: ORIG_REPO=/path/to/original NEW_REPO=/path/to/new-monorepo-root python3 split_files.py [--json]
NEW_REPO defaults to the monorepo root that contains this script (../../../..).
Output: TSV-like markdown table rows, one per original file:  orig | status | new location(s)
Status: SAME (identical bytes), MOVED, CHANGED (same path, different content), PORTED (.py->.ts), MISSING.
"""
import hashlib, json, os, subprocess, sys
from pathlib import Path

ORIG = Path(os.environ.get("ORIG_REPO", "")).resolve() if os.environ.get("ORIG_REPO") else None
if ORIG is None or not ORIG.is_dir():
    print("ORIG_REPO not set / absent: skipping", file=sys.stderr); sys.exit(0)
NEW = Path(os.environ.get("NEW_REPO") or Path(__file__).resolve().parents[4])

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

orig_files = subprocess.check_output(["git", "-C", str(ORIG), "ls-files"], text=True).splitlines()

def candidates(rel):
    out = []
    parts = rel.split("/")
    if rel.startswith("src/agent_sandbox/"):
        sub = rel[len("src/"):]
        out += [f"python-sdk/client-sdk/src/{sub}", f"python-sdk/server-sdk/src/{sub}"]
        if rel.endswith(".py"):
            out.append("cli/src/" + sub[len("agent_sandbox/"):][:-3] + ".ts")
    elif rel.startswith("tests/"):
        sub = rel[len("tests/"):]
        out += [f"python-sdk/client-sdk/tests/{sub}", f"python-sdk/server-sdk/tests/{sub}", f"cli/tests/{sub}"]
        if rel.endswith(".py"):
            out.append(f"cli/tests/{sub[:-3]}.test.ts")
    elif rel.startswith("docs/"):
        out += [f"python-sdk/{rel}", f"cli/{rel}"]
    elif rel.startswith("scripts/"):
        out += [f"python-sdk/{rel}", f"cli/{rel}", f"cli/{rel[:-3]}.mjs" if rel.endswith(".py") else ""]
    else:
        out += [f"python-sdk/{rel}", f"cli/{rel}", rel]
    return [c for c in out if c]

rows = []
for rel in orig_files:
    op = ORIG / rel
    if not op.exists():
        rows.append((rel, "DELETED-IN-ORIG-WORKTREE", [])); continue
    found = []
    for c in candidates(rel):
        p = NEW / c
        if p.exists():
            found.append((c, sha(p) == sha(op) if p.is_file() and op.is_file() else None))
    rows.append((rel, found, None))

import difflib
_skip = ("node_modules", "__pycache__", ".mypy_cache", ".ruff_cache", ".pytest_cache", "/dist/", ".git/")
_index = {}
for dp, dn, fn in os.walk(NEW):
    dn[:] = [d for d in dn if d not in ("node_modules", "__pycache__", ".mypy_cache", ".ruff_cache", ".pytest_cache", ".git", "dist", ".venv")]
    for f in fn:
        rp = os.path.relpath(os.path.join(dp, f), NEW)
        if rp.startswith(("python-sdk/", "cli/")):
            _index.setdefault(f, []).append(rp)

def by_name(rel):
    b = os.path.basename(rel)
    if b in ("__init__.py", "conftest.py"):
        d = os.path.dirname(rel)
        twin = ("cli/tests/" + d[len("tests/"):] + "/conftest.ts") if b == "conftest.py" and d.startswith("tests/") else None
        if twin and (NEW / twin).exists(): return [twin]
        return []
    stem = b.rsplit(".", 1)[0]
    names = [b, stem + ".mjs", stem + ".ts", stem + ".test.ts", stem.replace("_", "-") + ".mjs", stem.replace("_", "-") + ".ts"]
    out = []
    for n in names: out += _index.get(n, [])
    return sorted(set(out))

def diffstat(a, b):
    try:
        x = a.read_text(encoding="utf-8").splitlines(); y = b.read_text(encoding="utf-8").splitlines()
    except Exception:
        return ""
    rem = add = 0
    for l in difflib.unified_diff(x, y, lineterm="", n=0):
        if l.startswith("-") and not l.startswith("---"): rem += 1
        elif l.startswith("+") and not l.startswith("+++"): add += 1
    return f"-{rem}/+{add}"

res = []
for rel, found, _ in rows:
    if found == "DELETED-IN-ORIG-WORKTREE" or not found:
        alt = by_name(rel)
        res.append({"orig": rel, "status": "RELOCATED" if alt else "MISSING", "new": alt, "diff": ""})
        continue
    st = "SAME" if any(f[1] for f in found) else ("PORTED" if all(f[0].endswith(".ts") for f in found) else "CHANGED")
    ds = "" if st != "CHANGED" else diffstat(ORIG / rel, NEW / [f[0] for f in found if not f[1]][0])
    res.append({"orig": rel, "status": st, "new": [f[0] for f in found], "diff": ds})

if "--json" in sys.argv:
    print(json.dumps(res, indent=1))
else:
    for r in res:
        print(f"{r['orig']}\t{r['status']}\t{', '.join(r['new'])}\t{r.get('diff','')}")

#!/usr/bin/env python3
"""Compare test function bodies between the ORIGINAL repo tests/ and the new python-sdk (client-sdk/tests, server-sdk/tests).
Usage: ORIG_REPO=... NEW_REPO=... python3 py_test_bodies.py
Prints: identical / modified / removed counts, and the list of modified + removed test functions.
"""
import ast, os, sys, collections
from pathlib import Path
ORIG = os.environ.get("ORIG_REPO")
if not ORIG or not Path(ORIG).is_dir():
    print("ORIG_REPO not set: skipping", file=sys.stderr); sys.exit(0)
ORIG = Path(ORIG)
NEW = Path(os.environ.get("NEW_REPO") or Path(__file__).resolve().parents[4])

def funcs(path):
    out = {}
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except Exception as e:
        return out
    def walk(node, prefix):
        for ch in ast.iter_child_nodes(node):
            if isinstance(ch, ast.ClassDef):
                walk(ch, prefix + ch.name + "::")
            elif isinstance(ch, (ast.FunctionDef, ast.AsyncFunctionDef)):
                out[prefix + ch.name] = ast.dump(ch)
                walk(ch, prefix + ch.name + ".")
    walk(tree, "")
    return out

res = collections.defaultdict(list)
for f in sorted((ORIG / "tests").rglob("test_*.py")):
    rel = f.relative_to(ORIG / "tests")
    of = funcs(f)
    for root in ("python-sdk/client-sdk/tests", "python-sdk/server-sdk/tests"):
        nf = NEW / root / rel
        if nf.exists():
            nfn = funcs(nf)
            for name, dump in of.items():
                if not name.split("::")[-1].startswith("test_") and "::test_" not in name:
                    continue
                if name in nfn:
                    res["identical" if nfn[name] == dump else "modified"].append(f"{root}/{rel}::{name}")
                else:
                    res["removed_from_file"].append(f"{root}/{rel}::{name}")
            break
    else:
        res["file_not_in_python_sdk"].append(str(rel))
for k, v in res.items():
    print(f"## {k}: {len(v)}")
    if k != "identical":
        for x in v: print("  ", x)

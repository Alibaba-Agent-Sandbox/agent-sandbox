#!/usr/bin/env python3
"""Symbol-level diff of the ORIGINAL python package vs the split SDK (client-sdk + server-sdk src trees).

For every original module that still exists in client-sdk/server-sdk: report classes/functions/methods/constants
that disappeared, `__all__` entries that disappeared, public function signature changes (removed parameters,
changed defaults). Modules that no longer exist are listed as ABSENT (CLI-owned or dropped).
Usage: ORIG_REPO=... NEW_REPO=... python3 py_symbols_split.py [--json]
"""
import ast, json, os, sys
from pathlib import Path
O = os.environ.get("ORIG_REPO")
if not O or not Path(O).is_dir(): print("ORIG_REPO not set: skipping", file=sys.stderr); sys.exit(0)
O = Path(O) / "src"; N = Path(os.environ.get("NEW_REPO") or Path(__file__).resolve().parents[4]) / "python-sdk"
roots = [N / "client-sdk/src", N / "server-sdk/src"]

def sig(fn):
    a = fn.args
    names = [x.arg for x in a.posonlyargs + a.args + a.kwonlyargs]
    if a.vararg: names.append("*" + a.vararg.arg)
    if a.kwarg: names.append("**" + a.kwarg.arg)
    defaults = [ast.unparse(d) for d in a.defaults + [d for d in a.kw_defaults if d is not None]]
    return names, defaults

def collect(path):
    t = ast.parse(path.read_text(encoding="utf-8"))
    out = {"classes": {}, "functions": {}, "consts": set(), "all": None}
    for n in t.body:
        if isinstance(n, ast.ClassDef):
            out["classes"][n.name] = {m.name: sig(m) for m in n.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))}
            out["classes"][n.name]["__attrs__"] = ([x.id for s in n.body if isinstance(s, (ast.Assign, ast.AnnAssign))
                for x in ([s.target] if isinstance(s, ast.AnnAssign) else s.targets) if isinstance(x, ast.Name)], None)
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)): out["functions"][n.name] = sig(n)
        elif isinstance(n, (ast.Assign, ast.AnnAssign)):
            for x in ([n.target] if isinstance(n, ast.AnnAssign) else n.targets):
                if isinstance(x, ast.Name):
                    out["consts"].add(x.id)
                    if x.id == "__all__":
                        try: out["all"] = list(ast.literal_eval(n.value))
                        except Exception: pass
    return out

res = {"absent": [], "removed": [], "sigchanges": [], "same_modules": 0, "compared": 0}
for f in sorted((O / "easy_sandbox").rglob("*.py")):
    rel = f.relative_to(O)
    cand = [r / rel for r in roots if (r / rel).exists()]
    if not cand: res["absent"].append(str(rel)); continue
    o = collect(f); n = collect(cand[0]); res["compared"] += 1
    for c, ms in o["classes"].items():
        if c not in n["classes"]: res["removed"].append(f"{rel}: class {c}"); continue
        for m, s in ms.items():
            if m not in n["classes"][c]: res["removed"].append(f"{rel}: {c}.{m}")
            elif m != "__attrs__" and s != n["classes"][c][m]:
                (on, od), (nn, nd) = s, n["classes"][c][m]
                res["sigchanges"].append(f"{rel}: {c}.{m} params {on}->{nn}" if on != nn else f"{rel}: {c}.{m} defaults {od}->{nd}")
    for fn, s in o["functions"].items():
        if fn not in n["functions"]: res["removed"].append(f"{rel}: def {fn}")
        elif s != n["functions"][fn]:
            (on, od), (nn, nd) = s, n["functions"][fn]
            res["sigchanges"].append(f"{rel}: {fn} params {on}->{nn}" if on != nn else f"{rel}: {fn} defaults {od}->{nd}")
    for c in sorted(o["consts"] - n["consts"]): res["removed"].append(f"{rel}: const {c}")
    if o["all"] is not None:
        miss = set(o["all"]) - set(n["all"] or [])
        if miss: res["removed"].append(f"{rel}: __all__ lost {sorted(miss)}")
if "--json" in sys.argv: print(json.dumps(res, indent=1))
else:
    print(f"compared modules: {res['compared']}  absent in split: {len(res['absent'])}  removed symbols: {len(res['removed'])}  signature changes: {len(res['sigchanges'])}")
    for k in ("absent", "removed", "sigchanges"):
        print(f"## {k}")
        for x in res[k]: print("  " + x)

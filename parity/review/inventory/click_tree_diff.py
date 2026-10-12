#!/usr/bin/env python3
"""Diff two click_tree JSON dumps (python oracle vs node). Usage: click_tree_diff.py py.json node.json [--md]"""
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
def flat(n, out):
    out[n["path"]] = n
    for c in n.get("children", []): flat(c, out)
    return out
import inspect, re
def norm(v):
    if isinstance(v, str):
        if v == "Sentinel.UNSET": return None
        v = re.sub(r"(Choice\(.*?)(\))$", lambda m: m.group(0), v)
        v = v.replace('["', "['").replace('"]', "']").replace('","', "', '").replace("=true", "=True").replace("=false", "=False")
        v = v.replace("case_sensitive=false", "case_sensitive=False").replace("case_sensitive=true", "case_sensitive=True")
        return inspect.cleandoc(v)
    if isinstance(v, list): return [norm(x) for x in v]
    return v
def normtree(n):
    for k in ("help", "short_help", "epilog"):
        n[k] = norm(n.get(k))
    for q in n["params"]:
        for f in list(q):
            q[f] = norm(q[f])
    for c in n.get("children", []): normtree(c)
normtree(a); normtree(b)
A, B = flat(a, {}), flat(b, {})
rows = []
for p in sorted(set(A) | set(B)):
    if p not in B: rows.append((p, "MISSING-IN-NODE", "")); continue
    if p not in A: rows.append((p, "EXTRA-IN-NODE", "")); continue
    x, y = A[p], B[p]
    for k in ("type", "name", "help", "short_help", "epilog", "hidden", "deprecated", "subcommands", "context_settings"):
        if x.get(k) != y.get(k):
            if k == "type" : continue
            rows.append((p, f"cmd.{k}", f"py={x.get(k)!r} node={y.get(k)!r}"))
    xp = {(q["kind"], q["name"]): q for q in x["params"]}; yp = {(q["kind"], q["name"]): q for q in y["params"]}
    if [ (q["kind"], q["name"]) for q in x["params"]] != [ (q["kind"], q["name"]) for q in y["params"]]:
        rows.append((p, "params.order/set", f"py={[q['name'] for q in x['params']]} node={[q['name'] for q in y['params']]}"))
    for key in xp:
        if key not in yp: rows.append((p, f"param {key[1]}", "MISSING-IN-NODE")); continue
        for f, v in xp[key].items():
            if yp[key].get(f) != v:
                rows.append((p, f"param {key[1]}.{f}", f"py={v!r} node={yp[key].get(f)!r}"))
print(f"commands: py={len(A)} node={len(B)}; params py={sum(len(n['params']) for n in A.values())} node={sum(len(n['params']) for n in B.values())}; differences={len(rows)}")
for r in rows: print(" | ".join(r))

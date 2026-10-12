#!/usr/bin/env python3
"""Diff py-inventory.json (py_inventory.py) against ts-inventory.json (ts_inventory.mjs).
Usage: python3 cli_compare.py py-inventory.json ts-inventory.json [--json out.json]
Prints a machine summary and writes the per-category result JSON when --json is given.
"""
import json, re, sys, collections

py = json.load(open(sys.argv[1])); ts = json.load(open(sys.argv[2]))
DROPPED_PREFIXES = ("easy_sandbox.compat", "easy_sandbox.declarative", "easy_sandbox.extensions", "easy_sandbox.server",
                    "easy_sandbox.agent.builtin", "easy_sandbox.agent.infer", "easy_sandbox.api.deploy")

def camel(s):
    lead = re.match(r"^_+", s).group(0) if s.startswith("_") else ""
    parts = s[len(lead):].split("_")
    return lead + parts[0] + "".join(p[:1].upper() + p[1:] for p in parts[1:])

def modfile(m):
    p = m.replace("easy_sandbox.", "", 1).replace(".", "/")
    if p == "easy_sandbox": return "index.ts"
    return p

res = {"modules": [], "symbols": [], "literals": [], "env": [], "exits": []}
tsfiles = ts["files"]
def ts_for(mod):
    p = modfile(mod)
    cands = [p + ".ts", p + "/index.ts"] if not p.endswith("__init__") else []
    if mod.endswith(".__init__"):
        d = modfile(mod[: -len(".__init__")])
        cands = [d + "/index.ts"] if d != "easy_sandbox" else ["index.ts"]
    return [c for c in cands if c in tsfiles]

alltsnames = collections.defaultdict(set)
for f, i in tsfiles.items():
    for k in ("classes", "functions", "methods", "variables", "types"):
        for n in i[k]: alltsnames[n].add(f)

inscope = {}
for mod, info in py["modules"].items():
    if mod.startswith(DROPPED_PREFIXES):
        res["modules"].append((mod, "dropped", "SDK/server-owned; not reached by CLI (see PORTING.md 'Module mirroring' / KNOWN-GAPS)"))
        continue
    t = ts_for(mod)
    if not t:
        # __init__ re-export modules may have no symbols
        empty = not (info["classes"] or info["functions"] or [c for c in info["constants"] if c != "__all__"])
        res["modules"].append((mod, "reexport-only" if empty else "MISSING", ""))
        if not empty: pass
        inscope[mod] = []
        continue
    res["modules"].append((mod, "present", ", ".join(t)))
    inscope[mod] = t

for mod, t in inscope.items():
    info = py["modules"][mod]
    names = []
    for c in info["classes"]:
        names.append(("class", c["name"], c["name"]))
        for m in c["methods"]:
            if m.startswith("__") and m.endswith("__"): continue
            names.append(("method", f"{c['name']}.{m}", m))
        for a in c.get("attrs", []):
            names.append(("class-attr", f"{c['name']}.{a}", a))
    for f in info["functions"]: names.append(("function", f["name"], f["name"]))
    for n in info.get("nested_functions", []): pass
    for c in info["constants"]:
        if c.startswith("__"): continue
        names.append(("constant", c, c))
    tsnames = set()
    for f in t:
        for k in ("classes", "functions", "methods", "variables", "types"): tsnames |= set(tsfiles[f][k])
    for kind, full, n in names:
        cands = [n, camel(n), n.lstrip("_"), camel(n).lstrip("_"), "_" + camel(n).lstrip("_")]
        hit = next((c for c in cands if c in tsnames), None)
        where = "same module"
        if hit is None:
            low = {x.lower().lstrip("_"): x for x in tsnames}
            h = low.get(n.lower().replace("_", "").lstrip("_"))
            if h: hit = h
        if hit is None:
            for c in cands:
                if c in alltsnames: hit = c; where = "elsewhere: " + ",".join(sorted(alltsnames[c])[:2]); break
        if hit is None:
            res["symbols"].append((mod, kind, full, "MISSING", ""))
        else:
            res["symbols"].append((mod, kind, full, "present" if hit == n else "renamed", f"{hit} ({where})"))

# ---- literals
corpus_lits = [l["text"] for l in ts["literals"]]
_names = set()
for _f, _i in tsfiles.items():
    for _k in ("classes", "functions", "methods", "variables", "types"): _names |= set(_i[_k])
_names |= {e["name"] for e in ts["env_reads"]}
corpus_lits += sorted(_names)
J = "\x00".join(corpus_lits)
def squash(s): return re.sub(r"\s+", "", s)
JS = squash("".join(corpus_lits))
litset = set(corpus_lits)
def present(text):
    if text in litset or text in J: return "exact"
    t = text.strip()
    if t and (t in litset or t in J): return "stripped"
    sq = squash(text)
    if not sq: return "blank"
    if sq in JS: return "joined"
    lines = [l for l in re.split(r"\n+", text) if squash(l)]
    if len(lines) > 1 and all(squash(l) in JS for l in lines): return "per-line"
    segs = [x for x in re.split(r"\{[^{}]*\}|%[sdrif]|%\([a-z_]+\)[sdrif]", text) if squash(x)]
    if len(segs) > 1 or (segs and segs[0] != text):
        if all(squash(x) in JS for x in segs): return "segments"
    return None

scope_mods = set(inscope)
missing_lits = []
stats = collections.Counter()
for l in py["literals"]:
    if l["module"] not in scope_mods: stats[("dropped-module", l["kind"])] += 1; continue
    r = present(l["text"])
    stats[(("present" if r else "MISSING"), l["kind"])] += 1
    if not r: missing_lits.append(l)
# strength check: long message literals should live in the TS file(s) mirroring the Python module
perfile = collections.defaultdict(list)
for l in ts["literals"]: perfile[l["file"]].append(l["text"])
relocated = []
for l in py["literals"]:
    if l["module"] not in scope_mods or l["kind"] != "message" or len(l["text"]) < 12: continue
    if any(l is m for m in missing_lits): continue
    own = "".join(squash(x) for f in inscope[l["module"]] for x in perfile[f])
    segs = [x for x in re.split(r"\{[^{}]*\}|%[sdrif]|%\([a-z_]+\)[sdrif]", l["text"]) if squash(x)] or [l["text"]]
    if not all(squash(x) in own for x in segs): relocated.append(l)
res["relocated"] = relocated
res["literals"] = missing_lits
res["literal_stats"] = {f"{a}/{b}": v for (a, b), v in stats.items()}

# ---- env
tsenv = {e["name"] for e in ts["env_reads"]} | litset
pyenv = {}
for e in py["env_reads"]:
    if e["module"] in scope_mods: pyenv.setdefault(e["name"], []).append(f"{e['module']}:{e['line']}")
for l in py["literals"]:
    if l["kind"] == "env" and l["module"] in scope_mods and l["text"] not in pyenv: pyenv.setdefault(l["text"], []).append(f"{l['module']}:{l['line']}(literal)")
for n, locs in sorted(pyenv.items()):
    res["env"].append((n, "present" if n in tsenv else "MISSING", ", ".join(locs[:3])))

res["py_exits"] = [e for e in py["exits"] if e["module"] in scope_mods]
res["ts_exits"] = ts["exits"]
json.dump(res, open(sys.argv[sys.argv.index("--json") + 1], "w") if "--json" in sys.argv else sys.stdout, ensure_ascii=False, indent=1)
if "--json" in sys.argv:
    c = collections.Counter(m[1] for m in res["modules"]); print("modules", dict(c))
    c = collections.Counter(s[3] for s in res["symbols"]); print("symbols", dict(c))
    print("literal stats", json.dumps(res["literal_stats"], indent=0))
    c = collections.Counter(e[1] for e in res["env"]); print("env", dict(c))

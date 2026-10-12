#!/usr/bin/env python3
"""Offline relative-link + anchor checker for Markdown trees.
Usage: python3 md_links.py <root> [<root> ...]   (skips node_modules, .git, dist, __pycache__, .venv)
Prints BROKEN lines: file:line -> target (reason). Exit 0 always.
"""
import os, re, sys
from pathlib import Path
LINK = re.compile(r"(?<!\!)\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)|(?<=\])\:\s*(\S+)|!\[[^\]]*\]\(([^)\s]+)\)")
def slug(h):
    h = h.strip().lower()
    h = re.sub(r"[`*_~]", "", h)
    h = re.sub(r"[^\w\- 　一-鿿]", "", h, flags=re.U)
    return h.replace(" ", "-")
def anchors(p, cache={}):
    if p in cache: return cache[p]
    a = set(); seen = {}
    infence = False
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.lstrip().startswith("```"): infence = not infence; continue
        if infence: continue
        m = re.match(r"^#{1,6}\s+(.*?)\s*#*$", line)
        if m:
            s = slug(m.group(1)); n = seen.get(s, 0); seen[s] = n + 1
            a.add(s if n == 0 else f"{s}-{n}")
    for m in re.finditer(r'<a\s+(?:name|id)="([^"]+)"', p.read_text(encoding="utf-8", errors="replace")): a.add(m.group(1))
    cache[p] = a; return a
total = broken = 0
for root in map(Path, sys.argv[1:]):
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in ("node_modules", ".git", "dist", "__pycache__", ".venv", ".mypy_cache")]
        for f in fn:
            if not f.endswith(".md"): continue
            p = Path(dp) / f
            infence = False
            for i, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                if line.lstrip().startswith("```"): infence = not infence; continue
                if infence: continue
                for m in LINK.finditer(line):
                    t = next(g for g in m.groups() if g)
                    if re.match(r"^(https?:|mailto:|tel:|#?$)", t) and not t.startswith("#"): continue
                    if t.startswith(("http://", "https://", "mailto:", "<")): continue
                    total += 1
                    path, _, frag = t.partition("#")
                    if path == "": tgt = p
                    else:
                        tgt = (p.parent / path.split("?")[0])
                    if not tgt.exists():
                        broken += 1; print(f"BROKEN {p.relative_to(root.parent) if root.parent in p.parents else p}:{i} -> {t} (missing file)"); continue
                    if frag and tgt.is_file() and tgt.suffix == ".md" and frag not in anchors(tgt) and slug(frag) not in anchors(tgt):
                        broken += 1; print(f"BROKEN {p.relative_to(root.parent) if root.parent in p.parents else p}:{i} -> {t} (missing anchor)")
print(f"links checked: {total}  broken: {broken}")

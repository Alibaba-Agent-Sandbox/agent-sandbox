#!/usr/bin/env python3
"""Check backticked repo-path claims in Markdown/txt files exist.
Usage: python3 doc_paths.py <project-root> [extra-root ...]   (checks every *.md/*.txt under project-root except node_modules/.git/dist)
A claim is a backticked token that starts with one of src/ tests/ scripts/ docs/ parity/ e2e/ benchmarks/ .github/ client-sdk/ server-sdk/ examples/ or is a known top-level filename;
globs are expanded; `path:line` suffixes and `::symbol` suffixes are stripped. Extra roots are searched as fallbacks.
"""
import glob, os, re, sys
from pathlib import Path
root = Path(sys.argv[1]).resolve(); extras = [Path(p).resolve() for p in sys.argv[2:]]
PRE = ("src/", "tests/", "scripts/", "docs/", "parity/", "e2e/", "benchmarks/", ".github/", "client-sdk/", "server-sdk/", "examples/", "dist/")
TOP = {"package.json", "tsconfig.json", "tsconfig.build.json", "vitest.config.ts", "eslint.config.js", "Makefile", "SKILL.md", "llms.txt",
       "AGENTS.md", "README.md", "README.zh-CN.md", "CHANGELOG.md", "LICENSE", "NOTICE", "pyproject.toml", ".env.example", ".gitignore"}
miss = 0; total = 0
for dp, dn, fn in os.walk(root):
    dn[:] = [d for d in dn if d not in ("node_modules", ".git", "dist", "__pycache__", ".venv", ".mypy_cache", ".agents")]
    for f in fn:
        if not f.endswith((".md", ".txt")): continue
        p = Path(dp) / f
        for i, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for m in re.finditer(r"`([^`\s]+)`", line):
                t = m.group(1).rstrip(".,;:)")
                t = re.sub(r"(:\d+(-\d+)?|::\w+.*)$", "", t)
                if "://" in t or t.startswith(("~", "/", "$", "<", "-")) or "<" in t or "{" in t or "$" in t: continue
                if not (t.startswith(PRE) or t in TOP): continue
                total += 1
                cands = [root / t] + [e / t for e in extras]
                ok = any(glob.glob(str(c)) or Path(c).exists() for c in cands)
                if not ok and t.endswith("/"): ok = any(Path(c).is_dir() for c in cands)
                if not ok:
                    miss += 1; print(f"MISSING {p.relative_to(root)}:{i}: `{t}`")
print(f"path claims: {total}; missing: {miss}")

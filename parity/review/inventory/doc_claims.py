#!/usr/bin/env python3
"""Static validation of every documented `ebx ...` command line against a click_tree JSON dump.

Usage: python3 doc_claims.py <tree.json> <md-or-txt file|dir> [...] [--only-bad] [--json out.json]
Extracts commands from fenced code blocks (`ebx ...`, `$ ebx ...`) and inline code spans that start with `ebx `,
joins `\\` continuations, tokenises with shlex, cuts at shell operators, then walks the command tree:
  * command path must resolve (unknown subcommand => UNKNOWN-COMMAND)
  * every `-x` / `--long[=v]` token must exist on the resolved command or one of its parents (=> UNKNOWN-OPTION)
Placeholders (<X>, [X], X..., $VAR) are treated as positionals.
"""
import json, os, re, shlex, sys
from pathlib import Path

args = [a for a in sys.argv[1:] if not a.startswith("--")]
only_bad = "--only-bad" in sys.argv
tree = json.load(open(args[0]))
paths = [Path(p) for p in args[1:]]

def index(n, out):
    out[n["path"]] = n
    for c in n.get("children", []): index(c, out)
    return out
IDX = index(tree, {})

def opt_table(node):
    t = {}
    for p in node["params"]:
        if p["kind"] != "option": continue
        for o in p["opts"] + p.get("secondary_opts", []):
            t[o] = p
    return t
HELP = {"--help": {"is_flag": True}}

PLACEHOLDER = re.compile(r"^(<.*|\[.*|\.\.\.|…|---|.*\.\.\.|\{.*|\$.*|.*/.*)$")

def help_names(chain):
    names = set()
    for n in chain:
        names |= set((n.get("context_settings") or {}).get("help_option_names") or [])
    return names

def walk(tokens):
    node = tree; path = ["ebx"]; i = 0; chain = [node]; issues = []
    # global-option consumption before/between commands
    while i < len(tokens):
        t = tokens[i]
        if t == "--": break
        if t.startswith("-"):
            name = t.split("=", 1)[0]
            tab = {}
            for n in chain: tab.update(opt_table(n))
            tab.update(HELP)
            for hn in help_names(chain): tab[hn] = {"is_flag": True}
            if any((n.get("context_settings") or {}).get("ignore_unknown_options") for n in chain) and name not in tab:
                i += 1; continue
            if name in tab:
                p = tab[name]
                takes = not p.get("is_flag", False) and not p.get("count", False) and "=" not in t
                i += 2 if takes else 1
                continue
            if re.fullmatch(r"-[A-Za-z]{2,}", t) and all(("-" + c) in tab for c in t[1:]):
                i += 1; continue
            if re.fullmatch(r"-[A-Za-z][^\s]+", t) and ("-" + t[1]) in tab and not tab["-" + t[1]].get("is_flag", True):
                i += 1; continue
            issues.append(("UNKNOWN-OPTION", t, " ".join(path))); i += 1; continue
        subs = node.get("subcommands")
        if subs is not None:
            if t in subs:
                key = " ".join(path + [t])
                node = IDX[key]; path.append(t); chain.append(node); i += 1; continue
            if PLACEHOLDER.match(t): return " ".join(path), issues
            if True:
                issues.append(("UNKNOWN-COMMAND", t, " ".join(path)))
                return " ".join(path), issues
        i += 1
    return " ".join(path), issues

SKIP_FIRST = {"--help"}
def split_cmd(line):
    line = line.strip()
    line = re.sub(r"^\$\s+", "", line)
    try:
        toks = shlex.split(line, comments=True, posix=True)
    except ValueError:
        try: toks = shlex.split(line + '"', comments=True)
        except ValueError: return None
    # drop leading env assignments
    while toks and re.match(r"^[A-Z_][A-Z0-9_]*=", toks[0]): toks = toks[1:]
    if not toks or toks[0] != "ebx": return None
    out = []
    for t in toks[1:]:
        if t in ("|", "||", "&&", ";", ">", ">>", "2>", "2>&1", "<", "&") or re.match(r"^\d?>", t): break
        out.append(t)
    return out

def extract(text):
    cmds = []
    lines = text.splitlines()
    infence = False; buf = ""; startline = 0
    for n, raw in enumerate(lines, 1):
        s = raw.strip()
        if s.startswith("```"):
            infence = not infence; buf = ""; continue
        if infence:
            if buf:
                buf += " " + s.rstrip("\\").strip(); 
                if not s.endswith("\\"): cmds.append((startline, buf)); buf = ""
                continue
            if re.match(r"^(\$\s+)?(([A-Z_][A-Z0-9_]*=\S+\s+)*)ebx(\s|$)", s):
                if s.endswith("\\"): buf = s.rstrip("\\").strip(); startline = n
                else: cmds.append((n, s))
        else:
            for m in re.finditer(r"`([^`]*\bebx\s[^`]*)`", raw):
                span = m.group(1).strip()
                if re.match(r"^(([A-Z_][A-Z0-9_]*=\S+\s+)*)ebx\s", span): cmds.append((n, span))
    return cmds

files = []
for p in paths:
    if p.is_dir():
        for dp, dn, fn in os.walk(p):
            dn[:] = [d for d in dn if d not in ("node_modules", ".git", "dist", ".agents")]
            files += [Path(dp) / f for f in fn if f.endswith((".md", ".txt"))]
    elif p.exists(): files.append(p)
total = bad = 0; rows = []
for f in sorted(files):
    for ln, c in extract(f.read_text(encoding="utf-8", errors="replace")):
        toks = split_cmd(c)
        if toks is None: continue
        total += 1
        cpath, issues = walk(toks)
        if issues: bad += 1
        rows.append({"file": str(f), "line": ln, "cmd": c, "argv": toks, "resolved": cpath, "issues": issues})
        if issues or not only_bad:
            print(f"{'BAD ' if issues else 'ok  '}{f}:{ln}: {c[:110]}  -> {cpath} {issues if issues else ''}")
print(f"documented ebx command lines: {total}; with issues: {bad}")
if "--json" in sys.argv:
    json.dump(rows, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)

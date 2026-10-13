#!/usr/bin/env python3
"""Machine inventory of the ORIGINAL Python package (ast only; imports nothing from it).

Usage: ORIG_REPO=/path/to/original python3 py_inventory.py > py-inventory.json
(also accepts a path argument pointing at a directory that contains agent_sandbox/ or src/agent_sandbox/)

JSON:
  modules   : {module: {path, classes:[{name,bases,methods:[..],line}], functions:[{name,line,async}], constants:[name],
                         dunder_all:[...], click_decorated:[{func,decorators:[unparsed]}]}}
  literals  : [{module,line,kind,context,text}]   every str constant (docstrings other than click-command help excluded);
              kind in {message,env,path,endpoint,identifier}
  env_reads : [{module,line,name,how}]
  exits     : [{module,line,code,how}]
"""
import ast, json, os, re, sys
from pathlib import Path

arg = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ORIG_REPO")
if not arg or not Path(arg).exists():
    print("ORIG_REPO not set / absent: skipping", file=sys.stderr); sys.exit(0)
base = Path(arg)
src = base / "src" / "agent_sandbox" if (base / "src" / "agent_sandbox").is_dir() else base / "agent_sandbox"

ENV_RE = re.compile(r"^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$|^[A-Z]{4,}$")
PATH_HINT = re.compile(r"(\.abx|\.toml|\.env\b|\.ya?ml|\.json\b|Dockerfile|\.dockerignore|~/|\.sh$|\.py$|\.md$|\.gz$|\.zip$|/tmp|\.cache)")
ENDPOINT = re.compile(r"^(/[A-Za-z0-9_{}\-./:]+|https?://\S+|wss?://\S+)$")

def call_name(n):
    f = n.func if isinstance(n, ast.Call) else n
    parts = []
    while isinstance(f, ast.Attribute):
        parts.append(f.attr); f = f.value
    if isinstance(f, ast.Name): parts.append(f.id)
    return ".".join(reversed(parts))

mods = {}; literals = []; env_reads = []; exits = []

def classify(text, ctx):
    if ctx.endswith(("environ.get", "getenv", "environ.pop", "environ.setdefault")) or ctx == "environ[]":
        return "env"
    if ENDPOINT.match(text): return "endpoint"
    if ENV_RE.match(text) and len(text) >= 4 and not text.isdigit(): return "env"
    if PATH_HINT.search(text) and " " not in text.strip(): return "path"
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_\-.]*", text): return "identifier"
    return "message"

for path in sorted(src.rglob("*.py")):
    rel = path.relative_to(src.parent)
    mod = ".".join(rel.with_suffix("").parts)
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    parent = {}
    for p in ast.walk(tree):
        for c in ast.iter_child_nodes(p): parent[c] = p
    info = {"path": str(rel), "classes": [], "functions": [], "constants": [], "dunder_all": [], "click_decorated": []}
    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            info["classes"].append({"name": node.name, "line": node.lineno, "bases": [ast.unparse(b) for b in node.bases],
                "methods": [n.name for n in node.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))],
                "attrs": [t.id for n in node.body if isinstance(n, (ast.Assign, ast.AnnAssign))
                          for t in ([n.target] if isinstance(n, ast.AnnAssign) else n.targets) if isinstance(t, ast.Name)]})
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            info["functions"].append({"name": node.name, "line": node.lineno, "async": isinstance(node, ast.AsyncFunctionDef)})
            decs = [ast.unparse(d) for d in node.decorator_list]
            if any(d.startswith(("click.", "cli.", "sandbox.", "config.", "template.", "mcp.", "files.", "process.", "system.", "region_options", "output_options")) or ".command" in d or ".group" in d for d in decs):
                info["click_decorated"].append({"func": node.name, "decorators": decs})
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = [node.target] if isinstance(node, ast.AnnAssign) else node.targets
            for t in targets:
                if isinstance(t, ast.Name):
                    info["constants"].append(t.id)
                    if t.id == "__all__":
                        try: info["dunder_all"] = list(ast.literal_eval(node.value))
                        except Exception: pass
    # nested functions too
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and parent.get(n) is not tree and not isinstance(parent.get(n), ast.ClassDef):
            info.setdefault("nested_functions", []).append(n.name)
    mods[mod] = info

    docstring_nodes = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and n.body \
           and isinstance(n.body[0], ast.Expr) and isinstance(getattr(n.body[0], "value", None), ast.Constant) \
           and isinstance(n.body[0].value.value, str):
            is_click_cmd = isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and any(
                (".command" in ast.unparse(d) or ".group" in ast.unparse(d) or "click.command" in ast.unparse(d)) for d in n.decorator_list)
            if not is_click_cmd:
                docstring_nodes.add(n.body[0].value)
    all_nodes = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__all__" for t in n.targets):
            for c in ast.walk(n.value): all_nodes.add(c)
    attr_doc = set()
    for n in ast.walk(tree):
        for body_owner in (n,):
            body = getattr(body_owner, "body", None)
            if isinstance(body, list):
                for prev, cur in zip(body, body[1:]):
                    if isinstance(prev, (ast.Assign, ast.AnnAssign)) and isinstance(cur, ast.Expr) \
                       and isinstance(getattr(cur, "value", None), ast.Constant) and isinstance(cur.value.value, str):
                        attr_doc.add(cur.value)
    fmt_spec = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.FormattedValue) and n.format_spec is not None:
            for c in ast.walk(n.format_spec): fmt_spec.add(c)
    annot = set()
    for n in ast.walk(tree):
        a = []
        if isinstance(n, ast.AnnAssign): a = [n.annotation]
        elif isinstance(n, ast.arg) and n.annotation is not None: a = [n.annotation]
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.returns is not None: a = [n.returns]
        for x in a:
            for c in ast.walk(x): annot.add(c)

    def enclosing_call(n):
        p = parent.get(n)
        while p is not None:
            if isinstance(p, ast.Call): return call_name(p)
            if isinstance(p, ast.Raise): return "raise"
            if isinstance(p, ast.Subscript):
                return "environ[]" if "environ" in ast.unparse(p.value) else "subscript"
            if isinstance(p, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Module)): return ""
            p = parent.get(p)
        return ""

    for n in ast.walk(tree):
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and n not in docstring_nodes and n not in all_nodes and n not in attr_doc and n not in fmt_spec and n not in annot:
            ctx = enclosing_call(n)
            kind = classify(n.value, ctx)
            if n.value == "": continue
            literals.append({"module": mod, "line": n.lineno, "kind": kind, "context": ctx, "text": n.value})
        if isinstance(n, ast.Call):
            cn = call_name(n)
            if cn in ("os.environ.get", "os.getenv", "environ.get", "os.environ.pop", "os.environ.setdefault", "os.environ.__getitem__") and n.args \
               and isinstance(n.args[0], ast.Constant) and isinstance(n.args[0].value, str):
                env_reads.append({"module": mod, "line": n.lineno, "name": n.args[0].value, "how": cn})
            if cn in ("sys.exit", "ctx.exit", "click.get_current_context().exit", "exit", "quit", "SystemExit", "click.exceptions.Exit", "Exit", "os._exit") :
                exits.append({"module": mod, "line": n.lineno, "how": cn, "code": ast.unparse(n.args[0]) if n.args else "None"})
            if "envvar" in [k.arg for k in n.keywords]:
                for k in n.keywords:
                    if k.arg == "envvar":
                        try:
                            v = ast.literal_eval(k.value)
                            for x in ([v] if isinstance(v, str) else v): env_reads.append({"module": mod, "line": n.lineno, "name": x, "how": "click.envvar"})
                        except Exception: pass
        if isinstance(n, ast.Subscript) and isinstance(n.value, ast.Attribute) and ast.unparse(n.value) == "os.environ":
            sl = n.slice
            if isinstance(sl, ast.Constant) and isinstance(sl.value, str):
                env_reads.append({"module": mod, "line": n.lineno, "name": sl.value, "how": "os.environ[]"})
        if isinstance(n, ast.Compare) and any(isinstance(o, (ast.In, ast.NotIn)) for o in n.ops) and any(ast.unparse(c) == "os.environ" for c in n.comparators) \
           and isinstance(n.left, ast.Constant) and isinstance(n.left.value, str):
            env_reads.append({"module": mod, "line": n.lineno, "name": n.left.value, "how": "in os.environ"})
        if isinstance(n, ast.Raise) and n.exc is not None and isinstance(n.exc, (ast.Call, ast.Name)):
            nm = call_name(n.exc) if isinstance(n.exc, ast.Call) else n.exc.id
            if nm in ("SystemExit", "click.exceptions.Exit", "Exit", "typer.Exit"):
                exits.append({"module": mod, "line": n.lineno, "how": "raise " + nm,
                              "code": ast.unparse(n.exc.args[0]) if isinstance(n.exc, ast.Call) and n.exc.args else "None"})

json.dump({"modules": mods, "literals": literals, "env_reads": env_reads, "exits": exits}, sys.stdout, ensure_ascii=False, indent=0)

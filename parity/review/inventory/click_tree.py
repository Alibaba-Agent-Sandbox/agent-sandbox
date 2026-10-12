#!/usr/bin/env python3
"""Dump the full click command tree of the ORIGINAL Python `ebx` (commands, groups, options, arguments, defaults,
types, envvars, help strings, aliases, hidden/deprecated flags) as JSON on stdout.

Usage: ORACLE_VENV=/path/to/venv  python3 click_tree.py   (re-execs itself with the oracle's interpreter)
       or run directly with an interpreter that can import easy_sandbox.cli.main.
Skips cleanly (exit 0, no output) when the oracle is absent.
"""
import json, os, sys
venv = os.environ.get("ORACLE_VENV")
if venv and os.path.realpath(sys.prefix) != os.path.realpath(venv):
    py = os.path.join(venv, "bin", "python")
    if not os.path.exists(py):
        print("ORACLE_VENV python not found: skipping", file=sys.stderr); sys.exit(0)
    os.execv(py, [py, __file__] + sys.argv[1:])
try:
    import click
    from easy_sandbox.cli.main import cli
except Exception as e:  # pragma: no cover
    print(f"oracle not importable ({e}): skipping", file=sys.stderr); sys.exit(0)

def jsonable(v):
    if v is None or isinstance(v, (bool, int, float, str)): return v
    if isinstance(v, (list, tuple)): return [jsonable(x) for x in v]
    if isinstance(v, dict): return {str(k): jsonable(x) for k, x in v.items()}
    if callable(v): return f"<callable {getattr(v,'__name__',v)}>"
    return repr(v)

def type_repr(t):
    n = type(t).__name__
    if isinstance(t, click.Choice): return f"Choice({list(t.choices)}, case_sensitive={t.case_sensitive})"
    if isinstance(t, click.IntRange): return f"IntRange({t.min},{t.max},clamp={t.clamp})"
    if isinstance(t, click.FloatRange): return f"FloatRange({t.min},{t.max})"
    if isinstance(t, click.Path): return f"Path(exists={t.exists},file_okay={t.file_okay},dir_okay={t.dir_okay},resolve={t.resolve_path})"
    return t.name if hasattr(t, "name") else n

def param(p):
    d = {"kind": "option" if isinstance(p, click.Option) else "argument", "name": p.name, "opts": list(p.opts),
         "secondary_opts": list(getattr(p, "secondary_opts", [])), "type": type_repr(p.type), "required": p.required,
         "default": jsonable(p.default), "multiple": p.multiple, "nargs": p.nargs, "envvar": jsonable(p.envvar),
         "metavar": p.metavar, "expose_value": p.expose_value}
    if isinstance(p, click.Option):
        d.update({"is_flag": p.is_flag, "flag_value": jsonable(p.flag_value), "count": p.count, "hidden": p.hidden,
                  "help": p.help, "show_default": jsonable(p.show_default), "prompt": jsonable(p.prompt),
                  "hide_input": p.hide_input, "is_eager": p.is_eager})
    return d

def walk(cmd, path, ctx_parent=None):
    ctx = click.Context(cmd, info_name=path[-1] if path else "ebx", parent=ctx_parent)
    d = {"path": " ".join(path), "type": type(cmd).__name__, "name": cmd.name, "help": cmd.help,
         "short_help": cmd.short_help, "epilog": cmd.epilog, "hidden": cmd.hidden,
         "deprecated": getattr(cmd, "deprecated", False), "context_settings": jsonable(cmd.context_settings),
         "params": [param(p) for p in cmd.params]}
    if isinstance(cmd, click.Group):
        names = cmd.list_commands(ctx)
        d["subcommands"] = names
        d["children"] = []
        for n in names:
            sub = cmd.get_command(ctx, n)
            if sub is not None:
                d["children"].append(walk(sub, path + [n], ctx))
    return d

print(json.dumps(walk(cli, ["ebx"]), indent=1, ensure_ascii=False))

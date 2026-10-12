"""Dump the FULL option/argument/command metadata of the oracle click tree as JSON (stdout).

Run with the oracle venv python and an isolated HOME. Companion: adv_commands_meta_dump.mjs (Node side).
"""
import json
import sys

import click
from click.core import UNSET as _UNSET  # click >= 8.3

from easy_sandbox.cli.main import cli


def jv(v):
    if v is _UNSET:
        return None
    if callable(v):
        return "<callable>"
    if isinstance(v, (str, int, bool)) or v is None:
        return v
    if isinstance(v, float):
        return {"__float__": repr(v)}
    if isinstance(v, (list, tuple)):
        return [jv(x) for x in v]
    if isinstance(v, dict):
        return {str(k): jv(x) for k, x in v.items()}
    if isinstance(v, (set, frozenset)):
        return sorted(jv(x) for x in v)
    return "<" + type(v).__name__ + ">"


def type_info(t):
    d = t.to_info_dict()
    return jv(d)


PARAM_ATTRS = [
    "name", "param_type_name", "opts", "secondary_opts", "required", "nargs", "multiple", "default", "envvar",
    "help", "hidden", "is_flag", "flag_value", "count", "is_eager", "expose_value", "deprecated", "show_default",
    "hide_input", "prompt", "confirmation_prompt", "show_choices", "show_envvar", "metavar", "allow_from_autoenv",
    "prompt_required", "_flag_needs_value",
]


def param_info(p, ctx):
    d = {}
    for a in PARAM_ATTRS:
        if hasattr(p, a):
            v = getattr(p, a)
            d[a] = jv(v)
    d["type"] = type_info(p.type)
    d["has_callback"] = p.callback is not None
    d["make_metavar"] = p.make_metavar(ctx) if hasattr(p, "make_metavar") else None
    if isinstance(p, click.Option):
        try:
            d["default_resolved"] = jv(p.get_default(ctx, call=False))
        except Exception as e:  # noqa
            d["default_resolved"] = "ERR " + type(e).__name__
        d["help_record"] = jv(p.get_help_record(ctx)) if not p.hidden else None
    return d


CMD_ATTRS = [
    "name", "help", "epilog", "short_help", "hidden", "deprecated", "no_args_is_help", "options_metavar",
    "add_help_option", "context_settings", "allow_extra_args", "allow_interspersed_args", "ignore_unknown_options",
    "invoke_without_command", "subcommand_metavar", "chain",
]


def cmd_info(cmd, path):
    ctx = click.Context(cmd, info_name=" ".join(path))
    d = {"class": "Group" if isinstance(cmd, click.Group) else "Command"}
    for a in CMD_ATTRS:
        if hasattr(cmd, a):
            d[a] = jv(getattr(cmd, a))
    d["has_callback"] = cmd.callback is not None
    d["params"] = [param_info(p, ctx) for p in cmd.get_params(ctx)]
    d["usage_pieces"] = jv(cmd.collect_usage_pieces(ctx))
    d["short_help_resolved"] = cmd.get_short_help_str(45) if hasattr(cmd, "get_short_help_str") else None
    if isinstance(cmd, click.Group):
        d["has_result_callback"] = cmd._result_callback is not None
        d["commands"] = {}
        for n in cmd.list_commands(ctx):
            sub = cmd.get_command(ctx, n)
            if sub is not None:
                d["commands"][n] = cmd_info(sub, path + [n])
    return d


if __name__ == "__main__":
    json.dump(cmd_info(cli, []), sys.stdout, indent=1, sort_keys=False, ensure_ascii=False)

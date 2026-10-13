"""Regenerate tests/fixtures/error_str_oracle.json from the ORIGINAL Python models/errors.py.

    /path/to/oracle-venv/bin/python parity/diff/error_str_gen.py > tests/fixtures/error_str_oracle.json

For every SandboxError subclass (discovered by introspection, so a new class cannot be forgotten) three constructor
variants are rendered: minimal, all base kwargs overridden, and a message with unicode / newlines.
"""
import inspect
import json
import sys

from agent_sandbox.models import errors as E

EXTRA_MIN = {
    "ProcessError": ({}, {"exit_code": 7, "stdout": "out", "stderr": "err"}),
    "CapabilityNotSupportedError": ({}, {}),
    "CommandNotFoundError": ({}, {"server_status": "unreachable"}),
    "EnvdRpcError": ({}, {"status_code": 500, "rpc_path": "/process.Process/Start", "envd_error": {"code": "unknown", "message": "boom"}, "body_text": "raw"}),
}
FIRST = {"CapabilityNotSupportedError": "network", "CommandNotFoundError": "deploy"}


def classes():
    out = []
    for name, obj in vars(E).items():
        if inspect.isclass(obj) and issubclass(obj, E.SandboxError) and obj.__module__ == E.__name__:
            out.append((name, obj))
    return out


def snapshot(exc):
    attrs = {k: v for k, v in vars(exc).items() if k not in ("message", "code", "suggestion", "docs_url")}
    return {
        "str": str(exc),
        "message": exc.message,
        "code": exc.code,
        "suggestion": exc.suggestion,
        "docs_url": exc.docs_url,
        "to_dict": exc.to_dict(),
        "args": list(exc.args),
        "attrs": attrs,
    }


cases = []
for name, cls in classes():
    first = FIRST.get(name, "something went wrong")
    min_kw, extra_kw = EXTRA_MIN.get(name, ({}, {}))
    variants = [
        ("minimal", [first], dict(min_kw)),
        ("overridden", [first], {**extra_kw, "code": "E9999", "suggestion": "try again", "docs_url": "https://example.test/doc"}),
        ("multiline", [first if name in FIRST else "line one\nline two \u00e9 \u4e2d\u6587"], {**extra_kw, "suggestion": "step 1\nstep 2"}),
    ]
    for label, args, kwargs in variants:
        if name == "CapabilityNotSupportedError" and label == "overridden":
            kwargs = {**kwargs, "message": "custom message"}
        exc = cls(*args, **kwargs)
        cases.append({"cls": name, "variant": label, "args": args, "kwargs": kwargs, "expected": snapshot(exc)})
        if label == "minimal" and name == "CapabilityNotSupportedError":
            exc = cls(*args, message="", suggestion="")
            cases.append({"cls": name, "variant": "empty-overrides", "args": args, "kwargs": {"message": "", "suggestion": ""}, "expected": snapshot(exc)})

json.dump({"classes": [n for n, _ in classes()], "cases": cases}, sys.stdout, ensure_ascii=False, indent=1, sort_keys=True)
print()

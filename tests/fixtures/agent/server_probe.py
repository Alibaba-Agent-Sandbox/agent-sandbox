"""Probe of the container-side ``agent_sandbox.server`` package for tests/test_agent/test_template_guide.test.ts.

Usage: ``python3 server_probe.py facts`` or ``python3 server_probe.py reference < commands.py``
(``PYTHONPATH`` must make ``agent_sandbox.server`` importable).
"""

from __future__ import annotations

import ast
import inspect
import json
import sys
from unittest.mock import patch


def facts() -> dict:
    import agent_sandbox.server as server_pkg
    from agent_sandbox.server import CapabilityGroup, SandboxServer

    default_port = inspect.signature(SandboxServer.serve).parameters["port"].default
    return {
        "all": list(server_pkg.__all__),
        "groups": [group.name for group in CapabilityGroup],
        "serve_default_port": default_port,
    }


def reference(source: str) -> dict:
    import agent_sandbox.server as server_pkg
    from agent_sandbox.server import SandboxServer, default_registry

    ast.parse(source)
    imported = [
        alias.name
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.ImportFrom) and node.module == "agent_sandbox.server"
        for alias in node.names
    ]
    namespace: dict[str, object] = {"__name__": "reference_commands"}
    with patch.object(SandboxServer, "serve", autospec=True) as serve:
        exec(compile(source, "commands.py", "exec"), namespace)

    registry = default_registry()
    return {
        "imported": imported,
        "hello_registered": "hello" in registry,
        "hello_result": registry.get("hello").fn("Ada"),
        "serve_call_count": serve.call_count,
        "serve_kwargs": dict(serve.call_args.kwargs) if serve.call_args else {},
        "route_found": False,
        "params": {},
        "imports_public": set(imported) <= set(server_pkg.__all__),
    }


if __name__ == "__main__":
    if sys.argv[1] == "facts":
        print(json.dumps(facts()))
    else:
        print(json.dumps(reference(sys.stdin.read())))

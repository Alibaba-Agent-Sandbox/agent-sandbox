# Generated MCP workflow entry — 2026-11-10

Coordination: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/244 .

## Finding and decision

GitHub job 129799106728 (`actual-generated-http`) at CLI head
`2eecb789beda997cd8090dd0244e93695d6615c2` completed dependency installation and
CLI compilation, then exited 2 because the workflow still invoked the retired
`mcp deploy` generator. The actual error was `No such command 'deploy'`.
This is independent of optional Node package installation.

Parent review accepted the minimal consumer migration: generate editable source
with `template init DIRECTORY --template mcp --yes`. Generation no longer embeds
an API key or token. The same verifier supplies runtime authentication privately.
Add the actual template/scaffold implementation files to both workflow path
filters, so future changes to this generator trigger the HTTP check.

The existing HTTP verifier, its assertions, public Python runtime version,
workflow permissions and Python matrix selection remain unchanged.

## Actual local verification

- The built CLI generated the actual MCP project through `template init`.
- A fresh Python 3.13.13 venv installed the generated requirements from public
  PyPI: client and server both `0.4.0a6`.
- The unchanged `scripts/verify-mcp-artifact.mjs` started the generated ASGI
  application with uvicorn. Missing and wrong authentication both returned 401;
  initialize, tool catalog and input-schema assertions passed. The catalog had
  15 distinct tools.
- Only initialization and catalog discovery ran; no cloud tool operation was
  submitted. The owned server process stopped and its temporary HOME was removed.
- The verifier observed two transient startup ECONNRESET connections within its
  existing bounded readiness loop; all final HTTP assertions passed.
- Workflow YAML parsing and diff whitespace checks passed.

The original failed remote job remains historical. A fresh remote job after the
coordinating push is still required; this record does not claim it has passed.

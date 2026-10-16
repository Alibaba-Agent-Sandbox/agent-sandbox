# Decision: Use the Python client distribution in MCP deployment artifacts

Status: proposed

## Problem

`abx mcp deploy` generated a requirement on `agent-sandbox[mcp]`, while the Python SDK
client distribution is named `agent-sandbox-client`. The import namespace remains
`agent_sandbox`; the distribution name must match its packaging metadata.

## Decision

Generate `agent-sandbox-client[mcp]` in `requirements.txt`. Keep the existing uvicorn
requirement and ASGI entry point. Synchronize the English and Chinese MCP guides.

## API Design

N/A — this decision does not involve API changes.

## Alternatives considered

- Retain the previous distribution name: rejected because it does not match the
  client SDK's declared project name and MCP extra.
- Change Python imports: rejected because `agent_sandbox` remains the import namespace.

## Dependencies

The Python SDK's `client-sdk/pyproject.toml` declares `agent-sandbox-client` and its
`mcp` extra. Its public PyPI release must be available for clean artifact installation.

## Test Strategy

Assert the generated requirements file in the CLI command test. Add a black-box
scenario that invokes the built CLI and checks the real filesystem artifact with
placeholder credentials. Regenerate the MCP CLI evidence. Run repository gates,
then verify installability and the deployed MCP service against real components.

## Acceptance criteria

- Generated requirements use the client distribution, with no previous distribution.
- Unit and black-box artifact regression checks pass.
- English and Chinese documentation and CHANGELOG agree.
- Public package installation and real-cloud verification are recorded before completion.

## Evidence

- [Verification](../../../evidence/verify/2026-10-16-mcp-client-distribution.md)

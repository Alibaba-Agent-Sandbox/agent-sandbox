# Decision: Preserve borrowed sandboxes in generated HTTP MCP
Status: proposed

## Problem

The editable HTTP MCP template pinned Python client 0.4.0a6. That release predates
the ownership correction tracked by [Python SDK #139](https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/139).
Ending a generated app's MCP session could delete a sandbox connected by explicit
ID. The generated-artifact gate verified startup and discovery, which left this
ownership contract untested. [CLI #262](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/262)
tracks the artifact update.

## Decision

Pin the generated HTTP MCP app to the published Python client 0.4.0a7. Keep
general-purpose runtime pins independent. Extend the generated-artifact
workflow with real loopback HTTP session tests and a separate provider-handle
fixture that exercises the unmodified generated app through ASGI.

## API Design

Existing MCP version and commands apply. `DELETE /mcp` retires the protocol
session. The application attempts to delete its owned sandboxes and closes
borrowed client handles. The HTTP response confirms session invalidation.
Confirm provider deletion separately when required. Resource ownership follows
the Python SDK contract, including the existing retention policy.

## Alternatives considered

- Update the generic SDK pin: this would change unrelated generated workloads
  without addressing the ownership verification gap.
- Add a new ownership layer to generated application source: this would
  duplicate the released SDK fix and complicate future updates.
- Treat successful discovery as acceptance: this leaves cleanup effects
  unobserved.

## Dependencies

Published Python client and server 0.4.0a7 with the MCP extra. The CLI does not
install new runtime dependencies.

## Test Strategy

Generate the actual template with the built CLI, verify the published
dependency versions, and serve it over Uvicorn. Check Bearer authentication,
discovery, session termination and continued access to a second session. In
the ASGI ownership fixture, create an owned Sandbox, observe its default
only in that session, and attach a borrowed handle from another session.
Require exact delete and close effects. Confirm the negative control on
0.4.0a6 and observe cleanup independently against a real provider.

## Acceptance criteria

- New generated MCP projects install the published 0.4.0a7 pair.
- Closing one legacy HTTP session yields 404 for that session while other
  sessions continue.
- The generated service deletes its owned sandbox and only closes the
  borrowed handle.
- User guidance describes how to upgrade an existing generated project.
- Local, real-component, CI and remaining release evidence is recorded by scope.

## Evidence

- [Verification](../../../evidence/verify/2026-11-24-generated-mcp-session-ownership.md)

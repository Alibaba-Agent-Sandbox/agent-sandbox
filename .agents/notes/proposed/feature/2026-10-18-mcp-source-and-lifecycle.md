# Decision: Deliver installable MCP artifacts and explicit lifecycle operations
Status: proposed

## Problem

Generated artifacts requested unavailable or unrelated Python distributions.
The lifecycle feature branch overlapped newer provider workflow tools; taking
its old tool/manager implementation would remove supported operations or restore
implicit lifetime renewal. Timeout updates must not connect/resume paused resources.

## Decision

Pin matching client/server source archives from accepted SDK main13b214b. Keep the
current provider-neutral workflow catalog and explicit lifetime/ownership policy.
Use direct control-plane metadata/timeout helpers, remove unreachable renewal
state and the no-op hook, and retain lifecycle error privacy categories. Keep
resource cleanup independent of observation and of borrowed client connections.

## API Design

The artifact uses agent-sandbox-client[mcp] and agent-sandbox-server, same source
revision/version. Imports remain agent_sandbox. get_sandbox and TTL tools take
explicit IDs; inspection never adopts the resource. Timeout acceptance and observed
timeout are distinct. A typed ownership refusal preserves its useful fixed message.
Node and Python HTTP MCP catalogs remain separate documented server contracts.

## Alternatives considered

Waiting for an unrequested package publication does not repair installation.
Taking the older lifecycle fork drops current provider operations. Connecting
before metadata/TTL can resume paused resources. Logging raw provider failures
can expose credentials. Restoring automatic renewal contradicts accepted main.

## Dependencies

Integrates https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/23 and
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/31 with accepted
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/35.
Source pair: https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/38.
The larger Skills/MCP roadmap remains independently scoped.

## Test Strategy

Run lifecycle/privacy/paused-provider and artifact-generation regressions, the
full local suite and normal quality gates. Install actual generated requirements
into a fresh environment. Start the actual generated ASGI app, drive authenticated
HTTP and real Express command/files/cleanup. Run actual CLI STDIO lifecycle.
Required final-head CI/review gates remain mandatory.

## Acceptance criteria

Generated dependency installation/import works without unpublished PyPI metadata.
Current tools and ownership rules remain. Metadata/TTL never connect/resume.
Credentials and raw lifecycle exceptions do not appear in tool payloads/logs.
Real HTTP and STDIO acceptance pass with owned cleanup. Both languages and records
match actual artifact-generator scope, without claiming automatic FC deployment.

## Evidence

[Verification](../../../evidence/verify/2026-10-18-mcp-source-and-lifecycle.md).

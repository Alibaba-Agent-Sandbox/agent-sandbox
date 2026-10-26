# Decision: Reuse CLI shell and response formatting primitives

Status: proposed

## Problem

Three command producers maintained the same always-quoted POSIX literal renderer.
Two utility modules maintained an identical float formatter, and the two MCP
transports constructed identical JSON-RPC response objects separately. The reuse
audit found independently maintained copies despite existing module owners. Scope:
https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/191.

## Decision

Use one small `utils/shell.ts` function for the three identical renderers. Import
and re-export the existing `utils/_pyformat.ts` float formatter from `utils/_py.ts`.
Reuse and re-export the existing `agent/mcp.ts` response constructors in the HTTP
transport, which already imports that module. Document the existing reuse entry
points. No new runtime dependency, configuration interface or generic framework is
required.

## API Design

`quoteShellLiteral(value: string): string` renders one literal POSIX argument using
the existing always-quoted format. Existing formatter and JSON-RPC exports retain
their signatures and paths. The separate CPython shlex renderer keeps its output
contract. The Python SDK remains noninteractive.

## Alternatives considered

- Copy another local renderer: preserves the maintenance split.
- Replace every shell renderer or Python compatibility module: risks changing
  tested output and distinct high-level formatting semantics.
- Add a common package or configurable quoting framework: unnecessary for this
  repository-local primitive.

## Dependencies

Existing utility and MCP modules only. The change stays within the CLI repository.

## Test Strategy

Verify literal round trips through a real POSIX shell, then run the full unit suite,
lint, typecheck, build, parity coverage, package, hygiene and record checks. Verify
the built CLI against real cloud components, including MCP/task behavior and owned
resource cleanup. Preserve existing snapshots; command output is unchanged.

## Acceptance criteria

- Three identical shell renderers call one function without changing their text.
- The identical float and JSON-RPC builders have one implementation, with existing
  imports and protocol response shapes preserved.
- Existing behavior tests and required real-component checks pass.
- English/Chinese documentation, changelog and verification evidence are included.

## Evidence

- [Verification](../../../evidence/verify/2026-10-26-shared-cli-primitives.md).

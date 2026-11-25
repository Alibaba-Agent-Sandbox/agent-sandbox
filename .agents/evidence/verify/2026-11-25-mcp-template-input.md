# Verification: MCP template input

- Date: 2026-11-25
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/283
- Result: PASS for the local strict-input and real HTTP boundary; publication pending.
- Source base: merged PR 280, `4454d154c9cd42ee26170a8dcc22ed688ca283aa`.

## Evidence

`src/providers/alicloud_express/fc_template.ts` constructs the native build block
only when `envd_inject` is true. False omits the block rather than explicitly
requesting disabled injection. No cloud policy is inferred from omission.

Typecheck and build passed. The template-workflow and tool suites passed 32 tests,
including both retired boolean values rejected before configuration/list/create,
and default submission still forwarding its existing preparation policy.

The compiled application ran over a real local HTTP Unix socket through
`node e2e/mcp-template-input-acceptance.mjs`. Initialize and tool discovery worked;
the schema omitted the retired field and disallowed additional properties; calls
with true and false returned tool input errors before credential admission. The
owned HTTP server and socket directory were removed. No cloud resource was created.

This verifies tool/schema/transport rejection, not a new image build or cloud envd
policy. Existing native Provider interfaces and generation behavior are unchanged.
Remote CI, health and review results are recorded below when completed.

Scoped ESLint and hygiene passed. Repository health passed 105 checks with 11
registered historical warnings and zero failures after correcting the new ADR
template. Independent second review accepted the strict-input/default-preservation
boundary; Python MCP has no corresponding template-submission tool.

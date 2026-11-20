# Verification: Named resource execution re-review

- Date: 2026-11-20
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/249
- Result: PARTIAL
- Candidate baseline: `dcc3dd265c`
- Environment: Linux, Node.js, npm lockfile installation. Tests used synthetic credentials.

## What was verified

The deployment source contract keeps the region on the template, arbitrary user
variables, the mutually exclusive Dockerfile and Steps modes, and native FC
props. The official Devs parser resolves configuration and the official loader
invokes the pinned component. abx supplies adaptation for deferred outputs,
actions, resource ownership, authentication and the log channel.

The named executor already passes private database URLs to the worker's explicit
redaction list. The component worker also needs to mask such values when invoked
without that extra list. Before the change a synthetic PostgreSQL URL survived in
a returned diagnostic. The component worker now identifies database URLs, DSNs
and private keys by field name, masks structured encodings, and applies the
same masking to function-log text. The second review showed that the fixed FC3
component writes each tail line via console.log. The worker now delivers those
lines while the component runs, with diagnostics remaining separate.

## Commands run

- `npm ci --no-audit --no-fund` installed the locked dependencies.
- `npx --no-install vitest run tests/test_cli/test_component_host.test.ts -t 'database connection'`
  failed on the original code with a deliberately fake URL.
- `npx --no-install vitest run tests/test_cli/test_component_host.test.ts tests/test_cli/test_component_creation_guard.test.ts`
  passed 14 checks after the fix, including the official loader with a local
  component and separate result/event channels.

- `npm run typecheck` and `npm run build` passed. The compiled CLI planned all
  six Harness recipes with private synthetic environment values, using the
  official Devs resolver and without performing resource operations.
- The broad `npm test` run after the first patch reported 4,588 passed, 54
  skipped, 12 failed. Failures affect loopback MCP, TLS and WebSocket test
  expectations in this environment. This is a failed broad local run; it is
  separate from the focused component checks and prior remote CI.
- `bash scripts/check-repo-health.sh` passed with 106 passes and 11 warnings.

## Cleanup

No cloud resources or management keys were created by this check. Component
fixture directories were owned by the tests and removed by their teardown.

## Not verified

This check does not establish FC release behavior or six-model cloud acceptance.
Native Steps produce a prepared Sandbox template; OCI export was not established.
The hosted Agents API release and publication gates remain open.

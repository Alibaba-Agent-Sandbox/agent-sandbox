# Verification: provider ownership and unequal capabilities

- Date: 2026-10-16
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/40; https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/33
- Result: PARTIAL (targeted regressions pass; complete provider abstraction and integration are not claimed)
- Environment: Linux x64, Node 22.22.2; no cloud credentials used by the boundary probe.

## What was verified

The user requested a definitive review of provider isolation and whether registration alone handles differing backend capabilities. Configuration scoping, Express dispatch, resource namespaces, feature gates, template helpers and the separate pending provider-command implementation were inspected. The latter is https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/35, with SDK companion https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/38; both were verified draft/unmerged during this review and were not modified.

## Findings and fixes

1. Standard dispatch considered the ambient provider but ignored qualified resource ownership. Qualified sandbox references now enter provider routing before the Express client can run.
2. Unknown namespaces were treated as opaque sandbox IDs and could reach the default backend. Unknown and empty explicit references now fail before requests (E8001/E8002); explicit conflicts retain E8030.
3. Native provider-flag extraction could consume a remote agent's --provider and change the backend. Extraction now stops at the exec sandbox ID. Project exec commands still use -- before remote options; invalid parsing fails before backend work.
4. Template gates checked a feature flag and then ran FC/ACR directly. A plugin declaring templates.read/build could enter that backend. Native template handlers now explicitly require Express as well as the feature, returning E8004 until a genuine foreign template adapter is implemented.
5. Natural-language/internal deployment could bypass command-level template gates. Guard both helpers before generation, credential lookup, filesystem/Docker and cloud actions.
6. Express inherited the whole global feature registry. It now explicitly declares its 15 implemented adapter feature IDs. Generic storage.mount, network.vpc and ports.domain are not advertised by this adapter. This is not a claim that Alibaba lacks storage/VPC/domain cloud services.

## Commands run

- Focused CLI/provider/generation tests: 7 files, 151 passed (17.30 seconds).
- Typecheck: PASS. The source also built successfully into the standalone executable.
- Standalone boundary probe: `ABX_BIN=<built-executable> node e2e/provider-boundary.mjs`. First corrected artifact run PASS. The initial probe expected exit 2 for E8001; the established CLI mapping is exit 4, so the harness expectation was corrected without changing runtime error mapping.
- Full standalone rebuild with final explicit feature set: SHA256 d7f3565a12af0825e1f38ac491bb7e0234e3076eec2cc54cfff9a0330cfc9c40. Final probe/check summaries are recorded separately after completion.
- Existing server/full aggregate failures and earlier real Express cloud checks remain in prior evidence; none are relabeled by this review. New full remote CI is required after publication of these fixes.

## Results

The local fixture provider is installed through the real binary into a temporary HOME. With Express still the default, a qualified reference reaches that provider with the bare ID. Conflict, unknown and empty namespaces do not invoke its connect handler. Remote --provider cannot select Express. A fixture advertising template support still fails E8004 before FC/ACR or generation. This proves CLI/filesystem ownership boundaries; it is not a live OpenSandbox backend test.

## Cleanup

The probe removes its temporary HOME, plugin and receipts in finally. No cloud resource or real OpenSandbox instance was created. No account-wide cleanup was attempted.

## Problems found

Typed registration supplies discovery/schema/provider-bound invocation only when an actual handler is implemented. The fixed 18 common feature IDs and management commands are different mechanisms. A static supported flag is not an account/runtime/template availability probe. The standard E2B frontend and native provider frontend are still distinct; common provider template dispatch remains unimplemented and now fails closed rather than borrowing FC.

## Not verified

Real OpenSandbox full E2E, all other provider backends, conditional successful pause/snapshot operations, a unified conditional-capability model, generic foreign template adapters, pending registry integration, latest remote matrix/review/merge. Companion SDK ownership fixes: https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/47. The overall abstraction is not declared complete or fully clean.

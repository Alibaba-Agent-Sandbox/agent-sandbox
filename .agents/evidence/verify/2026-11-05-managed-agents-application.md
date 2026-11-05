# Verification: managed Agents application deployment

- Date: 2026-11-05
- Change: [Issue 80](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/80)
- Result: PARTIAL
- Binary / package under test: source npm CLI 0.5.8 on the managed application feature branch; existing published 0.5.8 has no app commands.
- Environment: Linux, Node.js 22.22.2. Existing project credentials loaded only in trusted child processes; values and account identifiers are not recorded.

## What was verified

The new closed managed profile builds a frozen plan, reserves native resource identities and records
deployment/cleanup outcomes. Candidate credentials are removed before publication. Destruction
retains compute while durable logical Sessions or cleanup remain. Unknown creates are not adopted.

## Commands run

```bash
npm ci --no-audit --no-fund
npm run typecheck
npm run build
npx vitest run tests/test_cli/test_command_surface.test.ts tests/test_cli/test_managed_application.test.ts
npm run lint
node dist/bin/abx.js app --help
make ci
bash scripts/check-repo-health.sh --quiet
npm run check:hygiene
node e2e/managed-components.mjs all
```

## Results

| Scenario / test | Result | Notes |
| --- | --- | --- |
| TypeScript type checking and compiled build | PASS | Actual source, including the new command group |
| Managed lifecycle regressions | PASS | 42 focused tests, including real subprocess deadlines/output limits, durable recovery, retained revisions, ACR ownership, concurrent build admission, private CA parsing and state identity guards |
| Command surface and bilingual reference | PASS | 11 tests |
| ESLint | PASS | Zero errors; existing repository warnings remain |
| Actual fc3 0.1.26 component resolution | PASS | Official loader returned the exact bundle and deploy/info/remove methods |
| Actual STS identity and native FC absent-function lookup | PASS | Verified selected identity and independently established absence; no cloud writes |
| Actual component info on a nonexistent function | EXPECTED FAILURE | Credential callbacks reached the component; the nonexistent function lookup fails. This alone is not lifecycle success |
| Actual FC component lifecycle | PASS | Create-only reserve, official component deploy, exact native identity/config readback, component info/remove and independent absence, using the actual product runner |
| Actual Server image lifecycle | PASS | Docker scratch build, random ACR tag push, matching native config ID/digest, clean-build, native tag absence and exact local-tag absence |
| Actual FC environment budget probe | PASS | 3,020 and 5,020 total key/value bytes were accepted and read back exactly; both owned functions independently absent. This disproves a 4 KiB hard rejection for this account/API, not an unlimited-size guarantee |
| Reproducible real component runner | PASS | Committed e2e/managed-components.mjs all ran both FC and ACR lifecycles successfully |
| Full local CI | FAIL | 4,610 passed, 10 failed, 60 skipped; all ten failures independently reproduced on untouched main 590f0ef with its lockfile. Final state/VPC guards have additional focused checks |
| Repository health | PASS | 105 passed, 11 existing warnings, zero failures |
| Hygiene | PASS | No machine-local paths or credential-like values found |
| Parity coverage with the actual Server SDK source configured | PASS | 907 ledger entries passed; zero failed/skipped/missing; all eleven moved entries verified in the owner checkout |
| Full real FC managed application | NOT VERIFIED | Requires the new runtime image, reachable persistent PostgreSQL and execution role. The full joint deployment remains a separate required gate |

## Cleanup

All minimal FC test functions were independently confirmed absent, including failure paths.
Successful image runs independently confirmed the exact ACR and local Docker tags absent. The first
post-push metadata read was incomplete; its private receipt and journal were retained. A later native
read matched that exact random tag's config ID to the recorded local image ID; manual reconciliation
then deleted only that confirmed task-owned tag and confirmed remote/local absence. Its original
failure remains a failure. Shared ACR repositories were preserved. No sandbox instances were created
by this repository's component-only acceptance.

## Problems found

Cross-review found alias ownership is per-function, model whitelist semantics must be rechecked by
the consumer, logical idle Sessions block worker retirement, and early apply failures lack a drain
controller. Further review found orphaned Server tags, partial retirement progress, created templates
lost after readiness failure, missing private-network configuration and database-ledger replacement.
The implementation includes focused regressions for those boundaries.

The original real FC reserve failed with HTTP 400 InvalidArgument because diskSize was omitted;
the profile now sets diskSize: 512 explicitly. The first minimal component fixture used obsolete
codeUri instead of fc3 0.1.26's code property; its failure was corrected in the fixture before passing.
ACR metadata can temporarily omit image digests immediately after a successful push. Only bounded
read retries are allowed; missing metadata never establishes absence and pushes are not replayed.

The unchanged main baseline reproduces ten failures across test_node_transport_integration,
adversarial/core/transport_net and adversarial/core/ws: refused-connection text; malformed HTTP,
RST and ambiguous framing parity; SSL_CERT_FILE/SSL_CERT_DIR trust; ACR proxy handling; WebSocket
UTF-8 close text, proxy use and incomplete-handshake text. No assertions or gates were weakened.

## Not verified

Full real application acceptance and merge/release gates remain open. Source-only root integration
with real PostgreSQL/Sandbox/model is separate evidence and does not certify the FC joint deployment.
Private FC VPC/RDS reachability, RDS CA trust and runtime/CLI ledger handshakes still need the full
joint test; local parser/bootstrap tests are not evidence of those network/TLS behaviors.
This file does not claim a published CLI feature, OpenAI compatibility or complete managed template acceptance.

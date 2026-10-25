# Verification: Current Express source acceptance entry

- Date: 2026-10-25
- Result: PARTIAL — syntax and actual argument/preflight behavior PASS; full default Docker/Registry source acceptance remains BLOCKED on this host.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/173.
- PR: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/174.

## Confirmed active stale input

The opt-in e2e/express-workflow.mjs still passed the retired workflow option and expected workflow_id, although the current spec-v5 launcher returns declared services. This script remains linked from the E2E README. The normal Actions job does not execute its cloud step unless the encrypted opt-in switch is enabled: its green build must not be called real-cloud acceptance.

The script now invokes the complete-template launcher without retired selection and checks the actual app service protocol/version/port/address. Existing journal IDs and exact unique alias correlation bound cleanup. Known owned sandbox/template absence is checked independently by typed not-found errors. A sandbox already removed by failed-launch cleanup is accepted only when connect itself reports typed SandboxNotFoundError; other connect failures remain failures. Zero-owned-ID paths report no owned IDs rather than claiming an independent readback. Auth, transport or unresolved no-ID outcomes leave cleanup unconfirmed; no existing main failure is replaced. Manual ACR image retention remains explicit.

## Executed checks

- node --check e2e/express-workflow.mjs: PASS.
- Actual built CLI with the script's current options reaches Docker preflight E7020 using an isolated HOME, a valid local v5 source fixture, only synthetic credentials and a loopback control-plane address. No cloud resource is created. [Receipt](2026-10-25-cli-054-source-arguments-preflight.json). This proves current argument parsing/preflight, not a Registry download or cloud build.
- An initial hand-written fixture incorrectly paired a provider owner without its native template ID and stopped at manifest validation. The corrected source fixture has no native-reference fields and reaches the expected Docker preflight. The initial failure is retained locally rather than called a product pass.
- Hidden-file scan covers .github, scripts, e2e, maintained docs, Skill/llms/references and CLI/agent source, excluding generated runtime and historical golden artifacts. The remaining retired spellings occur only in the explicit migration-removal instructions and the bilingual page headed Historical workflow capture. No active invocation remains in this scope.

Full Registry/default-Docker cloud acceptance cannot execute here: Docker is absent. No secret gate is relaxed and no credentials are uploaded to Actions. This result does not replace the separate unified steps/model tests or the pending public-template matrix.

## Scoped old-source suggestion correction

The obsolete-spec diagnostic already contains its recovery actions, so only that error suppresses the unrelated inherited capability-grant suggestion. The global TemplateParseError behavior is unchanged. Relevant source/API/filesystem regressions: 91 PASS; build PASS. A new actual CLI invocation returns E2004 and source guidance without the duplicate suggestion; manifest bytes remain unchanged and zero cloud calls occur. [New observed output](2026-10-25-template-source-version-final-cli.json). The earlier observed-output receipt is preserved unchanged.

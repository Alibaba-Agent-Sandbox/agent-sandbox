# Verification: Generated native steps

- Date: 2026-10-25
- Result: PASS (scoped real source-candidate E2E; required PR CI pending)
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/157
- Environment: Linux, Node 24, public CLI 0.5.1 baseline, real Express account and coding model; credentials supplied through environment variables, values omitted.

## What was verified
A fresh documented prompt failed with E2007 because the generated native recipe omitted base.image. Its embedded source differed from final commands.py. No cloud resources were created by that failed generation.

## Commands run
- `npm ci --ignore-scripts`: PASS.
- `npm run typecheck`: PASS.
- `npx vitest run tests/test_agent/test_codegen.test.ts tests/test_template/test_build_plan.test.ts tests/test_agent/test_template_guide.test.ts`: 98 PASS.
- Three fresh real-model deterministic source-candidate native deployments passed CLI/SDK/HTTP/PTY assertions (50, 51 and 51 respectively). The final dependency-ordering candidate passed all 51 assertions, downloaded source SHA256 equality, explicit non-root directory write/read/delete, sandbox typed SandboxNotFoundError and template not-found after exact cleanup.
- A bounded model-correction candidate also failed with malformed YAML and created no cloud resources. It was removed from the final implementation.
- `npm run lint`: PASS, 0 errors and 273 existing warnings.
- `bash scripts/check-repo-health.sh`: PASS=106, WARN=11, FAIL=0.

## Cleanup
The baseline failed before provider deployment. All three successful candidate runs deleted their exact owned sandbox and template; independent sandbox and template lookups confirmed absence. No unrelated resource cleanup was performed.

## Not verified
Required PR CI remains pending. Full local unit suite and the Node 20/22 matrix were not run locally; the changed code-generation/build-plan/guide suites passed. Public 0.5.2 binary/npm publication and fresh installed-package reruns are separate release gates.

## Real cloud scope
The tests used a source candidate reporting the unchanged package identity 0.5.1; this is not a public 0.5.1 fix or a 0.5.2 publication claim. Generated applications used public server 0.4.0a1. The 51-assertion run includes explicit non-root creation, write, read and deletion under /home/user/app. The final local-shell regression executes the actual encoded requirements.txt delivery before a relative dependency command. Historical malformed-YAML and E2007 failures remain separate receipts.

- Final `npm run build`: PASS.
- Final `npm run check:hygiene`: PASS.
- Final `git diff --check`: PASS.
- [Sanitized final cloud receipt and assertions](2026-10-25-generated-steps-validation.json).

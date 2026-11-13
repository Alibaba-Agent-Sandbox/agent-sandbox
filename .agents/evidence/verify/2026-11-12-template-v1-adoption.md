# Template v1 adoption consumer — 2026-11-12

Result: PARTIAL. Cross-repository tracking: https://github.com/Alibaba-Agent-Sandbox/awesome-templates/issues/309
Related design: ../notes/proposed/architecture/2026-11-12-native-template-project-parser.md

## Verified behavior

The adoption staging validator now receives a v1 resource document. Its port check previously
still read root ports, rejecting valid service declarations. It now checks the union of
sandbox.ports and sandbox.services port values against the actual Dockerfile EXPOSE declarations.
Additional access ports retain warnings about absent EXPOSE/startup rather than acquiring a
fabricated HTTP protocol or service version. Existing source-copy, secret filtering, staging
whitelist, backup and rollback assertions remain intact.

Local adoption resource names are limited to 63 ASCII lowercase letters/digits/hyphens with a
letter/digit first; trailing line terminators reject before calling a model. Directory-derived
names are truncated to the same limit. Native template.reference values are unrelated and
were not restricted.

## Actual checks

`npx vitest run tests/test_agent/test_adopt.test.ts tests/test_cli/test_template_adopt.test.ts tests/test_agent/test_template_gate_gaps.test.ts tests/test_utils/test_registry.test.ts`

Final focused result: 105 passed in four files. This includes real temporary staging/files,
existing rollback and secret guards, a fake model writer, metadata/resource separation,
strict UTF-8 admission, source-cache recovery and additional-port behavior. No model or cloud
execution was performed by these tests. `git diff --check` passed.

The initial focused run had one failure expecting the old UnicodeDecodeError class; the new
reader's strict UTF-8 rejection is correctly wrapped in AICodegenError. The test now asserts
that wrapper and the valid-UTF-8 diagnostic. Rejection was not relaxed. Dotenv byte/position
rejection and Dockerignore BOM checks remain.

The subsequently frozen full CLI run recorded 4615 passed, one unrelated config-key failure
and five skips, with no unhandled errors. Its source patch fingerprint and full result are
recorded in the parser evidence; later canonical/STS deltas require their own checks.

## Missing gates and cleanup

Final owner CI/review and real cloud/model E2E remain required. No cloud resources or account
credentials were created. Existing test cleanup removes staging and temporary project trees;
this file contains no real model response or successful adoption business claim.

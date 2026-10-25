# Verification: Docker launch prerequisites and unstarted resource intents

- Date: 2026-10-25
- Result: PARTIAL — affected tests and real candidate prerequisite/cloud checks pass; the full local suite retains 13 baseline/environment failures and remote CI is pending.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/160
- Base: `52be0ac9c7a4fec63b2da193fbd60074e2cae5c4`.
- Environment: Linux x64, Node 22.22.2; fresh public CLI npm 0.5.1, official Python client/server 0.4.0a1; Docker executable and daemon absent. Real Express credentials are supplied only through the environment.
- Final candidate: locally built Linux SEA, package version still 0.5.1 (not a republished release), SHA-256 `468537b61c7bf5819e91dfac849a2d7816191ce71dc5c14f86e848057726d37e`.

## Reproduction from the public installation

The official npm 0.5.1 source-template launch used the default public Git `python-hello` reference and generated application token. It failed before any build with generic E8002. Its one local image intent had no ID; no push, template or sandbox intent existed. The acceptance report retained one unknown/unstarted artifact. This failed developer journey remains FAIL; a missing Docker host is not a successful source deployment.

The candidate repeats the same actual public-catalog command on the same Docker-less host. It reports controlled E7020 explaining that Docker is missing, how to start/configure it, and that no build has started. The private journal has no resource entries, and the report has zero retained and zero unknown artifacts. This is PASS for the negative prerequisite behavior; source-image execution remains unavailable on this host.

## Executed checks

The first local health invocation rejected the task dependency symlink. Before publication it was removed and dependencies were installed into a regular directory with `npm ci` from the committed lockfile. The 467 focused tests, typecheck, build, SEA build, artifact check, real prerequisite case and real managed cloud E2E were repeated for that final dependency layout. The final health check reports 106 PASS / 11 WARN / 0 FAIL. No symlinked dependency tree is published.

- PASS: 467 focused tests across seven files, covering missing executable, inaccessible daemon, no intent/build/push/create before prerequisites, safe launch diagnostics, existing healthy write-ahead resource capture, warning channels and the Python error oracle.
- PASS: `npm run typecheck`, `npm run build`, `npm run build:binary` and actual `node scripts/check-release-artifact.mjs dist/binary`.
- PASS: actual final candidate public-catalog source launch reaches the expected E7020 prerequisite result, with zero ambiguous artifacts; raw subprocess output is private and not copied into this record.
- PASS: `ABX_BIN=<final-candidate> node e2e/unified-template-launch.mjs --managed-only` — real Express managed launch, service map and remote execution; exact owned resources independently confirmed absent.
- PASS: `npm run lint` (zero errors, 275 existing warnings), `npm run check:hygiene`, `git diff --check`.
- FAIL, preserved: first full suite had 4342 passed / 18 failed / 50 skipped. Five newly exposed fixture/API-oracle failures were fixed: the internal prerequisite error was moved out of the finite Python-parity model exports, and existing build-only stubs now explicitly provide a healthy read-only Docker check.
- FAIL, remaining environment/baseline: final full `npm test` had 4347 passed / 13 failed / 50 skipped (196 files, 88.5 seconds). One unisolated test reads an existing v4 operator template cache; two local reference-plugin fixtures use host 0.3.0 against a plugin requiring 0.4.16; ten network/TLS/WebSocket adversarial checks differ under the host HTTP intermediary. The directly affected 467 tests pass. Latest-head remote Node 20/22 CI is required before merge.

## Cleanup and limits

The prerequisite experiment starts no image build, push, platform template or sandbox. Its original no-ID local intent is preserved as the failed public-package historical record rather than relabelled as successful cleanup. The final candidate records no resource intent for this failure. The separate managed cloud E2E deletes only owned resources and verifies absence with independent control-plane reads. No global inventory deletion is used.

A real healthy Docker image build is not claimed by the local missing-Docker experiment. The separate template/provider source matrix remains an independent acceptance gate. No tag, package or binary is published by this PR.

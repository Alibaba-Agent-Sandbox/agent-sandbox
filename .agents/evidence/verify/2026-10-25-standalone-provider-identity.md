# Verification: standalone provider execution identity

- Date: 2026-10-25
- Result: PARTIAL — focused checks and real candidate cloud behavior pass; full local suite has unrelated baseline/environment failures and remote CI is pending.
- Change: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/156
- Source base: `0015bb59af90aca273307112cdc1b2b2de9c8805`; scoped changes are launch identity, executable hashing, artifact regression and their records/docs.
- Environment: Linux x64, Node 22.22.2, Python 3.13.13, real Alibaba Express cn-hangzhou. Credentials supplied through the environment, never saved in this record.
- Candidate: locally built SEA carrying package version 0.5.1, **not** a replacement for the immutable public release. Executable SHA-256 `ba52df0749402894a073966c99c8ec2a7f6d36db7451873125d96152f2558e8e`.

## Initial public-distribution experiment

Fresh official website installer downloaded public standalone 0.5.1 into a new directory and verified its checksum. Version/help/provider-list worked. Actual bare-catalog `template launch base` and `template launch code-interpreter-v1` both failed before creation with E4001: a nonexistent provider source directory beside the executable. No sandbox was created. This failure remains FAIL.

An independent clean installation of official npm 0.5.1 and PyPI client 0.4.0a1 passed both real managed-template journeys: launch, CLI arithmetic returning 42, Python arithmetic returning 42, file write/read/delete, CLI deletion and independent SDK GET reporting SandboxNotFound. The interpreter template additionally imported numpy/pandas/matplotlib and computed dataframe sum 42. npm success does not override the standalone failure.

## Candidate checks executed

- PASS: `npm ci` using the committed lockfile.
- PASS: `npm run typecheck` and `npm run build`.
- PASS: `npx vitest run tests/test_providers/test_content_identity.test.ts tests/test_providers/test_template_launch.test.ts` — 43 tests. Executable mutation after the first 1 MiB changes the identity; directories are refused; existing project/plugin launch regressions remain green.
- PASS: `npm run build:binary` — actual Linux SEA, version check and SHA-256 generated.
- PASS: `node scripts/check-release-artifact.mjs <fresh-official-npm-abx>` — the same regression and existing artifact contract pass against the unchanged public npm install. The new regression fails as expected against the immutable public standalone 0.5.1 at the original missing-directory error.
- PASS: `bash scripts/check-repo-health.sh` — 106 passes, 11 warnings, zero failures.
- PASS: `node scripts/check-release-artifact.mjs dist/binary` — actual artifact needs no provider sidecar and reaches managed create against a deliberately closed loopback port using synthetic credentials. The original missing-directory failure is rejected. Existing terminal, help, scaffold and notices checks also pass. The first test draft incorrectly assumed a particular nonzero exit status and was corrected to assert failure plus the required execution phase.
- PASS: real candidate standalone `template launch base` and `template launch code-interpreter-v1` from the public catalog, each with a 300-second lifetime; CLI 42, Python 42, file write/read/delete, CLI kill and independent SandboxNotFound. Interpreter additionally performed the numerical-package dataframe operation.
- PASS: `ABX_BIN=<built-standalone> node e2e/unified-template-launch.mjs --managed-only` — real managed launch, complete service map, remote execution, independent sandbox/template absence checks.
- PASS: `npm run lint` — zero errors, 274 existing warnings.
- PASS: `npm run check:hygiene`; `git diff --check`.
- FAIL: initial full `npm test` — 4344 passed, 13 failed, 50 skipped across 196 files (89 seconds). One unisolated test read an operator's old v4 template cache; two reference-plugin tests supply host version 0.3.0 against a newer local plugin requiring 0.4.16. Ten network/TLS/WebSocket adversarial checks encounter the environment's HTTP intermediary, connection reset or trust-store differences. None of the 43 directly affected tests failed. This is not recorded as a full-suite pass; current-head remote CI remains required.

## Cleanup

Both original public-binary attempts failed before resource creation. Every npm/candidate managed sandbox was deleted and independently confirmed absent through a new SDK get-info request, including on exceptions. The focused real E2E also reconciled only its journaled resources through independent API reads. Foreign provider-managed references (`desktop` / `opensandbox-code-interpreter`) were rejected with provider-mismatch before creation; their identities were not substituted.

## Not verified

No package, tag or binary was published by this change. The 46-source template/provider rerun is separate ongoing work, and these managed checks do not certify native persistent interpreter, desktop, PTY, real models or other providers. Cross-platform delivered-artifact CI and the latest-head full Node matrix remain pending.

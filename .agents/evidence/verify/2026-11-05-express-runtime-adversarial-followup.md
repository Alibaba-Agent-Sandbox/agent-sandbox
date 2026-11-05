# Verification: Express runtime adversarial follow-up

- Date: 2026-11-05
- Base: PR #234 head `bbe6e0db61aec209ff8f428e29e4b1708a3504b0`.
- Result: PARTIAL
- Scope: runtime mount-path validation and provider-owned CLI credential selection.
- References: [Issue #230](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/230), [PR #234](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/234).
- Environment: Linux, Node 22.22.2, Sandbox SDK 1.2.1. Initial focused tests reused the
  existing lockfile installation; final checks use an independent `npm ci`
  installation. Local checks used placeholder credentials; the separate root-owned
  real-service entry check used an existing Sandbox API key without recording it.

## Adversarial findings and design

Two agents independently confirmed that checking only adjacent sorted paths
missed `/mnt/data` and `/mnt/data/log` when `/mnt/data-temp` intervened. They
accepted bounded pairwise, slash-delimited comparison after path normalization.
The same reviewers confirmed that runtime CLI commands should share conditional
commands' Sandbox-key requirements while preserving native management's AccessKey
requirements and separate managed-key consent. The official
[append-mount guide](https://help.aliyun.com/zh/agent-sandbox/append-mount-volume)
requires distinct, nonoverlapping mount directories.

## Commands run

- `npx vitest run tests/test_providers/test_express_mount_path_validation.test.ts`
  before the validator fix: **FAIL**, 3 failed / 1 passed. The intercepted backend
  returned 204 and invalid nested mount input incorrectly resolved successfully.
- `npx vitest run tests/test_cli/test_express_runtime_authentication.test.ts tests/test_providers/test_managed_api_key.test.ts`
  before the credential-selection fix: **FAIL**, 3 failed / 24 passed. Every
  key-only runtime CLI case incorrectly requested AccessKeys.
- `npx vitest run tests/test_providers/test_express_mount_path_validation.test.ts tests/test_providers/test_express_runtime_completion.test.ts tests/test_cli/test_express_runtime_completion.test.ts tests/test_providers/test_conditional_commands.test.ts`
  after the path fix: **PASS**, 4 files / 61 tests.
- `npx vitest run tests/test_cli/test_express_runtime_authentication.test.ts tests/test_providers/test_managed_api_key.test.ts tests/test_providers/test_express_mount_path_validation.test.ts tests/test_providers/test_express_runtime_completion.test.ts`
  after both fixes: **PASS**, 4 files / 60 tests.
- Independent source CLI subprocesses against a loopback HTTP fixture: **PASS**,
  all three runtime commands succeeded with only a placeholder Sandbox API key,
  the exact expected method/path/body and key header, and one request each. The
  three-directory nested input failed with E8002 and zero requests.
- The first loopback fixture incorrectly expected `X-API-Key` and returned 401.
  After correcting the fixture to verify the existing `Authorization: Bearer`
  transport contract, all four subprocess cases passed without product changes.
- Initial `npm run typecheck` and `npm run lint`: **PASS**, zero lint errors;
  273 existing warnings. These ran after the path fix; final checks follow below.
- Independent review of both production changes accepted the bounded pairwise
  path check and provider-owned authentication classification. The reviewer ran
  the four changed/adjacent test files independently: **PASS**, 60 tests. No
  generic CLI, managed-key confirmation or generated standard runtime was changed.

## Observable coverage

| Scenario | Result |
| --- | --- |
| Obscured ancestor in either input order | E8002 before runner key resolution or HTTP |
| Named and inline ancestor conflict | E8002 before runner key resolution or HTTP |
| Similar-prefix siblings | Accepted, one intercepted request |
| Key-only mount/network/timeout CLI | Accepted without loading the management SDK |
| Key-only native metadata management | Requires AccessKeys; no request |
| No runtime credentials | Reports authentication choices; no request |
| AccessKey pair and runtime `--yes`, no prepared key | Separate managed-key consent required; no key creation |
| Existing prepared key | One identity lookup; no creation or renewal |

The generic CLI configuration preflight runs before the runner's semantic mount
validation. The no-key-resolution assertion applies to the runner, not to the
entire guided CLI. Prepared-key and cloud-client tests use intercepted SDK calls.
They do not establish real cloud credential expiry or storage behavior.

## Cleanup and limits

The loopback server was shut down and joined; temporary input and home directories
were removed. Local checks created no cloud resources. The separate real-service
entry check created one owned sandbox and independently confirmed deletion. No
real API key was created or renewed. No underlying cloud mount/data-access
acceptance is claimed. The original PR's unmet storage gate remains blocking and
its historical evidence is preserved.

## Current-build real-service entry check

The root agent executed the newly built `node dist/bin/abx.js` with only the
existing Sandbox API key against one owned generation2 sandbox. The sanitized
receipt was independently inspected before including these results:

| Operation / check | Result | Boundary |
| --- | --- | --- |
| Owned sandbox create | HTTP201 | One owned instance |
| `sandbox.timeout` | CLI exit 0 | Independent GET HTTP200 with expiration field present |
| `sandbox.network.update`, explicit empty network | CLI exit 0 | Independent GET HTTP200 with empty network configuration |
| Three-path nested `sandbox.mounts.append` | CLI exit 2 / E8002 | Local rejection without missing-management-credential error |
| Cleanup | PASS | Owned DELETE followed by independent GET HTTP404 |

The command form is the same as the source capture, using `node dist/bin/abx.js`
and per-operation input files instead. The key was supplied through the
environment, with no AccessKeys. Resource identifiers and raw operational logs
are omitted. This confirms current CLI authentication and preflight reachability;
it does not verify a valid storage append or storage data access.

## Final repository checks

- `npm ci --no-audit --no-fund`: exit 0; 234 packages installed. npm reported
  that its allowScripts policy blocked the OpenAPI-core and esbuild postinstall
  scripts. Typechecking and the package build subsequently passed.
- `make ci`, with the workflow-pinned Python fixture `8e610a3` and provider fixture
  `126a50e`, plus the configured Python development environment: **FAIL**, exit 2.
  Hygiene, typecheck, lint and build passed. The full test phase reported 205
  passing / 6 failing files; 4711 passed, 20 failed, 5 skipped. make stopped at
  that failure before its parity and package stages.
- Exact failing-file control against untouched PR #234 `bbe6e0d`, using the same
  environment: **FAIL**, the same 20 failing tests and 39 passes across all six
  files. Ten engine/CubeSandbox/plugin tests encountered HTTP501 with the external
  message that project network auditing was disabled. The other ten raw
  transport/TLS/proxy/WebSocket failures match the original PR's recorded class
  of local environment failures. Assertions and skips were not modified.
- `make dist-check`, executed separately after make stopped: **PASS**, exit 0;
  the compiled CLI entry and Skill reference closure were included in the package.
- `bash scripts/check-repo-health.sh`: **PASS**, exit 0; 105 passed, 11 warnings,
  zero failures, including relative links, ADR structure and bilingual page sets.
  The check briefly failed after parity generated its ignored JSON report with
  local test paths. That task-owned report was moved outside the repository;
  no source or check was changed, and the final health check passed again.
- `git diff --check`: **PASS**, exit 0.
- `npm run parity:coverage`, executed separately after make stopped: **PASS for
  the ledger**, exit 0; 907 entries passed, zero failed/skipped/missing, and all
  11 Python-owned cases were found. Its underlying full-suite JSON results are
  4737 passed, 20 failed and 5 skipped (`success: false`); this invocation includes
  the integration files excluded by `npm test`. Ledger success does not erase
  those environment failures.

The six baseline-failing files are `tests/test_engine/test_engine.test.ts`,
`tests/test_providers/test_cubesandbox_provider.test.ts`,
`tests/test_providers/test_node_plugins.test.ts`,
`tests/test_transport/test_node_transport_integration.test.ts`,
`tests/adversarial/core/transport_net.test.ts`, and `tests/adversarial/core/ws.test.ts`.

The commit hook's staged secret scan passed. Its optional pre-commit framework
was unavailable; typecheck, lint, hygiene and health were run explicitly above.

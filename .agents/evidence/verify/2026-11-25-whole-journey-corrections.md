# Verification: integrated Sandbox user journey corrections

- Date: 2026-11-25
- Change: Issue276; whole-journey-corrections ADR
- Result: PARTIAL — focused/local and real Express paths passed; the remote Node20/22 test and parity matrix passed; the final package/check gate is tracked by PR277. Broader workflow migration is separate.
- Baseline: b095ab0001f40f1f148e0552d0bdbc378eae11fd, CLI 0.6.0-alpha.1 source. This work does not publish a new package.

## Reviews

Three independent agents reviewed API UX and authentication, lifecycle/CLI output, and Registry/SDK documentation. First review confirmed the state, stream, request-body, binary and credential defects. Cross-review added changed-token checks, strict raw UTF-8 stdin, qualified option ambiguity, an unknown-state case, terminal stream validation, and explicit public projections. The old workflow PR261 was closed as superseded, not completed; Issue260 retains the corrected acceptance criteria.

## Real Express execution

Built the source after the observed-status/JSON fix. Using existing environment credentials and a unique local name, ran the following sequence against the real Express backend:

```sh
abx --json --provider alicloud-express deploy --template-id base --name NAME --sandbox-timeout 120 --yes
abx --json --provider alicloud-express exec --stream NAME -- sh -c 'printf hello; printf problem >&2; exit 7'
abx --json --provider alicloud-express status NAME
abx --json --provider alicloud-express delete NAME --yes
abx --json --provider alicloud-express status NAME
```

All five outputs were single JSON values. Execution returned exit7, stdout `hello`, stderr `problem`, and `exit_code:7`. The live query succeeded. Delete returned0; the subsequent query returned0 with `status:missing` and `observation:not_found`, based on the backend query. The owned instance was released; the existing base template was borrowed and retained. No database, FC function, image or template was created by this check.

## Integration checks

- `npm ci`, build, typecheck and hygiene passed in the independent checkout. ESLint: zero errors, 258 existing warnings. Repository health: 105 passed, 11 existing warnings, zero failed.
- Initial `make ci`: 20 failures, 4,628 passes, 61 skips. Nine failures were stale expectations/fixtures for changed public output and help. After correcting those fixtures and adding a new immutable seven-case help batch, all 314 tests in the three affected suites passed. Historical golden batches were not rewritten.
- Eleven original failures involved shared host loopback networking. Re-running the four affected suites in an isolated network namespace passed 42 tests, including all eleven original failures. One DNS assertion then failed because that namespace has no DNS route (`EAI_AGAIN`, expected `ENOTFOUND`); that assertion passed in the original host run. These are separate runs, not an all-green aggregate.
- A subsequent parity execution produced 4,657 passes, 13 failures and 61 skips: the eleven shared-network failures, one opt-in model integration case, and one missing-token fixture affected by an actual saved user token. The parity ledger itself had 901 passes, six guide skips because the CI Python SDK checkout was absent, no missing entries, and eleven moved SDK entries not verified locally. This is not a passing parity/full-suite result. The stale missing-token fixture expected failure even though the documented CLI intentionally generates/saves authentication. It previously passed accidentally when saving configuration failed. It now explicitly supplies an invalid empty token and verifies rejection before preparation/creation; all 57 tests in that suite and its ESLint check passed. Existing application-setup tests cover generation/reuse. No production authentication behavior was weakened.
- Scoped agent evidence separately records 143 request-integrity checks and real child-process HTTP/stdin/files checks, plus workflow state/projection checks. Remote CI must run the full required matrix with its pinned SDK/provider checkouts.
- `make dist-check` passed (npm entry point and packaged Skill reference closure).
- Initial installation on the shared workspace mount failed with I/O/open-file errors; a fresh independent checkout and lockfile installation succeeded. The first installation remains a failure.

## Remaining scope

This does not certify a new native YAML engine, Registry-to-Serving deployment, an OpenSandbox server, all agents/harnesses, durable task idempotency, or a new public CLI/SDK release. Those boundaries remain explicitly tracked in the related issues and drafts. Arbitrary OpenAPI metadata does not supply process/file/session protocols or make an E2B SDK compatible.

## First protected application call on real Express

A temporary current-v5 source recipe borrowed `base`, uploaded a small actual Server SDK service, installed the published `agent-sandbox-server==0.5.0a0`, and declared its matching v2 service and a local OpenAPI bearer scheme. Normal CLI configuration supplied application authentication; the test did not manually bind a credential or inject a replacement implementation. The declaration used `ABX_SERVER_TOKEN` and the normal successful-service callback. `deploy SOURCE --name NAME --upload commands.py --sandbox-timeout 180 --yes` completed; `abx sandbox NAME hello --name Ada` returned `Hello, Ada!` with exit0 and a single JSON result. Normal deletion and an independent remote-backed `status` observation then confirmed absence.

Earlier attempts remain failures: one fixture omitted the required provider for an existing template; two attempts used a readiness executable before pip installation made it available and were cleaned up automatically. A separately held diagnostic instance established that upload and pinned pip installation worked, and was then deleted and independently checked. The corrected successful recipe uses Python's standard-library HTTP readiness probe, available before SDK installation. No product startup behavior was changed to hide these fixture failures. The final run reused the normal saved application token; it was not a new clean-HOME onboarding test. Wrong-token/changed-token rejection is covered locally, not by a separate cloud run here.

All owned instances from these attempts were confirmed absent. The borrowed base template remains. No database, FC function, built image or native template was created. This validates the current v5 launch-and-bind path only, not the proposed native-v1 bootstrap or an OpenSandbox/Serving deployment.

## Remote integration and review status

[PR277](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/277), source head `5cdae350a640f8cf01c5984dadff30a6d0626564`: [CI45588774710](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45588774710) completed the Node20 and Node22 test/parity jobs successfully with the pinned SDK/Provider checkouts. Typecheck/lint, installer, Markdown links and the executed Express workflow steps also passed. The Express workflow's aggregate does not establish optional cloud steps; the separate real cloud evidence above is the actual cloud run. Package validation and the final documentation-only head remain subject to the PR's required checks; this record does not predate those outcomes.

A final local repository-health run initially saw the generated, ignored parity JSON containing machine paths. Moving that temporary report outside the checkout restored 105 passes, 11 existing warnings and zero failures. This changed no product or checker behavior. The pre-commit secret check passed; the optional pre-commit framework was unavailable. Independent typecheck, lint, hygiene, test and package checks are recorded above.

The broader review also opened [CLI278](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/278) and [Python181](https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/181) for MCP cleanup returning success while discarding failed owned handles, and [Python182](https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/182) for nonexistent harness-install guidance. Their fixes have independent branches and evidence; Issue276 does not close them or the native migration work.

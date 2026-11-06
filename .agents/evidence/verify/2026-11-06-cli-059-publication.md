# Verification: CLI 0.5.9 publication and managed source acceptance

- Date: 2026-11-06
- Result: PASS for final source application behavior and CLI publication/installation. Complete public-recipe cloud acceptance remains a separate template-owner gate.
- Product: reviewed CLI `7bd3230385b17cf0438b45cfd4f99c008f9f88cd`, merged by [PR235](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/235) as `dbc0224474c556710569f9e72d3835f685a69597`.
- Environment: Linux x64, Node.js 22.22.2, Python 3.13.13; real Alibaba Cloud Express, FC and PostgreSQL. Credentials were supplied privately and are not recorded.

## Source and release identities

The merge tree equals the reviewed product tree, and the immutable `v0.5.9` tag points to the merge.
The source run used the separately frozen npm candidate. Published npm was then checked independently;
its complete 697-file dist set has identical bytes to that candidate. The source image used the recorded
SDK source candidate and is not relabeled as an image built entirely from published dependencies.

| Artifact or gate | Verified identity/result |
| --- | --- |
| Final product PR CI | [42194501682](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/42194501682), passed |
| Final docs and Express workflow checks | [42194501687](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/42194501687), [42194501747](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/42194501747), passed |
| Merge CI | [42197716494](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/42197716494), passed |
| Five-platform binaries | [42197834638](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/42197834638), all five passed |
| GitHub release | [v0.5.9](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases/tag/v0.5.9), published 10:01:31 UTC |
| npm publish/public installation | [42199446245](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/42199446245), passed, including attachment of the tested npm archive/checksum |
| Independent public npm tarball SHA-256 | `ca3c750b119cc5106e71f883f54b3ae31c5122c562602c7082fd0bd0ffcf69f8` |

All five executables were independently downloaded and hashed, matching both their checksum asset and
GitHub's asset digest. CI installed and checked the actual npm tarball and native executable on each
platform. The Linux x64 downloaded binary also passed the independent artifact check locally.

| Executable | SHA-256 |
| --- | --- |
| Linux x64 | `6c959481bd3e60ec1c7e038a40d58f850703541646619950de15faada925d61b` |
| Linux arm64 | `4933812b86b66246cc5b741990451150b1ff6f5a11e36817048518e882445458` |
| macOS arm64 | `80fcc03c09e570c3cde55b9ada13bf1c6418b93a1a086b6f6592e4985a0ae6e9` |
| macOS x64 | `6b2560a5642d242fcd50e2d0798506152c1dfe8801de5cac724a3383d10abc27` |
| Windows x64 | `70961d74d86fb4fd45b08140f569a2794fe42234b9d24527afc0d94d4900265f` |

## Commands and local product checks

The final product ran `make ci`: 4739 unit tests and 4765 parity tests passed, with five optional skips
in each run; the parity ledger covered 907 records with no missing case and 11 verified moves. Hygiene,
typecheck, lint, build and complete dist checks passed. The independent 15-case candidate/stable HTTP
readiness selection passed; its 84 deselected cases were not counted as focused passes. Repository
health passed with 105 passes, 11 documented warnings and zero failures. The staged secret hook ran;
the optional pre-commit framework was not installed in that product checkout.

Independent public consumption used a fresh user context and the exact public npm archive:

```bash
npm install --prefix PUBLIC_INSTALL --registry https://registry.npmjs.org PUBLIC_TARBALL --no-audit --no-fund
node scripts/check-release-artifact.mjs PUBLIC_INSTALL/node_modules/.bin/abx
node scripts/check-release-artifact.mjs DOWNLOADED_LINUX_EXECUTABLE
```

The public tarball's SHA-512 matched npm metadata before installation. The installed package reports
0.5.9 and passed version, isolated guidance, single-result JSON, standard/native help, interactive
cancellation before credential entry and complete-notice checks. Actual public `app` help was captured
for build, plan, apply, status, reconcile, retire, destroy and clean-build. No cloud call was required by
these installation checks, and they do not replace the application acceptance below.

## Actual source application scenarios

The template-owned controllers invoked the CLI's real build/plan/apply/status/retire/destroy commands
and independently checked business HTTP, published source/artifacts, held-out checks and native resource
identity. The deployment host held cloud credentials; the business client used only the Gateway and key.

| Scenario | Actual result |
| --- | --- |
| Initial Qwen source deployment | Ready; all 39 positive API operations and protected-route rejection checks passed |
| Live SSE | Empty, unallocated Session: first event in 0.169 s; finite slice completed in 20.369 s with normal EOF and concurrent GET availability |
| Busy/queued/active behavior | Passed in 224.219 s: busy 409, queued cancellation, active stop, original process absent with no FINISHED marker after its 50 s natural deadline, same-session continuation and cleanup |
| Normal Qwen to Codex update | Ready in 240.669 s at 09:34:57 UTC; real two-turn candidate business task passed |
| Upgrade continuity/isolation | Passed in 267.293 s at 09:40:16 UTC: same stable endpoint, new Codex revision/workspace isolation, old Qwen pinned to the same native Sandbox with its marker and further artifact |
| CLI retirement | A first attempt while draining was refused; normal retry passed in 4.524 s |
| Independent retirement readback | Passed before client fallback cleanup: old public Session idle/closed at its original revision, old native Sandbox typed NotFound, retained revision removed |
| Final application destroy | Normal destroy passed; independent known function/template/Sandbox absence and owned PostgreSQL release were recorded before a separate public-only phase |

## Preserved failures and cleanup boundary

The earlier v7 update failed at its single candidate health probe. Its original HTTP response was not
saved; later success does not establish propagation as its root cause. That failed receipt remains
requires_reconcile. Its exact new branch was independently recovered without replaying apply, changing
old publication or deleting the shared Server image. The first old Session later reached its configured
idle close; it was not presented as a continuity pass. The successful update used a separately prepared
fresh old Session and a fresh plan.

Normal retirement/destroy and independent typed reads established absence for all known application
functions, templates and Sandboxes; the owned database was deleted. Manual image tags and empty ACR
repository metadata use separate exact task recovery journals. This record does not claim a global
account purge, historical hidden-copy visibility, automatic deletion of manual resources or absence of
resources created by a later public-only run.

## Documentation follow-up validation

The documentation-only branch retains the exact product implementation. Its first `make ci` attempt
failed the parity gate because the isolated checkout had no importable Python Server reference and
six required reference cases were skipped (901 of 907 ledger records passed); the 11 moved owner
cases could not be checked without the SDK checkout. That failed attempt is retained. No assertion,
source file or skip policy was changed to repair the test environment.

With the published SDK interpreter/Server package and an explicit SDK owner checkout, `make ci`
completed with exit 0: 4689 unit passes, 4715 parity passes, 55 optional skips in each, all 907 ledger
records passed with zero missing and all 11 moved cases verified. The remaining fixture-dependent
provider checks and the installed managed SDK parser were then explicitly enabled in six files:
148 checks passed with zero skips. That focused set includes 49 provider cases and the real installed
parser case skipped by the preceding default run; its other cases overlap the full run and are not
counted as additional total coverage. Repository health passed with 105 passes, 11 historical warnings
and zero failures; `git diff --check` passed. No cloud resource was created for these prose checks.

## Not verified by this record

This is not a full public-recipe application run, OpenAI API equivalence claim, all-provider matrix,
custom-domain production certification or managed deployment through every standalone executable.
Template catalog qualification and its blog/public recipe remain independently owned and gated.
This documentation follow-up does not modify the published package, tag or historical evidence.

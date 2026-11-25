# Verification: CLI 0.6.0-alpha.1 public delivery

- Date: 2026-11-25
- Result: PASS for scoped public GitHub/npm artifact delivery; this owner documentation PR still requires normal CI/review/merge.
- Release source: [PR274](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/274), merged at e33528012dbb482d336bdeb5998b07604b4a2b2a on 2026-11-25 07:05:58 UTC; its full tree matches reviewed head 972c708.
- Immutable tag v0.6.0-alpha.1: annotated object 5f0ddb401820b4cdd0cc36e1e36d45c8d185ab99 targets that merge; GitHub publication, Draft and anonymous public Linux checks, and fresh public npm consumption passed.
- Coordination: [Issue270](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/270),
  [Issue273](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/273).
- Recorded checkpoint: 2026-11-25 07:30:13 UTC.
- [Sanitized machine receipt](2026-11-25-cli-060-alpha1-public-release.json).

## Source and consumer gates

The unified command layout, explicit --yes consent and option-alias correction
need a version distinct from published 0.5.10. The original preparation was
[PR271](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/271), merged at
cbe97429c1bbb43d9ae31247f178dcbee73dc896. Its runtime consumer pin selects the
published Python client/server 0.5.0a0 according to each generated application's
role. The default server-wheel fetch/digest, actual Docker image and generated
MCP client's real HTTP checks passed as separately recorded consumer checks.
Generated MCP installation continues without the Server SDK distribution.

The final correction head 972c708914381bec43c4b153662eb8016fef7246 passed
[CI45564202212](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45564202212)
with Node20/22 unit/parity, typecheck/lint, installer and actual installed npm
package checks. [Docs45564202243](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45564202243)
passed. The actual merge also passed all five jobs in
[main CI45565504905](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45565504905).
The optional cloud step of the Express source workflow was skipped;
its successful setup/build is not cloud E2E acceptance.

## Preserved failures and corrected checks

The alpha.0 tag and assets remain immutable. Its GitHub prerelease was withdrawn
to draft after an actual copied public Linux binary failed deploy --help with
Cannot find module @alicloud/openapi-core. npm publication was cancelled before
upload, and its registry endpoint was independently observed as 404. The earlier
five platform workflows had left executables below checkout node_modules; their
successes did not prove independent standalone operation. Alpha.0 is not a
completed npm release and its preparation ADR is superseded, not implemented.

PR274 bundles five actual static SDK dependencies through seven literal require
edges while keeping credential/STS loading lazy. Real component files and the
external Node runner retain their separate contracts. Managed build/deploy in a
standalone binary gives Node20+ npm installation guidance before owned records,
credentials or cloud requests; valid plan previews remain supported. Source
acquisition may cache input before its managed profile is identified.

The native artifact checker physically copies every executable outside all real
node_modules ancestors before any command; all subprocess and PTY probes share
the copied path and isolated environment/cwd. npm checking retains the complete
installed prefix. Actual Linux SEA and independently installed npm candidates
passed the full verifier, including mixed aliases, managed plan/admission,
scaffolds, notices and real PTY cancellation.

The earlier 1f02eb4 run passed Node20/22 unit/parity, but its package gate failed
because a new alias assertion checked only stderr. Under ambient CI the CLI
correctly emitted one stdout JSON error with exit4/codeE8001. The failure was
independently reproduced. The checker-only 972c708 correction explicitly verifies
human and CI error channels without combining streams: exit4 in both, empty
stdout plus E8001 stderr for human mode, and empty stderr plus one JSON error
object with codeE8001 for CI. Complete actual npm and physically copied Linux SEA
checks passed with CI=true/GITHUB_ACTIONS=true.

The full local isolated user/PID/network run reported 4657 passed, one failed,
eight skipped. Its sole failure was the existing unknown-host resolver text
assertion: offline Errno-3 instead of expected Errno-2. The unchanged selected
test passed in the ordinary network; reused parity was 907/907. This remains a
failed local aggregate. Earlier alpha.0 preparation failures, the initial local
dependency-symlink health rejection and initial channel-check failure remain in
their original evidence; later successes do not rewrite them.

## Platform and public GitHub delivery

[Binary build45566018697](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45566018697)
completed successfully on all five platforms. Each actual installed npm tarball
and each physically copied native executable passed the complete artifact
verifier. At the first public binary checkpoint, the release contained five native files
and five matching SHA256 sidecars; identities and digests are in the JSON companion.

| Platform job | Job ID | npm package | Copied native executable |
| --- | --- | --- | --- |
| darwin-x64 | 139040887626 | PASS | PASS |
| linux-arm64 | 139040888020 | PASS | PASS |
| darwin-arm64 | 139040888094 | PASS | PASS |
| linux-x64 | 139040888106 | PASS | PASS |
| windows-x64 | 139040888332 | PASS | PASS |

The [GitHub prerelease](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases/tag/v0.6.0-alpha.1)
was published at 2026-11-25 07:14:10 UTC: release457763812, draft=false,
prerelease=true. The maintainer selected non-latest publication. The actual
Draft Linux x64 file (asset790486427) matched its API digest and SHA256 sidecar:
db798f6eec60fb67a1d8cad4b80148c0fb8475bb37ff25c3bb80294f6106ce9c.
Its full external-copy verifier passed; mixed aliases exercised the real local
process Provider with 15 passes and three unsupported-capability skips.

A separate anonymous public Linux download matched that same digest, passed the
complete physical-copy verifier and exercised mixed aliases against the real
local-process Provider: 15 passes, zero failures, three unsupported-capability
skips. These skips cover pause/resume, process management and port URL features
that this test Provider does not declare.

The public binary also previewed current PR313 python-hello source with exit0,
status=preview and builds_or_cloud_changes=false; the first validator wrongly
expected status=success and failed, then the corrected unchanged-product probe
passed.

## Public npm delivery and propagation history

[Release45566546338](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/45566546338)
completed publication of the tested tarball, installation from the public
registry, the complete installed-artifact verifier, and attachment of the tested
npm archive/checksum. The separate read-only credential-diagnostics job was
skipped; it is not an acceptance result. The final public GitHub release has 12
assets: five native executables, five native checksums, the tested npm tarball
and its checksum.

At 07:21 UTC, official version metadata, next and archive queries returned 404;
dist-tags still contained only latest=0.5.10. At 07:24:20 UTC version metadata
returned 200 with SHA512 integrity and provenance metadata, but the first archive
GET still returned 404. The independent verifier stopped before installation.
A bounded read-only archive retry later succeeded. The first fresh npm install
then failed with UNABLE_TO_VERIFY_LEAF_SIGNATURE because its validation driver
had omitted the existing trusted CA environment settings. Its failed directory
and original logs were preserved; the product was unchanged.

A different fresh prefix preserving those existing CA settings passed exact
public-version installation, the complete artifact verifier and the real
local-process Provider's mixed aliases: 15 passes, zero failures, three
unsupported-capability skips. Strict TLS remained enabled; no NODE_OPTIONS or
credentials were injected. The downloaded registry tarball's SHA1 and SHA512 SRI
matched official npm metadata. Its SHA256 is
1b304054f38de2e46e8e4fa78527c708968ae51690b8257279840ba3f726dd0b.
The separate anonymous GitHub tested-tarball and checksum downloads agreed with
that identical registry artifact and the GitHub API digest. Provenance metadata
advertises SLSA v1; this records its presence, not an independent cryptographic
verification of the attestation.

Official npm dist-tags are next=0.6.0-alpha.1 and latest=0.5.10. GitHub's latest
stable release remains v0.5.10. The preview did not replace the stable selection.

The actual public consumption used the existing
`scripts/check-release-artifact.mjs` against the installed prefix and physical
Linux binary; the real local-process Provider received mixed --opt/--option/-o
values. The npm install targeted @agent-sandbox/cli@0.6.0-alpha.1 with an empty
prefix/cache, official registry and --prefer-online. No additional cloud suite
was created for this documentation follow-up.

## Cross-repository scope

[Python0.5.0a0](https://github.com/Alibaba-Agent-Sandbox/python-sdk/releases/tag/v0.5.0a0)
is the already published runtime pair. Its actual zero/8MiB upload/download and
cloud/public installation evidence belong to python-sdk; this CLI record links
[owner delivery record](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/.agents/evidence/verify/2026-11-25-python-050a0-public-delivery.md) rather than treating it as a repeated CLI cloud test.

Template [PR313](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/313)
updates usage guidance; [PR315](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/315)
repaired two fixed-engine image package sources and merged at
93e8f831036eb50941dfe9dd027b5878772837e1. At this receipt's 07:30:13 UTC checkpoint, PR313 remains open: its document
checks passed and final public-receipt checkpoint CI is pending. Its subsequent
merge is a separate owner event. Final template versions, L1 and HTTP scope
belong to their separate owner records.
Neither substitutes for complete template qualification.

## Cleanup and limits

This documentation follow-up passed `npm run check:hygiene`,
`bash scripts/check-repo-health.sh --quiet` (106 passes, 11 existing warnings,
zero failures), JSON parsing and `git diff --check`. It adds no source tests or
cloud operations; the normal exact-head CI/review still applies to its PR.

The CLI correction and its artifact checks created no cloud resources. Owned
temporary verification directories were removed. Durable local test artifacts
serve as engineering evidence and contain no credentials.

This receipt does not certify every Provider, all template methods, full
standalone managed FC deployment, a complete FC lifecycle, broad performance or
production SLA. Issue270/273 remain open until actual public delivery and this
owner record's normal PR/CI/review/merge are complete.

## Historical evidence

- [Alpha.0 preparation](2026-11-25-cli-060-alpha0-release.md).
- [Static dependency and copied artifact checks](2026-11-25-sea-dependency-isolation.md).
- [CI output-channel failure and correction](2026-11-25-artifact-output-channel.md).

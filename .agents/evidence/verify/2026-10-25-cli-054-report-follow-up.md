# Verification: CLI 0.5.4 developer-report follow-up

- Date: 2026-10-25
- Result: PARTIAL — candidate behavior verified; new-head remote CI, independent review and publication pending.
- Source behavior: da82079738f46d36e2684246c0c57b27d1484cec. Subsequent records and explicit parity-contract mappings preserve the runtime behavior under test.
- PR: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/174.
- Issues: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/175 and https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/176.

## Integrated behavior

AccessKey ID now follows the existing provider-owned sensitive display/input policy. Eight command variants verify masking together with exact stored/resolved values; two interactive-input regressions verify hidden entry. This changes neither the SDK key schema nor authentication values. [Initial targeted verification](2026-10-25-access-key-identifier-masking.md).

Obsolete template source is rejected with existing E2004, the actual source path and required spec version. Cache advice is scoped and conditional, not an automatic deletion or compatibility path. Explicit local discovery is not called downloaded cache. [Source-loader verification](2026-10-25-template-source-version-guidance.md).

Current standard and native Express create help distinguish registered platform references from Registry source launch. The current Skill/llms examples use those interfaces. The model example typo is corrected to qwen3-coder-plus; the default model is unchanged. Provider-authoring guidance distinguishes host source acquisition from selected-provider preparation, creation and cleanup.

## Final local checks

- Standard executable, native snapshots and configuration setup regressions: 177 PASS. Config persistence/command/isolation suites: 132 PASS. Guide/package closure regression after its correction: 18 PASS.
- Locked runtime provenance: 7 PASS. Typecheck, lint (zero errors; existing warnings), build, hygiene and distribution package/Skill closure: PASS.
- Full local make ci after source and guidance fixes: **4400 PASS / 10 FAIL / 50 skipped**. The ten loopback/proxy/TLS/WebSocket failures match the previously retained host diagnostics. No test is removed or disabled. The command does not reach parity/distribution after the test failure; distribution is run separately. This is not a full local CI pass.
- Repository health after receipt addition: 106 PASS / 11 historical warnings / 0 FAIL.
- Parity ledger: 907/907 PASS; 11 moved SDK entries independently present. The two formerly plain AccessKey output tests are explicitly mapped to their new masked-output regressions through the existing changed-contract ledger with Issue175; the historical Python ledger remains unchanged.

## Actual installed artifact

The candidate npm tarball is installed into a new prefix. The repository's real executable checker passes version, isolated first-use guidance, structured JSON, actual terminal menu and notices. No public 0.5.4 package or standalone binary is implied.

With a new HOME and unrelated working directory, seven actual config command paths show a mask and omit the complete synthetic identifier: [installed identifier receipt](2026-10-25-access-key-identifier-installed.json). There are no real credentials or cloud calls. The exact tarball hash and six actual help/old-manifest checks are in the [installed behavior receipt](2026-10-25-cli-054-report-installed.json). The old manifest's bytes remain unchanged.

## Retained development failures and limits

The first combined full run was 4397 PASS / 13 FAIL / 50 skipped. Three additional failures were real guide/package problems: an added relative Skill link was not shipped in the npm package, and the static llms command check treated an initial global provider option as a command. The Skill now links to the official absolute document, and the llms example uses default Express. The 18 focused checks and final full run verify both fixes without loosening tests. A provider-authoring introduction still claimed generation bypassed the plugin; independent review caught it and the bilingual introduction now matches the actual responsibilities.

The parity check first identified the two intentionally renamed plain-output tests as missing; explicit changed-contract mappings now verify both replacement regressions. Its generated local JSON report then triggered the health gate's workstation-path check. The report was retained outside the source tree, and health was rerun; no checker exemption was added.

A first final-package install was interrupted by local disk exhaustion and had no executable; it is not counted as a pass. Only rebuildable dependency directories were removed, and the existing candidate tarball was installed successfully in sequence. An initial manual help assertion failed on line wrapping; normalization of displayed whitespace verifies the same wording without changing product text or source tests.

Earlier PR174 CI on 49686a59 is historical. All required checks must run again on the final pushed source. Existing public a3 dependencies and earlier real-cloud typed-template/MCP checks retain their original scoped records; new remote HTTP/public-wheel gates must pass before approval. Five-platform build, GitHub/npm publication, public installer readback and the five new-version developer scenarios remain later gates.

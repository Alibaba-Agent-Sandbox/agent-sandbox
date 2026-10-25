# Verification: Mask AccessKey identifiers in configuration output

- Date: 2026-10-25
- Result: PARTIAL — candidate behavior passes; latest combined-head owner CI, review and publication remain pending.
- Issue: https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/175
- Candidate: CLI 0.5.4; no 0.5.4 tag or public release has occurred.

## Confirmed behavior and correction

A new HOME and working directory outside the checkout use only a synthetic non-credential identifier. Before the correction, text/JSON config list, bare/qualified get, provider config list/get and set acknowledgement show the complete sentinel. After the correction, all seven actual executable command paths omit the complete identifier and show a mask. [Before](2026-10-25-access-key-identifier-before.json) and [after](2026-10-25-access-key-identifier-after.json) contain only boolean results and redacted synthetic input markers.

The existing provider-owned sensitive UI list now includes AccessKey ID. One shared CLI sensitivity lookup is used by general and provider-specific configuration output/input. The shared SDK key schema is not changed: output privacy policy does not require a new SDK release. Stored values and resolved authentication values are independently checked unchanged; ACR namespaces are not credentials and do not receive the identifier's policy.

## Executed candidate checks

- Focused config persistence/command/isolation suites: 132 PASS, including eight command variants that require masked output and exact stored/resolved authentication values.
- Actual fresh-HOME executable reproduction: all seven exit0, omit full identifier and contain a mask after the fix; before they all expose the synthetic identifier. No actual credentials or cloud request are used.
- Final standard executable, native evidence snapshots and configuration setup regression suites: 177 PASS, including both hidden-input paths. Standard create help names registered platform IDs/aliases and directs Git Registry source users to template launch. Native Express help makes the same distinction and corrects its model example to `qwen3-coder-plus`; the default model is unchanged. The current Skill and llms obsolete examples are removed. Other providers retain their declared native create contract.
- Typecheck and lint: PASS (0 lint errors; existing warnings remain). Standard runtime provenance: 7 PASS after normal regeneration.
- New release-specific native create help capture records the changed text; previous release captures remain untouched. Provider-authoring guidance now accurately assigns source preparation, creation and cleanup to the selected provider.

## Remaining

The [integrated report follow-up](2026-10-25-cli-054-report-follow-up.md) records combined-head local checks and actual fresh npm-package behavior. Normal new-head remote CI/review, publication and public fresh-install evidence remain pending. Earlier green PR174 checks apply only to its old source head and are not reused as proof of the changed source.

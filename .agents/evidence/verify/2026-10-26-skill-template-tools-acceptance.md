# Verification: Skill template and third-party tool business acceptance

- Date: 2026-10-26
- Change: `2026-10-26-skill-template-tools-acceptance` (proposed)
- Result: PASS for the scoped template scenario; repository-wide delivery gates remain separate
- Binary: CLI0.5.6 built from `2e32256`, with the current task's separately tested MCP resource-validation change; this scenario does not modify a runtime provider
- Environment: real Express cn-hangzhou, Node22.22.2; runtime API key and AK/SK supplied through environment variables, values omitted

## What was verified

The permanent `e2e/skill-template-acceptance.mjs` scenario authored valid spec-5 manifests, reused an actual existing generation-2 OCI image without modifying its source template, built two new platform-step templates and a deliberately failing template, and then used the actual CLI to create sandboxes in v1/v2/v1 order. Every successful sandbox returned its correct build-time version and the independently expected result385. This proves explicit-template selection and rollback within the tested scope.

## Commands run

```bash
node --check e2e/skill-template-acceptance.mjs
ABX_SKILL_SOURCE_TEMPLATE_ID=REPLACE_ME node e2e/skill-template-acceptance.mjs --output NEW_JSON_RECEIPT
bash scripts/check-repo-health.sh
```

The source ID is an actual ready account template selected for this run; its value is omitted here. The checked-in scenario has no hardcoded account template ID. The source image's SHA256 and actual per-run resource references remain in the [machine-readable receipt](2026-10-26-skill-template-tools-acceptance-events.json).

## Results

| Scenario | Result | Observed behavior |
|---|---|---|
| Two actual OCI/platform RUN builds | PASS | Both reached Ready after the actual asynchronous build |
| Deliberate RUN exit42 | PASS | E7010 includes the expected exit42 marker; official final state is error |
| Actual CLI v1/v2/v1 business artifacts | PASS | Correct version each time; result385; SHA256 `612b49cfa617bd2bdff85ed2854cf7e6461b129b1bf44daf3b8ddf0721a0556e` |
| Three actual sandbox cleanup reads | PASS | Independent HTTP404 for each created sandbox |
| Three template cleanup reads | PASS | Official GetTemplate404 and exact owned-name/ID absence from inventory |
| Permanent scenario totals | PASS |15 checks, exit0 |

The separate Python SDK runner owns the repository/application/preview/MCP workload. Its initial permanent run passed20 real checks: pinned repository commit `1a8c81f59d22fe10b987ffe5f9b59d15b5ed0ded`, exact app HTTP200, application-level HMAC preview valid200/unsigned403/tampered403/expired403, real filesystem MCP2026.7.10→2026.8.31 with14 discovered tools and a real `read_file` result385, log readback, removed processes/packages/data and independent sandbox404. See the [SDK runner](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/e2e/skill_tools_acceptance.py) and that owner's current evidence for its final formatting and rerun. Gateway-native preview signing, credential-requiring third-party tools and arbitrary Skills were not asserted.

## Cleanup

The permanent Node scenario independently deleted all three of its templates and all three sandboxes; the receipt records every absence check. Earlier exploratory templates were kept while other agents tested template-resource selection, memory/snapshot behavior and caches, then deleted when their owners released them. All four exploratory template IDs were independently audited for GetTemplate404 and inventory absence. The first stalled repository sandbox and both subsequent successful repository/MCP sandboxes were also independently read absent.

## Problems found

- An early exploratory attempt created v2 before its template reached Ready and received the actual HTTP409 CREATING response. The subsequent ready-gated run passed; the initial failure was retained separately.
- An early minimal authored manifest omitted spec5 and `provides`. Platform deployment accepted it, but the native client's cached-manifest resolver later rejected it. The task-owned source/cache manifests were corrected to truthful spec5/`provides: {}`. The permanent scenario authors valid spec5 before submitting and its actual native CLI create passes. This does not claim the broader deploy/cache consistency issue is fixed.
- A blob-filtered Git clone stalled. Its exact owned command was cancelled and its sandbox deleted. A bounded shallow clone using HTTP/1.1 and low-speed limits passed twice; the SDK runner retains this bounded recipe.
- Repeating exploratory cleanup on an already-deleted deliberately failing template produced NotFound in the first helper. A final independent absence-only audit confirmed all four references absent. No unrelated resource was removed.

## Not verified

Local Dockerfile builds, external VM snapshot conversion, production traffic migration, automatic cache/WarmPool refresh, provider-native signed preview URLs, every third-party MCP/Skill and other providers. Full repository CI and remote publication are coordinated separately; this scoped receipt is not a claim that those gates passed.

# Verification: explicit existing Team and regional runtime selection

Result: PASS for the selected existing Team and explicit `cn-hangzhou` endpoint. Cross-Team isolation and a second region remain NOT_RUN.

Base CLI revision: `2e32256acdd45eab026c5b1d71e4e886df4c0f77`, version 0.5.6 plus the task's local MCP resource-validation changes. Actual cloud CLI management operations and canonical CLI MCP were used. No new Team was created. Team and key identifiers are hashed in the sanitized evidence; credentials are never retained there.

## Input, return and effect

1. Pass the selected existing Team ID explicitly to `api-key.create`, with a unique owned name, ten-minute expiry, private exclusive `secret_file`, and explicit `--region cn-hangzhou --yes`. The secret file had mode 0600; the returned Team binding matched the requested Team.
2. Independently run `api-key.get` on the new key and verify the same Team binding. This is a management observation separate from create acknowledgement.
3. Start a fresh MCP client with that newly created credential and explicitly call `create_sandbox(template="base", timeout=120, region="cn-hangzhou")`. Independently confirm that the configured runtime endpoint matches the selected region. Run `printf TEAM_REGION_OK`; the actual sandbox returned exactly that output with exit 0.
4. Independently get the sandbox metadata. Its runtime `region` field is absent and remains null. The verified region evidence is explicit selection plus the actual matching regional endpoint, not fabricated backend metadata.
5. Delete only the new sandbox and independently observe not found.
6. Inactivate the new key using `api-key.update(..., status="inactive") --yes`, delete it, and independently query it: CLI exit 4, error E8005 with HTTP 404. A new MCP process using the deleted credential rejected runtime access with E1001. Remove the local secret file only after the verification attempt.

[Final machine-readable result](2026-10-26-explicit-team-region/report.json) records the exact scope, input region, binding comparisons, runtime effect and cleanup. [Initial attempt](2026-10-26-explicit-team-region/initial-report.json) preserves the active-key deletion rejection. The cloud required inactivation first; an initial cleanup helper omitted `--yes` for that write and was rejected locally. [Subsequent exact-ID cleanup](2026-10-26-explicit-team-region/key-cleanup-diagnostic.json) confirms inactivation, deletion and missing lookup for that first key as well. Neither initial failure was recast as a pass.

The two test-owned keys and both test-owned sandboxes were removed. Existing Team settings, existing keys and borrowed sandboxes were not changed. A successful same-Team connection does not establish cross-Team isolation or certify every possible region.

# Verification: Current provider guidance

- Date: 2026-10-24
- Result: PARTIAL — final owner checks and review pending.
- Tracking: [Issue 143](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/143).
- Base: `af0911a99f7269718f8e6488a835bdd441ab771c`.
- Scope: bilingual `guide/providers.md`, changelog and engineering records.

## Checked behavior and sources

- `src/cli/commands/template.ts` routes through a provider's specialized handler or generic template manager; source launch uses the documented selected-provider workflow. This contradicts the old blanket non-Express rejection paragraph.
- Published CLI 0.4.16 template launch help succeeds. An actual `abx --provider alicloud-express sandbox url not-a-real-id --port 9000` invocation returns unknown command before a backend request. Therefore the guide's existing no-standalone-URL statement is preserved; an initial contrary assumption was corrected before implementation.
- The independent Node SDK source exposes application HTTP/configuration contracts, not cloud creation or provider-engine integration. Python uses the existing local engine path.
- The [actual default/portable/proxy regression](https://github.com/Alibaba-Agent-Sandbox/awesome-providers/actions/runs/40110372103) and [public release verification](2026-10-24-cli-0416-release.md) are the existing runtime/publication evidence. This documentation change does not certify additional templates or run another cloud sandbox.

## Gates

Local relative-link targets exist in both languages. `npm run check:hygiene` passed, `bash scripts/check-repo-health.sh` passed with 106 PASS / 11 historical WARN / 0 FAIL, and `git diff --check` passed. Final remote CI and independent review remain required before merge. No historical evidence, release tag or package bytes are changed.

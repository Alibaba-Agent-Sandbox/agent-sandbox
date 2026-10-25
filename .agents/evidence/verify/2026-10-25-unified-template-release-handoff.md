# Verification: Unified template release handoff

- Date: 2026-10-25
- Scope: README and template launch guide, English and Chinese.
- Result: PASS for documentation consistency, relative links and repository health.

Current user guidance names CLI 0.5.0 as the minimum version for spec v5 instead of
referring to an unspecified next release or a source-only migration. This is a
compatibility requirement, not a claim that 0.5.0 has already been published.
Historical evidence is unchanged. Runtime implementation is unchanged from
`9717236c8169055f318bff3740d2f13b92248c50`, whose complete remote checks passed.

Validation: inspected both languages; checked local Markdown targets in the four
changed files; `git diff --check` and `bash scripts/check-repo-health.sh` passed.
No additional cloud tests are needed for this prose-only follow-up.

At this check, PR 152 was open/draft and mergeable; no v0.5.0 Git tag or GitHub Release
existed, npm 0.5.0 returned HTTP 404, and npm latest remained 0.4.17. The release
workflow publishes npm only after a GitHub Release is published. Tag push first
builds five platform binaries into a draft release. Public artifacts and the v5
catalog switch must be coordinated by the release owner.

- [PR 152](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/152)
- [Verified implementation CI](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40177685799)

# Verification: Preview release notice and developer community

- Date: 2026-11-10
- Base revision: `2f84e3f802e5f6abd98a528c457b844a9307041d`
- Scope: bilingual root READMEs and the original community QR image and this repository's engineering record.
- Environment: Linux, Node.js 22.22.2, Python 3.13.13.
- Result: PASS — scoped local validation; remote CI, merge and publication are separate.

## Content and image

The original 470 × 468 PNG was downloaded from the maintainer's attachment without editing. Independent decoding resolves the supplied DingTalk join code. Its origin query parameter is 1, while the supplied clickable URL has origin 11; both retain the exact same join code. Preserve both supplied inputs.

## Validation

- PASS: `npm ci`, `bash scripts/check-repo-health.sh --quiet` (106 passes, 11 pre-existing warnings, 0 failures), `npm run check:hygiene`. The first health invocation required the development toolchain; installing the lockfile dependencies resolved it.
- PASS: both root README languages checked for expected date/version/preview language, group number and exact original image bytes; all relative Markdown links resolve.
- PASS: `git diff --check`; seven-section note, matching proposed status and local evidence/index links inspected.
- The exact scoped files are this commit's README/image/UI changes and engineering records. Documentation checks do not establish runtime or cloud acceptance.

## Limitations and cleanup

No package release, cloud sandbox or model task is part of this documentation change. No temporary cloud resources created. DingTalk membership was not joined or authenticated. Publication is checked separately after merge.

## Description

<!-- Briefly describe what this PR does -->

## Type of Change

- [ ] 🐛 Bug fix
- [ ] ✨ New feature
- [ ] 🔧 Refactoring
- [ ] 📖 Documentation
- [ ] 🧪 Tests
- [ ] 📦 Template

## Changes

<!-- List the key changes -->

-

## Testing

<!-- How was this tested? -->

- [ ] Unit tests pass (`make test`)
- [ ] Lint checks pass (`make lint`)
- [ ] Manual testing done

## Checklist

- [ ] Code follows project conventions
- [ ] Tests added/updated
- [ ] Documentation updated (if needed)
- [ ] No sensitive information (API keys, tokens) included

## Definition of Done

<!-- Binding rule: see .agents/notes/DEFINITION-OF-DONE.md (EN/中文). A PR that is not done is a draft. -->

- [ ] Unit tests added/updated and passing
- [ ] E2E executed against real components; result recorded in `.agents/evidence/verify/<date>-<topic>.md` (no secrets, no leaked resources). If it could not run, the PR states `BLOCKED` and why
- [ ] ADR/note recorded under `.agents/notes/{proposed,implemented}/<category>/<date>-<slug>.md` (`Status:` matches the directory)
- [ ] Docs updated in English and Chinese (`docs/en`, `docs/zh`)
- [ ] CHANGELOG entry added under `[Unreleased]`
- [ ] `bash scripts/check-repo-health.sh` passes

# Verification: FC managed image readiness

- Date: 2026-11-06
- Change: [PR235](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/235), continuation after `014b6fb568f1860edf5ed85cfdd181cb64735ad0`.
- Result: PARTIAL — all local and installed checks pass; latest-head remote CI and joint cloud follow-up remain separate.
- Package: new unpublished npm 0.5.9 candidate; old immutable candidate retained unchanged.
- Environment: Linux, Node.js 22.22.2. No cloud operations were executed by this local check owner.

## Review and scope

The integration owner observed native IMAGE_NOT_EXIST for an owned image digest input and a certificate
chain exceeding the native environment budget. Independent runtime/integration review accepted the
narrow tag/readiness/CA-argument/environment/name correction before editing. No failed receipt or plan
was rewritten or replayed. The installed snapshot is separate from the test checkout.

## Commands and outcomes

```bash
npm run typecheck
npm run build
npx vitest run tests/test_cli/test_managed_application.test.ts
npm pack --pack-destination "$NEW_CANDIDATE/artifacts" --json
# Reuse the previous consumer lock's exact dependency resolutions; update only local tarball integrity.
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/check-release-artifact.mjs "$NEW_CANDIDATE/node_modules/.bin/abx"
```

59 managed behavioral regressions pass. The first focused attempt exposed two test/diagnostic issues:
the new name test used an invalid 64-character manifest name instead of its valid 63-character maximum,
and the verification-auth regression expected its existing specific removal diagnostic. The fixture now
uses the actual valid name limit; readiness precedes the existing removal check and complete runtime
verification still follows before publication. Assertions remain strict. Typecheck, build and installed
release-artifact checks pass. The complete local CI equivalent with the exact CI-pinned fixtures passes: 4,699 unit tests, five optional skips; its parity rerun passes 4,725 tests, five optional skips, and all 907 ledger entries with 11 moved owner entries verified. Hygiene, typecheck, lint, clean build and package entry pass. Repository health passes with 105 passes, 11 existing warnings and zero failures.

The new tarball SHA-256 is `756d3aca8ced1ddb9b8e4e8e32c20214f3608340384d32f7f8390b29367eb1c6`;
consumer lock SHA-256 is `5e3e78333cec22f1c5e2e7accc559348e5206f56e117d6a8b4780dce682caa07`.
The old tarball and installation were not modified. No tests run inside either installed snapshot.

## Cleanup and limitations

Local fixtures clean up in afterEach. Cloud resources and native absence are owned by the joint
integration run, which retains the first failed attempt as history. No package publication or merge is
claimed. Borrowed Personal ACR digest input remains dependent on native FC support; no tag is guessed.
Host CA validation does not establish the FC argv size limit. Tag observation/update is not a native CAS.

# Verification: Default-saved installed artifact gate

- Date:2026-10-28
- Issue:https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/210
- PR:https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/211
- Result:PARTIAL — actual packed/installed artifact passes; the follow-up commit requires current-head remote CI before source merge. No public package release performed.

## Failure preserved

At6484e42, remote Node20/22 tests/parity, typecheck, installer and docs checks passed. The Build package job of [run40646339397](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/actions/runs/40646339397) failed in actual npm artifact validation: the terminal driver still waited for Save for future commands after that obsolete scope menu had been removed. It timed out. The failure prevented readiness/merge; no gate was bypassed or relabeled.

## Corrected observable check

The same installed-executable POSIX arrow-menu cancellation assertion now selects Cancel from the actual authentication-method menu with Down/Down/Enter. It requires that no save-scope menu appears, no credential input is reached, no configuration is saved and no operation proceeds. Installed distribution terminal/navigation coverage is retained. Production CLI bytes and the actual Express acceptance scope from the previous record are unchanged by this follow-up.

## Executed commands and results

- `npm pack --pack-destination <isolated output> --json`:PASS.
- `npm install --global --prefix <isolated prefix> <actual tarball>`:PASS.
- `node scripts/check-release-artifact.mjs <installed abx>`:PASS, actual terminal authentication-menu cancellation, installed version, isolated normal/native/JSON/CI guidance, root/standard/native help, package source independence and complete license notices.
- `npx eslint scripts/check-release-artifact.mjs`:PASS.
- No repeat model/cloud call is required for this installed-test-harness correction. Prior positive Express business/negative-authentication/independent cleanup evidence remains separate and unchanged.

Internal package: `agent-sandbox-cli-0.5.8.tgz`, 2211302 bytes, SHA256 `8067730a61b2c6dd3630d2c44a725a94fea8500cc634faab23d966eaa7cbcf3f`. The unchanged0.5.8 version is a source candidate and must not overwrite the published immutable0.5.8 release.

The first metadata-only record writer expected an npm JSON array; npm12 emitted a package-keyed object. It stopped before staging/committing any file. This record instead measures the actual archive directly. Artifact validation itself had already passed.

## Cleanup and remaining gates

The artifact driver removes its isolated configuration, projects and local journals. No real cloud credential is supplied to that checker and no cloud resource is created. Mandatory final-head CI and normal review/merge remain required; earlier green matrices cannot substitute for this final commit. Final merge/check readback will be attached to the PR.

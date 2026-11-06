# Verification: FC certificate argument chunks

- Date: 2026-11-06
- Change: continuation of [PR235](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/235) after `f2fbe14`.
- Result: PARTIAL — focused, type/build and installed checks pass; latest-head full CI and real native follow-up remain independent gates.
- Package: unpublished npm 0.5.9 third immutable candidate, separate from the first two installations.

## Observed boundary and reviewed correction

The integration owner's next native create diagnostic returned a maximum 2048-character command
argument limit. No function was successfully created. The full public CA bundle remains unchanged;
its canonical Base64 is split into 1920-character chunks (a multiple of four) and delivered as separate
arguments after `--database-ca-base64`. The SDK owner independently accepted nargs-plus collection,
total encoded bounds and one strict canonical/ASCII/64 KiB decoding pass while preserving normal
single-argument SDK use. FC-specific chunk length belongs to this compiler, not the generic SDK.

The old plan, receipt and candidate remain unchanged. Complete command/entrypoint/digest/native
identity checks remain strict; neither argument truncation nor CA-chain reduction was introduced.

## Commands and actual results

```bash
npm run typecheck
npm run build
npx vitest run tests/test_cli/test_managed_application.test.ts
npm pack --pack-destination "$THIRD_CANDIDATE/artifacts" --json
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/check-release-artifact.mjs "$THIRD_CANDIDATE/node_modules/.bin/abx"
```

59 managed regressions pass. The changed CA case uses a real three-certificate PEM chain and verifies
multiple arguments of at most 1920 characters, four-character boundaries, exact reconstruction and
no CA environment variable. Eleven related regressions also passed independently before packaging.
Typecheck, build and the installed release-artifact checker pass.

Tarball SHA-256: `8b49247e67eac486c7663c32e1a4008949cfccee5cc8abc7e71544a4c86bca72`.
Consumer lock SHA-256: `b838283cc089ea6480c00416a3f33695659229e62b33f3bbf7f4109788a8cc15`.
The consumer retains all prior exact dependency resolutions and updates only the local artifact integrity.

## Cleanup and unverified scope

This local owner created no cloud resources; test temporary files clean up in afterEach. The integration
owner independently reconciles every failed attempt and exact native absence. Native total argument
limits and full application behavior still need actual FC verification; 64 KiB host validation does not
promise native acceptance of every bundle. No package publication or merge is claimed.

## Accepted producer provenance

The independent static-contract [PR299](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/299) merged as `31fe653c2940d8681b9549be3f570977152847a7` after current-head checks. The consumer source marker now points to those independently read-back identical schema bytes. That marker is test/provenance input and is absent from packaged dist; the installed third candidate remains unchanged.

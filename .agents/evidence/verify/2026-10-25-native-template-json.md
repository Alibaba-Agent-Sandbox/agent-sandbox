# Verification: Native template info JSON

- Date: 2026-10-25
- Change: [Issue 162](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/162)
- Result: PARTIAL — command, real cloud and static checks pass; local full suite retains environment failures and latest-head CI is pending.
- Package: local TypeScript candidate on CLI 0.5.1 main, with the native JSON correction. This is not a newly published version.
- Environment: Linux amd64, Node 22.22.2; selected Express account, read-only native inventory/detail. Credentials supplied only through the environment, values excluded.

## What was verified

The actual native command callback preserves nested objects, arrays, numeric, boolean and null values. Existing text-output coverage remains passing. The cloud-readonly native template-info scenario selected an actual ID from the same account's inventory and read status/runtime configuration as objects with numeric statusCode 200.

## Commands run

- `npm ci`
- `npx vitest run tests/test_cli/test_template_commands.test.ts`: 92 PASS.
- `npm run build`: PASS.
- `ABX_BIN='node dist/bin/abx.js' node e2e/run.mjs --suite cloud-readonly --filter 'cloud-readonly/template-info '`: one real native PASS; owned leak check SKIP because this read-only scenario created no resources.
- `node scripts/capture-cli-evidence.mjs --command template-info --out CAPTURE_DIR`: one affected offline command capture, preserved in [CLI evidence](../cli/native-template-info-20261025.md), not cloud proof.

- `npm run typecheck`, `npm run lint`, `npm run check:hygiene`, `bash scripts/check-repo-health.sh`: PASS (lint 0 errors; health 106 PASS/0 FAIL).
- Initial `npm test`: 4353 PASS, 13 FAIL, 50 SKIP. One failure was the old string-valued E2E fixture, corrected to structured values; remaining failures are the two existing local plugin-host version mismatches and ten transport/proxy interception expectations. Focused updated command/cloud-harness rerun: 150 PASS. Current-head CI follows.

## Cleanup

No cloud resources created or deleted. No unrelated account mutation. Existing native inventory/detail only.

## Problems found

The old output stringified structured official values. No legacy string parser is added to the new consumer.

## Not verified

New public distribution and remote full CI are pending. Failed no-match filter attempts selected zero scenarios and are not counted as E2E passes.

# Integration tests

Ports of the Python `tests/integration/*_e2e.py` files. The split follows the Python `@pytest.mark.integration` marker:

| File | Python marker | Default `npm test` | Needs |
| --- | --- | --- | --- |
| `test_cli_e2e.test.ts` | integration (10) | excluded | nothing (in-process `CliRunner`, sandbox API stubbed) |
| `test_shortcut_target_hint_e2e.test.ts` | integration (6) | excluded | a real `abx` process per call (temporary HOME, no credentials, no pseudo-terminal) |
| `test_nl_template_init_e2e.test.ts` | integration (16) | excluded | nothing (coding agent, build and sandbox API are stubbed) |
| `test_progress_activity_e2e.test.ts` | none (runs in CI) | included | nothing (fake TTY, mocked Docker / ACR) |
| `test_adopt_deploy_e2e.test.ts` | none (runs in CI) | included | nothing (real `QwenCodeBackend`, faked `qwen` subprocess) |
| `test_credential_priority_e2e.test.ts` | none (runs in CI) | included | nothing (isolated HOME and env) |
| `test_workflow_e2e.test.ts` | none (runs in CI) | included | nothing; only `TestCLICompleteness` (see below) |

```bash
npm test                    # unit tests + the unmarked integration files
npm run test:integration    # every file in this directory
npx vitest run tests/integration/test_cli_e2e.test.ts
```

The excluded files are listed in the `test` script of `package.json`; keep that list in sync with the Python markers.

## Credentials

Nothing is read from committed files and no file here needs real credentials or the network. Tests that spawn the real CLI
use a temporary HOME, drop every CI variable and set `ABX_NO_KEYCHAIN=1`. A future live test (real cloud, real pty) must take
its credentials from the environment and use `it.skipIf(...)` with a clear reason when they are absent.

`ABX_BIN` overrides the executable under test (default: `tsx src/bin/abx.ts`), e.g. `ABX_BIN="node dist/bin/abx.js"`.

## Moved to python-sdk

The other classes of `test_workflow_e2e.py` (`TestTemplateDefinition`, `TestCapabilityResolution`,
`TestImageChainBuilder`, `TestDeclarativeServerBridge`) test the Python SDK, not the CLI. They live on in
`python-sdk/client-sdk/tests/integration/test_workflow_e2e.py` and are listed in `parity/moved-to-python-sdk.txt`;
`npm run parity:coverage` verifies that they still exist there. `test_credential_priority_e2e.py` also asserts
`resolve_llm_env` (an SDK function covered by `client-sdk/tests/test_api/test_deploy.py`); that assertion is not repeated here.

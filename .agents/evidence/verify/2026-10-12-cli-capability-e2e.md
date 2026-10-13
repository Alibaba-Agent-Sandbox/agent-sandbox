# Verification: CLI capability black-box E2E

- Date: 2026-10-12
- Process: `ABX_BIN="/workspace/cli/node_modules/.bin/tsx /workspace/cli/src/bin/abx.ts" node e2e/run.mjs --suite offline,capability`
- Version printed: `abx, version 0.3.0`
- `dist/binary/abx-0.3.0-linux-x64` exists (mtime 2026-10-12 13:42 UTC) but is older than `src/cli/commands/sandbox.ts` and `template.ts` (15:43 UTC). That binary's `create --help` and `template init --help` do not mention `--model`, so the run used `tsx` on current `src/bin/abx.ts`.
- Profile check: `template init --adopt --dry-run` only lists files. The scenario ran local `abx --provider e2e-no-profile template init` with `ABX_PROVIDER` unset. Dockerfile was `FROM python:3.12-slim`, `WORKDIR /app`, `CMD ["python3", "commands.py"]`, and did not contain `fc-e2b-registry` or `dashscope`. No sandbox was created.

## Counts

| Suite | pass | fail | skip |
|---|---:|---:|---:|
| offline | 51 | 0 | 0 |
| capability | 7 | 0 | 0 |
| leak-check | 0 | 0 | 1 |
| total | 58 | 0 | 1 |

Exit code 0. Sandboxes created=0, leaked=0. Capability scenarios: `version-0-3-0`, `help-root-and-provider`, `provider-list-alicloud`, `create-help-model`, `template-init-help-model`, `template-profile-no-network`, `config-set-get-llm-model`.

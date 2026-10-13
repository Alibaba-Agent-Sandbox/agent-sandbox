# Decision: fixed command surface, one `exec`, server-only named commands

Status: implemented
Implemented: 2026-10-13
Supersedes: 2026-09-03-cli-run-vs-exec, 2026-09-03-command-source-resolution, 2026-09-23-cli-command-reduction

## Problem
The same action could be spelled several ways (user-configurable `[shortcuts]`, top-level `init`/`install`,
`sandbox process start`, `sandbox shell-stream`, `sandbox run`), named commands had two mechanisms
(`template.yaml` `custom_commands` and the in-sandbox server), and `--timeout` / `--profile` meant different things
depending on where they appeared.

## Decision
- Every action has one canonical noun-verb path. A fixed, hard-coded set of top-level shortcuts is the only alias
  mechanism: `create list info kill exec connect upload download run deploy`. They are listed under "Sandbox shortcuts"
  in `abx --help`. Source of truth: `src/cli/command_surface.ts`; `tests/test_cli/test_command_surface.test.ts` fails
  when the root command list differs from it.
- One `abx exec SANDBOX -- CMD...` (`--cwd --env --timeout --background --stream`). `process start`, `shell-stream` and
  `sandbox run` are removed. `abx connect` is a line-at-a-time loop, not a PTY.
- Named commands come only from the server running inside the sandbox (`GET /commands`, `POST /commands/{name}`):
  `abx sandbox command list` and `abx sandbox command run SANDBOX NAME [--arg K=V] [--json-args JSON]`, plus `abx run`.
  `template.yaml` `custom_commands`, placeholder substitution and the `server_port` kwarg are gone.
- Global `--profile` and `-t/--timeout` are removed; `--timeout` (sandbox lifetime) exists on `create` only.
- `abx config init` asks for credentials and region; `--build` and `--llm` add the registry and LLM sections.

## Consequences
Docs: `docs/{en,zh}/reference/cli-commands.md` lists the surface. No config migration is provided (the product is not
released). Parity tests for removed behavior were deleted, see `parity/KNOWN-GAPS.md`.

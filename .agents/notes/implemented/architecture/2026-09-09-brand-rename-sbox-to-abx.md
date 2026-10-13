# Decision: Brand rename sbox → abx

Status: implemented
Implemented: 2026-09-09

## Problem
The project initially used `sbox` as the CLI command name and brand identifier
(see `2026-09-02-sbox-cli-naming.md`). A rename became necessary for the
following reasons:

1. **Name collision**: `sbox` is close to the SELinux `sandbox` tool name, with a
   potential conflict on some Linux distributions.
2. **Brand recognition**: `sbox` is too generic and cannot build a strong
   association with the Agent Sandbox brand.
3. **Config directory**: the `~/.sbox/` directory name is not intuitive enough.

A new short name was needed that preserves typing efficiency while improving
brand recognition.

## Decision
Unify all brand references from `sbox` to `abx` (short for **E**asy Sand**b**o**x**).

### Scope of change

1. **CLI entry point**: `pyproject.toml` `[project.scripts]` changed from
   `sbox = ...` to `abx = ...`
2. **Config directory**: `~/.sbox/` → `~/.abx/`
3. **Environment variable prefix**: add the `ABX_` prefix (e.g.
   `ABX_SERVER_DISABLED_GROUPS`) while keeping `SANDBOX_*` compatibility
4. **Internal code references**: `ctx.meta` keys changed from `sbox.*` to `abx.*`
5. **Docs and AGENTS.md**: all CLI examples updated from `sbox` to `abx`
6. **Template directory**: `~/.sbox/templates/` → `~/.abx/templates/`

### Backward compatibility

- `SANDBOX_API_KEY` / `E2B_API_KEY` environment variables remain supported
  (first-match-wins precedence).
- No automatic `sbox` → `abx` migration (a new config directory is created the
  first time the user runs `abx`).

## API Design
N/A — this decision does not involve API changes. It only renames the CLI
command, config directory, and environment-variable prefix.

## Alternatives considered
- **`esb`** — collides with the finance-domain Enterprise Service Bus acronym. Rejected.
- **`ez`** — too short and ambiguous. Rejected.
- **`ezsb`** — four letters type less well than three. Rejected.
- **Keep `sbox`** — leaves the name-collision and brand-recognition problems unsolved. Rejected.

## Dependencies
- `2026-09-02-sbox-cli-naming.md` (the original naming decision, superseded by this ADR)
- `pyproject.toml` (entry-point configuration)
- `transport/config.py` (config paths)

## Test Strategy
- `abx --help` prints normally.
- The `~/.abx/` directory is created automatically on first use.
- No residual hardcoded `sbox` references remain in the source
  (`grep -r sbox src/` returns 0 results).

## Acceptance criteria
- ✅ The CLI command name is `abx`.
- ✅ The config directory is `~/.abx/`.
- ✅ No `sbox` residue remains in the source.
- ✅ The `ABX_*` environment-variable prefix takes effect in the server module.

## Implementation
- **Entry point**: `pyproject.toml` `abx = "agent_sandbox.cli.main:cli"`
- **Config directory**: `~/.abx/` in `src/agent_sandbox/transport/config.py`
- **Context key**: `ctx.meta["abx.output"]` in `src/agent_sandbox/cli/main.py`
- **Server environment variables**: `ABX_SERVER_DISABLED_GROUPS`, `ABX_SERVER_BASE_DIR`

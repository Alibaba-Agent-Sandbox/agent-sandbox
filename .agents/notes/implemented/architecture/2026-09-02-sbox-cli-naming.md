# Decision: CLI Named `abx`

Status: implemented

## Problem
Need a short, memorable CLI command name that doesn't conflict with existing system tools.

## Decision
CLI command is `abx`. Config directory is `~/.abx/`.

## API Design
N/A — this decision does not involve API changes.

## Alternatives considered
- **`ss`** — Conflicts with Linux built-in `ss` (socket statistics)
- **`sb`** — Too short, potential conflicts
- **`sandbox`** — Too long for frequent CLI use

## Dependencies
- `pyproject.toml` entry_points configuration

## Test Strategy
- Verify `abx --help` works and shows all commands
- Verify startup time < 200ms

## Acceptance criteria
- `abx --help` runs and lists all commands
- The user config directory resolves to `~/.abx/`
- The command name does not collide with common system tools (e.g. `ss`)

## Consequences
- Clear, memorable, no known conflicts
- Config at `~/.abx/` follows XDG-like convention

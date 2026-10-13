# Decision: `abx run` (Named Commands) vs `abx exec` (Raw Shell)

Status: superseded
Superseded-by: [2026-10-13-fixed-command-surface](../implemented/architecture/2026-10-13-fixed-command-surface.md)

## Problem
Users need to invoke template-declared named commands from the CLI, but the existing `abx exec` runs an arbitrary raw shell string. We need a clear division of labor between running a raw command and dispatching a template's named, parameterized command.

## Decision
Add a new top-level command `abx run` and keep `abx exec`:
- **`abx run <sandbox_id> <command_name> [--arg k=v ...]`** — template-aware dispatch of a named command declared in the sandbox's template `custom_commands`. Arguments are supplied as repeatable `--arg key=value` pairs, validated against the command's `args` schema, and `shlex.quote()`-escaped.
- **`abx exec <sandbox_id> <command>`** — unchanged; runs a raw shell command string (requires the `shell` capability).

Semantic split: `exec` = raw shell; `run` = template-declared named command.

## API Design
```bash
abx run <sandbox_id> <command_name> [options]

Options:
  --arg, -a <KEY=VALUE>     named-command argument (repeatable)
  --timeout, -t <seconds>   override the command's declared timeout
  --json, -j                structured output

Examples:
  abx run sb-abc123 serve --arg port=9000
  abx run sb-abc123 migrate --arg target=head --json
```
- Unknown `command_name` → error listing available commands (`abx run <id> --help` / discovery).
- Missing a `required` arg → error before execution.
- If the sandbox lacks the capability the command needs → `CapabilityNotSupportedError` (E3xxx) surfaced with its suggestion.

## Alternatives considered
- **Overload `abx exec` to also resolve named commands** — Ambiguous: a command name could collide with a real binary; blurs raw-vs-named semantics.
- **`abx <template>:<cmd>` dynamic registration** — Rejected; see the capability-model-alternatives rejected ADR.

## Dependencies
- `cli/commands/` (new `run` command)
- [`2026-09-03-custom-commands-schema.md`](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/.agents/notes/implemented/feature/2026-09-03-custom-commands-schema.md) (command definitions)
- [`2026-09-03-sdk-capability-surface.md`](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/.agents/notes/implemented/architecture/2026-09-03-sdk-capability-surface.md) (`sandbox.run` under the hood)

## Test Strategy
- Click CliRunner: `abx run` with valid args, repeated `--arg`, and `--json` output.
- Unknown command name and missing required arg produce non-zero exit codes with helpful messages.
- `abx exec` behavior unchanged (regression).

## Acceptance criteria
- `abx run <id> <name> --arg k=v` dispatches the named command and propagates its exit code.
- `abx exec` continues to run raw shell commands.
- Errors for unknown command / missing arg / missing capability are clear and actionable.

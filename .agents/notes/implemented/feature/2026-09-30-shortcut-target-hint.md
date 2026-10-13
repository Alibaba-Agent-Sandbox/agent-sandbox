# Decision: Plain-language hint for an invalid shortcut target

Status: implemented
Implemented: 2026-09-30
Related: [2026-09-30-configurable-cli-shortcuts.md](2026-09-30-configurable-cli-shortcuts.md)

## Problem

`abx config set shortcuts.<name> "<target>"` stores a command path, not a full
invocation. The first attempt is usually the command the user already types,
including the `abx` prefix:

```text
abx config set shortcuts.aaaaa "abx template init"
```

The rejection was a single comma-separated list of every legal target. It did
not say why `"abx template init"` was wrong, so the corrected form
(`"template init"`) had to be inferred from the list. The unknown-command hint
made the same mistake: it told the user to pass `"<target>"` without showing a
path that omits `abx`.

## Decision

The target stays a command path. A value that starts with `abx` is still
rejected; the message names the mistake and, when the remainder is a real
target, prints the command to copy.

```text
Invalid shortcut target: 'abx template init'
  Suggestion: Drop the leading "abx". The target is the command path only, for example "template init".
              Try: abx config set shortcuts.aaaaa "template init"
```

Rules, implemented by `_describe_invalid_shortcut_target` in
`src/agent_sandbox/cli/main.py`:

1. Collapse internal whitespace, then treat a first token of `abx` (any case)
   as the prefix to drop.
2. If what remains is in `_SHORTCUT_TARGET_MAP`, the hint is only the rule
   plus `Try: abx config set shortcuts.<alias> "<path>"`. The full target list
   is omitted.
3. Otherwise the hint states the same rule (and, when a prefix was present,
   that the remainder is still not a path) and lists targets grouped by their
   first word: `deploy`, `sandbox: connect, create, …`, `template: build, init, …`.
4. Text mode indents the continuation under `Suggestion:`. JSON keeps the
   unindented hint in `suggestion`.
5. A shortcut already stored with a bad target (including a leading `abx`)
   gets the same explanation on stderr at startup and is ignored.
6. The unknown-command hint uses a concrete example with no prefix:
   `abx config set shortcuts.NAME "template init"`.

The value is not rewritten in place. The file changes only when the user sets
a path the map accepts.

## API Design

N/A — this decision does not involve SDK API changes. The CLI helper is:

```text
_describe_invalid_shortcut_target(target: str, *, alias: str | None = None) -> str
```

`abx config set` prints that text as the error suggestion. `LazyGroup` prints
it under the existing "Invalid shortcut ignored" warning when a stored target
cannot be loaded.

## Alternatives considered

- **Accept `"abx template init"` and store `"template init"`.** Rejected: the
  file would not contain what the user typed, and the next edit of
  `config.toml` would still look inconsistent. The hint shows the exact
  command instead.
- **Keep the flat comma-separated list as the only suggestion.** Rejected:
  it names every target and still does not say to drop `abx`, which is the
  mistake a first attempt makes.
- **Only change the unknown-command sentence.** Rejected: the user who follows
  that sentence still hits `config set`, and that error was the one that
  failed to explain the prefix.

## Dependencies

`src/agent_sandbox/cli/main.py` (`_SHORTCUT_TARGET_MAP`, `LazyGroup`) and
`src/agent_sandbox/cli/commands/config_cmd.py` (`_set_shortcut`). No new
packages.

## Test Strategy

- Unit: `tests/test_cli/test_shortcuts.py` checks the `abx` prefix hint (no
  target dump, nothing written) and the grouped list for an unknown path.
  The startup warning for a bad stored target uses the same wording.
- End to end: `tests/integration/test_shortcut_target_hint_e2e.py` runs a
  fresh `abx` process per invocation, with `HOME` pointed at a temporary
  directory. That is required because the root command group reads
  `[shortcuts]` once, at process start. The test walks the user sequence:
  reject `"abx template init"` and `"ABX template init"`, reject an unknown
  path with the grouped list, store `"template init"`, read it back with
  `config get`, then in a new process run the alias (`aaaaa --list`) and
  require the same scaffold list as `template init --list`. Deleting the
  alias makes the next process report `No such command`. A hand-edited
  `aaaaa = "abx template init"` is ignored at startup while `abx init --list`
  still matches `abx template init --list`. `"abx not-a-command"` keeps the
  prefix rule and the grouped list. `abx config set --help` states the rule.
  `--json` returns the unindented suggestion. An unknown top-level command
  prints the concrete shortcut example.

The user-facing copy is the CLI tutorial, the CLI reference, the configuration
reference, troubleshooting, and the CLI design doc (English and Chinese).

## Acceptance criteria

- `abx config set shortcuts.aaaaa "abx template init"` exits 2, tells the user
  to drop `abx`, and prints `abx config set shortcuts.aaaaa "template init"`.
  The alias is not written.
- The same command with `"template init"` exits 0. A later process's
  `abx aaaaa --list` matches `abx template init --list`.
- `abx config set shortcuts.aaaaa ""` removes it; the next process has no
  `aaaaa` command.
- An unknown target mentions the no-prefix rule and groups `template` as
  `build, init, install, search`.
- `abx ccc` (no close spelling match) mentions
  `abx config set shortcuts.NAME "template init"`.

## Files changed

- `src/agent_sandbox/cli/main.py`
- `src/agent_sandbox/cli/commands/config_cmd.py`
- `tests/test_cli/test_shortcuts.py`
- `tests/integration/test_shortcut_target_hint_e2e.py`
- `tests/test_cli_evidence/golden/error-unknown-custom-hint.txt`
- `tests/test_cli_evidence/golden/help-config-set.txt`
- `docs/en/reference/cli-reference.md`, `docs/zh/reference/cli-reference.md`
- `docs/en/reference/configuration.md`, `docs/zh/reference/configuration.md`
- `docs/en/guide/cli-tutorial.md`, `docs/zh/guide/cli-tutorial.md`
- `docs/en/guide/troubleshooting.md`, `docs/zh/guide/troubleshooting.md`
- `docs/en/design/cli-design.md`, `docs/zh/design/cli-design.md`
- `CHANGELOG.md`

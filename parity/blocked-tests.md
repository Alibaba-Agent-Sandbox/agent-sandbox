# Blocked tests

**Current status: nothing is blocked.**

Every Python test listed in `parity/python-tests-to-port.txt` either has a TypeScript
counterpart or is listed in `parity/moved-to-python-sdk.txt`. `npm run parity:coverage`
reports `missing: 0`.

Tests for behavior that was removed from the CLI (user-configurable shortcuts,
`template.yaml` `custom_commands`, `process start`, `shell-stream`, global `--profile` and
`-t/--timeout`) were deleted rather than skipped; see `parity/KNOWN-GAPS.md`.

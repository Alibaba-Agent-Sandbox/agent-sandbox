# Verification: ecosystem guidance synchronization

Date: 2026-11-12
Result: PARTIAL
Baseline: 9e0b18610a111aa5a03b32966a805a2b6b6bb18e

## Scope and review

Align example lifecycle commands and actual MCP group help with the unified command surface. Correct current module-retirement mappings and active known-issue runner instructions; leave pinned historical captures and unregistered private adapters intact.

Command spellings and options were compared with the current parser and built help. Replacing historical result text, adding aliases, modifying runtime algorithms, upgrading template dependencies and recreating cloud resources were excluded after examining whether they were necessary for this task.

## Results

Local checks are recorded below. No cloud resources were created. Existing runtime receipts were preserved; modified source identity does not inherit a new qualification.

## Delivery limitations

The root dotenv's configured GitHub credential returned HTTP401, no alternate process credential or configured Git credential helper/gh session was available, and private Registry/Website fetches could not authenticate. Public producer main revisions were fetched and checked. Private consumers are based on the latest locally recovered task branches, not claimed current remote main. Finish local commits and reproducible bundles; push, PR, remote CI, review and merge remain blocked until authentication is restored. No new package, image or live website release is claimed.

## Local verification

- Reproducible npm ci and npm run build: PASS.
- Built CLI mcp --help and template list --help: PASS; MCP advertises actual initialization and deployment commands.
- Relevant MCP/command-surface Vitest selection: 44 passed, zero failures/skips.
- TypeScript: PASS. Scoped ESLint: zero errors, four existing warnings.
- Repository health: 106 passes, 11 warnings, zero failures.
- Lychee 0.24.2 offline with fragments: all 664 tracked Markdown inputs pass.
- The source installer edit is documentation only; no provider install or cloud operation ran.

Follow-up parser review corrected the last `--json run` example in named-command
help to `--json sandbox command run`. Rebuilt CLI and the named-command, MCP and
command-surface selection passed 61 tests. The change affects help text only,
with existing command argument/body tests retained.

Final global-selector-aware audit corrected the CubeSandbox provider guide deployment example and the remaining status-help example. No operation implementation changed.

## Authentication and delivery follow-up

The initial API Bearer request returned HTTP401, but the credential was not
invalid. Git push/fetch and the API's Basic authentication succeeded with the
same existing credential; no credential was changed or created. Public
producer source branches can now be pushed. Private Registry/Website main was
fetched successfully, and the prior coordinating PRs were confirmed merged.
This supersedes the initial delivery-authentication limitation above.

## Full remote suite and current MCP help capture

The initial full remote suite found one stale MCP-help snapshot (4,581 passed,
one failed, six skipped on Node22). Kept the already merged November10 captures
unchanged and captured current help in a new November12 batch. The existing
actual CLI snapshot suite passes all 87 cases after this correction. The new
capture contains template init/deploy rather than retired mcp deploy. No help
assertion was removed; the final complete remote suites remain required.

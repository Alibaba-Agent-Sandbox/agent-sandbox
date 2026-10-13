# Review area: `completeness` - did the port / split omit or degrade anything?

Reviewer: independent (did not write the port). Scope: whole project split (Python CLI -> Node port, original repo
-> `cli/` + `python-sdk/{client-sdk,server-sdk}`), proven by mechanical inventory. Detail reports:

* `cli/parity/review/completeness-cli.md` - CLI port inventories (modules, symbols, click tree, env, literals, exits, paths, endpoints)
* `cli/parity/review/completeness-sdk-split.md` - original path -> new path / deleted / MISSING, tests, packaging, CI, docs, examples
* Machine outputs + scripts: `cli/parity/review/inventory/` (`run_all.sh`, `out/*`)
* Differential harness: `cli/parity/diff/adv_completeness_click_tree.mjs` (66 commands / 315 params, exit 1 on any difference)
* Adversarial tests (fail today on purpose): `cli/tests/adversarial/completeness/completeness.test.ts` (`ADV-completeness-01..05`)

## Overall verdict

**Nothing was omitted from the CLI port or lost in the split; the Node CLI is behaviourally complete against the oracle.**
All 66 commands / 315 parameters are identical, all 97 env reads, all exit codes, all CLI-reachable message literals,
all 2980 original tests are accounted for (1351 in the Node ledger, 1647 unchanged in the SDK trees, 0 unaccounted;
ledger 999/999 passing, no skips). 0 files of the original repo are missing without a CLI-moved-to-Node justification.

What is **not** clean is documentation/cross-project consistency: the python-sdk docs and SDK runtime hints describe
`abx` features (`abx provider *`, `--provider`, `config check/migrate`, canonical `ABX_*` variables) that neither the
oracle nor the Node CLI has, and that `KNOWN-GAPS.md` does not record as a gap. Plus 3 stale maintainer cross-references.

Counts: 0 BUG in the CLI behaviour; 2 GAP-UNJUSTIFIED (F-01, F-07); 5 doc/stale-reference BUGs (low); the rest ACCEPTED-OK.

## Findings

### F-01 - GAP-UNJUSTIFIED (medium): python-sdk docs/hints advertise `abx provider`, `--provider`, `config check|migrate` that the Node CLI does not have

* Repro (Node CLI, isolated HOME):
  `HOME=$(mktemp -d) ABX_NO_KEYCHAIN=1 node cli/dist/bin/abx.js provider list; echo $?` -> `Error: No such command 'provider'` exit 2.
  Same for `abx config check`, `abx create --provider X`, `abx list --all-providers`. The oracle has none of these either.
* Documents claiming them as available: `python-sdk/docs/en/guide/providers.md:3,22,26,45-62,127,246`,
  `docs/en/reference/error-codes.md:181`, `docs/en/reference/configuration.md:139,334`, zh counterparts,
  `python-sdk/examples/providers/opensandbox/README{,.zh-CN}.md:8,26`; and SDK runtime messages
  (`python-sdk/client-sdk/src/agent_sandbox/providers/{registry,store,base,epp,installer}.py`: `Run 'abx provider list'`, `'abx provider info ID'`, `'abx provider doctor ...'`).
  `python-sdk/docs/en/guide/providers.md:3` says the commands "are provided by the Node.js CLI", while `python-sdk/docs/en/DESIGN.md:127` says `abx provider` is "pending in the CLI" - the docs contradict each other.
* Expected: either the feature exists in the Node CLI, or the docs/hints say "planned". Actual: the only place that says
  "not yet" is `cli/docs/design/providers-and-credentials-cli.md:3` ("applied after the port reaches parity"); `cli/parity/KNOWN-GAPS.md` and
  `cli/docs/PORTING.md` never mention it (grep `provider` -> 0 hits), so the deferral is undocumented where gaps are tracked.
* Root cause: spec-only delta (`cli/docs/design/providers-and-credentials-cli.md`); no `cli/src/providers/`, `cli/src/cli/commands/provider.ts`, `cli/src/utils/config_keys.ts`.
* Not a regression vs the oracle (the original has none of it), hence not a BUG in the port; severity medium because users following the SDK docs hit a dead command.
* Fix: add a "Providers/credentials CLI delta not ported" entry to `KNOWN-GAPS.md`, and mark the python-sdk pages "CLI support pending"
  (or implement the spec). Test: `ADV-completeness-03` (KNOWN-GAPS mentions it) and `ADV-completeness-04` (every advertised command resolves).

### F-07 - GAP-UNJUSTIFIED (medium): canonical client variables documented for "SDK and CLI" are ignored by the CLI

* Repro: `HOME=$(mktemp -d) ABX_NO_KEYCHAIN=1 ABX_SANDBOX_API_KEY=sk-adv-canonical-123456 node cli/dist/bin/abx.js config get sandbox_api_key` ->
  prints the built-in default `e2b***dc1`; with `E2B_API_KEY=sk-adv-canonical-123456` it prints `sk-***456`.
* Evidence of the claim: `python-sdk/docs/en/guide/environment-variables.md:277,318`, `reference/configuration.md` (names `ABX_SANDBOX_API_KEY`,
  `ABX_SANDBOX_BASE_URL`, `ABX_SANDBOX_DOMAIN`, `ABX_PROVIDER`, `ABX_ALICLOUD_EXPRESS_*`, `ABX_HTTP_TIMEOUT`, `ABX_MAX_RETRIES`, `ABX_LOG_LEVEL`, ... ~30 names) and the Python
  `utils/config_keys.py` docstring ("The Node.js CLI implements the same algorithm"). `grep ABX_SANDBOX cli/src` -> 0 hits.
* Root cause: `cli/src/transport/config.ts` implements the original (pre-canonical) layering; `src/utils/config_keys.ts` from the spec was not created. Same root as F-01.
* Impact: a user configured per the SDK docs gets different credentials in SDK vs CLI. Test `ADV-completeness-05`.
* Fix: same as F-01 (implement, or record in KNOWN-GAPS and annotate the docs).

### F-02 - BUG (docs, low): `cli/AGENTS.md:193` says the evidence capture script stays in python-sdk

`scripts/capture_cli_evidence.py ... stays in the python-sdk repository`. It does not exist in `python-sdk/scripts/`; it was rewritten as
`cli/scripts/capture-cli-evidence.mjs`. Test `ADV-completeness-02`.
Fix: point to `scripts/capture-cli-evidence.mjs`.

### F-03 - BUG (docs, low): `cli/parity/KNOWN-GAPS.md:159` cites `src/utils/async_bridge.ts`, which does not exist

Module intentionally not ported (the same entry says it "exports nothing"); the file is not there. Test `ADV-completeness-01`. Fix: reword to "no `async_bridge` module".

### F-04 - BUG (docs, low): `cli/parity/blocked-tests.md:69` cites `tests/test_cli_evidence/test_mcp_evidence.test.ts` (does not exist)

Real file: `tests/test_cli_evidence/test_evidence_snapshots.test.ts`. Test `ADV-completeness-01`.

### F-05 - BUG (docs, low): `cli/docs/PORTING.md:131` requires findings in `parity/review-log.md`, which does not exist; `PORTING.md:28` tells reviewers to set `ABX_NO_KEYCHAIN=1`, which neither implementation reads

Harmless (the keychain integration was removed upstream), but the instruction is misleading. Test `ADV-completeness-01` (first part).
Fix: create the log or point to `parity/review/*.md`; drop or footnote `ABX_NO_KEYCHAIN`.

### F-06 - BUG (docs, low): `python-sdk/docs/en/design/agents-api.md:6` links to `../../zh/design/agents-api.md`, which does not exist

The zh tree lacks 5 en-only pages added after the split baseline (`agents-api.md`, `agents-api-review.md`,
`provider-opensandbox-mapping.md`, `repository-layout.md`, `server-sdk-v2/`). Fix: translate, or drop the link/mark en-only.
Also `cli/docs/{en,zh}/design/cli-design.md:11` (`#3-natural-language-creation`) and `cli/docs/zh/design/architecture.md:129`
(`../reference/configuration.md#credential-resolution`) have broken anchors (the two `cli-design` ones pre-exist in the original).

### F-08 - ACCEPTED-OK: client `pyproject` drops `[cli]`/`[binary]` extras and the `abx` script; sdist no longer carries SKILL.md/CHANGELOG

User-approved (CLI moved to Node). `migrating-from-0.2.md` documents it; `SKILL.md` ships in the npm package (`npm pack --dry-run`); packaging tests rewritten.

### F-09 - ACCEPTED-OK: 92 message literals "not found verbatim"

All classified in `completeness-cli.md` section 5 (regexes, strftime, Python-only install hints, deploy logs, the documented template_guide change, split literals).

### F-10 - ACCEPTED-OK: 61 "missing" symbols

45 `*_sync` wrappers + `async_bridge` + typing artefacts + re-implemented helpers; all in KNOWN-GAPS or restructured in place.

## Held up (attacked, no defect found)

* Click tree: 66/66 commands, 315/315 params, field-by-field (incl. envvar, defaults, hidden, deprecated, help text, context_settings). Checker mutation-tested.
* Env reads: 97/97 CLI-reachable names present.
* Exit sites: per-module multiset equal (63 vs 62; the delta is uvicorn's own `exit(3)` on start failure).
* Test accounting: 2980/2980; ledger 999/999 passing, 1333/1333 parametrised instances, 0 skips; 4 `TestCLICompleteness` + 3 removed packaging tests accounted for.
* Documented commands: 360 distinct `abx ...` lines of `README.md`, `llms.txt`, `SKILL.md`, `AGENTS.md`, `docs/**` run with `--help` on both Node and the oracle: 340 exit 0, 20 non-zero, **0 Node-vs-oracle differences**; all 20 non-zero are intentionally "removed command" mentions (`abx auth`, `abx secret`, `abx skill`, `abx session`, `abx config reset`, `abx template build-local`, `abx crate` typo example) or placeholders.
* Package contents: `npm pack --dry-run` -> `bin`, `dist/**`, README(s), SKILL.md, LICENSE, NOTICE, no tests/sources leaked.
* Docs: all 77 original en/zh pages exist; 22/22 examples; 9/9 scripts; 3/3 benchmarks; all GitHub templates, hooks, dependabot, 3 original workflows.
* Links: 595 links in `cli` (3 broken anchors, 2 pre-existing), 983 in `python-sdk` (1 real broken link, F-06).
* Symbols of the original SDK: none removed from the public surface (6 private config helpers replaced by the layered resolver).

## How to reproduce

```
cd cli && npm run build
ORIG_REPO=<original python repo> ORACLE_VENV=<oracle venv> bash parity/review/inventory/run_all.sh
ORACLE_VENV=<oracle venv> node parity/diff/adv_completeness_click_tree.mjs
npx vitest run tests/adversarial/completeness      # 5 failures by design: 01 -> F-03/F-04/F-05, 02 -> F-02, 03+04 -> F-01, 05 -> F-07
```

# Porting contract: Python `ebx` -> Node.js `ebx`

The original project (`github.com/easy-sandbox/easy-sandbox` @ `b15b88f`, v0.2.0) shipped the CLI as part of one
Python package. This repository is the Node.js replacement for that CLI. **Hard rule: the Node CLI must not lose,
degrade, or silently change any CLI behaviour.** The only intended differences are the ones the task asked for
(implementation language, split of repositories, Python-specific install/packaging story).

## Reference material (this VM)

| What | Where |
|------|-------|
| Original Python source (pristine checkout) | `/tmp/easy-sandbox/src/easy_sandbox/` |
| Original Python tests (incl. golden CLI snapshots) | `/tmp/easy-sandbox/tests/` |
| Python **oracle** CLI (original behaviour, runnable) | `/tmp/venv-orig/bin/ebx` (always run with an isolated `HOME`, see below) |
| Ledger of Python CLI/agent tests that must be ported | `parity/python-tests-to-port.txt` |
| Original docs | `/tmp/easy-sandbox/docs/` |

If any of the `/tmp` paths is gone, re-clone `https://github.com/easy-sandbox/easy-sandbox` at commit `b15b88f` and
`pip install -e ".[dev]"` it into a venv.

Always run the oracle with `HOME=$(mktemp -d) EBX_NO_KEYCHAIN=1 ...` (and no CI env vars) so it never touches real
config; point it at a local stub HTTP server through `E2B_API_URL`/`SANDBOX_API_BASE_URL`/`E2B_DOMAIN` like the Python
tests do.

## Module mirroring

Python `src/easy_sandbox/<pkg>/<mod>.py` maps to `src/<pkg>/<mod>.ts` (kebab/snake file names are kept in
`camelCase`-free form: keep the Python file name, e.g. `session_manager.ts`, `docker_builder.ts`, `config_cmd.ts`).
Imports use `.js` extensions (NodeNext ESM).

* `models/ utils/ transport/ protocol/ api/ session/` -> same names under `src/`.
* `cli/**` -> `src/cli/**` (`cli/main.py` -> `src/cli/main.ts`, `cli/commands/*.py` -> `src/cli/commands/*.ts`).
* `agent/{adopt,clarify,codegen,coding_agent,qwen_code,template_guide,dockerfile_sources,mcp,mcp_http,tools}.py`
  -> `src/agent/*.ts`. (`agent/builtin.py` and `agent/infer.py` are SDK-only; do not port unless the CLI reaches them.)
* `server/*` is the Python server SDK (stays in `python-sdk/server-sdk`). The CLI only needs the *facts* about it
  (capability group names, registry/route-table API names used in generated templates, wire endpoints); embed them as
  data/strings exactly as the Python CLI emits them.

## Naming / data rules

* Functions and methods: `snake_case` -> `camelCase`. Classes/exceptions/enums: names unchanged.
* **Data fields that appear on the wire or in `--json` output keep their Python `snake_case` names and key order**
  (`sandbox_id`, `exit_code`, `execution_time`, ...). Do not camelCase them.
* Exception classes keep names and `code` (`E1xxx` ...) and message/suggestion text verbatim; exit-code mapping must be
  identical (0/1/2/3/4/5/6 as documented in `docs/en/design/cli-design.md`).
* Every user-visible string (help, errors, warnings, prompts, suggestions, hints) is copied verbatim - including
  Chinese text and trailing punctuation. Do not "improve" wording.
* stdout vs stderr channel policy, `--json`/`--quiet`/`--ci`/`--no-color`/`--verbose` semantics and CI/TTY detection
  are part of the contract (see `OutputManager` in `cli/output.py`).
* Config/credential file locations, formats and precedence are identical (`~/.ebx/config.toml`, `~/.ebx/.env`,
  `./.env`, env var names, keychain behaviour, `~/.ebx/{bin,templates,index,generated}`).
* Time, randomness, filesystem and network access go through small seams (module-level functions) so tests can mock
  them; mirror the seams the Python tests patch (`run_sync`, `load_config`, `Sandbox`, ...), adapting names to camelCase.
* No behaviour may be dropped because a Node library is inconvenient. If you truly cannot match something, stop and
  record it in `parity/KNOWN-GAPS.md` with the exact Python behaviour - never hide it.

## Stack

TypeScript (strict, ESM, Node >= 20), `vitest`, runtime deps already installed: `yaml`, `smol-toml`, `ws`,
`@inquirer/prompts`. Add a dependency only when needed and say why in the PR/commit message. Prefer Node built-ins
(`fetch`, `node:child_process`, `node:zlib`, `node:crypto`, `node:readline`). The Alibaba Cloud template API uses
`@alicloud/fcsandbox20260509` + `@alicloud/openapi-client` (Node counterpart of `alibabacloud-fcsandbox20260509`).

## Tests = the spec

Every Python test listed in `parity/python-tests-to-port.txt` must exist as a Node test:

* file: `tests/<same relative path as python>` with `.py` -> `.test.ts` (e.g. `tests/test_cli/test_main.test.ts`)
* `describe("<ClassName>")` for tests inside a Python class (nest nothing else); module-level functions sit at top level
* `it("<python test function name verbatim>")`; parametrised tests may append ` [param]` to the title
* assertions must be as strict as the Python ones (same expected strings/exit codes/JSON). Golden files from
  `tests/test_cli_evidence/golden/` are copied byte-for-byte into `tests/test_cli_evidence/golden/`.

`npm run parity:coverage` (script `scripts/parity-coverage.mjs`) runs vitest and reports which ledger entries have no
matching Node test. A test that is skipped or trivially weakened counts as a defect and will be found by the
adversarial review.

Python tests of the *SDK* modules the CLI re-implements (transport/protocol/api/models/utils) live in
`python-sdk/client-sdk/tests/`; port the ones exercising behaviour the CLI relies on (same title rules,
`tests/<same path>`), they are not in the ledger but reviewers will check them.

## Differential (oracle) testing

`parity/diff/` holds a stub platform/envd/server and a case runner that executes the same argv against the Python oracle
and the Node CLI (isolated HOME, same env, same stub) and diffs `exit code`, `stdout`, `stderr` after normalisation
(timestamps, temp paths, ids, ports). Any unexplained diff is a bug in the Node port.

## Review protocol (multi-agent, adversarial)

1. Builder agents port a slice and write its tests.
2. Independent *adversary* agents (who did not write the slice) re-read the Python slice line by line and try to find:
   missing branches, changed strings, different defaults, different exit codes, swallowed errors, different
   stdout/stderr routing, platform-specific code dropped (Windows/macOS), env var / config precedence differences,
   missing tests, weakened assertions. They add failing tests / diff cases first, then report.
3. Builders fix; adversaries re-verify. Loop until an adversary finds nothing it can reproduce.
4. Every finding and its resolution is appended to `parity/review-log.md`.

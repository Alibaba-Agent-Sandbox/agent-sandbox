# Completeness review: the project split (original single repo -> `cli/` + `python-sdk/{client-sdk,server-sdk}`)

Inventory source: every git-tracked file of the original repo (622 files) classified by
`inventory/split_files.py` (path-exact, `src` -> `client-sdk/src` or `server-sdk/src`, `.py` -> `.ts/.mjs/.test.ts`,
basename fallback, content diffstat). Complete row-by-row mapping (original path -> new path(s) + diffstat):
**`inventory/out/split-files.tsv`**. Regenerate with `inventory/run_all.sh`.

| Status | Files | Meaning |
|---|---|---|
| SAME | 362 | byte-identical copy at the new path(s) |
| CHANGED | 172 | exists at the new path with edits (version, repo URLs, CLI->Node references, new features) |
| PORTED | 70 | Python CLI source/test file -> TypeScript file in `cli/` |
| RELOCATED | 11 | moved + renamed (table below) |
| MISSING | 7 | **none is a real omission** (table below) |

## 1. MISSING (7) and RELOCATED (11)

| Original | Status | New / reason |
|---|---|---|
| `.aicoding-chat-workspace` | dropped | empty editor artefact |
| `benchmarks/__init__.py` | dropped | package marker for a directory that is no longer a Python package |
| `src/easy_sandbox/cli/__init__.py`, `cli/commands/__init__.py` | dropped | CLI moved to Node (`cli/src/cli/index.ts`, `cli/src/cli/commands/index.ts`); user-approved |
| `tests/test_cli/__init__.py` | dropped | pytest package marker |
| `tests/test_cli_evidence/__init__.py`, `conftest.py` | dropped | replaced by `cli/tests/test_cli_evidence/{evidence_cases.ts,capture_cli_evidence.capture.ts}` + vitest |
| `benchmarks/bench_cli_startup.py` | relocated | `cli/benchmarks/bench_cli_startup.mjs` |
| `benchmarks/bench_create.py`, `bench_import.py` | relocated | `python-sdk/client-sdk/benchmarks/` |
| `scripts/capture_cli_evidence.py` | relocated (rewritten) | `cli/scripts/capture-cli-evidence.mjs` (note: `cli/AGENTS.md:193` still says it "stays in python-sdk", finding F-02) |
| `scripts/evidence_cases.py` | relocated | `cli/tests/test_cli_evidence/evidence_cases.ts` |
| `scripts/cloud_e2e_test.py`, `e2e_build_and_test.py`, `quick_build_test.py` | relocated | `python-sdk/scripts/e2e/` |
| `tests/test_cli/conftest.py` | relocated | `cli/tests/test_cli/conftest.ts` |
| two `.agents/notes/**` ADRs about the single-distribution `[cli]` extra / PyPI packaging | relocated | `cli/.agents/notes/superseded/`, `python-sdk/.agents/notes/superseded/` (marked superseded) |

## 2. Per-area mapping (counts by top-level area of the original)

| Original area | Files | Destination |
|---|---|---|
| `src/easy_sandbox/{agent,api,compat,declarative,extensions,models,protocol,session,transport,utils}` (non-CLI-only modules) | see `split-files.tsv` | `python-sdk/client-sdk/src/easy_sandbox/**`; the CLI-reachable ones are *also* ported 1:1 to `cli/src/**` |
| `src/easy_sandbox/server/**` | 13 (2 SAME, 11 CHANGED) | `python-sdk/server-sdk/src/easy_sandbox/server/**` (namespace package) |
| `src/easy_sandbox/cli/**` + 7 `agent/*` CLI-only modules (`adopt, clarify, codegen, coding_agent, dockerfile_sources, qwen_code, template_guide`) | 25 | `cli/src/cli/**`, `cli/src/agent/**` (PORTED) |
| `src/easy_sandbox/py.typed` | 1 | client-sdk, server-sdk (own `py.typed`) |
| `tests/**` | 244 | 1647 collected test ids -> `python-sdk/*/tests`; 1333 -> `cli/tests` (see section 3) |
| `docs/{en,zh}/**` | 77 | 17 SAME + 60 CHANGED, none missing (section 5) |
| `examples/**` | 22 | all 22 under `python-sdk/examples/` (8 CHANGED: CLI->Node wording, repo URLs) |
| `scripts/**` | 9 | section 1 + `build_binary.mjs`, `build_hermes.sh`, `deploy_all_templates.sh`, `deploy_remaining.sh` in `cli/scripts/` |
| `benchmarks/**` | 4 | section 1 |
| `.github/**` | 15 | section 6 |
| `.githooks/**`, `.pre-commit-config.yaml`, `.secrets.baseline`, `.env.example`, `.gitignore`, `LICENSE`, `NOTICE`, `Makefile`, `AGENTS.md`, `CHANGELOG.md`, `README{,.zh-CN}.md`, `llms.txt`, `SKILL.md`, `.python-version`, `pyproject.toml` | 20 | copied/adapted into both subprojects (`SKILL.md` -> `cli/` only; `.python-version` -> `python-sdk/` only; `pyproject.toml` -> split) |
| `.agents/**` (128 notes/evidence) | 128 | `python-sdk/.agents/**` and `cli/.agents/**` (30 CHANGED, 96 SAME, 2 RELOCATED) |

## 3. Tests: original vs new

* Original collected with the oracle venv (`pytest --collect-only -q`): **2980 test ids**.
* New collection (`python-sdk`, both venvs): client-sdk **2128**, server-sdk **582** = 2710.
* Node: `npm run parity:coverage` -> **999 ledger base ids (1333 raw parametrised ids): 999 passed, 0 failed/skipped, 0 missing, 18 moved to python-sdk (verified present there)**. `inventory/out/ledger-params.txt`: every ledger id has >= as many Node test instances as Python had parameters (1333/1333).
* Accounting of the 2980 original ids (`inventory/run_all.sh` + `/tmp` id join): **1351 are in the CLI ledger, 1647 exist unchanged in the new SDK test trees, 18 are in both, 0 are in neither.**
* Function-level body comparison (`py_test_bodies.py`, `ast.dump` equality): 1673 test functions identical, 13 modified, 7 removed from the SDK copies, 47 files not in the SDK (CLI-owned, ported).
  * 13 modified: `TestDeclarativeServerBridge`/`TestServerProxy`/`TestRegisterUploadDownload` (server moved to `easy-sandbox-server`), `TestInjectSdkWheel` x3 (wheel injection semantic changed to 2-dist), `TestErrorsAll.test_all_list_contains_all_classes` (new `E8xxx` errors).
  * 7 removed: 4 x `TestCLICompleteness::*` (in the Node ledger: `cli/tests/integration/test_workflow_e2e.test.ts`), 3 x sdist/wheel tests about `SKILL.md`/`llms.txt` (SKILL.md now ships in the npm package; `npm pack --dry-run` lists `SKILL.md`, `README*.md`, `LICENSE`, `NOTICE`, `dist/**` and no tests; `package.json#files`).
* Node total in this run: 2909 passing tests + the 5 adversarial tests added by this review (which fail on purpose).

## 4. Symbol-level split check (SDK side)

`py_symbols_split.py` compares every top-level symbol/signature of the original `src/` with `client-sdk/src` + `server-sdk/src`:
79 modules compared; 25 absent (all CLI-owned: ported to Node); **6 removed**, all private helpers of
`transport/config.py` (`_coerce_value`, `_load_dotenv_file`, `_read_env_vars`, `_env_dict_to_fields`, `_ENV_VAR_MAP`,
`_NUMERIC_FIELDS`) replaced by the layered resolver `utils/config_keys.py`; 21 signature changes, all **additive** keyword
parameters (`provider`, `provider_options`, `sandbox_*` canonical names, `scopes`, `ctx`, `policy`, `limit`, `route`).
No public symbol of the original SDK was removed.

## 5. pyproject / packaging

| Item | Original | New | Verdict |
|---|---|---|---|
| distributions | `easy-sandbox` 0.2.0 | `easy-sandbox` 0.3.0 (hard dependency `easy-sandbox-server==0.3.0`) + `easy-sandbox-server` | by design |
| extras | `cli`, `mcp`, `fast`, `declarative`, `session`, `alicloud`, `binary`, `all` | `fast`, `session`, `mcp`, `declarative`, `alicloud`, `server` (empty alias), `all` | `cli`, `binary` removed - user-approved (CLI moved to Node), documented in `docs/en/guide/migrating-from-0.2.md`; `server` is a new empty alias (`easy-sandbox-server` is now a hard dependency); `all` rewritten to `fast,session,mcp,declarative,alicloud,server` |
| entry points | `ebx = easy_sandbox.cli.main:cli` | none in client; `easy-sandbox-server = easy_sandbox.server.__main__:main` in server; `ebx` -> `cli/package.json#bin` | by design |
| package data | `py.typed` (wheel artifact) | `py.typed` in client and server wheels | present |
| sdist content | `src/`, `tests/`, README, SKILL.md, LICENSE, NOTICE, CHANGELOG | `src/`, `tests/`, README, LICENSE (+ per-dist) | `SKILL.md` ships in the npm package; tests rewritten (`test_packaging.py`) |
| templates / schemas | none shipped as package data (only `py.typed`) | same | n/a |
| `llms.txt` | repo root, excluded from sdist by test | `cli/llms.txt`, `python-sdk/llms.txt`, still excluded | same |
| npm package | - | `bin.ebx`, files `dist`, `README.md`, `SKILL.md`, `LICENSE`, `NOTICE` (342 files by `npm pack --dry-run`) | complete |

## 6. GitHub / CI / hygiene

| Original | New |
|---|---|
| `.github/workflows/ci.yml` (lint, test, build) | `python-sdk/.github/workflows/ci.yml` (hygiene, client-sdk, server-sdk, build) and `cli/.github/workflows/ci.yml` (lint, test, build) |
| `publish.yml` (PyPI) | `python-sdk/.github/workflows/publish.yml` (both dists) + `cli/.github/workflows/release.yml` (npm) |
| `release-binary.yml` | `cli/.github/workflows/release-binary.yml` |
| (new) | `docs-links.yml` in both |
| `ISSUE_TEMPLATE/{bug_report,config,docs_improvement,feature_request,template_request}.yml`, `PULL_REQUEST_TEMPLATE.md`, `DISCUSSION_TEMPLATE/welcome.md`, `discussions/welcome-post.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `dependabot.yml` | all present in both `cli/.github` and `python-sdk/.github` (`dependabot.yml` adapted: npm + github-actions for cli, pip `/client-sdk` + `/server-sdk` + github-actions for python-sdk) |
| `.githooks/{pre-commit,check-secrets.sh}`, `.pre-commit-config.yaml`, `.secrets.baseline` | present in both |
| (new) `CODEOWNERS`, `.editorconfig`, `scripts/check-*.sh`, `check_dists.py`, `e2e-cleanup.py` | python-sdk only |

## 7. Docs (en/zh), examples, scripts, awesome-templates

* **Docs**: all 77 original pages (`docs/{en,zh}/{design,explanation,guide,reference}`) exist, split by ownership:
  CLI pages (`cli-design`, `templates-catalog`, `cli-tutorial`, `cli-reference`, `binary-installation`, `agent-skill-installation`,
  `byo-agent-integration`, `deploy-and-build`, `e2e-template-workflow`, `using-templates`) in `cli/docs`; SDK/server pages in
  `python-sdk/docs`; 12 pages per language (`README`, `DESIGN`, `design/architecture`, `design/mcp-server`, `guide/{authentication,authoring-templates,environment-variables,getting-started,mcp-integration,troubleshooting}`, `reference/{configuration,error-codes}`)
  in both projects. en/zh parity inside the original: complete. In `python-sdk/docs` the zh tree lacks 5 en pages that did not exist in the
  original (`design/agents-api.md`, `agents-api-review.md`, `provider-opensandbox-mapping.md`, `repository-layout.md`,
  `design/server-sdk-v2/`), leaving 1 broken cross-link (finding F-06).
* **Examples**: 22/22 under `python-sdk/examples/` (`agents/`, `compat-demos/`, `quickstart/01..05`, `templates/python-hello/`) + new `providers/opensandbox/`.
* **Scripts**: 9/9 (section 1 and `cli/scripts/`). **Benchmarks**: 3/3 + package marker.
* **awesome-templates**: original 205 mentions; every file carrying them exists in the new tree (cli: `src/utils/template_index.ts`, `src/cli/commands/template.ts`, 8 goldens/tests, `docs/{en,zh}/**`; python-sdk: docs); the Node port reproduces the index URL (`src/utils/template_index.ts:39`) (ledger `test_template_index`, `test_registry`).

## 8. Non-source artefacts

`.mypy_cache/`, `__pycache__/` appear in `python-sdk` but are git-ignored (`python-sdk/.gitignore:30`, `:2`); `scripts/local-paths.private` is git-ignored (`.gitignore:74`) and is a 33-byte local file. No tracked artefact leaked.

## Verdict (split)

0 original files, symbols or tests are lost. Every deletion is a CLI-moved-to-Node deletion with a Node replacement.
Remaining issues are documentation consistency, listed in `completeness.md`.

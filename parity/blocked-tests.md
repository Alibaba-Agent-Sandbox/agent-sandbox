# Tests written but blocked on later builders (CLI framework slice)

**Current status: nothing is blocked.** Every command module and seam this file waited on has landed, the `it.skip` /
`skipIf` gates are gone, and `npm run parity:coverage` reports `missing: 0`. The tables below are the historical record
of what each skip waited for.

Status when the command modules first all existed: `npx vitest run tests/test_cli` = 32 files, 881 tests, 881 passed, 0 skipped.

## By blocking module

| Module | Test file | Tests |
| --- | --- | --- |
| `commands/*` (all 8 modules) | `test_main.test.ts` | `TestLazyGroup::test_list_commands_includes_lazy`, `TestCLIRoot::test_help`, `TestCLIRoot::test_no_args_shows_help`, `TestTopLevelInitRestored::*` (7: root help listing loads every module; the `init` ones need `commands/template` and `commands/config_cmd`) |
| `commands/*` (all 8 modules) | `test_help_alias.test.ts` | `test_dash_h_matches_double_dash_help [<path>]` and `test_help_never_runs_the_target_callback [<path>]` (one case per reachable command path, built by walking the tree), `test_no_command_reserves_dash_h_for_itself`, `test_every_lazy_subcommand_is_covered` |
| `commands/sandbox` | `test_main.test.ts` | `TestLazyGroup::test_lazy_group_loads_on_demand` (loads `commands/sandbox:create`) |
| `commands/sandbox` | `test_create_route_guard_and_unknown_cmd.test.ts` | `TestCreateRequiresExplicitRoute::*` (3) |
| `commands/sandbox` (`connect`) | `test_connect_repl.test.ts` | `TestConnectSession::*` (10) |
| `commands/sandbox` (`create`; one case also `agent/codegen`) | `test_output_channels.test.ts` | `TestCreateChannelSeparation::*` (5) |
| `commands/template` (`_doDeploy`, `_buildImage`, `_pushImage`) | `test_output_channels.test.ts` | `TestDeployDiagnosticsChannel::*` (2) |
| `commands/*` (help of every regional / local command, root `--help`) | `test_region_options.test.ts` | `TestRootOptionRemoved`, `TestRegionOptionPlacement::*` (all parametrised ids), `TestRegionReachesTransportConfig::*` (needs sandbox list/kill + template list), `TestMcpDeployRegionSemantics::*` (needs mcp deploy), `TestShortcutForwarding::*` (needs template install/deploy + sandbox kill); 57 in total |
| `commands/sandbox_process` | `test_shortcuts.test.ts` | `TestLazyGroupShortcutMerge::test_user_defined_alias_is_registered` |
| `commands/sandbox` | `test_shortcuts.test.ts` | `TestLazyGroupShortcutMerge::test_remapped_default_alias_targets_new_command` |
| `commands/config_cmd` | `test_shortcuts.test.ts` | `TestLazyGroupShortcutMerge::test_reserved_name_cannot_be_overridden` |
| `commands/sandbox`, `config_cmd`, `mcp`, `template` | `test_shortcuts.test.ts` | `TestLazyGroupShortcutMerge::test_corrupted_config_keeps_core_commands_working` |
| `commands/sandbox` (`run` passthrough) | `test_help_alias.test.ts` | `TestRunPassthroughCompatibility::*` (3; was a hard `it.skip` until `Sandbox.connect` and the `run` command landed — now live) |
| `commands/template` | `test_step_activity.test.ts` | `TestStepReporter::*` (4; was a hard `it.skip` — now live) |

The `test_shortcuts.test.ts` classes `TestConfigSetShortcutsTomlRoundTrip`, `TestConfigInitShortcuts` and
`TestConfigShortcutsQueries` are NOT in this slice. The `config_cmd` builder must append them to the same file
(`tests/test_cli/test_shortcuts.test.ts`); the file header says so.

## Seams to expose (command-module builders)

These are the TypeScript counterparts of the module attributes the Python tests monkeypatch. The ported tests assume
exactly these names.

* `commands/template`
  * `_StepReporter` class (exported) with the Python behaviour, and `templateSeams._STEP_TICK_SECONDS` (mutable object
    property read at call time) for `TestStepReporter` (`test_step_activity.test.ts`).
  * `_doDeploy`, `_buildImage`, `_pushImage` as members of an exported mutable `templateSeams` object (read at call time)
    for `TestDeployDiagnosticsChannel` and `TestCreateChannelSeparation`.
* `commands/mcp`: `_readApiKey` (mutable seam) for the deploy-region tests.
* `commands/sandbox`: `connect` must read lines through `replSeams.input` from `src/cli/repl.ts` (the `builtins.input`
  patch point) and call `Sandbox.connect(...)` (spied with `vi.spyOn(Sandbox, "connect")`). It must run each REPL line via
  `sandbox.commands.run(cmd, { timeout })` and map failures with `describeCommandFailure`.
* `commands/config_cmd`: export synchronous `loadShortcuts()` (Record or Map), `_configFileExists()` and
  `_createDefaultConfig()`; `main.ts` calls them during the shortcut merge (`mainSeams.configCmd` replaces the module in
  tests).
* Every command module exports its commands under the Python attribute names referenced by the lazy specs in
  `src/cli/main.ts` (`_CORE_COMMANDS`, `_SHORTCUT_TARGET_MAP`), e.g. `sandbox`, `create`, `list_cmd`, `exec_cmd`,
  `process_list`, `install_shortcut`, `deploy_shortcut`, `files_list`.
* `Sandbox.create` / `Sandbox.connect` are spied on (no `run_sync` bridge exists in the Node port).

## Sandbox commands builder: un-skipped tests

`commands/sandbox.ts` and `commands/_coding_agent.ts` have landed; the sandbox-dependent tests in `test_main`,
`test_help_alias`, `test_connect_repl`, `test_create_route_guard_and_unknown_cmd`, `test_region_options`, `test_shortcuts`
and `test_output_channels` are live (no longer skipped).

## MCP commands builder: un-skipped tests

`commands/mcp.ts` has landed. `TestMcpDeployRegionSemantics::*` in `test_region_options.test.ts` is live, `test_mcp_stdio.test.ts`
now drives `ebx mcp start` (as the original does), and `test_mcp_commands.test.ts` ports every `test_mcp_commands` ledger entry.
Seams other test authors can rely on: `_readApiKey`, `_runningServer`, `_pidAlive`, `_setIdeConfigMap`, `mcpSeams`
(`kill`, `popen`, `sleep`, `monotonic`, `system`). The `test_evidence_snapshot [...]` entries for the mcp goldens are served by
`tests/test_cli_evidence/test_evidence_snapshots.test.ts` (the separate `test_mcp_evidence` file was removed once the
shared registry covered those cases). The mocks are a fixed API key and a fixed IDE config path map.

## Template / deploy commands builder: un-skipped tests

`commands/template.ts`, `_adopt.ts` and `deploy.ts` have landed. `TestStepReporter::*` (`test_step_activity.test.ts`),
`TestDeployDiagnosticsChannel::*` (`test_output_channels.test.ts`) and the template/init entries of `test_region_options.test.ts`
and `test_main.test.ts` are live. Exposed seams: `templateSeams` (`_STEP_TICK_SECONDS`, `_doDeploy`, `_buildImage`, `_pushImage`,
`_githubRateLimitSetupAvailable`, `_offerGithubTokenSetup`, `_tryArrowCasePicker`, `_scaffoldPickerAvailable`, `getOutput`,
`loadConfig`, `isCiEnv`, `stdinIsatty`, `DockerBuilder`), `adoptSeams` (`_isInteractive`, `stdinIsatty`, `isCiEnv`) and `deploySeams`
(`build`, `resolve_acr_namespace`). Shared test helpers: `tests/helpers/templateSupport.ts`, `tests/helpers/docsSupport.ts`.
Not served by this builder: `tests/integration/test_progress_activity_e2e.py::*` (pty/e2e, excluded from vitest) and the
`tests/test_templates/test_local_install.py` entries (templates builder).

## Unowned ledger entries (builder "unowned")

Nothing blocked. `tests/integration/test_progress_activity_e2e.test.ts` (11), `test_adopt_deploy_e2e`, `test_nl_template_init_e2e`,
`test_cli_e2e`, `test_credential_priority_e2e`, `test_shortcut_target_hint_e2e`, `test_workflow_e2e` (CLICompleteness) and
`tests/test_templates/test_local_install.test.ts` are ported and passing; the 18 SDK-level `test_workflow_e2e` entries are in
`parity/moved-to-python-sdk.txt`. See `parity/KNOWN-GAPS.md`.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed

- Prepare official source templates for OpenSandbox from their existing base-image and pinned server-wheel recipe without editing the checkout or requiring host Python build tools.

## [0.4.14] - 2026-10-24

### Fixed

- Restore built-in Express source-template launches with native base-image resolution, explicit build-profile handoff, owned build/register receipts, and application startup after creation. Registry guidance can now recognize the native placeholders without claiming live acceptance for every template.


## [0.4.13] - 2026-10-24

### Fixed

- Order generated Express steps as WORKDIR, final ownership repair, then non-root USER; require runtime write/read/delete verification instead of claiming chown guarantees directory writability (#132). / Express 生成步骤先设置 WORKDIR，再修正目录所有权，最后恢复非 root 用户；README 要求实际写读删验证，不再仅凭 chown 承诺目录可写。

### Known limitations

- Complex pandas/matplotlib cloud steps builds may time out; the cause remains under investigation (#131). / 复杂 pandas/matplotlib 云端 steps 构建仍可能超时，根因尚待确认（#131）。


## [0.4.12] - 2026-10-24

### Fixed

- Accept `--detach` on prompt creation and expose the actual generation help; document native JSON output separately from standard command formats. / 自然语言创建接受 `--detach`，帮助可发现真实生成选项，区分原生 JSON 输出与标准命令格式。
- Support explicit Express `create --prompt --build steps`, resolve the provider base image before generation, guide self-contained ordered build steps, and wait for Ready with progress before sandbox creation. Default Docker deployment is unchanged. / 极速版自然语言创建支持显式云端 steps，提前解析基础镜像，指导完整有序构建步骤，显示进度并等待 Ready 后创建沙箱；默认 Docker 部署保持不变。
- Generate against published server alpha `0.3.1a1` using the official PyPI index; align bilingual template guides and the packaged Skill with spec v4 workflow contracts and independent application authentication. / 生成指导使用官方 PyPI 已发布 server alpha `0.3.1a1`，双语模板指南与打包 Skill 同步 spec v4 工作流及独立应用鉴权。
- Preserve an explicit server alpha pin during automatic Docker preparation while retaining explicit local source overrides. / Docker 自动准备保留明确的 server alpha 固定版本，显式本地源码覆盖保持可用。
- Honor explicit OS users in native envd process requests using per-request Basic authentication while preserving default identity and gateway credentials. / 原生 envd 进程请求通过请求级 Basic 身份遵守显式 OS 用户，保留默认身份及网关凭据。
- Require exact owned-sandbox NotFound alongside inventory absence in E2E cleanup; refresh version, prompt help, generic exec-workflow and catalog assertions against current public contracts. / E2E 清理同时要求精确沙箱 NotFound 与列表缺席，版本、生成帮助、通用 exec 工作流及目录验收同步当前公开合同。

## [0.4.11] - 2026-10-24

### Changed

- Project templates require spec v4 workflow manifests and exact provider operations. Application HTTP bindings are isolated from envd; interpreter execution is stateless by default, with explicit persistent contexts and no shell fallback. Launch records immutable sources, explicit build profiles and owned-resource recovery intent. Guessed interpreter RPCs and their public runtime export are removed; native Express workflow source preparation remains unavailable until its journal and identity contract is implemented.

### Fixed

- Migrate cloud CLI E2E scenarios to standard detached creation and per-command JSON formats; retain project coverage through explicit native entry, track owned IDs before verification, prove actual process termination, and retain ambiguous create attempts and unconfirmed cleanup in durable recovery records. / 云端 CLI E2E 迁移到标准 detached 创建和命令级 JSON 输出；项目功能显式使用 native 入口，先记录资源 ID，再验证实际进程终止与清理，持久保留未知创建及未确认清理记录。

- Refuse command payloads until the bound application confirms protocol v2 and the current identity’s exact endpoint; reject malformed catalogs, and clean known sandboxes even if their recovery receipt cannot be written. / 应用端点确认 v2 协议和当前身份的精确操作后才发送命令，拒绝非法目录，恢复日志写入失败仍清理已知沙箱。
- Refresh offline acceptance fixtures for current configuration, catalog schema and provider operation contracts; retain validation and static-help checks. / 离线验收样例同步当前配置、目录 schema 与 Provider 操作合同，保留校验和静态帮助断言。

- Reject unsupported runtime hosts before provider execution, report contract skips honestly, honor engine SSE backpressure, and initialize providers through an authenticated no-sandbox route for SDK doctor checks. MCP reports the CLI package version. Correct published npm and packaged Skill guidance. / 运行插件前检查宿主要求，合约跳过不再假通过，engine SSE 响应背压，并提供带认证且不创建沙箱的初始化接口供 SDK doctor 验证；MCP 返回 CLI 版本，同步 npm 与打包 Skill 说明。

- Preserve backend-issued process IDs and timestamps through streaming; acknowledge silent-process startup using its real ID, and reject missing or invalid IDs. / 流式调用保留后端进程 ID 和时间戳，静默进程以真实 ID 确认启动，缺少或非法 ID 时拒绝确认。
- Emit `[]` for an empty JSON sandbox list, including all-provider lists, so machine-readable cleanup checks always receive one JSON value. / JSON 沙箱空列表（含所有提供方汇总）输出 `[]`，清理检查始终收到一个有效 JSON 值。

## [0.4.10] - 2026-10-23

### Fixed

- Show provider install/update stages and live elapsed time while fetching, validating and verifying; stop retrying Git timeouts and unrelated fetch errors. / 提供方安装与更新显示阶段及终端等待计时；Git 超时和无关拉取错误不再重复重试。

- Align provider launch guidance with accepted OpenSandbox Docker scope and independently marked Beta providers. / 提供方启动说明同步 OpenSandbox Docker 已验收范围，其他 Beta 提供方单独标注。

## [0.4.9] - 2026-10-23

### Added

- Show terminal download progress in the shell installer, including piped installation; keep redirected logs quiet. / Shell 安装脚本在终端显示下载进度，支持管道安装，重定向日志保持简洁。
- Use arrow-key menus for configuration scope, authentication methods and template project recovery, retaining scripted numbered input. / 配置范围、认证方式与模板项目准备改用方向键菜单，保留脚本编号输入。


### Fixed

- Recover npm publication safely after delayed registry visibility: verify immutable candidate integrity before skipping an existing version, and use bounded fresh-cache online readback retries. / npm 版本短暂不可见时支持安全恢复：先核对已发布版本与验收包完整性，再跳过重复发布；读回使用有界重试与独立缓存。

## [0.4.8] - 2026-10-23

### Fixed

- Validate current native template help instead of the retired --official-api flag; run installed-artifact smoke in normal package CI before tagging. Repair native list/info help and deployment helper arguments; attach the exact tested npm tarball and checksum required by the website mirror. / 发布验收改为当前原生命令合同，常规 CI 在打标签前验证实际安装包；修正列表/详情帮助及部署脚本参数，并上传官网镜像需要的实际验收 npm 包和校验和。

## [0.4.7] - 2026-10-23

Unpublished candidate: binary verification stopped on a stale retired-option assertion. The immutable failed tag is retained; recovery continues in 0.4.8. / 未发布候选版：独立二进制验收被旧参数断言拦截，保留失败标签，由 0.4.8 继续交付。

### Fixed

- Correct AI recovery commands and generated scaffold instructions: positional detached Express create, explicit --prompt, interactive deploy gated before create, provider-specific guidance and explicit cleanup. / 修正 AI 错误恢复及脚手架说明：极速版位置参数与 --detach、显式 --prompt，交互部署成功后才创建，保留 Provider 归属并补充清理。
- Clarify the error-reporting proposal with stable diagnostic codes and crash-recoverable event claims; reporting remains unimplemented. / 上报提案补充稳定诊断码及可恢复事件预占；上报功能尚未实现。

- Explain how to resume interactive configuration when `--yes/-y` skips missing-value prompts; correct active Express create examples.

### Added

- Bilingual proposal for opt-out, sanitized CLI error reporting through a bounded sender and an abuse-protected FC/SLS ingress (design only).

### Fixed

- Align contributor guidance and English/Chinese API, configuration and provider documentation with the removed project compatibility surface. / 同步贡献指南及中英文 API、配置和 Provider 文档，清除已删除项目兼容接口的旧说明。

### Removed

- Pre-release project compatibility: old template factories/APIs and selector flags, import aliases, migration commands, deprecated method aliases, old server transfer routes, custom AK/SK token exchange and implicit provider URL/port fallbacks.


### Added

- Add read-only npm credential and scope diagnostics to the release recovery workflow, with sanitized output and publication explicitly disabled. / 为发布恢复工作流增加只读 npm 凭据与 scope 诊断，输出脱敏并明确跳过发布。

- Contextual Provider operation discovery in `abx -h`, `abx provider -h` and `abx provider run OPERATION -h`, plus default-aware `provider run` dispatch using existing JSON input and confirmation contracts. Preserve explicit-ID `provider command list/info/run` for compatibility and AI JSON discovery. / 通过标准帮助发现所选 Provider 的操作，新增使用默认 Provider 的 `provider run`，保留原有显式 ID 与 JSON 接口。

- Provider-registered Express pause/resume and Snapshot create/list/restore/delete, shared by CLI and Python engine clients without backend duplication. / Provider 注册的极速版暂停恢复及快照全流程，两端共用实现。

- Provider-owned `template launch`: source preparation, exact reference handoff, capability preflight, service readiness and owned sandbox cleanup; generic staged filesystem/process/OCI helpers. Third-party paths remain Beta with explicit native acceptance limits.
### Documentation

- Use the official website mirror in installation docs and explain checksum verification, manual downloads, explicit versions and GitHub fallbacks. / 安装文档统一使用官网镜像，补充校验、手动下载、显式版本及 GitHub 备用入口说明。

- Clarify implemented Express pause/resume and Snapshot standard interfaces, allowlist/runtime requirements and safe cleanup. / 明确极速版标准入口已实现暂停恢复与快照，以及白名单、运行时和清理要求。

### Fixed

- Match npm repository metadata capitalization to GitHub provenance, with validated capitalization-only recovery before testing and packaging existing immutable tags. / npm 仓库元数据大小写与 GitHub provenance 对齐，恢复既有不可变标签时先校验并仅校正大小写，再测试和打包。

- Guide missing configuration by operation and Provider, with temporary or persistent input, source-aware readback, safe cancellation and follow-up modification commands. Isolate standard ABX authentication from E2B login state; preflight build requirements before side effects and keep automation/MCP protocol output noninteractive. Preserve credentials during storage migration and avoid copying Sandbox keys into IDE registrations. / 按操作和 Provider 引导补齐配置，支持仅本次或持久保存、来源核对、取消及后续修改；标准 ABX 身份与 E2B 登录态隔离，构建前检查所需配置，自动化和 MCP 协议不弹问答；存储迁移保留凭证，IDE 注册不复制 Sandbox Key。

- Expose the explicit first-root-option `abx --native` entry for native Express template management and canonical step acceptance, preserving standard routing and remote argv. Prepare CLI0.4.1 with the accepted ENV propagation and bundled management SDK fixes.

- Send platform-step `build.env` values as separate Express ENV key/value arguments, preserving spaces and equals signs; explicitly supply final ENV values to generation-2 startup/readiness commands when the provider does not propagate them.
- Embed the lazy official Express management/template SDK dependencies in standalone binaries; preserve dependency attribution through `--licenses` and verify copied bundles without checkout dependencies. / 独立二进制内嵌延迟加载的极速版管理与模板官方 SDK，保留依赖许可归属，并验证脱离源码依赖目录的 bundle。
- Accept npm 12's package-name keyed dry-run report as well as older array reports in the package entry-point gate; continue rejecting packages without `dist/bin/abx.js`. / 包入口门禁兼容 npm 12 按包名组织的 dry-run 报告及旧数组格式，仍拒绝缺少 CLI 入口的包。

- Round remaining project tool deadlines to whole milliseconds so floating point error cannot prevent Docker/kubectl startup. / 将项目工具的剩余截止时间向上取整为毫秒，避免浮点误差阻止 Docker/kubectl 启动。

- Disambiguate local npm tarballs with `./` and allow the protected-default-branch publisher to recover an existing immutable version tag. / 明确本地 npm tarball 路径，并允许从默认分支恢复发布已有的不可变版本标签。

## [0.4.5] - 2026-10-21

### Fixed

- Create missing build/deploy project directories inline and continue after confirmation; `--yes`/`-y` or CI mode automatically scaffolds a Python project. Preserve provider/alias options, one-result JSON output and existing overwrite protections. / 构建和部署目录缺失时可确认创建并继续，`--yes`/`-y` 或 CI 模式自动生成 Python 项目；保留 Provider/别名参数、单一 JSON 结果和已有文件覆盖保护。

## [0.4.4] - 2026-10-21

### Fixed

- Accept CI JSON errors on stdout in installed-artifact onboarding checks, so the release gate verifies both output modes. Includes the CLI onboarding fixes from the unpublished 0.4.3 tag. / 安装包验收兼容 CI 模式的 stdout JSON 错误输出，包含未发布的 0.4.3 标签中的 CLI 引导修复。

## [0.4.3] - 2026-10-21

### Fixed

- Group provider with other command groups, show the template Registry URL and runnable scaffold/deploy/create examples. / provider 合并到命令组，补充模板 Registry 地址和可直接运行的生成、部署、创建示例。
- Offer missing template project creation for review, disclose nonempty-directory writes and require explicit overwrite consent. `-y` alone never permits replacement. / 缺失目录可交互生成模板供检查，非空目录展示写入风险，覆盖须明确授权，`-y` 不单独授权覆盖。
- Explain positional template syntax when standard create rejects `--template`, preserving parser semantics. / 标准 create 拒绝旧 `--template` 写法时提示使用模板位置参数。

## [0.4.2] - 2026-10-21

### Fixed

- Explain the purpose of all ten root shortcuts before their canonical alias notes. / 顶层十个快捷命令先展示用途，再备注完整命令。

### Changed

- Publish the help correction as a new patch using the existing PR CI, five-platform binary checks and npm artifact verification. / 通过现有 PR CI、五平台二进制和 npm 制品校验发布帮助修正补丁。

## [0.4.0] - 2026-10-19

### Changed

- Release the standard Express CLI with its explicit provider/build/MCP extensions as the new 0.x preview line; preserve the historical v0.3.0 tag.
- Build and verify all five binary targets into a draft Release before publication; publishing that Release triggers npm upload with the existing repository credential.
- Install the exact npm tarball before upload and reinstall the public npm version afterward; reject publishing from a branch or a mismatching tag.
- Align English/Chinese installation guidance and capture the real 0.4.0 version output without rewriting historical goldens.


### Documentation

- Use the verified canonical website and registry links in active English/Chinese guides.
- Identify the current-main release boundary, unpublished npm package and canonical public site URLs without claiming all templates are certified. / 明确当前 main 与既有发行版、未发布 npm 包及模板验收的边界，统一公开站点地址。

### Added

- Optional native provider `template from-image` contract with isolated authentication, strict results and cleanup. Catalog factories remain gated/Beta; plugins explicitly request SDK helpers without host provider-ID dispatch.

### Changed

- Resolve Alibaba envd process handles before OS PID inspection in the CLI process info extension; keep standard exec option boundaries and remote status semantics. / CLI 进程详情优先解析阿里云 envd 句柄，保留标准 exec 参数边界与远程退出码。

- Align Alibaba Express standard lifecycle, process, file and interpreter behavior with the pinned E2B contract; use canonical `E2B_*` connection settings.
- Reserve create positional arguments for templates and natural language for `--prompt` in the CLI; document migration, source attribution and backend capability limits.
### Fixed
- Preserve explicit `list --all-providers` routing through native provider aggregation instead of rejecting it in the standard parser.
- Correct bilingual native ABX configuration references and agent guide examples for the standard Express command entry.

- Preserve the complete prebundled dependency attribution in npm/SEA, verify source replay, and finish piped license/standard output before exit. Pin generated Python installation to the tested standard implementation.
- Preserve non-404/405 resume failures and reject undeclared PTY or foreign template generation/deploy before side effects.

- Install generated MCP applications from a tested matching client/server source pair instead of unavailable/unrelated PyPI distributions. Preserve the current provider workflow tools while routing metadata and TTL directly to the control plane, removing retired renewal state and sanitizing lifecycle failures.

### Fixed

- Reconcile provider isolation with accepted native transport, explicit-key authentication and retired-module cleanup; preserve canonical compatibility aliases and pure configuration metadata.

### Documentation

- Retire the unsupported builtin automatic-retry claim. Existing retry configuration names/defaults and EPP compatibility values remain accepted; they do not enable builtin HTTP retries or backoff.

### Removed

- Retired unreachable SDK-port Image/TemplateManager, named-session persistence/models, GlobalConfig, SecretStore, generic retry and PortClient implementations, their dedicated tests and stale exports. Removed the unused deprecated Dockerfile `POST /templates` creation path; active v3/v2 and official template operations remain. CLI commands and the Python parity ledger are unchanged. See the bilingual module retirement guide for programmatic replacements.

- Removed the unconfirmed automatic AK/SK-to-sandbox-key RPC exchange and its private signing/parser helpers. Sandbox requests now fail locally without an API Key; official template/ACR AK/SK operations remain. Explicit custom exchange adapters remain and reject empty/structured token returns. This changes AK/SK-only runtime authentication; see the bilingual migration guide.
### Changed

- Validate compatible Vitest5.0.4/typescript-eslint8.71.2 patches together on supported Node20/22; index accepted CLI cleanup decisions as implemented.

- Separate command error rendering from the CLI root and place shared exception/provider error values in lower layers. Existing deep imports re-export the same values; command behavior is unchanged.

- CI and release workflows use setup-node v7 while retaining explicit Node 20/22 targets. Automatic incompatible Commander/TypeScript/Node-type major bumps are deferred to explicit compatibility migrations; patch/minor updates continue.

### Fixed

- Keep port addresses, gateway headers and file-transfer URLs in selected provider adapters; reject missing hooks instead of guessing native routes. Resolve Python compatibility imports lazily.


- Integrate provider isolation with current host cleanup/authentication; keep URL conventions and template work in adapters, synchronize AI schema/handler discovery, preserve choice diagnostics and verbose configuration reporting. Minimal Python images support process inspection without procps and valid typed metrics collection.

- Align current CLI/Skill installation instructions with published v0.3.0 binary assets and the Python SDK paired-source distribution; retire unavailable npm/index commands.

- Correct Skill installation sources and complete bundle examples; keep tasks cancelling until their original process group stops, preserve borrowed sandbox ownership, clear provider-qualified defaults, and retain failed-delete handles for retry. Follow-up live verification records distinguish these fixes from unverified advanced requirements.
- 修正 Skill 安装来源和完整文件包示例；原进程组停止后才确认任务取消，保留借用沙箱所有权边界，清理带 Provider 前缀的默认资源，并保留删除失败的重试句柄；新增真实复验记录且明确高级能力缺口。

- Make Sandbox Skill task recovery, binary verification and per-action acceptance evidence explicit. Preserve connected/retained resources across MCP disconnect, keep absent lifetime metadata unknown, and report successful cancellation independently from a task signal exit.
- Display actual template aliases/current build status; include workflow references in the npm package.


### Added
- Add local generation2 pause/snapshot acceptance with memory/files/clone assertions, owned cleanup and bilingual provisioning guidance.

- **MCP lifecycle controls.** `list_sandboxes`, `get_sandbox`, and `set_sandbox_timeout` share STDIO/HTTP handlers, validate bounded inputs, expose only safe metadata, and never adopt external instances for session destruction. `create_sandbox` accepts provider, region, CPU and memory options.
- **Typed provider management commands.** `abx provider command list|info|run` discovers static schemas and invokes declared Node/exec commands through shared validation and authenticated engine routes. Includes 20 official FC Volume, Team, API Key and quota operations; key creation/rotation securely writes a new local file. Custom-domain automation remains unsupported pending a verified public Agent Sandbox API.
- **FC Volume mounts at sandbox creation.** `abx create --volume-mount PATH=NAME` and `Sandbox.create({volume_mounts: {...}})` serialize the official `volumeMounts` request. Invalid paths and unsupported providers fail before execution; real storage access still requires an existing Volume, its Team's API key and a storage role.

- **Installers for the standalone binary.** `install.sh` (macOS and Linux) and `install.ps1` (Windows x64) download `abx-<version>-<os>-<arch>[.exe]` plus its `.sha256` from the latest GitHub Release, verify the checksum, and install without sudo. `ABX_VERSION` and `ABX_INSTALL_DIR` override the release and the destination. The npm package `@agent-sandbox/cli` is not published yet.

- **`node/1` provider kind.** A plugin is an ES module (`provider.mjs`, `export default create(kit)`) that the CLI host loads in-process through a small kit. `e2b`, `cubesandbox` and `alicloud-container` are now `node` plugins, so they run from the CLI as well as from the SDKs. `opensandbox` is a `node` plugin too (0.3.0): its EPP/1 methods run in the host process through `kit.epp.infra` (no child process), `node provider.mjs` still serves EPP/1 on stdio, and it gained a terminal (`pty.open/write/resize/close`, Node 22+). The `exec` kind remains for third-party plugins in any language.
- **Provider engine.** `abx provider engine serve|status|stop` runs the provider layer once for every SDK: HTTP, SSE and WebSocket on `127.0.0.1`, a bearer token in `~/.abx/engine.json`, one engine per user, idle exit. See [Engine HTTP API](docs/en/reference/engine-api.md).
- **Terminals through a proxy.** `Sandbox.getTerminal` honors the plugin's envd dial target, and a plugin can host its own terminal.
- **Official site and registry website.** READMEs and the docs index name https://www.agent-sandbox.com and https://registry.agent-sandbox.com. The CLI installs catalog providers from `alibaba-agent-sandbox/awesome-providers//<id>`. The Python SDK installer fetches `https://registry.agent-sandbox.cn/providers/index.json`.

### Changed

- **Client distribution name.** Install docs, the template-index upgrade hint, and the `requirements.txt` from `abx mcp deploy` use `agent-sandbox-client` (extras such as `[mcp]` stay on that name). The import name is still `agent_sandbox`. `pip install agent-sandbox` installs an unrelated project. `scripts/deploy_remaining.sh` prefers `agent_sandbox_client-*.whl` and still accepts `agent_sandbox-*.whl`. Template images still install `agent-sandbox-server` from the pinned git archive.
- Route bundled and external backends through the same Provider contract. Move Express authentication,
  cloud SDK/template deployment and native session binding into provider modules; preserve public import facades.
- Resolve provider-owned CLI/AI/config metadata per selection, reject undeclared native defaults/options,
  and clean up newly created resources when session binding fails without deleting borrowed sandboxes.

- Document mount-capable template selection, the custom MicroVM ossfs2 minimum version, and verified real OSS Volume acceptance with complete temporary-resource cleanup.

- Clarify the current Volume invitation-access prerequisite in the English and Chinese management and mounting guides; an empty list does not prove create or mount access.
- Use an absolute built CLI path in both E2E quick starts so the executable still resolves from isolated scenario directories.

- **npm publish is opt-in.** `.github/workflows/release.yml` skips the publish job unless the repository variable `NPM_PUBLISH` is `true`. A binary-only `v*` tag stays green when `NPM_API_TOKEN` is absent.

- **CLI skill stays on operating a sandbox.** `SKILL.md` is a static usage guide at the repository root; tools load it from a directory named `agent-sandbox`. It lists the fixed command surface, the seven MCP tools, deploy `--build`, and the fact that `opensandbox`, `alicloud-container`, `cubesandbox`, and `e2b` are `node` plugins the CLI and the Python SDK both run. It does not restore the removed `abx skill` command. Writing `Sandbox.create`, `template.yaml`, a Dockerfile, or `commands.py` is the `agent-sandbox-sdk` skill. `abx template init` scaffolds `@command` and `start()` under `if __name__ == "__main__"`.

- **Grey activity rows default to six and show a short tool detail.** While Qwen Code researches, assesses, or generates, each tool row is `tool: <name> <detail>` with a short redacted detail (command, url, query, or path). The block shows the last 6 lines (`ABX_ACTIVITY_LINES`, 1–10). File bytes, thinking, and credentials stay hidden.

- **The CLI moved to a Node.js implementation, and the repository was split.** `abx` is now a TypeScript (ESM, Node.js >= 20) package published on npm as `@agent-sandbox/cli`; install it with `npm install -g @agent-sandbox/cli` or run it with `npx @agent-sandbox/cli`. The Python SDK (`agent-sandbox`) and the in-sandbox runtime (`agent-sandbox-server`) moved to the `python-sdk` repository, so the `[cli]` extra and the `abx` console script no longer exist in the Python packages. Standalone binaries keep the same release assets (`abx-{version}-{os}-{arch}[.exe]`) and are now built as Node single-executable applications. CLI behaviour (commands, options, output, exit codes, configuration) is unchanged; nothing else changed.

- **Open-source hygiene.** The deploy and benchmark scripts no longer contain developer-machine paths, a personal ACR namespace or fixed e2e tags: `abx` is resolved from `PATH` (override with `ABX_BIN`), `scripts/build_hermes.sh`, `deploy_all_templates.sh` and `deploy_remaining.sh` take `ACR_NAMESPACE` (required), `TAG` (default `dev`) and `REGION` from the environment, and `.env.example` uses the `<your-namespace>` placeholder. New regression guard `npm run check:hygiene` (`scripts/check-no-local-paths.sh`, allowlist in `scripts/local-paths.allowlist`) runs in CI and fails on user-home paths, Windows user paths, `.venv/bin` assumptions, personal identifiers and key-like strings.

### Fixed

- Preserve standard command ownership with native root output flags; resolve Express scoped credentials/endpoints together, reject malformed/reserved resource namespaces, and retain missing dependency and bundled-source license notices.

- Fix provider ownership at E2B dispatch and qualified references; block foreign providers from the FC template pipeline and stop auto-advertising every host feature on Express.
- **Stacked pull request validation.** The complete CI matrix now runs for pull requests targeting feature branches as well as `main`; push validation remains limited to `main`.

- **MCP deployment uses the Python client distribution.** Generated `requirements.txt` now requests `agent-sandbox-client[mcp]` instead of the previous `agent-sandbox[mcp]` package name.
- Load cold registry/official-SDK test fixtures before per-test deadlines; preserve timeout budgets and avoid late asynchronous registry resets after fixture teardown.

- Provider updates report the bundled Express host lifecycle and manual local/catalog sources; Git update failures remain visible. Legacy FC template commands reject plugin feature declarations without a dispatch adapter. Document resource reuse, migration differences, AI boundaries and pending native factory acceptance.

- Generate short alphanumeric Team names in opt-in provider-management E2E lifecycles, fixing real CreateTeam rejection of the previous fixture.

- **Preserve Docker RUN structure when injecting server wheels.** `ABX_SERVER_SDK_SOURCE` now copies wheels before a complete shell-form RUN and substitutes only its server requirement. Conditional wheel/archive fallbacks, surrounding continuation commands and other dependency pins remain intact; comments, heredocs and exec-form text are preserved. Refs [#36](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues/36).
- Make repository-health checks parse actual imports and executable commands, validate the real repository, preserve exact historical context with visible warnings, and reconcile current bilingual document paths and CLI recipes.

- **Pinned server archive skips PyPI.** `abx template init` pins python-sdk `61c43e0be65a1f57aa09186d578e7b399e48429b` (PR #21; the `server-sdk` tree matches PR #20, and later commits through PR #24 do not change server runtime). A Dockerfile that already pins any `python-sdk/archive/<sha>.tar.gz#subdirectory=server-sdk` is built as written, and deploy does not request `agent-sandbox-server` from PyPI. `ABX_SERVER_SDK_SOURCE` still injects a wheel and replaces that pin whatever SHA it uses. Fixes #24.
- **Deployed `--alias` resolves capabilities, and missing credentials name the variables that are read.** `abx template deploy --alias <name>` caches `template.yaml` under both the platform template id and that alias, so a later `abx create` / `abx run` of the alias does not warn that `~/.abx/templates` has no match. Credential lookup is unchanged: one name per key (`ABX_SANDBOX_API_KEY`, `ABX_SANDBOX_BASE_URL`, `ABX_SANDBOX_DOMAIN`, `ALICLOUD_ACCESS_KEY_ID`, `ALICLOUD_ACCESS_KEY_SECRET`, `ALIBABA_CLOUD_REGION_ID`). `E2B_API_KEY`, `E2B_API_URL`, `E2B_DOMAIN`, `AccessKey`, `AccessSecret`, and `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` are not read. A missing AccessKey or API key error lists the names that are read. `abx --json template deploy <dir> -y` prints one JSON object on stdout; the id is `TemplateID`. Fixes #20, #21.
- **Server install without a local wheel.** `agent-sandbox-server` is not on PyPI (the PyPI name `agent-sandbox` is a different project, and `python-sdk` has no GitHub release). `abx template init` writes `RUN pip install --no-cache-dir "agent-sandbox-server @ https://github.com/Alibaba-Agent-Sandbox/python-sdk/archive/61c43e0be65a1f57aa09186d578e7b399e48429b.tar.gz#subdirectory=server-sdk"`. That line builds with plain `docker build`. `ABX_SERVER_SDK_SOURCE` still injects a wheel and replaces the line. A `COPY *.whl` with no matching file is removed for that build so the legacy builder does not fail. The `--provenance=false` notice is printed only when `docker buildx version` succeeds. Fixes #17, #18.
- **Express template loop.** `template.yaml` `base` may be an image string or `{ image: ... }`. `abx template deploy` reads `generation`, `start_cmd`, and `ready_cmd`. On Alibaba Cloud Express, a directory with `commands.py` defaults to generation 2 and the provider start and ready commands, and `abx template init` writes those keys, and its next-step hint is `abx template deploy <dir> -y` (the ACR namespace comes from `ACR_NAMESPACE` or config). A generation-1 template of the same name is left in place; the error prints `abx template delete <id> -y` and a redeploy, and `--force` deletes it and creates it again. `abx run` and `abx sandbox command list` / `run` send the sandbox `X-Access-Token` to port 9000, and retry once without it when the server answers 401 (Express does not set `ABX_SERVER_TOKEN`, so a presented token is rejected). Streaming envd calls on Express use Connect envelopes, so `abx exec` returns command output. A missing capability manifest warns with `~/.abx/templates/<id>/template.yaml`; a successful deploy caches the file there. Fixes #12, #13, #14, #15.
- **Doctor treats a missing provider key as configuration.** `buildInfra` raising `InvalidAPIKeyError`, `InvalidCredentialsError`, or `ProviderConfigError` is a `config` check, so install keeps the plugin. `abx provider update` on a catalog receipt tells you to reinstall with `abx provider install alibaba-agent-sandbox/awesome-providers//<id> --force`.
- **SDK defects found by the real-cloud E2E suite, ported to the Node CLI** (present since 0.2.0 in the Python `abx`; ids from `python-sdk/e2e/KNOWN-ISSUES.md`; the wire behaviour now matches the fixed Python SDK; each is pinned by `tests/test_known_issues/ki00N_*.test.ts` and verified against the real platform by `e2e/known-issues/`; the places where the harness against the original Python `abx` legitimately differs are the documented allow-list in [`parity/sdk-defect-fixes.md`](parity/sdk-defect-fixes.md)):
  - **KI-001** per-call environment variables (`abx run` of a template command that declares `env`, the SDK `commands.run/start/stream({ env })`, MCP `run_command`) were sent as `process.envVars`; envd's `ProcessConfig` field is `envs`, so they were silently dropped. They now reach the command (sandbox-create `envVars` is unchanged).
  - **KI-002** `abx files list` / `files stat` understand envd's `EntryInfo`: the numeric `type` (`2` = directory; `FILE_TYPE_DIRECTORY` and a string `size` are accepted too) and the `entry` object of `Stat`. Directories were listed as `file` and `files stat` printed a blank name and path.
  - **KI-003** a command that outlives its timeout fails with `CommandTimeoutError` (E3001) instead of a raw read-timeout error, and the process is killed on a best-effort basis. A connect timeout is a `ConnectionError_`. The timeout is an *inactivity* limit (no output for `timeout + 5` s), not a wall-clock deadline.
  - **KI-004** `abx process kill/signal/input` (and the connect/update calls) posted a flat `{"pid": N}` body that envd ignores. They now send `{"process": {"pid": N}, "signal": "SIGNAL_SIGTERM"|"SIGNAL_SIGKILL"}` and `{"process": {"pid": N}, "input": {"stdin": <base64>}}`. envd can only deliver SIGTERM (15) and SIGKILL (9): any other signal number is rejected with a clear message instead of being silently lost (`--signal` help updated, en and zh).
  - **KI-005** an unknown sandbox ID is reported as `SandboxNotFoundError` (E2009, exit 4) on every provider instead of the raw HTTP 404; every envd file call maps HTTP 404 to `FileNotFoundError_` (E4001), 403 to `PermissionDeniedError` (E4002) and any other status to `FileOperationError` (E4000, exit 1; this includes 401 and 429, which used to surface with other exit codes).
  - **KI-006** a Platform API 401 is `InvalidAPIKeyError` (`InvalidCredentialsError` with AK/SK), both authentication errors, instead of a raw HTTP error; the message never contains the key.
  - **KI-007** `abx files list` of a missing directory fails with `FileNotFoundError_` instead of printing an empty list (envd answers `ListDir` with HTTP 200 and no entries; an empty answer is now disambiguated with one `Stat`).
  - **KI-008** (not an SDK defect, reported more clearly) an envd upload/download that outlives the HTTP timeout is a `FileOperationError` naming the path, the size and `ABX_HTTP_TIMEOUT`.
  - **KI-010** has no counterpart in the Node CLI (no declarative `@sandbox` decorator); KI-009 and KI-011 need no change.

### Added

- **Template publish can use platform build steps.** `abx template build`, `abx template deploy`, and `abx deploy` take `--build auto|dockerfile|steps` (default `auto`). `auto` publishes a Dockerfile when one is present. Otherwise it expands `template.yaml` `build:` (`apt_install`, `pip_install`, `npm_install`, `env`, `run`, `steps`) into official `CreateTemplate` `sandboxConfig.steps`, using `base.image` and skipping local Docker and ACR. `--build steps` with `--acr-namespace` or `--legacy-api` is a usage error. Spec: [Template build modes](docs/en/design/template-build-modes.md).

- **Black-box E2E suite, differential harness and the Definition of Done.** `npm run e2e` (`e2e/`) runs any `abx` binary (`ABX_BIN`) with an isolated HOME against the real cloud: 132 scenarios across offline, read-only cloud, full sandbox lifecycle, template catalog and an opt-in Docker deploy flow, with masked output, tracked cleanup and a final leak check. `npm run e2e:offline` needs no credentials; `npm run e2e:cleanup` is the janitor. `parity/diff/` compares two binaries wire for wire against a stub platform and envd (120 cases seeded from the evidence registry). The baseline against the Python `abx` is recorded in `e2e/BASELINE.md`. New rules in `.agents/notes/DEFINITION-OF-DONE.md` (English and Chinese, with ADR and evidence templates): a feature is done only after real-component verification, recorded evidence and complete en/zh docs; linked from `CONTRIBUTING.md` and the PR template. Guide: [Testing & Definition of Done](docs/en/guide/testing-e2e.md) ([中文](docs/zh/guide/testing-e2e.md)).

## [0.2.0] - 2026-09-30

### Breaking Changes

1. **CLI config uses one name per credential.**
   `abx config` lists `sandbox_api_key` for the sandbox service key (still stored as `E2B_API_KEY`; `abx config get/set api_key` remains an alias). NL inference and the coding agent share `llm_api_key`, `llm_base_url`, and `llm_model`. `qwen_code_api_key`, `qwen_code_base_url`, and `qwen_code_model` are no longer configurable; `config get` / `config set` name the `llm_*` replacement. An older `ABX_QWEN_CODE_API_KEY` (and stored `qwen_code_base_url` / `qwen_code_model`) is still read when the matching `llm_*` value is unset, and shows up under the `llm_*` name.
   *Migration*: use `abx config set sandbox_api_key <KEY>` and `abx config set llm_api_key <KEY>`. Set `llm_base_url` / `llm_model` only when the DashScope default is not the endpoint you want. The Python SDK parameter stays `api_key=`.

2. **`abx deploy` is the fixed build → push → register pipeline.**
   It now runs exactly what `abx template deploy` runs (`docker build`, push to ACR, `CreateTemplate`, wait for ready), with `PATH` defaulting to `.`, and shares every option of that command including `-v/--verbose`, `--acr-namespace` and `--region`. It needs no LLM and no LLM key, takes no description (the `INSTRUCTION` argument is gone), and no longer starts a `qwen-code` cloud sandbox or raises `E7001`. What a template is lives in `template.yaml`, authored by `abx template init`; `deploy` only reads its `name`, `resources` and `generation`. `--traditional` is deprecated and ignored (with a warning); the old traditional-mode-only `--watch` option is removed, and `--alias` now is `template deploy`'s template alias.
   *Migration*: `abx deploy ./p "instruction"` becomes `abx template init "DESCRIPTION"` (the AI writes `Dockerfile`, `commands.py`, `template.yaml` into `./<name>/`) followed by `abx deploy ./<name>`. The in-sandbox agent deploy remains available as the SDK API `Sandbox.deploy()`.

### Changed

- **Credentials resolve in one order everywhere.** An explicit argument wins, then the process environment, then `./.env`, then `~/.abx`, then a built-in default. `.env` files merge per key, so a project file that omits a key no longer hides `~/.abx/.env`. A blank or whitespace-only value does not count. `Sandbox.create`, `Sandbox.deploy`, natural-language `abx create`, GitHub template downloads, and `abx mcp install` follow that chain. `abx mcp install` copies `E2B_API_URL` and `SANDBOX_REGION` into the editor config only when the process environment sets them. The table is in the configuration reference.

### Added
- **`abx config delete KEY`**: remove one stored configuration value (a credential, `acr_namespace`, a connection setting, or `shortcuts.<name>`). The key falls back to its default or becomes not set. `abx config set KEY ""` still does the same thing. Environment variables are not unset, and there is still no command that wipes `~/.abx`.
- **Long steps keep a moving header.** Creating a sandbox, upload, download, template fetch, registering a template from an image, installing the coding-agent CLI, and `abx kill --all` use the same `message... 12s` header as deploy, redrawn once a second on a terminal. Grey lines are safe text only: relative paths, install milestones, and (for deploy) docker or poll output. File bytes, tool input, ACR tokens, and `--build-arg` values are not shown; the docker command logged at info level redacts build-arg values. `--json`, `--quiet`, CI, `TERM=dumb`, and non-TTY stay silent for these headers. Deploy still prints one progress line per phase in those modes, and `--verbose` still prints the full deploy log instead of the block.
- **Build, push, and wait steps show their log.** On an interactive terminal, `abx deploy` / `abx template deploy` / `abx template push` draw each long step as a `message... 12s` header with the latest four lines of `docker build`, `docker push`, or READY-poll output in grey underneath (`ABX_ACTIVITY_LINES` changes the count). The elapsed time keeps moving once a second while the tool is silent. `--verbose` prints the full log instead. `--json`, `--quiet`, CI, and non-TTY stay one progress line. While a template is generated, a tool name appears when the call starts, still without tool input.
- **`abx init "DESCRIPTION"` asks for a directory.** Natural-language `abx init` / `abx template init` asks an interactive terminal `Directory for the template project` before generating. Enter keeps `./<name>/` (or `./<--name>/`). Any other path is the project directory itself. `--yes`, `--json`, and non-TTY skip the prompt. A file, or a directory that already has template files, is rejected before generation; `--force` overwrites.
- **`abx template init --adopt [DIRECTORY]`**: turn an existing project into a deployable template. Qwen Code sees a staged copy (secrets, keys and secret-looking files excluded) and only `Dockerfile`, `commands.py`, `template.yaml` and a generated `.dockerignore` are written back, after a preview. `--hint` adds what the code cannot say, `--dry-run` lists the files that would be sent and contacts no model, `--yes` skips both confirmations, and `--force` is what replaces an existing Dockerfile when there is no interactive preview. Replaced files are kept as `*.abx-bak`. The agent process does not inherit cloud credentials. `abx template init --from <local dir>` now refuses a directory that has no `template.yaml` and points at `--adopt`. Nothing is built or deployed; publish with `abx deploy`.
- **`abx create --dir DIRECTORY`**: choose the parent directory for the AI-generated template files (`Dockerfile`, `template.yaml`). Without it, an interactive terminal is asked where to save them (Enter keeps the default `~/.abx/generated`); `--yes`, `--json` and non-TTY sessions use the default silently.
- **Live agent activity line**: while Qwen Code researches, assesses or generates, a TTY shows the `Assessing description... 12s` header with the agent's last four activity lines in grey on the lines below it, scrolling line by line as the agent produces text or uses a tool (`ABX_ACTIVITY_LINES=1..10` changes the count; also works under `--verbose`). It shows only assistant text lines and tool names, never tool input; it is absent for `--json`, `--quiet`, CI and `TERM=dumb`, and never touches stdout. Research now has its own "Researching public facts" phase.
- **Configurable CLI shortcuts**: Command aliases are now configurable via `[shortcuts]` section in `~/.abx/config.toml`. All existing top-level shortcuts (create, list, info, etc.) are enabled by default. Users can add custom shortcuts with `abx config set shortcuts.<name> "<target>"`. Run `abx config init` to generate a complete shortcuts template with all available commands.
- **Natural-language template init**: `abx template init "DESCRIPTION"` (and `abx init "DESCRIPTION"`) generates `Dockerfile`, `commands.py` and `template.yaml` and stops. Interactive `abx create "DESCRIPTION"` / `abx sandbox create "DESCRIPTION"` first asks whether to switch to that template-only path before building, pushing, deploying, and creating a sandbox. `--yes` keeps the full create pipeline.
- **AI-generated templates ship a server**: the natural-language generator now writes `commands.py` (an `agent_sandbox.server` `SandboxServer` on port 9000, the process the deployed sandbox answers HTTP with), `template.yaml` with `capabilities` / `ports`, and a `README.md` next to the `Dockerfile`, instead of a Dockerfile-only image. The prompt carries the server SDK reference (`agent/template_guide.py`); a result without a valid `commands.py` that starts the server is rejected. `template init "DESCRIPTION"` copies every generated file into `./<name>/`.

### Fixed

- **Remote MCP refuses to start without a Bearer token.** The FC artifact calls `require_auth_token`, so an empty `ABX_MCP_AUTH_TOKEN` fails the process instead of serving `/mcp` with authentication disabled. STDIO still has no Bearer token (the IDE owns the local process). Loopback HTTP may omit the token and warns; any other bind requires one.
- **`abx mcp start` prints its configuration and can be stopped.** A foreground STDIO process writes the transport, template, whether an API key is set, the tool list, and how to stop to stderr, and leaves stdout for JSON-RPC. `--http` serves Streamable HTTP; `--background` detaches that HTTP server (the API key and token stay in the child environment). `abx mcp stop` sends SIGTERM to the pid recorded under `~/.abx/run`. `abx mcp status` reports `mcp_running`.
- **MCP sessions follow the documented agent loop.** `create_sandbox` becomes the default sandbox, so later tools can omit `sandbox_id` and `kill_sandbox` destroys that sandbox; killing when nothing exists returns an error. An omitted template uses the server template. Lazy creation is single-flight, and each use extends the sandbox timeout. `run_command` runs via `sh -c`. A non-zero exit is a tool error. STDIO accepts messages up to 8 MiB and answers `ping` while a tool call is in flight. `GET /mcp` returns 405. `abx mcp deploy` refuses to write an artifact without a non-empty Bearer token and sets `SANDBOX_REGION`. `abx mcp install --target vscode` writes `.vscode/mcp.json` and leaves non-strict JSON alone.
- **`abx config init` asks for the template-deploy prerequisites.** The guided wizard now also prompts for the ACR namespace and the Alibaba Cloud AccessKey ID / Secret (Enter skips any prompt). `acr_namespace` is a config key stored in `~/.abx/.env` as `ACR_NAMESPACE`, so `abx install` and `abx template deploy` pick it up without `--acr-namespace`. The missing-prerequisite errors name `abx config init` and `abx config set`.
- **Invalid shortcut targets explain the mistake.** `abx config set shortcuts.<name> "abx template init"` now says to drop the `abx` prefix and prints the command to retry (`"template init"`). Other unknown targets are grouped by command. The unknown-command hint uses the same example.
- **SDK wheel injection works for installed `abx`.** `DockerBuilder.inject_sdk_wheel` only knew how to build from a source checkout, so an `abx` installed from PyPI (or the standalone binary, which has no `pip`) injected nothing and images silently got whatever `agent-sandbox` was newest on PyPI. It now downloads the released wheel of the running version from PyPI (SHA-256 verified) and falls back to the Dockerfile's PyPI install only when that is unavailable; source checkouts still build from the working tree, and a `pyproject.toml` that is not `agent-sandbox` is no longer mistaken for the SDK.
- **`abx create "<description>"` no longer appears hung and no longer misreports failures.** The research round is bounded (20 turns, 240 s; `ABX_QWEN_RESEARCH_TIMEOUT` overrides) and its prompt caps slow web fetches; on timeout or turn exhaustion the CLI warns with the reason. The whole agent process tree (qwen relaunches itself as a child) is now terminated on timeout or Ctrl-C instead of being orphaned. After a failed research round the assessment starts a fresh session, because qwen rejects re-pinning a `--session-id` that already exists; this was the cause of the bogus "assessment unavailable; continuing straight to generation" warning.
- `DeployLLMKeyMissingError` (E7001) suggestion now mentions `ABX_LLM_API_KEY` and `llm_api_key=`.

## [0.1.0] - 2026-09-29

First stable release. Includes all changes below (formerly tracked as `0.1.0-dev`) plus the current cycle:

### Breaking Changes (Task 201 — config Reset Removal & Value Semantics)

1. **Removed `abx config reset`**.
   Clearing is now per key via `abx config set KEY ""`: the stored value is removed and the key returns to its business default or to not set. An empty string is never stored as a credential or as an override. When an environment variable still overrides the key at runtime, the command says so explicitly without printing its value.
   *Migration*: replace `abx config reset --yes` with one `abx config set KEY ""` per key you want to clear (e.g. `abx config set region ""`).

2. **`abx config list` shows effective values and their sources**.
   Sources are annotated as `(env)`, `(user)`, `(default)` or `(not set)`. Keys with a real business default (`qwen_code_base_url`, `qwen_code_model`) show the concrete default; keys without one (`llm_api_key`, `llm_base_url`, `llm_model`) show `(not set)` instead of a blank `(default)`. Secrets stay masked.
   *Migration*: consumers parsing `config list` output now see source suffixes and `(not set)` where the old output showed blank defaults.

3. **`abx config init` secret prompts echo one `*` per character**.
   Previously typed secrets were completely invisible; now every typed or pasted character shows a single `*` (never the plaintext), with Backspace / Ctrl-C / EOF / Unicode handled correctly. Terminals that cannot render it fall back to the previous no-echo behaviour with an explicit notice.
   *Migration*: no action required — the plaintext is never displayed in either mode.

### Breaking Changes (ADR 2026-09-23 — Overdesign Cleanup)

1. **`abx template install` default behaviour changed: download → download+build+deploy**.
   `install` now fetches the template sources and then builds the Docker image, pushes to ACR, and registers the template via the official API by default — cloud-side operations that can incur Alibaba Cloud costs (ACR storage/traffic, template resources). The previous download-only behaviour is available via `--download-only`.
   *Migration*: add `--download-only` to `abx template install` / `abx install` invocations that should not build and deploy.

2. **Removed `SerializerType.PICKLE` / `SerializerType.MSGPACK`**.
   The `@sandbox` decorator now only supports `serializer="json"`. Non-JSON serializable return values must be converted to `dict`/`list`/`str` before returning.
   *Migration*: change `@sandbox(serializer="pickle")` → `@sandbox(serializer="json")` and ensure return values are JSON-compatible.

3. **Removed runtime `check_capability()` gate from most modules**.
   `CommandsModule`, `FilesModule`, and `NetworkModule` no longer raise `CapabilityNotSupportedError` (E3004) at call time. **Exception: `CodeContextModule` retains the `code` capability gate** — all its methods (`run`, `create_context`, `list_contexts`, `restart_context`, `remove_context`) still raise E3004 when the `code` capability is missing (fail-closed). E3004 is also still raised during template resolution / model validation via `resolve_capabilities()`.
   *Migration*: remove `try/except CapabilityNotSupportedError` around `commands.*`, `files.*`, and `network.*` calls; declare required capabilities in `template.yaml` instead. **Keep** `try/except CapabilityNotSupportedError` around `run_code()` / `code.*` calls if your template may lack the `code` capability.

4. **Removed `agent_sandbox.integrations` sub-module**.
   The LangChain/CrewAI/AutoGen adapter module was an empty abstract placeholder and has been deleted.
   *Migration*: use `agent.tools` or MCP integration directly.

5. **Removed `SessionStore` abstract base class**.
   Only `LocalSessionStore` remains. The `session/base.py` ABC has been deleted.
   *Migration*: if you were subclassing `SessionStore`, switch to `LocalSessionStore` or implement your own storage directly.

6. **`SecretStore` changed from macOS Keychain to file-based storage**.
   Secrets are now stored in `~/.abx/secrets.json` (plaintext, chmod 600). Old Keychain entries are **not** automatically migrated.
   *Migration*: re-add secrets via environment variables (`E2B_API_KEY`, `SANDBOX_API_KEY`) or `~/.abx/.env` file. Use `abx config set api_key <value>` to persist API keys.

7. **Removed `abx auth` CLI command group**.
   The `abx auth login/logout/status/switch` commands have been removed.
   *Migration*: use `abx config set api_key <value>` to persist credentials, or set `E2B_API_KEY` / `SANDBOX_API_KEY` environment variables directly.

8. **Removed `abx secret` CLI command group**.
   The `abx secret create/list/delete/inject` commands have been removed.
   *Migration*: use environment variables or `.env` files to manage credentials and secrets. For sandbox environment injection, use `abx create --env KEY=VALUE`.

9. **Removed `abx session` / `abx sessions` CLI command group**.
   The `abx sessions list/info/rename/export/import/clean` and `abx start/connect` commands have been removed.
   *Migration*: session data is still stored locally in `~/.abx/sessions/` by `LocalSessionStore`. Use the SDK's `Sandbox.connect()` API programmatically.

10. **Removed `abx skill` CLI command group**.
   The `abx skill search/install/list/create/publish` commands have been removed.
   *Migration*: Skills system is a future planned feature. Use templates as the current capability distribution mechanism.

11. **`Sandbox.run()` is now a bare-shell shortcut** (was named-command dispatcher).
    `Sandbox.run(cmd)` now delegates to `sandbox.commands.run(cmd)` and returns `ProcessResult | StreamReader`. It no longer dispatches named custom commands.
    *Migration*: replace `sandbox.run("name", **kwargs)` with `sandbox.custom("name", **kwargs)`.

### Breaking Changes (ADR 2026-09-29 — init/create Semantics, partially superseded)

> **Update (2026-09-29, ADR `2026-09-29-init-restore-and-create-explicit-error`):** item 1 below is **superseded** — the top-level `abx init` shortcut has been **restored** as an exact alias of `abx template init` (same click command object, option surface unchanged). Items 2–3 stand, and item 3 replaces the earlier "`abx create` (no arguments) uses the `base` template" routing.

1. ~~**Removed the top-level `abx init` shortcut**.~~ **Superseded: restored.** The top-level `abx init` shortcut is back and delegates to the exact same command object as `abx template init` (options unchanged). Guided credentials setup remains `abx config init`; cloud sandbox creation remains `abx create`.
   *Migration*: `abx init [DIRECTORY]` and `abx template init [DIRECTORY]` are interchangeable again.

2. **`abx create "DESCRIPTION" --template NAME` is now rejected**.
   Previously `--template` silently won and the description was ignored. Passing both now raises a usage error (exit code 1) before any AI generation or network call — neither input is silently dropped.
   *Migration*: keep DESCRIPTION for the Qwen Code AI path, or `--template` for a direct launch, but not both.

3. **`abx create` with no arguments is now an explicit usage error** (exit code 2).
   Previously bare `abx create` silently launched the `base` template. It now prints a routing hint (`--template base`, `--template <NAME>`, or `"DESCRIPTION"` for the AI path) so the choice is always explicit.
   *Migration*: use `abx create --template base` to launch the base template.

### Changed (CLI UX)

- **Unknown top-level commands now get targeted hints.** A close spelling candidate (e.g. `abx crate`) gets a `Did you mean 'create'?` suggestion; with no plausible candidate the error points to template `custom_commands` (declared in `template.yaml`) and running them via `abx run COMMAND`. Exit code 2 and stderr-only output are preserved; only the root group is affected.
- **Top-level shortcut registration is explicit.** Built-in top-level shortcuts
  (`create`, `list`, `init`, `install`, `deploy`, `run`, …) are registered in the
  `LazyGroup(lazy_subcommands=...)` map in `src/agent_sandbox/cli/main.py`. This map
  is a maintainer-facing registration point for the built-in top-level entry points.

  *(Historical note: an earlier CLI design draft rejected a `[shortcuts]` config
  section. This decision was superseded by ADR `2026-09-30-configurable-cli-shortcuts.md`:
  `[shortcuts]` is now implemented as a user-configurable alias layer — see
  the [Unreleased] Configurable CLI shortcuts entry.)*

### Breaking Changes (ADR 2026-09-29 — qwen-code Session-Turns Parameter Unification)

1. **Renamed the qwen-code session-turns parameter to `max_session_turns` / `--max-session-turns` everywhere** (SDK, CLI, qwen-code template `template.yaml`/`commands.py`, docs).
   The old names were misleading: `Sandbox.deploy(max_tool_calls=...)`, `DeployModule.deploy_project(max_tool_calls=...)`, and `abx deploy --max-tool-calls` all forwarded the value to qwen-code's official `--max-session-turns` flag (user/model/tool turn cap, exit code 53), not to the semantically different upstream `--max-tool-calls` budget (cumulative tool calls, exit code 55). The pre-existing template arg `max_turns` is renamed for the same reason and its default is unified to `100`.
   *Migration*: rename `max_tool_calls=` → `max_session_turns=`, `--max-tool-calls` → `--max-session-turns`, and template arg `max_turns` → `max_session_turns`. Old names fail loudly (CLI usage error / SDK `TypeError`); no aliases are kept, matching the pre-release no-compat-shim policy.
2. **`run_qwen_code_headless()` / `_build_headless_command()` accept an optional `max_session_turns` keyword** (`None` by default adds no flag). This is the stable naming contract for the natural-language `abx create` pipeline and future headless callers.

### Breaking Changes (Task 187 — Template Catalog Single Source of Truth)

1. **The template catalog moved to the dedicated repository [`alibaba-agent-sandbox/awesome-templates`](https://github.com/alibaba-agent-sandbox/awesome-templates)**.
   Template content, the machine-readable index (`awesome-templates.yaml`), releases and CI now live there — it is the single source of truth for official & community templates. This repository no longer bundles the template collection: `examples/templates/` keeps only a minimal `python-hello` **offline fixture**, explicitly marked as a fixture (not a publishing source). The repository-root `awesome-templates.yaml` has been removed.
   *Migration*: instead of deploying a bundled folder (e.g. `abx template deploy ./examples/templates/node-web`), install from the index (`abx template install node-web`) or reference the source repo directly (`abx template install alibaba-agent-sandbox/awesome-templates//node-web@v1.0.0`).
2. **`abx template search` / `abx template install <bare-name>` now resolve against the remote index** (cached under `~/.abx/index/`). Bare names that are not builtins are looked up in the index; a miss triggers one forced refresh, and the resolved `owner/repo//subdir[@ref]` is printed (`Resolved '<name>' via the template index: ...`).
   *Migration*: no action needed for direct `owner/repo` references; bare names must exist in the index. Use `--index-url` / `ABX_TEMPLATE_INDEX_URL` for private mirrors.

### Added
- **Remote template index client (`agent_sandbox.utils.template_index`)**: fetches `awesome-templates.yaml` from the SSOT repository via `raw.githubusercontent.com` (CDN — not subject to the API 60 req/hour anonymous limit), with a `~/.abx/index/` cache, 1-hour TTL, `If-None-Match` revalidation, and explicit degraded modes (stale-cache fallback with a warning on network failures / rate limits / 5xx; loud errors with remediation when no cache exists; `schema_version` newer than supported fails with an upgrade hint). `--index-url` / `ABX_TEMPLATE_INDEX_URL` and `--token` / `GITHUB_TOKEN` are supported.
- **`SKILL.md`**: Static Agent Skills–style usage guide at the repository root for AI coding tools and agents in other projects — covers when to use, install, credential safety (including never-leak rules), MCP vs SDK selection, sandbox create/execute/files/destroy workflows, and common error diagnosis. Referenced from `llms.txt`. Documentation only: the removed `abx skill` command group, Skills registry, and runtime are **not** restored (ADR 2026-09-29). Shipped in the sdist but not the wheel (evidence: `tests/test_packaging.py`; guide/code consistency: `tests/test_agent_guide.py`).
- **`Sandbox.custom(name, *, server_port=9000, **kwargs) -> CommandResult`**: New method for named custom-command dispatch. Uses A→B resolution: first tries template `custom_commands` (mechanism A), then falls back to `@registry.command` on SandboxServer (mechanism B). Returns `CommandResult` with `value`, `stdout`, `stderr`, `exit_code`, `execution_time`, `source` (`"template"` | `"server"`), and `success` property.
- **`CommandResult` data model**: Structured return type for `custom()` replacing the bare `Any` that `run_command()` returned.
- **`abx template init`**: New scaffold command that generates a complete template project from built-in cases (`python`, `node`, `minimal`) or an existing registry reference (`--from`). Includes interactive case selection on TTY.
- **`github_token` config key (`abx config set github_token`)**: persistent GitHub token for template downloads, mapped to the `GITHUB_TOKEN` environment variable and stored in `~/.abx/.env` (chmod 600). In an interactive terminal the value may be omitted — the token is read through the existing masked (asterisk) input and never echoed; `abx config get` / `abx config list` show it masked, and `abx config set github_token ""` removes it. Resolution order: `--token` > process `GITHUB_TOKEN` > stored `github_token` > no token.
- **One-shot GitHub rate-limit onboarding (E5000)**: `abx template search` / `abx template install` (`abx install`) now print the officially documented fine-grained PAT prefill URL when the anonymous limit (60/hour) is hit — public repositories need no extra permissions and a 90-day expiry is recommended. In an interactive terminal only, the CLI offers to store the token with masked input and retries the failed operation **exactly once**; declining, cancelling, or a retry that fails again surfaces the original error. CI / non-interactive sessions are told to inject `GITHUB_TOKEN` as a secret or to run `abx config set github_token` in a terminal. The CLI never runs `gh auth token`, never opens a browser, and never prints or logs a token.
- **Unified rate-limit guidance (`agent_sandbox.utils.github_token`)**: shared headline + remediation used by the registry tarball client and the template-index client; `owner/repo//subdir@ref` references are preserved verbatim in download errors (e.g. `alibaba-agent-sandbox/awesome-templates//codex-agent-api@v1.0`).

### Deprecated
- **`Sandbox.run_command()` / `Sandbox.run_command_sync()`**: Deprecated in favour of `Sandbox.custom()` / `Sandbox.custom_sync()`. Both deprecated methods wrap `custom()` internally but only return `result.value` (type `Any`) for backward compatibility — the full `CommandResult` (with `stdout`, `stderr`, `exit_code`, `execution_time`, `source`, `success`) is discarded. If you were treating the old return value as a `ProcessResult`, migrate to `custom()` / `custom_sync()` which return the complete `CommandResult`. Will be removed in a future release.

### Breaking Changes (Official CreateTemplate API convergence)

1. **`abx template build-local` was removed and replaced by `abx template build`**.
   The old `build-local` command name no longer exists (invoking it fails with `No such command 'build-local'`). `abx template build` runs the full pipeline: local Docker build → ACR push → template registration, and `abx template deploy` remains an alias invoking the same pipeline.
   *Migration*: replace `abx template build-local <DIR>` with `abx template build <DIR>` (same option surface).

2. **`abx template build` / `template deploy` default to the official CreateTemplate API**.
   The legacy v3/v2 platform API is no longer the default; it remains available behind the explicit `--legacy-api` flag (the approved convergence decision — the default switched to the official API while the legacy code path stays behind a flag). The ACR push and the remote template registration are cloud-side operations that can incur Alibaba Cloud costs (ACR storage/traffic, template resources).
   *Migration*: scripts needing the legacy v3/v2 behaviour must pass `--legacy-api` explicitly.

### Changed
- **`--token` is documented as a temporary override**: `abx template install` / `abx template search` help now warns that `--token <value>` may leak into shell history and process listings, and recommends the persistent `abx config set github_token` as the default fix.
- `commands.run()`, `commands.stream()`, and `commands.start()` now auto-wrap commands containing unquoted shell operators (`|`, `;`, `&&`, `||`, `>`, `<`, `(...)`, `$(...)`) in `sh -c`. Variable expansion (`$VAR`), backticks, and globs still require explicit `sh -c '...'`.
- **`abx template build` (renamed from `build-local`)**: default mode switched to the **official CreateTemplate API** (`--official-api`). Legacy v3/v2 behaviour now requires an explicit `--legacy-api` flag.
- **Official template path prerequisites**: `abx template create` and `abx template build` (default mode) now require the `alicloud` extra (`pip install "agent-sandbox[cli,alicloud]"` or `pip install "agent-sandbox[alicloud]"`) and Alibaba Cloud AK/SK credentials.
- When `envdInject` is enabled and `--target-image` is omitted, `copy.image` is now auto-derived with a `-fcsandbox-<hex>` random suffix to satisfy the platform requirement that `copy.image` must differ from `sandboxConfig.image`. For a stable tag, pass `--target-image` explicitly.

### Migration
- Replace `abx template build-local <DIR>` with `abx template build <DIR>` — the old command name was removed.
- Existing automation scripts invoking the build pipeline without `--legacy-api` now hit the official CreateTemplate API. To preserve the legacy v3/v2 behaviour, add `--legacy-api` to the command.
- **Automation / CI hardening**: pass `--acr-namespace` and the template directory explicitly on the command line instead of relying on `ACR_NAMESPACE` / `ABX_TEMPLATE_DIR` environment variables or `.env` files, so builds cannot silently drift with the surrounding environment. For `abx template install` / `abx install`, either pass `--acr-namespace` explicitly or use `--download-only` when the pipeline must not touch the cloud at all.


### Added
- **Server Module**: Container-side HTTP server (`agent_sandbox.server`) expanded from 6 to 42 endpoints across 8 capability groups (CORE, COMMANDS, FILE_OPS, PROCESS, SYSTEM, TERMINAL, DEV_TOOLS, BROWSER)
- **Server CapabilityGroup.BROWSER**: New browser automation capability group with 8 Playwright-backed endpoints (navigate, screenshot, content, click, type, evaluate, pdf, console)
- **Server PTY Terminal**: WebSocket-based interactive PTY terminal system with session management (REST create/list/delete + WebSocket I/O)
- **Server SSE Shell**: Streaming shell execution via Server-Sent Events (`POST /shell/stream`) for real-time command output
- **Server RouteTable**: Declarative route registry replacing if/elif dispatch; capability groups can be toggled at runtime or via `ABX_SERVER_DISABLED_GROUPS` env var
- **CLI `abx sandbox files`**: 6 file-operation subcommands — `list`, `stat`, `mkdir`, `rm`, `mv`, `search`
- **CLI `abx sandbox process`**: 4 process-management subcommands — `list`, `start`, `info`, `signal`
- **CLI `abx sandbox system`**: 5 system-info subcommands — `info`, `env`, `ports`, `packages`, `metrics`
- **CLI `abx sandbox capabilities`**: Show supported capability groups of a sandbox
- **CLI `abx sandbox shell-stream`**: Real-time streaming command execution (SSE-backed)
- **CLI Global Options**: Added `--ci` (CI/CD mode: quiet + no-color + json), `--log-level` (explicit DEBUG/INFO/WARNING/ERROR)
- **CLI OutputManager**: Unified output manager (`cli/output.py`) with TTY/CI auto-detection, replacing ad-hoc click.echo calls
- **Template Migration**: All 10 templates migrated to new `CapabilityGroup` API
- **Core SDK**: `Sandbox` class with `create()`, `connect()`, `kill()`, `run_code()` and async context manager
- **Commands Module**: `run()`, `stream()`, `start()` for executing commands in sandboxes
- **Files Module**: `read()`, `write()`, `list()`, `upload()`, `download()`, `exists()`, `remove()`, `make_dir()`
- **Network Module**: Port URL and access headers calculation (`get_host()`, `get_url()`, `get_access_headers()`).
- **Code Interpreter**: `run()` for code execution with multi-language support
- **CLI (`abx`)**: `create`, `list`, `info`, `kill`, `exec`, `shell`, `auth`, `config` commands
- **Dual Authentication**: API Key (`SANDBOX_API_KEY`) and AK/SK (`ALICLOUD_ACCESS_KEY_ID/SECRET`)
- **Connect Protocol**: Full `application/connect+json` implementation with Server-Streaming support
- **Transport Layer**: HTTP/2 connection pooling, WebSocket with heartbeat/reconnect, layered configuration
- **Error System**: Structured exceptions with error codes (E1001-E5002), suggestions, and docs URLs
- **E2B Compatibility**: Drop-in compatible `compat.Sandbox` wrapper
- **Output Formats**: Table (rich), JSON, and quiet modes for CLI
- **Sync Support**: All async methods have synchronous variants via `run_sync()`
- **Community Template Index**: `awesome-templates.yaml` — curated index of official and community sandbox templates

### Changed
- **Network Module**: Removed experimental `expose()` and `list_ports()` APIs in favor of a simpler local URL calculation interface based on official documentation. Port URL is now computed client-side as `https://{port}-sbx-{sandbox_id}.{domain}`.

### Architecture
- Six-layer architecture: Transport → Protocol → Extensions → API → Declarative → Agent Integration (+ CLI + Server)
- Async-first design with sync wrappers
- Lazy imports for fast CLI startup (< 200ms)
- Domain-partitioned HTTP connection pools (Platform API vs envd API)

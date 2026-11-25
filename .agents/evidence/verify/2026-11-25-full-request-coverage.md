# 全部原始诉求的交付覆盖复核

日期：2026-11-25。用途：所属仓库 `.agents` 的工程交付记录，不是公开产品手册。

本表补充原十四项用户路径问题，不替代其失败证据。核对了当前主线、合并状态、实际发行与仍开放的草稿；没有因为草稿存在就判断无法继续，也没有把曾通过的局部检查升级为完整交付。本表为独立复核检查点；后续新合并与官网发布由各自发行记录补充，不倒写早期失败。

**结论：本轮修复并交付了若干真实缺陷，但用户要求的整体终态还没有全部完成。** 最大缺口是资源 YAML 与构建/部署/创建分离的正式迁移、可靠的实例应用启动、六 Harness 托管模板与完整真实业务验收，以及对应专题。不能用新 SDK 包、OpenAPI 元数据或文档同步代替这些工作。

## 状态与证据口径

- **本轮完成**：实现/文档已合并，注明实际发布和验证范围。
- **历史已有**：已有主线实现或历史验收；本轮只核查，没有重复全量验收。
- **无需新增**：用户目标有更简单的实现，或候选方案没有正确语义；不是删除仍有独立用途的已有能力。
- **必要但未完成**：仍需实施、联动或验证。具体技术阻断单列；“PR 是 Draft”本身不是技术阻断。

## 逐项复核

| 原始诉求 | 判定及已交付范围 | 未完成内容、原因与承接 |
| --- | --- | --- |
| 统一目标优先的业务命令，明确 Sandbox ID/本地名称，不再套 command/registry-command 包装 | **本轮完成部分**。CLI [277](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/277) 修复调用与帮助衔接；目标优先入口在当前 0.6 源码存在。OpenAPI 操作不是 Shell 回退，也不隐式创建实例 | 全部模板示例尚未迁移；旧 0.5.10 教程属于另一命令族，不能混用。见模板311、CLI281 |
| 自然参数，而不是每次手写 --path/--query/整个 body | **本轮完成支持子集**。277 增加 `--path-id`、`--query-limit`、`--body-name` 和无歧义的简写；保留显式 JSON 正文 | 复杂 schema、multipart、SSE 等不能因为有 OpenAPI 就宣称可调用；支持范围由帮助如实提示 |
| 用户请求不能被静默修改，下载结果必须正确 | **本轮完成**。277 拒绝重复单值输入、保留二进制下载字节、避免失败伪成功；有 HTTP/组件回归 | 不代表任意 API 编码或流式传输已支持 |
| 默认 Provider 与显式 --provider 两条路都可用 | **历史已有，本轮修正指南**。CLI 配置默认值和命令覆盖分别存在；Python 标准入口、ProviderSandbox 与 Node HTTP 客户端职责已重新说明 | 没有把任意 Provider 自动变成标准 E2B 协议。OpenSandbox 全部真实业务未在本轮重验 |
| E2B/OpenSandbox style、保存默认 style、别名兼容 | **无需新增全局 style**。别名不能转换参数、认证、输出、生命周期或资源范围；不能把 kill 映射成更宽的应用删除 | 保留真实已有的 Express 标准协议迁移路径；将来任何兼容能力须按明确协议验收，不能靠风格开关承诺 |
| 移除 app、launch 及多套冗余入口 | **当前 0.6 公共命令面已收敛，整体迁移未完成**。不再新增 registry-command 包装；CLI277/285 当前指南按实际入口说明 | 0.5.10 仍有历史 app/launch；全仓旧模板与旧文档没有因此自动迁移。用户要求的终态无需兼容，但实现仍应一次承接消费者，见CLI281/模板311 |
| build 只构建；deploy 发布资源；create 只创建实例 | **必要但未完成**。[CLI281](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/281) 为本轮独立候选，未合并未发布；现 alpha.2 仍没有根 create | 候选已完成受控 Express 模板 deploy/status/delete/独立不存在，以及 FC 静态函数 deploy/status/delete/独立404；根 create 已实际创建和删除实例，模板返回字段对比有未确定原因的失败，正在补出站native ID回归。仍缺最终集成、API启动/Invoke/全应用与目录迁移；不能展示为当前发行用法 |
| build.json/计划/收据不暴露给用户，包括帮助、输出和错误 | **本轮部分收敛，必要迁移未完成**。正常 API 调用不需内部文件；CLI281 移除构建交接并使用内部状态 | 旧应用配方/README 仍有 plan/receipt 等概念；不能声称所有命令、JSON、verbose、CI 与模板已全部清理。承接CLI260/281与模板309/311 |
| 一份本地 template.yaml；specVersion:1；registry.yaml 只承载上架/初始化 | **目标已明确，必要但未完成正式切换**。活跃模板仍主要是 spec_version:5，managed agents-api 为6；现主线 v1 Schema 标注未启用 | [模板311](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/311)、[CLI249](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/249)、[Registry102](https://github.com/Alibaba-Agent-Sandbox/registry/pull/102)、[SDK164](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/164) 尚未联合落地 |
| parameters 属于 Registry、vars 任意键、template.region、多个命名 Sandbox/Serving、不要 resources 冗余层 | **设计已写进候选，不是已启用合同**。本轮未改变用户确认的这些语义 | 初始化提示、变量解析、多个资源选择、目录摄取与 SDK 消费仍须按311/249/281/102/164一致完成；不能以 Schema 文件存在代替引擎支持 |
| 完整 Sandbox 参数，与原生模板/实例/卷 API 对齐，支持网络、存储、域名等 | **必要但未完成最终全参数对照**。既有 Provider/native 接口和历史字段审查可复用 | 需要按实际 Provider/API版本列清类型、互斥、默认、更新与生命周期。静态卷不等于实例动态挂载；域名属于具体网络/Serving能力；不得为“完整”虚构统一参数。现草稿通过形状校验不等于全部云字段端到端覆盖 |
| buildConfig 只分 Dockerfile/context 或 steps；context 默认 Dockerfile 目录；删除重复 build/固定字段 | **目标已确定，执行迁移未完成**。候选实现可复用；不要求两种分支同时填写 | Dockerfile构建目标镜像和原生Steps输入镜像语义不能伪装一致。Express原生Steps没有已证明的任意OCI导出/推送能力；应明确拒绝不支持组合，不能称“默认都推到image”已实现 |
| osType、registryType、acrInstanceId、copy/envdInject/installStorageClients 是否都让用户填写 | **普通场景无需全部暴露**。可可靠推导者下沉，软件安装优先镜像/Dockerfile；无效的“关闭注入”公共开关已清理 | 跨仓库copy不是Dockerfile安装；私有仓库认证/证书/网络覆盖仍必要。保留真实原生高级能力不代表它们都是目标公共YAML必填 |
| 复用 Serverless Devs 组件、原生 FC props/build、统一凭据和日志、Sandbox/Serving actions | **历史直接组件引擎已存在；完整新合同未完成**。现 component_runner 通过官方loader直接调用组件并提供getCredential | 当前logger主要计数/抑制原生进度，logs另行捕获，不能称全部日志已统一。任意命名资源、原生build/actions/表达式与完整日志适配仍在249/281；真实输入/生命周期/归属不能只靠调用组件方法解决 |
| 不声明动态 instance；Sandbox/Serving 各有启动与就绪语义 | **必要的语义边界已确认，模板迁移有真实技术阻断** | Express startCommand/readyCommand 属于构建快照阶段；OCI CMD 不会成为创建后启动。create时env不能证明已快照服务重新读取认证，当前Server SDK缓存token。不能删47个runner后声称create已可用，也不能引入未审查明文session交接。见[模板启动审查](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/.agents/evidence/verify/2026-11-25-native-template-startup-audit.md)及311/281 |
| 所有 Sandbox 为空，通过模板/API注册加载能力；未来删除 envd | **新方向尚未整体实现**。本轮目标优先API不对未知操作回退Shell/envd | 已有Provider数据通路/管理镜像仍存在；删除无效开关不等于删除envd。没有真实服务就不能凭注册声明创建数据面。需先完成启动、端点、身份与生命周期合同 |
| registry.yaml 引用 OpenAPI，自动帮助、发现与调用 | **本轮完成活跃子集的跨仓库一致性**。[模板318](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/318)提供共享校验器/Schema片段；[Registry108](https://github.com/Alibaba-Agent-Sandbox/registry/pull/108)摄取安全摘要；277消费 | 当前仅支持 `sandbox.<name>`、包内文件/内部引用等明确子集；不是Serving endpoint绑定、任意远程OpenAPI或完整v1资源引擎。元数据不自行安装/启动服务，也不证明授权或实时可用 |
| OpenAPI 特殊能力：上传文件、从其他参数/本机配置获取默认、AK/SK签名 | **已完成明确的凭据来源绑定；通用扩展未完成，也不应自动猜测**。277仅对可证明的本CLI部署服务绑定对应应用token引用 | 文件自动上传/多请求编排、通用x-abx扩展、OAuth/AK-SK signer、Serving绑定尚未实现。OpenAPI本身不保证这些执行能力；有需求应逐项定义合同，不能eval/自动读取任意秘密 |
| command list/run 是否鉴权、可否匿名、细粒度策略与限制 | **历史已有，入口解释本轮改善**。Server SDK可配置令牌、scope、endpoint policy与匿名；正常CLI部署token应自动准备并复用 | 未设置token的裸服务可匿名，不能笼统说所有部署默认安全。帮助来自离线契约，不等于权限。关闭能力/鉴权错误/限额须按各服务实测；本轮没有重新完成所有策略的安全矩阵 |
| sandbox命令到底来自Provider/envd还是Server SDK，可关闭哪些 | **本轮文档完成区分**。[Python180](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/180)明确控制面、Provider原生数据面、应用HTTP三条路；已有细粒度端点指南 | 不能将平台create/kill/list当Server SDK开关，也不能将Server SDK策略当envd开关。旧完整参考页仍有部分版本/入口描述需要逐处核对；仅文档存在不等于全部已与最新终态对齐 |
| CLI详细安装/配置/每条命令子参数与组合案例；Client/Server SDK各归其仓库 | **已有完整手册框架，本轮修复受影响章节**。CLI277/285、Python180/185/187及官网124处理当前入口、ID/URL、默认Provider、凭据、安装版本与清理语义 | 还没有对全部历史页面/模板重新逐命令验收；新v1终态手册依赖未完成引擎。新发现 `/packages` 旧pip说明及3对当前CLI页面已在所属SDK窄补漏候选修正，待正常CI/合并；不把局部修复称全站全部完成 |
| Provider可多语言也可单语言；优先对应语言，无实现时自动下载受控Node与Provider | **必要但未完成发布**。[Python167](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/167)，承接[Issue166](https://github.com/Alibaba-Agent-Sandbox/python-sdk/issues/166) | 草稿有native优先、受控Node/EPP和真实Express检查；OpenSandbox冷/暖/离线验证使用测试后端，缺真实OpenSandbox完整验收；自动受信catalog/原生制品安装也有独立未完成项。不能把代码草稿当已内置发行能力 |
| 阿里云极速版Python Provider内置Python SDK；先不关注容器版 | **历史主线已内置Express Python实现**，并非必须等167；本轮MCP真实Express已使用已发布SDK路径 | 当前目录Node Provider仍通过本机abx engine桥接；不能说所有Provider都无需预装。容器版168不进入当前任务，不以它替代Express/OpenSandbox验收 |
| MCP业务目标：让已有Agent远程用沙箱，标准协议、工具范围、Session设计 | **历史功能存在，本轮完成可靠性补缺**。[CLI280](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/280)、[Python185](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/185)处理Session拥有/借用、清理失败保留、并发创建、取消与重试、协议header | 支持明确的MCP协议/工具子集，不等于所有可选标准特性。HTTP会话是服务进程内状态，不是跨副本持久会话；FC部署仍要结合该运行拓扑验收 |
| MCP是否真实测试，本机/HTTP/FC远程Agent可用 | **本轮真实本机HTTP到Express链路通过**。CLI与Python各完成受控base实例创建/实际命令/删除/独立不存在验证；没有RDS或镜像构建 | 这不是本轮真实FC部署MCP或全部Agent宿主/OpenSandbox云矩阵。FC制品/生成工程的本地运行、公开安装与真正云部署要分别表述；完整FC远程Agent业务仍必要且未在本轮验收 |
| MCP失败不能丢唯一回收记录、不能把ACK或HTTP退出当全清理 | **本轮已交付核心修复**。185/280保留失败Session及handle，503可重试同Session；实际Sandbox.kill远端失败保留client，ACK后只重试本地close | [Python170](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/170)旧重试范围已覆盖；其kill_sandbox错误分类残项在本轮补漏候选已修复，新增16例先失败、修复后119相关用例及真实本机HTTP通过，完整CI/合并仍待完成。完成后关闭被替代170/169，不重做生命周期框架 |
| 没有意义/错误的envd关闭开关应删除 | **本轮完成CLI MCP公开残项**。[CLI284](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/pull/284)删除 `envd_inject`，旧true/false在平台调用前报错；CLI旧flag已退役 | Python MCP没有这个工具，不伪造对称删除；原生Provider高级输入保留真实语义，false省略请求不等于云端禁止注入 |
| Harness不要请求时下载，应提前镜像安装/部署；ServerSDK内置API和模板是什么关系 | **历史镜像预装存在，本轮纠正不存在的installer提示**。185把缺失Harness引导改成固定镜像/构建安装并验证版本；SDK包含API/适配器不是所有CLI二进制 | 没有新增虚构的统一install命令。模板是镜像、配置、策略与部署组合，不能把SDK API本体等同某个Registry托管应用。六Harness独立镜像仍未交付 |
| Agents API统一Server endpoint，Agent运行Session Sandbox | **历史核心模板已交付并有局部真实验收**。[模板296](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/296)、[Python156](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/156)；旧0.1.4/CLI0.5.10/SDK0.4.0a7完成同一Gateway两轮Qwen文件任务、下载和清理 | 本轮没有重跑旧全应用；新YAML、当前SDK、升级与所有Harness不能继承旧结论。现模板仍叫agents-api，不能称新agents-api-codex已发布 |
| 对齐OpenAI Agents API，完整能力与可靠性 | **已有对齐分析与部分协议实现；整体必要工作未完成**。路径/typedinput/Session/Turn/文件/取消等文档与本地验证存在 | [SDK163](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/163) typed input/saved-Agent缺陷、164投影、165六Harness均未合并。active steering、跨重启幂等/事件、附件实际消费、运行停止确认及原生托管拓扑有差异；不能说OpenAI SDK严格全兼容。需要分别验收本地core与managed profile |
| 六个agents-api-*模板：Codex/QwenCode/ClaudeCode/Qoder/OpenCode/DeepSeekHarness，同一协议 | **必要但未完成**。[模板312](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/312)与[SDK165](https://github.com/Alibaba-Agent-Sandbox/python-sdk/pull/165)，总承接[模板Issue309](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/issues/309) | 当前已有codex-agent-api/qoder等不同历史模板不能冒充这六个新托管配方。312仍钉未发布0.4.0a8，新0.5.0a1没有165适配器，不能只换版本绕过；需重基、真实镜像、六原生鉴权/模型工具文件任务、FC/PostgreSQL/旧Session升级及清理 |
| 完整AgentsAPI/应用模板/Sandbox模板/Client SDK/Server SDK设计文档和完整Demo包 | **已有文档与草稿案例，最新统一终态未完成**。历史案例含真实代码、HTTP与Python调用；SDK180改善入口衔接 | “所有字段同时开启”的YAML并不合法。最终完整参数参考、互斥分支、代码包/Registry/Template/运行输出须与正式引擎和模板同步；不可把草稿Demo当可直接部署。承接309及各候选消费者 |
| 模板开发公约、什么是好模板、所有模板AI评价、Sandbox/应用类型与资源说明 | **必要但未交付主线**。[模板300](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/300)仍open | 有51条静态评价候选与引用证据；静态评分不等于真实业务/性能/Provider资格。其历史CI因LibreOffice固定包不可获得失败；主审正在按当前基线收口文档候选和门禁，尚不能把工作中状态写成已合并 |
| AgentsAPI文档技术架构、各模块云产品与用户需准备的资源 | **已有基本资源说明；完整新增图表未发布**。[模板301](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/pull/301)仍open | 候选图/双语文档曾做局部检查，旧CI受固定包安装失败；主审正在按当前基线复核并准备正常落地。此检查点尚未合并或证实Registry最新图上线 |
| 每模板文章、意义/场景/定制、CLI/HTTP/SDK调用、快速链接、简单清理，不写内部审计过程 | **历史部分已完成**。[Blogs33](https://github.com/Alibaba-Agent-Sandbox/blogs/pull/33)旧单endpoint实践；[Blogs34](https://github.com/Alibaba-Agent-Sandbox/blogs/pull/34)清理内部叙事并补模板链接/用法 | 历史6篇草稿没有因此公开；新六Harness文章与新规范操作输出未完成。禁止把mock/预期效果当真实模型结果；无需再次制造数据库只为文章截图 |
| Registry和博客建立AgentAPI专题 | **必要但未上线**。[Registry105](https://github.com/Alibaba-Agent-Sandbox/registry/pull/105)、[Website121](https://github.com/Alibaba-Agent-Sandbox/website/pull/121)、[Blogs43](https://github.com/Alibaba-Agent-Sandbox/blogs/pull/43)均Draft；42为操作记录 | 有本地页面/导航/截图检查，但依赖六配方的真实交付；不是当前官网124文档安装修复所交付内容。历史Qwen文章不可改标签冒充新Codex验收 |
| 博客更多标签右侧、删除重复篇数、精选只是标签、独立置顶、列表一致与悬停留白 | **历史主线实现可见，本轮只读核对**。当前Website Blog.astro/site.css有右侧更多标签、筛选才计数、pinned排序、统一行卡及内边距/两行摘要 | 本轮安装页的26项浏览器测试不是博客交互复验；不重复宣称全站UI本轮已验收，也不为此开新UI改造 |
| 所有受影响模块是否都要发版、文档/Registry/website/.agents是否同步 | **按实际行为决定，已执行相关发布**。Python185行为修复经187/188发布配对0.5.0a1；CLI285准备alpha.2；模板318/Registry108无需独立SDK版本 | NodeHTTP客户端无确认缺陷，不为“所有模块”机械发版。CLI alpha.2公网npm已由独立全新安装及制品检查通过；多平台制品和官网124最后结果见对应记录，不由PR合并推断。最新v1/六Harness尚未发布 |
| 云资源清理与避免任务扩散、必要操作放所属.agents | **本轮相关已完成**。每个变更仓库有记录、测试和正常PR；Express MCP只用受控实例，独立确认释放，该MCP范围没有新RDS/镜像/模板。CLI281另有独立受控模板/FC资源验收与清理，不能把MCP范围推广为整轮零模板 | 历史五个RDS清理属于旧证据，不宣称当前账号全资源盘点。未完成的新应用验收以后仍须按拥有范围回收，不借此扩展发布治理或重复资源矩阵 |

## 本轮已确认的公开交付

- Python 180、185、187、188均已合并。`v0.5.0a1` 对应 `8d9297f7d1a9adddf3710ddcaab914b9e35d3618`；实际Publish45597651893及独立公网四制品哈希、全新安装、client-only HTTP、optional server、无pip环境库存HTTP通过。完整边界见[发行记录](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/.agents/evidence/verify/2026-11-25-python-050a1-publication.md)。它不包含165/167草稿。
- 模板318合并025b0f5，Registry108合并9e41127。唯一手动同步run45602147647成功；公开`docs-content.json.gz`在11:12UTC包含CLI fb4de80、Python da6b0ef、模板025b0f5及双语API新指南。Registry109记录合并18206b0。公开导出不等于官网每个新路径已上线，官网另作验收。
- CLI277、280、284、285已合并；alpha.2实际npm发布run45602785730成功，第三次全新官方安装与完整已安装制品检查通过；公开next为alpha.2、latest仍0.5.10，npm包SHA256为b0558f4f39645fcb4fc29a2bb6005d4e2d186e29c340fecd7d974d00cbc54f84。第一次ETARGET、随后tarball404保留为失败检查点，不改写成立即可用。多平台制品与官网124仍以发行主记录为准。

## 必须继续的次序

1. 先把本轮直接关联的参考页遗漏与MCP删除错误脱敏残项收口；避免“已修复”文档与实际分支不一致。
2. 确定可执行的实例业务启动/凭据注入边界，再完成纯build/资源deploy/实例create，联合迁移YAML、SDK、全部模板和Registry。不能用新增魔法字段绕开云平台事实。
3. 重基托管API及六Harness配方，取得完整且明确授权的现有模型/数据库/FC输入，验证真实业务、同Gateway续接/升级、文件与清理，再发布专题与新版实践。缺少输入是具体验收前提；代码未整合与测试未执行仍是未完成工作，不包装成外部阻断。
4. 通过实际门禁落地模板公约/评分及架构说明；评分与运行资格分开。已被实证替代的旧PR按具体差异关闭，仍有独立价值的草稿保留。

Result: PARTIAL — 本轮已交付项及必要未完成项分别列明；不是整个原始需求完成声明。

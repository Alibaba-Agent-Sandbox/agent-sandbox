# 二进制安装

`abx` 同时以**预编译独立二进制**的形式发布 —— 单个可执行文件内嵌了
Node.js 运行时、Agent Sandbox CLI 以及其全部依赖。**无需安装 Node.js。**

二进制随每个 GitHub Release 发布
（[Releases](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases)）：

| 平台 | 文件 |
|------|------|
| Linux (x64) | `abx-{version}-linux-x64` |
| Linux (arm64) | `abx-{version}-linux-arm64` |
| macOS (Apple Silicon) | `abx-{version}-darwin-arm64` |
| macOS (Intel) | `abx-{version}-darwin-x64` |
| Windows (x64) | `abx-{version}-windows-x64.exe` |

每个文件都有同名的 `.sha256`（SHA-256，`sha256sum` / `shasum -a 256` 的文本格式）。
**v0.4.0** 已提供五个平台的 `abx-*` 二进制及对应 SHA-256 文件。旧 v0.2.0 使用 `ebx-*`，本安装脚本不消费旧文件名。也可[从源码安装](#从源码安装)。

官网已镜像完整稳定版：五个平台的二进制、npm 归档及 SHA-256 文件；大小和校验和验证通过后才部署。[镜像清单](https://www.agent-sandbox.cn/releases/latest.json) 标识当前可下载的版本。GitHub 新版本在镜像部署完成后成为官网默认版本。

---

## 安装

公开的默认最新版安装脚本已验证可安装 v0.4.0，覆盖 SHA-256、版本、标准及原生命令帮助、完整许可证，以及从本地发起的8项真实极速版检查，测试资源全部清理。之后的 `[Unreleased]` 变更需要对应的新版本。

### macOS 与 Linux

```bash
curl -fsSL https://www.agent-sandbox.cn/install.sh | sh
```

二进制下载在终端 stderr 显示 curl 进度条和百分比，`curl | sh` 同样适用。重定向 stderr 时不显示动态进度，下载错误和校验结果仍会保留。服务器未提供总大小时，curl 显示传输活动而不显示百分比。


脚本是 POSIX `sh`。它识别操作系统和 CPU，包括 Apple Silicon 上的 Rosetta shell（安装原生 `darwin-arm64`）和 `aarch64` Linux（`linux-arm64`）。官网入口设置已完整镜像的版本和官网下载前缀，因此默认安装无需访问 GitHub 查询版本或下载文件。脚本下载二进制和 `.sha256`，用 `sha256sum` 或 `shasum` 校验，并且不需要 `sudo`。

目标目录在 `/usr/local/bin` 可写时用它，否则用 `$HOME/.local/bin`。目录不在 `PATH` 上时，脚本打印需要添加的那一行 `export PATH=...`，然后执行 `abx --version`。

```bash
# 可选
curl -fsSL https://www.agent-sandbox.cn/install.sh | ABX_VERSION=0.4.0 sh
curl -fsSL https://www.agent-sandbox.cn/install.sh | ABX_INSTALL_DIR="$HOME/bin" sh
```

`ABX_VERSION` 可以是 `0.4.0` 或 `v0.4.0`。函数只保留当前完整镜像版本；显式指定较早版本时仍默认从 GitHub 下载。`ABX_DOWNLOAD_BASE` 覆盖产物前缀，布局为 `<base>/v<version>/<asset>`。设置其他 `ABX_REPO`、`ABX_GITHUB_API` 或 `ABX_LATEST_URL` 时保留上游版本解析行为。仅覆盖下载前缀仍使用官网固定版本；需要其他版本时同时设置 `ABX_VERSION`。不支持的系统或 CPU 会直接退出，并写明支持的平台。Windows 请用 PowerShell 安装脚本。

需要直接从 GitHub 下载时，仍可使用上游入口：

```bash
curl -fsSL https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.sh | sh
```

该入口通过 GitHub API 获取最新 Release，失败时使用 `releases/latest` 重定向。官网原始/交付脚本哈希及默认值见[来源记录](https://www.agent-sandbox.cn/install.sh.source.json)。

### Windows（PowerShell）

```powershell
irm https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.ps1 | iex
```

仅 Windows x64。PowerShell 脚本仍托管在 GitHub 并从 GitHub 下载；官网没有提供 `install.ps1` 入口。Windows 二进制及校验文件也可从官网镜像手动下载。脚本检查架构，下载 `abx-<version>-windows-x64.exe` 和对应的 `.sha256`，用 `Get-FileHash -Algorithm SHA256` 校验，把二进制复制到 `%LOCALAPPDATA%\Programs\abx\abx.exe`，并把该目录加入用户 `PATH`。安装前已经打开的终端仍是旧的 `PATH`，请新开一个终端。脚本随后执行 `abx --version`。

Windows 脚本支持 `ABX_VERSION` 和 `ABX_INSTALL_DIR`；默认版本来自 GitHub 最新 Release。

## 手动下载

1. 从[官网镜像清单](https://www.agent-sandbox.cn/releases/latest.json) 确认当前版本和文件名。
2. 从 `https://www.agent-sandbox.cn/releases/download/v<version>/` 下载对应文件及 `.sha256`，例如 macOS Apple Silicon v0.4.0：

   ```bash
   curl -fSLO https://www.agent-sandbox.cn/releases/download/v0.4.0/abx-0.4.0-darwin-arm64
   curl -fSLO https://www.agent-sandbox.cn/releases/download/v0.4.0/abx-0.4.0-darwin-arm64.sha256
   ```

3. 其他版本可从 [GitHub Releases](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases) 下载 `abx-*` 资产及匹配的校验文件。
4. 校验摘要。macOS/Linux 加上可执行权限，再放到 `PATH` 中：

```bash
# macOS
shasum -a 256 -c abx-0.4.0-darwin-arm64.sha256

# Linux
sha256sum -c abx-0.4.0-linux-x64.sha256

chmod +x ./abx-0.4.0-darwin-arm64
mkdir -p ~/.local/bin && mv ./abx-0.4.0-darwin-arm64 ~/.local/bin/abx
```

Windows：

```powershell
Get-FileHash abx-0.4.0-windows-x64.exe -Algorithm SHA256
# 与 .sha256 文件的第一列比对。

$installDir = "$env:LOCALAPPDATA\Programs\abx"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Move-Item abx-0.4.0-windows-x64.exe "$installDir\abx.exe"
```

`certutil -hashfile abx-0.4.0-windows-x64.exe SHA256` 打印同一摘要。

## npm

已发布版本可通过 Node.js20+ 安装：

```bash
npm view @agent-sandbox/cli version --registry=https://registry.npmjs.org
npm install -g @agent-sandbox/cli --registry=https://registry.npmjs.org
abx --version
```

公开索引必须先可读；HTTP404表示发布尚未完成。CI通过、草稿Release或本地打包不代表已上传 npm。如果全局安装目录需要提权，请改用 `--prefix "$HOME/.local"`，并将 `$HOME/.local/bin` 加入 PATH。发布完成前可使用二进制或源码安装。

## 从源码安装

需要 Node.js 20 或更新版本，直接构建并安装当前检出版本：

```bash
git clone https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.git
cd agent-sandbox
git rev-parse HEAD
npm ci
npm run build
npm install --global --prefix "$HOME/.local" .
export PATH="$HOME/.local/bin:$PATH"
abx --version
```

上述步骤直接安装已编译的当前检出版本，不依赖带版本号的归档文件名。

## 验证安装

```bash
abx --version
# abx, version 0.4.0
```

> **macOS Gatekeeper：** Release 二进制只做了 ad-hoc 签名，没有公证。浏览器下载可能带上隔离属性。如果首次启动被拦截：
>
> ```bash
> xattr -d com.apple.quarantine ~/.local/bin/abx
> ```
>
> 存在 `xattr` 时，`install.sh` 会去掉该属性。也可以在 Finder 中右键二进制，选择**打开**一次。

## 二进制与 npm install 对比

| | 独立二进制 | `npm install -g @agent-sandbox/cli` |
|---|---|---|
| 状态 | 当前版本可从官网镜像安装；GitHub 也提供原始产物 | 以公开索引验证为准 |
| 是否需要 Node.js | 否 | 需要（20+） |
| 安装方式 | 官网 `install.sh`、GitHub `install.ps1`，或手动下载镜像/Release 文件 | 包发布之后用 npm |
| 启动速度 | 单个预打包的可执行文件 | 从 `node_modules` 加载编译后的模块 |
| 更新方式 | 重新运行安装脚本 | 发布后 `npm update -g @agent-sandbox/cli` |
| Python SDK（`import agent_sandbox`） | 不包含 | 不包含（[Python source installation](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/install-python.md)，见 [`python-sdk` 仓库](https://github.com/alibaba-agent-sandbox/python-sdk)） |
| 可选扩展（`alicloud`、`mcp` 等） | 无需单独安装 —— 已内置 | 无需单独安装 —— 已内置 |

## 故障排查：abx: command not found

1. **安装目录不在 `PATH` 上。** `install.sh` 安装到 `/usr/local/bin` 或 `$HOME/.local/bin`。目录不在 `PATH` 中时，会打印类似下面的一行：

   ```bash
   export PATH="$HOME/.local/bin:$PATH"
   ```

   把打印出来的那一行写进 `~/.profile`（如果终端读的是 `~/.bashrc` 或 `~/.zshrc`，也写进那个文件）。新开一个终端。用 `command -v abx` 和 `echo "$PATH"` 确认。在 Windows 上，`install.ps1` 把 `%LOCALAPPDATA%\Programs\abx` 加到用户 `PATH`；安装前已经打开的终端仍是旧值。

2. **镜像上的包是另一个程序。** 对 npmmirror 这类镜像执行 `npm install -g @agent-sandbox/cli`，可能装上 `@agent-sandbox/cli@0.2.2`。那个包的 bin 是 `agent-sandbox`，不是 `abx`，所以 shell 仍然报 `abx: command not found`。卸载：

   ```bash
   npm uninstall -g @agent-sandbox/cli
   npm ls -g --depth=0
   command -v agent-sandbox   # 若 0.2.2 留下了可执行文件，这里还能看到
   ```

   卸载之后如果 `command -v` 仍能找到 `agent-sandbox`，从 npm 全局 bin 目录里删掉这个剩余文件。请先按上文 npm 章节核对官方公开索引；也可用二进制安装脚本或[从源码安装](#从源码安装)。

3. **选择的旧 Release 没有 `abx-*` 资产。** v0.2.0 的文件名是 `ebx-*`。`install.sh` 会以 HTTP 404 停止，并且不会留下半截二进制。请从源码安装，或把 `ABX_VERSION` 设成已经发布 `abx-*` 文件的版本。

## GitHub 下载失败

GitHub 下载出现 curl error 92 或 HTTP 000 时， 使用上方 macOS/Linux 官网命令，默认版本、二进制及校验文件均由官网提供。需要默认行为时，移除旧的 `ABX_REPO`、`ABX_GITHUB_API`、`ABX_LATEST_URL` 或 `ABX_DOWNLOAD_BASE` 覆盖。显式指定较早版本以及 Windows PowerShell 入口仍需要 GitHub，除非另行设置下载前缀。

## 说明

- 二进制包含 CLI 及其运行时依赖，包括阿里云模板 API 客户端和 MCP 服务（STDIO 与 Streamable HTTP）。
- 极速版管理操作与官方模板操作在执行时才加载内嵌的阿里云 SDK；独立二进制无需另装 SDK，也不依赖外部 `node_modules`。npm 安装由 npm 解析并安装包声明的运行时依赖。仅 `--version` 成功不能证明 SDK 操作可用，发布验证还需从隔离安装执行一次只读管理请求。
- `abx --licenses` 包含官方 SDK 依赖图随包提供的 LICENSE、README 许可说明及原始包许可声明。依赖更新后，维护者运行 `node scripts/alicloud-sdk-notices.mjs` 重新生成，使用 `--check` 校验。这是补充归属信息，并非完整 CLI SBOM。
- 二进制只提供 `abx` CLI。Python SDK 是单独的包：[Python source installation](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/install-python.md)（[`python-sdk`](https://github.com/alibaba-agent-sandbox/python-sdk)）。

## 自己构建二进制

执行 `npm run build` 后，可用 `make dist-check` 验证 npm 包包含
`dist/bin/abx.js`。检查兼容旧 npm 的数组报告与 npm 12 按包名组织的报告；
缺少入口时仍会失败。

在检出的仓库里，需要 Node.js 20 或更新的官方构建（去掉了 Node SEA fuse 的发行版构建不能用）：

```bash
npm ci
npm run build:binary
```

命令会在当前机器上生成 `dist/binary/abx-<version>-<os>-<arch>`。在 Windows 上文件名以 `.exe` 结尾。正式发布由 GitHub Actions 在 Linux x64、Linux arm64、macOS Apple Silicon、macOS Intel 和 Windows x64 上分别构建，并把文件和对应的 `.sha256` 挂到 GitHub Release。推送版本标签会运行[二进制草稿工作流](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/.github/workflows/release-binary.yml)。版本标签先将五平台二进制构建、校验并上传至草稿Release；所有平台与校验和通过后才公开草稿。公开Release触发[npm工作流](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/.github/workflows/release.yml)，上传前安装实际tarball，上传后再次从公开索引安装。恢复发布时，从 `main` 运行当前 npm 工作流的 workflow_dispatch，并将 `release_tag` 设为已有版本标签（如 `v0.4.0`）。工作流明确检出 `refs/tags/<release_tag>`，拒绝版本不匹配或从功能分支启动恢复，不移动既有源码标签。安装和发布均使用 `./dist-pack/*.tgz`，确保 npm 按本地 tarball 解析路径。

## 后续步骤

- [快速开始](getting-started.md) — 安装、配置与第一个沙箱
- [CLI 教程](cli-tutorial.md) — 完整的 CLI 生命周期操作
- [身份认证](authentication.md) — API Key / AK-SK 配置
- [故障排查](troubleshooting.md) — 常见问题与解决方案

只读排查凭据时，在同一工作流中指定 `release_tag=v0.4.6` 和 `diagnostics_only=true`，发布任务会跳过。诊断任务使用相同的 `npm` 环境和 `NPM_API_TOKEN`，仅报告身份认证、目标命名空间检查的结果，不输出账号名、包列表或索引原始错误。`npm whoami` 成功只证明认证有效，不证明有写入权限；首次发布时，包权限列表缺少该包也不能证明无权发布。应在 npm 设置中核对 token 的包或 scope 写权限、npm 账号的命名空间所有权或组织团队权限，以及无人值守发布的双因素认证要求。单凭发布 E404 无法区分这些原因。更新 secret 后需要启动新运行，保持源码标签不变，并在公开索引完成干净安装验证后才可声明 npm 交付完成。

Npm provenance 要求 `package.json` 的 `repository.url` 与发布仓库**大小写完全一致**。新版本保持 `git+https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.git`。恢复旧标签时，先验证 URL 指向同一仓库（仅忽略大小写），再于依赖安装、测试和打包前校正大小写；指向其他仓库则拒绝继续。这是明确的包元数据转换，不移动源码标签。新生成的 npm tarball 具有独立校验和，安装验收后使用同一个文件带 provenance 发布；不能复用旧 Release tarball 或声称两者字节相同。CI 日志同时记录实际检出的源码提交与发布工作流提交。仍须完成真实 registry 发布及干净安装验证才算 npm 交付成功。

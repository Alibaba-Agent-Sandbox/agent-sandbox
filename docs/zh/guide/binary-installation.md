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
从 [GitHub Releases](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases/tag/v0.5.8) 下载适合当前平台的 CLI **v0.5.8** 及对应 SHA-256 文件。也可[从源码安装](#从源码安装)。

官网已镜像完整稳定版：五个平台的二进制、npm 归档及 SHA-256 文件；大小和校验和验证通过后才部署。[镜像清单](https://www.agent-sandbox.cn/releases/latest.json) 标识当前可下载的版本。GitHub 新版本在镜像部署完成后成为官网默认版本。

---

## 安装

下面指定版本的命令使用 v0.5.8。默认安装脚本跟随官网当前镜像清单，安装后请用 `abx --version` 确认版本。指定版本可使用官方 npm 或 GitHub，也可在安装脚本中显式设置 `ABX_VERSION=0.5.8`。

### macOS 与 Linux

```bash
curl -fsSL https://www.agent-sandbox.cn/install.sh | sh
```

二进制下载在终端 stderr 显示 curl 进度条和百分比，`curl | sh` 同样适用。重定向 stderr 时不显示动态进度，下载错误和校验结果仍会保留。服务器未提供总大小时，curl 显示传输活动而不显示百分比。


脚本是 POSIX `sh`。它识别操作系统和 CPU，包括 Apple Silicon 上的 Rosetta shell（安装原生 `darwin-arm64`）和 `aarch64` Linux（`linux-arm64`）。官网入口设置已完整镜像的版本和官网下载前缀，因此默认安装无需访问 GitHub 查询版本或下载文件。脚本下载二进制和 `.sha256`，用 `sha256sum` 或 `shasum` 校验，并且不需要 `sudo`。

目标目录在 `/usr/local/bin` 可写时用它，否则用 `$HOME/.local/bin`。目录不在 `PATH` 上时，脚本打印需要添加的那一行 `export PATH=...`，然后执行 `abx --version`。

```bash
# 可选
curl -fsSL https://www.agent-sandbox.cn/install.sh | ABX_VERSION=0.5.8 sh
curl -fsSL https://www.agent-sandbox.cn/install.sh | ABX_INSTALL_DIR="$HOME/bin" sh
```

`ABX_VERSION` 可以是 `0.5.8` 或 `v0.5.8`。官网只保留当前完整镜像版本；显式指定较早版本时仍默认从 GitHub 下载。`ABX_DOWNLOAD_BASE` 覆盖产物前缀，布局为 `<base>/v<version>/<asset>`。设置其他 `ABX_REPO`、`ABX_GITHUB_API` 或 `ABX_LATEST_URL` 时保留上游版本解析行为。仅覆盖下载前缀仍使用官网固定版本；需要其他版本时同时设置 `ABX_VERSION`。不支持的系统或 CPU 会直接退出，并写明支持的平台。Windows 请用 PowerShell 安装脚本。

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
2. 当前 0.5.8 从已公开的 GitHub Release 下载文件及 `.sha256`；官网镜像仅提供其清单中的版本。例如 macOS Apple Silicon v0.5.8：

   ```bash
   curl -fSLO https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases/download/v0.5.8/abx-0.5.8-darwin-arm64
   curl -fSLO https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases/download/v0.5.8/abx-0.5.8-darwin-arm64.sha256
   ```

3. 其他版本可从 [GitHub Releases](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases) 下载 `abx-*` 资产及匹配的校验文件。
4. 校验摘要。macOS/Linux 加上可执行权限，再放到 `PATH` 中：

```bash
# macOS
shasum -a 256 -c abx-0.5.8-darwin-arm64.sha256

# Linux
sha256sum -c abx-0.5.8-linux-x64.sha256

chmod +x ./abx-0.5.8-darwin-arm64
mkdir -p ~/.local/bin && mv ./abx-0.5.8-darwin-arm64 ~/.local/bin/abx
```

Windows：

```powershell
Get-FileHash abx-0.5.8-windows-x64.exe -Algorithm SHA256
# 与 .sha256 文件的第一列比对。

$installDir = "$env:LOCALAPPDATA\Programs\abx"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Move-Item abx-0.5.8-windows-x64.exe "$installDir\abx.exe"
```

`certutil -hashfile abx-0.5.8-windows-x64.exe SHA256` 打印同一摘要。

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
# abx, version 0.5.8
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
- 独立二进制无需另装 SDK，也不依赖外部 `node_modules`；通过 npm 安装时，由 npm 安装包声明的依赖。
- 运行 `abx --licenses` 可查看随包依赖的许可及归属说明。
- 二进制只提供 `abx` CLI。Python SDK 是单独的包：[Python source installation](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/install-python.md)（[`python-sdk`](https://github.com/alibaba-agent-sandbox/python-sdk)）。

## 自己构建二进制

在检出的仓库里，需要 Node.js 20 或更新的官方构建（去掉了 Node SEA fuse 的发行版构建不能用）：

```bash
npm ci
npm run build:binary
```

## 后续步骤

- [快速开始](getting-started.md) — 安装、配置与第一个沙箱
- [CLI 教程](cli-tutorial.md) — 完整的 CLI 生命周期操作
- [身份认证](authentication.md) — API Key / AK-SK 配置
- [故障排查](troubleshooting.md) — 常见问题与解决方案

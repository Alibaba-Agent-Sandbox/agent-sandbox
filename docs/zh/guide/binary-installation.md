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
**v0.3.0** 已提供五个平台的 `abx-*` 二进制及对应 SHA-256 文件。旧 v0.2.0 使用 `ebx-*`，本安装脚本不消费旧文件名。也可[从源码安装](#从源码安装)。

网站以后可以把同一份脚本放在自己的域名上（例如 `https://www.agent-sandbox.cn/install.sh` 和 `https://www.agent-sandbox.cn/install.ps1`）。命令仍然是一行，只改 URL。

---

## 安装

发布二进制的本次检查覆盖校验和与版本。当前 `[Unreleased]` 修复在配套版本发布前使用源码构建方式；仅看到版本0.3.0不能证明已包含之后的源码变化。

### macOS 与 Linux

```bash
curl -fsSL https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.sh | sh
```

脚本是 POSIX `sh`。它识别操作系统和 CPU，包括 Apple Silicon 上的 Rosetta shell（安装原生 `darwin-arm64`）和 `aarch64` Linux（`linux-arm64`）。默认版本来自 GitHub API 的最新 Release；API 失败时改用 `releases/latest` 的重定向。脚本下载二进制和 `.sha256`，用 `sha256sum` 或 `shasum` 校验，并且不需要 `sudo`。

目标目录在 `/usr/local/bin` 可写时用它，否则用 `$HOME/.local/bin`。目录不在 `PATH` 上时，脚本打印需要添加的那一行 `export PATH=...`，然后执行 `abx --version`。

```bash
# 可选
ABX_VERSION=0.3.0 curl -fsSL https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.sh | sh
ABX_INSTALL_DIR="$HOME/bin" curl -fsSL https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.sh | sh
```

`ABX_VERSION` 可以是 `0.3.0` 或 `v0.3.0`。不支持的系统或 CPU 会直接退出，并写明支持的平台。Windows 请用 PowerShell 安装脚本。

### Windows（PowerShell）

```powershell
irm https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.ps1 | iex
```

仅 Windows x64。脚本检查架构，下载 `abx-<version>-windows-x64.exe` 和对应的 `.sha256`，用 `Get-FileHash -Algorithm SHA256` 校验，把二进制复制到 `%LOCALAPPDATA%\Programs\abx\abx.exe`，并把该目录加入用户 `PATH`。安装前已经打开的终端仍是旧的 `PATH`，请新开一个终端。脚本随后执行 `abx --version`。

`ABX_VERSION` 和 `ABX_INSTALL_DIR` 与 `install.sh` 相同。

## 手动下载

1. 打开 [GitHub Releases](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/releases)。
2. 选择资产名为 `abx-*` 的版本（通常是最新的）。
3. 按下表下载对应平台的文件，以及匹配的 `.sha256`。
4. 校验摘要。macOS/Linux 加上可执行权限，再放到 `PATH` 中：

```bash
# macOS
shasum -a 256 -c abx-0.3.0-darwin-arm64.sha256

# Linux
sha256sum -c abx-0.3.0-linux-x64.sha256

chmod +x ./abx-0.3.0-darwin-arm64
mkdir -p ~/.local/bin && mv ./abx-0.3.0-darwin-arm64 ~/.local/bin/abx
```

Windows：

```powershell
Get-FileHash abx-0.3.0-windows-x64.exe -Algorithm SHA256
# 与 .sha256 文件的第一列比对。

$installDir = "$env:LOCALAPPDATA\Programs\abx"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Move-Item abx-0.3.0-windows-x64.exe "$installDir\abx.exe"
```

`certutil -hashfile abx-0.3.0-windows-x64.exe SHA256` 打印同一摘要。

## npm（即将提供）

`npm install -g @agent-sandbox/cli` **即将提供，包尚未发布**。当前清单中的包名是 `@agent-sandbox/cli`。不要把它当作当前的安装方式。

部分 npm 镜像（包括 npmmirror）上有一个同名但无关的 `@agent-sandbox/cli@0.2.2`。它的 bin 是 `agent-sandbox`，不是 `abx`。装上它也不会出现 `abx` 命令。见 [故障排查：abx: command not found](#故障排查abx-command-not-found)。

## 从源码安装

需要 Node.js 20 或更新版本。2026-10-15 在 Linux x64、Node.js 22.14.0 上验证过：`npm pack` 生成 `agent-sandbox-cli-0.3.0.tgz`，`npm install -g` 安装该 tarball 后执行 `abx --version`，输出为 `abx, version 0.3.0`。

```bash
git clone https://github.com/Alibaba-Agent-Sandbox/agent-sandbox.git
cd agent-sandbox
git rev-parse HEAD
npm ci
npm run build
npm pack
npm install -g ./agent-sandbox-cli-<version>.tgz
abx --version
```

`npm pack` 的文件名是 `agent-sandbox-cli-<version>.tgz`（当前树是 `agent-sandbox-cli-0.3.0.tgz`）。

## 验证安装

```bash
abx --version
# abx, version 0.3.0
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
| 状态 | 使用上面的安装脚本；需要名为 `abx-*` 的 GitHub Release（v0.3.0 资产已提供） | 即将提供，包尚未发布 |
| 是否需要 Node.js | 否 | 需要（20+） |
| 安装方式 | `install.sh` / `install.ps1`，或从 Releases 下载单个文件 | 包发布之后用 npm |
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

   卸载之后如果 `command -v` 仍能找到 `agent-sandbox`，从 npm 全局 bin 目录里删掉这个剩余文件。本 CLI 的 npm 包还没有发布；请用二进制安装脚本或[从源码安装](#从源码安装)。

3. **选择的旧 Release 没有 `abx-*` 资产。** v0.2.0 的文件名是 `ebx-*`。`install.sh` 会以 HTTP 404 停止，并且不会留下半截二进制。请从源码安装，或把 `ABX_VERSION` 设成已经发布 `abx-*` 文件的版本。

## 说明

- 二进制包含 CLI 及其运行时依赖，包括阿里云模板 API 客户端和 MCP 服务（STDIO 与 Streamable HTTP）。
- 二进制只提供 `abx` CLI。Python SDK 是单独的包：[Python source installation](https://github.com/Alibaba-Agent-Sandbox/python-sdk/blob/main/docs/en/guide/install-python.md)（[`python-sdk`](https://github.com/alibaba-agent-sandbox/python-sdk)）。

## 自己构建二进制

在检出的仓库里，需要 Node.js 20 或更新的官方构建（去掉了 Node SEA fuse 的发行版构建不能用）：

```bash
npm ci
npm run build:binary
```

命令会在当前机器上生成 `dist/binary/abx-<version>-<os>-<arch>`。在 Windows 上文件名以 `.exe` 结尾。正式发布由 GitHub Actions 在 Linux x64、Linux arm64、macOS Apple Silicon、macOS Intel 和 Windows x64 上分别构建，并把文件和对应的 `.sha256` 挂到 GitHub Release。发布 Release 会运行 [`.github/workflows/release-binary.yml`](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/.github/workflows/release-binary.yml)。推送 `v*` tag 还会运行 [`.github/workflows/release.yml`](https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/blob/main/.github/workflows/release.yml)；只有仓库变量 `NPM_PUBLISH` 为 `true` 时才会发布到 npm。

## 后续步骤

- [快速开始](getting-started.md) — 安装、配置与第一个沙箱
- [CLI 教程](cli-tutorial.md) — 完整的 CLI 生命周期操作
- [身份认证](authentication.md) — API Key / AK-SK 配置
- [故障排查](troubleshooting.md) — 常见问题与解决方案

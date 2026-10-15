# 二进制安装

`abx` 同时以**预编译独立二进制**的形式发布 —— 单个可执行文件内嵌了
Node.js 运行时、Agent Sandbox CLI 以及其全部依赖。**无需安装
Node.js 环境。**

二进制文件随每个版本发布在
[GitHub Releases](https://github.com/alibaba-agent-sandbox/agent-sandbox/releases)：

| 平台 | 文件 |
|------|------|
| Linux (x64) | `abx-{version}-linux-x64` |
| Linux (arm64) | `abx-{version}-linux-arm64` |
| macOS (Apple Silicon) | `abx-{version}-darwin-arm64` |
| macOS (Intel) | `abx-{version}-darwin-x64` |
| Windows (x64) | `abx-{version}-windows-x64.exe` |

---

## 快速安装

### macOS / Linux（curl）

```bash
# 设置要安装的版本
VERSION=0.3.0

# 自动检测平台
OS=$(uname -s | tr '[:upper:]' '[:lower:]')   # darwin 或 linux
ARCH=$(uname -m); case "$ARCH" in
  x86_64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
esac

# 先下载到当前用户可写的目录，再安装到 PATH 上。
curl -fsSL -o "$HOME/abx" \
  "https://github.com/alibaba-agent-sandbox/agent-sandbox/releases/download/v${VERSION}/abx-${VERSION}-${OS}-${ARCH}"
chmod +x "$HOME/abx"
sudo mv "$HOME/abx" /usr/local/bin/abx
```

> 直接写入 `/usr/local/bin` 会因没有权限而失败（`curl: (56) Failure writing
> output to destination`），文件也不会留下来。先下到 `$HOME`，再用
> `sudo mv` 放到默认 `PATH` 上。

### Windows（PowerShell）

```powershell
$VERSION = "0.3.0"
$asset = "abx-$VERSION-windows-x64.exe"

# 下载 Release 资产
Invoke-WebRequest `
  -Uri "https://github.com/alibaba-agent-sandbox/agent-sandbox/releases/download/v$VERSION/$asset" `
  -OutFile $asset

# 移动到 PATH 中的目录（不存在则先创建）
$installDir = "$env:LOCALAPPDATA\Programs\abx"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Move-Item $asset "$installDir\abx.exe"
```

> 如果 `$installDir` 尚不在 `PATH` 中，请通过
> *设置 → 系统 → 关于 → 高级系统设置 → 环境变量* 添加，
> 然后重新打开终端。

## 手动下载

1. 打开 [GitHub Releases](https://github.com/alibaba-agent-sandbox/agent-sandbox/releases) 页面。
2. 选择目标版本（通常是最新的）。
3. 按上表选择匹配当前平台的资产下载。
4. 添加可执行权限（仅 macOS/Linux）并放到 `PATH` 中：

```bash
chmod +x ./abx-0.3.0-darwin-arm64
mkdir -p ~/.local/bin && mv ./abx-0.3.0-darwin-arm64 ~/.local/bin/abx
```

## 校验 SHA256

每个 Release 资产都附带 `*.sha256` 校验文件。下载后请校验二进制文件的完整性：

```bash
# macOS
shasum -a 256 -c abx-0.3.0-darwin-arm64.sha256

# Linux
sha256sum -c abx-0.3.0-linux-x64.sha256
```

Windows（`certutil`）：

```powershell
# 将打印出的摘要与 .sha256 文件中的内容进行比对
certutil -hashfile abx-0.3.0-windows-x64.exe SHA256

# 或使用 PowerShell：
Get-FileHash abx-0.3.0-windows-x64.exe -Algorithm SHA256
```

## 验证安装

```bash
abx --version
# abx, version 0.3.0
```

> **macOS Gatekeeper 提示：** 二进制文件未做代码签名，首次运行可能被
> Gatekeeper 拦截。如遇到该情况，先移除隔离属性再运行：
>
> ```bash
> sudo xattr -d com.apple.quarantine /usr/local/bin/abx
> ```
>
> 也可以在 Finder 中右键点击二进制文件，选择**打开**一次即可放行。

## 二进制与 npm install 对比

| | 独立二进制 | `npm install -g @agent-sandbox/cli` |
|---|---|---|
| 是否需要 Node.js | 否 | 需要（20+） |
| 安装方式 | 下载单个文件 | npm 或任意 Node.js 包管理器 |
| 启动速度 | 单个预打包的可执行文件 | 从 `node_modules` 加载编译后的模块 |
| 更新方式 | 从 Releases 重新下载 | `npm update -g @agent-sandbox/cli` |
| Python SDK（`import agent_sandbox`） | 不包含 | 不包含（`pip install agent-sandbox-client`，见 [`python-sdk` 仓库](https://github.com/alibaba-agent-sandbox/python-sdk)） |
| 可选扩展（`alicloud`、`mcp` 等） | 无需单独安装 —— 已内置 | 无需单独安装 —— 已内置 |

## 说明与限制

- 二进制文件捆绑了完整的 CLI **以及**其全部运行时依赖，包括阿里云模板 API
  客户端和 MCP 服务（STDIO 与 Streamable HTTP），没有需要另行安装的可选
  extras。如果更希望通过包管理器管理 CLI，请改用 npm 安装：

  ```bash
  npm install -g @agent-sandbox/cli
  ```

- 二进制仅提供 `abx` CLI。如需使用 Python SDK
  （`from agent_sandbox.api.sandbox import Sandbox`），请通过 pip 安装 Python 包
  （`pip install agent-sandbox-client`）。
  `pip install agent-sandbox` 会安装一个无关的项目。

---

## 自己构建二进制

在检出的仓库里，需要 Node.js 20 或更新版本：

```bash
npm ci
npm run build:binary
```

命令会在当前机器上生成 `dist/binary/abx-<version>-<os>-<arch>`。在 Windows 上文件名以 `.exe` 结尾。正式发布由 GitHub Actions 在 Linux x64、Linux arm64、macOS Apple Silicon、macOS Intel 和 Windows x64 上分别构建，并把文件和对应的 `.sha256` 挂到 GitHub Release。

## 后续步骤

- [快速开始](getting-started.md) — 安装、配置与第一个沙箱
- [CLI 教程](cli-tutorial.md) — 完整的 CLI 生命周期操作
- [身份认证](authentication.md) — API Key / AK-SK 配置
- [故障排查](troubleshooting.md) — 常见问题与解决方案

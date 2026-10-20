# 快速入门

本教程将带你完成从安装到销毁的完整沙箱生命周期。

---

## 前置条件

- 只有从源码安装才需要 Node.js 20 或更高版本。二进制安装脚本不需要 Node.js。
- 默认提供方是 `alicloud-express`。API Key 从[智能体沙箱产品文档](https://help.aliyun.com/zh/functioncompute/product-overview-of-fc-agent-sandbox)获取。变量名是 `ABX_SANDBOX_API_KEY`。AccessKey 是 `ALICLOUD_ACCESS_KEY_ID` 和 `ALICLOUD_ACCESS_KEY_SECRET`。原生 provider/MCP 配置使用 `ABX_SANDBOX_*` 名称。标准极速版入口还接受 `E2B_API_KEY`、`E2B_API_URL`、`E2B_DOMAIN`；见[迁移指南](migrate-from-e2b.md)。不读取 `AccessKey`、`AccessSecret`。
- 网络可访问阿里云杭州区域（默认 `cn-hangzhou`）

## 1. 安装

macOS 与 Linux：

```bash
curl -fsSL https://www.agent-sandbox.cn/install.sh | sh
abx --version
```

Windows（PowerShell）：

```powershell
irm https://raw.githubusercontent.com/Alibaba-Agent-Sandbox/agent-sandbox/main/install.ps1 | iex
abx --version
```

npm 安装需要 Node.js20+。先执行 `npm view @agent-sandbox/cli version --registry=https://registry.npmjs.org`，公开索引能解析版本后，使用 `npm install -g @agent-sandbox/cli --registry=https://registry.npmjs.org` 安装。从源码安装（`git clone`、`npm ci`、`npm run build`、`npm pack`、`npm install -g ./agent-sandbox-cli-<version>.tgz`）、手动下载，以及 `abx: command not found`，见[二进制安装](binary-installation.md)。v0.2.0 的 Release 资产名是 `ebx-*`；安装脚本使用 `abx-*`，使用已提供资产的 v0.4.0 Release。

## 2. 配置 API Key

有两种方式配置认证凭证。真正生效时按下面的优先级（从高到低）。完整的凭证表见 [配置参考 — 凭证解析](../reference/configuration.md#凭证解析)。

### 方式一：环境变量（推荐用于 CI/CD）

```bash
export ABX_SANDBOX_API_KEY="your-api-key-here"
```

### 方式二：`abx config set`（推荐用于本地开发）

环境变量和项目 `.env` 都没写这个键时，才用这里保存的值。

```bash
abx config set sandbox_api_key your-api-key
# 写入到 ~/.abx/.env（权限 600）
```

验证配置状态：

```bash
abx config get sandbox_api_key
```

## 3. 创建第一个 Sandbox

### 使用 CLI

```bash
abx create base --detach
```

`base` 是默认模板。仓库 README 里的 `python-base` 是目录中的 Python 镜像。

## 4. 执行代码

### CLI

```bash
abx exec <sandbox-id> "echo 'Hello from sandbox'"
```

## 5. 运行 Shell 命令

### CLI

```bash
abx exec <sandbox-id> sh -c "pip install requests && python -c 'import requests; print(requests.__version__)'"
```

## 6. 文件操作

### CLI 上传/下载

```bash
# 上传
abx upload <sandbox-id> ./data.csv /home/user/data.csv

# 下载
abx download <sandbox-id> /home/user/result.csv ./result.csv
```

## 7. 列出目录内容

```bash
abx sandbox files list <sandbox-id> --path /home/user
```

## 8. 销毁 Sandbox

### CLI

```bash
abx kill <sandbox-id>

# 销毁所有运行中的沙箱
abx kill --all
```

## 9. 完整示例

```bash
# 创建沙箱并上传项目
abx create base --detach
abx upload <sandbox-id> ./project /home/user/project

# 在沙箱内运行
abx exec <sandbox-id> "python /home/user/project/main.py"

# 取回结果并销毁沙箱
abx download <sandbox-id> /home/user/result.csv ./result.csv
abx kill <sandbox-id>
```

---

## 下一步

- [认证详解](authentication.md) — 多种认证方式与配置优先级
- [CLI 教程](cli-tutorial.md) — 命令行完整生命周期操作
- [使用模板](using-templates.md) — 按模板创建沙箱
- [错误码参考](../reference/error-codes.md) — 错误排查
- [故障排查](troubleshooting.md) — 常见问题与解决方案

## 相关 SDK 文档

如需使用 Python SDK（替代或配合 CLI）：见 `python-sdk` 仓库的[快速开始（SDK）](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/getting-started.md)与 [SDK 使用指南](https://github.com/alibaba-agent-sandbox/python-sdk/blob/main/docs/zh/guide/sdk-usage.md)。

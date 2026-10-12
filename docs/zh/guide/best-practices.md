# 最佳实践

该用哪个开关。命令写法在 [CLI 参考](../reference/cli-reference.md) 和[操作指南](operations.md)。

## `--provider`：这一条命令用哪个后端

只在这一次调用要走插件、或要走当前默认以外的后端时，加上 `--provider <id>`。它可以出现在任意位置（`ebx create --provider my-cloud --template base`）。

每条命令都用内置的 `alicloud-express` 时，不要加这个旗标。那是默认值，沙箱 id 保持裸 id。整个 shell 都要换后端时，用 `ebx provider default <id>` 或 `EBX_PROVIDER` 设成持久默认。沙箱 id 已经带已知提供者前缀（`my-cloud:sbx-1`）时，它自己就选中了那个提供者；`--provider` 必须写同一个 id。

一次命令的提供者选项是 `--opt KEY=VALUE`。清单里标了 `secret` 的字段不能出现在命令行上。用 `ebx config set providers.<id>.<key>` 保存，提示时会掩码。

完整顺序和安装步骤见[提供商](providers.md)。编写插件见[编写提供商](authoring-providers.md)。

## `--model`：这一次生成用哪个模型 id

`--model <id>` 只出现在让编码代理写模板的命令上：

- `ebx create "<描述>" --model <id>`
- `ebx template init "<描述>" --model <id>`
- `ebx template init --adopt <目录> --model <id>`

它只覆盖这一次命令的 `llm_model`、`EBX_LLM_MODEL` 和 `OPENAI_MODEL`。端点拒绝了已保存的模型，或这一句描述要用另一个 id 起草时，用它。交互终端可以给出替换项并保存选择；非交互运行沿用你传入的旗标。

`--model` 不选择沙箱里运行的程序。`ebx exec`、`ebx run` 和 `ebx sandbox` 不看它。

## `llm_model`：每次生成都用的模型

`llm_model` 是起草模板所用模型的保存名。默认是 `qwen3-coder-plus`。

```bash
ebx config set llm_model qwen3-coder-plus
```

只在当前 shell 里改，就导出 `EBX_LLM_MODEL`（未设置时再看 `OPENAI_MODEL`）。进程环境变量优先于 `./.env`，`./.env` 优先于 `ebx config set` 保存的值。`ebx config list` 会显示是哪一层生效。这个键、基址和模型名是 LLM 配置，与沙箱 API key 分开。

## 凭证

| 你在调用什么 | 存成什么 | 命令 |
|---|---|---|
| 沙箱控制面 | `sandbox_api_key`（`EBX_SANDBOX_API_KEY`，也可 `E2B_API_KEY`） | `ebx config set sandbox_api_key` |
| 模板构建与部署（AccessKey） | `access_key_id`、`access_key_secret` | `ebx config set access_key_id` 和 `access_key_secret` |
| 自然语言生成模板 | `llm_api_key`（`EBX_LLM_API_KEY`，然后是百炼、DashScope、OpenAI 的名字） | `ebx config set llm_api_key` |
| 提供者插件的密钥 | `~/.ebx/.env` 里的 `providers.<id>.<key>` | `ebx config set providers.<id>.<key>` |
| 从 GitHub 下载模板 | `github_token` | `ebx config set github_token` |

`ebx config init` 会依次问平台 key、区域、LLM key、ACR 命名空间和 AccessKey。密钥类的键省略值时，提示会掩码。`ebx config list` 打印来源并掩码密钥。对密钥执行 `ebx config get` 打印的是掩码，不是值。

解析顺序和名称别名见[配置参考](../reference/configuration.md#凭证解析)和[认证配置](authentication.md)。

## 独立二进制

机器上不该依赖 Node.js 时，安装单文件 `ebx` 二进制：CI 镜像、代理宿主机，或从 GitHub Release 资产复制一份。二进制里已经带上 Node 运行时和 CLI。[操作指南](operations.md)里的命令完全相同。

机器上已经有 Node.js 20 或更新版本，并且要从注册表拿包时，用 npm（`npm install -g @easy-sandbox/cli`）或 `npx @easy-sandbox/cli`。

校验和、平台和安装命令见[二进制安装](binary-installation.md)。

# Provider 端到端测试方案

[English](PLAN.md)

所有 provider，包括 OpenSandbox，都用同一套分级。跑不了的层级记为 skip 并写明原因，不算通过。

`cli/e2e`、`python-sdk/e2e` 和 [awesome-providers](https://github.com/alibaba-agent-sandbox/awesome-providers) 用的是同一张表。

| 层级 | 证明什么 | 命令 | 需要 |
|---|---|---|---|
| T0 | 插件自己的单元测试和 mock 测试 | 在插件目录里执行 `node tests/run.mjs` | Node >= 20 |
| T1 | 安装、同意、固定版本、篡改检测、doctor、卸载。不创建沙箱 | `cli/e2e/providers/run.sh offline` 和 `python-sdk/e2e/opensandbox/provider_install_e2e.py` | git、Node、`PYTHONPATH` 上的 SDK |
| T2 | 不需要云的 provider：用 `abx` 完成创建、执行、文件、销毁 | `cli/e2e/providers/run.sh local-process` | Python 3 |
| T3 | 用户实际输入的目录写法：`owner/repo//subdir` | `cli/e2e/providers/run.sh catalog` | git 和 GitHub |
| T4 | 真实的 OpenSandbox 服务：CLI 往返，以及 SDK 的 `Sandbox.create(provider="opensandbox")` | `local-up.sh up`，然后 `run.sh opensandbox` 和 `provider_e2e.py` | Docker，本机 8080 端口上的服务 |
| T5 | 内置阿里云 provider 在真实平台上 | `cli/` 里 `npm run e2e`，`python-sdk/` 里 `make e2e` | 云凭证 |

T0 到 T3 不需要云账号。T4 不需要阿里云。T5 不安装第三方插件。

四个目录提供方（`opensandbox`、`e2b`、`cubesandbox`、`alicloud-container`）都是 `runtime.kind = "node"`（`provider.mjs`，`create(kit)`）。`run.sh catalog` 和 `run.sh opensandbox` 安装这份检出，并用 `abx` 驱动。`local-process` 是用 Python 写的 `exec` 示例。`e2b-compatible` 是一份 `rest` 清单。这两个示例不是目录插件。

## 规则

- 每次运行使用一次性的 `HOME`。不读写真实的 `~/.abx`。
- 密钥只传给子进程，不打印。`provider config list` 的输出里不能出现 API key。
- 缺少的能力应当是一次成功的 `E8004`，不是崩溃，也不是把断言跳过。
- `abx create "一句话"` 不是 provider 测试。它会先走内置的模板流程。provider 测试使用 `abx --provider <id> create --template <镜像或名称>`。
- 清理只销毁这次运行创建的沙箱，不用 `kill --all`。
- OpenSandbox 的插件源是目录仓库的检出（`ABX_AWESOME_PROVIDERS` 或一次 clone），不是 SDK 里的一份拷贝。

## 新 provider 要补什么

1. 在自己的目录里做 T0。
2. README 里写明：能用、部分可用、返回 E8004。
3. 用安装这个目录来做 T1。
4. 只有这个 provider 真正调用的后端才做 T4 或 T5。

## 命令

```bash
# T0
cd opensandbox && node tests/run.mjs

# T1–T4，在 cli/ 里
e2e/providers/run.sh offline catalog local-process
ABX_AWESOME_PROVIDERS=/path/to/awesome-providers e2e/providers/run.sh opensandbox

# T4，在 python-sdk/e2e/opensandbox/ 里
./local-up.sh up && eval "$(./local-up.sh env)"
ABX_AWESOME_PROVIDERS=/path/to/awesome-providers python3 provider_e2e.py
python3 provider_install_e2e.py
```

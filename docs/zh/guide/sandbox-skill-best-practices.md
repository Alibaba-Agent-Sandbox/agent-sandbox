# 用 Agent Sandbox Skill 运行后台任务

通过 Skill，让 Agent 上传输入文件、在沙箱中执行任务、取回结果并清理环境。CLI 或 MCP 工具负责执行，所选 Provider 决定可用的操作。

## 安装和连接

按 [Skill 安装指南](agent-skill-installation.md)安装同一版本的 `SKILL.md` 和完整 `references/` 目录。随后安装 CLI，按[认证指南](authentication.md)配置凭据，并为 Agent 连接 MCP。查看已安装 CLI 的 `--help` 或 MCP `tools/list`，确认可用命令和参数。

选择包含任务所需工具的现成模板。下面的例子需要带 Python 3 的 Linux 模板。凭据从本机配置或环境变量加载，不写进任务提示和输出文件。

## 示例：汇总订单文件

将以下输入保存为 `orders.csv`：

```csv
qty,unit_price
2,10.00
1,5.50
3,2.00
```

向 Agent 提出任务：

> 将这份订单文件和 Python 脚本上传到沙箱，用 Decimal 计算行数、数量合计和金额合计。以后台任务运行，保存沙箱 ID 和任务 ID；重新连接后下载 result.json，最后删除你创建的沙箱。

脚本可以使用：

```python
import csv
import json
from decimal import Decimal
from pathlib import Path

with Path("/tmp/orders.csv").open(newline="") as source:
    rows = list(csv.DictReader(source))
result = {
    "row_count": len(rows),
    "total_amount": str(sum(
        (int(row["qty"]) * Decimal(row["unit_price"]) for row in rows),
        Decimal("0.00"),
    )),
    "total_qty": sum(int(row["qty"]) for row in rows),
}
Path("/tmp/result.json").write_text(json.dumps(result) + "\n")
```

下载的 JSON 应包含以下值：

```json
{"row_count":3,"total_amount":"31.50","total_qty":6}
```

报告结果前，检查实际下载的文件。任务提交成功只表示任务已经启动。

## 通过 MCP 运行和重连

1. 用 `get_capabilities` 查看所选 Provider 声明的操作。调用 `create_sandbox`，传入现成模板和合适的 `timeout`，保存返回的沙箱 ID。`get_sandbox` 读取元数据，`verify_sandbox` 检查命令执行和文件传输。
2. 用 `upload_file` 将 CSV 和脚本分别上传到 `/tmp/orders.csv` 和 `/tmp/summarize_orders.py`。传入 `sandbox_id`、`path`、规范 base64 编码的 `content_base64`，以及对应的 `sha256`。工具会读回远端文件，检查传输结果。
3. 调用 `start_task`，传入 `sandbox_id` 和 `command: "python3 /tmp/summarize_orders.py"`，保存返回的 `task_id`。这会保留沙箱，使其在 MCP 断连后继续存在。
4. 重连后，用原 `sandbox_id` 和 `task_id` 调用 `get_task`，不要重新提交同一任务。若提交失败且结果不确定，先检查原沙箱，再决定是否重试。
5. 任务进入 `succeeded` 后，用 `download_file` 下载 `/tmp/result.json`。将 `content_base64` 解码保存到本机，比较文件大小和 SHA-256，再核对上面的 JSON 值。任务处于 `failed` 时，检查返回的错误、退出状态和可用日志。
6. 取回结果后，用你创建的 ID 调用 `kill_sandbox`。若删除失败，说明失败情况，保留同一资源 ID 以便重试。

## 任务和文件传输限制

后台任务工具需要沙箱内的 Linux、`sh`、`python3`、`nohup`、`base64` 和 `/proc`。状态和日志会在客户端断连后保留，但沙箱到期或删除后便会丢失。`get_task` 只返回有限大小的日志尾部；排查大量输出时，检查日志截断字段。

取消任务时，向 `cancel_task` 传入沙箱和任务 ID，再轮询 `get_task` 直到终态，并检查实际工作已停止。`running`、`cancelling`、`unknown` 都不是完成。取消操作向原 Linux 进程组发送 SIGTERM；忽略 SIGTERM 的进程可能持续处于 `cancelling`，主动使用 `setsid` 或 daemonize 的进程可能离开受管理的进程组。

MCP 下载上限为 1 MiB。更大的文件使用 CLI，并比较本机与远端哈希：

```bash
abx download SANDBOX_ID /tmp/result.json ./result.json
```

## 明确资源归属和清理

只有 MCP 会话创建且未显式保留的临时沙箱，才会在正常关闭时自动删除。连接的用户已有沙箱属于借用资源，会继续保留。`start_task` 或 `retain_sandbox` 会保留本次创建的沙箱，直到平台到期或显式删除；关闭保留选项不会取得借用资源的清理所有权。

查询不会延长沙箱寿命。需要更多时间时，调用 `set_sandbox_timeout` 并检查返回的元数据。Provider 未返回寿命信息时，实际值仍保持未知。只删除本任务创建或用户明确指定的资源，分别说明任务结果和清理结果。

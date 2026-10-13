# Accessibility

**English** | [中文](#中文)

Easy Sandbox's command-line interface (`ebx`) is a terminal program. There is no graphical window in this repository. We treat plain text as the interface: every result that matters is available without color, without a mouse, and without watching an animation.

## Commitment

- Status, errors, and identifiers are written as text, not conveyed by color alone.
- Interactive prompts can be skipped with `--yes` so a session that cannot answer prompts still has a path.
- Machine-readable output is available with `--json`. Compact text output is available with `--quiet`.
- A report of a barrier is a product bug. We will answer it in the issue tracker.

## Supported environments

| Environment | What we support |
|---|---|
| Operating systems | Linux, macOS, and Windows |
| Runtime | Node.js 20 or newer, or the standalone `ebx` binary for that OS and CPU |
| Terminals | Windows Terminal, macOS Terminal, iTerm, GNOME Terminal, and other terminals that speak a common ANSI terminal |
| Screen readers | NVDA, JAWS, VoiceOver, and Orca, when they read the terminal's text buffer |
| Automation | `--json`, `--quiet`, and `--ci` for scripts and continuous integration |

Set `NO_COLOR` or pass `--no-color` to turn ANSI color off. `TERM=dumb`, `--json`, `--quiet`, and `--ci` also turn off the redrawn progress block.

`--quiet` prints tables as tab-separated text. `--json` prints one JSON document. Both are easier for a screen reader and for a program than a drawn table.

## Known limitations

- The progress header (`message... 12s`) and the grey lines under it are redrawn in place. A screen reader may not announce each update, and the grey color (`bright_black`) is dim. Pass `--quiet` or `--json` when you need a stable transcript. The grey lines are omitted in those modes.
- Success and failure are also marked with symbols in some human-readable lines. The words and the exit code remain the authoritative result. Exit code `0` is success. Non-zero codes are listed in the [error codes](docs/en/reference/error-codes.md).
- Wide characters (Chinese, Japanese, Korean) are counted as two columns when a line is cut to the terminal width. A screen reader still receives the characters; only the visual cut changes.
- This repository does not ship a web application. Browser accessibility of a program you run *inside* a sandbox is that program's own responsibility.
- The hosted HTTP API returns JSON. It does not return a rendered page.

## How to report a barrier

Open a documentation or bug issue:

https://github.com/Easy-Sandbox/easy-sandbox/issues/new/choose

Include:

- the command you ran, with secrets removed
- the flag you used (`--no-color`, `--quiet`, `--json`, or none)
- your OS, terminal, and screen reader, including versions
- what you expected to hear or read, and what happened instead

If you cannot use the issue form, email is not a separate channel. The issue tracker is the supported place.

## 中文

`ebx` 是终端程序，这个仓库里没有图形窗口。需要传达的结果都有纯文本形式，不依赖颜色、鼠标或动画。

我们承诺：

- 状态、错误和标识都写成文字，不只靠颜色区分。
- 不能回答交互提问时，可以用 `--yes` 跳过提问。
- `--json` 输出机器可读结果，`--quiet` 输出紧凑文本。
- 无障碍障碍视为产品缺陷，在议题里回复。

支持的环境：Linux、macOS、Windows；Node.js 20 及以上，或对应系统的独立二进制；Windows Terminal、macOS 终端、iTerm、GNOME Terminal 等常见终端；NVDA、JAWS、VoiceOver、Orca（在它们能读到终端文字缓冲区时）。

设置 `NO_COLOR` 或加上 `--no-color` 会关闭 ANSI 颜色。`TERM=dumb`、`--json`、`--quiet`、`--ci` 也会关掉原地重绘的进度块。`--quiet` 把表格打成制表符分隔的文本，`--json` 打成一份 JSON。

已知限制：

- `message... 12s` 标题和下面的灰色行会在原地重绘。读屏软件可能不会逐次朗读，灰色（`bright_black`）也偏暗。需要稳定记录时用 `--quiet` 或 `--json`，这两种模式不画灰色行。
- 有的人类可读行会带符号。以文字和退出码为准。退出码 `0` 表示成功，其它退出码见[错误码](docs/zh/reference/error-codes.md)。
- 中日韩字符在按终端宽度截断时按两列计算。读屏读到的仍是这些字符，变的只是画面上的截断。
- 本仓库不提供网页。沙箱里运行的程序，其网页无障碍由该程序自己负责。
- 托管的 HTTP API 返回 JSON，不返回渲染后的页面。

报告障碍：打开 https://github.com/Easy-Sandbox/easy-sandbox/issues/new/choose 。写上你运行的命令（去掉密钥）、用了哪个标志、操作系统、终端和读屏软件及版本，以及你期望读到或听到的内容和实际发生的事。议题跟踪器是受理渠道。

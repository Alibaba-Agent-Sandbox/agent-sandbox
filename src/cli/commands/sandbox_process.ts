/** Sandbox process-inspection CLI commands: list, info, signal (port of `cli/commands/sandbox_process.py`). */

import type { Sandbox } from "../../api/sandbox.js";
import type { ProcessResult } from "../../models/process.js";
import { PY_WHITESPACE } from "../../utils/_py.js";
import { pyStrip, pySplitlines } from "../../utils/_pyformat.js";
import { argument, command, group, option } from "../kit.js";
import { INT } from "../types.js";
import { sysExit } from "../errors.js";
import { getFormatter } from "../formatters.js";
import { handleErrors } from "../error_handler.js";

/** Connect to a sandbox by ID. */
export async function _connectSandbox(sandbox_id: string): Promise<Sandbox> {
  // Imported lazily like the Python helper: the SDK loggers must be created after the CLI's logging bridge is
  // installed by the root group callback, otherwise `--verbose` cannot lower the package logger level.
  const { Sandbox } = await import("../../api/sandbox.js");
  return Sandbox.connect(sandbox_id);
}

/** Python `str.split(None, maxsplit)`: leading whitespace ignored, the unsplit remainder keeps trailing whitespace. */
function _splitMax(s: string, maxsplit: number): string[] {
  const isWs = (ch: string): boolean => PY_WHITESPACE.includes(ch);
  const chars = Array.from(s);
  const parts: string[] = [];
  let i = 0;
  const n = chars.length;
  while (i < n) {
    while (i < n && isWs(chars[i] as string)) i++;
    if (i >= n) break;
    if (parts.length === maxsplit) {
      parts.push(chars.slice(i).join(""));
      break;
    }
    const start = i;
    while (i < n && !isWs(chars[i] as string)) i++;
    parts.push(chars.slice(start, i).join(""));
  }
  return parts;
}

// ---------------------------------------------------------------------------
// process list
// ---------------------------------------------------------------------------

export const process_list = command("list", {
  help:
    "List running processes in a sandbox.\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox process list abc123\n" +
    "\n" +
    "    abx --json sandbox process list abc123\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx sandbox process info SANDBOX_ID PID\n" +
    "  abx exec SANDBOX_ID --background -- CMD\n" +
    "  abx sandbox system metrics SANDBOX_ID",
  params: [argument(["sandbox_id"])],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    const processes = await sandbox.commands.list();

    if (!processes.length) {
      fmt.printSuccess("No processes found.");
      return;
    }

    if (fmt.use_json) {
      fmt.printData(
        processes.map(
          (p) =>
            new Map<string, unknown>([
              ["pid", p.pid],
              ["command", p.command],
              ["status", p.status],
            ]),
        ),
      );
    } else {
      const headers = ["PID", "Command", "Status"];
      const rows = processes.map((p) => [String(p.pid), p.command, p.status]);
      fmt.printTable(headers, rows);
    }
  }),
});

// ---------------------------------------------------------------------------
// process info
// ---------------------------------------------------------------------------

export const process_info = command("info", {
  help:
    "Get details of a process by PID.\n" +
    "\n" +
    "Uses ps to query process information from the sandbox.\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox process info abc123 1234\n" +
    "\n" +
    "    abx --json sandbox process info abc123 1234\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx sandbox process list SANDBOX_ID\n" +
    "  abx sandbox process signal SANDBOX_ID PID\n" +
    "  abx sandbox system metrics SANDBOX_ID",
  params: [argument(["sandbox_id"]), argument(["pid"], { type: INT })],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;
    const pid = params["pid"] as number;

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    // Use ps for process info
    const result = (await sandbox.commands.run(`ps -p ${pid} -o pid=,ppid=,user=,stat=,rss=,etime=,comm= 2>/dev/null`, {
      timeout: 10,
    })) as ProcessResult;

    if (result.exit_code !== 0 || !pyStrip(result.stdout)) {
      fmt.printError(`Process ${pid} not found or not accessible.`);
      sysExit(1);
    }

    const lines = pySplitlines(pyStrip(result.stdout));
    if (!lines.length) {
      fmt.printError(`Process ${pid} not found.`);
      sysExit(1);
    }

    // Parse ps output
    const parts = _splitMax(lines[0] as string, 6);
    const data = new Map<string, unknown>([["PID", String(pid)]]);
    const labels = ["PPID", "User", "State", "RSS(KB)", "Elapsed", "Command"];
    labels.forEach((label, i) => {
      if (i + 1 < parts.length) data.set(label, parts[i + 1]);
    });

    fmt.printDict(data);
  }),
});

// ---------------------------------------------------------------------------
// process signal
// ---------------------------------------------------------------------------

export const process_signal = command("signal", {
  help:
    "Send a signal to a process in the sandbox.\n" +
    "\n" +
    "Supported signals: 15 (SIGTERM), 9 (SIGKILL). The sandbox's envd cannot\n" +
    "deliver any other signal; PID is the envd process id shown by 'process list'.\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox process signal abc123 1234\n" +
    "\n" +
    "    abx sandbox process signal abc123 1234 --signal 9\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx sandbox process info SANDBOX_ID PID\n" +
    "  abx sandbox process list SANDBOX_ID\n" +
    "  abx exec SANDBOX_ID --background -- CMD",
  params: [
    argument(["sandbox_id"]),
    argument(["pid"], { type: INT }),
    option(["--signal", "-s", "sig"], {
      type: INT,
      default: 15,
      help: "Signal number: 9=SIGKILL or 15=SIGTERM (default: 15)",
    }),
  ],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;
    const pid = params["pid"] as number;
    const sig = params["sig"] as number;

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    await sandbox.commands.sendSignal(pid, sig);
    fmt.printSuccess(`Signal ${sig} sent to process ${pid}.`);
  }),
});

// ---------------------------------------------------------------------------
// process group
// ---------------------------------------------------------------------------

export const process = group("process", {
  help:
    "Inspect and signal processes inside a sandbox (to start one: abx exec --background).\n" +
    "\n" +
    "\b\n" +
    "Examples:\n" +
    "  abx sandbox process list abc123\n" +
    "  abx sandbox process info abc123 1234\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx exec SANDBOX_ID --background -- CMD\n" +
    "  abx sandbox system metrics SANDBOX_ID",
  callback: (ctx) => {
    ctx.ensureObject(Object);
  },
});

process.addCommand(process_list, "list");
process.addCommand(process_info, "info");
process.addCommand(process_signal, "signal");

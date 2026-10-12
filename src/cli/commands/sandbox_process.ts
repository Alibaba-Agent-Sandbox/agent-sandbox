/** Sandbox process-management CLI commands: list, start, info, signal (port of `cli/commands/sandbox_process.py`). */

import type { Sandbox } from "../../api/sandbox.js";
import type { ProcessResult } from "../../models/process.js";
import { PY_WHITESPACE } from "../../framework/py.js";
import { pyStrip, pySplitlines } from "../../utils/_pyformat.js";
import { INT, PyFloat, argument, command, echo, group, option, sysExit } from "../../framework/index.js";
import { getFormatter } from "../formatters.js";
import { handleErrors } from "../main.js";

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
    "    ebx sandbox process list abc123\n" +
    "\n" +
    "    ebx --json sandbox process list abc123\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  ebx sandbox process info SANDBOX_ID PID\n" +
    "  ebx sandbox process start SANDBOX_ID --command CMD\n" +
    "  ebx sandbox system metrics SANDBOX_ID",
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
// process start
// ---------------------------------------------------------------------------

export const process_start = command("start", {
  help:
    "Execute a command synchronously and wait for completion.\n" +
    "\n" +
    "Output is collected and displayed after the command finishes.\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    ebx sandbox process start abc123 --command \"python app.py\"\n" +
    "\n" +
    "    ebx sandbox process start abc123 -c \"node server.js\" --cwd /app\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  ebx sandbox process list SANDBOX_ID\n" +
    "  ebx sandbox shell-stream SANDBOX_ID --command CMD\n" +
    "  ebx exec SANDBOX_ID CMD",
  params: [
    argument(["sandbox_id"]),
    option(["--command", "-c", "cmd"], { required: true, help: "Command to execute" }),
    option(["--timeout", "-t", "cmd_timeout"], {
      type: INT,
      default: 300,
      help: "Command timeout in seconds (positive integer; default: 300)",
    }),
    option(["--cwd"], { default: "", help: "Working directory" }),
  ],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;
    const cmd = params["cmd"] as string;
    const cmd_timeout = params["cmd_timeout"] as number;
    const cwd = params["cwd"] as string;

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    const result = (await sandbox.commands.run(cmd, { timeout: cmd_timeout, cwd })) as ProcessResult;

    if (fmt.use_json) {
      fmt.printData(
        new Map<string, unknown>([
          ["stdout", result.stdout],
          ["stderr", result.stderr],
          ["exit_code", result.exit_code],
          ["execution_time", new PyFloat(result.execution_time)],
        ]),
      );
    } else {
      if (result.stdout) echo(result.stdout, { nl: false });
      if (result.stderr) echo(result.stderr, { err: true, nl: false });
      if (result.exit_code === 0) fmt.printSuccess("Process completed successfully.");
      else fmt.printError(`Process exited with code ${result.exit_code}.`);
    }

    sysExit(result.exit_code);
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
    "    ebx sandbox process info abc123 1234\n" +
    "\n" +
    "    ebx --json sandbox process info abc123 1234\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  ebx sandbox process list SANDBOX_ID\n" +
    "  ebx sandbox process signal SANDBOX_ID PID\n" +
    "  ebx sandbox system metrics SANDBOX_ID",
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
    "    ebx sandbox process signal abc123 1234\n" +
    "\n" +
    "    ebx sandbox process signal abc123 1234 --signal 9\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  ebx sandbox process info SANDBOX_ID PID\n" +
    "  ebx sandbox process list SANDBOX_ID\n" +
    "  ebx sandbox process start SANDBOX_ID --command CMD",
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
    "Inspect, run, and signal processes inside a sandbox.\n" +
    "\n" +
    "\b\n" +
    "Examples:\n" +
    "  ebx sandbox process list abc123\n" +
    "  ebx sandbox process start abc123 --command \"python app.py\"\n" +
    "  ebx sandbox process info abc123 1234\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  ebx exec SANDBOX_ID CMD\n" +
    "  ebx sandbox shell-stream SANDBOX_ID --command CMD\n" +
    "  ebx sandbox system metrics SANDBOX_ID",
  callback: (ctx) => {
    ctx.ensureObject(Object);
  },
});

process.addCommand(process_list, "list");
process.addCommand(process_start, "start");
process.addCommand(process_info, "info");
process.addCommand(process_signal, "signal");

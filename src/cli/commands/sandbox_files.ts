/** Sandbox file-operation CLI commands: list, stat, mkdir, rm, mv, search (port of `cli/commands/sandbox_files.py`). */

import type { Sandbox } from "../../api/sandbox.js";
import { shlexQuote } from "../../api/_shlex.js";
import type { ProcessResult } from "../../models/process.js";
import { pyRstrip, pySplitlines, pyStrip } from "../../utils/_pyformat.js";
import { argument, command, group, option } from "../kit.js";
import { INT } from "../types.js";
import { echo } from "../io.js";
import { confirm } from "../prompts.js";
import { getFormatter } from "../formatters.js";
import { handleErrors } from "../error_handler.js";

/** Connect to a sandbox by ID. */
export async function _connectSandbox(sandbox_id: string): Promise<Sandbox> {
  // Imported lazily like the Python helper: the SDK loggers must be created after the CLI's logging bridge is
  // installed by the root group callback, otherwise `--verbose` cannot lower the package logger level.
  const { Sandbox } = await import("../../api/sandbox.js");
  return Sandbox.connect(sandbox_id);
}

// ---------------------------------------------------------------------------
// files list
// ---------------------------------------------------------------------------

export const files_list = command("list", {
  help:
    "List directory contents in a sandbox.\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox files list abc123\n" +
    "\n" +
    "    abx sandbox files list abc123 --path /app --recursive\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx sandbox files stat SANDBOX_ID --path PATH\n" +
    "  abx upload SANDBOX_ID LOCAL_PATH REMOTE_PATH\n" +
    "  abx download SANDBOX_ID REMOTE_PATH LOCAL_PATH",
  params: [
    argument(["sandbox_id"]),
    option(["--path", "-p"], { default: "/home/user", help: "Directory path to list" }),
    option(["--recursive", "-r"], { is_flag: true, help: "List recursively" }),
  ],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;
    const path = params["path"] as string;
    const recursive = Boolean(params["recursive"]);

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    if (recursive) {
      // Use shell find for recursive listing
      const result = (await sandbox.commands.run(`find ${shlexQuote(path)} -maxdepth 5 2>/dev/null`, {
        timeout: 30,
      })) as ProcessResult;
      if (fmt.use_json) {
        const lines = pySplitlines(pyStrip(result.stdout)).filter((ln) => ln);
        fmt.printData(new Map<string, unknown>([["path", path], ["entries", lines]]));
      } else if (pyStrip(result.stdout)) {
        echo(pyRstrip(result.stdout));
      } else {
        fmt.printSuccess(`Directory ${path} is empty.`);
      }
    } else {
      const entries = await sandbox.files.list(path);
      if (!entries.length) {
        fmt.printSuccess(`Directory ${path} is empty.`);
        return;
      }

      if (fmt.use_json) {
        fmt.printData(
          entries.map(
            (e) =>
              new Map<string, unknown>([
                ["name", e.name],
                ["type", e.type],
                ["size", e.size],
              ]),
          ),
        );
      } else {
        const headers = ["Name", "Type", "Size"];
        const rows = entries.map((e) => [e.name, e.type, String(e.size)]);
        fmt.printTable(headers, rows);
      }
    }
  }),
});

// ---------------------------------------------------------------------------
// files stat
// ---------------------------------------------------------------------------

export const files_stat = command("stat", {
  help:
    "Get file or directory information.\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox files stat abc123 --path /home/user/app.py\n" +
    "\n" +
    "    abx sandbox files stat abc123 --path /app\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx sandbox files list SANDBOX_ID --path PATH\n" +
    "  abx sandbox files mv SANDBOX_ID --source PATH --dest PATH\n" +
    "  abx download SANDBOX_ID REMOTE_PATH LOCAL_PATH",
  params: [
    argument(["sandbox_id"]),
    option(["--path", "-p"], { required: true, help: "File or directory path" }),
  ],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;
    const path = params["path"] as string;

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    const info = await sandbox.files.getInfo(path);
    const data = new Map<string, unknown>([
      ["Name", info.name],
      ["Path", info.path],
      ["Type", info.type],
      ["Size", String(info.size)],
    ]);
    fmt.printDict(data);
  }),
});

// ---------------------------------------------------------------------------
// files mkdir
// ---------------------------------------------------------------------------

export const files_mkdir = command("mkdir", {
  help:
    "Create a directory (including parent directories).\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox files mkdir abc123 --path /home/user/myproject/src\n" +
    "\n" +
    "    abx sandbox files mkdir abc123 --path /tmp/results\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx sandbox files list SANDBOX_ID --path PATH\n" +
    "  abx upload SANDBOX_ID LOCAL_PATH REMOTE_PATH\n" +
    "  abx sandbox files rm SANDBOX_ID --path PATH",
  params: [
    argument(["sandbox_id"]),
    option(["--path", "-p"], { required: true, help: "Directory path to create" }),
  ],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;
    const path = params["path"] as string;

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    await sandbox.files.makeDir(path);
    fmt.printSuccess(`Directory created: ${path}`);
  }),
});

// ---------------------------------------------------------------------------
// files rm
// ---------------------------------------------------------------------------

export const files_rm = command("rm", {
  help:
    "Delete a file or directory in the sandbox.\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox files rm abc123 --path /home/user/temp.txt\n" +
    "\n" +
    "    abx sandbox files rm abc123 --path /home/user/old_dir -y\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx sandbox files stat SANDBOX_ID --path PATH\n" +
    "  abx sandbox files list SANDBOX_ID --path DIRECTORY\n" +
    "  abx sandbox files mkdir SANDBOX_ID --path DIRECTORY",
  params: [
    argument(["sandbox_id"]),
    option(["--path", "-p"], { required: true, help: "File or directory path to delete" }),
    option(["--yes", "-y"], { is_flag: true, help: "Skip confirmation" }),
  ],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;
    const path = params["path"] as string;
    const yes = Boolean(params["yes"]);

    const fmt = getFormatter(ctx);

    if (!yes) {
      await confirm(`Delete ${path} in sandbox ${sandbox_id}?`, { abort: true });
    }

    const sandbox = await _connectSandbox(sandbox_id);
    await sandbox.files.remove(path);
    fmt.printSuccess(`Deleted: ${path}`);
  }),
});

// ---------------------------------------------------------------------------
// files mv
// ---------------------------------------------------------------------------

export const files_mv = command("mv", {
  help:
    "Move or rename a file/directory in the sandbox.\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox files mv abc123 --source /home/user/old.py --dest /home/user/new.py\n" +
    "\n" +
    "    abx sandbox files mv abc123 -s /tmp/results -d /app/results\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx sandbox files stat SANDBOX_ID --path PATH\n" +
    "  abx sandbox files list SANDBOX_ID --path DIRECTORY\n" +
    "  abx sandbox files rm SANDBOX_ID --path PATH",
  params: [
    argument(["sandbox_id"]),
    option(["--source", "-s"], { required: true, help: "Source path" }),
    option(["--dest", "-d"], { required: true, help: "Destination path" }),
  ],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;
    const source = params["source"] as string;
    const dest = params["dest"] as string;

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    await sandbox.files.move(source, dest);
    fmt.printSuccess(`Moved: ${source} -> ${dest}`);
  }),
});

// ---------------------------------------------------------------------------
// files search
// ---------------------------------------------------------------------------

export const files_search = command("search", {
  help:
    "Search for files matching a glob pattern.\n" +
    "\n" +
    "Examples:\n" +
    "\n" +
    "    abx sandbox files search abc123 --path /home/user --pattern \"*.py\"\n" +
    "\n" +
    "    abx sandbox files search abc123 --path /app --pattern \"*.log\" --max-depth 3\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx sandbox files list SANDBOX_ID --path DIRECTORY\n" +
    "  abx sandbox files stat SANDBOX_ID --path PATH\n" +
    "  abx exec SANDBOX_ID \"find /app -type f\"",
  params: [
    argument(["sandbox_id"]),
    option(["--path", "-p"], { required: true, help: "Directory to search in" }),
    option(["--pattern"], { required: true, help: "Glob pattern (e.g. '*.py')" }),
    option(["--max-depth"], {
      type: INT,
      default: 5,
      help: "Maximum search depth (non-negative integer; default: 5)",
    }),
  ],
  callback: handleErrors(async (ctx, params) => {
    const sandbox_id = params["sandbox_id"] as string;
    const path = params["path"] as string;
    const pattern = params["pattern"] as string;
    const max_depth = params["max_depth"] as number;

    const fmt = getFormatter(ctx);
    const sandbox = await _connectSandbox(sandbox_id);

    const cmd =
      `find ${shlexQuote(path)} -maxdepth ${max_depth} ` + `-name ${shlexQuote(pattern)} -type f 2>/dev/null`;
    const result = (await sandbox.commands.run(cmd, { timeout: 30 })) as ProcessResult;

    const lines = pySplitlines(pyStrip(result.stdout)).filter((ln) => ln);

    if (fmt.use_json) {
      fmt.printData(
        new Map<string, unknown>([
          ["path", path],
          ["pattern", pattern],
          ["results", lines],
        ]),
      );
    } else if (lines.length) {
      for (const ln of lines) echo(ln);
      fmt.printSuccess(`Found ${lines.length} file(s).`);
    } else {
      fmt.printSuccess("No files found matching the pattern.");
    }
  }),
});

// ---------------------------------------------------------------------------
// files group
// ---------------------------------------------------------------------------

export const files = group("files", {
  help:
    "Inspect and modify files inside a sandbox.\n" +
    "\n" +
    "\b\n" +
    "Examples:\n" +
    "  abx sandbox files list abc123 --path /app\n" +
    "  abx sandbox files stat abc123 --path /app/main.py\n" +
    "  abx sandbox files search abc123 --path /app --pattern \"*.py\"\n" +
    "\n" +
    "\b\n" +
    "Related commands:\n" +
    "  abx upload SANDBOX_ID LOCAL_PATH REMOTE_PATH\n" +
    "  abx download SANDBOX_ID REMOTE_PATH LOCAL_PATH\n" +
    "  abx sandbox process --help",
  callback: (ctx) => {
    ctx.ensureObject(Object);
  },
});

files.addCommand(files_list, "list");
files.addCommand(files_stat, "stat");
files.addCommand(files_mkdir, "mkdir");
files.addCommand(files_rm, "rm");
files.addCommand(files_mv, "mv");
files.addCommand(files_search, "search");

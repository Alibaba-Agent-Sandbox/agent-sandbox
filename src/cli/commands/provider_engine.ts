/**
 * `abx provider engine` — the local engine that gives every SDK (Python today; Node, Go and Java later) the same
 * provider layer the CLI uses. `serve` runs it in the foreground; SDKs start it on demand and read `~/.abx/engine.json`.
 * Protocol and routes: `docs/en/reference/engine-api.md`.
 */

import { type Context, command, group, option } from "../kit.js";
import { INT } from "../types.js";
import { sysExit } from "../errors.js";
import { echo } from "../io.js";
import { getFormatter } from "../formatters.js";
import { handleErrors } from "../error_handler.js";
import { engineFile, pidAlive, readRecord, type EngineRecord } from "../../engine/discovery.js";

type Params = Record<string, unknown>;

export const engine = group("engine", {
  help: [
    "Run or inspect the local provider engine.",
    "",
    "    The engine hosts the provider layer on 127.0.0.1 (HTTP, SSE and WebSocket,",
    "    protocol abx-engine/1) so SDKs in any language call the same providers as",
    "    the CLI. SDKs start it on demand; it exits after an idle period.",
    "",
    "    \b",
    "    Examples:",
    "      abx provider engine serve",
    "      abx provider engine status",
    "      abx provider engine stop",
    "    ",
  ].join("\n"),
});

async function call(record: EngineRecord, method: string, route: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`http://${record.host}:${record.port}${route}`, {
      method,
      headers: { Authorization: `Bearer ${record.token}` },
      signal: AbortSignal.timeout(3000),
    });
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const serve_cmd = command("serve", {
  help: [
    "Run the engine in the foreground.",
    "",
    "    Exits 0 at once when another engine is already running. --idle-timeout 0",
    "    keeps it running until it is stopped.",
    "    ",
  ].join("\n"),
  params: [
    option(["--idle-timeout"], { type: INT, default: 900, help: "Seconds without requests before the engine exits (0 = never; default: 900)" }),
    option(["--port"], { type: INT, default: 0, help: "Port to listen on (default: a free port)" }),
  ],
  callback: handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const { startEngine } = await import("../../engine/server.js");
    let handle;
    try {
      handle = await startEngine({ port: Number(params["port"] ?? 0), idle_timeout: Number(params["idle_timeout"] ?? 900) });
    } catch (exc) {
      if (exc instanceof Error && exc.message === "EngineRunning") {
        const existing = readRecord();
        fmt.printSuccess(`An engine is already running${existing ? ` (pid ${existing.pid}, port ${existing.port})` : ""}.`);
        return;
      }
      throw exc;
    }
    const stop = (): void => void handle.close();
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    echo(`engine listening on ${handle.record.host}:${handle.record.port} (pid ${handle.record.pid}, ${handle.record.protocol})`);
    await handle.closed;
  }),
});

const status_cmd = command("status", {
  help: "Show whether an engine is running. Exits 1 when none is.",
  callback: handleErrors(async (ctx: Context) => {
    const fmt = getFormatter(ctx);
    const record = readRecord();
    const health = record !== null && pidAlive(record.pid) ? await call(record, "GET", "/v1/health") : null;
    if (record === null || health === null) {
      if (fmt.use_json) fmt.printData({ running: false });
      else echo("No engine is running.");
      return sysExit(1);
    }
    fmt.printDict({ running: true, pid: record.pid, host: record.host, port: record.port, protocol: record.protocol, version: record.version, sessions: health["sessions"], file: engineFile() });
  }),
});

const stop_cmd = command("stop", {
  help: "Stop the running engine and close its sandbox sessions.",
  callback: handleErrors(async (ctx: Context) => {
    const fmt = getFormatter(ctx);
    const record = readRecord();
    if (record === null || !pidAlive(record.pid)) {
      fmt.printSuccess("No engine is running.");
      return;
    }
    await call(record, "POST", "/v1/shutdown");
    for (let i = 0; i < 50 && pidAlive(record.pid); i += 1) await new Promise((r) => setTimeout(r, 100));
    if (pidAlive(record.pid)) return sysExit(1);
    fmt.printSuccess("Engine stopped.");
  }),
});

engine.addCommand(serve_cmd, "serve");
engine.addCommand(status_cmd, "status");
engine.addCommand(stop_cmd, "stop");

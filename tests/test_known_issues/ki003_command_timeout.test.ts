/** KI-003: a command that outlives its timeout raises `CommandTimeoutError`, not httpx's `ReadTimeout`. */

import { afterEach, describe, expect, it } from "vitest";

import { CommandsModule } from "../../src/api/commands.js";
import { CommandTimeoutError, ConnectionError_, ExecutionError } from "../../src/models/errors.js";
import { ProcessProtocol } from "../../src/providers/shared/e2b/process.js";
import {
  ConnectTimeout,
  MockTransport,
  ReadTimeout,
  Request,
  Response,
  _setDefaultTransportFactory,
} from "../../src/transport/_httpx.js";
import { HTTPError } from "../../src/transport/http.js";
import { useIsolatedEnv, useTransportIsolation } from "../_support/env.js";
import { ENVD, bodyOf, frame, makeHttp, raises, startEvent, token } from "./_helpers.js";

const iso = useIsolatedEnv();
useTransportIsolation(iso);

afterEach(() => _setDefaultTransportFactory(null));

const commands = () => new CommandsModule(ENVD, token(), new ProcessProtocol(makeHttp()));

/** Streams the start frame, then times out like a command producing no further output. */
async function* stallAfterStart(): AsyncGenerator<Uint8Array> {
  yield frame(startEvent(321));
  throw new ReadTimeout("timed out");
}

function install(handler: (request: Request) => Response | Promise<Response>): Request[] {
  const seen: Request[] = [];
  _setDefaultTransportFactory(
    () =>
      new MockTransport(async (request) => {
        seen.push(request);
        return handler(request);
      }),
  );
  return seen;
}

const isStart = (r: Request) => r.url.path.endsWith("/Start");
const kills = (seen: Request[]) => seen.filter((r) => r.url.path.endsWith("/SendSignal"));

describe("KI-003 command timeout", () => {
  it("test_run_raises_command_timeout_error", async () => {
    install(() => {
      throw new ReadTimeout("timed out");
    });
    const err = await raises(() => commands().run("sleep 60", { timeout: 3 }), CommandTimeoutError);
    expect(err).toBeInstanceOf(ExecutionError);
    expect(err.message).toContain("3");
    expect(err).not.toBeInstanceOf(HTTPError);
  });

  it("test_timeout_after_output_started_is_also_mapped", async () => {
    install((r) => (isStart(r) ? new Response(200, { content: stallAfterStart() }) : new Response(200, { json: {} })));
    await raises(() => commands().run("sleep 60", { timeout: 3 }), CommandTimeoutError);
  });

  it("test_timed_out_process_is_killed_best_effort", async () => {
    const seen = install((r) => (isStart(r) ? new Response(200, { content: stallAfterStart() }) : new Response(200, { json: {} })));
    const err = await raises(() => commands().run("sleep 60", { timeout: 3 }), CommandTimeoutError);
    expect(kills(seen).map(bodyOf)).toEqual([{ process: { pid: 321 }, signal: "SIGNAL_SIGKILL" }]);
    expect(err.message).toBe("Command timed out: did not finish within 3s (no output for 8s; pid 321 was asked to stop).");
  });

  it("test_kill_failure_never_masks_the_timeout", async () => {
    install((r) => (isStart(r) ? new Response(200, { content: stallAfterStart() }) : new Response(404, { content: "process not found\n" })));
    await raises(() => commands().run("sleep 60", { timeout: 3 }), CommandTimeoutError);
  });

  it("test_timeout_before_the_start_event_sends_no_kill", async () => {
    const seen = install(() => {
      throw new ReadTimeout("timed out");
    });
    const err = await raises(() => commands().run("sleep 60", { timeout: 3 }), CommandTimeoutError);
    expect(kills(seen)).toEqual([]);
    expect(err.message).toBe("Command timed out: did not finish within 3s (no output for 8s).");
  });

  it("test_stream_and_start_map_timeouts_too", async () => {
    install(() => {
      throw new ReadTimeout("t");
    });
    const cmds = commands();
    await raises(async () => {
      for await (const _chunk of cmds.stream("sleep 60", { timeout: 2 })) void _chunk;
    }, CommandTimeoutError);
    const reader = await cmds.start("sleep 60", { timeout: 2 });
    await raises(() => reader.collect(), CommandTimeoutError);
  });

  it("test_connect_timeout_is_a_connection_error_not_a_command_timeout", async () => {
    install(() => {
      throw new ConnectTimeout("no route");
    });
    await raises(() => commands().run("true", { timeout: 3 }), ConnectionError_);
  });
});

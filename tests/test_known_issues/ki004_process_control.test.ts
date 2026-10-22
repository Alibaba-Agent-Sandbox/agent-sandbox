/**
 * KI-004: kill / sendSignal / sendInput / connect / update must address the process correctly.
 *
 * envd (`process.proto`):
 *
 *     SendSignalRequest { ProcessSelector process = 1; Signal signal = 2; }
 *     SendInputRequest  { ProcessSelector process = 1; ProcessInput input = 2; }
 *     ConnectRequest    { ProcessSelector process = 1; }
 *     ProcessSelector   { oneof { uint32 pid = 1; string tag = 2; } }
 *     Signal            { SIGNAL_SIGTERM = 15; SIGNAL_SIGKILL = 9; }
 *     ProcessInput      { oneof { bytes stdin = 1; bytes pty = 2; } }   # bytes are base64 in JSON
 *
 * The SDK used to post a flat `{"pid": N, ...}` body, which envd ignores (`process not found`).
 */

import { describe, expect, it } from "vitest";

import { CommandsModule } from "../../src/api/commands.js";
import { ValueError } from "../../src/utils/_pyerrors.js";
import { EnvdRpcError } from "../../src/models/errors.js";
import { ProcessProtocol } from "../../src/providers/shared/e2b/process.js";
import { useIsolatedEnv, useTransportIsolation } from "../_support/env.js";
import { useHttpxMock } from "../helpers/httpxMock.js";
import { ENVD, bodyOf, endEvent, makeHttp, processStream, raises, startEvent, stdoutEvent, token } from "./_helpers.js";

const iso = useIsolatedEnv();
useTransportIsolation(iso);
const httpx_mock = useHttpxMock();

const commands = () => new CommandsModule(ENVD, token(), new ProcessProtocol(makeHttp()));
const ok = (rpc: string) => httpx_mock.add_response({ url: `${ENVD}/process.Process/${rpc}`, method: "POST", json: {} });

describe("KI-004 process control", () => {
  it("test_kill_sends_sigkill_with_process_selector", async () => {
    ok("SendSignal");
    await commands().kill(42);
    expect(bodyOf(httpx_mock.get_request())).toEqual({ process: { pid: 42 }, signal: "SIGNAL_SIGKILL" });
  });

  it.each<[number, string]>([
    [15, "SIGNAL_SIGTERM"],
    [9, "SIGNAL_SIGKILL"],
  ])("test_send_signal_uses_envd_signal_enum(%i)", async (num, name) => {
    ok("SendSignal");
    await commands().sendSignal(1234, num);
    expect(bodyOf(httpx_mock.get_request())).toEqual({ process: { pid: 1234 }, signal: name });
  });

  it("test_send_signal_default_is_sigterm", async () => {
    ok("SendSignal");
    await commands().sendSignal(5);
    expect(bodyOf(httpx_mock.get_request()).signal).toBe("SIGNAL_SIGTERM");
  });

  it.each<unknown>([2, 1, 0, -1, 65, true, 9.5, "9"])(
    "test_signals_envd_cannot_deliver_are_rejected_before_any_request(%s)",
    async (signal) => {
      const err = await raises(() => commands().sendSignal(5, signal as number), ValueError);
      expect(err.message).toMatch(/SIGTERM.*SIGKILL/);
      expect(httpx_mock.get_requests()).toEqual([]);
    },
  );

  it("test_rejection_message_is_the_python_text", async () => {
    const err = await raises(() => commands().sendSignal(5, 2), ValueError);
    expect(err.message).toBe("envd can only deliver SIGTERM (15) and SIGKILL (9) to a process; got 2");
  });

  it("test_send_input_wraps_data_as_base64_stdin", async () => {
    ok("SendInput");
    await commands().sendInput(42, "typed-input\n");
    const body = bodyOf(httpx_mock.get_request());
    expect(body.process).toEqual({ pid: 42 });
    expect(Object.keys(body).sort()).toEqual(["input", "process"]);
    expect(Buffer.from(body.input.stdin, "base64").toString("utf-8")).toBe("typed-input\n");
  });

  it("test_send_stdin_alias_uses_the_same_body", async () => {
    ok("SendInput");
    await commands().sendInput(42, "x");
    expect(bodyOf(httpx_mock.get_request()).input).toEqual({ stdin: Buffer.from("x").toString("base64") });
  });

  it("test_send_input_encodes_non_ascii_as_utf8", async () => {
    ok("SendInput");
    await commands().sendInput(1, "héllo\n");
    const stdin = bodyOf(httpx_mock.get_request()).input.stdin;
    expect(Buffer.from(stdin, "base64").toString("utf-8")).toBe("héllo\n");
  });

  it("test_numeric_string_pid_is_sent_as_number_and_other_strings_as_tag", async () => {
    ok("SendSignal");
    ok("SendSignal");
    const cmds = commands();
    await cmds.sendSignal("77", 9);
    await cmds.sendSignal("my-tag", 9);
    const [first, second] = httpx_mock.get_requests().map((r) => bodyOf(r).process);
    expect(first).toEqual({ pid: 77 });
    expect(second).toEqual({ tag: "my-tag" });
  });

  it("test_pid_beyond_2_53_is_sent_exactly", async () => {
    ok("SendSignal");
    await commands().sendSignal(9007199254740993n as unknown as number, 9);
    const raw = Buffer.from(httpx_mock.get_request().content).toString("utf-8");
    expect(raw).toBe('{"process":{"pid":9007199254740993},"signal":"SIGNAL_SIGKILL"}');
  });

  it("test_boolean_pid_is_a_type_error", async () => {
    await raises(() => commands().sendSignal(true as unknown as number, 9), TypeError);
    expect(httpx_mock.get_requests()).toEqual([]);
  });

  it("test_connect_to_process_uses_process_selector", async () => {
    httpx_mock.add_response({
      url: `${ENVD}/process.Process/Connect`,
      method: "POST",
      content: processStream(startEvent(42), stdoutEvent("hi"), endEvent(0)),
    });
    const reader = await new ProcessProtocol(makeHttp()).connectToProcess(ENVD, token(), { pid: 42 });
    const chunks = await reader.collect();
    expect(bodyOf(httpx_mock.get_request())).toEqual({ process: { pid: 42 } });
    expect(chunks.map((c) => c.data).join("")).toContain("hi");
  });

  it("test_update_uses_process_selector", async () => {
    ok("Update");
    await new ProcessProtocol(makeHttp()).update(ENVD, token(), { pid: 42, pty: { size: { cols: 80, rows: 24 } } });
    expect(bodyOf(httpx_mock.get_request())).toEqual({ process: { pid: 42 }, pty: { size: { cols: 80, rows: 24 } } });
  });

  it("test_process_not_found_surfaces_as_envd_rpc_error", async () => {
    httpx_mock.add_response({
      url: `${ENVD}/process.Process/SendInput`,
      method: "POST",
      status_code: 404,
      content: "process not found\n",
    });
    const err = await raises(() => commands().sendInput(99999, "x"), EnvdRpcError);
    expect(err.status_code).toBe(404);
    expect(String(err.message)).toContain("process not found");
    expect(String(err.message)).not.toContain(ENVD);
  });
});

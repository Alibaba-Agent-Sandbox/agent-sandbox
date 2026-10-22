/**
 * KI-001: `commands.run(cmd, { env })` must reach envd as `process.envs`.
 *
 * envd's `ProcessConfig` message has `map<string,string> envs = 3`; the SDK used to send `envVars` (the *sandbox
 * create* spelling), which protobuf-JSON silently ignores, so per-call environment variables never reached the command.
 */

import { describe, expect, it } from "vitest";

import { CommandsModule } from "../../src/api/commands.js";
import type { ProcessResult } from "../../src/models/process.js";
import { ProcessProtocol } from "../../src/providers/shared/e2b/process.js";
import { useIsolatedEnv, useTransportIsolation } from "../_support/env.js";
import { useHttpxMock } from "../helpers/httpxMock.js";
import { ENVD, bodyOf, endEvent, makeHttp, processStream, startEvent, stdoutEvent, token } from "./_helpers.js";

const iso = useIsolatedEnv();
useTransportIsolation(iso);
const httpx_mock = useHttpxMock();

const START_URL = `${ENVD}/process.Process/Start`;
const commands = () => new CommandsModule(ENVD, token(), new ProcessProtocol(makeHttp()));

describe("KI-001 per-call env", () => {
  it("test_run_sends_per_call_env_as_envs", async () => {
    httpx_mock.add_response({
      url: START_URL,
      method: "POST",
      content: processStream(startEvent(7), stdoutEvent("per-call\n"), endEvent(0)),
    });
    const result = (await commands().run("printenv E2E_CALL_ENV", { env: { E2E_CALL_ENV: "per-call" } })) as ProcessResult;

    const proc = bodyOf(httpx_mock.get_request()).process;
    expect(proc.envs).toEqual({ E2E_CALL_ENV: "per-call" });
    expect("envVars" in proc).toBe(false);
    expect(result.stdout).toBe("per-call\n");
  });

  it("test_start_and_stream_send_env_as_envs", async () => {
    for (let i = 0; i < 2; i += 1) {
      httpx_mock.add_response({ url: START_URL, method: "POST", content: processStream(startEvent(8), endEvent(0)) });
    }
    const cmds = commands();
    const reader = await cmds.start("env", { env: { A: "1" } });
    await reader.collect();
    for await (const _chunk of cmds.stream("env", { env: { B: "2" } })) void _chunk;

    const [first, second] = httpx_mock.get_requests().map((r) => bodyOf(r).process);
    expect(first.envs).toEqual({ A: "1" });
    expect(second.envs).toEqual({ B: "2" });
  });

  it("test_run_without_env_sends_no_envs_key", async () => {
    httpx_mock.add_response({ url: START_URL, method: "POST", content: processStream(startEvent(9), endEvent(0)) });
    await commands().run("true");
    const proc = bodyOf(httpx_mock.get_request()).process;
    expect("envs" in proc).toBe(false);
    expect("envVars" in proc).toBe(false);
  });
});

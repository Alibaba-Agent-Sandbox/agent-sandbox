/** Parser-to-executor contract; process transport behavior is tested with real child processes/TTYs separately. */
import "../_support/isolatedHome.js";
import { afterEach, expect, it, vi } from "vitest";
import { main } from "../../src/cli/main.js";
import { Sandbox } from "../../src/standard_cli/runtime.mjs";
import { useIso } from "../_support/iso.js";
import { useCapsys } from "./conftest.js";
const iso = useIso(); const cap = useCapsys();
afterEach(() => vi.restoreAllMocks());
it("returns one JSON object, remote argv and nonzero status through the public entry", async () => {
  iso.setenv("ABX_SANDBOX_API_KEY", "fixture-key");
  vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* () {});
  const run = vi.fn(async (_command: string, options: { onStdout: (data: string) => void; onStderr: (data: string) => void }) => {
    options.onStdout("result\n"); options.onStderr("detail\n");
    return { pid: 7, wait: async () => ({ exitCode: 17 }), kill: async () => {}, disconnect: async () => {} };
  });
  vi.spyOn(Sandbox, "connect").mockResolvedValue({ commands: { supportsStdinClose: true, run, closeStdin: async () => {}, sendStdin: async () => {} } } as unknown as Sandbox);
  const code = await main({ args: ["--json", "sandbox", "exec", "--provider", "alicloud-express", "--user", "root", "raw-id", "tool", "--help", "--provider", "remote-id", "--json"] });
  const { out, err } = cap.readouterr();
  expect(code, out + err).toBe(17); expect(JSON.parse(out)).toEqual({ stdout: "result\n", stderr: "detail\n", exit_code: 17 });
  expect(err).toBe(""); expect(run.mock.calls[0]?.[0]).toBe("tool --help --provider remote-id --json");
  expect(run.mock.calls[0]?.[1]).toMatchObject({ user: "root" });
});

it.each([2147483, 2147484])("validates the representable command timer boundary %i before connecting", async seconds => {
  iso.setenv("ABX_SANDBOX_API_KEY", "fixture-key");
  const run = vi.fn(async () => ({pid: 7, wait: async () => ({exitCode:0}), kill:async () => {}, disconnect:async () => {}}));
  const connect = vi.spyOn(Sandbox,"connect").mockResolvedValue({commands:{run,supportsStdinClose:true,closeStdin:async()=>{}}} as unknown as Sandbox);
  vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* () {});
  const code = await main({args:["sandbox","exec","--timeout",String(seconds),"raw-id","echo","ready"]});
  if (seconds === 2147483) { expect(code).toBe(0); expect(run).toHaveBeenCalledWith("echo ready",expect.objectContaining({timeoutMs:2147483000})); }
  else { expect(code).toBe(2); expect(connect).not.toHaveBeenCalled(); }
});

it("reports a typed total deadline through the public JSON entry without leaking cleanup errors", async () => {
  iso.setenv("ABX_SANDBOX_API_KEY", "fixture-key");
  vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* () {});
  const disconnect = vi.fn(async () => {});
  const kill = vi.fn(async () => { throw new Error("private provider response"); });
  vi.spyOn(Sandbox, "connect").mockResolvedValue({ commands: { supportsStdinClose: true, closeStdin: async () => {}, kill, run: async () => ({ pid: 7, wait: () => new Promise(() => {}), kill, disconnect }) } } as unknown as Sandbox);
  const code = await main({ args: ["--provider", "alicloud-express", "--json", "sandbox", "exec", "--timeout", "1", "raw-id", "sleep", "4"] });
  const { out, err } = cap.readouterr();
  expect(code, out + err).toBe(5); expect(JSON.parse(out)).toMatchObject({ code: "E3001", message: expect.stringContaining("execution deadline exceeded; pid 7 was asked to stop") });
  expect(out + err).not.toContain("private provider response"); expect(kill).toHaveBeenCalledTimes(1); expect(disconnect).toHaveBeenCalledTimes(1);
});

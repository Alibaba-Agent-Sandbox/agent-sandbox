/** Host process and terminal behavior, without cloud or model traffic. */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { afterAll, expect, it } from "vitest";
import { execute, sendStdin } from "../../src/standard_cli/session.js";
import { remoteSignalActive } from "../../src/standard_cli/signals.js";
import type { Sandbox } from "e2b";

it("forwards bounded UTF-8 stdin in order and signals EOF to a real process", async () => {
  const child = spawn(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { stdio: "pipe" });
  const chunks: Buffer[] = []; child.stdout.on("data", data => chunks.push(data));
  const sizes: number[] = [];
  const done = new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(String(code)))); });
  const sandbox = { commands: {
    sendStdin: async (_pid: number, data: Uint8Array) => { sizes.push(data.length); await new Promise<void>((resolve, reject) => child.stdin.write(data, error => error ? reject(error) : resolve())); },
    closeStdin: async () => { child.stdin.end(); }, kill: async () => child.kill(),
  } } as unknown as Sandbox;
  const input = Buffer.from("中文🙂".repeat(18000));
  await sendStdin(sandbox, child.pid!, Readable.from([input])); await done;
  expect(Buffer.concat(chunks)).toEqual(input); expect(Math.max(...sizes)).toBeLessThanOrEqual(65536);
});

it("returns a real remote process's nonzero exit code and releases signal ownership", async () => {
  const child = spawn(process.execPath, ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exitCode=17"], { stdio: "pipe" });
  const result = new Promise<{ exitCode: number }>(resolve => child.once("exit", code => resolve({ exitCode: code! })));
  let stdout = "", stderr = "";
  const sandbox = { commands: { supportsStdinClose: true, run: async (_command: string, options: {onStdout(data: string): void; onStderr(data: string): void}) => {
    child.stdout.on("data", data => options.onStdout(String(data))); child.stderr.on("data", data => options.onStderr(String(data)));
    return { pid: child.pid, wait: () => result, kill: async () => child.kill() };
  } } } as unknown as Sandbox;
  expect(await execute(sandbox, "fixture", { stdin: false, onStdout: data => { stdout += data; }, onStderr: data => { stderr += data; } })).toMatchObject({ exitCode: 17 });
  expect(stdout).toBe("out"); expect(stderr).toBe("err"); expect(remoteSignalActive()).toBe(false);
});

const directory = mkdtempSync(path.join(tmpdir(), "abx-pty-session-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const pythonAvailable = process.platform !== "win32" && spawnSync("python3", ["--version"]).status === 0;
it.skipIf(!pythonAvailable).each(["input", "signal", "failed-signal", "hung-signal"])("restores a real POSIX TTY after %s completion", mode => {
  const fixture = path.join(directory, `${mode}.mts`);
  const session = fileURLToPath(new URL("../../src/standard_cli/session.ts", import.meta.url));
  writeFileSync(fixture, `import {connectTerminal} from ${JSON.stringify(session)};
let finish; const done = new Promise(resolve => {finish=resolve}); let resizes=0; let disconnected=false; const mode=${JSON.stringify(mode)};
const sandbox={pty:{create:async options=>{options.onData(Buffer.from('READY\\n'));return {pid:7,wait:()=>done,kill:async()=>{if(mode==='failed-signal')throw new Error('kill failed');if(mode==='hung-signal')return new Promise(()=>{});finish({exitCode:130})},disconnect:async()=>{disconnected=true}}},sendInput:async(_pid,bytes)=>{if(bytes.includes(10))finish({exitCode:7})},resize:async()=>{resizes++}}};
let result;try{result=await connectTerminal(sandbox)}catch(error){result=error.message} console.log('RESULT:'+JSON.stringify({result,raw:process.stdin.isRaw,listeners:process.stdin.listenerCount('data'),resizes,disconnected}));`);
  const tsx = fileURLToPath(new URL("../../node_modules/tsx/dist/esm/index.mjs", import.meta.url));
  const program = `import os,pty,select,signal,subprocess,sys,time,fcntl,termios,struct,json
master,slave=pty.openpty()
p=subprocess.Popen([sys.argv[1],'--import',sys.argv[2],sys.argv[3]],stdin=slave,stdout=slave,stderr=slave,close_fds=True)
os.close(slave)
data=b''; sent=False; deadline=time.time()+12
try:
 while time.time()<deadline:
  if select.select([master],[],[],0.1)[0]:
   try: chunk=os.read(master,65536)
   except OSError: break
   data+=chunk
  if b'READY' in data and not sent:
   fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',40,100,0,0));os.kill(p.pid,signal.SIGWINCH);time.sleep(0.1)
   if 'signal' in sys.argv[4]: os.kill(p.pid,signal.SIGINT)
   else: os.write(master,b'hello\\n')
   sent=True
  if p.poll() is not None: break
 p.wait(timeout=2)
 while select.select([master],[],[],0.1)[0]:
  try: data+=os.read(master,65536)
  except OSError: break
 print(data.decode(errors='replace'))
 if p.returncode!=0:sys.exit(1)
finally:
 if p.poll() is None:p.kill();p.wait()
 os.close(master)
`;
  const result = spawnSync("python3", ["-c", program, process.execPath, tsx, fixture, mode], { encoding: "utf8", timeout: 16000 });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const record = /RESULT:(\{[^\r\n]+\})/.exec(result.stdout);
  expect(record, result.stdout).not.toBeNull();
  expect(JSON.parse(record![1]!)).toMatchObject({ raw: false, listeners: 0 });
  if (mode === "failed-signal" || mode === "hung-signal") { expect(JSON.parse(record![1]!).result).toContain("unconfirmed"); expect(JSON.parse(record![1]!).disconnected).toBe(true); }
  else expect(JSON.parse(record![1]!).result).toBe(mode === "signal" ? 130 : 7);
  expect(JSON.parse(record![1]!).resizes).toBeGreaterThan(0);
});

it("interrupts a remote exec even while piped stdin remains open", async () => {
  const fixture = path.join(directory, "exec-signal.mts");
  const session = fileURLToPath(new URL("../../src/standard_cli/session.ts", import.meta.url));
  const signals = fileURLToPath(new URL("../../src/standard_cli/signals.ts", import.meta.url));
  writeFileSync(fixture, `import {execute} from ${JSON.stringify(session)}; import {remoteSignalActive} from ${JSON.stringify(signals)};
process.on('SIGINT',()=>{if(!remoteSignalActive())process.exit(99)});
let finish;const done=new Promise(resolve=>{finish=resolve});let killed=false;
const sandbox={commands:{supportsStdinClose:true,run:async()=>({pid:7,wait:()=>{console.log('READY');return done},kill:async()=>{killed=true;finish({exitCode:130})}}),sendStdin:async()=>{},closeStdin:async()=>{},kill:async()=>{}}};
const result=await execute(sandbox,'fixture',{onStdout:()=>{},onStderr:()=>{}});console.log('RESULT:'+JSON.stringify({exit:result.exitCode,killed,owned:remoteSignalActive()}));`);
  const tsx = fileURLToPath(new URL("../../node_modules/tsx/dist/esm/index.mjs", import.meta.url));
  const child = spawn(process.execPath, ["--import", tsx, fixture], { stdio: "pipe" });
  let stdout = "", stderr = "", sent = false;
  child.stdout.on("data", data => { stdout += data; if (!sent && stdout.includes("READY")) { sent = true; child.kill("SIGINT"); } });
  child.stderr.on("data", data => { stderr += data; });
  const exit = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Exec did not stop after SIGINT with open stdin")); }, 5000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); resolve(code); });
  });
  expect(exit, stdout + stderr).toBe(0);
  expect(stdout).toContain('RESULT:{"exit":130,"killed":true,"owned":false}');
});

it.each(["reject", "hang"])("bounds interruption when remote kill %s and wait never settles", async failure => {
  const fixture = path.join(directory, `exec-kill-${failure}.mts`);
  const session = fileURLToPath(new URL("../../src/standard_cli/session.ts", import.meta.url));
  const signals = fileURLToPath(new URL("../../src/standard_cli/signals.ts", import.meta.url));
  writeFileSync(fixture, `import {execute} from ${JSON.stringify(session)}; import {remoteSignalActive} from ${JSON.stringify(signals)};
let disconnected=false; const failure=${JSON.stringify(failure)};
const sandbox={commands:{supportsStdinClose:true,run:async()=>({pid:7,wait:()=>{console.log('READY');return new Promise(()=>{})},kill:async()=>{if(failure==='reject')throw new Error('kill failed');return new Promise(()=>{})},disconnect:async()=>{disconnected=true}}),sendStdin:async()=>{},closeStdin:async()=>{}}};
try{await execute(sandbox,'fixture',{onStdout:()=>{},onStderr:()=>{}})}catch(error){console.log('RESULT:'+JSON.stringify({message:error.message,disconnected,owned:remoteSignalActive()}))}`);
  const tsx = fileURLToPath(new URL("../../node_modules/tsx/dist/esm/index.mjs", import.meta.url));
  const child = spawn(process.execPath, ["--import", tsx, fixture], { stdio: "pipe" });
  let stdout = "", stderr = "", sent = false;
  child.stdout.on("data", data => { stdout += data; if (!sent && stdout.includes("READY")) { sent = true; child.kill("SIGINT"); } }); child.stderr.on("data", data => { stderr += data; });
  const exit = await new Promise<number | null>((resolve, reject) => { const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Interrupted exec remained blocked")); }, 5000); child.once("error", error => { clearTimeout(timer); reject(error); }); child.once("exit", code => { clearTimeout(timer); resolve(code); }); });
  expect(exit, stdout + stderr).toBe(0); expect(stdout).toContain("unconfirmed"); expect(stdout).toContain('"disconnected":true,"owned":false');
});

it.each([false, true])("enforces a total execution deadline for a real process (continuous output: %s)", async noisy => {
  const child = spawn(process.execPath, ["-e", noisy ? "setInterval(()=>process.stdout.write('tick\\n'),10)" : "setInterval(()=>{},1000)"], { stdio: "pipe" });
  const done = new Promise<{ exitCode: number }>(resolve => child.once("exit", code => resolve({ exitCode: code ?? 137 })));
  let output = "", kills = 0, disconnected = false;
  const sandbox = { commands: { kill: async () => { kills++; child.kill(); }, run: async (_command: string, options: { onStdout(data: string): void }) => {
    child.stdout.on("data", data => options.onStdout(String(data)));
    return { pid: child.pid, wait: () => done, disconnect: async () => { disconnected = true; } };
  } } } as unknown as Sandbox;
  const start = Date.now();
  try {
    await expect(execute(sandbox, "fixture", { stdin: false, timeoutMs: 300, onStdout: data => { output += data; }, onStderr: () => {} })).rejects.toMatchObject({ code: "E3001", message: expect.stringContaining(`; pid ${child.pid} was asked to stop`) });
    expect(Date.now() - start).toBeLessThan(1500); expect(kills).toBe(1); expect(disconnected).toBe(true);
    await done; // Independently observe the child exit instead of treating kill acceptance as proof.
    expect(child.signalCode).toBe("SIGTERM"); if (noisy) expect(output).toContain("tick");
    expect(remoteSignalActive()).toBe(false);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});

it.each(["reject", "hang"])("bounds deadline cleanup when remote kill %s", async failure => {
  let disconnected = false;
  let signal: AbortSignal | undefined;
  const sandbox = { commands: { kill: async (_pid: number, options: { signal: AbortSignal; requestTimeoutMs: number }) => {
    signal = options.signal; expect(options.requestTimeoutMs).toBe(2000);
    if (failure === "reject") throw new Error("private provider response"); return new Promise(() => {});
  }, run: async () => ({ pid: 7, wait: () => new Promise(() => {}), disconnect: async () => { disconnected = true; } }) } } as unknown as Sandbox;
  const start = Date.now();
  await expect(execute(sandbox, "fixture", { stdin: false, timeoutMs: 20, onStdout: () => {}, onStderr: () => {} })).rejects.toMatchObject({ code: "E3001", message: expect.stringContaining("Remote termination is unconfirmed") });
  expect(Date.now() - start).toBeLessThan(2800); expect(signal?.aborted).toBe(true); expect(disconnected).toBe(true); expect(remoteSignalActive()).toBe(false);
});

it("aborts a timed out start and cleans a late acknowledgement without repeating the command", async () => {
  let calls = 0, kills = 0, disconnected = false, signal: AbortSignal | undefined;
  const sandbox = { commands: { kill: async () => { kills++; }, run: async (_command: string, options: { signal: AbortSignal }) => {
    calls++; signal = options.signal;
    await new Promise(resolve => setTimeout(resolve, 80));
    return { pid: 9, wait: () => new Promise(() => {}), disconnect: async () => { disconnected = true; } };
  } } } as unknown as Sandbox;
  await expect(execute(sandbox, "fixture", { stdin: false, timeoutMs: 20, onStdout: () => {}, onStderr: () => {} })).rejects.toMatchObject({ code: "E3001", message: expect.stringContaining("process ID was not acknowledged") });
  expect(signal?.aborted).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 120));
  expect(calls).toBe(1); expect(kills).toBe(1); expect(disconnected).toBe(true);
});

it("does not retain a CLI deadline after detaching a background command", async () => {
  let kills = 0; let signal: AbortSignal | undefined;
  const sandbox = { commands: { kill: async () => { kills++; }, run: async (_command: string, options: { signal: AbortSignal; timeoutMs: number }) => {
    signal = options.signal; expect(options.timeoutMs).toBe(20);
    return { pid: 9, wait: () => new Promise(() => {}), kill: async () => { kills++; }, disconnect: async () => {} };
  } } } as unknown as Sandbox;
  expect(await execute(sandbox, "fixture", { background: true, stdin: false, timeoutMs: 20, onStdout: () => {}, onStderr: () => {} })).toEqual({ pid: 9, exitCode: 0 });
  await new Promise(resolve => setTimeout(resolve, 60)); expect(kills).toBe(0); expect(signal?.aborted).toBe(false);
});

it("preserves an SDK request timeout instead of guessing it was the command deadline", async () => {
  const error = Object.assign(new Error("request timed out"), { name: "TimeoutError" });
  const sandbox = { commands: { run: async () => { throw error; } } } as unknown as Sandbox;
  await expect(execute(sandbox, "fixture", { stdin: false, timeoutMs: 500, onStdout: () => {}, onStderr: () => {} })).rejects.toBe(error);
});

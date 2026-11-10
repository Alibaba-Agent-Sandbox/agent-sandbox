import { claimRemoteSignals } from "./signals.js";
import { CommandTimeoutError } from "../models/errors.js";
import type { CommandHandle } from "e2b";
/**
 * Terminal and stdin handling adapted from @e2b/cli 2.20.0, Apache-2.0.
 * Original: src/terminal.ts, src/commands/sandbox/exec{,_helpers}.ts.
 * Attribution and pinned source provenance: vendor/e2b-cli and THIRD_PARTY_NOTICES.txt.
 * This module contains no command parser or global configuration mutation.
 */
import { fstatSync } from "node:fs";
import { constants } from "node:os";
import { CommandExitError, NotFoundError, type Sandbox } from "./runtime.mjs";

export interface SessionOptions { cwd?: string; user?: string; envs?: Record<string, string>; timeoutMs?: number }

export class RemoteInterruptionError extends Error {
  constructor() { super("Interrupted; remote process termination is unconfirmed. Inspect the sandbox process before retrying."); this.name = "RemoteInterruptionError"; }
}

/** Stop waiting locally within two seconds even if the remote kill request cannot finish. */
export function remoteSignals(kill: () => Promise<unknown>, disconnect?: () => Promise<unknown>): { interruption: Promise<never>; close(): void } {
  const signals = (["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "SIGABRT", "SIGPIPE"] as NodeJS.Signals[]).filter(signal => signal in constants.signals);
  const release = claimRemoteSignals();
  let reject!: (error: Error) => void;
  const interruption = new Promise<never>((_resolve, fail) => { reject = fail; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false, requested = false;
  const uncertain = (): void => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    // disconnect closes the local stream; it does not promise remote process deletion.
    if (disconnect) void disconnect().catch(() => {});
    reject(new RemoteInterruptionError());
  };
  const handler = (): void => {
    if (requested) return;
    requested = true;
    timer = setTimeout(uncertain, 2000);
    void kill().catch(uncertain);
  };
  for (const signal of signals) process.on(signal, handler);
  return { interruption, close: () => {
    closed = true;
    if (timer) clearTimeout(timer);
    for (const signal of signals) process.removeListener(signal, handler);
    release();
  } };
}

export function isPipedStdin(): boolean {
  try { const stat = fstatSync(0); return !stat.isCharacterDevice() && (stat.isFIFO() || stat.isFile() || stat.isSocket()); }
  catch { return false; }
}

/** Await each write; stdin is never collected in an unbounded intermediate buffer. */
export async function sendStdin(sandbox: Sandbox, pid: number, input: AsyncIterable<Uint8Array | string> = process.stdin, signal?: AbortSignal): Promise<void> {
  const stop = (): void => { if ("destroy" in input && typeof input.destroy === "function") input.destroy(); };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    for await (const data of input) {
      const bytes = Buffer.from(data);
      for (let offset = 0; offset < bytes.length; offset += 65536) await sandbox.commands.sendStdin(pid, bytes.subarray(offset, offset + 65536));
    }
    if (!signal?.aborted) await sandbox.commands.closeStdin(pid);
  } catch (error) {
    if (signal?.aborted || error instanceof NotFoundError) return; // The remote process already exited or local interruption stopped input.
    await sandbox.commands.kill(pid).catch(() => {});
    throw error;
  } finally { signal?.removeEventListener("abort", stop); }
}

export async function execute(sandbox: Sandbox, command: string, options: SessionOptions & {
  background?: boolean; stdin?: boolean; onStdout: (data: string) => void; onStderr: (data: string) => void;
}): Promise<{ pid: number; exitCode: number }> {
  const piped = options.stdin ?? isPipedStdin();
  const stdin = piped && sandbox.commands.supportsStdinClose;
  if (piped && !stdin) options.onStderr("Piped stdin is not supported by this sandbox version; input is ignored. Rebuild its template for stdin EOF support.\n");
  const requestAbort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Error("CLI execution deadline");
  const deadline = new Promise<never>((_resolve, reject) => {
    if (options.timeoutMs && options.timeoutMs > 0) timer = setTimeout(() => {
      reject(expired); // Own the classification before aborting the SDK request/stream.
      requestAbort.abort();
    }, options.timeoutMs);
  });
  const clearDeadline = (): void => { if (timer) clearTimeout(timer); timer = undefined; };
  let handle: CommandHandle | undefined;
  let abandoned = false;
  // A successful kill request is not proof of remote termination. Bound local cleanup.
  const stop = async (process: CommandHandle): Promise<void> => {
    const cleanupAbort = new AbortController();
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => sandbox.commands.kill(process.pid, { requestTimeoutMs: 2000, signal: cleanupAbort.signal })).catch(() => {}),
        new Promise<void>(resolve => { cleanupTimer = setTimeout(resolve, 2000); }),
      ]);
    } finally {
      if (cleanupTimer) clearTimeout(cleanupTimer);
      cleanupAbort.abort();
      void process.disconnect().catch(() => {});
    }
  };
  try {
    const starting = sandbox.commands.run(command, { background: true, cwd: options.cwd, user: options.user, envs: options.envs,
      timeoutMs: options.timeoutMs ?? 0, ...(options.timeoutMs && options.timeoutMs > 0 ? { signal: requestAbort.signal } : {}),
      stdin, onStdout: options.onStdout, onStderr: options.onStderr }).then(process => {
      handle = process;
      // A late start acknowledgement must never cause a second execution attempt.
      if (abandoned) void stop(process);
      return process;
    });
    const active = await Promise.race([starting, deadline]);
    // A detached command keeps the SDK's explicit timeout contract, not a CLI timer.
    if (options.background) clearDeadline();
    const inputAbort = new AbortController();
    const signals = remoteSignals(async () => { inputAbort.abort(); await active.kill(); }, () => active.disconnect());
    const input = stdin ? sendStdin(sandbox, active.pid, process.stdin, inputAbort.signal) : Promise.resolve();
    try {
      if (options.background) await Promise.race([input, signals.interruption]);
      if (options.background) { await active.disconnect(); return { pid: active.pid, exitCode: 0 }; }
      // Race input errors with remote completion; normal EOF keeps waiting for the remote exit.
      const inputFailure = input.then(() => new Promise<never>(() => {}));
      try { return { pid: active.pid, exitCode: (await Promise.race([active.wait(), inputFailure, signals.interruption, deadline])).exitCode }; }
      catch (error) { if (error instanceof CommandExitError) return { pid: active.pid, exitCode: error.exitCode }; throw error; }
    } finally { inputAbort.abort(); void input.catch(() => {}); signals.close(); }
  } catch (error) {
    if (error === expired) {
      abandoned = true;
      if (handle) await stop(handle);
      const target = handle ? `; pid ${handle.pid} was asked to stop` : "; process ID was not acknowledged";
      throw new CommandTimeoutError(`Command execution deadline exceeded${target}. Remote termination is unconfirmed; inspect the sandbox process before retrying.`);
    }
    if (handle) {
      if (!(error instanceof RemoteInterruptionError)) void handle.kill().catch(() => {});
      void handle.disconnect().catch(() => {});
    }
    throw error;
  } finally { clearDeadline(); }
}

export async function connectTerminal(sandbox: Sandbox, options: SessionOptions = {}): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Terminal connection requires an interactive TTY. Use sandbox exec for piped commands.");
  const previousRaw = process.stdin.isRaw;
  const size = (): { cols: number; rows: number } => ({ cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 });
  process.stdin.setRawMode(true);
  let pending = Promise.resolve();
  let failure: unknown;
  let cleanup = (): void => {};
  try {
    const terminal = await sandbox.pty.create({ ...size(), ...options, timeoutMs: 0, onData: data => { process.stdout.write(data); } });
    const signals = remoteSignals(() => terminal.kill(), () => terminal.disconnect());
    const data = (chunk: Buffer): void => {
      // Pause input until the previous SDK write completes; preserve input ordering and backpressure.
      process.stdin.pause();
      pending = pending.then(() => sandbox.pty.sendInput(terminal.pid, chunk)).catch(error => { failure = error; void terminal.kill().catch(() => {}); }).finally(() => process.stdin.resume());
    };
    const resize = (): void => { void sandbox.pty.resize(terminal.pid, size()).catch(error => { failure = error; void terminal.kill().catch(() => {}); }); };
    process.stdin.on("data", data); process.stdout.on("resize", resize); process.stdin.resume();
    cleanup = () => { process.stdin.off("data", data); process.stdout.off("resize", resize); process.stdin.pause(); signals.close(); };
    let exitCode: number;
    try { exitCode = (await Promise.race([terminal.wait(), signals.interruption])).exitCode; }
    catch (error) { if (error instanceof CommandExitError) exitCode = error.exitCode; else throw error; }
    await Promise.race([pending, signals.interruption]);
    if (failure) throw failure;
    return exitCode;
  } finally { cleanup(); process.stdin.setRawMode(previousRaw); }
}

/** Bounded argv execution with synchronous signal cleanup and private result transport. */
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { ApplicationError } from "./config.js";

export interface ProcessInput {
  argv: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutSeconds: number;
  maxBytes?: number;
  privateResult?: boolean;
  onPrivateData?: (data: string) => void;
  /** Optional FD 4 event stream, independent of the private FD 3 result. */
  onEventData?: (data: string) => void;
  /** Raw child streams for host actions; callers own line buffering and redaction. */
  onOutput?: (stream: "stdout" | "stderr", data: string) => void;
}
/** Raw tool output is deliberately not placed in errors or deployment receipts. */
export async function execute(input: ProcessInput): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.argv[0], input.argv.slice(1), { cwd: input.cwd, env: input.env, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe", ...(input.privateResult || input.onEventData ? [input.privateResult ? "pipe" as const : "ignore" as const] : []), ...(input.onEventData ? ["pipe" as const] : [])] });
    let output = "", size = 0, failure: string | null = null, settled = false;
    const resultDecoder = new StringDecoder("utf8"), eventDecoder = new StringDecoder("utf8");
    const outputDecoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
    const kill = (): void => { try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* Already absent. */ } };
    const stop = (message: string): void => { failure ??= message; kill(); };
    // The CLI's existing SIGINT handler exits synchronously. Prepend cleanup so it runs first.
    const signal = (): void => stop("Application child was cancelled; external results may require reconciliation.");
    process.prependListener("SIGINT", signal); process.prependListener("SIGTERM", signal);
    const timer = setTimeout(() => stop("Application child exceeded its deadline."), input.timeoutSeconds * 1000);
    const finish = (error?: Error): void => {
      if (settled) return; settled = true; clearTimeout(timer);
      process.removeListener("SIGINT", signal); process.removeListener("SIGTERM", signal); kill();
      if (error) reject(error); else resolve(output);
    };
    const receive = (data: Buffer, result: boolean): void => {
      size += data.length;
      if (size > (input.maxBytes ?? 1024 * 1024)) stop("Application child exceeded its output budget.");
      else if (result) {
        const text = resultDecoder.write(data); output += text;
        try { input.onPrivateData?.(text); }
        catch { stop("Private preparation progress could not be durably recorded."); }
      }
    };
    const receiveOutput = (stream: "stdout" | "stderr", data: Buffer): void => {
      receive(data, stream === "stdout" && !input.privateResult);
      if (!failure) try { input.onOutput?.(stream, outputDecoders[stream].write(data)); }
      catch { stop("Application output could not be processed."); }
    };
    child.stdout?.on("data", (data: Buffer) => receiveOutput("stdout", data));
    child.stderr?.on("data", (data: Buffer) => receiveOutput("stderr", data));
    if (input.privateResult) (child.stdio[3] as Readable).on("data", (data: Buffer) => receive(data, true));
    if (input.onEventData) (child.stdio[4] as Readable).on("data", (data: Buffer) => {
      receive(data, false);
      if (!failure) try { input.onEventData?.(eventDecoder.write(data)); }
      catch { stop("Component log events could not be processed."); }
    });
    child.once("error", () => finish(new ApplicationError("Application child could not start; verify its prerequisites.")));
    child.once("close", code => finish(failure || code !== 0 ? new ApplicationError(failure ?? `Application child failed (exit ${code}); raw output withheld.`) : undefined));
    child.stdin?.on("error", () => { /* close/error establishes the final child outcome. */ });
    child.stdin?.end(input.input ?? "");
  });
}

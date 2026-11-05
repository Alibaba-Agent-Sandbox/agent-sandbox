/** Bounded argv execution with synchronous signal cleanup and private result transport. */
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
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
}
/** Raw tool output is deliberately not placed in errors or deployment receipts. */
export async function execute(input: ProcessInput): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.argv[0], input.argv.slice(1), { cwd: input.cwd, env: input.env, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe", ...(input.privateResult ? ["pipe" as const] : [])] });
    let output = "", size = 0, failure: string | null = null, settled = false;
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
        output += data.toString("utf8");
        try { input.onPrivateData?.(data.toString("utf8")); }
        catch { stop("Private preparation progress could not be durably recorded."); }
      }
    };
    child.stdout?.on("data", (data: Buffer) => receive(data, !input.privateResult));
    child.stderr?.on("data", (data: Buffer) => receive(data, false));
    if (input.privateResult) (child.stdio[3] as Readable).on("data", (data: Buffer) => receive(data, true));
    child.once("error", () => finish(new ApplicationError("Application child could not start; verify its prerequisites.")));
    child.once("close", code => finish(failure || code !== 0 ? new ApplicationError(failure ?? `Application child failed (exit ${code}); raw output withheld.`) : undefined));
    child.stdin?.on("error", () => { /* close/error establishes the final child outcome. */ });
    child.stdin?.end(input.input ?? "");
  });
}

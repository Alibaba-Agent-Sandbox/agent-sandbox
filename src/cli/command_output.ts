/** Capture one JSON command result without buffering an unbounded remote stream. */
import { ExecutionError } from "../models/errors.js";

export class CommandOutputCapture {
  private readonly limit = 16 * 1024 * 1024;
  private bytes = 0;
  private exceeded = false;
  private stdout = "";
  private stderr = "";

  append(channel: "stdout" | "stderr", data: string): void {
    if (this.exceeded) return;
    this.bytes += Buffer.byteLength(data, "utf8");
    if (this.bytes > this.limit) {
      this.exceeded = true;
      this.stdout = this.stderr = "";
      return;
    }
    this[channel] += data;
  }

  result(exitCode: number): { stdout: string; stderr: string; exit_code: number } {
    if (this.exceeded) throw new ExecutionError(`JSON command output exceeded 16 MiB; the command finished with exit code ${exitCode}. Output was not returned.`, {
      suggestion: "Save large command output to a sandbox file and download it, or use human streaming output.",
    });
    return { stdout: this.stdout, stderr: this.stderr, exit_code: exitCode };
  }
}

/** Bounded child processes. Output is never copied to receipts or error messages. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import requestSchema from "./hook-request.schema.json" with { type: "json" };
import resultSchema from "./hook-result.schema.json" with { type: "json" };
import { ApplicationError, contained } from "./config.js";
import type { ApplicationPlan, Hook } from "./types.js";

const ajv = new Ajv2020({ strict: false });
const validateRequest = ajv.compile(requestSchema), validateResult = ajv.compile(resultSchema);

export interface ProcessRequest { argv: string[]; cwd: string; env: NodeJS.ProcessEnv; timeoutSeconds: number; maxBytes?: number }
/** Execute argv directly, cap both output streams and terminate the process group on failure. */
export async function execute(request: ProcessRequest): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(request.argv[0], request.argv.slice(1), { cwd: request.cwd, env: request.env, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", size = 0, failure: string | null = null;
    const stop = (reason: string): void => {
      if (failure) return; failure = reason;
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* The process may already have exited. */ }
    };
    const timer = setTimeout(() => stop("Child process exceeded its deadline."), request.timeoutSeconds * 1000);
    const receive = (data: Buffer, output: boolean): void => {
      size += data.length;
      if (size > (request.maxBytes ?? 1024 * 1024)) stop("Child process exceeded its output budget.");
      else if (output) stdout += data.toString("utf8");
    };
    child.stdout.on("data", (data: Buffer) => receive(data, true));
    child.stderr.on("data", (data: Buffer) => receive(data, false));
    child.on("error", () => { clearTimeout(timer); reject(new ApplicationError("Child process could not start; verify the locked executable and prerequisites.")); });
    child.on("close", code => {
      clearTimeout(timer);
      // A successful parent must not leave same-group background children behind.
      if (process.platform !== "win32" && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Group already empty. */ } }
      if (failure || code !== 0) reject(new ApplicationError(failure ?? `Child process failed (exit ${code}); raw output withheld because it may contain credentials.`));
      else resolve(stdout);
    });
  });
}
/** Strict file-based hook protocol; stdout/stderr are diagnostics only. */
export async function runHook(hook: Hook, phase: "beforeApply" | "afterReady", plan: ApplicationPlan, operationId: string, resources: { logicalId: string; nativeId: string; ownership: "owned" | "borrowed" }[] = []): Promise<void> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "abx-app-hook-"));
  try {
    const context = path.join(scratch, "context.json"), result = path.join(scratch, "result.json");
    const request = { schemaVersion: 1, hookId: hook.id, phase, applicationId: plan.template.name,
      revision: plan.id, operationId, planId: plan.id, inputDirectory: plan.projectRoot, resources };
    if (!validateRequest(request)) throw new ApplicationError("Invalid hook request contract.");
    fs.writeFileSync(context, JSON.stringify(request), { mode: 0o600 });
    const env: NodeJS.ProcessEnv = {};
    for (const name of ["PATH", "SYSTEMROOT", ...hook.envAllowlist]) if (process.env[name] !== undefined) env[name] = process.env[name];
    env.ABX_HOOK_CONTEXT_FILE = context; env.ABX_HOOK_RESULT_FILE = result;
    await execute({ argv: hook.argv, cwd: contained(plan.projectRoot, hook.cwd), env, timeoutSeconds: hook.timeoutSeconds, maxBytes: 65536 });
    const stat = fs.lstatSync(result);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new ApplicationError("Hook result must be a regular JSON file of at most 64 KiB.");
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(result))) as Record<string, unknown>;
    if (!validateResult(raw) || raw.hookId !== hook.id || raw.operationId !== operationId || raw.status !== "passed") throw new ApplicationError("Hook returned an invalid or mismatched result.");
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("Hook did not produce a valid result file.");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
/** Generate operation identifiers independently of public run/session IDs. */
export const operationId = (): string => `op_${randomUUID()}`;

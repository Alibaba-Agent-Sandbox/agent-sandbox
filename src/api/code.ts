/** Project code interpreter entrypoint. Interpreter failures retain their original diagnosis. */
import { CodeResult } from "../models/process.js";
import type { CodeInterpreterProtocol } from "../protocol/contracts.js";
import type { DataPlaneAuth as EnvdTokenManager } from "../transport/auth_contract.js";
import { ProviderFeatureNotSupportedError } from "../models/provider_errors.js";
import { dictGet } from "../utils/_pyerrors.js";
import { pyStrip } from "../utils/_pyformat.js";

export interface CodeRunOptions {
  language?: string;
  operation?: "code.execute" | "code.default-context.execute";
  timeout?: number;
  context_id?: string | null;
  envs?: Record<string, string> | null;
  on_stdout?: ((s: string) => void) | null;
  on_stderr?: ((s: string) => void) | null;
  on_result?: ((r: any) => void) | null;
}

/** Execute only the selected interpreter operation; process execution is a separate API. */
export class CodeContextModule {
  constructor(
    readonly _sandbox_id: string,
    readonly _envd_url: string,
    readonly _envd_token: EnvdTokenManager,
    readonly _code: CodeInterpreterProtocol,
    readonly _capabilities: Set<string> = new Set<string>(),
  ) {}

  private require(operation: string): void {
    const operations = this._code.operations;
    if (!operations || typeof operations.has !== "function" || !operations.has(operation)) throw new ProviderFeatureNotSupportedError("selected", operation);
  }

  /** Execute a stateless request, or the explicitly named persistent context. */
  async run(code: string, opts: CodeRunOptions = {}): Promise<CodeResult> {
    const { language = "python", timeout = 30, context_id = null, envs = null,
      on_stdout = null, on_stderr = null, on_result = null } = opts;
    if (opts.operation !== undefined && !["code.execute", "code.default-context.execute"].includes(opts.operation)) throw new TypeError("Unknown interpreter operation.");
    if (context_id !== null && opts.operation === "code.default-context.execute") throw new TypeError("Explicit and default contexts cannot be combined.");
    const operation = context_id === null ? (opts.operation ?? "code.execute") : "code.context.execute";
    this.require(operation);
    if (typeof code !== "string" || typeof language !== "string" || !language || !Number.isSafeInteger(timeout) || timeout <= 0 ||
      (context_id !== null && (typeof context_id !== "string" || !context_id))) throw new TypeError("Invalid interpreter input.");
    let executionContext = context_id;
    if (operation === "code.execute") {
      this.require("code.context.create"); this.require("code.context.execute"); this.require("code.context.delete");
      const created = await this._code.createContext(this._sandbox_id, this._envd_url, this._envd_token, { language });
      if (typeof created["contextId"] !== "string" || !created["contextId"]) throw new TypeError("Interpreter returned no context identity.");
      executionContext = created["contextId"];
    }
    let response: Record<string, any> | undefined;
    let executionError: unknown;
    let executionFailed = false;
    try {
      response = await this._code.runCode(this._sandbox_id, this._envd_url, this._envd_token,
        { code, language, context_id: executionContext, timeout, envs, on_stdout, on_stderr, on_result });
    } catch (error) { executionFailed = true; executionError = error; }
    if (operation === "code.execute" && executionContext !== null) {
      try { await this._code.removeContext(this._sandbox_id, this._envd_url, this._envd_token, { context_id: executionContext }); }
      catch (cleanupError) {
        if (executionFailed) throw new AggregateError([executionError, cleanupError], "Interpreter execution failed and temporary context cleanup could not be confirmed.", {cause: cleanupError});
        throw cleanupError;
      }
    }
    if (executionFailed) throw executionError;
    if (response === undefined) throw new TypeError("Interpreter returned no execution result.");
    const result = dictGet(response, "result", response);
    return new CodeResult({ text: pyStrip(dictGet(result, "text", dictGet(result, "stdout", ""))),
      stdout: dictGet(result, "stdout", ""), stderr: dictGet(result, "stderr", ""),
      exit_code: dictGet(result, "exitCode", dictGet(result, "exit_code", 0)),
      execution_time: dictGet(result, "executionTime", dictGet(result, "execution_time", 0.0)) });
  }

  /** Create an explicit persistent execution context. */
  async createContext(opts: { language?: string } = {}): Promise<Record<string, any>> {
    this.require("code.context.create");
    return this._code.createContext(this._sandbox_id, this._envd_url, this._envd_token, opts);
  }
  /** List persistent execution contexts. */
  async listContexts(): Promise<Record<string, any>[]> {
    this.require("code.context.list");
    return this._code.listContexts(this._sandbox_id, this._envd_url, this._envd_token);
  }
  /** Restart the specified persistent context. */
  async restartContext(context_id: string): Promise<Record<string, any>> {
    this.require("code.context.restart");
    return this._code.restartContext(this._sandbox_id, this._envd_url, this._envd_token, { context_id });
  }
  /** Delete the specified persistent context. */
  async removeContext(context_id: string): Promise<void> {
    this.require("code.context.delete");
    await this._code.removeContext(this._sandbox_id, this._envd_url, this._envd_token, { context_id });
  }
}

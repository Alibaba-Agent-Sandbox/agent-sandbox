/**
 * Code Interpreter 协议层 (port of `protocol/code_interpreter.py`).
 *
 * 注意：当前实现基于 E2B SDK 逆向推断，阿里云官方文档未公开 Code Interpreter 的底层传输细节。需实测验证。
 *
 * Uses Connect RPC over HTTP with application/connect+json content type.
 *
 * RPC endpoints:
 * - /code.CodeInterpreter/Execute — Execute code in a context
 * - /code.CodeInterpreter/CreateContext — Create an execution context
 * - /code.CodeInterpreter/ListContexts — List execution contexts
 * - /code.CodeInterpreter/RestartContext — Restart an execution context
 * - /code.CodeInterpreter/RemoveContext — Remove an execution context
 */

import { ConnectCodec } from "../transport/codec.js";
import type { EnvdTokenManager } from "../transport/auth.js";
import type { HttpClient } from "../transport/http.js";
import { dictGet } from "../api/_pyerrors.js";
import { pyFloat } from "../utils/coerce.js";
import { getLogger } from "../utils/logging.js";

const logger = getLogger("protocol.code_interpreter");
void logger;

/** Extra seconds added to the caller-supplied timeout to derive the HTTP read timeout. Mirrors protocol.process. */
export const _HTTP_TIMEOUT_BUFFER = 5.0;

const _codec = new ConnectCodec();

// RPC paths — 注意：路径基于 E2B SDK 逆向推断，未经官方文档确认
const _EXECUTE = _codec.buildRpcPath("code", "CodeInterpreter", "Execute");
const _CREATE_CONTEXT = _codec.buildRpcPath("code", "CodeInterpreter", "CreateContext");
const _LIST_CONTEXTS = _codec.buildRpcPath("code", "CodeInterpreter", "ListContexts");
const _RESTART_CONTEXT = _codec.buildRpcPath("code", "CodeInterpreter", "RestartContext");
const _REMOVE_CONTEXT = _codec.buildRpcPath("code", "CodeInterpreter", "RemoveContext");

export interface RunCodeOptions {
  code: string;
  language?: string;
  context_id?: string | null;
  timeout?: number;
  envs?: Record<string, string> | null;
  on_stdout?: ((s: string) => void) | null;
  on_stderr?: ((s: string) => void) | null;
  on_result?: ((r: any) => void) | null;
}

/** Code Interpreter Connect RPC 协议客户端。 */
export class CodeInterpreterProtocol {
  _http: HttpClient;

  constructor(http_client: HttpClient) {
    this._http = http_client;
  }

  /**
   * 执行代码。对应官方 sandbox.runCode() / sandbox.run_code()。
   *
   * Buffered fallback path: Execute is a Connect unary RPC, so callbacks are invoked **once** after the full response
   * is received.
   */
  async runCode(
    sandbox_id: string,
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: RunCodeOptions,
  ): Promise<Record<string, any>> {
    void sandbox_id;
    const { code, language = "python", context_id = null, timeout = 30, envs = null, on_stdout = null, on_stderr = null, on_result = null } = opts;
    const payload: Record<string, unknown> = { code, language, timeout };
    if (context_id) payload["contextId"] = context_id;
    if (envs && Object.keys(envs).length) payload["envVars"] = envs;

    const http_timeout = pyFloat(timeout) + _HTTP_TIMEOUT_BUFFER;

    const response = await this._http.envdRequest(envd_url, _EXECUTE, {
      payload,
      envd_token,
      request_timeout: http_timeout,
    });

    if (on_stdout || on_stderr || on_result) {
      const result = dictGet(response, "result", response);
      const stdout = dictGet(result, "stdout", "");
      const stderr = dictGet(result, "stderr", "");

      if (on_stdout && stdout) on_stdout(stdout);
      if (on_stderr && stderr) on_stderr(stderr);
      if (on_result) on_result(result);
    }

    return response;
  }

  /** 创建执行上下文。对应官方 sandbox.createCodeContext()。 */
  async createContext(
    sandbox_id: string,
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: { language?: string } = {},
  ): Promise<Record<string, any>> {
    void sandbox_id;
    const { language = "python" } = opts;
    return this._http.envdRequest(envd_url, _CREATE_CONTEXT, { payload: { language }, envd_token });
  }

  /** 查询执行上下文列表。对应官方 sandbox.listCodeContexts()。 */
  async listContexts(sandbox_id: string, envd_url: string, envd_token: EnvdTokenManager): Promise<Record<string, any>[]> {
    void sandbox_id;
    const response = await this._http.envdRequest(envd_url, _LIST_CONTEXTS, { payload: {}, envd_token });
    return dictGet(response, "contexts", dictGet(dictGet(response, "result", {}), "contexts", []));
  }

  /** 重启执行上下文。对应官方 sandbox.restartCodeContext()。 */
  async restartContext(
    sandbox_id: string,
    envd_url: string,
    envd_token: EnvdTokenManager,
    opts: { context_id: string },
  ): Promise<Record<string, any>> {
    void sandbox_id;
    return this._http.envdRequest(envd_url, _RESTART_CONTEXT, { payload: { contextId: opts.context_id }, envd_token });
  }

  /** 删除执行上下文。对应官方 sandbox.removeCodeContext()。 */
  async removeContext(sandbox_id: string, envd_url: string, envd_token: EnvdTokenManager, opts: { context_id: string }): Promise<void> {
    void sandbox_id;
    await this._http.envdRequest(envd_url, _REMOVE_CONTEXT, { payload: { contextId: opts.context_id }, envd_token });
  }
}

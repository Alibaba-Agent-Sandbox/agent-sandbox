/** Session assembly for providers that explicitly choose the E2B/envd wire adapters. */
import type { SandboxInfo } from "../../../models/sandbox.js";
import type { ProviderInfra, TerminalContext, SessionProtocols } from "../../base.js";
import type { HttpClient } from "../../../transport/http.js";
import { EnvdTokenManager } from "./auth.js";
import { SandboxProtocol } from "./sandbox.js";
import { ProcessProtocol } from "./process.js";
import { FilesystemProtocol } from "./filesystem.js";
import { CodeInterpreterProtocol } from "./code_interpreter.js";
import { TerminalSession } from "./terminal.js";

export function sessionAuth(info: SandboxInfo, infra?: ProviderInfra): EnvdTokenManager {
  return new EnvdTokenManager(info.envd_access_token, info.sandbox_id, infra?.envd_auth);
}

export function sessionProtocols(http: HttpClient): SessionProtocols {
  return { sandbox_protocol: new SandboxProtocol(http), process_protocol: new ProcessProtocol(http),
    filesystem_protocol: new FilesystemProtocol(http), code_interpreter_protocol: new CodeInterpreterProtocol(http) };
}

export function openTerminal(context: TerminalContext, opts: { cols: number; rows: number; shell: string }): Promise<TerminalSession> {
  return TerminalSession.create(context.url, context.token, context.config, { ...opts, dial: context.http?._dial ?? null });
}

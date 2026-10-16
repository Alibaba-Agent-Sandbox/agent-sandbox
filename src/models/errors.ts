/**
 * Structured error hierarchy for Agent Sandbox (port of `agent_sandbox/models/errors.py`).
 *
 * 注意：错误码（如 E1001、E2001 等）为 SDK 内部定义，不是阿里云官方 API 返回的错误码。
 *
 * Every exception carries: code (str), message (str), suggestion (str), docs_url (str).
 * Error codes follow the pattern E{category}{sequence}:
 *   E1xxx = Authentication errors
 *   E2xxx = Sandbox creation errors
 *   E3xxx = Execution errors
 *   E4xxx = Filesystem errors
 *   E5xxx = Network errors
 *   E6xxx = Session errors
 *   E7xxx = Deploy, build, and Docker errors
 *
 * Port notes:
 *  - Python keyword arguments become an options object (`new SandboxError(msg, { code, suggestion, docs_url })`).
 *  - `str(exc)` -> `String(exc)` / `exc.toString()` / `exc.__str__()` (all identical); `exc.message` is the raw message
 *    exactly like Python's `exc.message`.
 *  - `code` / `suggestion` / `docs_url` are static class defaults (`SandboxError.code`) *and* instance fields that an
 *    options object may override (same as Python's class attribute + instance attribute shadowing).
 *  - `to_dict()` -> `toDict()`.
 */

import { pyStrRepr, pySorted } from "../utils/_pyformat.js";

export interface SandboxErrorOptions {
  code?: string | null;
  suggestion?: string | null;
  docs_url?: string | null;
}

/** Base exception for all Agent Sandbox errors. */
export class SandboxError extends Error {
  static code: string = "E0000";
  static suggestion: string = "";
  static docs_url: string = ""; // TODO: 待补充正式文档 URL

  declare message: string;
  code: string;
  suggestion: string;
  docs_url: string;

  constructor(message: string, options: SandboxErrorOptions = {}) {
    super(message);
    const ctor = new.target as typeof SandboxError;
    this.name = ctor.name;
    this.code = options.code ?? ctor.code;
    this.suggestion = options.suggestion ?? ctor.suggestion;
    this.docs_url = options.docs_url ?? ctor.docs_url;
  }

  /** Python `__str__`. */
  __str__(): string {
    const parts = [`[${this.code}] ${this.message}`];
    if (this.suggestion) parts.push(`  Suggestion: ${this.suggestion}`);
    return parts.join("\n");
  }

  override toString(): string {
    return this.__str__();
  }

  toDict(): Record<string, string> {
    return {
      code: this.code,
      message: this.message,
      suggestion: this.suggestion,
      docs_url: this.docs_url,
    };
  }
}

/**
 * Base for all authentication failures.
 */
export class AuthenticationError extends SandboxError {
  static override code = "E1000";
}

/**
 * API Key is invalid or missing.
 */
export class InvalidAPIKeyError extends AuthenticationError {
  static override code = "E1001";
  static override suggestion = "Check your E2B_API_KEY environment variable or pass sandbox_api_key.";
}

/**
 * Authentication token has expired.
 */
export class TokenExpiredError extends AuthenticationError {
  static override code = "E1002";
  static override suggestion = "The SDK should auto-refresh tokens. If this persists, check system clock synchronization.";
}

/**
 * AK/SK credentials are invalid.
 */
export class InvalidCredentialsError extends AuthenticationError {
  static override code = "E1003";
  static override suggestion = "Check ALICLOUD_ACCESS_KEY_ID and ALICLOUD_ACCESS_KEY_SECRET environment variables.";
}

/**
 * AK/SK to API Key token exchange failed.
 */
export class TokenExchangeError extends AuthenticationError {
  static override code = "E1004";
  static override suggestion = "Token exchange from AK/SK to Platform API key failed. Use E2B_API_KEY directly, or check AK/SK credentials and network connectivity.";
}

/**
 * Base for sandbox creation failures.
 */
export class SandboxCreationError extends SandboxError {
  static override code = "E2000";
}

/**
 * Specified template does not exist.
 */
export class TemplateNotFoundError extends SandboxCreationError {
  static override code = "E2001";
  static override suggestion = "Run 'abx template list' to see available templates.";
}

/**
 * Sandbox quota has been exceeded.
 */
export class QuotaExceededError extends SandboxCreationError {
  static override code = "E2002";
  static override suggestion = "Destroy idle sandboxes or request a quota increase.";
}

/**
 * Requested region is not available.
 */
export class RegionUnavailableError extends SandboxCreationError {
  static override code = "E2003";
  static override suggestion = "Try a different region or check service availability.";
}

/**
 * A matching template was found but its definition is malformed.
 *
 * Raised fail-closed by the capability resolver: when a template that
 * *matches* the requested id fails model validation, we refuse to fall
 * back to :data:`DEFAULT_CAPABILITIES` (which would silently widen the
 * granted permissions).
 */
export class TemplateParseError extends SandboxCreationError {
  static override code = "E2004";
  static override suggestion = "Fix the template.yaml (see the validation error above); capabilities are NOT granted until the template parses cleanly.";
}

/**
 * Qwen Code executable was not found on PATH or in ~/.abx/bin.
 */
export class QwenCodeNotInstalledError extends SandboxCreationError {
  static override code = "E2005";
  static override suggestion = "Install Qwen Code, then retry. Interactive install prompt: run the command again in a terminal. Or install manually via the official installer (see 'abx create --help'), or bypass AI generation with 'abx create --template <name>'.";
}

/**
 * Qwen Code is installed but no usable model credentials were found.
 */
export class QwenCodeCredentialError extends SandboxCreationError {
  static override code = "E2006";
  static override suggestion = "Configure the unified LLM API key for Qwen Code: 'abx config set llm_api_key <KEY>' (interactive: 'abx config init --llm'), or export DASHSCOPE_API_KEY / OPENAI_API_KEY.";
}

/**
 * Qwen Code failed to generate a valid Dockerfile / template.yaml.
 */
export class AICodegenError extends SandboxCreationError {
  static override code = "E2007";
  static override suggestion = "The AI generation step failed or produced incomplete files. Inspect the generated workspace (path shown above), then retry 'abx create \"<description>\"' or fall back to 'abx create --template <name>'.";
}

/**
 * Qwen Code did not finish within the wall-clock budget.
 *
 * Deliberately shares the E2007 code of :class:`AICodegenError`: to users
 * it remains one AI-generation error, while the research round can
 * classify the failure (``reason="timeout"``) without parsing messages
 * or leaking the raw stderr.
 */
export class QwenCodeTimeoutError extends AICodegenError {
  static override code = "E2007";
}

/**
 * Qwen Code could not be started (spawn failure before any run).
 *
 * Deliberately shares the E2007 code of :class:`AICodegenError`: to users
 * it remains one AI-generation error, while the research round can
 * classify the failure as an unavailable agent (``reason="agent-unavailable"``).
 */
export class QwenCodeStartupError extends AICodegenError {
  static override code = "E2007";
}

/**
 * The description stayed below the completeness threshold.
 *
 * Raised when the single-question clarification loop cannot be completed:
 * a non-interactive session (or JSON mode) would have to ask the user, or
 * the interactive user cancelled / hit EOF before reaching the threshold.
 */
export class DescriptionClarificationError extends SandboxCreationError {
  static override code = "E2008";
  static override suggestion = "Add the missing details (runtime, dependencies, entry command, ports, resources, data) to DESCRIPTION, or pass --yes/-y to generate from the current description anyway, or use 'abx create --template <name>'.";
}

/** No sandbox with the given ID exists (never created, expired or already killed). */
export class SandboxNotFoundError extends SandboxError {
  static override code = "E2009";
  static override suggestion = "Run 'abx list' to see the running sandboxes; a killed or expired sandbox cannot be reconnected.";
}

/**
 * Base for command/code execution failures.
 */
export class ExecutionError extends SandboxError {
  static override code = "E3000";
}

/**
 * Command execution timed out.
 */
export class CommandTimeoutError extends ExecutionError {
  static override code = "E3001";
  static override suggestion = "Increase the timeout parameter or check if the command is hanging.";
}

/** Process exited with non-zero code. */
export class ProcessError extends ExecutionError {
  static override code = "E3002";

  exit_code: number;
  stdout: string;
  stderr: string;

  constructor(
    message: string,
    options: SandboxErrorOptions & { exit_code?: number; stdout?: string; stderr?: string } = {},
  ) {
    const { exit_code = -1, stdout = "", stderr = "", ...rest } = options;
    super(message, rest);
    this.exit_code = exit_code;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/**
 * Code execution failed.
 */
export class CodeExecutionError extends ExecutionError {
  static override code = "E3003";
  static override suggestion = "Check code syntax and runtime dependencies in the sandbox template.";
}

/** Requested capability is not enabled for this sandbox/template. */
export class CapabilityNotSupportedError extends ExecutionError {
  static override code = "E3004";

  capability: string;

  constructor(capability: string, options: SandboxErrorOptions & { message?: string | null } = {}) {
    const { message, suggestion, ...rest } = options;
    const _message = message || `Capability '${capability}' is not supported by this sandbox template.`;
    const _suggestion =
      suggestion ||
      `Declare '${capability}' in the template's capabilities list ` +
        "(template.yaml) or use a template that supports it.";
    super(_message, { ...rest, suggestion: _suggestion });
    this.capability = capability;
  }
}

/**
 * Raised when a named command cannot be run: the sandbox has no SandboxServer (it is not running, not reachable, or
 * the template does not ship one) or the server has no command with that name.
 */
export class CommandNotFoundError extends ExecutionError {
  static override code = "E3005";

  command_name: string;

  constructor(
    name: string,
    options: SandboxErrorOptions & {
      server_status?: string;
    } = {},
  ) {
    const { server_status = "", suggestion, ...rest } = options;
    const parts = [`Command ${pyStrRepr(name)} not found.`];
    if (server_status) parts.push(`Server: ${server_status}.`);
    const _suggestion =
      suggestion ||
      "Check the command name against sandbox.list_commands() and make sure the SandboxServer is running " +
        "(sandbox.start_server()).";
    super(parts.join(" "), { ...rest, suggestion: _suggestion });
    this.command_name = name;
  }
}

/**
 * The sandbox envd rejected an RPC call with an HTTP error status.
 *
 * Raised by the transport layer (`HttpClient.envd_stream`) when the envd responds with HTTP >= 400 (e.g. a
 * `process.Process/Start` 500 for an unknown executable). Carries the *structured* envd JSON error body
 * (`envd_error`, parsed when the response body is JSON) so upper layers can map it to friendly messages, plus the
 * HTTP status and RPC path. The exception text deliberately avoids the full sandbox URL (which embeds the sandbox ID
 * / internal host) — only the RPC path is included, and no separate WARNING log is emitted by default.
 */
export class EnvdRpcError extends ExecutionError {
  static override code = "E3006";
  static override suggestion =
    "The sandbox envd rejected this RPC call. Check the command and " +
    "arguments, or run with 'abx -v' for the raw error response.";

  status_code: number;
  rpc_path: string;
  envd_error: Record<string, unknown> | null;
  body_text: string;

  constructor(
    message: string,
    options: SandboxErrorOptions & {
      status_code?: number;
      rpc_path?: string;
      envd_error?: Record<string, unknown> | null;
      body_text?: string;
    } = {},
  ) {
    const { status_code = 0, rpc_path = "", envd_error = null, body_text = "", ...rest } = options;
    super(message, rest);
    this.status_code = status_code;
    this.rpc_path = rpc_path;
    this.envd_error = envd_error;
    this.body_text = body_text;
  }
}

/**
 * Base for filesystem operation failures.
 */
export class FileOperationError extends SandboxError {
  static override code = "E4000";
}

/**
 * File or directory not found in sandbox.
 */
export class FileNotFoundError_ extends FileOperationError {
  static override code = "E4001";
  static override suggestion = "Use files.list() to check available files, or files.exists() to verify path.";
}

/**
 * Permission denied for file operation.
 */
export class PermissionDeniedError extends FileOperationError {
  static override code = "E4002";
  static override suggestion = "Check file permissions in the sandbox.";
}

/**
 * Base for session management failures.
 */
export class SessionError extends SandboxError {
  static override code = "E6000";
}

/**
 * Session not found in the store.
 */
export class SessionNotFoundError extends SessionError {
  static override code = "E6001";
  static override suggestion = "Check session files in ~/.abx/sessions/ or use LocalSessionStore().list() programmatically.";
}

/**
 * Session with the given name already exists.
 */
export class SessionAlreadyExistsError extends SessionError {
  static override code = "E6002";
  static override suggestion = "Use a different name or stop the existing session first.";
}

/**
 * Base for NL-driven deployment failures.
 */
export class DeployError extends SandboxError {
  static override code = "E7000";
}

/**
 * No LLM API key found for the qwen-code agent.
 */
export class DeployLLMKeyMissingError extends DeployError {
  static override code = "E7001";
  static override suggestion = "Set ABX_LLM_API_KEY (or BAILIAN_CODING_PLAN_API_KEY, DASHSCOPE_API_KEY, OPENAI_API_KEY), store one with 'abx config set llm_api_key <KEY>', or pass llm_api_key= to Sandbox.deploy.";
}

/**
 * The qwen-code agent returned an error or unexpected output.
 */
export class DeployAgentError extends DeployError {
  static override code = "E7002";
  static override suggestion = "Check the raw_output on DeployResult for details.";
}

/**
 * Deployment exceeded the maximum wall-clock time.
 */
export class DeployTimeoutError extends DeployError {
  static override code = "E7003";
  static override suggestion = "Increase max_wall_time or simplify the deployment task.";
}

/**
 * Template build failed.
 */
export class TemplateBuildError extends SandboxError {
  static override code = "E7010";
  static override suggestion = "Check the Dockerfile and build logs for errors.";
}

/**
 * Template build timed out.
 */
export class TemplateBuildTimeoutError extends SandboxError {
  static override code = "E7011";
  static override suggestion = "Increase the build timeout or simplify the Dockerfile.";
}

/**
 * Local Docker build failed.
 */
export class DockerBuildError extends SandboxError {
  static override code = "E7020";
  static override suggestion = "Check the Dockerfile syntax and ensure Docker daemon is running.";
}

/**
 * Failed to push image to Alibaba Cloud ACR.
 */
export class ACRPushError extends SandboxError {
  static override code = "E7021";
  static override suggestion = "Verify ACR credentials and registry URL. Ensure the namespace and repository exist.";
}

/**
 * Failed to login to Alibaba Cloud ACR.
 */
export class ACRLoginError extends SandboxError {
  static override code = "E7022";
  static override suggestion = "Check AccessKey/AccessSecret credentials and registry URL.";
}

/**
 * Base for network/connection failures.
 */
export class NetworkError extends SandboxError {
  static override code = "E5000";
}

/**
 * Failed to connect to sandbox service.
 */
export class ConnectionError_ extends NetworkError {
  static override code = "E5001";
  static override suggestion = "Check network connectivity and firewall rules.";
}

/**
 * GitHub's anonymous API rate limit was hit while fetching templates.
 *
 * Deliberately shares the E5000 code of :class:`NetworkError`: to users
 * it remains one network error, while the CLI can detect this subtype and
 * offer a one-shot interactive ``github_token`` setup (task 206) before
 * giving up.  The raised ``suggestion`` always carries the officially
 * verified fine-grained PAT URL (see
 * :mod:`agent_sandbox.utils.github_token`).
 */
export class GitHubRateLimitError extends NetworkError {
  static override code = "E5000";
}

/** Python `__all__` (tests assert the exact set). */
export const __all__ = [
  "SandboxError",
  "AuthenticationError",
  "InvalidAPIKeyError",
  "TokenExpiredError",
  "InvalidCredentialsError",
  "TokenExchangeError",
  "SandboxCreationError",
  "TemplateNotFoundError",
  "QuotaExceededError",
  "RegionUnavailableError",
  "TemplateParseError",
  "QwenCodeNotInstalledError",
  "QwenCodeCredentialError",
  "AICodegenError",
  "QwenCodeTimeoutError",
  "QwenCodeStartupError",
  "DescriptionClarificationError",
  "SandboxNotFoundError",
  "ExecutionError",
  "CommandTimeoutError",
  "ProcessError",
  "CodeExecutionError",
  "CapabilityNotSupportedError",
  "CommandNotFoundError",
  "EnvdRpcError",
  "FileOperationError",
  "FileNotFoundError_",
  "PermissionDeniedError",
  "DeployError",
  "DeployLLMKeyMissingError",
  "DeployAgentError",
  "DeployTimeoutError",
  "TemplateBuildError",
  "TemplateBuildTimeoutError",
  "DockerBuildError",
  "ACRPushError",
  "ACRLoginError",
  "NetworkError",
  "ConnectionError_",
  "GitHubRateLimitError",
  "SessionError",
  "SessionNotFoundError",
  "SessionAlreadyExistsError"
] as const;

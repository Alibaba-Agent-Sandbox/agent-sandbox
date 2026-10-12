/** Public data models for Easy Sandbox SDK (port of `models/__init__.py`). */

export { GlobalConfig } from "./config.js";
export {
  AuthenticationError,
  CapabilityNotSupportedError,
  CodeExecutionError,
  CommandNotFoundError,
  CommandTimeoutError,
  ConnectionError_,
  ExecutionError,
  FileNotFoundError_,
  FileOperationError,
  InvalidAPIKeyError,
  InvalidCredentialsError,
  NetworkError,
  PermissionDeniedError,
  ProcessError,
  QuotaExceededError,
  RegionUnavailableError,
  SandboxCreationError,
  SandboxError,
  SandboxNotFoundError,
  TemplateBuildError,
  TemplateBuildTimeoutError,
  TemplateNotFoundError,
  TemplateParseError,
  TokenExpiredError,
} from "./errors.js";
export { FileInfo, FileType, WatchEvent, WatchEventType } from "./filesystem.js";
export {
  CodeResult,
  CommandResult,
  OutputFile,
  ProcessChunk,
  ProcessChunkType,
  ProcessInfo,
  ProcessResult,
} from "./process.js";
export { SandboxConfig, SandboxInfo, SandboxStatus } from "./sandbox.js";
export { SessionConfig, SessionInfo } from "./session.js";
export {
  DEFAULT_CAPABILITIES,
  STANDARD_CAPABILITIES,
  BuildInfo,
  BuildStatus,
  CustomCommand,
  CustomCommandArg,
  SandboxTemplate,
  TemplateInfo,
  TemplateRef,
} from "./template.js";
// Extra (no Python counterpart): pydantic-compatible validation primitives used by the models.
export { BaseModel, PyDatetime, ValidationError, ValueError } from "./_pydantic.js";

export const __all__ = [
  // Errors
  "SandboxError",
  "AuthenticationError",
  "InvalidAPIKeyError",
  "TokenExpiredError",
  "InvalidCredentialsError",
  "SandboxCreationError",
  "SandboxNotFoundError",
  "TemplateNotFoundError",
  "QuotaExceededError",
  "RegionUnavailableError",
  "TemplateParseError",
  "ExecutionError",
  "CommandTimeoutError",
  "ProcessError",
  "CodeExecutionError",
  "CapabilityNotSupportedError",
  "CommandNotFoundError",
  "FileOperationError",
  "FileNotFoundError_",
  "PermissionDeniedError",
  "NetworkError",
  "ConnectionError_",
  "TemplateBuildError",
  "TemplateBuildTimeoutError",
  // Sandbox
  "SandboxStatus",
  "SandboxConfig",
  "SandboxInfo",
  // Process
  "ProcessChunkType",
  "ProcessChunk",
  "ProcessResult",
  "CommandResult",
  "CodeResult",
  "OutputFile",
  "ProcessInfo",
  // Filesystem
  "FileType",
  "FileInfo",
  "WatchEventType",
  "WatchEvent",
  // Session
  "SessionConfig",
  "SessionInfo",
  // Config
  "GlobalConfig",
  // Template
  "STANDARD_CAPABILITIES",
  "DEFAULT_CAPABILITIES",
  "BuildStatus",
  "TemplateInfo",
  "BuildInfo",
  "SandboxTemplate",
  "TemplateRef",
  "CustomCommandArg",
  "CustomCommand",
] as const;

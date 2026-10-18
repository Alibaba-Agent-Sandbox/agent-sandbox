/** Tests for the exception hierarchy. */

import { describe, expect, it } from "vitest";

import {
  ACRLoginError,
  ACRPushError,
  AICodegenError,
  AuthenticationError,
  CapabilityNotSupportedError,
  CodeExecutionError,
  CommandNotFoundError,
  CommandTimeoutError,
  ConnectionError_,
  DeployAgentError,
  DeployError,
  DeployLLMKeyMissingError,
  DeployTimeoutError,
  DescriptionClarificationError,
  DockerBuildError,
  EnvdRpcError,
  ExecutionError,
  FileNotFoundError_,
  FileOperationError,
  GitHubRateLimitError,
  InvalidAPIKeyError,
  InvalidCredentialsError,
  NetworkError,
  PermissionDeniedError,
  ProcessError,
  QuotaExceededError,
  QwenCodeCredentialError,
  QwenCodeNotInstalledError,
  QwenCodeStartupError,
  QwenCodeTimeoutError,
  RegionUnavailableError,
  SandboxCreationError,
  SandboxError,
  SessionAlreadyExistsError,
  SessionError,
  SessionNotFoundError,
  TemplateBuildError,
  TemplateBuildTimeoutError,
  TemplateNotFoundError,
  TemplateParseError,
  TokenExchangeError,
  TokenExpiredError,
  __all__ as errors_all,
} from "../../src/models/errors.js";

// ---- Base SandboxError ----

describe("TestSandboxError", () => {
  it("test_basic_instantiation", () => {
    const err = new SandboxError("something went wrong");
    expect(err.message).toBe("something went wrong");
    expect(err.code).toBe("E0000");
    expect(err.suggestion).toBe("");
    expect(err.docs_url).toBe("");
  });

  it("test_custom_fields", () => {
    const err = new SandboxError("oops", {
      code: "E9999",
      suggestion: "try again",
      docs_url: "https://example.com",
    });
    expect(err.code).toBe("E9999");
    expect(err.suggestion).toBe("try again");
    expect(err.docs_url).toBe("https://example.com");
  });

  it("test_str_format", () => {
    const err = new SandboxError("fail", { code: "E0001", suggestion: "fix it" });
    const s = String(err);
    expect(s).toContain("[E0001]");
    expect(s).toContain("fail");
    expect(s).toContain("Suggestion: fix it");
  });

  it("test_str_no_suggestion", () => {
    const err = new SandboxError("fail");
    const s = String(err);
    expect(s).not.toContain("Suggestion");
  });

  it("test_to_dict", () => {
    const err = new SandboxError("msg", { code: "E0001", suggestion: "tip" });
    const d = err.toDict();
    expect(d["code"]).toBe("E0001");
    expect(d["message"]).toBe("msg");
    expect(d["suggestion"]).toBe("tip");
    expect("docs_url" in d).toBe(true);
  });

  it("test_is_exception", () => {
    const err = new SandboxError("test");
    expect(err).toBeInstanceOf(Error);
    expect(() => {
      throw err;
    }).toThrow(SandboxError);
  });
});

// ---- Authentication Errors ----

describe("TestAuthenticationErrors", () => {
  it("test_authentication_error_inherits", () => {
    const err = new AuthenticationError("auth fail");
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.code).toBe("E1000");
  });

  it("test_invalid_api_key", () => {
    const err = new InvalidAPIKeyError("bad key");
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.code).toBe("E1001");
    expect(err.suggestion).toContain("ABX_SANDBOX_API_KEY");
    expect(err.suggestion).toContain("sandbox_api_key");
  });

  it("test_token_expired", () => {
    const err = new TokenExpiredError("expired");
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.code).toBe("E1002");
    expect(err.suggestion).toContain("auto-refresh");
  });

  it("test_invalid_credentials", () => {
    const err = new InvalidCredentialsError("bad creds");
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.code).toBe("E1003");
    expect(err.suggestion).toContain("selected provider");
  });
});

// ---- Creation Errors ----

describe("TestCreationErrors", () => {
  it("test_sandbox_creation_error_inherits", () => {
    const err = new SandboxCreationError("create fail");
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.code).toBe("E2000");
  });

  it("test_template_not_found", () => {
    const err = new TemplateNotFoundError("no template");
    expect(err).toBeInstanceOf(SandboxCreationError);
    expect(err.code).toBe("E2001");
    expect(err.suggestion).toContain("abx template list");
  });

  it("test_quota_exceeded", () => {
    const err = new QuotaExceededError("over quota");
    expect(err).toBeInstanceOf(SandboxCreationError);
    expect(err.code).toBe("E2002");
  });

  it("test_region_unavailable", () => {
    const err = new RegionUnavailableError("bad region");
    expect(err).toBeInstanceOf(SandboxCreationError);
    expect(err.code).toBe("E2003");
  });
});

// ---- Execution Errors ----

describe("TestExecutionErrors", () => {
  it("test_execution_error_inherits", () => {
    const err = new ExecutionError("exec fail");
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.code).toBe("E3000");
  });

  it("test_command_timeout", () => {
    const err = new CommandTimeoutError("timed out");
    expect(err).toBeInstanceOf(ExecutionError);
    expect(err.code).toBe("E3001");
  });

  it("test_process_error", () => {
    const err = new ProcessError("exit 1", { exit_code: 1, stdout: "out", stderr: "err" });
    expect(err).toBeInstanceOf(ExecutionError);
    expect(err.code).toBe("E3002");
    expect(err.exit_code).toBe(1);
    expect(err.stdout).toBe("out");
    expect(err.stderr).toBe("err");
  });

  it("test_process_error_defaults", () => {
    const err = new ProcessError("fail");
    expect(err.exit_code).toBe(-1);
    expect(err.stdout).toBe("");
    expect(err.stderr).toBe("");
  });

  it("test_code_execution_error", () => {
    const err = new CodeExecutionError("bad code");
    expect(err).toBeInstanceOf(ExecutionError);
    expect(err.code).toBe("E3003");
  });

  it("test_envd_rpc_error_structured_fields", () => {
    // EnvdRpcError carries envd error details for upper-layer mapping.
    const err = new EnvdRpcError("envd RPC /process.Process/Start failed (HTTP 500): exec not found", {
      status_code: 500,
      rpc_path: "/process.Process/Start",
      envd_error: { error: { code: "not_found", message: "exec not found" } },
      body_text: '{"error":{...}}',
    });
    expect(err).toBeInstanceOf(ExecutionError);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.code).toBe("E3006");
    expect(err.status_code).toBe(500);
    expect(err.rpc_path).toBe("/process.Process/Start");
    expect((err.envd_error as { error: { message: string } }).error.message).toBe("exec not found");
    expect(err.body_text).toBe('{"error":{...}}');
  });

  it("test_envd_rpc_error_defaults", () => {
    const err = new EnvdRpcError("boom");
    expect(err.status_code).toBe(0);
    expect(err.rpc_path).toBe("");
    expect(err.envd_error).toBeNull();
    expect(err.body_text).toBe("");
    expect(err.code).toBe("E3006");
    expect(err.suggestion).toBeTruthy(); // actionable by default
  });
});

// ---- Filesystem Errors ----

describe("TestFilesystemErrors", () => {
  it("test_file_operation_error_inherits", () => {
    const err = new FileOperationError("fs fail");
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.code).toBe("E4000");
  });

  it("test_file_not_found", () => {
    const err = new FileNotFoundError_("not found");
    expect(err).toBeInstanceOf(FileOperationError);
    expect(err.code).toBe("E4001");
  });

  it("test_permission_denied", () => {
    const err = new PermissionDeniedError("denied");
    expect(err).toBeInstanceOf(FileOperationError);
    expect(err.code).toBe("E4002");
  });
});

// ---- Network Errors ----

describe("TestNetworkErrors", () => {
  it("test_network_error_inherits", () => {
    const err = new NetworkError("net fail");
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.code).toBe("E5000");
  });

  it("test_connection_error", () => {
    const err = new ConnectionError_("conn fail");
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.code).toBe("E5001");
  });

  it("test_github_rate_limit_error", () => {
    const err = new GitHubRateLimitError("rate limited");
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.code).toBe("E5000");
  });
});

// ---- AI Generation Subtypes ----

describe("TestAICodegenSubtypeErrors", () => {
  // The classified Qwen Code failures share E2007 by design.
  //
  // Like GitHubRateLimitError above, these subtypes keep the user-visible code of their parent so the CLI output
  // never changes; only the research round reads the type to derive a stable reason.

  it("test_timeout_error_shares_e2007", () => {
    const err = new QwenCodeTimeoutError("did not finish within 240s");
    expect(err).toBeInstanceOf(AICodegenError);
    expect(err.code).toBe("E2007");
  });

  it("test_startup_error_shares_e2007", () => {
    const err = new QwenCodeStartupError("Failed to start Qwen Code: boom");
    expect(err).toBeInstanceOf(AICodegenError);
    expect(err.code).toBe("E2007");
  });
});

// ---- Unique Codes ----

describe("TestErrorCodeUniqueness", () => {
  it("test_all_error_codes_unique", () => {
    // Every concrete error class should have a unique error code.
    const all_classes = [
      SandboxError,
      AuthenticationError,
      InvalidAPIKeyError,
      TokenExpiredError,
      InvalidCredentialsError,
      SandboxCreationError,
      TemplateNotFoundError,
      QuotaExceededError,
      RegionUnavailableError,
      ExecutionError,
      CommandTimeoutError,
      ProcessError,
      CodeExecutionError,
      FileOperationError,
      FileNotFoundError_,
      PermissionDeniedError,
      NetworkError,
      ConnectionError_,
      TemplateBuildError,
      TemplateBuildTimeoutError,
    ];
    const codes = all_classes.map((cls) => cls.code);
    expect(codes.length, `Duplicate codes found: ${codes}`).toBe(new Set(codes).size);
  });
});

// ---- __all__ ----

describe("TestErrorsAll", () => {
  it("test_all_list_contains_all_classes", () => {
    const expected = new Set([
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
      "NetworkError",
      "ConnectionError_",
      "GitHubRateLimitError",
      "SessionError",
      "SessionNotFoundError",
      "SessionAlreadyExistsError",
      "TemplateBuildError",
      "TemplateBuildTimeoutError",
      "DockerBuildError",
      "ACRPushError",
      "ACRLoginError",
    ]);
    expect(new Set(errors_all)).toEqual(expected);
  });
});

// Imported for the `__all__` coverage above (every exported class must exist).
void [
  TokenExchangeError,
  TemplateParseError,
  QwenCodeNotInstalledError,
  QwenCodeCredentialError,
  DescriptionClarificationError,
  CapabilityNotSupportedError,
  CommandNotFoundError,
  DeployError,
  DeployLLMKeyMissingError,
  DeployAgentError,
  DeployTimeoutError,
  SessionError,
  SessionNotFoundError,
  SessionAlreadyExistsError,
  DockerBuildError,
  ACRPushError,
  ACRLoginError,
];

describe("TestSandboxNotFoundError", () => {
  it("test_sandbox_not_found_error_code_and_suggestion", async () => {
    const { SandboxNotFoundError } = await import("../../src/models/errors.js");
    const err = new SandboxNotFoundError("Sandbox 'sbx-1' was not found.");
    expect(err).toBeInstanceOf(SandboxError);
    expect(err.code).toBe("E2009");
    expect(err.suggestion).toContain("abx list");
  });
});

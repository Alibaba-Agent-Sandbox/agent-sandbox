/** Tests for logging utilities. */

import { describe, expect, it } from "vitest";

import * as log_module from "../../src/utils/logging.js";
import { DEBUG, Logger, NOTSET, WARNING, getLogger, logging } from "../../src/utils/logging.js";

/** `mock.patch.dict(os.environ, {...})` as a scoped helper. */
function withEnv<T>(patch: Record<string, string>, fn: () => T): T {
  const saved = { ...process.env };
  Object.assign(process.env, patch);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

describe("TestGetLogger", () => {
  it("test_returns_namespaced_logger", () => {
    const logger = getLogger("transport.http");
    expect(logger.name).toBe("easy_sandbox.transport.http");
  });

  it("test_already_prefixed", () => {
    const logger = getLogger("easy_sandbox.session");
    expect(logger.name).toBe("easy_sandbox.session");
  });

  it("test_returns_logging_logger", () => {
    const logger = getLogger("test");
    expect(logger).toBeInstanceOf(Logger);
  });

  it("test_respects_env_var", () => {
    // Reset the configured flag to allow reconfiguration
    log_module._setConfigured(false);
    const root_logger = logging.getLogger();
    const saved_handlers = [...root_logger.handlers];
    for (const handler of saved_handlers) root_logger.removeHandler(handler);
    try {
      withEnv({ SANDBOX_LOG_LEVEL: "DEBUG" }, () => {
        getLogger("envtest");
        const pkg = logging.getLogger("easy_sandbox");
        expect(pkg.level).toBe(DEBUG);
      });
    } finally {
      for (const handler of saved_handlers) root_logger.addHandler(handler);
      log_module._setConfigured(false);
      logging.getLogger("easy_sandbox").setLevel(WARNING);
    }
  });

  it("test_default_level_is_warning", () => {
    log_module._setConfigured(false);
    const root_logger = logging.getLogger();
    const saved_handlers = [...root_logger.handlers];
    for (const handler of saved_handlers) root_logger.removeHandler(handler);
    try {
      withEnv({}, () => {
        delete process.env["SANDBOX_LOG_LEVEL"];
        getLogger("default_test");
        const pkg = logging.getLogger("easy_sandbox");
        expect(pkg.level).toBe(WARNING);
      });
    } finally {
      for (const handler of saved_handlers) root_logger.addHandler(handler);
      log_module._setConfigured(false);
    }
  });

  it("test_host_handler_does_not_drop_info", () => {
    // A CLI root handler must see INFO; the package logger must not filter it.
    log_module._setConfigured(false);
    const root_logger = logging.getLogger();
    const handler = new logging.NullHandler();
    root_logger.addHandler(handler);
    try {
      withEnv({ SANDBOX_LOG_LEVEL: "WARNING" }, () => {
        getLogger("hosted");
        expect(logging.getLogger("easy_sandbox").level).toBe(NOTSET);
      });
    } finally {
      root_logger.removeHandler(handler);
      log_module._setConfigured(false);
      logging.getLogger("easy_sandbox").setLevel(WARNING);
    }
  });
});

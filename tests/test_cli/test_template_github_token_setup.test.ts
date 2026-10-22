import "../_support/isolatedHome.js";
import * as guidance from "../../src/cli/config_guidance.js";
/**
 * CLI tests for the one-shot GitHub-token onboarding (task 206).
 *
 * `abx template search` / `abx template install` hit GitHub's anonymous rate limit; in an interactive terminal the user
 * is offered a masked `github_token` setup and the failed operation is retried exactly once. Everything runs offline:
 * the index client and the registry client are mocked.
 */


import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cli } from "../../src/cli/main.js";
import { configSeams } from "../../src/cli/commands/config_cmd.js";
import { templateSeams } from "../../src/providers/alicloud_express/cli/template.js";
import { GitHubRateLimitError } from "../../src/models/errors.js";
import { TemplateRef } from "../../src/models/template.js";
import { FINE_GRAINED_PAT_URL, GITHUB_TOKEN_ENV_VAR, rateLimitMessage, rateLimitSuggestion } from "../../src/utils/github_token.js";
import * as registryMod from "../../src/utils/registry.js";
import * as templateIndexMod from "../../src/utils/template_index.js";
import { TemplateIndex, parseIndex } from "../../src/utils/template_index.js";
import { CliRunner } from "../helpers/cliRunner.js";
import { delenv, setenv, spyAny, useTmpPath, writeText } from "../helpers/templateSupport.js";

const runner = (): CliRunner => new CliRunner();
const tmpPath = useTmpPath();

const INDEX_YAML = `\
schema_version: 1
templates:
  - name: qwen-code
    description: "Qwen Code agent harness"
    repo: https://github.com/alibaba-agent-sandbox/awesome-templates
    path: qwen-code
    tags: [qwen, ai-agent]
    status: official
`;

const INDEX_URL = "https://example.test/awesome-templates.yaml";

function _rateLimited(): GitHubRateLimitError {
  return new GitHubRateLimitError(rateLimitMessage({ operation: "fetching the template index" }), {
    suggestion: rateLimitSuggestion(),
  });
}

const index = (): TemplateIndex => parseIndex(INDEX_YAML, { source_url: INDEX_URL });

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "templates", "python-hello");

/** `_config_storage`: point config_cmd's `config.toml` / `.env` / dir at the tmp path. */
beforeEach(() => {
  const saved = { dir: configSeams._ABX_DIR, file: configSeams._CONFIG_FILE, env: configSeams._ENV_FILE, prompt: configSeams._promptSecret, tty: templateSeams.stdinIsatty };
  const tp = tmpPath();
  configSeams._ABX_DIR = tp;
  configSeams._CONFIG_FILE = path.join(tp, "config.toml");
  configSeams._ENV_FILE = path.join(tp, ".env");
  delenv(GITHUB_TOKEN_ENV_VAR);
  return () => {
    configSeams._ABX_DIR = saved.dir;
    configSeams._CONFIG_FILE = saved.file;
    configSeams._ENV_FILE = saved.env;
    configSeams._promptSecret = saved.prompt;
    templateSeams.stdinIsatty = saved.tty;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const tty = (): void => {
  templateSeams.stdinIsatty = () => true;
  vi.spyOn(guidance, "canGuideConfiguration").mockReturnValue(true);
  vi.spyOn(guidance.guidanceSeams, "interactive").mockReturnValue(true);
  vi.spyOn(guidance.guidanceSeams, "ask").mockImplementation(async (_label, secret) => secret ? configSeams._promptSecret("GitHub token") : "2");
};

describe("TestSearchOnboarding", () => {
  it("test_tty_offers_setup_and_retries_once", async () => {
    const mocked = spyAny(templateIndexMod, "fetchIndex").mockRejectedValueOnce(_rateLimited()).mockResolvedValueOnce(index());
    const envFile = path.join(tmpPath(), ".env");
    tty();
    const prompt = vi.fn(async () => "ghp_pasted1234567890");
    configSeams._promptSecret = prompt;

    const result = await runner().invoke(cli, ["template", "search", "qwen"], { input: "y\n" });

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain(FINE_GRAINED_PAT_URL);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(mocked).toHaveBeenCalledTimes(2);
    expect((mocked.mock.calls[0]![1] as Record<string, unknown>)["token"]).toBeNull();
    expect((mocked.mock.calls[1]![1] as Record<string, unknown>)["token"]).toBe("ghp_pasted1234567890");
    expect(fs.readFileSync(envFile, "utf-8")).toBe(`${GITHUB_TOKEN_ENV_VAR}=ghp_pasted1234567890\n`);
    expect(result.output).toContain("qwen-code");
    expect(result.output).not.toContain("ghp_pasted1234567890");
  });

  it("test_tty_decline_reports_the_original_error", async () => {
    const mocked = spyAny(templateIndexMod, "fetchIndex").mockRejectedValue(_rateLimited());
    tty();

    const result = await runner().invoke(cli, ["template", "search", "qwen"], { input: "n\n" });

    expect(result.exit_code).toBe(1);
    const combined = result.output + (result.stderr || "");
    expect(combined.toLowerCase()).toContain("rate limit");
    expect(combined).toContain(FINE_GRAINED_PAT_URL);
    expect(combined).toContain("abx config set github_token");
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(tmpPath(), ".env"))).toBe(false);
  });

  it("test_tty_empty_token_reports_the_original_error", async () => {
    const mocked = spyAny(templateIndexMod, "fetchIndex").mockRejectedValue(_rateLimited());
    tty();
    configSeams._promptSecret = async () => "   ";

    const result = await runner().invoke(cli, ["template", "search", "qwen"], { input: "y\n" });

    expect(result.exit_code).toBe(1);
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(tmpPath(), ".env"))).toBe(false);
  });

  it("test_retry_failing_again_is_not_looped", async () => {
    const mocked = spyAny(templateIndexMod, "fetchIndex").mockRejectedValueOnce(_rateLimited()).mockRejectedValueOnce(_rateLimited());
    tty();
    configSeams._promptSecret = async () => "ghp_pasted1234567890";

    const result = await runner().invoke(cli, ["template", "search", "qwen"], { input: "y\n" });

    expect(result.exit_code).toBe(1);
    expect(mocked).toHaveBeenCalledTimes(2);
    const combined = result.output + (result.stderr || "");
    expect(combined.toLowerCase()).toContain("rate limit");
  });

  it("test_non_tty_never_prompts", async () => {
    const mocked = spyAny(templateIndexMod, "fetchIndex").mockRejectedValue(_rateLimited());

    const result = await runner().invoke(cli, ["template", "search", "qwen"]);

    expect(result.exit_code).toBe(1);
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(result.output).not.toContain("Configure github_token now?");
    const combined = result.output + (result.stderr || "");
    expect(combined).toContain("GITHUB_TOKEN");
    expect(combined.toLowerCase()).toContain("secret");
    expect(combined).toContain("abx config set github_token");
  });

  it("test_json_mode_never_prompts", async () => {
    const mocked = spyAny(templateIndexMod, "fetchIndex").mockRejectedValue(_rateLimited());
    tty();

    const result = await runner().invoke(cli, ["--json", "template", "search", "qwen"]);

    expect(result.exit_code).toBe(1);
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(result.output).not.toContain("Configure github_token now?");
  });

  it("test_explicit_token_skips_onboarding", async () => {
    const mocked = spyAny(templateIndexMod, "fetchIndex").mockRejectedValue(_rateLimited());
    tty();

    const result = await runner().invoke(cli, ["template", "search", "qwen", "--token", "gh-explicit-token"]);

    expect(result.exit_code).toBe(1);
    expect(mocked).toHaveBeenCalledTimes(1);
    expect((mocked.mock.calls[0]![1] as Record<string, unknown>)["token"]).toBe("gh-explicit-token");
    expect(result.output).not.toContain("Configure github_token now?");
  });

  it("test_stored_token_is_used", async () => {
    writeText(path.join(tmpPath(), ".env"), `${GITHUB_TOKEN_ENV_VAR}=ghp_stored1234567890\n`);
    const mocked = spyAny(templateIndexMod, "fetchIndex").mockResolvedValue(index());

    const result = await runner().invoke(cli, ["template", "search", "qwen"]);

    expect(result.exit_code, result.output).toBe(0);
    expect((mocked.mock.calls.at(-1)![1] as Record<string, unknown>)["token"]).toBe("ghp_stored1234567890");
    expect(result.output).not.toContain("ghp_stored1234567890");
  });

  it("test_process_env_token_wins_over_stored", async () => {
    writeText(path.join(tmpPath(), ".env"), `${GITHUB_TOKEN_ENV_VAR}=ghp_stored1234567890\n`);
    const mocked = spyAny(templateIndexMod, "fetchIndex").mockResolvedValue(index());
    setenv(GITHUB_TOKEN_ENV_VAR, "ghp-env1234567890");

    const result = await runner().invoke(cli, ["template", "search", "qwen"]);

    expect(result.exit_code, result.output).toBe(0);
    expect((mocked.mock.calls.at(-1)![1] as Record<string, unknown>)["token"]).toBe("ghp-env1234567890");
    expect(result.output).not.toContain("ghp-env1234567890");
  });
});

describe("TestInstallOnboarding", () => {
  function _fetchedCopy(): string {
    const dst = path.join(tmpPath(), "fetched", "repo");
    fs.cpSync(FIXTURE, dst, { recursive: true });
    return dst;
  }

  function _client(fetched: string | Error) {
    return {
      resolve: vi.fn(async () => new TemplateRef({ owner: "owner", repo: "repo", tag: "default", registry_type: "github" })),
      fetch: typeof fetched === "string" ? vi.fn(async () => fetched) : vi.fn(async () => Promise.reject(fetched)),
    };
  }

  it("test_tty_offers_setup_and_retries_once", async () => {
    const fetched = _fetchedCopy();
    const first = _client(_rateLimited());
    const second = _client(fetched);
    const clients = [first, second];
    const ctor = spyAny(registryMod, "RegistryClient").mockImplementation(function () {
      return clients.shift();
    });
    const envFile = path.join(tmpPath(), ".env");
    tty();
    const prompt = vi.fn(async () => "ghp_pasted1234567890");
    configSeams._promptSecret = prompt;

    const result = await runner().invoke(cli, ["template", "install", "owner/repo", "--download-only"], { input: "y\n" });

    expect(result.exit_code, result.output).toBe(0);
    expect(result.output).toContain(FINE_GRAINED_PAT_URL);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(ctor).toHaveBeenCalledTimes(2);
    expect(ctor.mock.calls[0]![1]).toBeNull();
    expect(ctor.mock.calls[1]![1]).toBe("ghp_pasted1234567890");
    expect(fs.readFileSync(envFile, "utf-8")).toBe(`${GITHUB_TOKEN_ENV_VAR}=ghp_pasted1234567890\n`);
    expect(result.output).not.toContain("ghp_pasted1234567890");
  });

  it("test_stored_token_is_passed_to_the_registry_client", async () => {
    const fetched = _fetchedCopy();
    writeText(path.join(tmpPath(), ".env"), `${GITHUB_TOKEN_ENV_VAR}=ghp_stored1234567890\n`);
    const client = _client(fetched);
    const ctor = spyAny(registryMod, "RegistryClient").mockImplementation(function () {
      return client;
    });

    const result = await runner().invoke(cli, ["template", "install", "owner/repo", "--download-only"]);

    expect(result.exit_code, result.output).toBe(0);
    expect(ctor.mock.calls.at(-1)![1]).toBe("ghp_stored1234567890");
  });

  it("test_non_tty_reports_error_with_onboarding_suggestion", async () => {
    const first = _client(_rateLimited());
    const ctor = spyAny(registryMod, "RegistryClient").mockImplementation(function () {
      return first;
    });

    const result = await runner().invoke(cli, ["template", "install", "owner/repo", "--download-only"]);

    expect(result.exit_code).toBe(1);
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(result.output).not.toContain("Configure github_token now?");
    const combined = result.output + (result.stderr || "");
    expect(combined).toContain(FINE_GRAINED_PAT_URL);
    expect(combined).toContain("abx config set github_token");
  });
});

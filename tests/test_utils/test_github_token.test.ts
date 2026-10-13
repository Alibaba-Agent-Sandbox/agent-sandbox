/**
 * Tests for the shared GitHub-token guidance (task 206).
 *
 * The module is the single source of truth for the rate-limit message and the officially verified fine-grained PAT
 * prefill URL used by both clients (`utils/registry` / `utils/template_index`) and by the CLI onboarding.
 */

import { describe, expect, it } from "vitest";

import {
  FINE_GRAINED_PAT_URL,
  GITHUB_TOKEN_CONFIG_KEY,
  GITHUB_TOKEN_ENV_VAR,
  rateLimitMessage as rate_limit_message,
  rateLimitSuggestion as rate_limit_suggestion,
} from "../../src/utils/github_token.js";

describe("TestConstants", () => {
  it("test_env_var_and_config_key", () => {
    expect(GITHUB_TOKEN_ENV_VAR).toBe("GITHUB_TOKEN");
    expect(GITHUB_TOKEN_CONFIG_KEY).toBe("github_token");
  });

  it("test_pat_url_is_the_official_prefill_endpoint", () => {
    expect(FINE_GRAINED_PAT_URL.startsWith("https://github.com/settings/personal-access-tokens/new?")).toBe(true);
    // Officially supported URL parameters (see GitHub docs).
    expect(FINE_GRAINED_PAT_URL).toContain("expires_in=90");
    expect(FINE_GRAINED_PAT_URL).toContain("contents=read");
  });

  it("test_pat_url_requests_no_write_or_admin_scope", () => {
    expect(FINE_GRAINED_PAT_URL).not.toContain("=write");
    expect(FINE_GRAINED_PAT_URL).not.toContain("=admin");
  });
});

describe("TestRateLimitMessage", () => {
  it("test_mentions_the_anonymous_hourly_budget", () => {
    const message = rate_limit_message();
    expect(message.toLowerCase()).toContain("rate limit");
    expect(message).toContain("60/hour");
  });

  it("test_operation_is_embedded", () => {
    const message = rate_limit_message({ operation: "fetching the template index" });
    expect(message).toContain("while fetching the template index");
  });

  it("test_base_message_has_no_dangling_while", () => {
    expect(rate_limit_message()).not.toContain("while");
  });
});

describe("TestRateLimitSuggestion", () => {
  it("test_recommends_config_set_over_token_flag", () => {
    const suggestion = rate_limit_suggestion();
    expect(suggestion).toContain("abx config set github_token");
    expect(suggestion).toContain("~/.abx/.env");
  });

  it("test_token_flag_documented_as_leak_prone", () => {
    const suggestion = rate_limit_suggestion();
    const marker = "'--token <value>'";
    const idx = suggestion.indexOf(marker);
    const after_flag = idx < 0 ? [suggestion] : [suggestion.slice(0, idx), suggestion.slice(idx + marker.length)];
    expect(after_flag.length, "the --token fallback must still be documented").toBe(2);
    expect(after_flag[1]).toContain("may leak into shell history and process listings");
  });

  it("test_contains_verified_url_and_setup_guidance", () => {
    const suggestion = rate_limit_suggestion();
    expect(suggestion).toContain(FINE_GRAINED_PAT_URL);
    expect(suggestion).toContain("public repositories need no extra permissions");
    expect(suggestion).toContain("90-day expiry is recommended");
  });

  it("test_covers_ci_secret_injection", () => {
    const suggestion = rate_limit_suggestion();
    expect(suggestion).toContain("GITHUB_TOKEN");
    expect(suggestion.toLowerCase()).toContain("secret");
  });

  it("test_extra_sentence_is_appended_last", () => {
    const suggestion = rate_limit_suggestion({ extra: "Mirror hint." });
    expect(suggestion.endsWith("Mirror hint.")).toBe(true);
  });
});

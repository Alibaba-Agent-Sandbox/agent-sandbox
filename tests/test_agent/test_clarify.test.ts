/**
 * Unit tests for the research-first requirement clarification adapter.
 *
 * Port of `tests/test_agent/test_clarify.py`. The research, the evaluation, and the questions themselves are
 * produced by Qwen Code's native session (a plain `--session-id` research round, then `--json-schema` assessment
 * rounds on `--resume`); these tests pin only the thin Agent Sandbox adapter around it:
 *
 * - the research-first contract — public facts must be settled by the agent's own tools before anything is asked
 *   (the research prompt and the schema carry that rule, and the research run must NOT use `--json-schema` because
 *   the structured-output contract would end the tool loop early);
 * - delegation answers ("你自己决定" / "you decide") never re-ask;
 * - anti-repetition — asked questions are embedded in every follow-up prompt;
 * - the structured payload parsing and the threshold verdict (our gate);
 * - the `evaluate` / `runResearch` call contracts (native session flags, turn budgets, structured output) and their
 *   degrade-to-`null` / classified-`ResearchOutcome` failure modes.
 *
 * No test performs real network access or executes the real CLI.
 */

import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as clarify from "../../src/agent/clarify.js";
import {
  ASSESS_SESSION_TURNS,
  CLARIFY_SCHEMA,
  CLARITY_THRESHOLD,
  ClarifyAssessment,
  DEFAULT_CLARIFY_TIMEOUT,
  DEFAULT_RESEARCH_TIMEOUT,
  MAX_CLARIFY_ROUNDS,
  RESEARCH_REASON_AGENT_UNAVAILABLE,
  RESEARCH_REASON_COMMAND_FAILED,
  RESEARCH_REASON_TIMEOUT,
  RESEARCH_REASON_TURN_LIMIT,
  RESEARCH_SESSION_TURNS,
  ResearchOutcome,
  answerPrompt,
  assessmentPrompt,
  isDelegationAnswer,
  newSessionId,
  parseAssessment,
  researchPrompt,
  researchSucceeded,
} from "../../src/agent/clarify.js";
import { QwenCodeRunResult } from "../../src/agent/qwen_code.js";
import {
  AICodegenError,
  QwenCodeNotInstalledError,
  QwenCodeStartupError,
  QwenCodeTimeoutError,
} from "../../src/models/errors.js";
import { DEBUG, Handler, type LogRecord, stdGetLogger } from "../../src/utils/logging.js";
import { makeTmp, readGolden, rmTmp } from "../helpers/agentSupport.js";

const SESSION = "6f0f8e9a-1b2c-4d5e-8f90-123456789abc";

const PAYLOAD: Record<string, unknown> = {
  completeness: 0.9,
  question: "",
  missing: [],
  example: "Python 3.12 with pandas, port 8888",
};

let tmpPath = "";
const saved = process.env.ABX_QWEN_RESEARCH_TIMEOUT;
beforeEach(() => {
  tmpPath = makeTmp();
});
afterEach(() => {
  vi.restoreAllMocks();
  rmTmp(tmpPath);
  if (saved === undefined) delete process.env.ABX_QWEN_RESEARCH_TIMEOUT;
  else process.env.ABX_QWEN_RESEARCH_TIMEOUT = saved;
});

describe("TestConstants", () => {
  it("test_threshold_is_eighty_percent", () => {
    expect(CLARITY_THRESHOLD).toBe(0.8);
  });

  it("test_round_cap_is_bounded", () => {
    expect(MAX_CLARIFY_ROUNDS).toBeGreaterThanOrEqual(1);
    expect(MAX_CLARIFY_ROUNDS).toBeLessThanOrEqual(10);
  });

  it("test_assessment_budget_is_small", () => {
    // An assessment is pure reasoning: small turn budget, small timeout.
    expect(ASSESS_SESSION_TURNS).toBeLessThan(10);
    expect(DEFAULT_CLARIFY_TIMEOUT).toBeLessThan(600.0);
  });

  it("test_research_budget_is_larger_than_assessment", () => {
    // Research performs real tool calls: larger turn budget and timeout.
    expect(RESEARCH_SESSION_TURNS).toBeGreaterThan(ASSESS_SESSION_TURNS);
    expect(DEFAULT_RESEARCH_TIMEOUT).toBeGreaterThan(DEFAULT_CLARIFY_TIMEOUT);
    expect(RESEARCH_SESSION_TURNS).toBeGreaterThanOrEqual(20);
  });

  it("test_research_is_bounded_well_below_the_old_hang", () => {
    // Regression: research used to run 40 turns / 300s and looked hung.
    expect(RESEARCH_SESSION_TURNS).toBeLessThanOrEqual(20);
    expect(DEFAULT_RESEARCH_TIMEOUT).toBeLessThanOrEqual(300.0);
  });

  it("test_research_prompt_caps_slow_web_fetches", () => {
    const prompt = clarify.researchPrompt("run serverless devs in a sandbox");
    expect(prompt).toContain("最多 3 次网络检索");
  });
});

describe("TestDefaultResearchTimeout", () => {
  it("test_default_without_override", () => {
    delete process.env.ABX_QWEN_RESEARCH_TIMEOUT;
    expect(clarify.defaultResearchTimeout()).toBe(DEFAULT_RESEARCH_TIMEOUT);
  });

  it("test_env_override", () => {
    process.env.ABX_QWEN_RESEARCH_TIMEOUT = "45";
    expect(clarify.defaultResearchTimeout()).toBe(45.0);
  });

  for (const raw of ["", "abc", "0", "-5"]) {
    it(`test_invalid_override_falls_back [${raw}]`, () => {
      process.env.ABX_QWEN_RESEARCH_TIMEOUT = raw;
      expect(clarify.defaultResearchTimeout()).toBe(DEFAULT_RESEARCH_TIMEOUT);
    });
  }
});

describe("TestSchema", () => {
  it("test_single_question_is_structural", () => {
    // `question` is one string — a model cannot ask a battery of questions.
    expect(CLARIFY_SCHEMA.properties.question.type).toBe("string");
  });

  it("test_required_fields_and_closed_object", () => {
    expect(CLARIFY_SCHEMA.required).toEqual(["completeness", "question", "missing", "example"]);
    expect(CLARIFY_SCHEMA.additionalProperties).toBe(false);
  });

  it("test_schema_is_json_serialisable", () => {
    // The mapping must survive `--json-schema` (dumped to a JSON literal).
    expect(JSON.parse(JSON.stringify(CLARIFY_SCHEMA))).toEqual(CLARIFY_SCHEMA);
  });

  it("test_schema_forbids_public_fact_questions", () => {
    // The question/missing descriptions carry the research-first rule.
    const questionDesc: string = CLARIFY_SCHEMA.properties.question.description;
    expect(questionDesc).toContain("publicly verify");
    expect(questionDesc).toContain("never repeating");
    const missingDesc: string = CLARIFY_SCHEMA.properties.missing.description;
    expect(missingDesc).toContain("Public facts must not appear here");
  });
});

describe("TestPrompts", () => {
  it("test_research_prompt_embeds_the_description", () => {
    const prompt = researchPrompt("  一个 sandbox 里面运行 Serverless Devs CLI  ");
    expect(prompt).toContain("Serverless Devs CLI");
  });

  it("test_research_prompt_tells_agent_to_research_public_facts", () => {
    // Public facts must be settled with the agent's own tools, not asked.
    const prompt = researchPrompt("run serverless devs");
    expect(prompt).toContain("web_fetch");
    expect(prompt).toContain("公开查证");
    expect(prompt).toContain("不得向用户提问");
    expect(prompt).toContain("默认值"); // safe-default + recorded-assumption rule
  });

  it("test_assessment_prompt_embeds_the_description", () => {
    const prompt = assessmentPrompt("  运行 python  ");
    expect(prompt).toContain("运行 python");
    expect(prompt).toContain("completeness");
  });

  it("test_assessment_prompt_forbids_public_fact_questions", () => {
    const prompt = assessmentPrompt("run python");
    expect(prompt).toContain("公开查证");
    expect(prompt).toContain("不得作为问题提出");
    expect(prompt).toContain("授权语义"); // delegation rule
    expect(prompt).toContain("不得重复"); // anti-repeat rule
  });

  it("test_answer_prompt_embeds_the_answer", () => {
    const prompt = answerPrompt("  pandas  ");
    expect(prompt).toContain("pandas");
    expect(prompt).toContain("重新评估");
  });

  it("test_answer_prompt_lists_previously_asked_questions", () => {
    // Asked questions are embedded so the model cannot repeat a topic.
    const prompt = answerPrompt("pandas", ["Which port?", "Which region?"]);
    expect(prompt).toContain("- Which port?");
    expect(prompt).toContain("- Which region?");
    expect(prompt).toContain("不得重复");
  });

  it("test_answer_prompt_without_history_omits_the_asked_clause", () => {
    const prompt = answerPrompt("pandas");
    expect(prompt).not.toContain("已问过的问题");
  });

  it("test_new_session_id_is_a_valid_uuid", () => {
    // raises when malformed
    expect(newSessionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newSessionId()).not.toBe(newSessionId());
  });
});

/** “你可以自己检索、决定、采用默认”等回答视为授权 Agent 处理。 */
describe("TestDelegationAnswers", () => {
  for (const answer of [
    "你可以自己检索",
    "你自己决定",
    "你决定就好",
    "采用默认",
    "用默认的就行",
    "合理默认即可",
    "随便",
    "都可以",
    "我不确定",
    "you decide",
    "Up to you!",
    "use the default",
    "sensible default is fine",
    "no preference",
  ]) {
    it(`test_delegation_phrases_are_recognised [${answer}]`, () => {
      expect(isDelegationAnswer(answer)).toBe(true);
    });
  }

  for (const answer of [
    "端口必须是 8080",
    "用 Python 3.12，内存 4GB",
    "区域 cn-hangzhou，2 核",
    "entry command: python app.py",
    "port 8888",
  ]) {
    it(`test_concrete_answers_are_not_delegation [${answer}]`, () => {
      expect(isDelegationAnswer(answer)).toBe(false);
    });
  }

  it("test_delegation_answer_gets_explicit_clause", () => {
    // A delegation answer adds the settle-it-yourself instruction.
    const prompt = answerPrompt("你自己决定就好", ["Which version?"]);
    expect(prompt).toContain("授权语义");
    expect(prompt).toContain("不得就同一主题再次提问");
    expect(prompt).toContain("- Which version?");
  });

  it("test_normal_answer_has_no_delegation_clause", () => {
    const prompt = answerPrompt("端口 8080");
    expect(prompt).not.toContain("授权语义");
  });
});

describe("TestParseAssessment", () => {
  it("test_full_payload", () => {
    const assessment = parseAssessment({
      completeness: 0.5,
      question: "Which port should be exposed?",
      missing: ["ports", "data"],
      example: "python 3.12 with pandas, port 8888",
    });
    expect(assessment).not.toBeNull();
    expect(assessment!.completeness).toBe(0.5);
    expect(assessment!.question).toBe("Which port should be exposed?");
    expect([...assessment!.missing]).toEqual(["ports", "data"]);
    expect(assessment!.example).toBe("python 3.12 with pandas, port 8888");
  });

  it("test_non_mapping_returns_none", () => {
    expect(parseAssessment("not a mapping")).toBeNull();
    expect(parseAssessment(null)).toBeNull();
  });

  it("test_missing_or_non_numeric_completeness_returns_none", () => {
    expect(parseAssessment({ question: "q" })).toBeNull();
    expect(parseAssessment({ completeness: "high" })).toBeNull();
  });

  it("test_hundred_scale_is_divided", () => {
    const assessment = parseAssessment({ completeness: 90 });
    expect(assessment).not.toBeNull();
    expect(assessment!.completeness).toBe(0.9);
  });

  it("test_values_are_clamped_into_range", () => {
    const negative = parseAssessment({ completeness: -5 });
    expect(negative !== null && negative.completeness === 0.0).toBe(true);
    const oversized = parseAssessment({ completeness: 200 });
    expect(oversized !== null && oversized.completeness === 1.0).toBe(true);
  });

  it("test_blank_question_and_example_become_none", () => {
    const assessment = parseAssessment({ completeness: 0.9, question: "  ", missing: [], example: "" });
    expect(assessment).not.toBeNull();
    expect(assessment!.question).toBeNull();
    expect(assessment!.example).toBeNull();
  });

  it("test_missing_entries_are_cleaned", () => {
    const assessment = parseAssessment({
      completeness: 0.4,
      question: "q",
      missing: [" ports ", "", 7, null],
      example: "e",
    });
    expect(assessment).not.toBeNull();
    expect([...assessment!.missing]).toEqual(["ports"]);
  });
});

describe("TestAssessmentVerdict", () => {
  it("test_complete_at_the_threshold", () => {
    expect(new ClarifyAssessment({ completeness: 0.8, question: null }).complete).toBe(true);
  });

  it("test_below_the_threshold_is_incomplete", () => {
    expect(new ClarifyAssessment({ completeness: 0.79, question: "q" }).complete).toBe(false);
  });

  it("test_missing_summary_falls_back_to_unknown", () => {
    expect(new ClarifyAssessment({ completeness: 0.1, question: "q" }).missingSummary()).toBe("unknown");
    const summary = new ClarifyAssessment({ completeness: 0.1, question: "q", missing: ["ports", "data"] }).missingSummary();
    expect(summary).toBe("ports, data");
  });
});

type Captured = Record<string, any>;

describe("TestRunResearch", () => {
  const BINARY = "/fake/qwen";

  function capture(opts: { result?: QwenCodeRunResult | null; raises?: Error | null } = {}): Captured {
    const captured: Captured = {};
    const outcome = opts.result ?? new QwenCodeRunResult({ text: "facts", isError: false, exitCode: 0 });
    vi.spyOn(clarify.seams, "runQwenCodeHeadless").mockImplementation(async (prompt, kwargs) => {
      for (const key of Object.keys(captured)) delete captured[key];
      captured.prompt = prompt;
      Object.assign(captured, kwargs);
      if (opts.raises) throw opts.raises;
      return outcome;
    });
    return captured;
  }

  it("test_research_uses_plain_run_with_session_id", async () => {
    // Research pins the native session and runs WITHOUT --json-schema.
    const captured = capture();

    const outcome = await clarify.runResearch("research this", {
      binary: BINARY,
      env: { OPENAI_API_KEY: "sk-test" },
      cwd: tmpPath,
      sessionId: SESSION,
    });

    expect(outcome).toBeInstanceOf(ResearchOutcome);
    expect(outcome.ok).toBe(true);
    expect(researchSucceeded(outcome)).toBe(true);
    expect(outcome.reason).toBe("");
    expect(outcome.detail).toBe("");
    expect(captured.prompt).toBe("research this");
    expect(captured.sessionId).toBe(SESSION);
    expect(captured.resume ?? null).toBeNull();
    expect("jsonSchema" in captured).toBe(false); // plain run — tool loop stays free
    expect(captured.maxSessionTurns).toBe(RESEARCH_SESSION_TURNS);
    expect(captured.timeout).toBe(DEFAULT_RESEARCH_TIMEOUT);
  });

  it("test_error_result_is_classified_as_command_failed", async () => {
    // A non-zero agent exit degrades to a classified, non-blocking outcome.
    capture({ result: new QwenCodeRunResult({ text: "boom", isError: true, exitCode: 7 }) });

    const outcome = await clarify.runResearch("p", { binary: BINARY, env: null, cwd: tmpPath, sessionId: SESSION });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe(RESEARCH_REASON_COMMAND_FAILED);
    expect(outcome.detail).toBe("exit code 7");
  });

  it("test_unclassified_codegen_error_degrades_to_command_failed", async () => {
    capture({ raises: new AICodegenError("timed out") });

    const outcome = await clarify.runResearch("p", { binary: BINARY, env: null, cwd: tmpPath, sessionId: SESSION });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe(RESEARCH_REASON_COMMAND_FAILED);
  });

  it("test_timeout_is_classified_as_timeout", async () => {
    capture({ raises: new QwenCodeTimeoutError("did not finish") });

    const outcome = await clarify.runResearch("p", {
      binary: BINARY,
      env: null,
      cwd: tmpPath,
      sessionId: SESSION,
      timeout: 123.0,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe(RESEARCH_REASON_TIMEOUT);
    expect(outcome.detail).toBe("no result within 123s");
  });

  for (const [label, make] of [
    ["QwenCodeNotInstalledError", () => new QwenCodeNotInstalledError("not installed")],
    ["QwenCodeStartupError", () => new QwenCodeStartupError("spawn failed")],
  ] as Array<[string, () => Error]>) {
    it(`test_unavailable_agent_is_classified_as_agent_unavailable [${label}]`, async () => {
      // Missing binary and failed spawn both mean "agent unavailable".
      capture({ raises: make() });

      const outcome = await clarify.runResearch("p", { binary: BINARY, env: null, cwd: tmpPath, sessionId: SESSION });

      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe(RESEARCH_REASON_AGENT_UNAVAILABLE);
      expect(outcome.detail).toBe("");
    });
  }

  it("test_turn_limit_exit_is_classified_as_turn_limit", async () => {
    // qwen exits 53 when it runs out of turns: not a generic failure.
    capture({ result: new QwenCodeRunResult({ text: "", isError: true, exitCode: 53 }) });

    const outcome = await clarify.runResearch("p", { binary: BINARY, env: null, cwd: tmpPath, sessionId: SESSION });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe(RESEARCH_REASON_TURN_LIMIT);
    expect(outcome.detail).toContain(String(RESEARCH_SESSION_TURNS));
  });

  it("test_timeout_comes_from_the_environment_override", async () => {
    process.env.ABX_QWEN_RESEARCH_TIMEOUT = "77";
    const captured = capture();

    await clarify.runResearch("p", { binary: BINARY, env: null, cwd: tmpPath, sessionId: SESSION });

    expect(captured.timeout).toBe(77.0);
  });

  it("test_on_activity_is_forwarded_only_when_given", async () => {
    let captured = capture();
    await clarify.runResearch("p", { binary: BINARY, env: null, cwd: tmpPath, sessionId: SESSION });
    expect("onActivity" in captured).toBe(false); // legacy runners keep working

    const callback = (_summary: string): void => {};

    vi.restoreAllMocks();
    captured = capture();
    await clarify.runResearch("p", {
      binary: BINARY,
      env: null,
      cwd: tmpPath,
      sessionId: SESSION,
      onActivity: callback,
    });
    expect(captured.onActivity).toBe(callback);
  });

  it("test_raw_stderr_only_reaches_the_debug_log", async () => {
    // Raw stderr stays in the debug log; only the stable fields travel.
    const secret = "SECRET-RAW-STDERR";
    capture({ result: new QwenCodeRunResult({ text: "boom", isError: true, exitCode: 1, rawStderr: secret }) });

    const lines: string[] = [];
    class Collect extends Handler {
      override emit(record: LogRecord): void {
        lines.push(record.getMessage());
      }
    }
    const logger = stdGetLogger("agent_sandbox.agent.clarify");
    const handler = new Collect();
    const previousLevel = logger.level;
    logger.addHandler(handler);
    logger.setLevel(DEBUG);
    let outcome: ResearchOutcome;
    try {
      outcome = await clarify.runResearch("p", { binary: BINARY, env: null, cwd: tmpPath, sessionId: SESSION });
    } finally {
      logger.removeHandler(handler);
      logger.setLevel(previousLevel);
    }

    expect(lines.join("\n")).toContain(secret); // debug keeps the raw stderr
    expect(outcome.reason).toBe(RESEARCH_REASON_COMMAND_FAILED);
    expect(outcome.detail).not.toContain(secret);
  });
});

/** The stable, machine-readable research failure codes. */
describe("TestResearchReasons", () => {
  it("test_reason_codes_are_stable_literals", () => {
    expect(RESEARCH_REASON_TIMEOUT).toBe("timeout");
    expect(RESEARCH_REASON_AGENT_UNAVAILABLE).toBe("agent-unavailable");
    expect(RESEARCH_REASON_COMMAND_FAILED).toBe("command-failed");
    expect(RESEARCH_REASON_TURN_LIMIT).toBe("turn-limit");
  });

  it("test_codes_are_distinct", () => {
    const codes = new Set([
      RESEARCH_REASON_TIMEOUT,
      RESEARCH_REASON_AGENT_UNAVAILABLE,
      RESEARCH_REASON_COMMAND_FAILED,
      RESEARCH_REASON_TURN_LIMIT,
    ]);
    expect(codes.size).toBe(4);
  });
});

describe("TestEvaluate", () => {
  const BINARY = "/fake/qwen";

  function capture(opts: { result?: QwenCodeRunResult | null } = {}): Captured {
    const captured: Captured = {};
    const outcome =
      opts.result ??
      new QwenCodeRunResult({ text: JSON.stringify(PAYLOAD), isError: false, exitCode: 0, structured: PAYLOAD });
    vi.spyOn(clarify.seams, "runQwenCodeHeadless").mockImplementation(async (prompt, kwargs) => {
      for (const key of Object.keys(captured)) delete captured[key];
      captured.prompt = prompt;
      Object.assign(captured, kwargs);
      return outcome;
    });
    return captured;
  }

  it("test_uses_native_session_and_structured_output", async () => {
    const captured = capture();

    const assessment = await clarify.evaluate("assess this", {
      binary: BINARY,
      env: { OPENAI_API_KEY: "sk-test" },
      cwd: tmpPath,
      sessionId: SESSION,
    });

    expect(assessment).not.toBeNull();
    expect(assessment!.completeness).toBe(0.9);
    expect(captured.prompt).toBe("assess this");
    expect(captured.sessionId).toBe(SESSION);
    expect(captured.resume ?? null).toBeNull();
    expect(captured.jsonSchema).toBe(CLARIFY_SCHEMA);
    expect(captured.maxSessionTurns).toBe(ASSESS_SESSION_TURNS);
  });

  it("test_on_activity_is_forwarded_only_when_given", async () => {
    let captured = capture();
    await clarify.evaluate("p", { binary: BINARY, env: null, cwd: tmpPath });
    expect("onActivity" in captured).toBe(false);

    const callback = (_summary: string): void => {};

    vi.restoreAllMocks();
    captured = capture();
    await clarify.evaluate("p", { binary: BINARY, env: null, cwd: tmpPath, onActivity: callback });
    expect(captured.onActivity).toBe(callback);
  });

  it("test_resume_round_continues_the_same_session", async () => {
    const captured = capture();

    await clarify.evaluate("answer", { binary: BINARY, env: null, cwd: tmpPath, resume: SESSION });

    expect(captured.resume).toBe(SESSION);
    expect(captured.sessionId ?? null).toBeNull();
  });

  it("test_failed_run_degrades_to_none", async () => {
    capture({ result: new QwenCodeRunResult({ text: "boom", isError: true, exitCode: 1 }) });

    expect(await clarify.evaluate("p", { binary: BINARY, env: null, cwd: tmpPath })).toBeNull();
  });

  it("test_codegen_error_degrades_to_none", async () => {
    vi.spyOn(clarify.seams, "runQwenCodeHeadless").mockImplementation(async () => {
      throw new AICodegenError("timed out");
    });

    expect(await clarify.evaluate("p", { binary: BINARY, env: null, cwd: tmpPath })).toBeNull();
  });

  it("test_unparseable_payload_returns_none", async () => {
    capture({ result: new QwenCodeRunResult({ text: "hi", isError: false, exitCode: 0, structured: "nope" }) });

    expect(await clarify.evaluate("p", { binary: BINARY, env: null, cwd: tmpPath })).toBeNull();
  });
});

describe("TestOutcomeDefaults", () => {
  it("test_outcome_is_inert_by_default", () => {
    const outcome = new clarify.ClarifyOutcome();
    expect(outcome.sessionId).toBe("");
    expect(outcome.rounds).toBe(0);
    expect(outcome.degraded).toBe(false);
    expect(outcome.skipped).toBe(false);
  });

  it("test_research_outcome_is_bool_compatible", () => {
    // Legacy callers keep working: truthiness mirrors `ok` (read `.ok` / `researchSucceeded` in JS).
    const ok = new ResearchOutcome({ ok: true });
    expect(researchSucceeded(ok)).toBe(true);
    expect(ok.reason).toBe("");
    expect(ok.detail).toBe("");
    const failed = new ResearchOutcome({ ok: false, reason: RESEARCH_REASON_TIMEOUT });
    expect(researchSucceeded(failed)).toBe(false);
    expect(failed.detail).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Extra coverage for the TypeScript port (no Python counterpart)
// ---------------------------------------------------------------------------

describe("TestPromptGolden", () => {
  const golden = readGolden().clarify;

  it("research prompts are byte-identical to the original Python module", () => {
    for (const entry of golden.research) expect(researchPrompt(entry.description)).toBe(entry.prompt);
  });

  it("assessment prompts are byte-identical to the original Python module", () => {
    for (const entry of golden.assessment) expect(assessmentPrompt(entry.description)).toBe(entry.prompt);
  });

  it("answer prompts are byte-identical to the original Python module", () => {
    expect(golden.answer.length).toBeGreaterThan(10);
    for (const entry of golden.answer) expect(answerPrompt(entry.answer, entry.asked)).toBe(entry.prompt);
  });

  it("delegation detection agrees with the original Python module", () => {
    for (const entry of golden.is_delegation) {
      expect(isDelegationAnswer(entry.answer), JSON.stringify(entry.answer)).toBe(entry.result);
    }
  });
});

describe("TestSeams", () => {
  it("the exported runResearch / evaluate / newSessionId go through the seams", async () => {
    const outcome = new ResearchOutcome({ ok: true });
    const research = vi.spyOn(clarify.seams, "runResearch").mockResolvedValue(outcome);
    const evaluate = vi.spyOn(clarify.seams, "evaluate").mockResolvedValue(null);
    vi.spyOn(clarify.seams, "newSessionId").mockReturnValue("fixed");
    expect(await clarify.runResearch("p", { binary: "b", env: null, cwd: "c", sessionId: "s" })).toBe(outcome);
    expect(await clarify.evaluate("p", { binary: "b", env: null, cwd: "c" })).toBeNull();
    expect(newSessionId()).toBe("fixed");
    expect(research).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(path.isAbsolute(tmpPath)).toBe(true);
  });

  it("researchSucceeded accepts the legacy plain boolean and null", () => {
    expect(researchSucceeded(true)).toBe(true);
    expect(researchSucceeded(false)).toBe(false);
    expect(researchSucceeded(null)).toBe(false);
    expect(researchSucceeded(undefined)).toBe(false);
  });
});

describe("TestParseAssessmentPythonSemantics", () => {
  it("accepts numeric strings and booleans like float(...)", () => {
    expect(parseAssessment({ completeness: "0.7" })!.completeness).toBe(0.7);
    expect(parseAssessment({ completeness: " 90 " })!.completeness).toBe(0.9);
    expect(parseAssessment({ completeness: true })!.completeness).toBe(1.0);
    expect(parseAssessment({ completeness: false })!.completeness).toBe(0.0);
    expect(parseAssessment({ completeness: "nan" })).not.toBeNull();
  });

  it("ignores non-list missing and non-string question / example", () => {
    const parsed = parseAssessment({ completeness: 0.5, question: 5, example: ["x"], missing: "ports" })!;
    expect(parsed.question).toBeNull();
    expect(parsed.example).toBeNull();
    expect([...parsed.missing]).toEqual([]);
  });

  it("matches the Python module on a battery of payloads", () => {
    // Expected values produced with the original agent_sandbox.agent.clarify.parse_assessment.
    const cases: Array<[unknown, [number, string | null, string[], string | null] | null]> = [
      [{ completeness: 1, question: "  Q  ", missing: ["a", " b "], example: " e " }, [1.0, "Q", ["a", "b"], "e"]],
      [{ completeness: 100 }, [1.0, null, [], null]],
      [{ completeness: 1.5 }, [0.015, null, [], null]],
      [{ completeness: 0 }, [0.0, null, [], null]],
      [[], null],
      [{ completeness: [1] }, null],
      [{ completeness: {} }, null],
    ];
    for (const [payload, expected] of cases) {
      const got = parseAssessment(payload);
      if (expected === null) expect(got).toBeNull();
      else {
        expect(got).not.toBeNull();
        expect([got!.completeness, got!.question, [...got!.missing], got!.example]).toEqual(expected);
      }
    }
  });
});

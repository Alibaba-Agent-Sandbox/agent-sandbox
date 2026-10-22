/**
 * Research-first requirement clarification for `abx create --prompt "<description>"`.
 *
 * Port of `agent_sandbox/agent/clarify.py`. The natural-language create path starts from one free-form sentence. The
 * clarification phase is **two phases on one native Qwen Code session**, and both the research and the questions come
 * from Qwen Code itself:
 *
 * - **Phase R (research)** — one plain headless run (`--session-id`, no `--json-schema`). The agent is instructed to
 *   settle every *publicly verifiable* fact with its own native tools (`web_fetch`, shell) before anything is asked.
 *   `--json-schema` is deliberately absent here: the structured-output contract ends the session on the first valid
 *   `structured_output` call, which would cut the tool loop short before any research happened.
 * - **Phase A (assessment)** — the *same* session continues (`--resume`) with `--json-schema` and returns the
 *   structured completeness verdict. Only user preferences, private constraints and business decisions that the agent
 *   cannot infer may be marked missing; publicly verifiable facts may not.
 *
 * Agent Sandbox never re-implements the agent loop and never replays the transcript by hand; it keeps only the input
 * contract, the one-question-per-round experience, the threshold gate ({@link CLARITY_THRESHOLD}), delegation-answer
 * detection ({@link isDelegationAnswer}), anti-repetition (asked questions are embedded in every follow-up prompt),
 * non-interactive behaviour and the thin adapter to the host CLI.
 */

import { randomUUID } from "node:crypto";

import {
  AICodegenError,
  QwenCodeNotInstalledError,
  QwenCodeStartupError,
  QwenCodeTimeoutError,
} from "../models/errors.js";
import { getLogger } from "../utils/logging.js";
import { formatFixed0, parsePyFloat, pyStrip } from "./_pycompat.js";
import { isDict } from "./_py.js";
import { type QwenCodeRunResult, type RunHeadlessOptions, runQwenCodeHeadless } from "./qwen_code.js";

const logger = getLogger("agent.clarify");

/** Completeness (0-1) an assessment must reach before AI generation runs. */
export const CLARITY_THRESHOLD = 0.8;

/**
 * Hard cap on interactive question rounds (one question per round). This is an internal safety bound only — the UX
 * never shows `N/5`; the cap is mentioned to the user only when it is actually reached.
 */
export const MAX_CLARIFY_ROUNDS = 5;

/**
 * Turn budget for the research round. Research performs real tool calls (`web_fetch` / shell), so it needs a far
 * larger budget than the pure reasoning assessment — but still bounded so a misbehaving model cannot burn the whole
 * timeout. Kept modest: every `web_fetch` also costs an extra model call to summarise the page (20-60s each,
 * measured), so a huge turn budget only lets a slow research round run into the timeout.
 */
export const RESEARCH_SESSION_TURNS = 20;

/**
 * Turn budget for one assessment round. An assessment is pure reasoning (the structured-output session runs no
 * further research), so a small budget is enough and keeps a misbehaving model from burning the whole timeout.
 */
export const ASSESS_SESSION_TURNS = 3;

/** Wall-clock budget for the research round (seconds). Larger than the assessment budget: web fetches take time. */
export const DEFAULT_RESEARCH_TIMEOUT = 240.0;

/** Wall-clock budget for one assessment round (seconds). Much smaller than code generation. */
export const DEFAULT_CLARIFY_TIMEOUT = 180.0;

/** Stable research-failure reason codes carried by {@link ResearchOutcome}. */
export const RESEARCH_REASON_TIMEOUT = "timeout";
export const RESEARCH_REASON_AGENT_UNAVAILABLE = "agent-unavailable";
export const RESEARCH_REASON_COMMAND_FAILED = "command-failed";
export const RESEARCH_REASON_TURN_LIMIT = "turn-limit";

/** qwen-code exit code for an exceeded `--max-session-turns` budget. */
const QWEN_EXIT_TURN_LIMIT = 53;

/** Research wall-clock budget: {@link DEFAULT_RESEARCH_TIMEOUT} unless `ABX_QWEN_RESEARCH_TIMEOUT` (positive seconds) overrides it. */
export function defaultResearchTimeout(): number {
  const raw = process.env.ABX_QWEN_RESEARCH_TIMEOUT;
  if (raw) {
    const value = parsePyFloat(raw);
    if (value === null) return DEFAULT_RESEARCH_TIMEOUT;
    if (value > 0) return value;
  }
  return DEFAULT_RESEARCH_TIMEOUT;
}

/**
 * Answer fragments that mean the user delegated the decision back to the agent. Matching is substring-based on the
 * normalised answer; the answer text is *always* forwarded to the session verbatim, so a false positive can only ever
 * add "don't re-ask this topic" pressure — never lose the user's own words.
 */
const DELEGATION_MARKERS: readonly string[] = ["你自己", "你决定", "你定", "你选", "你挑", "你看着办", "你来定", "你来选", "由你决定", "由你来", "自行决定", "自己决定", "自己检索", "自己查", "自己选", "随便你", "随便", "都可以", "无所谓", "没要求", "没有要求", "没偏好", "不确定", "不知道", "采用默认", "用默认", "合理默认", "默认即可", "默认就行", "默认就好", "you decide", "you choose", "you pick", "up to you", "your choice", "your call", "as you see fit", "whatever you", "anything is fine", "anything works", "any is fine", "any works", "no preference", "don't care", "do not care", "no requirement", "no requirements", "not sure", "don't know", "do not know", "use default", "use the default", "defaults are fine", "sensible default", "reasonable default", "default is fine", "decide yourself", "figure it out", "search yourself", "research yourself"];

/** JSON Schema handed to `qwen --json-schema`. `question` is a single string (never a list). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CLARIFY_SCHEMA: Record<string, any> = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "completeness",
    "question",
    "missing",
    "example"
  ],
  "properties": {
    "completeness": {
      "type": "number",
      "description": "How complete the information is for generating a runnable template, from 0 (nothing useful) to 1 (everything needed). Publicly verifiable facts that you can research or infer yourself count as complete; only user preferences, private constraints, and business decisions you cannot infer may count as missing. 0.8 or above means generation can proceed."
    },
    "question": {
      "type": "string",
      "description": "Exactly ONE most important follow-up question, in the same language as the user's description. Only about information you cannot publicly verify or infer yourself (required versions, region, resource size, private dependencies, entry/port choices) — never about public facts such as the tool stack, the official install method, or common dependencies, and never repeating an already-asked or already-answered topic. Empty string when no question is needed."
    },
    "missing": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Short labels of the information still missing — only user preferences, private constraints, or business decisions (e.g. [\"entry command choice\", \"resource size\"]). Public facts must not appear here."
    },
    "example": {
      "type": "string",
      "description": "A ready-to-use example description, in the same language as the user's input, that fills in the missing details."
    }
  }
};

const researchPromptTemplate = (description: string): string => `你是 Agent Sandbox 的模板需求分析器。用户会用一句自然语言描述想创建的沙箱，
随后将据此生成 Dockerfile、commands.py（agent_sandbox.server HTTP 服务）和 template.yaml。

用户描述：
${description}

请先用你可用的工具（如 web_fetch、shell）检索这个描述涉及的**可公开查证的
事实**，至少覆盖：
- 描述中提到的工具/框架属于什么技术栈（例如是否 Node.js / Python 工具）
- 官方推荐的安装方式与常用版本
- 常见运行时与依赖

效率要求：总共最多 3 次网络检索（web_fetch 较慢，每次都会额外消耗一次模型
调用）；能用 shell 一条命令确认的（如 \`npm view <包名> version\`、
\`pip index versions <包名>\`）优先用 shell；拿到足够结论就立即停止检索。

这些是公共事实，后续一律不得向用户提问；检索不到时直接采用安全合理的默认值，
并在总结中逐条明确记录这些假设。

检索完成后，输出两部分内容（使用与用户描述相同的语言，不要输出推理过程）：
1. 已确认的公开事实清单（含采用的默认值与假设）。
2. 仅剩的、无法自行查证或推断的信息清单——只允许是用户偏好、私有约束或
   业务决策（例如必须使用的版本、区域、资源规格、私有依赖、入口和端口选择）。

不要向用户提问，不要生成任何文件。`;

const assessmentPromptTemplate = (description: string): string => `你是 Agent Sandbox 的模板需求分析器。以下是用户想创建的沙箱描述；若本会话
此前已完成事实检索，请直接采用其结论（包括其中记录的默认值与假设）。

用户描述：
${description}

请评估生成一个可运行模板（Dockerfile + commands.py + template.yaml）所需信息的完整度。
说明：每个模板都会在 9000 端口运行 agent_sandbox.server 提供的 HTTP 服务（通用的
健康检查、命令、文件、shell 接口都是现成的），这部分是固定做法，不得向用户提问；
只有需求里的业务接口、入口命令或端口无法自行推断时，才可作为缺失项。
评估维度：runtime（运行时/基础镜像）、dependencies（预装依赖）、
entry command（入口命令）、ports（端口）、resources（CPU/内存）、data（数据）。

判定规则：
1. 可公开查证的事实（工具链类型、官方安装方式、常见运行时与依赖）不得视为
   缺失，也不得作为问题提出——这些应由你自己检索确认并采用安全合理默认。
2. 只把无法自行查证或推断的用户偏好、私有约束、业务决策视为缺失（如必须
   使用的版本、区域、资源规格、私有依赖、入口和端口选择）。
3. 用户以“你自己决定/采用默认”等授权语义回答过的维度视为已解决（采用安全
   合理默认），不得就同一主题再次提问。
4. 不得重复已问过的问题或已回答的主题。

输出要求：
1. completeness：0 到 1 的完整度（按上述规则覆盖越多越高；0.8 及以上视为足够）。
2. question：若 completeness < 0.8，给出唯一一个最关键的问题（只问一个，
   聚焦能显著提升完整度的缺失信息，使用与用户描述相同的语言）；若已足够，
   输出空字符串。
3. missing：缺失维度的简短标签列表（只含规则 2 允许的项）。
4. example：一句补全缺失信息后的示例描述（与用户描述相同语言）。
不要生成文件，不要提出多个问题。`;

const followupPromptTemplate = (answer: string, delegationClause: string, askedClause: string): string => `用户对澄清问题的回答：
${answer}
${delegationClause}
${askedClause}
请结合原始描述、此前检索确认的事实与全部问答记录重新评估完整度，并按同样
的结构化格式输出（仅一个最关键的问题；若已足够，question 为空字符串）。`;

const DELEGATION_CLAUSE = `该回答包含授权语义（用户委托你自行决定）：请对被授权的部分自行检索确认或
采用安全合理默认，视为相应维度已解决，不得就同一主题再次提问。`;

const askedClauseTemplate = (asked: string): string => `已问过的问题（不得重复这些主题）：
${asked}`;

/** One structured completeness assessment returned by Qwen Code. */
export class ClarifyAssessment {
  /** Model-estimated completeness in 0..1 (clamped by {@link parseAssessment}). */
  readonly completeness: number;
  /** The single most important follow-up question, or `null`. */
  readonly question: string | null;
  /** Short labels of the template-relevant details still missing. */
  readonly missing: readonly string[];
  /** Ready-to-use example description suggested by the model. */
  readonly example: string | null;

  constructor(init: { completeness: number; question: string | null; missing?: readonly string[]; example?: string | null }) {
    this.completeness = init.completeness;
    this.question = init.question;
    this.missing = Object.freeze([...(init.missing ?? [])]);
    this.example = init.example ?? null;
    Object.freeze(this);
  }

  /** Whether the assessment clears the Agent Sandbox threshold gate. */
  get complete(): boolean {
    return this.completeness >= CLARITY_THRESHOLD;
  }

  /** Comma-separated missing labels (`"unknown"` when empty). */
  missingSummary(): string {
    return this.missing.length > 0 ? this.missing.join(", ") : "unknown";
  }
}

/**
 * Result of the clarification phase, consumed by the create command.
 *
 * `sessionId` is non-empty only once the first assessment round has succeeded; the generation step then resumes that
 * very session so the model keeps the full clarification context in its own memory.
 */
export class ClarifyOutcome {
  sessionId = "";
  assessment: ClarifyAssessment | null = null;
  /** Number of interactive question rounds actually asked. */
  rounds = 0;
  /** `true` when the assessment was unavailable (never blocks). */
  degraded = false;
  /** `true` when `--yes` skipped clarification entirely. */
  skipped = false;

  constructor(init: Partial<ClarifyOutcome> = {}) {
    Object.assign(this, init);
  }
}

/**
 * Sanitised result of the phase-R research round.
 *
 * `ok` is the single gate: the create flow degrades on a falsy outcome and never blocks (JavaScript objects cannot
 * override truthiness, so callers read `outcome.ok`). `reason` is a stable failure code — one of the `RESEARCH_REASON_*` constants — and `detail` is an
 * optional, already-sanitised one-line context. Raw agent stderr and unclassified exception text never leave the
 * debug log, so callers can safely render both fields.
 */
export class ResearchOutcome {
  readonly ok: boolean;
  readonly reason: string;
  readonly detail: string;

  constructor(init: { ok: boolean; reason?: string; detail?: string }) {
    this.ok = init.ok;
    this.reason = init.reason ?? "";
    this.detail = init.detail ?? "";
    Object.freeze(this);
  }

}

/** Fresh UUID for the native Qwen Code session all rounds share. */
export function newSessionId(): string {
  return seams.newSessionId();
}

/**
 * Whether `answer` delegates the decision back to the agent. Matches curated Chinese/English fragments such as
 * “你自己决定”, “采用默认”, "you decide", "up to you", "use the default".
 */
export function isDelegationAnswer(answer: string): boolean {
  const normalized = pyStrip(answer).toLowerCase();
  return DELEGATION_MARKERS.some((marker) => normalized.includes(marker));
}

/** Phase-R prompt: settle the public facts before anything is asked. */
export function researchPrompt(description: string): string {
  return researchPromptTemplate(pyStrip(description));
}

/** Phase-A prompt: structured completeness verdict (first round). */
export function assessmentPrompt(description: string): string {
  return assessmentPromptTemplate(pyStrip(description));
}

/**
 * Follow-up prompt: hand one user answer back to the same session. `asked` is the list of questions already shown to
 * the user; it is embedded verbatim so the model cannot repeat a topic. A delegation answer adds an explicit clause.
 */
export function answerPrompt(answer: string, asked: Iterable<string> = []): string {
  const askedList = [...asked];
  const delegationClause = isDelegationAnswer(answer) ? DELEGATION_CLAUSE : "";
  const askedClause =
    askedList.length > 0 ? askedClauseTemplate(askedList.map((q) => `- ${q}`).join("\n")) : "";
  return followupPromptTemplate(pyStrip(answer), delegationClause, askedClause);
}

/**
 * Normalise a `structured_result` payload; `null` when unusable. Tolerates a 0-100 completeness scale (divided by
 * 100) and clamps the value into 0..1, so a chatty model can never corrupt the threshold gate. A payload without a
 * numeric `completeness` is unusable.
 */
export function parseAssessment(payload: unknown): ClarifyAssessment | null {
  if (!isDict(payload)) return null;
  const raw = payload.completeness;
  let completeness: number | null;
  if (typeof raw === "number") completeness = raw;
  else if (typeof raw === "boolean") completeness = raw ? 1 : 0;
  else if (typeof raw === "string") completeness = parsePyFloat(raw);
  else completeness = null;
  if (completeness === null) return null;
  if (completeness > 1.0) completeness /= 100.0;
  completeness = Math.min(Math.max(completeness, 0.0), 1.0);

  const question = payload.question;
  const questionText = typeof question === "string" ? pyStrip(question) : "";
  const example = payload.example;
  const exampleText = typeof example === "string" ? pyStrip(example) : "";

  const missingRaw = payload.missing;
  const missing: string[] = [];
  if (Array.isArray(missingRaw)) {
    for (const item of missingRaw) {
      if (typeof item !== "string") continue;
      const text = pyStrip(item);
      if (text) missing.push(text);
    }
  }

  return new ClarifyAssessment({
    completeness,
    question: questionText || null,
    missing,
    example: exampleText || null,
  });
}

export interface RunResearchOptions {
  binary: string;
  env: Readonly<Record<string, string>> | null | undefined;
  cwd: string;
  sessionId: string;
  timeout?: number | null;
  onActivity?: ((summary: string) => void) | null;
}

/**
 * Run the phase-R research round through Qwen Code.
 *
 * A plain headless run (no `--json-schema`) on the native session `sessionId` so the agent can use its own tools to
 * settle public facts. Never throws and never blocks: every failure mode is mapped to a stable {@link ResearchOutcome}
 * reason (`timeout`, `turn-limit`, `agent-unavailable`, `command-failed`). Raw stderr is only ever written to the
 * debug log; `detail` stays sanitised.
 */
export function runResearch(prompt: string, opts: RunResearchOptions): Promise<ResearchOutcome> {
  return seams.runResearch(prompt, opts);
}

async function runResearchImpl(prompt: string, opts: RunResearchOptions): Promise<ResearchOutcome> {
  const timeout = opts.timeout == null ? defaultResearchTimeout() : opts.timeout;
  const extra: Partial<RunHeadlessOptions> = opts.onActivity == null ? {} : { onActivity: opts.onActivity };
  let result: QwenCodeRunResult;
  try {
    result = await seams.runQwenCodeHeadless(prompt, {
      binary: opts.binary,
      env: opts.env,
      cwd: opts.cwd,
      timeout,
      maxSessionTurns: RESEARCH_SESSION_TURNS,
      sessionId: opts.sessionId,
      ...extra,
    });
  } catch (exc) {
    if (exc instanceof QwenCodeTimeoutError) {
      // Subclass of `AICodegenError` — must be classified first.
      logger.debug("Clarification research timed out: %s", String(exc));
      return new ResearchOutcome({
        ok: false,
        reason: RESEARCH_REASON_TIMEOUT,
        detail: `no result within ${formatFixed0(timeout)}s`,
      });
    }
    if (exc instanceof QwenCodeNotInstalledError || exc instanceof QwenCodeStartupError) {
      logger.debug("Clarification research unavailable: %s", String(exc));
      return new ResearchOutcome({ ok: false, reason: RESEARCH_REASON_AGENT_UNAVAILABLE });
    }
    if (exc instanceof AICodegenError) {
      logger.debug("Clarification research failed: %s", String(exc));
      return new ResearchOutcome({ ok: false, reason: RESEARCH_REASON_COMMAND_FAILED });
    }
    throw exc;
  }
  if (result.isError) {
    logger.debug(
      "Clarification research failed: exit_code=%s stderr=%s",
      result.exitCode,
      pyStrip(result.rawStderr || "").slice(0, 200),
    );
    if (result.exitCode === QWEN_EXIT_TURN_LIMIT) {
      return new ResearchOutcome({
        ok: false,
        reason: RESEARCH_REASON_TURN_LIMIT,
        detail: `exceeded ${RESEARCH_SESSION_TURNS} turns`,
      });
    }
    return new ResearchOutcome({
      ok: false,
      reason: RESEARCH_REASON_COMMAND_FAILED,
      detail: `exit code ${result.exitCode}`,
    });
  }
  return new ResearchOutcome({ ok: true });
}

export interface EvaluateOptions {
  binary: string;
  env: Readonly<Record<string, string>> | null | undefined;
  cwd: string;
  sessionId?: string | null;
  resume?: string | null;
  timeout?: number;
  onActivity?: ((summary: string) => void) | null;
}

/**
 * Run one structured assessment round through Qwen Code.
 *
 * The caller sets exactly one of `sessionId` (the session may not exist yet — pin/create it) or `resume` (the research
 * round or a previous assessment already created it). Never throws for a plain assessment failure: a timeout, a
 * crash, or a payload that fails to parse returns `null` so the create command can degrade to direct generation
 * instead of blocking the user.
 */
export function evaluate(prompt: string, opts: EvaluateOptions): Promise<ClarifyAssessment | null> {
  return seams.evaluate(prompt, opts);
}

async function evaluateImpl(prompt: string, opts: EvaluateOptions): Promise<ClarifyAssessment | null> {
  const timeout = opts.timeout ?? DEFAULT_CLARIFY_TIMEOUT;
  const extra: Partial<RunHeadlessOptions> = opts.onActivity == null ? {} : { onActivity: opts.onActivity };
  let result: QwenCodeRunResult;
  try {
    result = await seams.runQwenCodeHeadless(prompt, {
      binary: opts.binary,
      env: opts.env,
      cwd: opts.cwd,
      timeout,
      maxSessionTurns: ASSESS_SESSION_TURNS,
      sessionId: opts.sessionId,
      resume: opts.resume,
      jsonSchema: CLARIFY_SCHEMA,
      ...extra,
    });
  } catch (exc) {
    if (exc instanceof AICodegenError) {
      logger.debug("Clarification assessment unavailable: %s", String(exc));
      return null;
    }
    throw exc;
  }
  if (result.isError) {
    logger.debug(
      "Clarification assessment failed: exit_code=%s stderr=%s",
      result.exitCode,
      pyStrip(result.rawStderr || "").slice(0, 200),
    );
    return null;
  }
  return parseAssessment(result.structured);
}

/**
 * Patch points mirroring the module attributes Python tests monkeypatch (`clarify.run_qwen_code_headless`,
 * `clarify.run_research`, `clarify.evaluate`, `clarify.new_session_id`). The exported functions delegate to these
 * entries, so replacing one intercepts every caller (including the coding-agent backend).
 */
export const seams = {
  newSessionId: (() => randomUUID()) as () => string,
  runResearch: runResearchImpl as (prompt: string, opts: RunResearchOptions) => Promise<ResearchOutcome>,
  evaluate: evaluateImpl as (prompt: string, opts: EvaluateOptions) => Promise<ClarifyAssessment | null>,
  runQwenCodeHeadless: runQwenCodeHeadless as (prompt: string, opts?: RunHeadlessOptions) => Promise<QwenCodeRunResult>,
};

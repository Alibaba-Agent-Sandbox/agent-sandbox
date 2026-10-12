/**
 * Consistency tests for the bilingual BYO agent integration guide.
 *
 * Task 196 added `docs/en/guide/byo-agent-integration.md` and `docs/zh/guide/byo-agent-integration.md` plus index
 * entries in `docs/{en,zh}/README.md` / `docs/{en,zh}/DESIGN.md` and the ADR
 * `.agents/notes/implemented/architecture/2026-09-29-byo-agent-integration-contract.md`.
 *
 * These tests keep the verified facts honest and both language versions in sync (see the Python original for the
 * complete list of invariants). Scope: only the BYO agent integration docs.
 */

import path from "node:path";

import { expect, it } from "vitest";

import { REPO_ROOT, exists, fencedBlocks, headingSlugs, read, relativeLinkTargets } from "./helpers/docsSupport.js";

const GUIDES = {
  en: path.join(REPO_ROOT, "docs/en/guide/byo-agent-integration.md"),
  zh: path.join(REPO_ROOT, "docs/zh/guide/byo-agent-integration.md"),
} as const;
const LANGS = ["en", "zh"] as const;
const DOCS_INDEX_EN = path.join(REPO_ROOT, "docs/en/README.md");
const DOCS_INDEX_ZH = path.join(REPO_ROOT, "docs/zh/README.md");
const DESIGN_EN = path.join(REPO_ROOT, "docs/en/DESIGN.md");
const DESIGN_ZH = path.join(REPO_ROOT, "docs/zh/DESIGN.md");
const ADR = path.join(REPO_ROOT, ".agents/notes/implemented/architecture/2026-09-29-byo-agent-integration-contract.md");

const REQUIRED_AGENTS = ["Qwen Code", "Codex", "Claude Code", "Qoder CLI"];

const REQUIRED_ENV_VARS = [
  "DASHSCOPE_API_KEY",
  "BAILIAN_CODING_PLAN_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "QODER_PERSONAL_ACCESS_TOKEN",
];

const SHARED_TOKENS = [
  "custom_commands",
  "agent_probe",
  "agent_run",
  "command -v qwen",
  "qwen {prompt} --output-format json --max-session-turns {max_turns}",
  'codex exec "<prompt>" --json',
  'claude -p "<prompt>"',
  'qoder -p "<prompt>"',
  "codex exec",
  "claude -p",
  "qoder -p",
  'qwen "<prompt>" --output-format json',
  "--output-format json",
  "stream-json",
  "--max-session-turns",
  "--max-turns",
  "--allowedTools",
  "--sandbox workspace-write",
  "--permission-mode bypass_permissions",
  "--yolo",
  "--bare",
  "DASHSCOPE_API_KEY",
  "BAILIAN_CODING_PLAN_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "QODER_PERSONAL_ACCESS_TOKEN",
  "@qwen-code/qwen-code@<X.Y.Z>",
  "@openai/codex@<X.Y.Z>",
  "npm install -g @qwen-code/qwen-code@<X.Y.Z>",
  "<X.Y.Z>",
  "shasum -a 256",
  "shlex.quote()",
  "/workspace",
  "template.yaml",
  "resources.cpu",
  "resources.memory",
  "SANDBOX_HTTP_TIMEOUT",
  "ebx config set http_timeout N",
  "ebx kill <id>",
  "ebx create --template my-qwen-agent --env DASHSCOPE_API_KEY=<YOUR_KEY> --timeout 3600",
  "ebx run <sandbox-id> agent_probe",
  'ebx run <sandbox-id> agent_run --arg prompt="fix the failing test in tests/"',
  'sb.custom("agent_run", prompt="fix the failing test in tests/")',
  "sandbox.custom()",
  "sandbox.list_commands()",
  "CommandResult",
  "exit_code",
  "stderr",
  "Apache-2.0",
  "curl … | sh",
  "/usr/local/bin",
  "2026-09-29",
];

const REQUIRED_FRAGMENTS: Record<(typeof LANGS)[number], string[]> = {
  en: [
    "Easy Sandbox provides",
    "The agent CLI provides",
    "ships no agent CLI",
    "two independent axes",
    "does not recommend",
    "Official template eligible",
    "Proprietary",
    "distributes no proprietary binaries",
    "disposable sandboxes",
  ],
  zh: [
    "Easy Sandbox 提供",
    "Agent CLI 自行提供",
    "默认基础镜像不预装任何 Agent CLI",
    "两条彼此独立的轴",
    "不推荐",
    "可做官方模板",
    "专有",
    "本仓库不分发任何专有二进制",
    "可丢弃的沙箱",
  ],
};

const CONTRACT_FIELDS = ["cmd", "description", "cwd", "timeout", "env", "args"];


it.each(LANGS)("test_guide_exists_and_is_substantial [%s]", (lang) => {
  const text = read(GUIDES[lang]);
  expect(text.length, `${GUIDES[lang]} looks too short to be the full guide`).toBeGreaterThan(6000);
});

it.each(LANGS)("test_relative_links_resolve [%s]", (lang) => {
  const p = GUIDES[lang];
  const relative = relativeLinkTargets(read(p));
  expect(relative.length, `${p} should link sibling guides (authoring-templates, mcp-integration)`).toBeGreaterThan(0);
  const missing = relative.filter((t) => !exists(path.resolve(path.dirname(p), t)));
  expect(missing, `${p} has broken relative links`).toEqual([]);
});

it.each(LANGS)("test_in_guide_anchors_match_headings [%s]", (lang) => {
  const text = read(GUIDES[lang]);
  const anchors = new Set([...text.matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => m[1] as string));
  expect(anchors.size, `${GUIDES[lang]} should cross-reference its own sections`).toBeGreaterThan(0);
  const slugs = headingSlugs(text);
  const missing = [...anchors].filter((a) => !slugs.has(a));
  expect(missing, `${GUIDES[lang]} anchors do not match any heading`).toEqual([]);
});

it.each(LANGS)("test_agent_matrix_covers_all_agents [%s]", (lang) => {
  const text = read(GUIDES[lang]);
  expect(REQUIRED_AGENTS.filter((n) => !text.includes(n)), `guide (${lang}) does not cover agents`).toEqual([]);
});

it.each(LANGS)("test_responsibility_split_and_two_axes_documented [%s]", (lang) => {
  const text = read(GUIDES[lang]);
  expect(REQUIRED_FRAGMENTS[lang].filter((f) => !text.includes(f)), `guide (${lang}) is missing required statements`).toEqual([]);
});

it.each(LANGS)("test_credential_whitelist_names_present [%s]", (lang) => {
  const text = read(GUIDES[lang]);
  expect(REQUIRED_ENV_VARS.filter((n) => !text.includes(n)), `guide (${lang}) is missing whitelisted env vars`).toEqual([]);
});

it.each(LANGS)("test_custom_commands_contract_fields_documented [%s]", (lang) => {
  const text = read(GUIDES[lang]);
  expect(text.includes("custom_commands"), `guide (${lang}) must anchor the contract on custom_commands`).toBe(true);
  for (const field of CONTRACT_FIELDS) {
    expect(text.includes(`\`${field}\``), `guide (${lang}) must document CustomCommand field '${field}'`).toBe(true);
  }
  expect(text.includes("CustomCommand"), `guide (${lang}) should name the CustomCommand model`).toBe(true);
});

it.each(LANGS)("test_no_curl_pipe_into_shell_in_code_blocks [%s]", (lang) => {
  const blocks = fencedBlocks(read(GUIDES[lang]));
  expect(/curl[^\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/.test(blocks), `${GUIDES[lang]} must never demonstrate piping curl into a shell`).toBe(false);
});

it("test_guides_warn_against_curl_pipes", () => {
  const en = read(GUIDES.en);
  const zh = read(GUIDES.zh);
  expect(en.includes("curl") && en.includes("| sh") && en.includes("does not recommend")).toBe(true);
  expect(zh.includes("curl") && zh.includes("| sh") && zh.includes("不推荐")).toBe(true);
});

it.each(LANGS)("test_version_pinning_and_hash_verification_documented [%s]", (lang) => {
  const text = read(GUIDES[lang]);
  for (const token of ["<X.Y.Z>", "shasum -a 256"]) expect(text.includes(token), `guide (${lang}) must document '${token}'`).toBe(true);
});

it.each(LANGS)("test_qwen_uses_positional_prompt [%s]", (lang) => {
  const text = read(GUIDES[lang]);
  expect(text.includes("qwen -p"), `guide (${lang}) must not show the deprecated \`qwen -p\` prompt form`).toBe(false);
  expect(text.includes("qwen {prompt}"), `guide (${lang}) must document the positional form \`qwen {prompt}\``).toBe(true);
  const marker = lang === "en" ? "deprecated" : "已弃用";
  expect(text.includes(marker), `guide (${lang}) should flag the \`-p\` form as deprecated`).toBe(true);
});

it("test_en_zh_keep_shared_tokens_identical", () => {
  const en = read(GUIDES.en);
  const zh = read(GUIDES.zh);
  const missing = SHARED_TOKENS.filter((t) => !en.includes(t) || !zh.includes(t));
  expect(missing, "command/flag/env tokens drifted between guides").toEqual([]);
});

it("test_guides_cross_link_languages", () => {
  expect(read(GUIDES.en).includes("../../zh/guide/byo-agent-integration.md")).toBe(true);
  expect(read(GUIDES.zh).includes("../../en/guide/byo-agent-integration.md")).toBe(true);
});

it("test_guides_do_not_reintroduce_removed_surfaces", () => {
  for (const lang of LANGS) {
    expect(read(GUIDES[lang]).includes("ebx skill"), `guide (${lang}) must not reintroduce the removed \`ebx skill\` command`).toBe(false);
  }
});

it("test_docs_indexes_link_the_guides", () => {
  for (const p of [DOCS_INDEX_EN, DOCS_INDEX_ZH, DESIGN_EN, DESIGN_ZH]) {
    expect(read(p).includes("guide/byo-agent-integration.md"), p).toBe(true);
  }
});

it("test_adr_records_the_decision_and_links_guides", () => {
  const text = read(ADR);
  expect(text.includes("Status: implemented"), "ADR status must match its implemented/ directory").toBe(true);
  expect(text.includes("docs/en/guide/byo-agent-integration.md")).toBe(true);
  expect(text.includes("docs/zh/guide/byo-agent-integration.md")).toBe(true);
  expect(text.includes("no in-SDK agent runtime")).toBe(true);
  expect(text.includes("custom_commands contract")).toBe(true);
});

/**
 * Consistency tests for the bilingual Agent Skill installation guide.
 *
 * Task 193 added `docs/en/guide/agent-skill-installation.md` and `docs/zh/guide/agent-skill-installation.md` plus short
 * entry points in `SKILL.md`, `llms.txt`, the bilingual READMEs, and the docs indexes.
 *
 * These tests keep the verified facts honest and both language versions in sync. Scope: only the
 * installation/distribution docs.
 */

import path from "node:path";

import { expect, it } from "vitest";

import { REPO_ROOT, exists, fencedBlocks, headingSlugs, read, relativeLinkTargets } from "./helpers/docsSupport.js";

const GUIDES = {
  en: path.join(REPO_ROOT, "docs/en/guide/agent-skill-installation.md"),
  zh: path.join(REPO_ROOT, "docs/zh/guide/agent-skill-installation.md"),
} as const;
const LANGS = ["en", "zh"] as const;
const SKILL_MD = path.join(REPO_ROOT, "SKILL.md");
const LLMS_TXT = path.join(REPO_ROOT, "llms.txt");
const README_EN = path.join(REPO_ROOT, "README.md");
const README_ZH = path.join(REPO_ROOT, "README.zh-CN.md");
const DOCS_INDEX_EN = path.join(REPO_ROOT, "docs/en/README.md");
const DOCS_INDEX_ZH = path.join(REPO_ROOT, "docs/zh/README.md");

/** `skills` CLI agents verified against v1.7.0 `--help` output and the vercel-labs/skills README on 2026-09-29. */
const ALLOWED_AGENTS = new Set(["qoder", "qoder-cn", "claude-code", "cursor", "qwen-code", "codex", "*"]);

const REQUIRED_DIRECTORY_FRAGMENTS = [
  "~/.qoder/skills/",
  ".qoder/skills/",
  "~/.qoder-cn/skills/",
  "~/.claude/skills/",
  ".claude/skills/",
  "~/.cursor/skills/",
  ".cursor/skills/",
  "~/.agents/skills/",
  ".agents/skills/",
  "$HOME/.agents/skills/",
  "~/.qwen/skills/",
  ".qwen/skills/",
];

/**
 * Repository / install-command tokens follow the split: the CLI repository is `easy-sandbox/easy-sandbox` and is installed from npm
 * (the Python original pinned `Easy-Sandbox/easy-sandbox`, `pip index versions easy-sandbox` and the `easy-sandbox[cli]` git URL).
 */
const SHARED_TOKENS = [
  "easy-sandbox/easy-sandbox",
  "npx skills add",
  "npm view @easy-sandbox/cli versions",
  "skills-lock.json",
  "experimental_install",
  "git sparse-checkout set --no-cone /SKILL.md",
  "npm install -g @easy-sandbox/cli",
  "--target cursor",
  "~/.ebx/.env",
  "DISABLE_TELEMETRY=1",
  "DO_NOT_TRACK=1",
  "/plugin marketplace add",
  ".claude-plugin/marketplace.json",
  ".cursor-plugin/",
  "qoder-cn",
  "<TAG-OR-COMMIT>",
  "shasum -a 256",
];

it.each(LANGS)("test_guide_exists_and_is_substantial [%s]", (lang) => {
  expect(read(GUIDES[lang]).length, `${GUIDES[lang]} looks too short to be the full guide`).toBeGreaterThan(4000);
});

it.each(LANGS)("test_relative_links_resolve [%s]", (lang) => {
  const p = GUIDES[lang];
  const relative = relativeLinkTargets(read(p));
  expect(relative.length, `${p} should link sibling guides (mcp-integration, authentication)`).toBeGreaterThan(0);
  const missing = relative.filter((t) => !exists(path.resolve(path.dirname(p), t)));
  expect(missing, `${p} has broken relative links`).toEqual([]);
});

it.each(LANGS)("test_in_guide_anchors_match_headings [%s]", (lang) => {
  const text = read(GUIDES[lang]);
  const anchors = new Set([...text.matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => m[1] as string));
  if (anchors.size === 0) return;
  const slugs = headingSlugs(text);
  const missing = [...anchors].filter((a) => !slugs.has(a));
  expect(missing, `${GUIDES[lang]} anchors do not match any heading`).toEqual([]);
});

it.each(LANGS)("test_tool_directory_matrix_covers_all_tools [%s]", (lang) => {
  const text = read(GUIDES[lang]);
  expect(REQUIRED_DIRECTORY_FRAGMENTS.filter((f) => !text.includes(f)), `guide (${lang}) is missing verified tool directories`).toEqual([]);
});

it.each(LANGS)("test_agent_names_enumerated_in_guide [%s]", (lang) => {
  const text = read(GUIDES[lang]);
  const names = [...ALLOWED_AGENTS].filter((n) => n !== "*").sort();
  expect(names.filter((n) => !text.includes(n)), `guide (${lang}) does not mention supported agents`).toEqual([]);
});

it("test_skills_cli_agent_flags_use_whitelisted_names", () => {
  for (const p of [GUIDES.en, GUIDES.zh, SKILL_MD, README_EN, README_ZH]) {
    // Agent names start with a lowercase letter; `'?'*'?'` is the CLI wildcard.
    const used = new Set([...read(p).matchAll(/-a\s+([a-z][\w-]*|'?\*'?)/g)].map((m) => m[1] as string));
    const unknown = [...used].filter((name) => !ALLOWED_AGENTS.has(name.replace(/^'+|'+$/g, "")));
    expect(unknown, `${path.basename(p)} passes unknown agents to the skills CLI`).toEqual([]);
  }
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

it.each(LANGS)("test_version_pinning_and_verification_documented [%s]", (lang) => {
  const text = read(GUIDES[lang]);
  for (const token of ["<TAG-OR-COMMIT>", "shasum -a 256"]) expect(text.includes(token), `guide (${lang}) must document '${token}'`).toBe(true);
});

it("test_en_zh_keep_shared_commands_identical", () => {
  const en = read(GUIDES.en);
  const zh = read(GUIDES.zh);
  const missing = SHARED_TOKENS.filter((t) => !en.includes(t) || !zh.includes(t));
  expect(missing, "command/path tokens drifted between guides").toEqual([]);
});

it("test_skill_first_sdk_second_messaging", () => {
  expect(read(GUIDES.en).includes("Skill first, SDK second")).toBe(true);
  expect(read(GUIDES.zh).includes("先装 Skill，后装 SDK")).toBe(true);
});

it("test_guides_declare_static_scope_without_restoring_ebx_skill", () => {
  const en = read(GUIDES.en);
  const zh = read(GUIDES.zh);
  expect(en.includes("adds no runtime to this repository")).toBe(true);
  expect(zh.includes("不会给本仓库引入任何运行时")).toBe(true);
  expect(en.includes("ebx skill"), "guides must not reintroduce the removed `ebx skill` command").toBe(false);
  expect(zh.includes("ebx skill")).toBe(false);
});

it("test_entry_points_link_to_installation_guides", () => {
  expect(read(SKILL_MD).includes("docs/en/guide/agent-skill-installation.md")).toBe(true);
  expect(read(SKILL_MD).includes("docs/zh/guide/agent-skill-installation.md")).toBe(true);
  expect(read(LLMS_TXT).includes("docs/en/guide/agent-skill-installation.md")).toBe(true);
  expect(read(README_EN).includes("docs/en/guide/agent-skill-installation.md")).toBe(true);
  expect(read(README_ZH).includes("docs/zh/guide/agent-skill-installation.md")).toBe(true);
  expect(read(DOCS_INDEX_EN).includes("guide/agent-skill-installation.md")).toBe(true);
  expect(read(DOCS_INDEX_ZH).includes("guide/agent-skill-installation.md")).toBe(true);
});

/**
 * Consistency tests for the static agent guide (SKILL.md + llms.txt).
 *
 * These tests keep the agent-facing guide honest against the code:
 *
 * - SKILL.md follows the common Agent Skills frontmatter format (name/description).
 * - SKILL.md covers the required usage topics (install, credentials, MCP vs SDK, lifecycle, files, cleanup, error
 *   diagnosis, credential-leak rules).
 * - SKILL.md is explicitly a static guide and documents that it does not restore the removed `abx skill` command group.
 * - MCP tool names cited in SKILL.md match `agent/tools.ts` TOOL_SCHEMAS.
 * - Repository paths cited in SKILL.md / llms.txt exist.
 * - llms.txt references SKILL.md and only names commands the CLI really registers.
 */

import "./_support/isolatedHome.js";

import path from "node:path";

import { describe, expect, it } from "vitest";

import { TOOL_SCHEMAS } from "../src/agent/tools.js";
import { cli } from "../src/cli/main.js";
import * as errMod from "../src/models/errors.js";
import * as providerErr from "../src/providers/errors.js";
import { loadYaml as safeLoad } from "../src/utils/yaml_io.js";
import { REPO_ROOT, exists, read } from "./helpers/docsSupport.js";

const SKILL_MD = path.join(REPO_ROOT, "SKILL.md");
const LLMS_TXT = path.join(REPO_ROOT, "llms.txt");

function _frontmatter(text: string): Record<string, unknown> {
  expect(text.startsWith("---\n"), "SKILL.md must start with YAML frontmatter").toBe(true);
  const end = text.indexOf("\n---\n", 4);
  expect(end, "SKILL.md frontmatter is not closed").not.toBe(-1);
  const data = safeLoad(text.slice(4, end + 1));
  expect(data !== null && typeof data === "object" && !Array.isArray(data), "SKILL.md frontmatter must be a mapping").toBe(true);
  return data as Record<string, unknown>;
}

describe("TestSkillFrontmatter", () => {
  it("test_name_and_description_present", () => {
    const fm = _frontmatter(read(SKILL_MD));
    expect(fm["name"]).toBe("agent-sandbox");
    expect(typeof fm["description"] === "string" && (fm["description"] as string).trim().length > 0).toBe(true);
  });

  it("test_name_format_matches_agent_skills_convention", () => {
    const name = _frontmatter(read(SKILL_MD))["name"] as string;
    expect(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name), "skill name must be lowercase with hyphens (Agent Skills convention)").toBe(true);
    expect(name.length).toBeLessThanOrEqual(64);
  });

  it("test_description_mentions_when_to_use", () => {
    const description = _frontmatter(read(SKILL_MD))["description"] as string;
    expect(description.length).toBeLessThanOrEqual(1024);
    const lowered = description.toLowerCase();
    expect(lowered.includes("use this") || lowered.includes("use when"), "description should state when the agent should use the skill").toBe(true);
  });
});

const _REQUIRED_TOPICS: Record<string, string> = {
  "when to use": "applicable scenarios",
  installation: "install",
  credential: "credential handling",
  mcp: "MCP interface rules",
  sdk: "Python SDK",
  "creating a sandbox": "sandbox creation",
  "executing code and commands": "code/command execution",
  "file operations": "file operations",
  "destroying resources": "resource cleanup",
  "diagnosing common errors": "error diagnosis",
  "never print, echo, log": "credential-leak prohibition",
};

describe("TestSkillCoverage", () => {
  it("test_required_topics_covered", () => {
    const text = read(SKILL_MD).toLowerCase();
    const missing = Object.entries(_REQUIRED_TOPICS).filter(([needle]) => !text.includes(needle)).map(([, label]) => label);
    expect(missing, "SKILL.md is missing required topics").toEqual([]);
  });

  it("test_declares_static_guide_scope", () => {
    const lowered = read(SKILL_MD).replaceAll("**", "").toLowerCase();
    expect(lowered).toContain("static usage guide");
    expect(lowered.includes("does not restore"), "SKILL.md must state it does not restore the removed skills system").toBe(true);
    expect(lowered).toContain("not executed, parsed, or registered");
  });

  it("test_skill_command_mentions_are_disclaimers_only", () => {
    const normalized = read(SKILL_MD).replaceAll("**", "");
    for (const line of normalized.split(/\r?\n/)) {
      if (line.toLowerCase().includes("abx skill")) {
        expect(line.toLowerCase().includes("removed"), "mentions of `abx skill` must reference its removal, not usage").toBe(true);
      }
    }
  });
});

describe("TestSkillMatchesCode", () => {
  it("test_mcp_tool_names_match_tool_schemas", () => {
    const text = read(SKILL_MD);
    const documented = new Set(TOOL_SCHEMAS.filter((t) => text.includes(t.name)).map((t) => t.name));
    const expected = new Set(TOOL_SCHEMAS.map((t) => t.name));
    const drifted = [...expected].filter((n) => !documented.has(n));
    expect(drifted, "SKILL.md MCP tool coverage drifted from agent/tools.ts").toEqual([]);
  });

  it("test_referenced_repo_paths_exist", () => {
    const text = read(SKILL_MD);
    const candidates = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] as string);
    const paths = candidates.filter(
      (c) =>
        (c.includes("/") || c.endsWith(".md") || c.endsWith(".txt")) &&
        !c.startsWith("/") &&
        !c.startsWith("~") &&
        /^[\p{L}\p{N}_./-]+$/u.test(c) &&
        !c.includes("<"),
    );
    expect(paths.length, "expected SKILL.md to reference at least one repo path").toBeGreaterThan(0);
    const missing = paths.filter((p) => !exists(path.join(REPO_ROOT, p)));
    expect(missing, "SKILL.md references non-existent paths").toEqual([]);
  });

  it("test_cited_error_codes_exist", () => {
    const cited = new Set(read(SKILL_MD).match(/\bE\d{4}\b/g) ?? []);
    expect(cited.size, "expected SKILL.md to cite error codes").toBeGreaterThan(0);
    const defined = new Set<string>();
    for (const mod of [errMod, providerErr]) {
      for (const attr of Object.values(mod)) {
        if (typeof attr === "function" && attr.prototype instanceof Error) {
          for (const m of String((attr as unknown as { code?: unknown }).code ?? "").match(/\bE\d{4}\b/g) ?? []) defined.add(m);
        }
      }
    }
    for (const c of ["E1000", "E2002", "E3001", "E5000", "E5001", "E5003"]) defined.add(c);
    const unknown = [...cited].filter((c) => !defined.has(c));
    expect(unknown, "SKILL.md cites undefined error codes").toEqual([]);
  });
});

describe("TestLlmsTxt", () => {
  it("test_references_skill_md", () => {
    expect(read(LLMS_TXT)).toContain("SKILL.md");
  });

  it("test_links_section_paths_exist", () => {
    const text = read(LLMS_TXT);
    const links = [...text.matchAll(/^- (?:.*?):\s*(\S+)\s*$/gm)].map((m) => m[1] as string);
    expect(links.length, "expected llms.txt to have a Links section").toBeGreaterThan(0);
    const local = links.filter((l) => !l.startsWith("http://") && !l.startsWith("https://"));
    const missing = local.filter((l) => !exists(path.join(REPO_ROOT, l)));
    expect(missing, "llms.txt Links point to non-existent paths").toEqual([]);
  });

  it("test_cli_examples_use_registered_commands", async () => {
    const registered = new Set(cli.listCommands());
    const used = new Set([...read(LLMS_TXT).matchAll(/^\s*abx\s+(\S+)/gm)].map((m) => m[1] as string));
    const unknown = [...used].filter((c) => !registered.has(c));
    expect(unknown, "llms.txt references unknown CLI commands").toEqual([]);
  });
});

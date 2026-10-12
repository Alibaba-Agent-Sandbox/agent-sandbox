/** Helpers of the doc-consistency tests (`test_agent_guide`, `test_byo_agent_docs`, `test_skill_installation_docs`). */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

/** The CLI repository root (the Python tests' `REPO_ROOT`). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function read(p: string): string {
  expect(fs.statSync(p, { throwIfNoEntry: false })?.isFile(), `missing file: ${p}`).toBe(true);
  return fs.readFileSync(p, "utf-8");
}

/** Concatenated contents of all fenced code blocks in `text`. */
export function fencedBlocks(text: string): string {
  return [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
}

/** Approximate GitHub's heading anchor slug for in-guide anchor checks. */
export function githubSlug(heading: string): string {
  const cleaned = heading.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, "");
  return cleaned.trim().replace(/\s+/g, "-");
}

export function relativeLinkTargets(text: string): string[] {
  return [...text.matchAll(/\]\(([^()\s]+)\)/g)]
    .map((m) => m[1] as string)
    .filter((t) => !/^(https?:\/\/|#|mailto:)/.test(t));
}

export function headingSlugs(text: string): Set<string> {
  return new Set([...text.matchAll(/^#{1,6}\s+(.*)$/gm)].map((m) => githubSlug(m[1] as string)));
}

export const exists = (p: string): boolean => fs.existsSync(p);

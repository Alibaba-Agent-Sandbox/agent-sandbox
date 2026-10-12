/** Tests for the .dockerignore matcher (Docker root-anchored semantics). */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DockerIgnore } from "../../src/utils/dockerignore.js";

function _ex(text: string, p: string): boolean {
  return DockerIgnore.fromText(text).excludes(p);
}

describe("TestBasics", () => {
  it("test_empty_file_excludes_nothing", () => {
    expect(_ex("", ".env")).toBe(false);
  });

  it("test_comments_and_blank_lines_are_skipped", () => {
    expect(_ex("# .env\n\n   \n", ".env")).toBe(false);
  });

  it("test_bare_name_is_root_anchored", () => {
    // The classic pitfall: `.env` does not match `sub/.env`.
    expect(_ex(".env", ".env")).toBe(true);
    expect(_ex(".env", "sub/.env")).toBe(false);
  });

  it("test_double_star_prefix_matches_every_directory", () => {
    for (const p of [".env", "a/.env", "a/b/.env"]) {
      expect(_ex("**/.env", p)).toBe(true);
    }
  });

  it("test_leading_slash_and_dot_slash_are_normalised", () => {
    expect(_ex("/.env", ".env")).toBe(true);
    expect(_ex("./.env", ".env")).toBe(true);
  });

  it("test_trailing_slash_names_a_directory", () => {
    expect(_ex("secrets/", "secrets/key.txt")).toBe(true);
  });

  it("test_parent_match_excludes_children", () => {
    expect(_ex("build", "build/out/app.js")).toBe(true);
  });

  it("test_windows_separators_in_query_are_accepted", () => {
    expect(_ex("secrets", "secrets\\key.txt")).toBe(true);
  });
});

describe("TestGlobs", () => {
  const cases: [string, string, boolean][] = [
    ["*.pem", "key.pem", true],
    ["*.pem", "sub/key.pem", false], // * never crosses /
    ["**/*.pem", "sub/deep/key.pem", true],
    [".env.*", ".env.local", true],
    [".env.*", ".env", false],
    ["?.txt", "a.txt", true],
    ["?.txt", "ab.txt", false],
    ["[ab].txt", "a.txt", true],
    ["[!ab].txt", "a.txt", false],
    ["[!ab].txt", "c.txt", true],
    ["a/**/z", "a/z", true],
    ["a/**/z", "a/b/c/z", true],
    ["a/**", "a/b/c", true],
    ["\\!file", "!file", true],
  ];
  for (const [pattern, p, expected] of cases) {
    it(`test_patterns [${pattern}-${p}-${expected ? "True" : "False"}]`, () => {
      expect(_ex(pattern, p)).toBe(expected);
    });
  }
});

describe("TestNegation", () => {
  it("test_reinclude_after_exclude", () => {
    const text = "*.md\n!README.md\n";
    expect(_ex(text, "CHANGELOG.md")).toBe(true);
    expect(_ex(text, "README.md")).toBe(false);
  });

  it("test_last_matching_line_wins", () => {
    expect(_ex("!.env\n.env\n", ".env")).toBe(true);
    expect(_ex(".env\n!.env\n", ".env")).toBe(false);
  });

  it("test_allow_list_style", () => {
    const text = "*\n!src\n";
    expect(_ex(text, "src/main.py")).toBe(false);
    expect(_ex(text, ".env")).toBe(true);
  });

  it("test_reinclude_inside_excluded_directory", () => {
    const text = "secrets\n!secrets/public.txt\n";
    expect(_ex(text, "secrets/key.txt")).toBe(true);
    expect(_ex(text, "secrets/public.txt")).toBe(false);
  });

  it("test_reinclude_can_bring_a_secret_back", () => {
    // `!` lines are how a hand-written ignore file silently leaks.
    expect(_ex("**/.env\n!.env\n", ".env")).toBe(false);
  });
});

describe("TestFailClosed", () => {
  it("test_unterminated_class_in_exclusion_excludes_nothing", () => {
    const ig = DockerIgnore.fromText("[abc\n");
    expect(ig.unparseable).toEqual(["[abc"]);
    expect(ig.excludes("a")).toBe(false);
  });

  it("test_unparseable_reinclude_distrusts_everything", () => {
    const ig = DockerIgnore.fromText("**/.env\n![oops\n");
    expect(ig.unparseable).toEqual(["![oops"]);
    expect(ig.excludes(".env")).toBe(false);
  });

  it("test_dangling_escape_is_unparseable", () => {
    expect(DockerIgnore.fromText("abc\\\n").unparseable.length).toBeGreaterThan(0);
  });

  it("test_root_and_empty_paths_are_never_excluded", () => {
    const ig = DockerIgnore.fromText("*\n");
    expect(ig.excludes("")).toBe(false);
    expect(ig.excludes(".")).toBe(false);
  });
});

it("test_from_file", () => {
  const tmp_path = fs.mkdtempSync(path.join(os.tmpdir(), "dockerignore-"));
  try {
    const f = path.join(tmp_path, ".dockerignore");
    fs.writeFileSync(f, "**/.env\n", "utf-8");
    expect(DockerIgnore.fromFile(f).excludes("a/.env")).toBe(true);
  } finally {
    fs.rmSync(tmp_path, { recursive: true, force: true });
  }
});

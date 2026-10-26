import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { quoteShellLiteral } from "../../src/utils/shell.js";

describe.skipIf(process.platform === "win32")("POSIX shell literal arguments", () => {
  it.each([
    "", "plain", "two words", "a'b", 'a"b', "a\\b", "line\nbreak", "a\tb",
    "$(printf expanded)", "`printf expanded`", "$HOME; printf expanded", "中文😀",
  ])("passes %j unchanged through a real shell", (value) => {
    const actual = execFileSync("/bin/sh", ["-c", `printf '%s' ${quoteShellLiteral(value)}`], { encoding: "utf8" });
    expect(actual).toBe(value);
  });
});

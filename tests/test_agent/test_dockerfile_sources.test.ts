/** Tests for the minimal COPY/ADD source extractor. */

import { describe, expect, it } from "vitest";

import { CopySource, parseCopySources } from "../../src/agent/dockerfile_sources.js";

function sources(text: string): Array<[string, string]> {
  return parseCopySources(text).map((c) => [c.instruction, c.source]);
}

it("test_plain_copy_and_add", () => {
  const text = "FROM x\nCOPY app.py .\nADD lib/ /opt/lib/\n";
  expect(sources(text)).toEqual([
    ["COPY", "app.py"],
    ["ADD", "lib/"],
  ]);
});

it("test_multiple_sources_last_operand_is_the_destination", () => {
  expect(sources("COPY a b c /dst/\n")).toEqual([
    ["COPY", "a"],
    ["COPY", "b"],
    ["COPY", "c"],
  ]);
});

it("test_instruction_is_case_insensitive", () => {
  expect(sources("copy a /b\n")).toEqual([["COPY", "a"]]);
});

it("test_flags_are_dropped", () => {
  const text = "COPY --chown=app:app --chmod=755 src/ /app/src/\n";
  expect(sources(text)).toEqual([["COPY", "src/"]]);
});

it("test_from_copies_are_skipped", () => {
  const text = "COPY --from=builder /out/app /app\nCOPY --from builder /x /y\nCOPY real.txt /r\n";
  expect(sources(text)).toEqual([["COPY", "real.txt"]]);
});

it("test_json_form", () => {
  const text = 'COPY ["my file.txt", "other.txt", "/dst/"]\n';
  expect(sources(text)).toEqual([
    ["COPY", "my file.txt"],
    ["COPY", "other.txt"],
  ]);
});

it("test_broken_json_falls_back_to_shell_form", () => {
  expect(sources("COPY [a.txt /dst/\n")).toEqual([["COPY", "[a.txt"]]);
});

it("test_urls_are_not_context_paths", () => {
  const text = "ADD https://example.com/x.tgz /x.tgz\nADD git@github.com:o/r.git /r\nADD local.tgz /l\n";
  expect(sources(text)).toEqual([["ADD", "local.tgz"]]);
});

it("test_line_continuation_and_comment_inside", () => {
  const text = "COPY a.py \\\n  # a comment\n  b.py \\\n  /dst/\n";
  expect(sources(text)).toEqual([
    ["COPY", "a.py"],
    ["COPY", "b.py"],
  ]);
});

it("test_custom_escape_directive", () => {
  const text = "# escape=`\nFROM x\nCOPY a.py `\n  /dst/\n";
  expect(sources(text)).toEqual([["COPY", "a.py"]]);
});

it("test_heredoc_body_is_never_parsed_as_instructions", () => {
  const text = "RUN <<EOF\nCOPY fake.txt /x\nEOF\nCOPY real.txt /r\n";
  expect(sources(text)).toEqual([["COPY", "real.txt"]]);
});

it("test_copy_with_heredoc_is_skipped", () => {
  const text = "COPY <<EOF /etc/conf\nkey=value\nEOF\nCOPY real.txt /r\n";
  expect(sources(text)).toEqual([["COPY", "real.txt"]]);
});

it("test_onbuild_is_ignored", () => {
  expect(sources("ONBUILD COPY a /b\n")).toEqual([]);
});

it("test_kinds_and_line_numbers", () => {
  const text = "FROM x\n\nCOPY a.py $DIR/ *.whl /tmp/\n";
  const result = parseCopySources(text);
  expect(result).toEqual([
    new CopySource("COPY", "a.py", 3, "literal"),
    new CopySource("COPY", "$DIR/", 3, "variable"),
    new CopySource("COPY", "*.whl", 3, "glob"),
  ]);
});

it("test_single_operand_is_ignored", () => {
  expect(sources("COPY lonely\n")).toEqual([]);
});

describe("Python parity edge cases", () => {
  it("treats CRLF, lone CR and Unicode line separators like str.splitlines", () => {
    expect(sources("COPY a /x\r\nCOPY b /y\rCOPY c /z\u2028COPY d /w")).toEqual([
      ["COPY", "a"],
      ["COPY", "b"],
      ["COPY", "c"],
      ["COPY", "d"],
    ]);
  });

  it("keeps a dash heredoc body free of leading tabs", () => {
    const text = "RUN <<-EOT\n\tCOPY fake /x\n\tEOT\nCOPY real /r\n";
    expect(sources(text)).toEqual([["COPY", "real"]]);
  });

  it("splits shell form on any Unicode whitespace", () => {
    expect(sources("COPY a\u00a0b\u3000c /d\n")).toEqual([
      ["COPY", "a"],
      ["COPY", "b"],
      ["COPY", "c"],
    ]);
  });

  it("stringifies non-string JSON operands like str()", () => {
    expect(sources('COPY ["a", 1, null, true, "/d"]\n')).toEqual([
      ["COPY", "a"],
      ["COPY", "1"],
      ["COPY", "None"],
      ["COPY", "True"],
    ]);
    expect(sources('COPY ["a"]\n')).toEqual([]);
    expect(sources('COPY {"a": 1}\n')).toEqual([["COPY", "{\"a\":"]]);
  });

  it("drops a trailing escape at end of file", () => {
    expect(sources("COPY a /b \\")).toEqual([["COPY", "a"]]);
  });
});

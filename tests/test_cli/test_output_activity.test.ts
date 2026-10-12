/** Tests for the live agent-activity line (`OutputManager.activity`). */

import { describe, expect, it } from "vitest";

import { RuntimeError } from "../../src/api/_pyerrors.js";
import * as outputMod from "../../src/cli/output.js";
import { OutputManager, outputSeams } from "../../src/cli/output.js";
import { Console } from "../../src/cli/_rich.js";
import { sys } from "../../src/framework/io.js";
import { useIsolatedEnv } from "../_support/env.js";
import { TTYBuffer, useCapsys, useOutputSeams } from "./conftest.js";

const iso = useIsolatedEnv();
const seams = useOutputSeams();
const capsys = useCapsys();

/** `_FakeSys`: only `stderr` differs from the real module (stdout stays whatever the test runner installed). */
function fakeSys(stderr: TTYBuffer): typeof outputSeams.sys {
  return {
    get stdout() {
      return sys.stdout;
    },
    stderr,
  } as typeof outputSeams.sys;
}

/** `tty_stderr` fixture. */
function ttyStderr(): TTYBuffer {
  const buf = new TTYBuffer(true);
  seams.sys = fakeSys(buf);
  iso.monkeypatch.setenv("TERM", "xterm-256color");
  // Deterministic: never throttle away the updates under test.
  seams.activityMinInterval = 0.0;
  return buf;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("TestAvailability", () => {
  it("test_none_when_stderr_is_not_a_terminal", async () => {
    seams.sys = fakeSys(new TTYBuffer(false));
    await new OutputManager({ verbose: true }).activity("Working", (update) => {
      expect(update).toBeNull();
    });
  });

  it.each([
    ["mode0", { json_mode: true }],
    ["mode1", { quiet: true }],
    ["mode2", { ci: true }],
  ])("test_none_in_machine_or_silent_modes [%s]", async (_id, mode) => {
    const buf = ttyStderr();
    await new OutputManager(mode).activity("Working", (update) => {
      expect(update).toBeNull();
    });
    expect(buf.getvalue()).toBe("");
  });

  it("test_none_on_a_dumb_terminal", async () => {
    const buf = ttyStderr();
    iso.monkeypatch.setenv("TERM", "dumb");
    await new OutputManager({ verbose: true }).activity("Working", (update) => {
      expect(update).toBeNull();
    });
    expect(buf.getvalue()).toBe("");
  });

  it("test_available_under_verbose_where_the_spinner_is_not", () => {
    ttyStderr();
    const out = new OutputManager({ verbose: true });
    expect(out.useRichSpinner).toBe(false);
    expect(out.useActivityLine).toBe(true);
  });
});

const ERASE = "\x1b[J";

describe("TestTransientLine", () => {
  // `--verbose` / `--no-color`: a self-erasing block, redrawn in place.

  it("test_header_first_then_grey_lines_below", async () => {
    const buf = ttyStderr();
    const out = new OutputManager({ verbose: true });

    await out.activity("Assessing description", (update) => {
      expect(update).not.toBeNull();
      update!("checking docs\nwriting the Dockerfile");
      const drawn = buf.getvalue();
      const lastBlock = drawn.slice(drawn.lastIndexOf("Assessing description"));
      const rows = lastBlock.split("\n").map((row) => row.trim());
      expect(rows[0]!.startsWith("Assessing description... 0s")).toBe(true);
      expect(rows[1]).toBe("checking docs");
      expect(rows[2]).toBe("writing the Dockerfile");
    });

    // After the block the whole block is cleared: move up, clear to end.
    expect(buf.getvalue().endsWith("\x1b[2A\r" + ERASE)).toBe(true);
  });

  it("test_four_lines_are_shown_by_default_and_they_scroll", async () => {
    const buf = ttyStderr();
    const out = new OutputManager({ verbose: true });

    await out.activity("Working", (update) => {
      expect(update).not.toBeNull();
      update!("one\ntwo\nthree\nfour\nfive");
      const first = buf.getvalue();
      expect(first).not.toContain("one");
      expect(["two", "three", "four", "five"].every((x) => first.includes(x))).toBe(true);
      update!("one\ntwo\nthree\nfour\nfive\nsix");
      const latest = buf.getvalue().slice(first.length);
      expect(latest).not.toContain("two"); // scrolled out
      expect(["three", "four", "five", "six"].every((x) => latest.includes(x))).toBe(true);
      expect(latest.startsWith("\x1b[4A\r")).toBe(true); // rewound over header + 4 rows
    });
  });

  it("test_redraw_moves_up_over_the_previous_block", async () => {
    const buf = ttyStderr();
    const out = new OutputManager({ verbose: true });

    await out.activity("Working", (update) => {
      expect(update).not.toBeNull();
      update!("a\nb");
      const before = buf.getvalue().length;
      update!("b\nc");
      expect(buf.getvalue().slice(before).startsWith("\x1b[2A\r")).toBe(true);
    });
  });

  it("test_line_count_is_configurable", async () => {
    const buf = ttyStderr();
    iso.monkeypatch.setenv("EBX_ACTIVITY_LINES", "3");
    await new OutputManager({ verbose: true }).activity("Working", (update) => {
      expect(update).not.toBeNull();
      update!("a\nb\nc\nd");
      const block = buf.getvalue();
      const parts = block.split("Working... 0s");
      expect(parts[parts.length - 1]!.replaceAll("Working", "")).not.toContain("a");
      expect(["b", "c", "d"].every((x) => block.includes(x))).toBe(true);
    });
  });

  it.each([
    ["", 4],
    ["nope", 4],
    ["0", 1],
    ["5", 5],
    ["99", 10],
  ])("test_line_count_parsing [%s-%s]", (raw, expected) => {
    iso.monkeypatch.setenv("EBX_ACTIVITY_LINES", raw as string);
    expect(outputMod._activityLineCount()).toBe(expected);
  });

  it("test_log_lines_do_not_interleave_with_the_block", async () => {
    const buf = ttyStderr();
    // Route the manager's echo into the same buffer so the relative order of erase / log line / redraw is observable.
    seams.echo = (text) => {
      buf.write(`${text}\n`);
    };
    const out = new OutputManager({ verbose: true });

    let written = "";
    await out.activity("Working", (update) => {
      expect(update).not.toBeNull();
      update!("thinking");
      buf.reset();
      out.info("a log line");
      written = buf.getvalue();
    });

    const idx = written.indexOf("a log line");
    const before = written.slice(0, idx);
    const after = written.slice(idx + "a log line".length);
    expect(before.endsWith(ERASE)).toBe(true); // block erased before the log write
    expect(after.startsWith("\n")).toBe(true); // the log line is a clean, whole line
    expect(after).toContain("Working"); // and the block redrawn right after it
  });

  it("test_control_characters_and_markup_are_rendered_literally", async () => {
    const buf = ttyStderr();
    const out = new OutputManager({ verbose: true });

    await out.activity("Working", (update) => {
      expect(update).not.toBeNull();
      update!("a\x1b[31mred\x1b[0m\x07 [bold red]x[/bold red]\nnext");
    });

    const text = buf.getvalue();
    expect(text).not.toContain("\x1b[31m");
    expect(text).not.toContain("\x07");
    expect(text).toContain("[bold red]x[/bold red]");
  });

  it("test_updates_are_throttled", async () => {
    const buf = ttyStderr();
    seams.activityMinInterval = 3600.0;
    const out = new OutputManager({ verbose: true });

    await out.activity("Working", (update) => {
      expect(update).not.toBeNull();
      update!("first");
      update!("second");
    });

    const text = buf.getvalue();
    expect(text).toContain("first");
    expect(text).not.toContain("second");
  });

  it("test_erased_even_when_the_block_raises", async () => {
    const buf = ttyStderr();
    const out = new OutputManager({ verbose: true });

    await expect(
      out.activity("Working", () => {
        throw new RuntimeError("boom");
      }),
    ).rejects.toBeInstanceOf(RuntimeError);

    expect(buf.getvalue().endsWith(ERASE)).toBe(true);
    expect(out._spinnerStack).toEqual([]);
  });

  it("test_nothing_goes_to_stdout", async () => {
    ttyStderr();
    await new OutputManager({ verbose: true }).activity("Working", (update) => {
      expect(update).not.toBeNull();
      update!("hello");
    });

    expect(capsys.readouterr().out).toBe("");
  });

  it("test_spinner_is_an_elapsed_header", async () => {
    const buf = ttyStderr();
    const out = new OutputManager({ verbose: true });
    let text = "";
    await out.spinner("Creating sandbox", () => {
      text = buf.getvalue();
    });
    expect(text).toContain("Creating sandbox... 0s");
  });

  it("test_spinner_tick_advances_the_elapsed_time", async () => {
    const buf = ttyStderr();
    seams.activityTickSeconds = 0.05;
    await new OutputManager({ verbose: true }).spinner("Creating sandbox", async () => {
      await sleep(1150);
    });
    const text = buf.getvalue();
    expect(text).toContain("Creating sandbox... 0s");
    expect(text.includes("Creating sandbox... 1s") || text.includes("Creating sandbox... 2s")).toBe(true);
  });

  it("test_quiet_spinner_writes_nothing", async () => {
    await new OutputManager({ quiet: true }).spinner("Creating sandbox", () => undefined);
    const captured = capsys.readouterr();
    expect(captured.out).toBe("");
    expect(captured.err).toBe("");
  });
});

describe("TestRichStatus", () => {
  // Normal colour TTY: a Rich status, refreshed in place.

  function richOut(buf: TTYBuffer, width = 100): OutputManager {
    seams.isTty = () => true;
    seams.Console = () => new Console({ file: buf, force_terminal: true, width });
    const out = new OutputManager();
    expect(out.useRichSpinner).toBe(true);
    return out;
  }

  it("test_status_shows_header_and_the_latest_lines", async () => {
    const buf = ttyStderr();
    const out = richOut(buf);

    await out.activity("Researching public facts", (update) => {
      expect(update).not.toBeNull();
      update!("gone-first\nsecond\nthird\ntool: web_fetch\nwriting notes");
      expect(out._spinnerStack.length).toBeGreaterThan(0); // registered so log writes can pause it
    });

    const text = buf.getvalue();
    expect(text).toContain("Researching public facts");
    expect(text.includes("tool: web_fetch") && text.includes("writing notes")).toBe(true);
    expect(text).not.toContain("gone-first"); // scrolled out
    expect(out._spinnerStack).toEqual([]);
  });

  it("test_lines_sit_below_the_header_not_beside_it", async () => {
    const buf = ttyStderr();
    const out = richOut(buf);
    await out.activity("Working", (update) => {
      expect(update).not.toBeNull();
      update!("alpha\nbeta");
    });
    // eslint-disable-next-line no-control-regex
    const plain = buf.getvalue().replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
    const rows = plain
      .replaceAll("\r", "\n")
      .split("\n")
      .filter((r) => r.includes("alpha") || r.includes("Working"));
    const headerRows = rows.filter((r) => r.includes("Working"));
    expect(headerRows.length > 0 && headerRows.every((r) => !r.includes("alpha"))).toBe(true);
  });

  it("test_long_lines_are_cut_not_wrapped", async () => {
    const buf = ttyStderr();
    const out = richOut(buf, 30);
    await out.activity("Working", (update) => {
      expect(update).not.toBeNull();
      update!("y".repeat(200) + "\n" + "z".repeat(200));
    });
    const shown = buf.getvalue().split("\x1b[?25h")[0]!;
    expect(shown.trim().split("\n").length - 1).toBe(2); // header + two rows, nothing wrapped
    expect(shown.split("…").length - 1).toBe(2);
  });
});

describe("TestHelpers", () => {
  it("test_fit_cells_is_cjk_aware", () => {
    const fitted = outputMod._fitCells("你好世界你好世界", 7);
    expect(fitted.endsWith("…")).toBe(true);
    expect(outputMod._cellLen(fitted)).toBeLessThanOrEqual(7);
  });

  it("test_fit_cells_leaves_short_text_alone", () => {
    expect(outputMod._fitCells("abc", 10)).toBe("abc");
    expect(outputMod._fitCells("abc", 0)).toBe("");
  });

  it("test_activity_head", () => {
    expect(outputMod._activityHead("Working", 3)).toBe("Working... 3s");
    expect(outputMod._activityHead("Checking Docker daemon...", 3)).toBe("Checking Docker daemon... 3s");
  });

  it("test_activity_lines_keep_the_last_n_clean_lines", () => {
    expect(outputMod._activityLines("", 2)).toEqual([]);
    expect(outputMod._activityLines("a\tb", 2)).toEqual(["a b"]);
    expect(outputMod._activityLines("1\n\n2\n3", 2)).toEqual(["2", "3"]);
    expect(outputMod._activityLines("x\x1b[31m\ny", 5)).toEqual(["x", "y"]);
  });
});

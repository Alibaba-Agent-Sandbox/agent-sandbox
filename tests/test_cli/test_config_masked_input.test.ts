/**
 * Tests for the masked secret input used by `abx config init` (port of `tests/test_cli/test_config_masked_input.py`).
 *
 * `_feedMasked` / `_readMaskedLine` are driven with an injected reader/writer; a real-pty suite (POSIX only, driven
 * through a small Python `pty` helper) pins the asterisk behaviour end to end: one `*` per character, never the
 * plaintext. The pty tests skip with a clear message when `python3` / its `pty` module is unavailable.
 */

import "../_support/isolatedHome.js";

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import "../../src/cli/main.js"; // load the root group first: config_cmd and main import each other
import { _feedMasked, _maskSupported, _maskValue, _readMaskedLine } from "../../src/cli/commands/config_cmd.js";
import { EOFError, KeyboardInterrupt } from "../../src/cli/errors.js";
import { withConfig } from "../helpers/configSupport.js";

const CONFIG_CMD_URL = pathToFileURL(fileURLToPath(new URL("../../src/cli/commands/config_cmd.ts", import.meta.url))).href;
const CLI_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The child program of the pty tests (`_CHILD_CODE`): prompt for a secret and report what came back. */
const CHILD_CODE = `
import { _promptSecret } from ${JSON.stringify(CONFIG_CMD_URL)};
const originalWrite = process.stdout.write;
process.stdout.write = function(chunk, ...args) {
  if (String(chunk).includes("Prompt: ") && !process.stdin.isRaw) throw new Error("TTY_NOT_READY");
  return Reflect.apply(originalWrite, this, [chunk, ...args]);
};
const emit = (text) => new Promise((resolve) => process.stdout.write(text, () => resolve()));
try {
  const value = await _promptSecret("Prompt");
  await emit("\\nRESULT:" + JSON.stringify(value) + "\\n");
} catch (exc) {
  await emit("\\nRESULT:ERR:" + (exc?.constructor?.name ?? "Error") + "\\n");
}
process.exit(0);
`;

/** Python half of the pty harness: owns the pty, spawns the child as session leader, relays the payload. */
const PTY_DRIVER = `
import fcntl, json, os, pty, select, subprocess, sys, termios, time

spec = json.loads(sys.argv[1])
payload = spec["payload"].encode("latin-1")
hold = spec["hold"]
wait_for = spec["wait_for"].encode() if spec["wait_for"] else None

master, slave = pty.openpty()

def preexec():
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

proc = subprocess.Popen(spec["argv"], stdin=slave, stdout=slave, stderr=slave, close_fds=True, preexec_fn=preexec, cwd=spec["cwd"], env=dict(os.environ))
os.close(slave)
out = bytearray()
parts = [payload] if hold is None else [payload[:hold], payload[hold:]]
sent = 0
deadline = time.time() + 30
try:
    while time.time() < deadline:
        ready, _, _ = select.select([master], [], [], 0.05)
        if ready:
            try:
                chunk = os.read(master, 4096)
            except OSError:
                break
            if not chunk:
                break
            out.extend(chunk)
        if sent == 0 and b"Prompt: " in bytes(out):
            os.write(master, parts[0])
            sent = 1
        elif sent == 1 and len(parts) > 1 and wait_for is not None and wait_for in bytes(out):
            time.sleep(0.05)
            os.write(master, parts[1])
            sent = 2
        if proc.poll() is not None:
            time.sleep(0.2)
            try:
                while True:
                    r2, _, _ = select.select([master], [], [], 0.1)
                    if not r2:
                        break
                    tail = os.read(master, 4096)
                    if not tail:
                        break
                    out.extend(tail)
            except OSError:
                pass
            break
finally:
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    os.close(master)
sys.stdout.write(json.dumps({"out": bytes(out).decode("utf-8", "replace")}))
`;

function ptyAvailable(): string | null {
  if (process.platform === "win32") return "pty is POSIX-only";
  const probe = spawnSync("python3", ["-c", "import pty, termios, fcntl"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return "python3 with the pty module is required for the real-terminal tests";
  return null;
}

const PTY_SKIP = ptyAvailable();
const itPty = it.skipIf(PTY_SKIP !== null);
if (PTY_SKIP !== null) console.warn(`SKIPPED real-pty masked input tests: ${PTY_SKIP}`);

/**
 * Drive `_promptSecret` in a child process owning a real pty; returns `[terminal_output, result_line]`.
 *
 * When `hold` is given, the first `hold` payload bytes are sent after the prompt, the remainder only after `wait_for`
 * appears on the terminal, mirroring a user typing and then pressing Ctrl-C.
 */
function runPromptInPty(payload: string, opts: { hold?: number | null; wait_for?: string | null } = {}): [string, string] {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-pty-"));
  try {
    const script = path.join(dir, "child.mjs");
    fs.writeFileSync(script, CHILD_CODE);
    const tsxLoader = import.meta.resolve("tsx");
    const spec = JSON.stringify({
      argv: [process.execPath, "--import", tsxLoader, script],
      cwd: CLI_ROOT,
      // The payload crosses JSON as latin-1 code points so arbitrary UTF-8 bytes survive.
      payload: Buffer.from(payload, "utf8").toString("latin1"),
      hold: opts.hold ?? null,
      wait_for: opts.wait_for ?? null,
    });
    const run = spawnSync("python3", ["-c", PTY_DRIVER, spec], { encoding: "utf8", timeout: 60000 });
    const text: string = JSON.parse(run.stdout).out;
    const idx = text.indexOf("RESULT:");
    return idx < 0 ? [text, ""] : [text.slice(0, idx), text.slice(idx + "RESULT:".length).trim()];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe("TestMaskValue", () => {
  it("test_short_values_are_masked_completely", () => {
    expect(_maskValue("ab")).toBe("***");
    expect(_maskValue("12345678")).toBe("***");
  });

  it("test_long_values_show_only_edges", () => {
    expect(_maskValue("sk-test-abcdef123456")).toBe("sk-***456");
  });

  it("test_empty_value_stays_empty", () => {
    expect(_maskValue("")).toBe("");
  });
});

describe("TestMaskSupported", () => {
  it("test_false_for_non_tty_stdin", async () => {
    // `patch("sys.stdin", io.StringIO())`
    await withConfig({ sys: { stdin: { isatty: () => false } } }, () => {
      expect(_maskSupported()).toBe(false);
    });
  });
});

describe("TestFeedMasked", () => {
  it("test_one_asterisk_per_printable_char", () => {
    const chars: string[] = [];
    const out: string[] = [];
    expect(_feedMasked("abc", chars, (t) => out.push(t))).toBeNull();
    expect(chars).toEqual(["a", "b", "c"]);
    expect(out.join("")).toBe("***");
  });

  it("test_enter_finishes_line", () => {
    const chars: string[] = [];
    const out: string[] = [];
    expect(_feedMasked("abc\n", chars, (t) => out.push(t))).toBe("abc");
    expect(out.join("")).toBe("***\n");
  });

  it("test_carriage_return_finishes_line", () => {
    expect(_feedMasked("abc\r", [], () => undefined)).toBe("abc");
  });

  it("test_backspace_erases_last_char", () => {
    const chars = ["a", "b"];
    const out: string[] = [];
    expect(_feedMasked("\x7f", chars, (t) => out.push(t))).toBeNull();
    expect(chars).toEqual(["a"]);
    expect(out.join("")).toBe("\b \b");
  });

  it("test_backspace_on_empty_is_noop", () => {
    const chars: string[] = [];
    const out: string[] = [];
    expect(_feedMasked("\x7f", chars, (t) => out.push(t))).toBeNull();
    expect(chars).toEqual([]);
    expect(out).toEqual([]);
  });

  it("test_ctrl_c_raises_keyboard_interrupt", () => {
    expect(() => _feedMasked("\x03", [], () => undefined)).toThrow(KeyboardInterrupt);
  });

  it("test_ctrl_d_on_empty_raises_eof", () => {
    expect(() => _feedMasked("\x04", [], () => undefined)).toThrow(EOFError);
  });

  it("test_ctrl_d_with_input_submits", () => {
    expect(_feedMasked("\x04", ["a", "b"], () => undefined)).toBe("ab");
  });

  it("test_ctrl_z_on_empty_raises_eof", () => {
    expect(() => _feedMasked("\x1a", [], () => undefined)).toThrow(EOFError);
  });

  it("test_paste_block_counts_per_character", () => {
    const chars: string[] = [];
    const out: string[] = [];
    expect(_feedMasked("pastedSecret123\n", chars, (t) => out.push(t))).toBe("pastedSecret123");
    expect(out.join("")).toBe("*".repeat(15) + "\n");
  });

  it("test_unicode_counts_characters_not_bytes", () => {
    const chars: string[] = [];
    const out: string[] = [];
    expect(_feedMasked("päö🔥\n", chars, (t) => out.push(t))).toBe("päö🔥");
    expect(out.join("")).toBe("****\n");
  });

  it("test_other_control_chars_are_neither_stored_nor_printed", () => {
    const chars: string[] = [];
    const out: string[] = [];
    expect(_feedMasked("\x01\x02ab", chars, (t) => out.push(t))).toBeNull();
    expect(chars).toEqual(["a", "b"]);
    expect(out.join("")).toBe("**");
  });
});

/** `lambda: next(keys)`: an iterator-backed reader. */
function reader(items: Iterable<string>): () => string {
  const it = items[Symbol.iterator]();
  return () => {
    const r = it.next();
    if (r.done) throw new Error("StopIteration");
    return r.value;
  };
}

describe("TestReadMaskedLine", () => {
  it("test_reads_char_by_char", async () => {
    const out: string[] = [];
    const value = await _readMaskedLine("Prompt: ", { reader: reader(["a", "b", "c", "\n"]), writer: (t) => out.push(t) });
    expect(value).toBe("abc");
    expect(out.join("")).toBe("Prompt: ***\n");
  });

  it("test_accepts_paste_chunk", async () => {
    const out: string[] = [];
    const value = await _readMaskedLine("Prompt: ", { reader: reader(["pastedSecret\n"]), writer: (t) => out.push(t) });
    expect(value).toBe("pastedSecret");
    expect(out.join("")).toBe("Prompt: " + "*".repeat(12) + "\n");
  });

  it("test_eof_raises", async () => {
    await expect(_readMaskedLine("Prompt: ", { reader: reader(["a", ""]), writer: () => undefined })).rejects.toBeInstanceOf(EOFError);
  });

  it("test_ctrl_c_raises", async () => {
    await expect(_readMaskedLine("Prompt: ", { reader: reader(["a", "\x03"]), writer: () => undefined })).rejects.toBeInstanceOf(
      KeyboardInterrupt,
    );
  });

  it("test_plaintext_never_written", async () => {
    const out: string[] = [];
    const value = await _readMaskedLine("Prompt: ", { reader: reader([..."secret123", "\n"]), writer: (t) => out.push(t) });
    const rendered = out.join("");
    expect(value).toBe("secret123");
    expect(rendered).not.toContain("secret123");
  });
});

// ─── real pty (POSIX only) ─────────────────────────────────────────────────

const cases: Array<[string, string, string, number, string | null]> = [
  ["typed", "secret123\n", '"secret123"', 9, "secret123"],
  ["paste-block", "pastedsecret456\n", '"pastedsecret456"', 15, "pastedsecret456"],
  ["backspace", "ab\x7fc\n", '"ac"', 3, null],
  ["unicode", "päö🔥\n", '"päö🔥"', 4, null],
  ["plain-enter", "\n", '""', 0, null],
];

for (const [id, payload, expectedResult, expectedStars, secret] of cases) {
  itPty(`test_masked_prompt_in_real_tty[${id}]`, () => {
    const [head, result] = runPromptInPty(payload);

    expect(result).toBe(expectedResult);
    expect(count(head, "*")).toBe(expectedStars);
    // Masking must actually be active - not the no-echo fallback.
    expect(head).not.toContain("asterisk masking is not supported");
    // The plaintext must never be echoed by the terminal.
    if (secret !== null) expect(head).not.toContain(secret);
  });
}

itPty("test_ctrl_c_in_real_tty_aborts_without_plaintext", () => {
  const [head, result] = runPromptInPty("abc\x03", { hold: 3, wait_for: "***" });

  expect(result).toBe("ERR:Abort");
  expect(count(head, "*")).toBe(3);
  expect(head).not.toContain("abc");
});

itPty("test_ctrl_d_on_empty_in_real_tty_aborts", () => {
  const [head, result] = runPromptInPty("\x04");

  expect(result).toBe("ERR:Abort");
  expect(count(head, "*")).toBe(0);
});

itPty("test_ctrl_d_after_input_in_real_tty_submits", () => {
  const [head, result] = runPromptInPty("abc\x04");

  expect(result).toBe('"abc"');
  expect(count(head, "*")).toBe(3);
});

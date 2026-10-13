/** Extra branch tests for the main sandbox commands (adversarial line-by-line pass over sandbox.py). */

import "../_support/isolatedHome.js";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { inputInterrupts, replSeams } from "../../src/cli/repl.js";
import { KeyboardInterrupt } from "../../src/cli/errors.js";
import { CommandResult } from "../../src/models/process.js";
import { CliRunner } from "../helpers/cliRunner.js";

let tmp = "";
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-sbxbr-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Python's `Path.rglob("*")` order: raw `os.scandir` order per directory, pre-order, symlinked dirs not followed. */
function scandirWalk(dir: string, rel = ""): string[] {
  const handle = fs.opendirSync(dir);
  const names: string[] = [];
  try {
    for (let e = handle.readSync(); e !== null; e = handle.readSync()) names.push(e.name);
  } finally {
    handle.closeSync();
  }
  const out: string[] = [];
  for (const n of names) out.push(rel ? `${rel}/${n}` : n);
  const nested: string[] = [];
  for (const n of names) {
    const full = path.join(dir, n);
    if (fs.lstatSync(full).isDirectory()) nested.push(...scandirWalk(full, rel ? `${rel}/${n}` : n));
  }
  return [...out, ...nested];
}

function makeTree(root: string): void {
  for (let i = 0; i < 30; i++) {
    const f = path.join(root, `f${(i * 7919) % 97}.txt`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, String(i));
  }
  for (const d of ["zeta", "alpha", "Mid", "_u"]) {
    fs.mkdirSync(path.join(root, d));
    for (const f of ["z.txt", "a.txt", "B.txt"]) fs.writeFileSync(path.join(root, d, f), `${d}/${f}`);
  }
  fs.writeFileSync(path.join(root, ".hidden"), "h");
  fs.symlinkSync("alpha", path.join(root, "link_dir"));
  fs.symlinkSync("missing", path.join(root, "link_broken"));
}

describe("TestUploadOrder", () => {
  it("test_upload_dir_uses_raw_scandir_order", async () => {
    // Python iterates Path.rglob("*") in readdir order (not sorted); files are uploaded in that order.
    const root = path.join(tmp, "tree");
    fs.mkdirSync(root);
    makeTree(root);
    const write = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Sandbox, "connect").mockResolvedValue({ id: "sbx-1", files: { write } } as unknown as Sandbox);

    const result = await new CliRunner().invoke(cli, ["upload", "sbx-1", root, "/app/data"]);

    expect(result.exit_code, result.output).toBe(0);
    const expected = scandirWalk(root).filter((rel) => {
      const st = fs.statSync(path.join(root, rel), { throwIfNoEntry: false });
      return st !== undefined && st.isFile();
    });
    expect(write.mock.calls.map((c) => c[0])).toEqual(expected.map((rel) => `/app/data/${rel}`));
    expect(write.mock.calls.length).toBeGreaterThan(30);
  });

  it("test_create_upload_dir_uses_raw_scandir_order", async () => {
    const root = path.join(tmp, "proj");
    fs.mkdirSync(root);
    makeTree(root);
    const write = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Sandbox, "create").mockResolvedValue({ id: "sbx-1", files: { write }, info: undefined } as unknown as Sandbox);

    await new CliRunner().invoke(cli, ["create", "-T", "base", "-u", root]);

    const expected = scandirWalk(root).filter((rel) => fs.statSync(path.join(root, rel), { throwIfNoEntry: false })?.isFile());
    expect(write.mock.calls.map((c) => c[0])).toEqual(expected.map((rel) => `/home/user/${rel}`));
  });
});

describe("TestRunServerValueRendering", () => {
  const runWith = async (value: unknown, args: string[] = []) => {
    const runCommand = vi.fn().mockResolvedValue(new CommandResult({ value, exit_code: 0 }));
    vi.spyOn(Sandbox, "connect").mockResolvedValue({ runCommand } as unknown as Sandbox);
    return new CliRunner().invoke(cli, [...args, "run", "sbx-1", "tool"]);
  };

  it("test_run_server_dict_is_rendered_as_json", async () => {
    const result = await runWith({ a: 1, b: [1, 2.5, null, true], c: 'é"q"', d: {} });
    expect(result.output).toBe(`{"a":1,"b":[1,2.5,null,true],"c":"é\\"q\\"","d":{}}\n`);
  });

  it("test_run_server_none_prints_nothing", async () => {
    const result = await runWith(null);
    expect(result.exit_code).toBe(0);
    expect(result.output).toBe("");
  });

  it("test_run_server_bool_and_str", async () => {
    expect((await runWith(true)).output).toBe("true\n");
    expect((await runWith("plain text")).output).toBe("plain text\n");
  });

  it("test_run_server_json_wraps_result", async () => {
    const result = await runWith({ sum: 3 }, ["--json"]);
    expect(JSON.parse(result.output)).toEqual({ result: { sum: 3 } });
  });
});

describe("TestCreateRequestTimeoutValidation", () => {
  it("test_request_timeout_zero_is_reported_as_python_float", async () => {
    const create = vi.spyOn(Sandbox, "create");
    const result = await new CliRunner().invoke(cli, ["create", "-T", "base", "--request-timeout", "0"]);
    expect(create).not.toHaveBeenCalled();
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("request_timeout must be a positive number of seconds, got 0.0");
  });

  it("test_request_timeout_negative_is_reported_as_python_float", async () => {
    const result = await new CliRunner().invoke(cli, ["create", "-T", "base", "--request-timeout", "-1"]);
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("got -1.0");
  });
});

describe("TestConnectInterrupts", () => {
  let savedInput: typeof replSeams.input;
  beforeEach(() => {
    savedInput = replSeams.input;
    inputInterrupts.count = 0;
    inputInterrupts.swallowFirst = false;
  });
  afterEach(() => {
    replSeams.input = savedInput;
    inputInterrupts.count = 0;
    inputInterrupts.swallowFirst = false;
  });

  it("test_connect_second_interrupt_disconnects", async () => {
    // First Ctrl-C only cancels the main asyncio task (input() keeps waiting); the second raises inside input().
    vi.spyOn(Sandbox, "connect").mockResolvedValue({ id: "sbx-1", commands: {} } as unknown as Sandbox);
    replSeams.input = async () => {
      throw new KeyboardInterrupt();
    };
    const result = await new CliRunner().invoke(cli, ["connect", "sbx-1"]);
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("Disconnected.");
  });

  it("test_connect_pending_first_interrupt_aborts_after_exit", async () => {
    // A single swallowed Ctrl-C surfaces when the coroutine returns: asyncio.run raises KeyboardInterrupt -> Aborted!.
    vi.spyOn(Sandbox, "connect").mockResolvedValue({ id: "sbx-1", commands: {} } as unknown as Sandbox);
    replSeams.input = async () => {
      inputInterrupts.count += 1;
      return "exit";
    };
    const result = await new CliRunner().invoke(cli, ["connect", "sbx-1"]);
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Aborted!");
  });

  it("test_connect_pending_interrupt_cancels_before_next_command", async () => {
    // The cancelled task hits CancelledError at the next await, i.e. before the line is run.
    const run = vi.fn().mockResolvedValue({ stdout: "x\n", stderr: "", exit_code: 0 });
    vi.spyOn(Sandbox, "connect").mockResolvedValue({ id: "sbx-1", commands: { run } } as unknown as Sandbox);
    replSeams.input = async () => {
      inputInterrupts.count += 1;
      return "echo hi";
    };
    const result = await new CliRunner().invoke(cli, ["connect", "sbx-1"]);
    expect(run).not.toHaveBeenCalled();
    expect(result.exit_code).toBe(1);
    expect(result.output).toContain("Aborted!");
  });

  it("test_connect_swallow_flag_reset_after_session", async () => {
    vi.spyOn(Sandbox, "connect").mockResolvedValue({ id: "sbx-1", commands: {} } as unknown as Sandbox);
    replSeams.input = async () => "exit";
    await new CliRunner().invoke(cli, ["connect", "sbx-1"]);
    expect(inputInterrupts.swallowFirst).toBe(false);
  });
});

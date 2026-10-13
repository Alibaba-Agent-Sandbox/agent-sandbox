/**
 * Branch coverage for `sandbox files|process|system|capabilities` beyond the ported Python tests
 * (`system info/ports/packages/metrics`, JSON/quiet/error routing, quoting). Expected texts were checked against the
 * Python oracle with `parity/diff/sandbox_subcmds.mjs`.
 */

import "../_support/isolatedHome.js";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Sandbox } from "../../src/api/sandbox.js";
import { cli } from "../../src/cli/main.js";
import { FileInfo, FileType } from "../../src/models/filesystem.js";
import { ProcessInfo, ProcessResult } from "../../src/models/process.js";
import { CliRunner } from "../helpers/cliRunner.js";

type Mock = ReturnType<typeof vi.fn>;

function _sandbox() {
  return {
    id: "sbx-test-001",
    capabilities: new Set<string>(["shell", "files"]),
    files: { list: vi.fn(), getInfo: vi.fn(), makeDir: vi.fn(), remove: vi.fn(), move: vi.fn() },
    commands: { run: vi.fn() as Mock, list: vi.fn(), sendSignal: vi.fn(), stream: vi.fn() },
  };
}

async function invoke(sb: ReturnType<typeof _sandbox>, argv: string[], opts: { input?: string } = {}) {
  vi.spyOn(Sandbox, "connect").mockResolvedValue(sb as unknown as Sandbox);
  return new CliRunner().invoke(cli, argv, opts);
}

const ok = (stdout: string, extra: Record<string, unknown> = {}) => new ProcessResult({ stdout, ...extra });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TestFilesBranches", () => {
  it("test_list_recursive_empty_and_quoting", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok("  \n"));
    const result = await invoke(sb, ["sandbox", "files", "list", "sbx", "-r", "-p", "it's;rm -rf"]);
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe("Directory it's;rm -rf is empty.\n");
    expect(sb.commands.run).toHaveBeenCalledWith(`find 'it'"'"'s;rm -rf' -maxdepth 5 2>/dev/null`, { timeout: 30 });
  });

  it("test_list_recursive_json_drops_blank_lines", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok("/a\n\n/a/b c\n"));
    const result = await invoke(sb, ["--json", "sandbox", "files", "list", "sbx", "-r"]);
    expect(JSON.parse(result.stdout)).toEqual({ path: "/home/user", entries: ["/a", "/a/b c"] });
  });

  it("test_list_table_columns_and_json_rows", async () => {
    const sb = _sandbox();
    sb.files.list.mockResolvedValue([
      new FileInfo({ name: "d", path: "/d", type: FileType.DIRECTORY, size: 0 }),
      new FileInfo({ name: "f", path: "/f", type: FileType.FILE, size: 7 }),
    ]);
    const quiet = await invoke(sb, ["--quiet", "sandbox", "files", "list", "sbx"]);
    expect(quiet.stdout).toBe("d\tdirectory\t0\nf\tfile\t7\n");
    const json = await invoke(sb, ["--json", "sandbox", "files", "list", "sbx", "--path", "/x"]);
    expect(JSON.parse(json.stdout)).toEqual([
      { name: "d", type: "directory", size: 0 },
      { name: "f", type: "file", size: 7 },
    ]);
    expect(sb.files.list).toHaveBeenLastCalledWith("/x");
  });

  it("test_stat_prints_aligned_pairs", async () => {
    const sb = _sandbox();
    sb.files.getInfo.mockResolvedValue(new FileInfo({ name: "app", path: "/app", type: FileType.DIRECTORY, size: 4096 }));
    const result = await invoke(sb, ["sandbox", "files", "stat", "sbx", "-p", "/app"]);
    expect(result.stdout).toBe("Name  app\nPath  /app\nType  directory\nSize  4096\n");
  });

  it("test_rm_prompt_text_and_abort_message", async () => {
    const sb = _sandbox();
    const result = await invoke(sb, ["sandbox", "files", "rm", "sbx", "-p", "/tmp/a"], { input: "n\n" });
    expect(result.exit_code).toBe(1);
    expect(result.stdout).toBe("Delete /tmp/a in sandbox sbx? [y/N]: n\n");
    expect(result.stderr).toBe("Aborted!\n");
    expect(sb.files.remove).not.toHaveBeenCalled();
  });

  it("test_mv_mkdir_rm_success_messages", async () => {
    const sb = _sandbox();
    expect((await invoke(sb, ["sandbox", "files", "mv", "sbx", "-s", "/a", "-d", "/b"])).stdout).toBe("Moved: /a -> /b\n");
    expect((await invoke(sb, ["sandbox", "files", "mkdir", "sbx", "-p", "/x"])).stdout).toBe("Directory created: /x\n");
    expect((await invoke(sb, ["sandbox", "files", "rm", "sbx", "-p", "/x", "-y"])).stdout).toBe("Deleted: /x\n");
  });

  it("test_search_quotes_pattern_and_reports_count", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok("/app/a.py\n\n/app/b.py\n"));
    const result = await invoke(sb, ["sandbox", "files", "search", "sbx", "-p", "/app", "--pattern", "it's *"]);
    expect(result.stdout).toBe("/app/a.py\n/app/b.py\nFound 2 file(s).\n");
    expect(sb.commands.run).toHaveBeenCalledWith(`find /app -maxdepth 5 -name 'it'"'"'s *' -type f 2>/dev/null`, { timeout: 30 });
  });

  it("test_search_no_match_json_and_quiet", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok(""));
    const json = await invoke(sb, ["--json", "sandbox", "files", "search", "sbx", "-p", "/a", "--pattern", "*.rs"]);
    expect(JSON.parse(json.stdout)).toEqual({ path: "/a", pattern: "*.rs", results: [] });
    const quiet = await invoke(sb, ["--quiet", "sandbox", "files", "search", "sbx", "-p", "/a", "--pattern", "*.rs"]);
    expect(quiet.stdout).toBe("");
  });
});

describe("TestProcessBranches", () => {
  it("test_list_quiet_rows", async () => {
    const sb = _sandbox();
    sb.commands.list.mockResolvedValue([new ProcessInfo({ pid: 3 })]);
    const result = await invoke(sb, ["--quiet", "sandbox", "process", "list", "sbx"]);
    expect(result.stdout).toBe("3\t\trunning\n");
  });

  it("test_info_parses_columns_and_keeps_command_remainder", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok("1234 1 root Ss 4096 05:12 python   app.py  \n"));
    const result = await invoke(sb, ["sandbox", "process", "info", "sbx", "1234"]);
    expect(result.stdout).toBe(
      "PID      1234\nPPID     1\nUser     root\nState    Ss\nRSS(KB)  4096\nElapsed  05:12\nCommand  python   app.py\n",
    );
    expect(sb.commands.run).toHaveBeenCalledWith("ps -p 1234 -o pid=,ppid=,user=,stat=,rss=,etime=,comm= 2>/dev/null", {
      timeout: 10,
    });
  });

  it("test_info_short_row_and_unicode_whitespace", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok("5\u00a01\u3000root\n"));
    const result = await invoke(sb, ["sandbox", "process", "info", "sbx", "5"]);
    expect(result.stdout).toBe("PID   5\nPPID  1\nUser  root\n");
  });

  it("test_info_not_found_json_goes_to_stdout", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok("  \n"));
    const result = await invoke(sb, ["--json", "sandbox", "process", "info", "sbx", "9"]);
    expect(result.exit_code).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ status: "error", message: "Process 9 not found or not accessible." });
  });

  it("test_signal_message_and_custom_signal", async () => {
    const sb = _sandbox();
    const result = await invoke(sb, ["sandbox", "process", "signal", "sbx", "7", "-s", "2"]);
    expect(result.stdout).toBe("Signal 2 sent to process 7.\n");
    expect(sb.commands.sendSignal).toHaveBeenCalledWith(7, 2);
  });
});

describe("TestSystemBranches", () => {
  const INFO = "OS: Linux\nArch: x86_64\nnoise\nA: b: c\nDisk_Free_GB: 40.1\n";

  it("test_info_parses_key_value_lines", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok(INFO));
    const text = await invoke(sb, ["sandbox", "system", "info", "sbx"]);
    expect(text.stdout).toBe("OS            Linux\nArch          x86_64\nA             b: c\nDisk_Free_GB  40.1\n");
    const json = await invoke(sb, ["--json", "sandbox", "system", "info", "sbx"]);
    expect(JSON.parse(json.stdout)).toEqual({ OS: "Linux", Arch: "x86_64", A: "b: c", Disk_Free_GB: "40.1" });
    expect(sb.commands.run.mock.calls[0]?.[1]).toEqual({ timeout: 15 });
  });

  it("test_info_falls_back_to_uname", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValueOnce(ok("", { exit_code: 1 })).mockResolvedValueOnce(ok("Linux sbx\n\n"));
    const text = await invoke(sb, ["sandbox", "system", "info", "sbx"]);
    expect(text.stdout).toBe("Linux sbx\n");
    expect(sb.commands.run).toHaveBeenLastCalledWith("uname -a", { timeout: 10 });

    sb.commands.run.mockResolvedValueOnce(ok("", { exit_code: 1 })).mockResolvedValueOnce(ok("Linux sbx\n\n"));
    const json = await invoke(sb, ["--json", "sandbox", "system", "info", "sbx"]);
    expect(JSON.parse(json.stdout)).toEqual({ raw: "Linux sbx" });
  });

  it("test_env_sorts_by_code_point_and_filters_sensitive_names_case_insensitively", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok("b=2\n\u{1F600}=3\n\uFF21=4\nMy_Key2=x\npassword=1\n10=a\nz=c\n"));
    const result = await invoke(sb, ["sandbox", "system", "env", "sbx"]);
    expect(result.stdout).toBe("10=a\nb=2\nz=c\n\uFF21=4\n\u{1F600}=3\n");
  });

  it("test_env_json_keeps_integer_like_names_in_order", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok("2=b\n1=a\nz=c\n"));
    const result = await invoke(sb, ["--json", "sandbox", "system", "env", "sbx"]);
    expect(result.stdout).toBe('{\n  "variables": {\n    "2": "b",\n    "1": "a",\n    "z": "c"\n  }\n}\n');
  });

  it("test_env_filter_edge_cases", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok("A=1\nB=2\nA=3\nAPI_TOKEN=x\n"));
    expect((await invoke(sb, ["sandbox", "system", "env", "sbx", "-f", ","])).stdout).toBe(
      "No matching environment variables found.\n",
    );
    expect((await invoke(sb, ["sandbox", "system", "env", "sbx", "-f", "API_TOKEN"])).stdout).toBe(
      "No matching environment variables found.\n",
    );
    expect((await invoke(sb, ["sandbox", "system", "env", "sbx", "-f", "A"])).stdout).toBe("A=3\n");
  });

  it("test_env_failure_json_is_error_object", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok("", { exit_code: 1 }));
    const result = await invoke(sb, ["--json", "sandbox", "system", "env", "sbx"]);
    expect(result.exit_code).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ status: "error", message: "Failed to retrieve environment variables." });
  });

  it("test_ports_outputs_and_failures", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok("State\n\nLISTEN 22\n"));
    expect((await invoke(sb, ["sandbox", "system", "ports", "sbx"])).stdout).toBe("State\n\nLISTEN 22\n");
    expect(JSON.parse((await invoke(sb, ["--json", "sandbox", "system", "ports", "sbx"])).stdout)).toEqual({
      raw_output: ["State", "", "LISTEN 22"],
    });
    sb.commands.run.mockResolvedValue(ok("NO_TOOL\n"));
    const none = await invoke(sb, ["sandbox", "system", "ports", "sbx"]);
    expect(none.exit_code).toBe(1);
    expect(none.stderr).toBe("Cannot determine listening ports (ss/netstat not available).\n");
    sb.commands.run.mockResolvedValue(ok("x\n", { exit_code: 1 }));
    expect((await invoke(sb, ["sandbox", "system", "ports", "sbx"])).exit_code).toBe(1);
  });

  it("test_packages_pip_table_json_and_invalid_json", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok(JSON.stringify([{ name: "numpy", version: "1.26.0" }, { name: "noversion" }])));
    const quiet = await invoke(sb, ["--quiet", "sandbox", "system", "packages", "sbx"]);
    expect(quiet.stdout).toBe("numpy\t1.26.0\nnoversion\t\n");
    expect(sb.commands.run).toHaveBeenLastCalledWith("python3 -m pip list --format json 2>/dev/null", { timeout: 30 });
    const json = await invoke(sb, ["--json", "sandbox", "system", "packages", "sbx"]);
    expect(JSON.parse(json.stdout)).toEqual({
      manager: "pip",
      packages: [{ name: "numpy", version: "1.26.0" }, { name: "noversion" }],
    });
    sb.commands.run.mockResolvedValue(ok("not json"));
    expect((await invoke(sb, ["sandbox", "system", "packages", "sbx"])).stdout).toBe("No packages found.\n");
    expect(JSON.parse((await invoke(sb, ["--json", "sandbox", "system", "packages", "sbx"])).stdout)).toEqual({
      manager: "pip",
      packages: [],
    });
  });

  it("test_packages_pip_unexpected_shapes_fail_like_python", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(ok('["a"]'));
    const strItem = await invoke(sb, ["sandbox", "system", "packages", "sbx"]);
    expect(strItem.exit_code).toBe(1);
    expect(strItem.stderr).toContain("Unexpected error: 'str' object has no attribute 'get'");
    sb.commands.run.mockResolvedValue(ok("5"));
    const num = await invoke(sb, ["sandbox", "system", "packages", "sbx"]);
    expect(num.stderr).toContain("Unexpected error: 'int' object is not iterable");
    sb.commands.run.mockResolvedValue(ok('[{"name":"x","version":1.5}]'));
    const rich = await invoke(sb, ["sandbox", "system", "packages", "sbx"]);
    expect(rich.stderr).toContain("Unexpected error: unable to render float; a string or other renderable object is required");
    const quiet = await invoke(sb, ["--quiet", "sandbox", "system", "packages", "sbx"]);
    expect(quiet.stderr).toContain("Unexpected error: sequence item 1: expected str instance, float found");
  });

  it("test_packages_npm_shapes", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(
      ok(JSON.stringify({ dependencies: { express: { version: "4.18.2" }, left: "1.0", odd: { x: 1 }, n: null } })),
    );
    const json = await invoke(sb, ["--json", "sandbox", "system", "packages", "sbx", "-m", "npm"]);
    expect(JSON.parse(json.stdout)).toEqual({
      manager: "npm",
      packages: [
        { name: "express", version: "4.18.2" },
        { name: "left", version: "1.0" },
        { name: "odd", version: "" },
        { name: "n", version: "None" },
      ],
    });
    expect(sb.commands.run).toHaveBeenLastCalledWith("npm list --json --depth=0 2>/dev/null", { timeout: 30 });
    for (const body of ["[]", '{"dependencies": null}', '{"dependencies": []}', "npm ERR!", "{}"]) {
      sb.commands.run.mockResolvedValue(ok(body));
      expect((await invoke(sb, ["sandbox", "system", "packages", "sbx", "-m", "npm"])).stdout).toBe("No packages found.\n");
    }
  });

  it("test_metrics_values_keep_python_str", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValue(
      ok('{"cpu_load_1m": 0.0, "n": 1, "s": "x", "z": null, "t": true, "l": [1, 2.0], "d": {"h": 1.0}}'),
    );
    const text = await invoke(sb, ["sandbox", "system", "metrics", "sbx"]);
    expect(text.stdout).toBe(
      "cpu_load_1m  0.0\nn            1\ns            x\nz            None\nt            True\nl            [1, 2.0]\nd            {'h': 1.0}\n",
    );
    const json = await invoke(sb, ["--json", "sandbox", "system", "metrics", "sbx"]);
    expect(json.stdout).toContain('"cpu_load_1m": 0.0');
    expect(json.stdout).toContain('"l": [\n    1,\n    2.0\n  ]');
  });

  it("test_metrics_fallbacks_and_non_dict_payloads", async () => {
    const sb = _sandbox();
    sb.commands.run.mockResolvedValueOnce(ok("", { exit_code: 1 })).mockResolvedValueOnce(ok(" up\n---\ndf\n"));
    expect((await invoke(sb, ["sandbox", "system", "metrics", "sbx"])).stdout).toBe(" up\n---\ndf\n");
    expect(sb.commands.run).toHaveBeenLastCalledWith("uptime 2>/dev/null; echo '---'; df -h / 2>/dev/null", { timeout: 10 });
    sb.commands.run.mockResolvedValue(ok("not json\n\n"));
    expect((await invoke(sb, ["sandbox", "system", "metrics", "sbx"])).stdout).toBe("not json\n");
    expect((await invoke(sb, ["--json", "sandbox", "system", "metrics", "sbx"])).stdout).toBe("not json\n");
    sb.commands.run.mockResolvedValue(ok("[1]"));
    expect((await invoke(sb, ["--json", "sandbox", "system", "metrics", "sbx"])).stdout).toBe("[\n  1\n]\n");
    const list = await invoke(sb, ["sandbox", "system", "metrics", "sbx"]);
    expect(list.exit_code).toBe(1);
    expect(list.stderr).toContain("Unexpected error: 'list' object has no attribute 'items'");
  });

  it("test_capabilities_text_lists_sorted_bullets", async () => {
    const sb = _sandbox();
    sb.capabilities = new Set(["shell", "code", "files"]);
    const result = await invoke(sb, ["sandbox", "capabilities", "sbx"]);
    expect(result.stdout).toBe("Capabilities:\n  - code\n  - files\n  - shell\n");
  });
});

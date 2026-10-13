#!/usr/bin/env node
/**
 * Differential test of the `sandbox files|process|system`, `sandbox capabilities` and `sandbox shell-stream`
 * commands: the original Python CLI (`$ORACLE_VENV/bin/ebx`) versus the Node CLI, run with the same argv, isolated
 * HOME, no credentials, and a local stub platform + envd (Connect protocol) server that serves scripted answers.
 *
 *   ORACLE_VENV=/path/to/venv-for-original-ebx node parity/diff/sandbox_subcmds.mjs [--verbose] [--only <substr>]
 *
 * Compared per case: exit code, stdout, stderr (ports / timings normalised) and the stub request log (method, path,
 * body, auth headers). Exit code 0 = identical, 1 = differences, 2 = oracle missing.
 *
 * While `src/cli/commands/sandbox.ts` / `config_cmd.ts` are not ported yet, the Node side is started through a
 * generated entry that mounts the three sub-command modules under a stand-in `sandbox` group (same attribute names
 * the Python `sandbox.py` registers) and an inert shortcut config.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createAllowList } from "./sdk_defect_allowlist.mjs";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
const verbose = process.argv.includes("--verbose");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "ebx"))) {
  console.error("ORACLE_VENV must point to a venv with the original easy-sandbox installed (see docs/PORTING.md).");
  process.exit(2);
}

const SBX = "sbx-stub";
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

// ---------------------------------------------------------------------------------------------------------------
// Scripted envd answers
// ---------------------------------------------------------------------------------------------------------------

const frame = (obj, flags = 0) => {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const head = Buffer.alloc(5);
  head.writeUInt8(flags, 0);
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
};
const unary = (obj) => ({ status: 200, type: "application/json", body: Buffer.from(JSON.stringify(obj)) });
const raw = (status, type, text) => ({ status, type, body: Buffer.from(text) });
/** A process Start stream: optional stdout/stderr chunks, then an end frame. */
const proc = ({ out = [], err = [], code = 0, noEnd = false, pid = 7 } = {}) => ({
  status: 200,
  type: "application/connect+json",
  body: Buffer.concat([
    frame({ event: { start: { pid } } }),
    ...out.map((s) => frame({ event: { data: { stdout: b64(s) } } })),
    ...err.map((s) => frame({ event: { data: { stderr: b64(s) } } })),
    ...(noEnd ? [] : [frame({ event: { end: { exitCode: code, exited: true, status: "exited" } } })]),
    frame({}, 2),
  ]),
});
const RESET = "reset";

/** The remote command line of a `process.Process/Start` request. */
const cmdline = (body) => {
  const p = JSON.parse(body || "{}").process ?? {};
  return [p.cmd, ...(p.args ?? [])].join(" ");
};

/**
 * Build the envd handler of a case from `{ rpc: { "<Service>/<Method>": spec | (body)=>spec }, start: (cmdline, body)=>spec }`.
 * Anything unscripted answers 404 like an unknown route.
 */
function envdHandler(script) {
  return (path, body) => {
    if (path === "/process.Process/Start" && script.start) {
      return typeof script.start === "function" ? script.start(cmdline(body), body) : script.start;
    }
    const key = path.slice(1).replace(/^[a-z]+\./, "");
    const hit = script.rpc?.[key];
    if (hit !== undefined) return typeof hit === "function" ? hit(body) : hit;
    return raw(404, "application/json", '{"code":"not_found","message":"unscripted"}');
  };
}

const fileEntries = (list) => unary({ entries: list });
const E = (name, path, extra = {}) => ({ name, path, ...extra });

const PY_INFO_OK = "OS: Linux\nArch: x86_64\nHostname: sbx\nCPU_Count: 4\nPython: 3.11.2\nDisk_Total_GB: 49.2\nDisk_Free_GB: 40.1\n";

// ---------------------------------------------------------------------------------------------------------------
// Cases: [name, argv, script, options]
// ---------------------------------------------------------------------------------------------------------------

const cases = [];
const add = (name, argv, script = {}, opts = {}) => cases.push({ name, argv, script, ...opts });
const S = ["sandbox"];

// ---- files list
const LIST2 = fileEntries([
  E("app.py", "/home/user/app.py", { size: 1024 }),
  E("data", "/home/user/data", { isDir: true, size: 0 }),
  { path: "/home/user/noname.txt", size: 5 },
  { name: "t", path: "/home/user/t", type: "directory" },
]);
add("files list table", [...S, "files", "list", SBX], { rpc: { "Filesystem/ListDir": LIST2 } });
add("files list json", ["--json", ...S, "files", "list", SBX], { rpc: { "Filesystem/ListDir": LIST2 } });
add("files list quiet", ["--quiet", ...S, "files", "list", SBX], { rpc: { "Filesystem/ListDir": LIST2 } });
add("files list result wrapper", [...S, "files", "list", SBX, "-p", "/tmp"], { rpc: { "Filesystem/ListDir": unary({ result: { entries: [E("a", "/tmp/a", { size: 3 })] } }) } });
add("files list empty", [...S, "files", "list", SBX], { rpc: { "Filesystem/ListDir": fileEntries([]) } });
add("files list empty json", ["--json", ...S, "files", "list", SBX], { rpc: { "Filesystem/ListDir": fileEntries([]) } });
add("files list empty quiet", ["--quiet", ...S, "files", "list", SBX], { rpc: { "Filesystem/ListDir": fileEntries([]) } });
add("files list 404", [...S, "files", "list", SBX], {});
add("files list 500", [...S, "files", "list", SBX], { rpc: { "Filesystem/ListDir": raw(500, "application/json", '{"message":"boom"}') } });
add("files list 401", [...S, "files", "list", SBX], { rpc: { "Filesystem/ListDir": raw(401, "application/json", '{"message":"no"}') } });
add("files list reset", [...S, "files", "list", SBX], { rpc: { "Filesystem/ListDir": RESET } });
add("files list garbage", [...S, "files", "list", SBX], { rpc: { "Filesystem/ListDir": raw(200, "application/json", "garbage") } });
add("files list unicode name", [...S, "files", "list", SBX], { rpc: { "Filesystem/ListDir": fileEntries([E("日本語.txt", "/home/user/日本語.txt", { size: 12 })]) } });
add("files list recursive", [...S, "files", "list", SBX, "-r", "-p", "/my dir"], { start: () => proc({ out: ["/my dir\n/my dir/a\n"] }) });
add("files list recursive json", ["--json", ...S, "files", "list", SBX, "-r"], { start: () => proc({ out: ["/home/user\n\n/home/user/a b\n"] }) });
add("files list recursive empty", [...S, "files", "list", SBX, "--recursive"], { start: () => proc({ out: ["  \n"] }) });
add("files list recursive empty json", ["--json", ...S, "files", "list", SBX, "-r"], { start: () => proc({}) });
add("files list recursive quiet", ["--quiet", ...S, "files", "list", SBX, "-r"], { start: () => proc({ out: ["x\n"] }) });
add("files list recursive quote path", [...S, "files", "list", SBX, "-r", "-p", "it's;rm -rf"], { start: () => proc({ out: ["a\n"] }) });
add("files list help", [...S, "files", "list", "--help"]);
add("files help", [...S, "files", "--help"]);
add("files bare", [...S, "files"]);
add("files list no id", [...S, "files", "list"]);

// ---- files stat / mkdir / rm / mv / search
add("files stat file", [...S, "files", "stat", SBX, "-p", "/home/user/app.py"], { rpc: { "Filesystem/Stat": unary({ entry: {} , name: "app.py", path: "/home/user/app.py", size: 2048 }) } });
add("files stat dir json", ["--json", ...S, "files", "stat", SBX, "--path", "/app"], { rpc: { "Filesystem/Stat": unary({ result: { name: "app", path: "/app", isDir: true, size: 4096 } }) } });
add("files stat quiet", ["--quiet", ...S, "files", "stat", SBX, "--path", "/app"], { rpc: { "Filesystem/Stat": unary({ name: "app", path: "/app", type: "directory" }) } });
add("files stat 404", [...S, "files", "stat", SBX, "-p", "/no"], {});
add("files stat missing path", [...S, "files", "stat", SBX]);
add("files stat help", [...S, "files", "stat", "-h"]);
add("files mkdir ok", [...S, "files", "mkdir", SBX, "-p", "/home/user/x"], { rpc: { "Filesystem/MakeDir": unary({}) } });
add("files mkdir json", ["--json", ...S, "files", "mkdir", SBX, "-p", "/x"], { rpc: { "Filesystem/MakeDir": unary({}) } });
add("files mkdir quiet", ["--quiet", ...S, "files", "mkdir", SBX, "-p", "/x"], { rpc: { "Filesystem/MakeDir": unary({}) } });
add("files mkdir 409", [...S, "files", "mkdir", SBX, "-p", "/x"], { rpc: { "Filesystem/MakeDir": raw(409, "application/json", '{"message":"exists"}') } });
add("files mkdir 404", [...S, "files", "mkdir", SBX, "-p", "/x"], {});
add("files rm yes", [...S, "files", "rm", SBX, "-p", "/tmp/a", "-y"], { rpc: { "Filesystem/Remove": unary({}) } });
add("files rm --yes json", ["--json", ...S, "files", "rm", SBX, "-p", "/tmp/a", "--yes"], { rpc: { "Filesystem/Remove": unary({}) } });
add("files rm confirm y", [...S, "files", "rm", SBX, "-p", "/tmp/a"], { rpc: { "Filesystem/Remove": unary({}) } }, { input: "y\n" });
add("files rm confirm yes", [...S, "files", "rm", SBX, "-p", "/tmp/a"], { rpc: { "Filesystem/Remove": unary({}) } }, { input: "YES\n" });
add("files rm confirm n", [...S, "files", "rm", SBX, "-p", "/tmp/a"], { rpc: { "Filesystem/Remove": unary({}) } }, { input: "n\n" });
add("files rm confirm eof", [...S, "files", "rm", SBX, "-p", "/tmp/a"], {}, { input: "" });
add("files rm confirm invalid then y", [...S, "files", "rm", SBX, "-p", "/tmp/a"], { rpc: { "Filesystem/Remove": unary({}) } }, { input: "maybe\n\ny\n" });
add("files rm confirm default (enter) aborts", [...S, "files", "rm", SBX, "-p", "/tmp/a"], {}, { input: "\n" });
add("files rm confirm json mode", ["--json", ...S, "files", "rm", SBX, "-p", "/tmp/a"], { rpc: { "Filesystem/Remove": unary({}) } }, { input: "y\n" });
add("files rm 404", [...S, "files", "rm", SBX, "-p", "/gone", "-y"], {});
add("files rm missing path", [...S, "files", "rm", SBX]);
add("files mv ok", [...S, "files", "mv", SBX, "-s", "/a", "-d", "/b"], { rpc: { "Filesystem/Move": unary({}) } });
add("files mv json", ["--json", ...S, "files", "mv", SBX, "--source", "/a", "--dest", "/b"], { rpc: { "Filesystem/Move": unary({}) } });
add("files mv quiet", ["-q", ...S, "files", "mv", SBX, "-s", "/a", "-d", "/b"], { rpc: { "Filesystem/Move": unary({}) } });
add("files mv 404", [...S, "files", "mv", SBX, "-s", "/a", "-d", "/b"], {});
add("files mv missing dest", [...S, "files", "mv", SBX, "-s", "/a"]);
add("files mv missing source", [...S, "files", "mv", SBX, "-d", "/a"]);
add("files search hits", [...S, "files", "search", SBX, "-p", "/app", "--pattern", "*.py"], { start: () => proc({ out: ["/app/a.py\n/app/b.py\n\n/app/c.py\n"] }) });
add("files search json", ["--json", ...S, "files", "search", SBX, "-p", "/app", "--pattern", "*.py", "--max-depth", "2"], { start: () => proc({ out: ["/app/a.py\n"] }) });
add("files search none", [...S, "files", "search", SBX, "-p", "/app", "--pattern", "it's *"], { start: () => proc({}) });
add("files search none json", ["--json", ...S, "files", "search", SBX, "-p", "/app", "--pattern", "*.rs"], { start: () => proc({}) });
add("files search quiet", ["--quiet", ...S, "files", "search", SBX, "-p", "/app", "--pattern", "*.py"], { start: () => proc({ out: ["/a\n"] }) });
add("files search max-depth 0", [...S, "files", "search", SBX, "-p", "/app", "--pattern", "x", "--max-depth", "0"], { start: () => proc({}) });
add("files search max-depth -1", [...S, "files", "search", SBX, "-p", "/app", "--pattern", "x", "--max-depth", "-1"], { start: () => proc({}) });
add("files search max-depth abc", [...S, "files", "search", SBX, "-p", "/app", "--pattern", "x", "--max-depth", "abc"]);
add("files search max-depth 20 digits", [...S, "files", "search", SBX, "-p", "/app", "--pattern", "x", "--max-depth", "99999999999999999999"], { start: () => proc({}) });
add("files search max-depth 2**53+1", [...S, "files", "search", SBX, "-p", "/app", "--pattern", "x", "--max-depth", "9007199254740993"], { start: () => proc({}) });
add("files search missing pattern", [...S, "files", "search", SBX, "-p", "/app"]);
add("files search missing path", [...S, "files", "search", SBX, "--pattern", "x"]);
add("files search help", [...S, "files", "search", "--help"]);
add("files search 500 start", [...S, "files", "search", SBX, "-p", "/app", "--pattern", "x"], { start: raw(500, "application/json", '{"message":"x"}') });

// ---- process
const PLIST = unary({ processes: [{ pid: 1, command: "/sbin/init", status: "running" }, { pid: 42, command: "python app.py", status: "sleeping" }, { pid: 3 }] });
add("process list", [...S, "process", "list", SBX], { rpc: { "Process/List": PLIST } });
add("process list json", ["--json", ...S, "process", "list", SBX], { rpc: { "Process/List": PLIST } });
add("process list quiet", ["--quiet", ...S, "process", "list", SBX], { rpc: { "Process/List": PLIST } });
add("process list result wrapper", [...S, "process", "list", SBX], { rpc: { "Process/List": unary({ result: { processes: [{ pid: 9, command: "x y" }] } }) } });
add("process list empty", [...S, "process", "list", SBX], { rpc: { "Process/List": unary({ processes: [] }) } });
add("process list empty json", ["--json", ...S, "process", "list", SBX], { rpc: { "Process/List": unary({}) } });
add("process list 404", [...S, "process", "list", SBX], {});
add("process list help", [...S, "process", "list", "--help"]);
add("process help", [...S, "process", "--help"]);
add("process bare", [...S, "process"]);
add("process start ok", [...S, "process", "start", SBX, "-c", "echo ok"], { start: () => proc({ out: ["ok\n"] }) });
add("process start stderr", [...S, "process", "start", SBX, "-c", "x"], { start: () => proc({ out: ["out"], err: ["err"], code: 0 }) });
add("process start exit 42", [...S, "process", "start", SBX, "-c", "bad"], { start: () => proc({ err: ["fail\n"], code: 42 }) });
add("process start exit 42 json", ["--json", ...S, "process", "start", SBX, "-c", "bad"], { start: () => proc({ out: ["a\n"], err: ["fail\n"], code: 42 }) });
add("process start exit 3 quiet", ["--quiet", ...S, "process", "start", SBX, "-c", "bad"], { start: () => proc({ code: 3 }) });
add("process start json", ["--json", ...S, "process", "start", SBX, "-c", "echo hi"], { start: () => proc({ out: ["hi\n"] }) });
add("process start timeout cwd env", [...S, "process", "start", SBX, "-c", "make build", "--timeout", "60", "--cwd", "/app", "-t", "61"], { start: () => proc({}) });
add("process start pipe", [...S, "process", "start", SBX, "-c", "ls | wc -l"], { start: () => proc({ out: ["3\n"] }) });
add("process start quoted", [...S, "process", "start", SBX, "-c", "echo 'a b' \"c d\""], { start: () => proc({ out: ["a b c d\n"] }) });
add("process start bad quoting", [...S, "process", "start", SBX, "-c", "echo 'unterminated"], { start: () => proc({}) });
add("process start empty command", [...S, "process", "start", SBX, "-c", ""], { start: () => proc({}) });
add("process start no end frame", [...S, "process", "start", SBX, "-c", "x"], { start: () => proc({ out: ["partial"], noEnd: true }) });
add("process start 500", [...S, "process", "start", SBX, "-c", "x"], { start: raw(500, "application/json", '{"message":"x"}') });
add("process start 404 notfound", [...S, "process", "start", SBX, "-c", "x"], { start: raw(404, "application/json", '{"code":"not_found","message":"executable file not found in $PATH"}') });
add("process start invalid utf8 output", [...S, "process", "start", SBX, "-c", "x"], { start: () => ({ status: 200, type: "application/connect+json", body: Buffer.concat([frame({ event: { data: { stdout: Buffer.from([0xff, 0xfe, 0x41]).toString("base64") } } }), frame({ event: { end: { exitCode: 0 } } })]) }) });
add("process start timeout 0", [...S, "process", "start", SBX, "-c", "x", "-t", "0"], { start: () => proc({}) });
add("process start timeout 20 digits", [...S, "process", "start", SBX, "-c", "x", "-t", "99999999999999999999"], { start: () => proc({}) });
add("shell-stream timeout 20 digits", [...S, "shell-stream", SBX, "-c", "echo hello", "-t", "99999999999999999999"], { start: () => stream([frame({ event: { start: { pid: 1 } } }), so("hello\n"), ex(0)]) });
add("process start timeout abc", [...S, "process", "start", SBX, "-c", "x", "-t", "abc"]);
add("process start missing command", [...S, "process", "start", SBX]);
add("process start help", [...S, "process", "start", "--help"]);
const PS = (s, code = 0) => ({ start: () => proc({ out: [s], code }) });
add("process info ok", [...S, "process", "info", SBX, "1234"], PS("  1234   1  root  Ss  4096  00:05:12  python\n"));
add("process info long comm", [...S, "process", "info", SBX, "1234"], PS("1234 1 root Ss 4096 05:12 python   app.py  \n"));
add("process info json", ["--json", ...S, "process", "info", SBX, "1234"], PS("1234 1 root Ss 4096 05:12 python\n"));
add("process info quiet", ["--quiet", ...S, "process", "info", SBX, "1234"], PS("1234 1 root Ss 4096 05:12 python\n"));
add("process info few columns", [...S, "process", "info", SBX, "5"], PS("5 1 root\n"));
add("process info one column", [...S, "process", "info", SBX, "5"], PS("5\n"));
add("process info multiline", [...S, "process", "info", SBX, "5"], PS("5 1 root Ss 1 1 a  \nsecond line\n"));
add("process info unicode ws", [...S, "process", "info", SBX, "5"], PS("5\u00a01\u3000root Ss 1 1 a\n"));
add("process info not found exit1", [...S, "process", "info", SBX, "99999"], PS("", 1));
add("process info not found empty", [...S, "process", "info", SBX, "99999"], PS("  \n", 0));
add("process info not found json", ["--json", ...S, "process", "info", SBX, "99999"], PS("", 1));
add("process info not found quiet", ["--quiet", ...S, "process", "info", SBX, "99999"], PS("", 1));
add("process info neg pid", [...S, "process", "info", SBX, "-5"], PS("", 1));
add("process info pid abc", [...S, "process", "info", SBX, "abc"]);
add("process info pid 2**53+1", [...S, "process", "info", SBX, "9007199254740993"], PS("", 1));
add("process info pid 20 digits", [...S, "process", "info", SBX, "99999999999999999999"], PS("", 1));
add("process info pid missing", [...S, "process", "info", SBX]);
add("process info help", [...S, "process", "info", "--help"]);
add("process signal default", [...S, "process", "signal", SBX, "1234"], { rpc: { "Process/SendSignal": unary({}) } });
add("process signal 9", [...S, "process", "signal", SBX, "1234", "--signal", "9"], { rpc: { "Process/SendSignal": unary({}) } });
add("process signal -s 2 json", ["--json", ...S, "process", "signal", SBX, "1234", "-s", "2"], { rpc: { "Process/SendSignal": unary({}) } });
add("process signal quiet", ["--quiet", ...S, "process", "signal", SBX, "1234"], { rpc: { "Process/SendSignal": unary({}) } });
add("process signal 404", [...S, "process", "signal", SBX, "9999"], {});
add("process signal 500", [...S, "process", "signal", SBX, "9999"], { rpc: { "Process/SendSignal": raw(500, "text/plain", "boom") } });
add("process signal pid abc", [...S, "process", "signal", SBX, "abc"]);
add("process signal pid 2**53+1", [...S, "process", "signal", SBX, "9007199254740993"], { rpc: { "Process/SendSignal": unary({}) } });
add("process signal pid 20 digits", [...S, "process", "signal", SBX, "99999999999999999999"], { rpc: { "Process/SendSignal": unary({}) } });
add("process signal sig 20 digits", [...S, "process", "signal", SBX, "1", "-s", "99999999999999999999"], { rpc: { "Process/SendSignal": unary({}) } });
add("process signal sig abc", [...S, "process", "signal", SBX, "1", "-s", "abc"]);
add("process signal help", [...S, "process", "signal", "--help"]);

// ---- system
add("system help", [...S, "system", "--help"]);
add("system bare", [...S, "system"]);
add("system info ok", [...S, "system", "info", SBX], { start: () => proc({ out: [PY_INFO_OK] }) });
add("system info json", ["--json", ...S, "system", "info", SBX], { start: () => proc({ out: [PY_INFO_OK] }) });
add("system info quiet", ["--quiet", ...S, "system", "info", SBX], { start: () => proc({ out: [PY_INFO_OK] }) });
add("system info odd lines", [...S, "system", "info", SBX], { start: () => proc({ out: ["noise\n1: first\nA: b: c\n: empty key\nK: \n\n"] }) });
add("system info integer keys", ["--json", ...S, "system", "info", SBX], { start: () => proc({ out: ["2: b\n1: a\nx: y\n"] }) });
add("system info no output", [...S, "system", "info", SBX], { start: () => proc({}) });
add("system info fallback", [...S, "system", "info", SBX], { start: (c) => (c.startsWith("python3") || c.includes("python3") ? proc({ code: 1 }) : proc({ out: ["Linux sbx 6.1 x86_64\n"] })) });
add("system info fallback json", ["--json", ...S, "system", "info", SBX], { start: (c) => (c.includes("python3") ? proc({ code: 127 }) : proc({ out: ["Linux sbx\n\n"] })) });
add("system info fallback quiet", ["--quiet", ...S, "system", "info", SBX], { start: (c) => (c.includes("python3") ? proc({ code: 127 }) : proc({ out: ["Linux sbx\n"] })) });
add("system info fallback fails", [...S, "system", "info", SBX], { start: (c) => (c.includes("python3") ? proc({ code: 1 }) : proc({ code: 2 })) });
add("system info 500", [...S, "system", "info", SBX], { start: raw(500, "text/plain", "x") });
add("system info help", [...S, "system", "info", "--help"]);
const ENV = "ZED=last\nPATH=/usr/local/bin\nAPI_TOKEN=hidden\ncredential_file=hidden\nWITH_EQUALS=one=two\nmalformed\nALPHA=first\nEMPTY=\n=novalue\nMy_Key2=x\nPassword=1\nÄ=2\n\u{1F600}=3\n";
add("system env ok", [...S, "system", "env", SBX], { start: () => proc({ out: [ENV] }) });
add("system env json", ["--json", ...S, "system", "env", SBX], { start: () => proc({ out: [ENV] }) });
add("system env quiet", ["--quiet", ...S, "system", "env", SBX], { start: () => proc({ out: [ENV] }) });
add("system env filter", [...S, "system", "env", SBX, "--filter", " PATH, ZED ,,"], { start: () => proc({ out: [ENV] }) });
add("system env filter short", [...S, "system", "env", SBX, "-f", "ALPHA"], { start: () => proc({ out: [ENV] }) });
add("system env filter commas only", [...S, "system", "env", SBX, "-f", ","], { start: () => proc({ out: [ENV] }) });
add("system env filter none match", [...S, "system", "env", SBX, "-f", "NOPE"], { start: () => proc({ out: [ENV] }) });
add("system env filter none match json", ["--json", ...S, "system", "env", SBX, "-f", "NOPE"], { start: () => proc({ out: [ENV] }) });
add("system env filter sensitive", [...S, "system", "env", SBX, "-f", "API_TOKEN"], { start: () => proc({ out: [ENV] }) });
add("system env integer-like names", ["--json", ...S, "system", "env", SBX], { start: () => proc({ out: ["2=b\n1=a\nz=c\n"] }) });
add("system env integer-like names sorted", [...S, "system", "env", SBX], { start: () => proc({ out: ["2=b\n10=a\nz=c\n"] }) });
add("system env duplicate names", [...S, "system", "env", SBX], { start: () => proc({ out: ["A=1\nB=2\nA=3\n"] }) });
add("system env only sensitive", [...S, "system", "env", SBX], { start: () => proc({ out: ["API_KEY=hidden\n"] }) });
add("system env CRLF", [...S, "system", "env", SBX], { start: () => proc({ out: ["A=1\r\nB=2\r\n"] }) });
add("system env empty", [...S, "system", "env", SBX], { start: () => proc({}) });
add("system env exit 1", [...S, "system", "env", SBX], { start: () => proc({ err: ["env failed"], code: 1 }) });
add("system env exit 1 json", ["--json", ...S, "system", "env", SBX], { start: () => proc({ code: 1 }) });
add("system env 404", [...S, "system", "env", SBX], { start: raw(404, "application/json", "{}") });
add("system env missing id", [...S, "system", "env"]);
add("system env help", [...S, "system", "env", "--help"]);
add("system ports ss", [...S, "system", "ports", SBX], { start: () => proc({ out: ["State Recv-Q\nLISTEN 0 128 0.0.0.0:22\n"] }) });
add("system ports json", ["--json", ...S, "system", "ports", SBX], { start: () => proc({ out: ["State Recv-Q\n\nLISTEN 0 128 0.0.0.0:22\n"] }) });
add("system ports quiet", ["--quiet", ...S, "system", "ports", SBX], { start: () => proc({ out: ["x\n"] }) });
add("system ports no tool", [...S, "system", "ports", SBX], { start: () => proc({ out: ["NO_TOOL\n"] }) });
add("system ports no tool json", ["--json", ...S, "system", "ports", SBX], { start: () => proc({ out: ["NO_TOOL\n"] }) });
add("system ports exit 1", [...S, "system", "ports", SBX], { start: () => proc({ code: 1 }) });
add("system ports empty", [...S, "system", "ports", SBX], { start: () => proc({}) });
add("system ports help", [...S, "system", "ports", "--help"]);
const PIP = JSON.stringify([{ name: "numpy", version: "1.26.0" }, { name: "pip", version: "24.0" }, { name: "noversion" }]);
add("system packages pip", [...S, "system", "packages", SBX], { start: () => proc({ out: [PIP] }) });
add("system packages pip json", ["--json", ...S, "system", "packages", SBX], { start: () => proc({ out: [PIP] }) });
add("system packages pip quiet", ["--quiet", ...S, "system", "packages", SBX], { start: () => proc({ out: [PIP] }) });
add("system packages pip empty list", [...S, "system", "packages", SBX], { start: () => proc({ out: ["[]"] }) });
add("system packages pip empty list json", ["--json", ...S, "system", "packages", SBX], { start: () => proc({ out: ["[]"] }) });
add("system packages pip invalid", [...S, "system", "packages", SBX], { start: () => proc({ out: ["not json"] }) });
add("system packages pip invalid json mode", ["--json", ...S, "system", "packages", SBX], { start: () => proc({}) });
add("system packages pip dict empty", [...S, "system", "packages", SBX], { start: () => proc({ out: ["{}"] }) });
add("system packages pip dict", [...S, "system", "packages", SBX], { start: () => proc({ out: ['{"a": 1}'] }) });
add("system packages pip dict json", ["--json", ...S, "system", "packages", SBX], { start: () => proc({ out: ['{"a": 1.0, "b": [1.5, null, true]}'] }) });
add("system packages pip string", [...S, "system", "packages", SBX], { start: () => proc({ out: ['"abc"'] }) });
add("system packages pip number", [...S, "system", "packages", SBX], { start: () => proc({ out: ["5"] }) });
add("system packages pip zero", [...S, "system", "packages", SBX], { start: () => proc({ out: ["0"] }) });
add("system packages pip null", [...S, "system", "packages", SBX], { start: () => proc({ out: ["null"] }) });
add("system packages pip list of strings", [...S, "system", "packages", SBX], { start: () => proc({ out: ['["a","b"]'] }) });
add("system packages pip list of numbers", [...S, "system", "packages", SBX], { start: () => proc({ out: ["[1,2]"] }) });
add("system packages pip numeric version", [...S, "system", "packages", SBX], { start: () => proc({ out: ['[{"name":"x","version":1.5}]'] }) });
add("system packages pip numeric version quiet", ["--quiet", ...S, "system", "packages", SBX], { start: () => proc({ out: ['[{"name":"x","version":1}]'] }) });
add("system packages pip numeric version json", ["--json", ...S, "system", "packages", SBX], { start: () => proc({ out: ['[{"name":"x","version":1.0,"big":12345678901234567890}]'] }) });
add("system packages pip unicode", [...S, "system", "packages", SBX], { start: () => proc({ out: ['[{"name":"caf\\u00e9","version":"1"}]'] }) });
const NPM = JSON.stringify({ dependencies: { express: { version: "4.18.2" }, left: "1.0", odd: { x: 1 }, n: null, num: 5 } });
add("system packages npm", [...S, "system", "packages", SBX, "-m", "npm"], { start: () => proc({ out: [NPM] }) });
add("system packages npm json", ["--json", ...S, "system", "packages", SBX, "--manager", "npm"], { start: () => proc({ out: [NPM] }) });
add("system packages npm empty", [...S, "system", "packages", SBX, "-m", "npm"], { start: () => proc({ out: ["{}"] }) });
add("system packages npm empty json", ["--json", ...S, "system", "packages", SBX, "-m", "npm"], { start: () => proc({ out: ["{}"] }) });
add("system packages npm deps null", [...S, "system", "packages", SBX, "-m", "npm"], { start: () => proc({ out: ['{"dependencies": null}'] }) });
add("system packages npm deps list", [...S, "system", "packages", SBX, "-m", "npm"], { start: () => proc({ out: ['{"dependencies": []}'] }) });
add("system packages npm list root", [...S, "system", "packages", SBX, "-m", "npm"], { start: () => proc({ out: ["[]"] }) });
add("system packages npm invalid", [...S, "system", "packages", SBX, "-m", "npm"], { start: () => proc({ out: ["npm ERR!"] }) });
add("system packages npm version number", [...S, "system", "packages", SBX, "-m", "npm"], { start: () => proc({ out: ['{"dependencies":{"a":{"version":2}}}'] }) });
add("system packages npm version number json", ["--json", ...S, "system", "packages", SBX, "-m", "npm"], { start: () => proc({ out: ['{"dependencies":{"a":{"version":2.0},"b":2.5,"c":[1,{"d":null}]}}'] }) });
add("system packages npm quiet", ["--quiet", ...S, "system", "packages", SBX, "-m", "npm"], { start: () => proc({ out: [NPM] }) });
add("system packages bad manager", [...S, "system", "packages", SBX, "-m", "gem"]);
add("system packages help", [...S, "system", "packages", "--help"]);
const MET = '{"cpu_load_1m": 0.0, "cpu_load_5m": 0.25, "cpu_load_15m": 1.5, "disk_total_gb": 49.2, "disk_used_gb": 9.1, "disk_free_gb": 40.1}\n';
add("system metrics ok", [...S, "system", "metrics", SBX], { start: () => proc({ out: [MET] }) });
add("system metrics json", ["--json", ...S, "system", "metrics", SBX], { start: () => proc({ out: [MET] }) });
add("system metrics quiet", ["--quiet", ...S, "system", "metrics", SBX], { start: () => proc({ out: [MET] }) });
add("system metrics mixed types", [...S, "system", "metrics", SBX], { start: () => proc({ out: ['{"a": 1, "b": 2.0, "c": "s", "d": null, "e": true, "f": [1, 2.0], "g": {"h": 1.0}, "i": 1e21, "j": 1e-7}'] }) });
add("system metrics mixed types json", ["--json", ...S, "system", "metrics", SBX], { start: () => proc({ out: ['{"a": 1, "b": 2.0, "c": "s", "d": null, "e": true, "f": [1, 2.0], "g": {"h": 1.0}}'] }) });
add("system metrics integer keys", [...S, "system", "metrics", SBX], { start: () => proc({ out: ['{"2": "b", "1": "a"}'] }) });
add("system metrics empty dict", [...S, "system", "metrics", SBX], { start: () => proc({ out: ["{}"] }) });
add("system metrics list", [...S, "system", "metrics", SBX], { start: () => proc({ out: ["[1]"] }) });
add("system metrics list json", ["--json", ...S, "system", "metrics", SBX], { start: () => proc({ out: ["[1]"] }) });
add("system metrics string", [...S, "system", "metrics", SBX], { start: () => proc({ out: ['"x"'] }) });
add("system metrics invalid json", [...S, "system", "metrics", SBX], { start: () => proc({ out: ["not json\n\n"] }) });
add("system metrics invalid json mode", ["--json", ...S, "system", "metrics", SBX], { start: () => proc({ out: ["not json\n"] }) });
add("system metrics empty out", [...S, "system", "metrics", SBX], { start: () => proc({}) });
add("system metrics fallback", [...S, "system", "metrics", SBX], { start: (c) => (c.includes("python3") ? proc({ code: 1 }) : proc({ out: [" 10:00 up 1 day\n---\nFilesystem Size\n"] })) });
add("system metrics fallback json", ["--json", ...S, "system", "metrics", SBX], { start: (c) => (c.includes("python3") ? proc({ code: 1 }) : proc({ out: ["up\n---\n"] })) });
add("system metrics fallback quiet", ["--quiet", ...S, "system", "metrics", SBX], { start: (c) => (c.includes("python3") ? proc({ code: 1 }) : proc({ out: ["up\n"] })) });
add("system metrics help", [...S, "system", "metrics", "--help"]);

// ---- capabilities / shell-stream
add("capabilities default template", [...S, "capabilities", SBX]);
add("capabilities json", ["--json", ...S, "capabilities", SBX]);
add("capabilities quiet", ["--quiet", ...S, "capabilities", SBX]);
add("capabilities 404", [...S, "capabilities", SBX], {}, { platform404: true });
add("capabilities missing id", [...S, "capabilities"]);
add("capabilities help", [...S, "capabilities", "--help"]);
const stream = (frames) => ({ status: 200, type: "application/connect+json", body: Buffer.concat([...frames, frame({}, 2)]) });
const so = (s) => frame({ event: { data: { stdout: b64(s) } } });
const se = (s) => frame({ event: { data: { stderr: b64(s) } } });
const ex = (c) => frame({ event: { end: { exitCode: c, exited: true } } });
add("shell-stream multi chunk", [...S, "shell-stream", SBX, "-c", "echo hello"], { start: () => stream([frame({ event: { start: { pid: 1 } } }), so("hello "), so("world\n"), se("warn\n"), ex(0)]) });
add("shell-stream exit 1", [...S, "shell-stream", SBX, "-c", "bad"], { start: () => stream([so("partial\n"), ex(1)]) });
add("shell-stream exit 130 json", ["--json", ...S, "shell-stream", SBX, "-c", "bad"], { start: () => stream([so("partial\n"), ex(130)]) });
add("shell-stream json ok", ["--json", ...S, "shell-stream", SBX, "-c", "true"], { start: () => stream([ex(0)]) });
add("shell-stream quiet", ["--quiet", ...S, "shell-stream", SBX, "-c", "true"], { start: () => stream([so("x"), ex(0)]) });
add("shell-stream no exit frame", [...S, "shell-stream", SBX, "-c", "true"], { start: () => stream([so("x")]) });
add("shell-stream empty chunks", [...S, "shell-stream", SBX, "-c", "true"], { start: () => stream([so(""), se(""), ex(0)]) });
add("shell-stream last exit wins", [...S, "shell-stream", SBX, "-c", "true"], { start: () => stream([ex(3), ex(0)]) });
add("shell-stream timeout cwd", [...S, "shell-stream", SBX, "-c", "make", "--timeout", "60", "--cwd", "/app"], { start: () => stream([ex(0)]) });
add("shell-stream var expansion", [...S, "shell-stream", SBX, "-c", "echo $HOME"], { start: () => stream([so("/home/user\n"), ex(0)]) });
add("shell-stream backticks", [...S, "shell-stream", SBX, "-c", "echo `date`"], { start: () => stream([so("d\n"), ex(0)]) });
add("shell-stream pipe", [...S, "shell-stream", SBX, "-c", "ls | wc -l"], { start: () => stream([so("3\n"), ex(0)]) });
add("shell-stream quotes", [...S, "shell-stream", SBX, "-c", "echo \"a b\" 'c'"], { start: () => stream([so("a b c\n"), ex(0)]) });
add("shell-stream newline", [...S, "shell-stream", SBX, "-c", "echo a\necho b"], { start: () => stream([so("a\nb\n"), ex(0)]) });
add("shell-stream backslash", [...S, "shell-stream", SBX, "-c", "echo a\\ b"], { start: () => stream([so("a b\n"), ex(0)]) });
add("shell-stream plain", [...S, "shell-stream", SBX, "-c", "ls -la /tmp"], { start: () => stream([so("x\n"), ex(0)]) });
add("shell-stream glob", [...S, "shell-stream", SBX, "-c", "ls *.py"], { start: () => stream([ex(0)]) });
add("shell-stream empty command", [...S, "shell-stream", SBX, "-c", ""], { start: () => stream([ex(0)]) });
add("shell-stream unterminated quote", [...S, "shell-stream", SBX, "-c", "echo 'x"], { start: () => stream([ex(0)]) });
add("shell-stream 500", [...S, "shell-stream", SBX, "-c", "x"], { start: raw(500, "application/json", '{"message":"x"}') });
add("shell-stream 404", [...S, "shell-stream", SBX, "-c", "x"], {});
add("shell-stream 401", [...S, "shell-stream", SBX, "-c", "x"], { start: raw(401, "application/json", '{"message":"x"}') });
add("shell-stream reset", [...S, "shell-stream", SBX, "-c", "x"], { start: RESET });
add("shell-stream truncated frame", [...S, "shell-stream", SBX, "-c", "x"], { start: () => ({ status: 200, type: "application/connect+json", body: Buffer.concat([so("a"), frame({ event: { end: { exitCode: 0 } } }).subarray(0, 9)]) }) });
add("shell-stream missing command", [...S, "shell-stream", SBX]);
add("shell-stream help", [...S, "shell-stream", "--help"]);
add("shell-stream stderr only", [...S, "shell-stream", SBX, "-c", "x"], { start: () => stream([se("oops\n"), ex(2)]) });

// ---- connect errors (platform side)
add("files list platform 404", [...S, "files", "list", "nope"], {}, { platform404: true });
add("process list platform 401", [...S, "process", "list", SBX], {}, { platform401: true });
add("system env platform garbage", [...S, "system", "env", SBX], {}, { platformGarbage: true });
add("system env platform unreachable", [...S, "system", "env", SBX], {}, { unreachable: true });
add("shell-stream platform 429", [...S, "shell-stream", SBX, "-c", "x"], {}, { platform429: true });
add("files list platform timeout-ish reset", [...S, "files", "list", SBX], {}, { platformReset: true });

// ---- group help / listing
add("files mkdir help", [...S, "files", "mkdir", "--help"]);
add("files rm help", [...S, "files", "rm", "--help"]);
add("files mv help", [...S, "files", "mv", "--help"]);
add("system ports help -h", [...S, "system", "ports", "-h"]);
add("system info -h", [...S, "system", "info", "-h"]);
add("global --ci", ["--ci", ...S, "process", "list", SBX], { rpc: { "Process/List": PLIST } });
add("global --no-color", ["--no-color", ...S, "files", "list", SBX], { rpc: { "Filesystem/ListDir": LIST2 } });
add("global --no-color error", ["--no-color", ...S, "process", "info", SBX, "5"], PS("", 1));
add("global --verbose", ["--verbose", ...S, "process", "signal", SBX, "1"], { rpc: { "Process/SendSignal": unary({}) } });
add("global --log-level DEBUG", ["--log-level", "DEBUG", ...S, "files", "mkdir", SBX, "-p", "/x"], { rpc: { "Filesystem/MakeDir": unary({}) } });
add("process start error --json", ["--json", ...S, "process", "start", SBX, "-c", "x"], { start: raw(500, "application/json", '{"message":"x"}') });
add("process info error --json", ["--json", ...S, "process", "info", SBX, "5"], PS("", 1));
add("files stat error --json", ["--json", ...S, "files", "stat", SBX, "-p", "/no"], {});
add("files list -h", [...S, "files", "list", "-h"]);
add("process signal -h", [...S, "process", "signal", "-h"]);
add("system -h", [...S, "system", "-h"]);

// ---------------------------------------------------------------------------------------------------------------
// Stub server
// ---------------------------------------------------------------------------------------------------------------

function startStub(testCase) {
  const log = [];
  const ctx = { port: 0 };
  const handle = envdHandler(testCase.script);
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const h = req.headers;
      log.push({
        method: req.method,
        path: req.url,
        body,
        "x-api-key": h["x-api-key"] ?? null,
        authorization: h.authorization ?? null,
        "content-type": h["content-type"] ?? null,
        "x-access-token": h["x-access-token"] ?? null,
        "connect-protocol-version": h["connect-protocol-version"] ?? null,
      });
      let out;
      if (req.url.startsWith("/sandboxes/")) {
        if (testCase.platform404) out = raw(404, "application/json", '{"message":"sandbox not found"}');
        else if (testCase.platform401) out = raw(401, "application/json", '{"message":"Invalid API key"}');
        else if (testCase.platform429) out = raw(429, "application/json", '{"message":"Quota exceeded"}');
        else if (testCase.platformGarbage) out = raw(200, "application/json", "not json");
        else if (testCase.platformReset) out = RESET;
        else
          out = unary({
            sandboxID: SBX,
            templateID: "stub-template",
            clientID: "c",
            state: "running",
            startedAt: "2026-01-01T00:00:00Z",
            endAt: "2026-01-01T01:00:00Z",
            envdUrl: `http://127.0.0.1:${ctx.port}`,
            envdAccessToken: "tok",
          });
      } else if (req.url.startsWith("/templates") || req.url.startsWith("/v1/") || req.url.startsWith("/v2/")) {
        out = raw(404, "application/json", '{"message":"unscripted platform route"}');
      } else {
        out = handle(req.url, body);
      }
      if (out === RESET) {
        req.socket.destroy();
        return;
      }
      res.writeHead(out.status, { "Content-Type": out.type, "Content-Length": out.body.length });
      res.end(out.body);
    });
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () => {
      ctx.port = server.address().port;
      ok({ server, log, port: ctx.port });
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------------------------------------------

const configCmdReady = existsSync(join(CLI_ROOT, "src/cli/commands/config_cmd.ts"));
const nodeModulesReady = existsSync(join(CLI_ROOT, "src/cli/commands/sandbox.ts")) && configCmdReady;
const scratch = mkdtempSync(join(tmpdir(), "ebx-sbxdiff-"));
let nodeEntry = join(CLI_ROOT, "src/bin/ebx.ts");
if (!nodeModulesReady) {
  nodeEntry = join(scratch, "entry.ts");
  const u = (p) => pathToFileURL(join(CLI_ROOT, p)).href;
  const hasSandbox = existsSync(join(CLI_ROOT, "src/cli/commands/sandbox.ts"));
  writeFileSync(
    nodeEntry,
    `import { drainRealStreams, writeFdSync } from "${u("src/framework/io.ts")}";
import { main, mainSeams } from "${u("src/cli/main.ts")}";
import { group } from "${u("src/framework/index.ts")}";
import * as f from "${u("src/cli/commands/sandbox_files.ts")}";
import * as p from "${u("src/cli/commands/sandbox_process.ts")}";
import * as s from "${u("src/cli/commands/sandbox_system.ts")}";
${
  hasSandbox
    ? ""
    : `const sandbox = group("sandbox", { help: "Manage sandboxes." });
sandbox.addCommand(f.files, "files");
sandbox.addCommand(p.process, "process");
sandbox.addCommand(s.system, "system");
sandbox.addCommand(s.capabilities, "capabilities");
sandbox.addCommand(s.shell_stream, "shell-stream");
const orig = mainSeams.importModule;
mainSeams.importModule = async (m) => (m === "commands/sandbox" ? { sandbox } : orig(m));`
}
process.on("SIGINT", () => { writeFdSync(2, "\\nAborted!\\n"); process.exit(1); });
const code = await main();
await drainRealStreams();
process.exit(code);
`,
  );
}

function run(kind, argv, port, input) {
  const home = mkdtempSync(join(scratch, "home-"));
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    EBX_NO_KEYCHAIN: "1",
    E2B_API_KEY: "stub-key",
    E2B_API_URL: `http://127.0.0.1:${port}`,
    NO_PROXY: "*",
    no_proxy: "*",
    LANG: "C.UTF-8",
    COLUMNS: "80",
  };
  const [cmd, args, cwd] =
    kind === "py"
      ? [join(ORACLE_VENV, "bin", "ebx"), argv, home]
      : [process.execPath, ["--import", pathToFileURL(join(CLI_ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs")).href, nodeEntry, ...argv], home];
  return new Promise((ok) => {
    const proc = spawn(cmd, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    proc.stdout.on("data", (d) => out.push(d));
    proc.stderr.on("data", (d) => err.push(d));
    const timer = setTimeout(() => proc.kill("SIGKILL"), 60_000);
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      rmSync(home, { recursive: true, force: true });
      ok({ code: signal ? `signal:${signal}` : code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
    proc.stdin.on("error", () => {});
    proc.stdin.end(input ?? "");
  });
}

function normalise(text, port) {
  return text
    .split(`127.0.0.1:${port}`)
    .join("127.0.0.1:<port>")
    .replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>")
    .replace(/("execution_time": )[0-9.eE+-]+/g, "$1<time>")
    .replace(new RegExp(scratch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/home-[A-Za-z0-9]+", "g"), "<home>");
}

async function runCase(testCase) {
  const res = {};
  for (const kind of ["py", "node"]) {
    let stub = null;
    let port;
    if (testCase.unreachable) {
      const s = http.createServer();
      await new Promise((r) => s.listen(0, "127.0.0.1", r));
      port = s.address().port;
      await new Promise((r) => s.close(r));
    } else {
      stub = await startStub(testCase);
      port = stub.port;
    }
    const r = await run(kind, testCase.argv, port, testCase.input);
    const requests = stub ? stub.log.map((l) => normalise(JSON.stringify(l), port)) : [];
    stub?.server.closeAllConnections?.();
    stub?.server.close();
    let stderr = normalise(r.stderr, port);
    if (kind === "node" && !configCmdReady) {
      // `main.ts` merges the shortcuts at import time, before an entry can install an inert config seam.
      stderr = stderr.replace(/⚠ Warning: Failed to load shortcuts from config:[^\n]*\n( {2}[^\n]*\n)*/, "");
    }
    stderr = stderr
      .split("\n")
      .filter((l) => !/^(DEBUG: (Using selector|connect_tcp|connect_unix|start_tls|send_request|receive_response|response_closed|close\.)|INFO: HTTP Request)/.test(l))
      .join("\n");
    res[kind] = { code: r.code, stdout: normalise(r.stdout, port), stderr, requests };
  }
  return res;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const selected = cases.filter((c) => !only || c.name.includes(only));
const allow = createAllowList("sandbox_subcmds");
let diffs = 0;
try {
  const results = await pool(selected, 6, runCase);
  selected.forEach((c, i) => {
    const { py, node } = results[i];
    const problems = [];
    if (py.code !== node.code) problems.push(`exit: py=${py.code} node=${node.code}`);
    if (py.stdout !== node.stdout) problems.push(`stdout:\n    py:   ${JSON.stringify(py.stdout)}\n    node: ${JSON.stringify(node.stdout)}`);
    if (py.stderr !== node.stderr) problems.push(`stderr:\n    py:   ${JSON.stringify(py.stderr)}\n    node: ${JSON.stringify(node.stderr)}`);
    if (JSON.stringify(py.requests) !== JSON.stringify(node.requests)) {
      const n = Math.max(py.requests.length, node.requests.length);
      for (let k = 0; k < n; k += 1) {
        if (py.requests[k] !== node.requests[k]) {
          problems.push(`stub request #${k}:\n    py:   ${py.requests[k]}\n    node: ${node.requests[k]}`);
          break;
        }
      }
    }
    if (c.known) {
      console.log(problems.length ? `KNOWN ${c.name}: ${c.known}` : `FIXED ${c.name}: remove the "known" marker`);
      if (!problems.length) diffs += 1;
    } else if (problems.length && allow.judgeResults(c.name, py, node).allowed) {
      if (verbose) console.log(`ALLOWED ${c.name} (SDK defect fix, parity/sdk-defect-fixes.md)`);
    } else if (problems.length) {
      diffs += 1;
      console.log(`DIFF ${c.name}  [${c.argv.join(" ")}]\n  ${problems.join("\n  ")}`);
    } else if (verbose) {
      console.log(`ok   ${c.name} (exit ${py.code}) out=${JSON.stringify(py.stdout.slice(0, 90))} err=${JSON.stringify(py.stderr.slice(0, 90))}`);
    }
  });
  const stale = allow.report({ complete: !only });
  diffs += stale;
  console.log(`${diffs === 0 ? "IDENTICAL" : "DIFFERENCES"}: ${diffs} differing case(s) of ${selected.length}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(diffs === 0 ? 0 : 1);

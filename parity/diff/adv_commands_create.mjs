#!/usr/bin/env node
/**
 * ADV-commands: `create` / `kill` / `list` flag semantics (env/metadata parsing, --upload file/dir, template names,
 * routing guards, timeouts, kill --all/--yes/prompt-on-pipe, list filters), request bodies on the wire.
 *   ORACLE_VENV=... node parity/diff/adv_commands_create.mjs [--only substr] [--jobs N]
 */
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argOf, requireOracle, runAll } from "./adv_commands_lib.mjs";
requireOracle();
const cases = [];
const add = (name, argv, extra = {}) => cases.push({ name, argv, ...extra });
const put = (c, rel, data) => { const p = join(c, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, data); };
const T = ["--template", "base"];
for (const e of ["A=1", "A=", "=v", "A", "", "A=B=C", "A =1", " A=1", "A=1 ", "日本=語", "A=\n", "A=$HOME", "A='q'", "=", "==", "A=1,B=2", "-X=1", "a b=c d", "__proto__=1", "constructor=2", "toString=3"]) {
  add(`env ${JSON.stringify(e)}`, ["create", ...T, "-e", e]);
  add(`env ${JSON.stringify(e)} json`, ["--json", "create", ...T, "--env", e]);
  add(`meta ${JSON.stringify(e)}`, ["create", ...T, "--metadata", e]);
}
add("env dup", ["create", ...T, "-e", "A=1", "-e", "A=2", "-e", "B=3"]);
add("env many", ["create", ...T, ...Array.from({ length: 50 }, (_, i) => ["-e", `K${i}=${i}`]).flat()]);
add("env + meta", ["create", ...T, "-e", "A=1", "--metadata", "B=2", "--metadata", "C=3"]);
add("env one bad one good", ["create", ...T, "-e", "A=1", "-e", "bad"]);
add("meta one bad one good", ["create", ...T, "--metadata", "A=1", "--metadata", "bad"]);
add("env proto key order", ["create", ...T, "-e", "b=1", "-e", "1=x", "-e", "a=2", "-e", "0=y"]);
add("meta numeric keys order", ["create", ...T, "--metadata", "b=1", "--metadata", "10=x", "--metadata", "2=y", "--metadata", "a=2"]);
for (const t of ["base", "python-hello", "", " ", "a/b", "BASE", "日本語", "x".repeat(500), "--json", "-x", "a b", "tmpl:tag", "../x"]) add(`template ${JSON.stringify(t)}`, ["create", "--template", t]);
add("no template no desc", ["create"]);
add("no template no desc json", ["--json", "create"]);
add("no template no desc quiet", ["--quiet", "create"]);
add("desc and template", ["create", "a python env", ...T]);
add("empty desc and template", ["create", "", ...T]);
add("empty desc no template", ["create", ""]);
add("dir without desc", ["create", ...T, "--dir", "x"]);
add("dir without desc no template", ["create", "--dir", "x"]);
add("desc no creds no llm", ["create", "-y", "a python env"]);
add("desc no tty no yes", ["create", "a python env"]);
add("desc quiet", ["--quiet", "create", "-y", "a python env"]);
add("desc json", ["--json", "create", "-y", "a python env"]);
add("desc ci", ["--ci", "create", "a python env"]);
add("desc whitespace", ["create", "   "]);
add("desc whitespace + template", ["create", "   ", ...T]);
add("desc huge", ["create", "-y", "x".repeat(100000)]);
for (const t of ["1", "300", "86400", "86401", "0", "-1", "3600"]) add(`create timeout ${t}`, ["create", ...T, "--timeout", t]);
add("root -t", ["-t", "10", "create", ...T]);
add("create -t", ["create", ...T, "-t", "10"]);
for (const t of ["0.5", "1", "1e2", "inf", "nan", "-1", "0", "1_0", ".5", "5.", "+5", "1e-3"]) add(`request-timeout ${t}`, ["create", ...T, "--request-timeout", t]);
add("config http_timeout 500", ["create", ...T], { setup: (h) => { mkdirSync(join(h, ".abx"), { recursive: true }); writeFileSync(join(h, ".abx", "config.toml"), "[transport]\nhttp_timeout = 500\n"); } });
add("config http_timeout 10", ["create", ...T], { setup: (h) => { mkdirSync(join(h, ".abx"), { recursive: true }); writeFileSync(join(h, ".abx", "config.toml"), "[transport]\nhttp_timeout = 10\n"); } });
add("env http_timeout", ["create", ...T], { env: { SANDBOX_HTTP_TIMEOUT: "777" } });
// upload on create
add("create upload file", ["create", ...T, "--upload", "f.txt"], { setup: (h, c) => put(c, "f.txt", "hello") });
add("create upload file json", ["--json", "create", ...T, "--upload", "f.txt"], { setup: (h, c) => put(c, "f.txt", "hello") });
add("create upload file quiet", ["--quiet", "create", ...T, "--upload", "f.txt"], { setup: (h, c) => put(c, "f.txt", "hello") });
add("create upload dir", ["create", ...T, "--upload", "d"], { setup: (h, c) => { put(c, "d/a.txt", "a"); put(c, "d/s/b.txt", "b"); } });
add("create upload dir empty", ["create", ...T, "--upload", "d"], { setup: (h, c) => mkdirSync(join(c, "d")) });
add("create upload dir trailing slash", ["create", ...T, "--upload", "d/"], { setup: (h, c) => put(c, "d/a.txt", "a") });
add("create upload missing", ["create", ...T, "--upload", "nope"]);
add("create upload empty", ["create", ...T, "--upload", ""]);
add("create upload symlink", ["create", ...T, "--upload", "ln"], { setup: (h, c) => { put(c, "t", "x"); symlinkSync("t", join(c, "ln")); } });
add("create upload unicode", ["create", ...T, "--upload", "日本語.txt"], { setup: (h, c) => put(c, "日本語.txt", "x") });
add("create upload dir unicode+space", ["create", ...T, "--upload", "d"], { setup: (h, c) => { put(c, "d/日本 語.txt", "x"); put(c, "d/a b/c d.txt", "y"); } });
add("create upload with creds fault", ["create", ...T, "--upload", "f.txt"], { setup: (h, c) => put(c, "f.txt", "hello"), world: { faults: { "POST /files": { status: 500, body: { message: "x" } } } } });
// faults on create
for (const [n, f] of Object.entries({ 401: 401, 403: 403, 404: 404, 409: 409, 422: 422, 429: 429, 500: 500, 502: 502, 503: 503 })) {
  add(`create fault ${n}`, ["create", ...T], { world: { faults: { "POST /sandboxes": { status: f, body: { code: f, message: `err ${f}` } } } } });
  add(`create fault ${n} json`, ["--json", "create", ...T], { world: { faults: { "POST /sandboxes": { status: f, body: { code: f, message: `err ${f}` } } } } });
}
add("create fault html body", ["create", ...T], { world: { faults: { "POST /sandboxes": { status: 502, body: "<html>bad gateway</html>" } } } });
add("create fault empty body", ["create", ...T], { world: { faults: { "POST /sandboxes": { status: 500, body: "" } } } });
add("create no creds", ["create", ...T], { creds: false });
add("create unreachable", ["create", ...T], { env: { E2B_API_URL: "http://127.0.0.1:9" } });
add("create bad api url", ["create", ...T], { env: { E2B_API_URL: "not a url" } });
add("create api url no scheme", ["create", ...T], { env: { E2B_API_URL: "127.0.0.1:9" } });
add("create api url https refused", ["create", ...T], { env: { E2B_API_URL: "https://127.0.0.1:9" } });
// kill / list
add("kill --all", ["kill", "--all", "--yes"]);
add("kill --all no yes piped", ["kill", "--all"]);
add("kill --all no yes piped y", ["kill", "--all"], { stdin: "y\n" });
add("kill --all piped n", ["kill", "--all"], { stdin: "n\n" });
add("kill --all piped Y", ["kill", "--all"], { stdin: "Y\n" });
add("kill --all piped yes", ["kill", "--all"], { stdin: "yes\n" });
add("kill --all piped junk then y", ["kill", "--all"], { stdin: "maybe\ny\n" });
add("kill --all piped eof", ["kill", "--all"], { stdin: "" });
add("kill --all with id", ["kill", "sbx-ev-001", "--all", "--yes"]);
add("kill all none", ["kill", "--all", "--yes"], { world: { sandboxes: {} } });
add("kill all json", ["--json", "kill", "--all", "--yes"]);
add("kill all quiet", ["--quiet", "kill", "--all", "--yes"]);
add("kill all fault on one", ["kill", "--all", "--yes"], { world: { faults: { "DELETE /sandboxes/sbx-ev-002": { status: 500, body: { message: "x" } } } } });
add("kill noarg", ["kill"]);
add("kill id piped n", ["kill", "sbx-ev-001"], { stdin: "n\n" });
add("kill id piped y", ["kill", "sbx-ev-001"], { stdin: "y\n" });
add("kill id piped eof", ["kill", "sbx-ev-001"], { stdin: "" });
add("kill id json no yes", ["--json", "kill", "sbx-ev-001"], { stdin: "y\n" });
add("kill id quiet no yes", ["--quiet", "kill", "sbx-ev-001"], { stdin: "y\n" });
add("kill id ci no yes", ["--ci", "kill", "sbx-ev-001"], { stdin: "y\n" });
add("kill id with region", ["kill", "sbx-ev-001", "--yes", "--region", "cn-shanghai"]);
add("kill 404", ["kill", "sbx-nope", "--yes"]);
add("kill unicode id", ["kill", "sbx-日本", "--yes"]);
add("kill id with slash", ["kill", "a/b", "--yes"]);
add("kill id with query", ["kill", "a?b=c", "--yes"]);
add("kill id with space", ["kill", "a b", "--yes"]);
add("kill id with percent", ["kill", "a%2Fb", "--yes"]);
add("kill id with dotdot", ["kill", "..", "--yes"]);
add("info id with slash", ["info", "a/b"]);
add("info id with query", ["info", "a?b=c"]);
add("info id with percent", ["info", "a%2Fb"]);
add("info id dotdot", ["info", ".."]);
add("info id dot", ["info", "."]);
add("info id empty", ["info", ""]);
add("info id huge", ["info", "x".repeat(10000)]);
add("info id unicode", ["info", "沙箱"]);
for (const s of ["running", "stopped", "creating", "paused", "error", "RUNNING", "bogus", ""]) add(`list status ${JSON.stringify(s)}`, ["list", "--status", s]);
for (const l of ["1", "0", "-1", "100", "101", "1000", "5.5", "x"]) add(`list limit ${l}`, ["list", "--limit", l]);
add("list region", ["list", "--region", "cn-shanghai"]);
add("list region empty", ["list", "--region", ""]);
add("list region bad", ["list", "--region", "mars"]);
add("list region env", ["list"], { env: { ABX_REGION: "cn-beijing" } });
add("list region env2", ["list"], { env: { SANDBOX_REGION: "cn-beijing" } });
add("list region env3", ["list"], { env: { E2B_REGION: "cn-beijing" } });
add("list region opt+env", ["list", "--region", "cn-shanghai"], { env: { ABX_REGION: "cn-beijing" } });
add("list empty", ["list"], { world: { sandboxes: {} } });
add("list empty json", ["--json", "list"], { world: { sandboxes: {} } });
add("list empty quiet", ["--quiet", "list"], { world: { sandboxes: {} } });
add("list weird fields", ["list"], { world: { sandboxes: { x: { sandboxID: "日本語-sandbox-with-a-very-long-id-0123456789-0123456789-0123456789", templateID: "t\u0000x", state: "weird", startedAt: "not a date", metadata: { a: 1 } } } } });
add("list weird fields json", ["--json", "list"], { world: { sandboxes: { x: { sandboxID: "日本語", templateID: null, state: "weird", startedAt: "not a date", metadata: { a: 1 }, cpuCount: 1.5, memoryMB: "x" } } } });
add("list null entries", ["list"], { world: { sandboxes: { x: null } } });
const diffs = await runAll(cases, { jobs: Number(argOf("--jobs") ?? 6), only: argOf("--only") });
process.exitCode = diffs.length ? 1 : 0;

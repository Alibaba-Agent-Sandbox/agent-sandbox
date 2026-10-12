#!/usr/bin/env node
/**
 * ADV-commands: output-mode matrix. Every runnable command x {--json,--quiet,--ci,--verbose,--log-level X,--no-color,
 * CI env, combos} x {success, 404, 401, 429, 500, unreachable server, no credentials}. Oracle vs Node
 * (exit code, stdout, stderr, wire).
 *   ORACLE_VENV=... node parity/diff/adv_commands_matrix.mjs [--only substr] [--jobs N] [--quick]
 */
import { writeFileSync } from "node:fs";
import { argOf, requireOracle, runAll } from "./adv_commands_lib.mjs";
requireOracle();
const SB = "sbx-ev-001";
const CMDS = {
  list: ["list"], "list-status": ["list", "--status", "running"], info: ["info", SB], "info-404": ["info", "sbx-nope"],
  "kill-one": ["kill", SB, "--yes"], "kill-404": ["kill", "sbx-nope", "--yes"], "kill-all": ["kill", "--all", "--yes"], "kill-noarg": ["kill"],
  "exec-ok": ["exec", SB, "echo hi"], "exec-fail": ["exec", SB, "exit 3"], "exec-nf": ["exec", SB, "nonexistent-bin"],
  capabilities: ["sandbox", "capabilities", SB],
  "files-list": ["sandbox", "files", "list", SB, "--path", "/home/user"], "files-list-404": ["sandbox", "files", "list", SB, "--path", "/nope"],
  "files-stat": ["sandbox", "files", "stat", SB, "--path", "/home/user/hello.txt"], "files-mkdir": ["sandbox", "files", "mkdir", SB, "--path", "/tmp/x"],
  "files-mv": ["sandbox", "files", "mv", SB, "--source", "/a", "--dest", "/b"], "files-rm": ["sandbox", "files", "rm", SB, "--path", "/a", "--yes"],
  "files-search": ["sandbox", "files", "search", SB, "--path", "/home/user", "--pattern", "*.txt"],
  "proc-list": ["sandbox", "process", "list", SB], "proc-info": ["sandbox", "process", "info", SB, "1"], "proc-signal": ["sandbox", "process", "signal", SB, "1"],
  "proc-start": ["sandbox", "process", "start", SB, "--command", "echo hi"], "proc-start-fail": ["sandbox", "process", "start", SB, "--command", "exit 2"],
  "shell-stream": ["sandbox", "shell-stream", SB, "--command", "echo hi"],
  "sys-env": ["sandbox", "system", "env", SB], "sys-info": ["sandbox", "system", "info", SB], "sys-metrics": ["sandbox", "system", "metrics", SB],
  "sys-packages": ["sandbox", "system", "packages", SB], "sys-ports": ["sandbox", "system", "ports", SB],
  "tpl-list": ["template", "list"], "tpl-info": ["template", "info", "tmpl-001"], "tpl-info-404": ["template", "info", "nope"],
  "tpl-delete": ["template", "delete", "tmpl-001", "--yes"],
  "run-nocmd": ["run", SB, "dev"], "mcp-status": ["mcp", "status"], "cfg-list": ["config", "list"], "cfg-get": ["config", "get", "region"],
  "cfg-set": ["config", "set", "region", "cn-shanghai"], "cfg-delete": ["config", "delete", "region"], "cfg-get-bad": ["config", "get", "bogus_key"],
};
const MODES = {
  plain: [], json: ["--json"], quiet: ["--quiet"], jq: ["--json", "--quiet"], ci: ["--ci"], verbose: ["--verbose"], ll_debug: ["--log-level", "DEBUG"], ll_info: ["--log-level", "info"], ll_warn: ["--log-level", "WARNING"], ll_err: ["--log-level", "ERROR"],
  nocolor: ["--no-color"], jv: ["--json", "--verbose"], qv: ["--quiet", "--verbose"], cv: ["--ci", "--verbose"], jll: ["--json", "--log-level", "DEBUG"], qll: ["--quiet", "--log-level", "ERROR"],
};
const quick = process.argv.includes("--quick");
const FAULTS = {
  ok: {}, "401": { world: { faults: { "*": { status: 401, body: { message: "no" } } } } }, "429": { world: { faults: { "*": { status: 429, body: { message: "slow down" } } } } },
  "500": { world: { faults: { "*": { status: 500, body: { message: "boom" } } } } }, "503": { world: { faults: { "*": { status: 503, body: "oops" } } } },
  nocreds: { creds: false }, unreachable: { env: { E2B_API_URL: "http://127.0.0.1:9", E2B_DOMAIN: "127.0.0.1:9" } },
};
const cases = [];
for (const [cn, cargv] of Object.entries(CMDS)) {
  for (const [mn, margv] of Object.entries(MODES)) {
    for (const [fn, f] of Object.entries(FAULTS)) {
      if (fn !== "ok" && !(["plain", "json", "quiet"].includes(mn))) continue;
      if (quick && (fn !== "ok" || !["plain", "json", "quiet", "verbose", "ci"].includes(mn))) continue;
      cases.push({ name: `${cn} | ${mn} | ${fn}`, argv: [...margv, ...cargv], ...f, timeoutMs: 40000 });
    }
  }
}
for (const e of [{ CI: "true" }, { GITHUB_ACTIONS: "true" }, { CI: "1", EBX_NO_COLOR: "1" }]) {
  for (const [cn, cargv] of Object.entries(CMDS)) cases.push({ name: `${cn} | env ${JSON.stringify(e)}`, argv: cargv, env: e });
}
console.log(`${cases.length} cases`);
const diffs = await runAll(cases, { jobs: Number(argOf("--jobs") ?? 8), only: argOf("--only") });
if (argOf("--out")) writeFileSync(argOf("--out"), JSON.stringify(diffs, null, 1));
process.exitCode = diffs.length ? 1 : 0;

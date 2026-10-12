#!/usr/bin/env node
/**
 * Differential test of `handle_errors` / `_handle_remote_exception` (exit codes, error text on stdout/stderr, JSON and
 * quiet modes) against the original Python CLI: a throw-away `boom` command wrapped in `handle_errors` is mounted on the
 * real root group (`cli.main`), run through each global output mode, and made to raise every kind of exception.
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/handle_errors.mjs [--verbose]
 *
 * Exit code 0 = identical, 1 = differences, 2 = oracle missing.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
const verbose = process.argv.includes("--verbose");

if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "python"))) {
  console.error("ORACLE_VENV must point to a venv with the original easy-sandbox installed (see docs/PORTING.md).");
  process.exit(2);
}

const MSGS = ["boom", "", "multi\nline msg", "日本語", "[bold]x[/bold]", "100% %s"];
const EXC = [];
for (const m of MSGS) {
  for (const cls of ["SandboxError", "AuthenticationError", "TemplateNotFoundError", "FileNotFoundError_", "CommandTimeoutError", "QuotaExceededError", "ConnectionError_", "EnvdRpcError", "TemplateParseError"]) {
    EXC.push({ kind: "sdk", cls, message: m });
  }
  for (const cls of ["ReadTimeout", "ConnectTimeout", "ConnectError", "ReadError", "RemoteProtocolError", "LocalProtocolError", "HTTPError", "RequestError", "DecodingError"]) {
    EXC.push({ kind: "httpx", cls, message: m });
  }
  for (const cls of ["ValueError", "RuntimeError", "TypeError"]) EXC.push({ kind: "builtin", cls, message: m });
  EXC.push({ kind: "oserr", message: m }, { kind: "timeout", message: m }, { kind: "click", message: m }, { kind: "usage", message: m });
}
for (const code of [400, 401, 403, 404, 429, 500, 503]) EXC.push({ kind: "status", code });
EXC.push(
  { kind: "enoent", path: "/no/such/file" },
  { kind: "eacces", path: "/root/secret" },
  { kind: "systemexit", code: 7 },
  { kind: "systemexit", code: 0 },
  { kind: "exit", code: 5 },
  { kind: "abort" },
  { kind: "keyboardinterrupt" },
  { kind: "eof" },
);
const MODES = [[], ["--json"], ["--quiet"], ["--no-color"], ["--ci"], ["--json", "--quiet"], ["--verbose"]];
const cases = [];
for (const mode of MODES) EXC.forEach((exc, i) => cases.push({ mode, exc, id: i }));

const PY = String.raw`
import json, sys, asyncio
import click, httpx
from click.testing import CliRunner
from easy_sandbox.cli.main import cli, handle_errors
from easy_sandbox.models import errors as E

spec = json.load(open(sys.argv[1]))

def build(x):
    k = x["kind"]
    if k == "sdk":
        return getattr(E, x["cls"])(x["message"])
    if k == "httpx":
        return getattr(httpx, x["cls"])(x["message"])
    if k == "builtin":
        return {"ValueError": ValueError, "KeyError": KeyError, "RuntimeError": RuntimeError, "TypeError": TypeError}[x["cls"]](x["message"])
    if k == "oserr":
        return OSError(x["message"])
    if k == "timeout":
        return asyncio.TimeoutError(x["message"])
    if k == "click":
        return click.ClickException(x["message"])
    if k == "usage":
        return click.UsageError(x["message"])
    if k == "status":
        req = httpx.Request("POST", "https://sbx.example/x")
        return httpx.HTTPStatusError("Server error", request=req, response=httpx.Response(x["code"], request=req))
    if k == "enoent":
        return FileNotFoundError(2, "No such file or directory", x["path"])
    if k == "eacces":
        return PermissionError(13, "Permission denied", x["path"])
    if k == "systemexit":
        return SystemExit(x["code"])
    if k == "exit":
        return click.exceptions.Exit(x["code"])
    if k == "abort":
        return click.Abort()
    if k == "keyboardinterrupt":
        return KeyboardInterrupt()
    return EOFError("EOF when reading a line")

current = {}

@click.command("boom")
@handle_errors
def boom():
    raise build(current["exc"])

cli.add_command(boom)
res = []
for c in spec:
    current["exc"] = c["exc"]
    r = CliRunner().invoke(cli, [*c["mode"], "boom"])
    exc = r.exception
    res.append({"code": r.exit_code, "out": r.stdout, "err": r.stderr, "exc": None if exc is None or isinstance(exc, SystemExit) else type(exc).__name__ + ": " + str(exc)})
json.dump(res, sys.stdout)
`;

const TS = `
import { readFileSync } from "node:fs";
import { cli, handleErrors } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/cli/main.ts")).href)};
import { Abort, EOFError, Exit, KeyboardInterrupt, SystemExit, ClickException, UsageError, command } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/framework/index.ts")).href)};
import * as E from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/models/errors.ts")).href)};
import * as httpx from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/transport/_httpx.ts")).href)};
import { ValueError } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/framework/types.ts")).href)};
import { OSError, toOSError } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/utils/_pyos.ts")).href)};
import { AsyncioTimeoutError } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "src/transport/ws.ts")).href)};
import { CliRunner } from ${JSON.stringify(pathToFileURL(join(CLI_ROOT, "tests/helpers/cliRunner.ts")).href)};

class KeyError extends Error { constructor(m) { super(m); this.name = "KeyError"; } }
class RuntimeError extends Error { constructor(m) { super(m); this.name = "RuntimeError"; } }
class TypeError_ extends Error { constructor(m) { super(m); this.name = "TypeError"; } }
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const fsErr = (code) => Object.assign(new Error(code), { code });
const build = (x) => {
  switch (x.kind) {
    case "sdk": return new E[x.cls](x.message);
    case "httpx": return new httpx[x.cls](x.message);
    case "builtin": return new ({ ValueError, KeyError, RuntimeError, TypeError: TypeError_ }[x.cls])(x.message);
    case "oserr": return new OSError(x.message);
    case "timeout": return new AsyncioTimeoutError(x.message);
    case "click": return new ClickException(x.message);
    case "usage": return new UsageError(x.message);
    case "status": {
      const request = new httpx.Request("POST", "https://sbx.example/x");
      return new httpx.HTTPStatusError("Server error", { request, response: new httpx.Response(x.code, { request }) });
    }
    case "enoent": return toOSError(fsErr("ENOENT"), x.path);
    case "eacces": return toOSError(fsErr("EACCES"), x.path);
    case "systemexit": return new SystemExit(x.code);
    case "exit": return new Exit(x.code);
    case "abort": return new Abort();
    case "keyboardinterrupt": return new KeyboardInterrupt();
    default: return new EOFError("EOF when reading a line");
  }
};
const current = {};
const boom = command("boom", { callback: handleErrors(async () => { throw build(current.exc); }) });
cli.addCommand(boom);
const res = [];
for (const c of spec) {
  current.exc = c.exc;
  const r = await new CliRunner().invoke(cli, [...c.mode, "boom"]);
  const exc = r.exception;
  res.push({ code: r.exit_code, out: r.stdout, err: r.stderr, exc: exc === null || exc === undefined || exc instanceof SystemExit ? null : exc.constructor.name + ": " + exc.message });
}
process.stdout.write(JSON.stringify(res));
`;

const scratch = mkdtempSync(join(tmpdir(), "ebx-herr-"));
let failed = 0;
try {
  const specFile = join(scratch, "spec.json");
  writeFileSync(specFile, JSON.stringify(cases));
  const tsFile = join(scratch, "run.mts");
  writeFileSync(tsFile, TS);
  const tsx = pathToFileURL(join(CLI_ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs")).href;
  const env = { PATH: process.env.PATH, HOME: scratch, EBX_NO_KEYCHAIN: "1", TERM: "dumb", NO_COLOR: "1", LANG: "C.UTF-8", COLUMNS: "80" };
  const py = spawnSync(join(ORACLE_VENV, "bin", "python"), ["-c", PY, specFile], { env, cwd: scratch, encoding: "utf8", maxBuffer: 1 << 28 });
  if (py.status !== 0) throw new Error(`oracle failed: ${py.stderr}`);
  const node = spawnSync(process.execPath, ["--import", tsx, tsFile, specFile], { env, cwd: CLI_ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  if (node.status !== 0) throw new Error(`node failed: ${node.stderr}`);
  const a = JSON.parse(py.stdout);
  const b = JSON.parse(node.stdout);
  cases.forEach((c, i) => {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
      failed += 1;
      if (failed <= 8) console.log(`DIFF [${c.mode.join(" ")}] ${JSON.stringify(c.exc)}\n  py:   ${JSON.stringify(a[i])}\n  node: ${JSON.stringify(b[i])}`);
    } else if (verbose) console.log(`ok [${c.mode.join(" ")}] ${JSON.stringify(c.exc)} -> exit ${a[i].code}`);
  });
  console.log(`${failed === 0 ? "IDENTICAL" : "DIFFERENCES"}: ${failed} differing case(s) of ${cases.length}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * Differential test of the main sandbox commands -- `create`, `list`, `info`, `kill`, `exec`, `connect`, `upload`,
 * `download`, `run` (and their `sandbox <name>` spellings, help texts and AI-path gates): the original Python CLI
 * (`$ORACLE_VENV/bin/abx`) versus the Node CLI, run with the same argv, an isolated HOME, no real credentials, and a
 * local stub platform + envd (Connect protocol) server that serves scripted answers.
 *
 *   ORACLE_VENV=/path/to/venv-for-original-abx node parity/diff/sandbox_cmds.mjs [--verbose] [--only <substr>] [--show]
 *
 * Compared per case: exit code, stdout, stderr (ports / timings / temp paths normalised), files written by the command
 * (`artifacts`) and the stub request log (method, path, body, auth headers). Exit code 0 = identical, 1 = differences,
 * 2 = oracle missing.
 */

import { spawn } from "node:child_process";
import { chmodSync, lstatSync, symlinkSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createAllowList } from "./sdk_defect_allowlist.mjs";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
const verbose = process.argv.includes("--verbose");
const show = process.argv.includes("--show");
const full = process.argv.includes("--full");
const dump = process.argv.includes("--dump");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "abx"))) {
  console.error("ORACLE_VENV must point to a venv with the original agent-sandbox installed (see docs/PORTING.md).");
  process.exit(2);
}

const SBX = "sbx-stub";
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

// ---------------------------------------------------------------------------------------------------------------
// Scripted answers
// ---------------------------------------------------------------------------------------------------------------

const frame = (obj, flags = 0) => {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const head = Buffer.alloc(5);
  head.writeUInt8(flags, 0);
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
};
const json = (status, obj) => ({ status, type: "application/json", body: Buffer.from(JSON.stringify(obj)) });
const raw = (status, type, text) => ({ status, type, body: Buffer.from(text) });
const proc = ({ out = [], err = [], code = 0, noEnd = false } = {}) => ({
  status: 200,
  type: "application/connect+json",
  body: Buffer.concat([
    frame({ event: { start: { pid: 7 } } }),
    ...out.map((s) => frame({ event: { data: { stdout: b64(s) } } })),
    ...err.map((s) => frame({ event: { data: { stderr: b64(s) } } })),
    ...(noEnd ? [] : [frame({ event: { end: { exitCode: code, exited: true, status: "exited" } } })]),
    frame({}, 2),
  ]),
});
const RESET = "reset";

const sandboxJson = (port, over = {}) => ({
  sandboxID: SBX,
  templateID: "base",
  clientID: "c",
  state: "running",
  startedAt: "2026-01-01T00:00:00Z",
  endAt: "2026-01-01T01:00:00Z",
  cpuCount: 2,
  memoryMB: 2048,
  envdVersion: "0.5.2",
  metadata: {},
  envdUrl: `http://127.0.0.1:${port}`,
  envdAccessToken: "tok",
  ...over,
});

const cmdline = (body) => {
  const p = JSON.parse(body || "{}").process ?? {};
  return [p.cmd, ...(p.args ?? [])].join(" ");
};

// ---------------------------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------------------------

const cases = [];
/** add(name, argv, opts): opts = { input, env, setup(home, cwd), platform(req, ctx)->spec|undefined, start(cmd, body), files, list, create, artifacts[], unreachable } */
const add = (name, argv, opts = {}) => cases.push({ name, argv, ...opts });

const write = (dir, rel, content = "") => {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
};

// ---- help ----------------------------------------------------------------------------------------------------
for (const c of ["create", "list", "info", "kill", "exec", "connect", "upload", "download", "run"]) {
  add(`help ${c}`, [c, "--help"]);
  add(`help -h ${c}`, [c, "-h"]);
  add(`help sandbox ${c}`, ["sandbox", c, "--help"]);
}
add("help sandbox", ["sandbox", "--help"]);
add("help sandbox bare", ["sandbox"]);
add("help sandbox -h", ["sandbox", "-h"]);
add("help create json", ["--json", "create", "--help"]);

// ---- create --------------------------------------------------------------------------------------------------
add("create base", ["create", "--template", "base"]);
add("create base short -T", ["create", "-T", "base"]);
add("create base json", ["--json", "create", "--template", "base"]);
add("create base quiet", ["--quiet", "create", "--template", "base"]);
add("create base -q", ["-q", "create", "-T", "base"]);
add("create base CI", ["create", "-T", "base"], { env: { CI: "1" } });
add("create base verbose", ["-v", "create", "-T", "base"]);
add("create base sandbox spelling", ["sandbox", "create", "--template", "base"]);
add("create named template", ["create", "--template", "python-hello"]);
add("create envs", ["create", "-T", "base", "-e", "FOO=bar", "-e", "BAZ=a=b", "-e", "EMPTY="]);
add("create metadata", ["create", "-T", "base", "-m", "owner=test", "--metadata", "env=dev"]);
add("create env invalid", ["create", "-T", "base", "-e", "INVALID"]);
add("create env invalid json", ["--json", "create", "-T", "base", "-e", "INVALID"]);
add("create metadata invalid", ["create", "-T", "base", "-m", "x"]);
add("create env invalid no template", ["create", "-e", "INVALID"]);
add("create timeout flag", ["create", "-T", "base", "--timeout", "600"]);
add("create timeout short", ["create", "-T", "base", "-t", "42"]);
add("create timeout global", ["--timeout", "77", "create", "-T", "base"]);
add("create timeout invalid", ["create", "-T", "base", "-t", "abc"]);
add("create timeout 2**53+1", ["create", "-T", "base", "-t", "9007199254740993"]);
add("create timeout 20 digits", ["create", "-T", "base", "-t", "99999999999999999999"]);
add("create timeout -20 digits", ["create", "-T", "base", "-t", "-99999999999999999999"]);
add("create timeout zero", ["create", "-T", "base", "-t", "0"]);
add("create request-timeout", ["create", "-T", "base", "--request-timeout", "45"]);
add("create request-timeout float", ["create", "-T", "base", "--request-timeout", "1.5"]);
add("create request-timeout invalid", ["create", "-T", "base", "--request-timeout", "x"]);
add("create bare", ["create"]);
add("create bare json", ["--json", "create"]);
add("create description and template", ["create", "python", "--template", "custom"]);
add("create template then description", ["create", "--template", "base", "python"]);
add("create dir without description", ["create", "--template", "base", "--dir", "/tmp"]);
add("create -y template only", ["create", "-y", "-T", "base"]);
add("create region flag", ["create", "-T", "base", "--region", "cn-shanghai"]);
add("create unknown option", ["create", "-T", "base", "--nope"]);
add("create upload file", ["create", "-T", "base", "--upload", "app.txt"], {
  setup: (home, cwd) => write(cwd, "app.txt", "hello upload\n"),
});
add("create upload file json", ["--json", "create", "-T", "base", "-u", "app.txt"], {
  setup: (home, cwd) => write(cwd, "app.txt", "hello upload\n"),
});
add("create upload dir", ["create", "-T", "base", "-u", "proj"], {
  setup: (home, cwd) => {
    write(cwd, "proj/a.txt", "aaa");
    write(cwd, "proj/sub/b.txt", "bbb");
    write(cwd, "proj/sub/deeper/c.txt", "ccc");
    mkdirSync(join(cwd, "proj/empty"), { recursive: true });
  },
});
add("create upload dir quiet", ["--quiet", "create", "-T", "base", "-u", "proj"], {
  setup: (home, cwd) => write(cwd, "proj/a.txt", "aaa"),
});
add("create upload dir json", ["--json", "create", "-T", "base", "-u", "proj"], {
  setup: (home, cwd) => write(cwd, "proj/a.txt", "aaa"),
});
add("create upload empty dir", ["create", "-T", "base", "-u", "emptydir"], { setup: (home, cwd) => mkdirSync(join(cwd, "emptydir")) });
add("create upload missing", ["create", "-T", "base", "-u", "nope.txt"]);
add("create upload unicode", ["create", "-T", "base", "-u", "dir"], { setup: (home, cwd) => write(cwd, "dir/日本語.txt", "x") });
add("create platform 401", ["create", "-T", "base"], { platform: (req) => (req.method === "POST" ? json(401, { message: "Invalid API key" }) : undefined) });
add("create platform 404 template", ["create", "-T", "nope"], { platform: (req) => (req.method === "POST" ? json(404, { message: "template 'nope' not found" }) : undefined) });
add("create platform 429", ["create", "-T", "base"], { platform: (req) => (req.method === "POST" ? json(429, { message: "Quota exceeded" }) : undefined) });
add("create platform 500", ["create", "-T", "base"], { platform: (req) => (req.method === "POST" ? json(500, { message: "unavailable" }) : undefined) });
add("create platform 422", ["create", "-T", "base"], { platform: (req) => (req.method === "POST" ? json(422, { message: "bad" }) : undefined) });
add("create platform garbage", ["create", "-T", "base"], { platform: (req) => (req.method === "POST" ? raw(200, "application/json", "not json") : undefined) });
add("create platform reset", ["create", "-T", "base"], { platform: (req) => (req.method === "POST" ? RESET : undefined) });
add("create unreachable", ["create", "-T", "base"], { unreachable: true });
add("create no envd version", ["create", "-T", "base"], { platform: (req, ctx) => (req.method === "POST" ? json(201, sandboxJson(ctx.port, { envdVersion: undefined })) : undefined) });
add("create no envd url", ["create", "-T", "base"], { platform: (req, ctx) => (req.method === "POST" ? json(201, sandboxJson(ctx.port, { envdUrl: undefined })) : undefined) });
add("create upload write 500", ["create", "-T", "base", "-u", "app.txt"], {
  setup: (home, cwd) => write(cwd, "app.txt", "x"),
  files: { post: () => raw(500, "application/json", '{"message":"disk full"}') },
});
add("create no credentials", ["create", "-T", "base"], { creds: false });

// ---- create: natural-language path gates --------------------------------------------------------------------
const fakeQwen = (home, script = "#!/bin/sh\nexit 1\n") => {
  const p = write(home, ".abx/bin/qwen", script);
  chmodSync(p, 0o755);
};
add("create ai not installed", ["create", "a python data science env"]);
add("create ai not installed json", ["--json", "create", "a python data science env"]);
add("create ai not installed -y", ["create", "-y", "a python data science env"]);
add("create ai not installed quiet", ["--quiet", "create", "python"]);
add("create ai no credentials", ["create", "python env"], { setup: (home) => fakeQwen(home) });
add("create ai no credentials -y", ["create", "-y", "python env"], { setup: (home) => fakeQwen(home) });
add("create ai no credentials json", ["--json", "create", "-y", "python env"], { setup: (home) => fakeQwen(home) });
add("create ai non-tty gate (assessment unavailable)", ["create", "python env"], { setup: (home) => fakeQwen(home), env: { ABX_LLM_API_KEY: "k" } });
add("create ai -y generation fails", ["create", "-y", "python env"], { setup: (home) => fakeQwen(home), env: { ABX_LLM_API_KEY: "k" } });
add("create ai -y generation fails json", ["--json", "create", "-y", "python env"], { setup: (home) => fakeQwen(home), env: { ABX_LLM_API_KEY: "k" } });
add("create ai --dir file", ["create", "-y", "--dir", "afile", "python env"], { setup: (home, cwd) => write(cwd, "afile", "x"), env: { ABX_LLM_API_KEY: "k" } });
add("create ai --dir unwritable-parent", ["create", "-y", "--dir", "/proc/nope/sub", "python env"], { env: { ABX_LLM_API_KEY: "k" } });
add("create ai description with conflicting -T", ["create", "-y", "python", "-T", "custom"], { setup: (home) => fakeQwen(home) });

// ---- option/env precedence and timeouts (create) ----------------------------------------------------------------
const slowCreate = (ms) => (req, ctx) => (req.method === "POST" && req.url === "/sandboxes" ? { ...json(201, sandboxJson(ctx.port)), delay: ms } : undefined);
const cfgToml = (body) => (home) => write(home, ".abx/config.toml", body);
add("create region env", ["create", "-T", "base"], { env: { SANDBOX_REGION: "cn-shanghai" } });
add("create region flag beats env", ["create", "-T", "base", "--region", "cn-beijing"], { env: { SANDBOX_REGION: "cn-shanghai" } });
add("create region env invalid", ["create", "-T", "base"], { env: { SANDBOX_REGION: "mars-1" } });
add("create region flag invalid", ["create", "-T", "base", "--region", "mars-1"]);
add("create region dotenv", ["create", "-T", "base"], { setup: (h, cwd) => write(cwd, ".env", "SANDBOX_REGION=cn-shanghai\n") });
add("create region config toml", ["create", "-T", "base"], { setup: cfgToml('region = "cn-beijing"\n') });
add("create region env beats config", ["create", "-T", "base"], { setup: cfgToml('region = "cn-beijing"\n'), env: { SANDBOX_REGION: "cn-shanghai" } });
add("list region env", ["list"], { env: { SANDBOX_REGION: "cn-shanghai" } });
add("list region flag beats env", ["list", "-r", "cn-beijing"], { env: { SANDBOX_REGION: "cn-shanghai" } });
add("kill all region env", ["kill", "--all", "-y"], { env: { SANDBOX_REGION: "cn-shanghai" } });
add("create request-timeout hit", ["create", "-T", "base", "--request-timeout", "1"], { platform: slowCreate(2500) });
add("create request-timeout hit json", ["--json", "create", "-T", "base", "--request-timeout", "1"], { platform: slowCreate(2500) });
add("create request-timeout ok", ["create", "-T", "base", "--request-timeout", "5"], { platform: slowCreate(1500) });
add("create request-timeout zero", ["create", "-T", "base", "--request-timeout", "0"]);
add("create request-timeout negative", ["create", "-T", "base", "--request-timeout", "-1"]);
add("create request-timeout invalid", ["create", "-T", "base", "--request-timeout", "abc"]);
add("create floor beats small http_timeout", ["create", "-T", "base"], { platform: slowCreate(2500), env: { SANDBOX_HTTP_TIMEOUT: "1" } });
add("create floor beats small http_timeout toml", ["create", "-T", "base"], { platform: slowCreate(2500), setup: cfgToml("http_timeout = 1\n") });
add("create flag beats http_timeout", ["create", "-T", "base", "--request-timeout", "1"], { platform: slowCreate(2500), env: { SANDBOX_HTTP_TIMEOUT: "300" } });
add("create lifetime from global timeout", ["--timeout", "42", "create", "-T", "base"]);
add("create lifetime flag beats global", ["--timeout", "42", "create", "-T", "base", "-t", "7"]);
add("create lifetime zero", ["create", "-T", "base", "-t", "0"]);
add("create lifetime negative", ["create", "-T", "base", "-t", "-5"]);
add("create lifetime invalid", ["create", "-T", "base", "-t", "x"]);
add("create json quiet", ["--json", "--quiet", "create", "-T", "base"]);
add("create json verbose", ["--json", "--verbose", "create", "-T", "base"]);
add("create quiet verbose", ["--quiet", "-v", "create", "-T", "base"]);
add("list json quiet", ["--json", "--quiet", "list"]);
add("info json quiet", ["--json", "--quiet", "info", SBX]);
add("info json verbose", ["--json", "-v", "info", SBX]);
add("kill json quiet", ["--json", "--quiet", "kill", SBX, "-y"]);
add("exec json quiet", ["--json", "--quiet", "exec", SBX, "echo hi"], { start: () => proc({ out: ["hi\n"] }) });
add("exec json verbose nonzero", ["--json", "-v", "exec", SBX, "x"], { start: () => proc({ out: ["o\n"], code: 4 }) });

// ---- list ----------------------------------------------------------------------------------------------------
const two = (port) => [
  sandboxJson(port, { sandboxID: "sbx-1", templateID: "base" }),
  sandboxJson(port, { sandboxID: "sbx-2", templateID: "python-hello", state: "paused", metadata: { a: "b" } }),
];
add("list", ["list"]);
add("list sandbox spelling", ["sandbox", "list"]);
add("list json", ["--json", "list"]);
add("list quiet", ["--quiet", "list"]);
add("list CI", ["list"], { env: { CI: "true" } });
add("list status running", ["list", "--status", "running"]);
add("list status short", ["list", "-s", "paused"]);
add("list status invalid", ["list", "-s", "bogus"]);
add("list limit", ["list", "--limit", "5"]);
add("list limit short", ["list", "-l", "1"]);
add("list limit zero", ["list", "-l", "0"]);
add("list limit negative", ["list", "-l", "-3"]);
add("list limit invalid", ["list", "-l", "abc"]);
add("list limit float", ["list", "-l", "1.5"]);
add("list limit 2**53+1", ["list", "-l", "9007199254740993"]);
add("list limit 20 digits", ["list", "-l", "99999999999999999999"]);
add("list region", ["list", "--region", "cn-shanghai"]);
add("list region short", ["list", "-r", "cn-beijing"]);
add("list sandboxes", ["list"], { platform: (req, ctx) => (req.method === "GET" && /^\/(v2\/)?sandboxes(\?|$)/.test(req.url) ? json(200, two(ctx.port)) : undefined) });
add("list sandboxes json", ["--json", "list"], { platform: (req, ctx) => (req.method === "GET" && /^\/(v2\/)?sandboxes(\?|$)/.test(req.url) ? json(200, two(ctx.port)) : undefined) });
add("list sandboxes quiet", ["--quiet", "list"], { platform: (req, ctx) => (req.method === "GET" && /^\/(v2\/)?sandboxes(\?|$)/.test(req.url) ? json(200, two(ctx.port)) : undefined) });
add("list sandboxes limit", ["list", "-l", "1"], { platform: (req, ctx) => (req.method === "GET" && /^\/(v2\/)?sandboxes(\?|$)/.test(req.url) ? json(200, two(ctx.port)) : undefined) });
add("list sandboxes unicode", ["list"], {
  platform: (req, ctx) => (req.method === "GET" && /^\/(v2\/)?sandboxes(\?|$)/.test(req.url) ? json(200, [sandboxJson(ctx.port, { sandboxID: "沙箱-1", templateID: "模板" })]) : undefined),
});
add("list 401", ["list"], { platform: (req) => (req.method === "GET" ? json(401, { message: "Invalid API key" }) : undefined) });
add("list 500", ["list"], { platform: (req) => (req.method === "GET" ? json(500, { message: "boom" }) : undefined) });
add("list garbage", ["list"], { platform: (req) => (req.method === "GET" ? raw(200, "application/json", "nope") : undefined) });
add("list not array", ["list"], { platform: (req) => (req.method === "GET" ? json(200, { a: 1 }) : undefined) });
add("list reset", ["list"], { platform: (req) => (req.method === "GET" ? RESET : undefined) });
add("list unreachable", ["list"], { unreachable: true });
add("list no credentials", ["list"], { creds: false });

// ---- info ----------------------------------------------------------------------------------------------------
add("info", ["info", SBX]);
add("info sandbox spelling", ["sandbox", "info", SBX]);
add("info json", ["--json", "info", SBX]);
add("info quiet", ["--quiet", "info", SBX]);
add("info metadata", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { metadata: { owner: "me", n: "1" } })) : undefined) });
add("info metadata json", ["--json", "info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { metadata: { owner: "me" } })) : undefined) });
add("info no started", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { startedAt: undefined, envdVersion: undefined })) : undefined) });
add("info no url", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { envdUrl: undefined })) : undefined) });
add("info paused", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { state: "paused" })) : undefined) });
add("info 404", ["info", "sbx-missing"], { platform: (req) => (req.url.startsWith("/sandboxes/") ? json(404, { message: "sandbox not found" }) : undefined) });
add("info 401", ["info", SBX], { platform: (req) => (req.url.startsWith("/sandboxes/") ? json(401, { message: "Invalid API key" }) : undefined) });
add("info 500", ["info", SBX], { platform: (req) => (req.url.startsWith("/sandboxes/") ? json(500, { message: "x" }) : undefined) });
add("info garbage", ["info", SBX], { platform: (req) => (req.url.startsWith("/sandboxes/") ? raw(200, "application/json", "x") : undefined) });
add("info missing id", ["info"]);
add("info extra arg", ["info", SBX, "extra"]);
add("info nested metadata", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { metadata: { a: { b: [1, 2, { c: null }] }, t: true, f: 1.5, n: null } })) : undefined) });
add("info nested metadata json", ["--json", "info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { metadata: { a: { b: [1, 2, { c: null }] }, t: true, f: 1.5, n: null, u: "日本\u00e9" } })) : undefined) });
add("info unicode template", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { templateID: "tmpl-日本", metadata: { k: "é" } })) : undefined) });
add("info started fractional", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { startedAt: "2026-01-01T00:00:00.123456Z" })) : undefined) });
add("info started offset", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { startedAt: "2026-01-01T08:00:00+08:00" })) : undefined) });
add("info started invalid", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { startedAt: "yesterday" })) : undefined) });
add("info started invalid json", ["--json", "info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { startedAt: "yesterday" })) : undefined) });
add("info end before start", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { endAt: "2025-01-01T00:00:00Z" })) : undefined) });
add("info large resources", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { cpuCount: 128, memoryMB: 1048576 })) : undefined) });
add("info zero resources", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { cpuCount: 0, memoryMB: 0 })) : undefined) });
add("info null fields", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { cpuCount: null, memoryMB: null, templateID: null, metadata: null })) : undefined) });
add("info unknown state", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { state: "weird" })) : undefined) });
add("info alias", ["info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { alias: "my-alias" })) : undefined) });
add("info json verbose", ["-v", "--json", "info", SBX], { platform: (req, ctx) => (req.url.startsWith(`/sandboxes/${SBX}`) ? json(200, sandboxJson(ctx.port, { metadata: { x: "1" } })) : undefined) });
add("info invalid id chars", ["info", "a b/c"]);
add("info empty id", ["info", ""]);
add("info unicode id", ["info", "sbx-日本"]);
add("info unreachable", ["info", SBX], { unreachable: true });
add("info no credentials", ["info", SBX], { creds: false });

// ---- kill ----------------------------------------------------------------------------------------------------
add("kill yes", ["kill", SBX, "--yes"]);
add("kill -y", ["kill", SBX, "-y"]);
add("kill sandbox spelling", ["sandbox", "kill", SBX, "-y"]);
add("kill yes json", ["--json", "kill", SBX, "-y"]);
add("kill yes quiet", ["--quiet", "kill", SBX, "-y"]);
add("kill confirm y", ["kill", SBX], { input: "y\n" });
add("kill confirm yes", ["kill", SBX], { input: "yes\n" });
add("kill confirm n", ["kill", SBX], { input: "n\n" });
add("kill confirm empty", ["kill", SBX], { input: "\n" });
add("kill confirm eof", ["kill", SBX], { input: "" });
add("kill confirm invalid then y", ["kill", SBX], { input: "maybe\ny\n" });
add("kill confirm json", ["--json", "kill", SBX], { input: "y\n" });
add("kill no id", ["kill", "--yes"]);
add("kill no id no yes", ["kill"]);
add("kill id and --all", ["kill", SBX, "--all", "-y"]);
add("kill 404", ["kill", "sbx-missing", "-y"], { platform: (req) => (req.url.startsWith("/sandboxes/") ? json(404, { message: "sandbox not found" }) : undefined) });
add("kill delete 500", ["kill", SBX, "-y"], { platform: (req) => (req.method === "DELETE" ? json(500, { message: "x" }) : undefined) });
add("kill 401", ["kill", SBX, "-y"], { platform: (req) => (req.url.startsWith("/sandboxes/") ? json(401, { message: "no" }) : undefined) });
add("kill unreachable", ["kill", SBX, "-y"], { unreachable: true });
add("kill all empty", ["kill", "--all", "--yes"]);
add("kill all empty json", ["--json", "kill", "--all", "-y"]);
add("kill all empty no yes", ["kill", "--all"]);
const listRunning = (port) => [sandboxJson(port, { sandboxID: "sbx-1" }), sandboxJson(port, { sandboxID: "sbx-2" })];
const isList = (req) => req.method === "GET" && /^\/(v2\/)?sandboxes(\?|$)/.test(req.url);
add("kill all yes", ["kill", "--all", "-y"], { platform: (req, ctx) => (isList(req) ? json(200, listRunning(ctx.port)) : undefined) });
add("kill all yes json", ["--json", "kill", "--all", "-y"], { platform: (req, ctx) => (isList(req) ? json(200, listRunning(ctx.port)) : undefined) });
add("kill all yes quiet", ["--quiet", "kill", "--all", "-y"], { platform: (req, ctx) => (isList(req) ? json(200, listRunning(ctx.port)) : undefined) });
add("kill all no yes non-tty", ["kill", "--all"], { platform: (req, ctx) => (isList(req) ? json(200, listRunning(ctx.port)) : undefined) });
add("kill all no yes non-tty json", ["--json", "kill", "--all"], { platform: (req, ctx) => (isList(req) ? json(200, listRunning(ctx.port)) : undefined) });
add("kill all partial failure", ["kill", "--all", "-y"], {
  platform: (req, ctx) => (isList(req) ? json(200, listRunning(ctx.port)) : req.method === "DELETE" && req.url.startsWith("/sandboxes/sbx-1") ? json(500, { message: "x" }) : undefined),
});
add("kill all all failed", ["kill", "--all", "-y"], {
  platform: (req, ctx) => (isList(req) ? json(200, listRunning(ctx.port)) : req.method === "DELETE" ? json(404, { message: "gone" }) : undefined),
});
add("kill all list 401", ["kill", "--all", "-y"], { platform: (req) => (isList(req) ? json(401, { message: "no" }) : undefined) });
add("kill all region", ["kill", "--all", "-y", "--region", "cn-shanghai"]);
const killFail = (resp) => (req, ctx) => (isList(req) ? json(200, listRunning(ctx.port)) : req.method === "DELETE" && req.url.startsWith("/sandboxes/sbx-1") ? resp() : undefined);
for (const [label, resp] of [
  ["401", () => json(401, { message: "no" })],
  ["403", () => json(403, { message: "forbidden" })],
  ["404", () => json(404, { message: "gone" })],
  ["409", () => json(409, { message: "conflict" })],
  ["429", () => json(429, { message: "slow down" })],
  ["502", () => raw(502, "text/html", "<html>bad gateway</html>")],
  ["reset", () => RESET],
  ["garbage 200", () => raw(200, "application/json", "garbage")],
]) {
  add(`kill all first ${label}`, ["kill", "--all", "-y"], { platform: killFail(resp) });
  add(`kill all first ${label} json`, ["--json", "kill", "--all", "-y"], { platform: killFail(resp) });
}
add("kill all partial quiet", ["--quiet", "kill", "--all", "-y"], { platform: killFail(() => json(500, { message: "x" })) });
add("kill all list reset", ["kill", "--all", "-y"], { platform: (req) => (isList(req) ? RESET : undefined) });
add("kill all list garbage", ["kill", "--all", "-y"], { platform: (req) => (isList(req) ? raw(200, "application/json", "nope") : undefined) });
add("kill all list not array", ["kill", "--all", "-y"], { platform: (req) => (isList(req) ? json(200, { a: 1 }) : undefined) });
add("kill all unicode id", ["kill", "--all", "-y"], { platform: (req, ctx) => (isList(req) ? json(200, [sandboxJson(ctx.port, { sandboxID: "sbx-日本" })]) : undefined) });
add("kill all many", ["kill", "--all", "-y"], { platform: (req, ctx) => (isList(req) ? json(200, Array.from({ length: 12 }, (_, i) => sandboxJson(ctx.port, { sandboxID: `sbx-${i}` }))) : undefined) });
add("kill invalid id chars", ["kill", "a b/../c", "-y"]);
add("kill empty id", ["kill", "", "-y"]);
add("kill unicode id", ["kill", "sbx-日本", "-y"]);
add("kill id with dashes dash-y", ["kill", "--", "-weird", "-y"]);

// ---- exec ----------------------------------------------------------------------------------------------------
add("exec echo", ["exec", SBX, "echo hello"], { start: () => proc({ out: ["hello\n"] }) });
add("exec sandbox spelling", ["sandbox", "exec", SBX, "echo hi"], { start: () => proc({ out: ["hi\n"] }) });
add("exec json", ["--json", "exec", SBX, "echo hi"], { start: () => proc({ out: ["hi\n"] }) });
add("exec quiet", ["--quiet", "exec", SBX, "echo hi"], { start: () => proc({ out: ["hi\n"], err: ["warn\n"] }) });
add("exec stderr", ["exec", SBX, "x"], { start: () => proc({ out: ["out\n"], err: ["err\n"] }) });
add("exec no trailing newline", ["exec", SBX, "x"], { start: () => proc({ out: ["partial"] }) });
add("exec empty output", ["exec", SBX, "true"], { start: () => proc({}) });
add("exec nonzero", ["exec", SBX, "false"], { start: () => proc({ code: 1 }) });
add("exec nonzero with output", ["exec", SBX, "x"], { start: () => proc({ out: ["o\n"], err: ["e\n"], code: 3 }) });
add("exec nonzero json", ["--json", "exec", SBX, "x"], { start: () => proc({ out: ["o\n"], code: 2 }) });
add("exec exit 255", ["exec", SBX, "x"], { start: () => proc({ code: 255 }) });
add("exec exit 130", ["exec", SBX, "x"], { start: () => proc({ code: 130 }) });
add("exec unicode", ["exec", SBX, "echo é"], { start: () => proc({ out: ["é 日本語\n"] }) });
add("exec chunked", ["exec", SBX, "x"], { start: () => proc({ out: ["a", "b\nc", "\n"], err: ["1", "2"] }) });
add("exec crlf", ["exec", SBX, "x"], { start: () => proc({ out: ["a\r\nb\r\n"] }) });
add("exec timeout flag", ["exec", SBX, "x", "--timeout", "5"], { start: () => proc({ out: ["x\n"] }) });
add("exec timeout short", ["exec", SBX, "x", "-t", "7"], { start: () => proc({ out: ["x\n"] }) });
add("exec timeout invalid", ["exec", SBX, "x", "-t", "abc"]);
add("exec timeout 2**53+1", ["exec", SBX, "x", "-t", "9007199254740993"], { start: () => proc({ out: ["x\n"] }) });
add("exec timeout 20 digits", ["exec", SBX, "x", "-t", "99999999999999999999"], { start: () => proc({ out: ["x\n"] }) });
add("exec timeout zero", ["exec", SBX, "x", "-t", "0"], { start: () => proc({ out: ["x\n"] }) });
add("exec timeout negative", ["exec", SBX, "x", "-t", "-1"], { start: () => proc({ out: ["x\n"] }) });
add("exec cwd", ["exec", SBX, "pwd", "--cwd", "/tmp"], { start: () => proc({ out: ["/tmp\n"] }) });
add("exec verbose", ["exec", SBX, "echo", "-v"], { start: () => proc({ out: ["x\n"] }) });
add("exec verbose long", ["exec", SBX, "echo", "--verbose"], { start: () => proc({ out: ["x\n"] }) });
add("exec global verbose", ["-v", "exec", SBX, "echo"], { start: () => proc({ out: ["x\n"] }) });
add("exec missing command", ["exec", SBX]);
add("exec missing all", ["exec"]);
add("exec command with options", ["exec", SBX, "ls -la /tmp"], { start: () => proc({ out: ["x\n"] }) });
add("exec no end event", ["exec", SBX, "x"], { start: () => proc({ out: ["x\n"], noEnd: true }) });
add("exec start 500", ["exec", SBX, "nope"], { start: () => json(500, { code: "unknown", message: 'exec: "nope": executable file not found in $PATH' }) });
add("exec start 404", ["exec", SBX, "x"], { start: () => json(404, { code: "not_found", message: "no" }) });
add("exec start 401", ["exec", SBX, "x"], { start: () => json(401, { message: "no" }) });
add("exec start 429", ["exec", SBX, "x"], { start: () => json(429, { message: "slow" }) });
add("exec start 503", ["exec", SBX, "x"], { start: () => json(503, { message: "unavailable" }) });
add("exec start reset", ["exec", SBX, "x"], { start: () => RESET });
add("exec start garbage", ["exec", SBX, "x"], { start: () => raw(200, "application/connect+json", "garbage") });
add("exec platform 404", ["exec", "sbx-missing", "x"], { platform: (req) => (req.url.startsWith("/sandboxes/") ? json(404, { message: "sandbox not found" }) : undefined) });
add("exec platform 401", ["exec", SBX, "x"], { platform: (req) => (req.url.startsWith("/sandboxes/") ? json(401, { message: "no" }) : undefined) });
add("exec unreachable", ["exec", SBX, "x"], { unreachable: true });
add("exec no credentials", ["exec", SBX, "x"], { creds: false });

// ---- connect -------------------------------------------------------------------------------------------------
add("connect exit", ["connect", SBX], { input: "exit\n" });
add("connect sandbox spelling", ["sandbox", "connect", SBX], { input: "exit\n" });
add("connect quit", ["connect", SBX], { input: "quit\n" });
add("connect eof", ["connect", SBX], { input: "" });
add("connect blank lines then exit", ["connect", SBX], { input: "\n   \n\nexit\n" });
add("connect run command", ["connect", SBX], { input: "echo hello\nexit\n", start: () => proc({ out: ["hello world\n"] }) });
add("connect run stderr", ["connect", SBX], { input: "x\nexit\n", start: () => proc({ out: ["o"], err: ["e\n"] }) });
add("connect run multiple", ["connect", SBX], { input: "ls\npwd\nexit\n", start: (c) => proc({ out: [c.includes("pwd") ? "/home/user\n" : "a.txt\n"] }) });
add("connect command not found", ["connect", SBX], { input: "sl -la\nexit\n", start: () => json(500, { code: "unknown", message: 'exec: "sl": executable file not found in $PATH' }) });
add("connect hint after known", ["connect", SBX], {
  input: "ls /app\nsl\nexit\n",
  start: (c) => (c.includes("ls") ? proc({ out: ["app.py\n"] }) : json(500, { code: "unknown", message: 'exec: "sl": executable file not found in $PATH' })),
});
add("connect failure 503", ["connect", SBX], { input: "x\nexit\n", start: () => json(503, { message: "unavailable" }) });
add("connect failure 401", ["connect", SBX], { input: "x\nexit\n", start: () => json(401, { message: "no" }) });
add("connect failure reset", ["connect", SBX], { input: "x\nexit\n", start: () => RESET });
add("connect nonzero exit continues", ["connect", SBX], { input: "false\nexit\n", start: () => proc({ code: 1 }) });
add("connect exit 127", ["connect", SBX], { input: "nosuch\nexit\n", start: () => proc({ err: ["sh: nosuch: not found\n"], code: 127 }) });
add("connect unicode", ["connect", SBX], { input: "echo é\nexit\n", start: () => proc({ out: ["é\n"] }) });
add("connect no trailing newline", ["connect", SBX], { input: "echo a" , start: () => proc({ out: ["a\n"] }) });
add("connect long id", ["connect", "sbx-0123456789abcdef"], { input: "exit\n", platform: (req, ctx) => (req.url.startsWith("/sandboxes/") ? json(200, sandboxJson(ctx.port, { sandboxID: "sbx-0123456789abcdef" })) : undefined) });
add("connect platform 404", ["connect", "sbx-missing"], { input: "exit\n", platform: (req) => (req.url.startsWith("/sandboxes/") ? json(404, { message: "sandbox not found" }) : undefined) });
add("connect missing id", ["connect"]);
add("connect unreachable", ["connect", SBX], { input: "exit\n", unreachable: true });
add("connect json", ["--json", "connect", SBX], { input: "echo a\nexit\n", start: () => proc({ out: ["a\n"] }) });
add("connect quiet", ["--quiet", "connect", SBX], { input: "echo a\nexit\n", start: () => proc({ out: ["a\n"] }) });

// connect on a terminal (line editing)
const PROMPT = "abx:sbx-stub> ";
add("tty connect exit", ["connect", SBX], { tty: [{ expect: PROMPT, send: "exit\n" }] });
add("tty connect eof", ["connect", SBX], { tty: [{ expect: PROMPT, send: "\x04" }] });
add("tty connect ctrl-c then exit", ["connect", SBX], { tty: [{ expect: PROMPT, send: "\x03" }, { expect: "", delay: 0.6, send: "exit\n" }] });
add("tty connect ctrl-c twice", ["connect", SBX], { tty: [{ expect: PROMPT, send: "\x03" }, { expect: "", delay: 0.6, send: "\x03" }] });
add("tty connect ctrl-c then command", ["connect", SBX], { tty: [{ expect: PROMPT, send: "\x03" }, { expect: "", delay: 0.6, send: "echo hi\n" }], start: () => proc({ out: ["hi\n"] }) });
add("tty connect command then exit", ["connect", SBX], { tty: [{ expect: PROMPT, send: "echo hi\n" }, { expect: "hi", send: "exit\n" }], start: () => proc({ out: ["hi\n"] }) });

// ---- upload --------------------------------------------------------------------------------------------------
const fileSetup = (home, cwd) => {
  write(cwd, "script.py", "print('hello')\n");
  write(cwd, "tree/a.txt", "aaa");
  write(cwd, "tree/sub/b.txt", "bbb");
  write(cwd, "tree/sub/deep/c.txt", "ccc");
  mkdirSync(join(cwd, "tree/emptydir"), { recursive: true });
  mkdirSync(join(cwd, "emptyroot"), { recursive: true });
  write(cwd, "bin.dat", Buffer.from([0, 1, 2, 255, 254, 0]));
  write(cwd, "日本語.txt", "unicode name");
};
add("upload file", ["upload", SBX, "script.py", "/app/script.py"], { setup: fileSetup });
add("upload sandbox spelling", ["sandbox", "upload", SBX, "script.py", "/app/script.py"], { setup: fileSetup });
add("upload file json", ["--json", "upload", SBX, "script.py", "/app/script.py"], { setup: fileSetup });
add("upload file quiet", ["--quiet", "upload", SBX, "script.py", "/app/script.py"], { setup: fileSetup });
add("upload file to dir path", ["upload", SBX, "script.py", "/app/"], { setup: fileSetup });
add("upload binary", ["upload", SBX, "bin.dat", "/tmp/bin.dat"], { setup: fileSetup });
add("upload unicode name", ["upload", SBX, "日本語.txt", "/tmp/日本語.txt"], { setup: fileSetup });
add("upload dir", ["upload", SBX, "tree", "/app/data"], { setup: fileSetup });
add("upload dir trailing slash remote", ["upload", SBX, "tree", "/app/data/"], { setup: fileSetup });
add("upload dir json", ["--json", "upload", SBX, "tree", "/app/data"], { setup: fileSetup });
add("upload dir quiet", ["--quiet", "upload", SBX, "tree", "/app/data"], { setup: fileSetup });
add("upload dir absolute", ["upload", SBX, "@cwd@/tree", "/x"], { setup: fileSetup });
add("upload empty dir", ["upload", SBX, "emptyroot", "/app"], { setup: fileSetup });
const manyTree = (home, cwd) => {
  for (let i = 0; i < 40; i++) write(cwd, `many/f${(i * 7919) % 97}.txt`, `file ${i}`);
  for (const d of ["zeta", "alpha", "Mid", "_u", "beta"]) for (const f of ["z.txt", "a.txt", "B.txt"]) write(cwd, `many/${d}/${f}`, `${d}/${f}`);
  write(cwd, "many/.hidden", "h");
  write(cwd, "many/.hdir/inner.txt", "hi");
};
add("upload many files raw order", ["upload", SBX, "many", "/app/many"], { setup: manyTree });
add("create upload many files raw order", ["create", "-T", "base", "-u", "many"], { setup: manyTree });
add("upload hidden only", ["upload", SBX, "hid", "/app/hid"], { setup: (h, cwd) => write(cwd, "hid/.env.x", "k") });
const linkTree = (home, cwd) => {
  write(cwd, "lt/real.txt", "real");
  write(cwd, "lt/realdir/in.txt", "in");
  symlinkSync("real.txt", join(cwd, "lt/link_file"));
  symlinkSync("realdir", join(cwd, "lt/link_dir"));
  symlinkSync("missing-target", join(cwd, "lt/link_broken"));
};
add("upload symlink tree", ["upload", SBX, "lt", "/app/lt"], { setup: linkTree });
add("upload symlink file arg", ["upload", SBX, "lt/link_file", "/app/l"], { setup: linkTree });
add("upload broken symlink arg", ["upload", SBX, "lt/link_broken", "/app/l"], { setup: linkTree });
add("upload symlink dir arg", ["upload", SBX, "lt/link_dir", "/app/ld"], { setup: linkTree });
add("create upload symlink tree", ["create", "-T", "base", "-u", "lt"], { setup: linkTree });
add("upload all bytes", ["upload", SBX, "all.bin", "/tmp/all.bin"], { setup: (h, cwd) => write(cwd, "all.bin", Buffer.from(Array.from({ length: 256 }, (_, i) => i))) });
add("upload large 3MB", ["upload", SBX, "big.bin", "/tmp/big.bin"], { setup: (h, cwd) => write(cwd, "big.bin", Buffer.alloc(3 * 1024 * 1024, 0xab)) });
add("upload empty file", ["upload", SBX, "empty.txt", "/tmp/e"], { setup: (h, cwd) => write(cwd, "empty.txt", "") });
add("upload dot", ["upload", SBX, ".", "/app/dot"], { setup: (h, cwd) => write(cwd, "d1.txt", "x") });
add("upload remote root", ["upload", SBX, "script.py", "/"], { setup: fileSetup });
add("upload remote relative", ["upload", SBX, "script.py", "rel/x.py"], { setup: fileSetup });
add("upload dir remote relative", ["upload", SBX, "tree", "rel"], { setup: fileSetup });
add("upload dir remote root", ["upload", SBX, "tree", "/"], { setup: fileSetup });
add("upload unreadable file", ["upload", SBX, "secret.txt", "/app/s"], { setup: (h, cwd) => { write(cwd, "secret.txt", "s"); chmodSync(join(cwd, "secret.txt"), 0); } });
add("upload unreadable file in dir", ["upload", SBX, "ud", "/app/ud"], { setup: (h, cwd) => { write(cwd, "ud/ok.txt", "o"); write(cwd, "ud/secret.txt", "s"); chmodSync(join(cwd, "ud/secret.txt"), 0); } });
add("upload unreadable subdir", ["upload", SBX, "ud2", "/app/ud2"], { setup: (h, cwd) => { write(cwd, "ud2/ok.txt", "o"); write(cwd, "ud2/sd/in.txt", "s"); chmodSync(join(cwd, "ud2/sd"), 0); } });
add("upload write fails midway", ["upload", SBX, "tree", "/app/data"], { setup: fileSetup, files: { post: (r) => (r.url.includes("sub%2Fb.txt") || r.url.includes("sub/b.txt") ? raw(500, "application/json", '{"message":"boom"}') : { status: 201, type: "application/json", body: Buffer.from("[]") }) } });
add("upload local missing", ["upload", SBX, "nope.py", "/app/x"]);
add("upload missing args", ["upload", SBX, "script.py"], { setup: fileSetup });
add("upload write 500", ["upload", SBX, "script.py", "/app/x"], { setup: fileSetup, files: { post: () => raw(500, "application/json", '{"message":"disk full"}') } });
add("upload write 401", ["upload", SBX, "script.py", "/app/x"], { setup: fileSetup, files: { post: () => raw(401, "application/json", '{"message":"no"}') } });
add("upload write 404", ["upload", SBX, "script.py", "/app/x"], { setup: fileSetup, files: { post: () => raw(404, "application/json", '{"message":"no"}') } });
add("upload write reset", ["upload", SBX, "script.py", "/app/x"], { setup: fileSetup, files: { post: () => RESET } });
add("upload platform 404", ["upload", "sbx-missing", "script.py", "/app/x"], { setup: fileSetup, platform: (req) => (req.url.startsWith("/sandboxes/") ? json(404, { message: "no" }) : undefined) });
add("upload unreachable", ["upload", SBX, "script.py", "/x"], { setup: fileSetup, unreachable: true });

// ---- download ------------------------------------------------------------------------------------------------
const FILES = { "/app/result.csv": Buffer.from("a,b\n1,2\n"), "/app/output.log": Buffer.from("log-data"), "/app/bin": Buffer.from([0, 255, 1, 2]), "/app/日本語.txt": Buffer.from("u") };
const dl = (extra = {}) => ({ files: { get: (path) => (FILES[path] ? { status: 200, type: "application/octet-stream", body: FILES[path] } : json(404, { code: "not_found", message: "file not found" })) }, ...extra });
add("download file", ["download", SBX, "/app/result.csv", "out.csv"], { ...dl(), artifacts: ["cwd:out.csv"] });
add("download sandbox spelling", ["sandbox", "download", SBX, "/app/result.csv", "out.csv"], { ...dl(), artifacts: ["cwd:out.csv"] });
add("download json", ["--json", "download", SBX, "/app/result.csv", "out.csv"], { ...dl(), artifacts: ["cwd:out.csv"] });
add("download quiet", ["--quiet", "download", SBX, "/app/result.csv", "out.csv"], { ...dl(), artifacts: ["cwd:out.csv"] });
add("download to directory", ["download", SBX, "/app/output.log", "dest"], { ...dl(), setup: (h, cwd) => mkdirSync(join(cwd, "dest")), artifacts: ["cwd:dest/output.log"] });
add("download to dot", ["download", SBX, "/app/output.log", "."], { ...dl(), artifacts: ["cwd:output.log"] });
add("download creates parents", ["download", SBX, "/app/result.csv", "deep/nested/file.csv"], { ...dl(), artifacts: ["cwd:deep/nested/file.csv"] });
add("download binary", ["download", SBX, "/app/bin", "bin.out"], { ...dl(), artifacts: ["cwd:bin.out"] });
add("download unicode remote", ["download", SBX, "/app/日本語.txt", "u.txt"], { ...dl(), artifacts: ["cwd:u.txt"] });
add("download overwrite", ["download", SBX, "/app/result.csv", "out.csv"], { ...dl(), setup: (h, cwd) => write(cwd, "out.csv", "old"), artifacts: ["cwd:out.csv"] });
add("download remote 404", ["download", SBX, "/app/missing", "out"], { ...dl(), artifacts: ["cwd:out"] });
add("download remote 500", ["download", SBX, "/app/result.csv", "out"], { files: { get: () => raw(500, "application/json", '{"message":"x"}') }, artifacts: ["cwd:out"] });
add("download remote 401", ["download", SBX, "/app/result.csv", "out"], { files: { get: () => raw(401, "application/json", '{"message":"x"}') }, artifacts: ["cwd:out"] });
add("download reset", ["download", SBX, "/app/result.csv", "out"], { files: { get: () => RESET }, artifacts: ["cwd:out"] });
add("download local under file", ["download", SBX, "/app/result.csv", "afile/sub.csv"], { ...dl(), setup: (h, cwd) => write(cwd, "afile", "x") });
add("download missing args", ["download", SBX, "/app/result.csv"], dl());
const BIGDL = Buffer.alloc(3 * 1024 * 1024, 0xcd);
const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
const dl2 = (extra = {}) => ({ files: { get: (path) => ({ "/big": { status: 200, type: "application/octet-stream", body: BIGDL }, "/all": { status: 200, type: "application/octet-stream", body: allBytes }, "/empty": { status: 200, type: "application/octet-stream", body: Buffer.alloc(0) }, "/app/dir/": { status: 200, type: "application/octet-stream", body: Buffer.from("d") } })[path] ?? json(404, { code: "not_found", message: "file not found" }) }, ...extra });
add("download large 3MB", ["download", SBX, "/big", "big.out"], { ...dl2(), artifacts: ["cwd:big.out"] });
add("download all bytes", ["download", SBX, "/all", "all.out"], { ...dl2(), artifacts: ["cwd:all.out"] });
add("download empty", ["download", SBX, "/empty", "e.out"], { ...dl2(), artifacts: ["cwd:e.out"] });
add("download remote trailing slash", ["download", SBX, "/app/dir/", "d.out"], { ...dl2(), artifacts: ["cwd:d.out"] });
add("download remote relative", ["download", SBX, "app/result.csv", "r.out"], { ...dl(), artifacts: ["cwd:r.out"] });
add("download remote root", ["download", SBX, "/", "root.out"], { ...dl(), artifacts: ["cwd:root.out"] });
add("download local trailing slash new", ["download", SBX, "/app/result.csv", "newdir/"], { ...dl(), artifacts: ["cwd:newdir"] });
add("download local trailing slash existing", ["download", SBX, "/app/result.csv", "exdir/"], { ...dl(), setup: (h, cwd) => mkdirSync(join(cwd, "exdir")), artifacts: ["cwd:exdir"] });
add("download to existing dir no slash", ["download", SBX, "/app/result.csv", "exdir"], { ...dl(), setup: (h, cwd) => mkdirSync(join(cwd, "exdir")), artifacts: ["cwd:exdir"] });
add("download to readonly dir", ["download", SBX, "/app/result.csv", "ro/out.csv"], { ...dl(), setup: (h, cwd) => { mkdirSync(join(cwd, "ro")); chmodSync(join(cwd, "ro"), 0o500); } });
add("download overwrite readonly file", ["download", SBX, "/app/result.csv", "rof.csv"], { ...dl(), setup: (h, cwd) => { write(cwd, "rof.csv", "old"); chmodSync(join(cwd, "rof.csv"), 0o400); }, artifacts: ["cwd:rof.csv"] });
add("download absolute local", ["download", SBX, "/app/result.csv", "@cwd@/abs.csv"], { ...dl(), artifacts: ["cwd:abs.csv"] });
add("download symlink dest", ["download", SBX, "/app/result.csv", "lnk"], { ...dl(), setup: (h, cwd) => symlinkSync("target.txt", join(cwd, "lnk")), artifacts: ["cwd:target.txt"] });
add("download json quiet", ["--json", "--quiet", "download", SBX, "/app/result.csv", "o.csv"], { ...dl(), artifacts: ["cwd:o.csv"] });
add("download 403", ["download", SBX, "/app/result.csv", "out"], { files: { get: () => raw(403, "application/json", '{"message":"x"}') }, artifacts: ["cwd:out"] });
add("download 429", ["download", SBX, "/app/result.csv", "out"], { files: { get: () => raw(429, "application/json", '{"message":"x"}') }, artifacts: ["cwd:out"] });
add("download 502 html", ["download", SBX, "/app/result.csv", "out"], { files: { get: () => raw(502, "text/html", "<html>x</html>") }, artifacts: ["cwd:out"] });
add("download invalid id chars", ["download", "a b/c", "/app/x", "out"]);
add("download platform 404", ["download", "sbx-missing", "/app/x", "out"], { platform: (req) => (req.url.startsWith("/sandboxes/") ? json(404, { message: "no" }) : undefined) });
add("download unreachable", ["download", SBX, "/app/x", "out"], { unreachable: true });

// ---- run -----------------------------------------------------------------------------------------------------
add("run template command", ["run", SBX, "build"]);
add("run sandbox spelling", ["sandbox", "run", SBX, "build"]);
add("run json", ["--json", "run", SBX, "build"]);
add("run --arg", ["run", SBX, "deploy", "--arg", "target=staging"]);
add("run -a", ["run", SBX, "deploy", "-a", "t=s=1", "-a", "u=v"]);
add("run --arg bad", ["run", SBX, "build", "--arg", "badformat"]);
add("run extra --key value", ["run", SBX, "build", "--x", "1", "--y", "hi"]);
add("run extra --key=value", ["run", SBX, "build", "--x=1"]);
add("run extra flag", ["run", SBX, "build", "--force"]);
add("run extra positional", ["run", SBX, "build", "stray"]);
add("run server_port", ["run", SBX, "build", "--server_port", "9100"]);
add("run server_port invalid", ["run", SBX, "build", "--server_port", "abc"]);
add("run help passthrough -h", ["run", SBX, "build", "-h"]);
add("run missing command", ["run", SBX]);
add("run platform 404", ["run", "sbx-missing", "build"], { platform: (req) => (req.url.startsWith("/sandboxes/") ? json(404, { message: "no" }) : undefined) });
add("run unreachable", ["run", SBX, "build"], { unreachable: true });

// ---- scripted Qwen Code agent ---------------------------------------------------------------------------------
// A shell stand-in for the `qwen` CLI: classifies each invocation (research / assess / generate), logs its argv, prompt
// checksum and credential env to $HOME/qlog (compared between the oracle and the port) and answers from $HOME/qcfg.
const AGENT_SCRIPT = `#!/bin/sh
cfg="$HOME/qcfg"
prompt="$1"
kind=gen
for a in "$@"; do [ "$a" = "--json-schema" ] && kind=assess; done
case "$prompt" in *可公开查证*) [ "$kind" = gen ] && kind=research;; esac
i=0; skip=0; shown=""
for a in "$@"; do
  i=$((i+1)); [ $i -eq 1 ] && continue
  if [ $skip -eq 1 ]; then skip=0; shown="$shown <schema>"; continue; fi
  [ "$a" = "--json-schema" ] && skip=1
  shown="$shown $a"
done
sum=-
[ "$kind" != gen ] && sum=$(printf %s "$prompt" | cksum | cut -d' ' -f1)
echo "$kind argv:$shown prompt=$sum key=\${OPENAI_API_KEY:+set} base=$OPENAI_BASE_URL model=$OPENAI_MODEL cwd=$(basename "$PWD")" >> "$HOME/qlog"
n=$(cat "$cfg/n.$kind" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$cfg/n.$kind"
reply() { printf '[{"type":"result","subtype":"success","is_error":false,"result":"%s","session_id":"00000000-0000-4000-8000-000000000000"%s}]\\n' "$1" "$2"; }
case "$kind" in
  research)
    [ "$(cat "$cfg/research" 2>/dev/null)" = fail ] && { echo "boom" >&2; exit 1; }
    reply facts ""
    ;;
  assess)
    f="$cfg/assess.$n"
    [ -f "$f" ] || f="$cfg/assess.last"
    [ -f "$f" ] || exit 1
    [ "$(cat "$f")" = fail ] && exit 1
    reply assessed ",\\"structured_result\\":$(cat "$f")"
    ;;
  gen)
    mode=$(cat "$cfg/gen" 2>/dev/null)
    [ "$mode" = nofiles ] && { reply nothing ""; exit 0; }
    printf 'FROM python:3.12-slim\\nCOPY commands.py .\\nCMD ["python3", "commands.py"]\\n' > Dockerfile
    printf 'from agent_sandbox.server import SandboxServer\\nSandboxServer().serve(port=9000)\\n' > commands.py
    printf 'name: whatever\\ndescription: demo\\n' > template.yaml
    reply generated ""
    ;;
esac
`;
/** Install the scripted agent; assess = payload objects (or "fail") answered in order, the last one repeats. */
const agent = (home, { assess = [], research = "ok", gen = "ok" } = {}) => {
  const p = write(home, ".abx/bin/qwen", AGENT_SCRIPT);
  chmodSync(p, 0o755);
  write(home, "qcfg/research", research);
  write(home, "qcfg/gen", gen);
  assess.forEach((a, i) => write(home, `qcfg/assess.${i + 1}`, typeof a === "string" ? a : JSON.stringify(a)));
  if (assess.length) write(home, "qcfg/assess.last", typeof assess.at(-1) === "string" ? assess.at(-1) : JSON.stringify(assess.at(-1)));
};
const CI_KEY = { ABX_LLM_API_KEY: "k-test" };
const done = { completeness: 0.95, missing: [], example: "" };
const ask = (c, q, extra = {}) => ({ completeness: c, question: q, missing: ["details"], example: "a python env with pandas", ...extra });
const SWITCH = "Switch to template init";
const DIRQ = "Save the generated template under which directory?";
const BUILDQ = "Build and deploy template";

// ---- create (AI path, interactive terminal) ---------------------------------------------------------------------
add("tty create ai switch yes", ["create", "python env"], { tty: [{ expect: SWITCH, send: "y\n" }], env: CI_KEY, setup: (h) => agent(h, { assess: [done] }) });
add("tty create ai switch yes (research fails)", ["create", "python env"], { tty: [{ expect: SWITCH, send: "y\n" }], env: CI_KEY, setup: (h) => agent(h, { assess: [done], research: "fail" }) });
add("tty create ai switch yes --dir warns", ["create", "--dir", "out", "python env"], { tty: [{ expect: SWITCH, send: "y\n" }], env: CI_KEY, setup: (h) => agent(h, { assess: [done] }) });
add("tty create ai switch no, confirm no", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "n\n" }, { expect: DIRQ, send: "\n" }, { expect: BUILDQ, send: "n\n" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [done] }),
});
add("tty create ai switch enter (default no), confirm eof", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "\n" }, { expect: DIRQ, send: "\n" }, { expect: BUILDQ, send: "\x04" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [done] }),
});
add("tty create ai switch eof", ["create", "python env"], { tty: [{ expect: SWITCH, send: "\x04" }], env: CI_KEY, setup: (h) => agent(h, { assess: [done] }) });
add("tty create ai switch ctrl-c", ["create", "python env"], { tty: [{ expect: SWITCH, send: "\x03" }], env: CI_KEY, setup: (h) => agent(h, { assess: [done] }) });
add("tty create ai switch invalid then y", ["create", "python env"], { tty: [{ expect: SWITCH, send: "maybe\n" }, { expect: "Error: invalid input", send: "y\n" }], env: CI_KEY, setup: (h) => agent(h, { assess: [done] }) });
add("tty create ai dir prompt ctrl-c", ["create", "python env"], { tty: [{ expect: SWITCH, send: "n\n" }, { expect: DIRQ, send: "\x03" }], env: CI_KEY, setup: (h) => agent(h, { assess: [done] }) });
add("tty create ai dir prompt custom", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "n\n" }, { expect: DIRQ, send: "gen-out\n" }, { expect: BUILDQ, send: "n\n" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [done] }),
});
add("tty create ai dir prompt is a file", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "n\n" }, { expect: DIRQ, send: "afile\n" }],
  env: CI_KEY,
  setup: (h, cwd) => {
    agent(h, { assess: [done] });
    write(cwd, "afile", "x");
  },
});
add("tty create ai dir prompt whitespace", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "n\n" }, { expect: DIRQ, send: "   \n" }, { expect: BUILDQ, send: "n\n" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [done] }),
});
add("tty create ai --dir given skips prompt", ["create", "--dir", "gen-out", "python env"], {
  tty: [{ expect: SWITCH, send: "n\n" }, { expect: BUILDQ, send: "n\n" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [done] }),
});
add("tty create ai -y skips every prompt", ["create", "-y", "python env"], { tty: [], env: CI_KEY, setup: (h) => agent(h, { assess: [done] }) });
add("tty create ai -y json", ["--json", "create", "-y", "python env"], { tty: [], env: CI_KEY, setup: (h) => agent(h, { assess: [done] }) });
add("tty create ai json (no switch prompt, incomplete)", ["--json", "create", "python env"], { tty: [], env: CI_KEY, setup: (h) => agent(h, { assess: [ask(0.4, "Which version?")] }) });

// clarification loop (interactive)
const Q = (n, q) => `Question ${n}: ${q}`;
add("tty clarify two questions then template-only", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "y\n" }, { expect: Q(1, "Which version?"), send: "3.12\n" }, { expect: Q(2, "Which libs?"), send: "pandas\n" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [ask(0.3, "Which version?"), ask(0.5, "Which libs?"), done] }),
});
add("tty clarify delegation answer", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "y\n" }, { expect: Q(1, "Which version?"), send: "你自己决定\n" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [ask(0.3, "Which version?"), done] }),
});
add("tty clarify empty answer cancels", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "y\n" }, { expect: Q(1, "Which version?"), send: "\n" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [ask(0.3, "Which version?")] }),
});
add("tty clarify whitespace answer cancels", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "y\n" }, { expect: Q(1, "Which version?"), send: "   \n" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [ask(0.3, "Which version?")] }),
});
add("tty clarify eof", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "y\n" }, { expect: Q(1, "Which version?"), send: "\x04" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [ask(0.3, "Which version?")] }),
});
add("tty clarify ctrl-c", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "y\n" }, { expect: Q(1, "Which version?"), send: "\x03" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [ask(0.3, "Which version?")] }),
});
add("tty clarify repeated question", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "y\n" }, { expect: Q(1, "Which version?"), send: "3.12\n" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [ask(0.3, "Which version?"), ask(0.4, "Which version?")] }),
});
add("tty clarify no question left", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "y\n" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [{ completeness: 0.5, missing: ["x"], example: "ex" }] }),
});
add("tty clarify safety limit", ["create", "python env"], {
  tty: [
    { expect: SWITCH, send: "y\n" },
    ...[1, 2, 3, 4, 5].map((n) => ({ expect: Q(n, `Q${n}?`), send: `a${n}\n` })),
  ],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [1, 2, 3, 4, 5, 6].map((n) => ask(0.1 * n, `Q${n}?`)) }),
});
add("tty clarify assessment unavailable midway", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "y\n" }, { expect: Q(1, "Which version?"), send: "3.12\n" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [ask(0.3, "Which version?"), "fail"] }),
});
add("tty clarify assessment unavailable at start", ["create", "python env"], { tty: [{ expect: SWITCH, send: "y\n" }], env: CI_KEY, setup: (h) => agent(h, { assess: ["fail"] }) });
add("tty clarify percentage scale", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "y\n" }, { expect: Q(1, "Which version?"), send: "3.12\n" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [ask(30, "Which version?"), { completeness: 90, missing: [], example: "" }] }),
});
add("tty clarify unicode answer", ["create", "python env"], {
  tty: [{ expect: SWITCH, send: "y\n" }, { expect: Q(1, "哪个版本？"), send: "三点十二\n" }],
  env: CI_KEY,
  setup: (h) => agent(h, { assess: [ask(0.3, "哪个版本？"), done] }),
});
add("non-tty incomplete json", ["--json", "create", "python env"], { env: CI_KEY, setup: (h) => agent(h, { assess: [ask(0.4, "Which version?")] }) });
add("non-tty incomplete", ["create", "python env"], { env: CI_KEY, setup: (h) => agent(h, { assess: [ask(0.4, "Which version?", { example: "" })] }) });
add("non-tty incomplete -y generates", ["create", "-y", "python env"], { env: CI_KEY, setup: (h) => agent(h, { assess: [ask(0.4, "Which version?")] }) });
add("non-tty complete, no -y, gate", ["create", "python env"], { env: CI_KEY, setup: (h) => agent(h, { assess: [done] }) });
add("non-tty research failure hints", ["create", "python env"], { env: CI_KEY, setup: (h) => agent(h, { assess: [done], research: "fail" }) });
add("non-tty generation nofiles", ["create", "-y", "python env"], { env: CI_KEY, setup: (h) => agent(h, { gen: "nofiles" }) });
add("non-tty generation ok -y deploys (docker unavailable)", ["create", "-y", "python env"], { env: CI_KEY, setup: (h) => agent(h, { assess: [done] }) });

// agent installation / credentials (interactive terminal)
add("tty create ai install declined", ["create", "python env"], { tty: [{ expect: "Install the official", send: "n\n" }], env: { ABX_LLM_API_KEY: "k-test" } });
add("tty create ai install eof", ["create", "python env"], { tty: [{ expect: "Install the official", send: "\x04" }], env: { ABX_LLM_API_KEY: "k-test" } });
add("tty create ai install ctrl-c", ["create", "python env"], { tty: [{ expect: "Install the official", send: "\x03" }], env: { ABX_LLM_API_KEY: "k-test" } });
add("tty create ai credentials empty", ["create", "python env"], { tty: [{ expect: "key", send: "\n" }], setup: (h) => agent(h) });
add("tty create ai credentials stored", ["create", "python env"], {
  tty: [{ expect: "key", send: "sk-stored-test-key\n" }, { expect: SWITCH, send: "y\n" }],
  setup: (h) => agent(h, { assess: [done] }),
  artifacts: ["env:../.abx/.env"],
});
add("tty create ai credentials ctrl-c", ["create", "python env"], { tty: [{ expect: "key", send: "\x03" }], setup: (h) => agent(h) });
add("tty create ai credentials eof", ["create", "python env"], { tty: [{ expect: "key", send: "\x04" }], setup: (h) => agent(h) });
add("tty create ai -y no credentials", ["create", "-y", "python env"], { tty: [], setup: (h) => agent(h) });

// ---- kill / misc prompts on a terminal ---------------------------------------------------------------------------
add("tty kill confirm y", ["kill", SBX], { tty: [{ expect: "Kill sandbox", send: "y\n" }] });
add("tty kill confirm n", ["kill", SBX], { tty: [{ expect: "Kill sandbox", send: "n\n" }] });
add("tty kill confirm ctrl-c", ["kill", SBX], { tty: [{ expect: "Kill sandbox", send: "\x03" }] });
add("tty kill confirm eof", ["kill", SBX], { tty: [{ expect: "Kill sandbox", send: "\x04" }] });
add("tty kill all confirm y", ["kill", "--all"], { tty: [{ expect: "Kill all 2", send: "y\n" }], platform: (req, ctx) => (req.method === "GET" && /^\/(v2\/)?sandboxes(\?|$)/.test(req.url) ? json(200, two(ctx.port)) : undefined) });
add("tty kill all confirm n", ["kill", "--all"], { tty: [{ expect: "Kill all 2", send: "n\n" }], platform: (req, ctx) => (req.method === "GET" && /^\/(v2\/)?sandboxes(\?|$)/.test(req.url) ? json(200, two(ctx.port)) : undefined) });
add("tty kill all confirm ctrl-c", ["kill", "--all"], { tty: [{ expect: "Kill all 2", send: "\x03" }], platform: (req, ctx) => (req.method === "GET" && /^\/(v2\/)?sandboxes(\?|$)/.test(req.url) ? json(200, two(ctx.port)) : undefined) });
add("tty kill all -y", ["kill", "--all", "-y"], { tty: [], platform: (req, ctx) => (req.method === "GET" && /^\/(v2\/)?sandboxes(\?|$)/.test(req.url) ? json(200, two(ctx.port)) : undefined) });
add("tty list", ["list"], { tty: [] });
add("tty info", ["info", SBX], { tty: [] });
add("tty create base", ["create", "-T", "base"], { tty: [] });
add("tty exec", ["exec", SBX, "echo hi"], { tty: [], start: () => proc({ out: ["hi\n"], err: ["warn\n"] }) });
add("tty upload dir", ["upload", SBX, "tree", "/app/data"], { tty: [], setup: fileSetup });
add("tty download", ["download", SBX, "/app/result.csv", "out.csv"], { tty: [], files: { get: () => ({ status: 200, type: "application/octet-stream", body: Buffer.from("a,b\n1,2\n") }) } });

// ---- connect: interrupts and partial lines -------------------------------------------------------------------------
add("connect sigint at prompt then EOF", ["connect", SBX], { sigint: "Type 'exit'", input: "" });
add("connect sigint twice", ["connect", SBX], { sigint: "Type 'exit'", sigintTwice: true, input: "" });
add("connect sigint at prompt then line", ["connect", SBX], { sigint: "Type 'exit'", input: "", afterSigint: "echo hi\nexit\n", start: () => proc({ out: ["hi\n"] }) });
add("connect sigint at prompt then blank and exit", ["connect", SBX], { sigint: "Type 'exit'", input: "", afterSigint: "\nexit\n" });
add("connect eof after partial line", ["connect", SBX], { input: "echo partial", start: () => proc({ out: ["partial\n"] }) });
add("connect crlf input", ["connect", SBX], { input: "echo a\r\nexit\r\n", start: (c) => proc({ out: [JSON.stringify(c) + "\n"] }) });
add("connect tab and padded commands", ["connect", SBX], { input: "\t echo   a  \t\nexit\n", start: (c) => proc({ out: [JSON.stringify(c) + "\n"] }) });
add("connect exit with args is a command", ["connect", SBX], { input: "exit 0\nquit now\nexit\n", start: (c) => proc({ out: [JSON.stringify(c) + "\n"] }) });
add("connect Exit uppercase is a command", ["connect", SBX], { input: "EXIT\nexit\n", start: (c) => proc({ out: [JSON.stringify(c) + "\n"] }) });
add("connect 9-char id truncated", ["connect", "sbx-123456789"], { input: "exit\n", platform: (req, ctx) => (req.url.startsWith("/sandboxes/") ? json(200, sandboxJson(ctx.port, { sandboxID: "sbx-123456789" })) : undefined) });
add("connect unicode id prefix", ["connect", "日本語日本語日本語"], { input: "exit\n", platform: (req, ctx) => (req.url.startsWith("/sandboxes/") ? json(200, sandboxJson(ctx.port, { sandboxID: "日本語日本語日本語" })) : undefined) });
add("connect timeout failure", ["connect", SBX], { input: "sleep 99\nexit\n", start: () => json(504, { message: "gateway timeout" }) });
add("connect large output", ["connect", SBX], { input: "yes\nexit\n", start: () => proc({ out: ["x".repeat(200_000), "\n"] }) });

// ---- run: named commands served by the in-sandbox server ----------------------------------------------------------

const SERVER_RESPONSES = {
  dict: { status: 200, type: "application/json", body: Buffer.from('{"result":{"a":1,"b":[1,2.5,null,true],"c":"é\\"q\\"","d":{}}}') },
  float: { status: 200, type: "application/json", body: Buffer.from('{"result":2.0}') },
  int: { status: 200, type: "application/json", body: Buffer.from('{"result":42}') },
  str: { status: 200, type: "application/json", body: Buffer.from('{"result":"hello\\nworld"}') },
  none: { status: 200, type: "application/json", body: Buffer.from('{"result":null}') },
  noresult: { status: 200, type: "application/json", body: Buffer.from("{}") },
  bool: { status: 200, type: "application/json", body: Buffer.from('{"result":false}') },
  list: { status: 200, type: "application/json", body: Buffer.from('{"result":[]}') },
  big: { status: 200, type: "application/json", body: Buffer.from('{"result":12345678901234567890}') },
  nan: { status: 200, type: "application/json", body: Buffer.from('{"result":1e400}') },
};
for (const [k, resp] of Object.entries(SERVER_RESPONSES)) {
  add(`run result ${k}`, ["run", SBX, "compute"], { server: () => resp });
  add(`run result ${k} json`, ["--json", "run", SBX, "compute"], { server: () => resp });
}
add("run 404", ["run", SBX, "compute"], { server: () => ({ status: 404, type: "application/json", body: Buffer.from('{"error":"no such command"}') }) });
add("run 400 validation", ["run", SBX, "compute"], { server: () => ({ status: 400, type: "application/json", body: Buffer.from('{"error":"x is required","type":"ValidationError"}') }) });
add("run 400 validation json", ["--json", "run", SBX, "compute"], { server: () => ({ status: 400, type: "application/json", body: Buffer.from('{"error":"x is required","type":"ValidationError"}') }) });
add("run 500 with result", ["run", SBX, "compute"], { server: () => ({ status: 500, type: "application/json", body: Buffer.from('{"result":"partial","error":"boom"}') }) });
add("run 502 html", ["run", SBX, "compute"], { server: () => ({ status: 502, type: "text/html", body: Buffer.from("<html>Bad Gateway</html>") }) });
add("run empty body", ["run", SBX, "compute"], { server: () => ({ status: 200, type: "application/json", body: Buffer.alloc(0) }) });
add("run json array body", ["run", SBX, "compute"], { server: () => ({ status: 200, type: "application/json", body: Buffer.from("[1,2]") }) });
add("run reset", ["run", SBX, "compute"], { server: () => RESET });
add("run unreachable (no server)", ["run", SBX, "compute"]);

// ---------------------------------------------------------------------------------------------------------------
// Stub server
// ---------------------------------------------------------------------------------------------------------------

function startStub(testCase) {
  const log = [];
  const ctx = { port: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyBuf = Buffer.concat(chunks);
      const ct = req.headers["content-type"] ?? null;
      let body = bodyBuf.toString("latin1");
      const boundary = /boundary=([^;]+)/.exec(ct ?? "")?.[1]?.replace(/^"|"$/g, "");
      if (boundary) body = body.split(boundary).join("<BOUNDARY>");
      const h = req.headers;
      log.push({
        method: req.method,
        path: req.url,
        body,
        "x-api-key": h["x-api-key"] ?? null,
        authorization: h.authorization ?? null,
        "content-type": boundary ? ct.split(boundary).join("<BOUNDARY>") : ct,
        "x-access-token": h["x-access-token"] ?? null,
        "connect-protocol-version": h["connect-protocol-version"] ?? null,
      });
      const sreq = { method: req.method, url: req.url, body: bodyBuf.toString("utf8") };
      let out;
      if (/^\/(v2\/)?sandboxes/.test(req.url)) {
        out = testCase.platform?.(sreq, ctx);
        if (out === undefined) {
          const sid = /^\/sandboxes\/([^/?]+)/.exec(req.url)?.[1];
          if (req.method === "POST" && req.url === "/sandboxes") {
            const parsed = JSON.parse(sreq.body || "{}");
            out = json(201, sandboxJson(ctx.port, { templateID: parsed.templateID ?? "base" }));
          } else if (req.method === "GET" && sid) out = json(200, sandboxJson(ctx.port, { sandboxID: sid }));
          else if (req.method === "GET") out = json(200, []);
          else if (req.method === "DELETE") out = { status: 204, type: "application/json", body: Buffer.alloc(0) };
          else out = { status: 204, type: "application/json", body: Buffer.alloc(0) };
        }
      } else if (req.url.startsWith("/process.Process/Start")) {
        const start = testCase.start ?? (() => proc({ out: ["ok\n"] }));
        out = start(cmdline(sreq.body), sreq.body);
      } else if (req.url.startsWith("/files")) {
        const f = testCase.files ?? {};
        if (req.method === "GET") {
          const path = new URL(req.url, "http://x").searchParams.get("path");
          out = f.get ? f.get(path) : json(404, { code: "not_found", message: "nf" });
        } else out = f.post ? f.post(sreq) : { status: 201, type: "application/json", body: Buffer.from("[]") };
      } else if (req.url.startsWith("/health")) {
        out = { status: 204, type: "text/plain", body: Buffer.alloc(0) };
      } else {
        out = json(404, { code: "not_found", message: "unscripted" });
      }
      if (out === RESET) {
        req.socket.destroy();
        return;
      }
      const send = () => {
        res.writeHead(out.status, { "Content-Type": out.type, "Content-Length": out.body.length });
        res.end(out.body);
      };
      if (out.delay) setTimeout(send, out.delay);
      else send();
    });
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () => {
      ctx.port = server.address().port;
      ok({ server, log, port: ctx.port });
    }),
  );
}

// In-sandbox SandboxServer (mechanism B): https://<port>-<sandbox>.localhost:<port> with a throw-away certificate.
let certs = null;
function serverCerts() {
  if (certs) return certs;
  const dir = mkdtempSync(join(tmpdir(), "abx-sbxcmds-cert-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:9000-sbx-stub.localhost,DNS:9100-sbx-stub.localhost,DNS:localhost"], { stdio: "ignore" });
  certs = { dir, cert: join(dir, "c.pem"), key: readFileSync(join(dir, "k.pem")), pem: readFileSync(join(dir, "c.pem")) };
  return certs;
}

function startServerStub(testCase, log) {
  const c = serverCerts();
  const server = https.createServer({ key: c.key, cert: c.pem }, (req, res) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      log.push({ method: req.method, path: `https:${req.url}`, host: (req.headers.host ?? "").replace(/:\d+$/, ""), body, "content-type": req.headers["content-type"] ?? null, "x-access-token": req.headers["x-access-token"] ?? null });
      const out = testCase.server(req.method, req.url, body) ?? { status: 404, type: "application/json", body: Buffer.from('{"error":"nf"}') };
      if (out === RESET) {
        req.socket.destroy();
        return;
      }
      res.writeHead(out.status, { "Content-Type": out.type, "Content-Length": out.body.length });
      res.end(out.body);
    });
  });
  return new Promise((ok) => server.listen(0, "::", () => ok({ server, port: server.address().port })));
}

// ---------------------------------------------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), "abx-sbxcmds-"));
const nodeEntry = join(CLI_ROOT, "src/bin/abx.ts");

function run(kind, testCase, port, serverPort) {
  const home = mkdtempSync(join(scratch, `${kind}-home-`));
  const cwd = join(home, "work");
  mkdirSync(cwd, { recursive: true });
  testCase.setup?.(home, cwd);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    ABX_NO_KEYCHAIN: "1",
    NO_PROXY: "*",
    no_proxy: "*",
    LANG: "C.UTF-8",
    COLUMNS: "80",
    TERM: "dumb",
    NO_COLOR: "1",
  };
  if (testCase.creds !== false) Object.assign(env, { E2B_API_KEY: "stub-key", E2B_API_URL: `http://127.0.0.1:${port}` });
  if (serverPort) Object.assign(env, { E2B_DOMAIN: `localhost:${serverPort}`, SSL_CERT_FILE: serverCerts().cert, REQUESTS_CA_BUNDLE: serverCerts().cert, NODE_EXTRA_CA_CERTS: serverCerts().cert });
  for (const [k, v] of Object.entries(testCase.env ?? {})) env[k] = v;
  const argv = testCase.argv.map((a) => a.replace("@cwd@", cwd));
  const [cmd, args] = kind === "py" ? [join(ORACLE_VENV, "bin", "abx"), argv] : [process.execPath, ["--import", pathToFileURL(join(CLI_ROOT, "node_modules/tsx/dist/esm/index.mjs")).href, nodeEntry, ...argv]];
  const ptySpec = testCase.tty ? JSON.stringify({ argv: [cmd, ...args], cwd, env, steps: testCase.tty, timeout: 60 }) : null;
  return new Promise((ok) => {
    const proc_ = ptySpec
      ? spawn("python3", [join(CLI_ROOT, "parity/diff/pty_run.py"), ptySpec], { cwd, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] })
      : testCase.sigint
        ? // The harness may itself run with SIGINT ignored (background job); restore the default so the child can handle it.
          spawn("python3", ["-c", "import os,signal,sys;signal.signal(signal.SIGINT,signal.SIG_DFL);os.execvp(sys.argv[1],sys.argv[1:])", cmd, ...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] })
        : spawn(cmd, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    proc_.stdout.on("data", (d) => out.push(d));
    proc_.stderr.on("data", (d) => err.push(d));
    if (testCase.sigint) {
      let sent = false;
      const watch = (d) => {
        if (!sent && Buffer.concat([...out, ...err]).toString("utf8").includes(testCase.sigint)) {
          sent = true;
          setTimeout(() => proc_.kill("SIGINT"), 300);
          if (testCase.sigintTwice) setTimeout(() => proc_.kill("SIGINT"), 700);
          setTimeout(() => proc_.stdin.end(testCase.afterSigint ?? ""), 1200);
        }
      };
      proc_.stdout.on("data", watch);
      proc_.stderr.on("data", watch);
    }
    const timer = setTimeout(() => proc_.kill("SIGKILL"), 90_000);
    proc_.on("close", (code, signal) => {
      clearTimeout(timer);
      let qlog = "";
      try {
        qlog = readFileSync(join(home, "qlog"), "utf8");
      } catch {
        /* no agent was started */
      }
      const artifacts = {};
      for (const a of testCase.artifacts ?? []) {
        const p = join(cwd, a.slice(a.indexOf(":") + 1));
        artifacts[a] = existsSync(p) ? (statSync(p).isDirectory() ? `<dir ${readdirSync(p).sort().join(",")}>` : readFileSync(p).toString("base64")) : "<missing>";
      }
      const tree = [];
      const walk = (d, rel = "") => {
        let names;
        try {
          names = readdirSync(d).sort();
        } catch {
          tree.push(`${rel}/<unreadable>`);
          return;
        }
        for (const n of names) {
          if (n === ".abx" || n === ".config" || n === ".cache") continue;
          const p = join(d, n);
          const r = rel ? `${rel}/${n}` : n;
          const st = lstatSync(p);
          tree.push(r + (st.isSymbolicLink() ? "@" : st.isDirectory() ? "/" : ""));
          if (st.isDirectory()) walk(p, r);
        }
      };
      walk(cwd);
      try {
        execFileSync("chmod", ["-R", "u+rwX", home], { stdio: "ignore" });
      } catch {
        /* best effort */
      }
      rmSync(home, { recursive: true, force: true });
      let result = { code: signal ? `signal:${signal}` : code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") };
      if (ptySpec) {
        let parsed;
        try {
          parsed = JSON.parse(result.stdout);
        } catch {
          parsed = { timed_out: true, output: `<pty helper failed: ${result.stderr}>` };
        }
        result = { code: parsed.timed_out ? "pty-timeout" : parsed.code, stdout: parsed.output.replace(/\r+\n/g, "\n"), stderr: "" };
      }
      ok({ ...result, artifacts, tree, home, qlog });
    });
    if (!ptySpec) {
      proc_.stdin.on("error", () => {});
      if (testCase.sigint) proc_.stdin.write(testCase.input ?? "");
      else proc_.stdin.end(testCase.input ?? "");
    }
  });
}

function normalise(text, port, home) {
  return text
    .split(`127.0.0.1:${port}`)
    .join("127.0.0.1:<port>")
    .replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>")
    .replace(/("execution_time": )[0-9.eE+-]+/g, "$1<time>")
    .replace(/localhost:\d+/g, "localhost:<sport>")
    .replace(/_ssl\.c:\d+/g, "_ssl.c:<n>")
    .split(home)
    .join("<home>")
    .replace(/(abx-nl-[a-z0-9-]*?)-\d{8,}-[a-z0-9]+/g, "$1-<ts>-<tok>")
    .replace(/(abx-nl-[a-z0-9-]*?)-[0-9a-f]{6}(?![0-9a-z])/g, "$1-<tok>")
    .replace(/(\.abx\/generated\/[a-z0-9-]*?)-\d{8}-\d{6}-[a-z0-9]+/g, "$1-<ts>-<tok>")
    .replace(/\d{8}-\d{6}-[0-9a-f]{6}/g, "<ts>-<tok>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>");
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
    const srv = testCase.server && stub ? await startServerStub(testCase, stub.log) : null;
    const r = await run(kind, testCase, port, srv?.port);
    srv?.server.closeAllConnections?.();
    srv?.server.close();
    const requests = stub ? stub.log.map((l) => normalise(JSON.stringify(l), port, r.home)) : [];
    stub?.server.closeAllConnections?.();
    stub?.server.close();
    const stderr = normalise(r.stderr, port, r.home)
      .split("\n")
      .filter((l) => !/^(DEBUG: (Using selector|connect_tcp|connect_unix|start_tls|send_request|receive_response|response_closed|close\.)|INFO: HTTP Request)/.test(l))
      .join("\n");
    res[kind] = { code: r.code, stdout: normalise(r.stdout, port, r.home), stderr, requests, artifacts: r.artifacts, tree: r.tree.map((t) => normalise(t, port, r.home)), qlog: normalise(r.qlog, port, r.home) };
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
const allow = createAllowList("sandbox_cmds");
let diffs = 0;
try {
  const results = await pool(selected, 6, runCase);
  selected.forEach((c, i) => {
    const { py, node } = results[i];
    const problems = [];
    if (py.code !== node.code) problems.push(`exit: py=${py.code} node=${node.code}`);
    if (py.stdout !== node.stdout) problems.push(`stdout:\n    py:   ${JSON.stringify(py.stdout)}\n    node: ${JSON.stringify(node.stdout)}`);
    if (py.stderr !== node.stderr) problems.push(`stderr:\n    py:   ${JSON.stringify(py.stderr)}\n    node: ${JSON.stringify(node.stderr)}`);
    if (JSON.stringify(py.artifacts) !== JSON.stringify(node.artifacts)) problems.push(`artifacts:\n    py:   ${JSON.stringify(py.artifacts)}\n    node: ${JSON.stringify(node.artifacts)}`);
    if (py.qlog !== node.qlog) problems.push(`agent invocations:\n    py:   ${JSON.stringify(py.qlog)}\n    node: ${JSON.stringify(node.qlog)}`);
    if (JSON.stringify(py.tree) !== JSON.stringify(node.tree)) problems.push(`work tree:\n    py:   ${JSON.stringify(py.tree)}\n    node: ${JSON.stringify(node.tree)}`);
    if (JSON.stringify(py.requests) !== JSON.stringify(node.requests)) {
      const n = Math.max(py.requests.length, node.requests.length);
      for (let k = 0; k < n; k += 1) {
        if (py.requests[k] !== node.requests[k]) {
          problems.push(`stub request #${k} (py ${py.requests.length} / node ${node.requests.length} requests):\n    py:   ${py.requests[k]}\n    node: ${node.requests[k]}`);
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
    } else if (dump) {
      console.log(`=== ${c.name} (exit ${py.code})\n--- stdout\n${JSON.stringify(py.stdout)}\n--- stderr\n${py.stderr}\n--- agent\n${py.qlog}--- tree ${JSON.stringify(py.tree)}`);
    } else if (full) {
      console.log(`ok   ${c.name} (exit ${py.code})\n--- stdout\n${JSON.stringify(py.stdout)}\n--- stderr\n${py.stderr}\n--- agent\n${py.qlog}`);
    } else if (verbose || show) {
      console.log(`ok   ${c.name} (exit ${py.code}) out=${JSON.stringify(py.stdout.slice(0, show ? 400 : 90))} err=${JSON.stringify(py.stderr.slice(0, show ? 400 : 90))}`);
    }
  });
  const stale = allow.report({ complete: !only });
  diffs += stale;
  console.log(`${diffs === 0 ? "IDENTICAL" : "DIFFERENCES"}: ${diffs} differing case(s) of ${selected.length}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
  if (certs) rmSync(certs.dir, { recursive: true, force: true });
}
process.exit(diffs === 0 ? 0 : 1);

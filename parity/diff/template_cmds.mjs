#!/usr/bin/env node
/**
 * Differential test of the `template` commands (`list|info|delete|create|push|build|deploy|search|install|init`), the
 * top-level `install` / `deploy` / `init` shortcuts and `init --adopt`: the original Python CLI
 * (`$ORACLE_VENV/bin/ebx`) versus the Node CLI, run with the same argv in an isolated HOME and a per-run working
 * directory, no real credentials, a local stub server (platform REST, template index, GitHub tarball API) and a fake
 * `docker` executable on PATH that records its argv.
 *
 *   ORACLE_VENV=/path/to/venv-for-original-ebx node parity/diff/template_cmds.mjs [--verbose] [--only <substr>]
 *
 * Compared per case: exit code, stdout, stderr (ports / temp paths normalised), the stub request log, the fake docker
 * invocation log and a snapshot of the working directory afterwards (relative path + content hash). Exit code 0 =
 * identical, 1 = differences, 2 = oracle missing.
 *
 * Placeholders in argv / file contents: `{port}` (stub port), `{work}` (the run's working directory).
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ebx-tpldiff-")));

// ---------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------

const DOCKERFILE = "FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nCMD [\"python3\", \"commands.py\"]\n";
const TEMPLATE_YAML = 'name: demo-tpl\nversion: "1.0.0"\ndescription: demo\nresources:\n  cpu: 1\n  memory: 512\n';
const TPL = { Dockerfile: DOCKERFILE, "template.yaml": TEMPLATE_YAML, "commands.py": "print('hi')\n" };

const INDEX_YAML = `schema_version: 1
templates:
  - name: qwen-code
    description: "Qwen Code agent harness"
    repo: https://github.com/Easy-Sandbox/awesome-templates
    path: qwen-code
    tags: [qwen, ai-agent]
    author: Easy-Sandbox
    capabilities: [shell, files, code]
    status: official
  - name: node-web
    description: "Node.js web service"
    repo: https://github.com/Easy-Sandbox/awesome-templates
    path: node-web
    ref: v1.2.0
    tags: [nodejs, web, deploy]
    author: Easy-Sandbox
    capabilities: [shell, files, code]
    status: community
`;

const PLATFORM_TEMPLATES = [
  { templateID: "tmpl-001", aliases: ["python-base"], names: ["python-base"], cpuCount: 2, memoryMB: 2048, public: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", builds: [{ buildID: "b-1", status: "ready" }] },
  { templateID: "tmpl-002", aliases: ["node-web"], names: ["node-web"], cpuCount: 1, memoryMB: 1024, public: true, createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z", builds: [] },
];

/** A GitHub-shaped tarball of `files` under the single top-level directory `owner-repo-abc123/`. */
function makeTarball(files, subdir = null) {
  const root = mkdtempSync(join(scratch, "tar-"));
  const top = join(root, "owner-repo-abc123");
  for (const [rel, text] of Object.entries(files)) {
    const dest = join(top, subdir ? `${subdir}/${rel}` : rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
  }
  const r = spawnSync("tar", ["--sort=name", "--mtime=2026-01-01", "--owner=0", "--group=0", "-czf", "-", "-C", root, "owner-repo-abc123"], { maxBuffer: 1 << 24 });
  rmSync(root, { recursive: true, force: true });
  return r.stdout;
}

const FAKE_DOCKER = `#!/bin/sh
echo "$@" >> "$DOCKER_LOG"
case "$1" in
  info) [ -n "$DOCKER_FAIL_INFO" ] && exit 1; exit 0 ;;
  build) echo "#1 [internal] load build definition"; echo "#2 DONE"; [ -n "$DOCKER_FAIL_BUILD" ] && { echo "build exploded" >&2; exit 1; }; exit 0 ;;
  login) cat >/dev/null; exit 0 ;;
  push) echo "The push refers to repository [$2]"; exit 0 ;;
  tag) exit 0 ;;
  *) exit 0 ;;
esac
`;

// ---------------------------------------------------------------------------------------------------------------
// Cases: name, argv, options
//   files: seeded into the working directory      docker: fake docker on PATH     env: extra env (null deletes)
//   platform: { "<METHOD> <path>": { status, body } }       index / tarball: stub responses
//   input: stdin text                              unreachable: nothing listens on E2B_API_URL
// ---------------------------------------------------------------------------------------------------------------

const cases = [];
const add = (name, argv, opts = {}) => cases.push({ name, argv, ...opts });
const T = ["template"];
const json = (status, obj) => ({ status, type: "application/json", body: Buffer.from(JSON.stringify(obj)) });
const text = (status, s, type = "text/plain") => ({ status, type, body: Buffer.from(s) });
const CREDS = { ALICLOUD_ACCESS_KEY_ID: "ak-test", ALICLOUD_ACCESS_KEY_SECRET: "sk-test" };

// ---- help
for (const path of [
  [],
  ["install"],
  ["list"],
  ["info"],
  ["create"],
  ["push"],
  ["build"],
  ["deploy"],
  ["delete"],
  ["search"],
  ["init"],
]) {
  add(`help template ${path.join(" ")}`.trim(), [...T, ...path, "--help"]);
  if (path.length) add(`help -h template ${path.join(" ")}`, [...T, ...path, "-h"]);
}
add("help top install", ["install", "--help"]);
add("help top deploy", ["deploy", "--help"]);
add("help top init", ["init", "--help"]);
add("template bare", [...T]);
add("template unknown sub", [...T, "build-local", "--help"]);
add("template typo", [...T, "lst"]);
add("root help", ["--help"]);

// ---- list
add("list ok", [...T, "list"]);
add("list json", ["--json", ...T, "list"]);
add("list quiet", ["--quiet", ...T, "list"]);
add("list empty", [...T, "list"], { platform: { "GET /templates": json(200, []) } });
add("list empty json", ["--json", ...T, "list"], { platform: { "GET /templates": json(200, []) } });
add("list 500", [...T, "list"], { platform: { "GET /templates": json(500, { message: "internal error" }) } });
add("list 401", [...T, "list"], { platform: { "GET /templates": json(401, { message: "Invalid API key" }) } });
add("list 404", [...T, "list"], { platform: { "GET /templates": json(404, { message: "nope" }) } });
add("list 429", [...T, "list"], { platform: { "GET /templates": json(429, { message: "slow down" }) } });
add("list garbage", [...T, "list"], { platform: { "GET /templates": text(200, "not json") } });
add("list unreachable", [...T, "list"], { unreachable: true });
add("list region flag", [...T, "list", "--region", "cn-shanghai"]);
add("list official no creds", [...T, "list", "--official-api"]);
add("list official no creds json", ["--json", ...T, "list", "--official-api"]);
add("list legacy flag", [...T, "list", "--legacy-api"]);

// ---- info
add("info ok", [...T, "info", "tmpl-001"], { platform: { "GET /templates/tmpl-001": json(200, PLATFORM_TEMPLATES[0]) } });
add("info json", ["--json", ...T, "info", "tmpl-001"], { platform: { "GET /templates/tmpl-001": json(200, PLATFORM_TEMPLATES[0]) } });
add("info quiet", ["--quiet", ...T, "info", "tmpl-001"], { platform: { "GET /templates/tmpl-001": json(200, PLATFORM_TEMPLATES[0]) } });
add("info 404", [...T, "info", "tmpl-missing"]);
add("info 500", [...T, "info", "tmpl-001"], { platform: { "GET /templates/tmpl-001": json(500, { error: "kaput" }) } });
add("info 401", [...T, "info", "tmpl-001"], { platform: { "GET /templates/tmpl-001": json(401, { message: "bad key" }) } });
add("info no id", [...T, "info"]);
add("info official no creds", [...T, "info", "tmpl-001", "--official-api"]);
add("info unreachable", [...T, "info", "tmpl-001"], { unreachable: true });

// ---- delete
add("delete yes", [...T, "delete", "tmpl-001", "--yes"], { platform: { "DELETE /templates/tmpl-001": json(204, {}) } });
add("delete yes json", ["--json", ...T, "delete", "tmpl-001", "-y"], { platform: { "DELETE /templates/tmpl-001": json(200, {}) } });
add("delete yes quiet", ["--quiet", ...T, "delete", "tmpl-001", "-y"], { platform: { "DELETE /templates/tmpl-001": json(200, {}) } });
add("delete no yes non tty", [...T, "delete", "tmpl-001"]);
add("delete confirm y", [...T, "delete", "tmpl-001"], { input: "y\n", platform: { "DELETE /templates/tmpl-001": json(200, {}) } });
add("delete confirm n", [...T, "delete", "tmpl-001"], { input: "n\n" });
add("delete 404", [...T, "delete", "tmpl-missing", "--yes"]);
add("delete 500", [...T, "delete", "tmpl-001", "--yes"], { platform: { "DELETE /templates/tmpl-001": json(500, { message: "oops" }) } });
add("delete no id", [...T, "delete"]);

// ---- create (official API needs AK/SK; only the validations are offline)
add("create no name", [...T, "create", "img:latest"]);
add("create no creds", [...T, "create", "img:tag", "--name", "t"]);
add("create no creds json", ["--json", ...T, "create", "img:tag", "--name", "t"]);
add("create bad cpu", [...T, "create", "img:tag", "--name", "t", "--cpu", "x"]);

// ---- push
add("push no creds", [...T, "push", "my-img:latest", "--acr-namespace", "ns"]);
add("push no namespace", [...T, "push", "my-img:latest"], { env: CREDS });
add("push no docker", [...T, "push", "my-img:latest", "--acr-namespace", "ns"], { env: CREDS });
add("push docker", [...T, "push", "my-img:v1", "--acr-namespace", "ns"], { env: CREDS, docker: true });
add("push docker json", ["--json", ...T, "push", "my-img:v1", "--acr-namespace", "ns"], { env: CREDS, docker: true });
add("push docker verbose", [...T, "push", "my-img:v1", "--acr-namespace", "ns", "-v"], { env: CREDS, docker: true });
add("push explicit acr creds", [...T, "push", "my-img", "--acr-namespace", "ns", "--acr-username", "u", "--acr-password", "p", "--tag", "t1"], { env: CREDS, docker: true });

// ---- build / deploy
add("build no dockerfile", [...T, "build", "{work}/tpl", "--acr-namespace", "ns", "--yes"], { files: { "tpl/template.yaml": TEMPLATE_YAML }, env: CREDS });
add("build missing dir", [...T, "build", "{work}/nothing", "--acr-namespace", "ns", "--yes"], { env: CREDS });
add("build no namespace", [...T, "build", "{work}/tpl", "--yes"], { files: { "tpl/Dockerfile": DOCKERFILE }, env: CREDS });
add("build no creds", [...T, "build", "{work}/tpl", "--acr-namespace", "ns", "--yes"], { files: { "tpl/Dockerfile": DOCKERFILE } });
add("build no docker", [...T, "build", "{work}/tpl", "--acr-namespace", "ns", "--yes"], { files: { "tpl/Dockerfile": DOCKERFILE }, env: CREDS });
add("build docker daemon down", [...T, "build", "{work}/tpl", "--acr-namespace", "ns", "--yes"], { files: { "tpl/Dockerfile": DOCKERFILE }, env: { ...CREDS, DOCKER_FAIL_INFO: "1" }, docker: true });
add("build docker fails", [...T, "build", "{work}/tpl", "--acr-namespace", "ns", "--yes"], { files: { "tpl/Dockerfile": DOCKERFILE }, env: { ...CREDS, DOCKER_FAIL_BUILD: "1" }, docker: true });
add("build non tty no yes", [...T, "build", "{work}/tpl", "--acr-namespace", "ns"], { files: TPL_IN("tpl"), env: CREDS, docker: true });
add("build decline", [...T, "build", "{work}/tpl", "--acr-namespace", "ns"], { files: TPL_IN("tpl"), env: CREDS, docker: true, input: "n\n" });
add("build template dir env", [...T, "build", "--acr-namespace", "ns", "--yes"], { files: TPL_IN("tpl"), env: { ...CREDS, EBX_TEMPLATE_DIR: "{work}/tpl" }, docker: true });
add("build no dir arg", [...T, "build", "--acr-namespace", "ns", "--yes"], { env: CREDS });
add("build namespace from env", [...T, "build", "{work}/tpl", "--yes"], { files: TPL_IN("tpl"), env: { ...CREDS, ACR_NAMESPACE: "envns" }, docker: true });
add("build namespace from dotenv", [...T, "build", "{work}/tpl", "--yes"], { files: { ...TPL_IN("tpl"), ".env": "ACR_NAMESPACE=dotns\n" }, env: CREDS, docker: true });
add("build full pipeline", [...T, "build", "{work}/tpl", "--acr-namespace", "ns", "--yes"], { files: TPL_IN("tpl"), env: CREDS, docker: true });
add("build full pipeline json", ["--json", ...T, "build", "{work}/tpl", "--acr-namespace", "ns", "--yes"], { files: TPL_IN("tpl"), env: CREDS, docker: true });
add("build full pipeline quiet", ["--quiet", ...T, "build", "{work}/tpl", "--acr-namespace", "ns", "--yes"], { files: TPL_IN("tpl"), env: CREDS, docker: true });
add("build full pipeline verbose", [...T, "build", "{work}/tpl", "--acr-namespace", "ns", "--yes", "-v"], { files: TPL_IN("tpl"), env: CREDS, docker: true });
add("build options", [...T, "build", "{work}/tpl", "--acr-namespace", "ns", "--acr-repo", "rep", "--tag", "v2", "--alias", "my-alias", "--cpu", "4", "--memory", "4096", "--generation", "2", "--start-cmd", "/s.sh", "--ready-cmd", "/r.sh", "--platform", "linux/arm64", "--yes"], { files: TPL_IN("tpl"), env: CREDS, docker: true });
add("build huge cpu memory", [...T, "build", "{work}/tpl", "--acr-namespace", "ns", "--acr-repo", "rep", "--cpu", "99999999999999999999", "--memory", "9007199254740993", "--yes"], { files: TPL_IN("tpl"), env: CREDS, docker: true });
add("build huge timeout disk", [...T, "build", "{work}/tpl", "--acr-namespace", "ns", "--acr-repo", "rep", "--timeout", "99999999999999999999", "--disk-size", "9007199254740993", "--yes"], { files: TPL_IN("tpl"), env: CREDS, docker: true });
add("build start cmd gen1 warning", [...T, "build", "{work}/tpl", "--acr-namespace", "ns", "--start-cmd", "/s.sh", "--yes"], { files: TPL_IN("tpl"), env: CREDS, docker: true });
add("build dockerfile option", [...T, "build", "{work}/tpl", "--acr-namespace", "ns", "-f", "{work}/tpl/Dockerfile.prod", "--yes"], { files: { ...TPL_IN("tpl"), "tpl/Dockerfile.prod": DOCKERFILE }, env: CREDS, docker: true });
add("deploy full pipeline", [...T, "deploy", "{work}/tpl", "--acr-namespace", "ns", "--yes"], { files: TPL_IN("tpl"), env: CREDS, docker: true });
add("deploy envd inject", [...T, "deploy", "{work}/tpl", "--acr-namespace", "ns", "--envd-inject", "--target-image", "t:1", "--yes"], { files: TPL_IN("tpl"), env: CREDS, docker: true });
add("top deploy no dockerfile", ["deploy", "{work}/tpl", "--acr-namespace", "ns"], { files: { "tpl/template.yaml": TEMPLATE_YAML } });
add("top deploy missing path", ["deploy", "{work}/nothing", "--acr-namespace", "ns"]);
add("top deploy no namespace", ["deploy", "{work}/tpl"], { files: { "tpl/Dockerfile": DOCKERFILE } });
add("top deploy traditional", ["deploy", "{work}/tpl", "--acr-namespace", "ns", "--traditional", "--yes"], { files: TPL_IN("tpl"), env: CREDS, docker: true });
add("top deploy full", ["deploy", "{work}/tpl", "--acr-namespace", "ns", "-y"], { files: TPL_IN("tpl"), env: CREDS, docker: true });
add("top deploy verbose", ["deploy", "{work}/tpl", "--acr-namespace", "ns", "-y", "-v"], { files: TPL_IN("tpl"), env: CREDS, docker: true });
add("top deploy extra arg", ["deploy", "{work}/tpl", "some description"], { files: TPL_IN("tpl") });
add("top deploy ai option", ["deploy", "{work}/tpl", "--agent"], { files: TPL_IN("tpl") });
add("top deploy dockerfile opt", ["deploy", "{work}", "--acr-namespace", "ns", "--dockerfile", "{work}/Dockerfile.x", "-y"], { files: { "Dockerfile.x": DOCKERFILE }, env: CREDS, docker: true });

function TPL_IN(dir) {
  return Object.fromEntries(Object.entries(TPL).map(([k, v]) => [`${dir}/${k}`, v]));
}

// ---- search
const IDX = { index: text(200, INDEX_YAML, "application/yaml") };
const IDX_URL = ["--index-url", "http://127.0.0.1:{port}/index.yaml"];
add("search match", [...T, "search", "qwen", ...IDX_URL], IDX);
add("search by tag/desc", [...T, "search", "web", ...IDX_URL], IDX);
add("search all via empty-ish", [...T, "search", "e", ...IDX_URL], IDX);
add("search tag filter", [...T, "search", "agent", "--tag", "qwen", ...IDX_URL], IDX);
add("search status filter", [...T, "search", "web", "--status", "community", ...IDX_URL], IDX);
add("search status filter none", [...T, "search", "qwen", "--status", "community", ...IDX_URL], IDX);
add("search bad status", [...T, "search", "qwen", "--status", "bogus", ...IDX_URL], IDX);
add("search no match", [...T, "search", "zzz", ...IDX_URL], IDX);
add("search json", ["--json", ...T, "search", "qwen", ...IDX_URL], IDX);
add("search json no match", ["--json", ...T, "search", "zzz", ...IDX_URL], IDX);
add("search quiet", ["--quiet", ...T, "search", "qwen", ...IDX_URL], IDX);
add("search refresh", [...T, "search", "qwen", "--refresh", ...IDX_URL], IDX);
add("search token", [...T, "search", "qwen", "--token", "gh-secret-token", ...IDX_URL], IDX);
add("search env index url", [...T, "search", "qwen"], { ...IDX, env: { EBX_TEMPLATE_INDEX_URL: "http://127.0.0.1:{port}/index.yaml" } });
add("search local file index", [...T, "search", "qwen", "--index-url", "{work}/idx.yaml"], { files: { "idx.yaml": INDEX_YAML } });
add("search missing local index", [...T, "search", "qwen", "--index-url", "{work}/nope.yaml"]);
add("search 404", [...T, "search", "qwen", ...IDX_URL], { index: text(404, "not found") });
add("search 500", [...T, "search", "qwen", ...IDX_URL], { index: text(500, "boom") });
add("search bad yaml", [...T, "search", "qwen", ...IDX_URL], { index: text(200, "::: not: [valid"), known: "YAML parser error text (PyYAML vs yaml package) differs; message prefix and code are identical" });
add("search bad schema", [...T, "search", "qwen", ...IDX_URL], { index: text(200, "schema_version: 99\ntemplates: []\n") });
add("search not a mapping", [...T, "search", "qwen", ...IDX_URL], { index: text(200, "- a\n- b\n") });
add("search rate limited", [...T, "search", "qwen", ...IDX_URL], { index: { status: 403, type: "application/json", headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1893456000" }, body: Buffer.from('{"message":"API rate limit exceeded"}') } });
add("search rate limited 429", [...T, "search", "qwen", ...IDX_URL], { index: { status: 429, type: "application/json", body: Buffer.from("{}") } });
add("search unreachable", [...T, "search", "qwen", "--index-url", "http://127.0.0.1:1/index.yaml"]);
add("search no query", [...T, "search"]);
add("search entries missing fields", [...T, "search", "x", ...IDX_URL], { index: text(200, "schema_version: 1\ntemplates:\n  - name: x\n    repo: https://github.com/a/b\n") });
add("search entry bad repo", [...T, "search", "x", ...IDX_URL], { index: text(200, "schema_version: 1\ntemplates:\n  - name: x\n    repo: https://gitlab.com/a/b\n") });

// ---- install: builtin / local / validation
add("install builtin", [...T, "install", "base"]);
add("install builtin json", ["--json", ...T, "install", "base"]);
add("install builtin quiet", ["--quiet", ...T, "install", "base"]);
add("install builtin code-interpreter", [...T, "install", "code-interpreter-v1"]);
add("install shortcut builtin", ["install", "base"]);
add("install no ref", [...T, "install"]);
add("install invalid registry type", [...T, "install", "owner/repo", "--registry-type", "invalid"]);
add("install local missing", [...T, "install", "./definitely-missing", "--registry-type", "local"]);
add("install local missing auto", [...T, "install", "./definitely-missing"]);
add("install shortcut region missing", ["install", "./definitely-missing", "--region", "cn-shanghai"]);
add("install local download only", [...T, "install", "{work}/src", "--registry-type", "local", "--download-only"], { files: TPL_IN("src") });
add("install local download only json", ["--json", ...T, "install", "{work}/src", "--registry-type", "local", "--download-only"], { files: TPL_IN("src") });
add("install local download only quiet", ["--quiet", ...T, "install", "{work}/src", "--registry-type", "local", "--download-only"], { files: TPL_IN("src") });
add("install local auto detect", [...T, "install", "{work}/src", "--download-only"], { files: TPL_IN("src") });
add("install local dir", [...T, "install", "{work}/src", "--registry-type", "local", "--download-only", "--dir", "{work}/out"], { files: TPL_IN("src") });
add("install local dir nonempty", [...T, "install", "{work}/src", "--registry-type", "local", "--download-only", "--dir", "{work}/out"], { files: { ...TPL_IN("src"), "out/x.txt": "x\n" } });
add("install shortcut dir", ["install", "{work}/src", "--registry-type", "local", "--download-only", "--dir", "{work}/out"], { files: TPL_IN("src") });
add("install sandbox yaml only", [...T, "install", "{work}/src", "--registry-type", "local", "--download-only", "--dir", "{work}/out"], { files: { "src/sandbox.yaml": "name: test-alias\nversion: '1.0.0'\n", "src/Dockerfile": DOCKERFILE } });
add("install both yaml", [...T, "install", "{work}/src", "--registry-type", "local", "--download-only", "--dir", "{work}/out"], { files: { "src/template.yaml": "name: canonical\n", "src/sandbox.yaml": "name: alias\n", "src/Dockerfile": DOCKERFILE } });
add("install no yaml", [...T, "install", "{work}/src", "--registry-type", "local", "--download-only", "--dir", "{work}/out"], { files: { "src/Dockerfile": DOCKERFILE } });
add("install no dockerfile", [...T, "install", "{work}/src", "--registry-type", "local", "--download-only", "--dir", "{work}/out"], { files: { "src/template.yaml": TEMPLATE_YAML } });
add("install invalid yaml", [...T, "install", "{work}/src", "--registry-type", "local", "--download-only", "--dir", "{work}/out"], { files: { "src/template.yaml": "name: [unclosed\n", "src/Dockerfile": DOCKERFILE }, known: "YAML parser error text (PyYAML vs yaml package) differs" });
add("install local deploy no yes", [...T, "install", "{work}/src", "--registry-type", "local"], { files: TPL_IN("src"), env: { ...CREDS, ACR_NAMESPACE: "ns" }, docker: true });
add("install local deploy no namespace", [...T, "install", "{work}/src", "--registry-type", "local"], { files: TPL_IN("src"), env: CREDS });
add("install local deploy yes", [...T, "install", "{work}/src", "--registry-type", "local", "--yes"], { files: TPL_IN("src"), env: { ...CREDS, ACR_NAMESPACE: "ns" }, docker: true });
add("install local deploy yes alias", [...T, "install", "{work}/src", "--registry-type", "local", "--yes", "--alias", "al", "--cpu", "3", "--memory", "1024", "--acr-namespace", "ns2"], { files: TPL_IN("src"), env: CREDS, docker: true });
add("install local deploy decline", [...T, "install", "{work}/src", "--registry-type", "local"], { files: TPL_IN("src"), env: { ...CREDS, ACR_NAMESPACE: "ns" }, docker: true, input: "n\n" });

// ---- install from the GitHub tarball API (served by the stub through --registry-url)
const GH = (files, subdir) => ({ tarball: { files, subdir } });
const REG = ["--registry-url", "http://127.0.0.1:{port}"];
add("install github download only", [...T, "install", "owner/repo", ...REG, "--download-only"], GH(TPL));
add("install github download only json", ["--json", ...T, "install", "owner/repo", ...REG, "--download-only"], GH(TPL));
add("install github ref", [...T, "install", "owner/repo@v1.0", ...REG, "--download-only"], GH(TPL));
add("install github subdir", [...T, "install", "owner/repo//sub/dir@main", ...REG, "--download-only", "--dir", "{work}/out"], GH(TPL, "sub/dir"));
add("install github subdir missing", [...T, "install", "owner/repo//nope", ...REG, "--download-only"], GH(TPL, "sub"));
add("install github dir", [...T, "install", "owner/repo", ...REG, "--download-only", "--dir", "{work}/out"], GH(TPL));
add("install github token", [...T, "install", "owner/repo", ...REG, "--download-only", "--token", "gh-secret"], GH(TPL));
add("install github env token", [...T, "install", "owner/repo", ...REG, "--download-only"], { ...GH(TPL), env: { GITHUB_TOKEN: "gh-env-secret" } });
add("install github 404", [...T, "install", "owner/repo", ...REG, "--download-only"], { tarball: { status: 404, body: '{"message":"Not Found"}' } });
add("install github 401", [...T, "install", "owner/repo", ...REG, "--download-only"], { tarball: { status: 401, body: '{"message":"Bad credentials"}' } });
add("install github 403 rate", [...T, "install", "owner/repo", ...REG, "--download-only"], { tarball: { status: 403, headers: { "x-ratelimit-remaining": "0" }, body: '{"message":"API rate limit exceeded"}' } });
add("install github 500", [...T, "install", "owner/repo", ...REG, "--download-only"], { tarball: { status: 500, body: "boom" } });
add("install github garbage", [...T, "install", "owner/repo", ...REG, "--download-only"], { tarball: { status: 200, raw: Buffer.from("this is not a tarball") } });
add("install github no yaml", [...T, "install", "owner/repo", ...REG, "--download-only"], GH({ Dockerfile: DOCKERFILE }));
add("install github deploy yes", [...T, "install", "owner/repo", ...REG, "--yes"], { ...GH(TPL), env: { ...CREDS, ACR_NAMESPACE: "ns" }, docker: true });
add("install github bare owner", [...T, "install", "owner", ...REG, "--download-only"], GH(TPL));
add("install github bad ref chars", [...T, "install", "owner/repo@bad ref!", ...REG, "--download-only"], GH(TPL));
add("install bare name via index", [...T, "install", "qwen-code", ...REG, "--download-only"], { ...IDX, ...GH(TPL), env: { EBX_TEMPLATE_INDEX_URL: "http://127.0.0.1:{port}/index.yaml" } });
add("install bare name pinned via index", [...T, "install", "node-web", ...REG, "--download-only"], { ...IDX, ...GH(TPL), env: { EBX_TEMPLATE_INDEX_URL: "http://127.0.0.1:{port}/index.yaml" } });
add("install bare name unknown", [...T, "install", "no-such", "--download-only"], { ...IDX, env: { EBX_TEMPLATE_INDEX_URL: "http://127.0.0.1:{port}/index.yaml" } });
add("install bare name unknown json", ["--json", ...T, "install", "no-such", "--download-only"], { ...IDX, env: { EBX_TEMPLATE_INDEX_URL: "http://127.0.0.1:{port}/index.yaml" } });
add("install bare name index 500", [...T, "install", "no-such", "--download-only"], { index: text(500, "boom"), env: { EBX_TEMPLATE_INDEX_URL: "http://127.0.0.1:{port}/index.yaml" } });
add("install bare name rate limited", [...T, "install", "no-such", "--download-only"], { index: { status: 403, type: "application/json", headers: { "x-ratelimit-remaining": "0" }, body: Buffer.from("{}") }, env: { EBX_TEMPLATE_INDEX_URL: "http://127.0.0.1:{port}/index.yaml" } });

// ---- init
add("init list", [...T, "init", "--list"]);
add("init list json", ["--json", ...T, "init", "--list"]);
add("init list quiet", ["--quiet", ...T, "init", "--list"]);
for (const c of ["python", "node", "minimal"]) {
  add(`init case ${c}`, [...T, "init", "{work}/proj", "-t", c]);
  add(`init case ${c} no dir`, [...T, "init", "-t", c]);
  add(`init case ${c} json`, ["--json", ...T, "init", "-t", c]);
  add(`init case ${c} quiet`, ["--quiet", ...T, "init", "-t", c]);
}
add("init case name", [...T, "init", "-t", "python", "--name", "myapp"]);
add("init case name node", [...T, "init", "-t", "node", "--name", "webapp"]);
add("init case bad name", [...T, "init", "-t", "python", "--name", "bad name!"]);
add("init case bad name slash", [...T, "init", "-t", "python", "--name", "a/b"]);
add("init unknown case", [...T, "init", "-t", "ruby"]);
add("init no case json", ["--json", ...T, "init"]);
add("init no case non tty", [...T, "init"]);
add("init no case ci", [...T, "init"], { env: { CI: "true" } });
add("init existing nonempty", [...T, "init", "{work}/proj", "-t", "python"], { files: { "proj/x.txt": "x\n" } });
add("init existing files conflict", [...T, "init", "{work}/proj", "-t", "python"], { files: { "proj/Dockerfile": "FROM scratch\n" } });
add("init existing force", [...T, "init", "{work}/proj", "-t", "python", "--force"], { files: { "proj/Dockerfile": "FROM scratch\n" } });
add("init existing dir via name", [...T, "init", "-t", "python"], { files: { "python/Dockerfile": "FROM scratch\n" } });
add("init top shortcut", ["init", "{work}/proj", "-t", "python"]);
add("init template and from", [...T, "init", "-t", "python", "--from", "owner/repo"]);
add("init from local", [...T, "init", "{work}/dest", "--from", "{work}/src"], { files: TPL_IN("src") });
add("init from local no dir", [...T, "init", "--from", "{work}/src"], { files: TPL_IN("src") });
add("init from local no yaml", [...T, "init", "--from", "{work}/src"], { files: { "src/Dockerfile": DOCKERFILE } });
add("init from local name", [...T, "init", "--from", "{work}/src", "--name", "renamed"], { files: TPL_IN("src") });
add("init from local conflict", [...T, "init", "{work}/dest", "--from", "{work}/src"], { files: { ...TPL_IN("src"), "dest/Dockerfile": "x\n" } });
add("init from local force", [...T, "init", "{work}/dest", "--from", "{work}/src", "--force"], { files: { ...TPL_IN("src"), "dest/Dockerfile": "x\n" } });
add("init from missing", [...T, "init", "--from", "{work}/nope"]);
add("init from github", [...T, "init", "--from", "owner/repo", ...[], "-y"], { env: { GITHUB_TOKEN: "t" }, unreachable: true });
add("init nl no llm", [...T, "init", "a python data science env", "-y"]);
add("init nl no llm json", ["--json", ...T, "init", "a python data science env", "-y"]);
add("init nl with case", [...T, "init", "a python env", "-t", "python"]);
add("init nl cjk", [...T, "init", "一个数据分析环境", "-y"]);

// ---- init --adopt (offline paths only: the model is never reached)
const APP = { "app/app.py": "print('hi')\n" };
add("adopt hint without adopt", [...T, "init", "--hint", "redis"]);
add("adopt dry run without adopt", [...T, "init", "--dry-run"]);
add("adopt with case", [...T, "init", "--adopt", "{work}/app", "-t", "python"], { files: APP });
add("adopt with from", [...T, "init", "--adopt", "{work}/app", "--from", "x/y"], { files: APP });
add("adopt sentence", [...T, "init", "--adopt", "a python app", "-y"]);
add("adopt dry run", [...T, "init", "--adopt", "{work}/app", "--dry-run"], { files: { ...APP, "app/.env": "TOKEN=v\n", "app/sub/mod.py": "x = 1\n" } });
add("adopt dry run json", ["--json", ...T, "init", "--adopt", "{work}/app", "--dry-run"], { files: { ...APP, "app/.env": "TOKEN=v\n" } });
add("adopt dry run quiet", ["--quiet", ...T, "init", "--adopt", "{work}/app", "--dry-run"], { files: APP });
add("adopt dry run hint name", [...T, "init", "--adopt", "{work}/app", "--dry-run", "--hint", "port 8080", "--name", "my-app"], { files: APP });
add("adopt dry run bad name", [...T, "init", "--adopt", "{work}/app", "--dry-run", "--name", "Bad Name"], { files: APP });
add("adopt dry run empty dir", [...T, "init", "--adopt", "{work}/app", "--dry-run"], { files: { "app/.keep": "" } });
add("adopt dry run existing template files", [...T, "init", "--adopt", "{work}/app", "--dry-run"], { files: { ...APP, "app/Dockerfile": "FROM scratch\n" } });
add("adopt missing dir", [...T, "init", "--adopt", "{work}/nope", "--dry-run"]);
add("adopt file not dir", [...T, "init", "--adopt", "{work}/app/app.py", "--dry-run"], { files: APP });
add("adopt default cwd dry run", [...T, "init", "--adopt", "--dry-run"], { files: { "app.py": "print(1)\n" } });
add("adopt non tty no yes", [...T, "init", "--adopt", "{work}/app"], { files: APP });
add("adopt yes no creds", [...T, "init", "--adopt", "{work}/app", "-y"], { files: APP });
add("adopt yes no creds json", ["--json", ...T, "init", "--adopt", "{work}/app", "-y"], { files: APP });
add("adopt binary file", [...T, "init", "--adopt", "{work}/app", "--dry-run"], { files: { ...APP, "app/blob.bin": "\u0000\u0001\u0002" } });
add("adopt big tree", [...T, "init", "--adopt", "{work}/app", "--dry-run"], { files: { ...APP, "app/node_modules/x/index.js": "1\n", "app/.git/config": "[core]\n", "app/data/big.txt": "x".repeat(300_000) } });

// ---------------------------------------------------------------------------------------------------------------
// Stub server
// ---------------------------------------------------------------------------------------------------------------

function startStub(testCase) {
  const log = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const h = req.headers;
      log.push({
        method: req.method,
        path: req.url,
        body: Buffer.concat(chunks).toString("utf8"),
        "x-api-key": h["x-api-key"] ?? null,
        authorization: h.authorization ?? null,
        accept: h.accept ?? null,
        "user-agent-prefix": /httpx/.test(h["user-agent"] ?? "") ? "httpx" : (h["user-agent"] ?? "").split("/")[0] || null,
      });
      const key = `${req.method} ${req.url.split("?")[0]}`;
      const url = req.url.split("?")[0];
      let out = null;
      if (testCase.platform?.[key]) out = testCase.platform[key];
      else if (url === "/index.yaml" && testCase.index) out = testCase.index;
      else if (url.startsWith("/repos/") && url.includes("/tarball") && testCase.tarball) {
        const t = testCase.tarball;
        if (t.raw) out = { status: t.status ?? 200, type: "application/gzip", body: t.raw };
        else if (t.files) out = { status: 200, type: "application/gzip", body: makeTarball(t.files, t.subdir) };
        else out = { status: t.status, type: "application/json", headers: t.headers, body: Buffer.from(t.body ?? "") };
      } else if (url === "/templates" && req.method === "GET") out = json(200, PLATFORM_TEMPLATES);
      else if (url.startsWith("/templates/") && req.method === "GET") {
        const id = url.slice("/templates/".length);
        const found = PLATFORM_TEMPLATES.find((t) => t.templateID === id);
        out = found ? json(200, found) : json(404, { message: "template not found" });
      } else if (url.startsWith("/templates/") && req.method === "DELETE") {
        const id = url.slice("/templates/".length);
        out = PLATFORM_TEMPLATES.some((t) => t.templateID === id) ? json(204, {}) : json(404, { message: "template not found" });
      } else out = json(404, { message: "unscripted route" });
      const headers = { "Content-Type": out.type, "Content-Length": out.body.length, ...(out.headers ?? {}) };
      res.writeHead(out.status, headers);
      res.end(out.status === 204 ? undefined : out.body);
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, log, port: server.address().port })));
}

// ---------------------------------------------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------------------------------------------

mkdirSync(join(scratch, "bin"), { recursive: true });
writeFileSync(join(scratch, "bin", "docker"), FAKE_DOCKER);
chmodSync(join(scratch, "bin", "docker"), 0o755);
const nodeEntry = join(CLI_ROOT, "src/bin/ebx.ts");

function snapshot(root) {
  const out = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = statSync(p);
      if (st.isDirectory()) {
        out.push(`${r}/`);
        walk(p, r);
      } else out.push(`${r} ${createHash("sha1").update(readFileSync(p)).digest("hex").slice(0, 10)} ${st.size}`);
    }
  };
  walk(root, "");
  return out;
}

function run(kind, testCase, port) {
  const home = mkdtempSync(join(scratch, "home-"));
  const work = mkdtempSync(join(scratch, "work-"));
  const dockerLog = join(scratch, `docker-${kind}-${Math.random().toString(36).slice(2)}.log`);
  const sub = (s) => s.split("{port}").join(String(port)).split("{work}").join(work);
  for (const [rel, content] of Object.entries(testCase.files ?? {})) {
    const dest = join(work, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, sub(content));
  }
  const env = {
    PATH: testCase.docker ? `${join(scratch, "bin")}:${process.env.PATH}` : process.env.PATH.split(":").filter((d) => !existsSync(join(d, "docker"))).join(":"),
    HOME: home,
    USERPROFILE: home,
    EBX_NO_KEYCHAIN: "1",
    E2B_API_KEY: "stub-key",
    E2B_API_URL: `http://127.0.0.1:${port}`,
    NO_PROXY: "*",
    no_proxy: "*",
    LANG: "C.UTF-8",
    COLUMNS: "80",
    DOCKER_LOG: dockerLog,
  };
  for (const [k, v] of Object.entries(testCase.env ?? {})) env[k] = sub(v);
  const argv = testCase.argv.map(sub);
  const [cmd, args] =
    kind === "py"
      ? [join(ORACLE_VENV, "bin", "ebx"), argv]
      : [process.execPath, ["--import", pathToFileURL(join(CLI_ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs")).href, nodeEntry, ...argv]];
  return new Promise((ok) => {
    const proc = spawn(cmd, args, { cwd: work, env, stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    proc.stdout.on("data", (d) => out.push(d));
    proc.stderr.on("data", (d) => err.push(d));
    const timer = setTimeout(() => proc.kill("SIGKILL"), 90_000);
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      const files = snapshot(work);
      const docker = existsSync(dockerLog) ? readFileSync(dockerLog, "utf8") : "";
      rmSync(home, { recursive: true, force: true });
      rmSync(work, { recursive: true, force: true });
      rmSync(dockerLog, { force: true });
      ok({ code: signal ? `signal:${signal}` : code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), files, docker, work, home });
    });
    proc.stdin.on("error", () => {});
    proc.stdin.end(testCase.input ?? "");
  });
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function normalise(text, ctx) {
  let t = text.split(ctx.work).join("<work>").split(ctx.home).join("<home>");
  t = t.split(basename(ctx.work)).join("<workname>");
  t = t.replace(/work-[A-Za-z0-9]{6}\b/g, "work-<rand>");
  t = t.replace(/INFO: Building SDK wheel from [^\n]*\n/g, "");
  t = t.replace(/ListTeams API call failed: Error: [^"]*/g, "ListTeams API call failed: <aliyun-error>");
  t = t.replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>");
  t = t.replace(new RegExp(`${esc(scratch)}/[A-Za-z0-9._-]+`, "g"), "<scratch>");
  t = t.replace(/ebx-adopt-[A-Za-z0-9_]+/g, "ebx-adopt-<rand>");
  t = t.replace(/\d+\.\d+s\b/g, "<t>s");
  t = t.replace(/WARNING: (Failed to build SDK wheel|Could not fetch easy-sandbox-server)[^\n]*\n(\n)?/g, "<sdk-wheel-warning>\n");
  // httpx's HTTPStatusError text spans two lines; the oracle's release wheel is published on PyPI, the Node build's (bumped) one may not be.
  t = t.replace(/<sdk-wheel-warning>\nFor more information check: [^\n]*\n/g, "<sdk-wheel-warning>\n");
  t = t.replace(/\[E5000\] ListTeams API call failed: [^\n]*/g, "[E5000] ListTeams API call failed: <aliyun-error>");
  t = t.replace(/WARNING: GetAuthorizationToken failed:[\s\S]*?falling back to direct AK\/SK login/g, "WARNING: GetAuthorizationToken failed: <net>");
  return t;
}

function stderrFilter(s) {
  return s
    .split("\n")
    .filter((l) => !/^(DEBUG: (Starting new HTTPS connection|https:\/\/[^ ]+ "|Using selector|connect_tcp|connect_unix|start_tls|send_request|receive_response|response_closed|close\.)|INFO: HTTP Request)/.test(l))
    .join("\n");
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
    const r = await run(kind, testCase, port);
    const norm = (s) => normalise(s, r);
    const requests = stub ? stub.log.map((l) => norm(JSON.stringify(l))) : [];
    stub?.server.closeAllConnections?.();
    stub?.server.close();
    res[kind] = {
      code: r.code,
      stdout: norm(r.stdout),
      stderr: stderrFilter(norm(r.stderr)),
      requests,
      docker: norm(r.docker),
      files: r.files.map(norm),
    };
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
const allow = createAllowList("template_cmds");
let diffs = 0;
try {
  const results = await pool(selected, 6, runCase);
  selected.forEach((c, i) => {
    const { py, node } = results[i];
    const problems = [];
    if (py.code !== node.code) problems.push(`exit: py=${py.code} node=${node.code}`);
    if (py.stdout !== node.stdout) problems.push(`stdout:\n    py:   ${JSON.stringify(py.stdout)}\n    node: ${JSON.stringify(node.stdout)}`);
    if (py.stderr !== node.stderr) problems.push(`stderr:\n    py:   ${JSON.stringify(py.stderr)}\n    node: ${JSON.stringify(node.stderr)}`);
    if (py.docker !== node.docker) problems.push(`docker log:\n    py:   ${JSON.stringify(py.docker)}\n    node: ${JSON.stringify(node.docker)}`);
    if (JSON.stringify(py.files) !== JSON.stringify(node.files)) problems.push(`files:\n    py:   ${JSON.stringify(py.files)}\n    node: ${JSON.stringify(node.files)}`);
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

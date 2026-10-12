#!/usr/bin/env node
/**
 * Adversarial differential: `template install` (hostile GitHub tarballs, hostile template.yaml, cache re-runs, --dir),
 * `template search` (hostile index), `template init --from`, `_read_yaml_defaults` through `template build`.
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/adv_agent_template_install.mjs [--verbose] [--only <substr>]
 *
 * Exit 0 = identical (or oracle absent -> skipped), 1 = differences.
 */
import { CREDS, D, DOCKERFILE, F, TEMPLATE_YAML, TOP, TPL, TPL_IN, pyTar, requireOracle, runSuite, text } from "./adv_agent_template_lib.mjs";

requireOracle();

const cases = [];
const add = (name, argv, opts = {}) => cases.push({ name, argv, ...opts });
const T = ["template"];
const REG = ["--registry-url", "http://127.0.0.1:{port}"];
const DL = [...T, "install", "owner/repo", ...REG, "--download-only"];
const spec = (members, extra = {}) => ({ tarball: { spec: { members, ...extra } } });
const good = [D(`${TOP}/`), F(`${TOP}/template.yaml`, TEMPLATE_YAML), F(`${TOP}/Dockerfile`, DOCKERFILE), F(`${TOP}/commands.py`, "print(1)\n")];

// ---- hostile tar members -------------------------------------------------------------------------------------------
add("tar good", DL, spec(good));
add("tar good twice (cache re-run)", DL, { ...spec(good), repeat: 2 });
add("tar traversal via prefix", DL, spec([...good, F(`${TOP}/../../evil.txt`, "pwn")]));
add("tar traversal deep", DL, spec([...good, F(`${TOP}/a/../../../../evil.txt`, "pwn")]));
add("tar traversal stays inside", DL, spec([...good, F(`${TOP}/a/../b.txt`, "ok")]));
add("tar double slash member", DL, spec([...good, F(`${TOP}//abs.txt`, "pwn")]));
add("tar dot member", DL, spec([...good, F(`${TOP}/./dot.txt`, "ok")]));
add("tar member is prefix dot", DL, spec([...good, { name: `${TOP}/.`, type: "file", data: "x" }]));
add("tar absolute first member", DL, spec([F("/tmp/abs-evil.txt", "pwn"), ...good]));
add("tar first member is a file", DL, spec([F("README.md", "hi\n"), F(`${TOP}/template.yaml`, TEMPLATE_YAML), F(`${TOP}/Dockerfile`, DOCKERFILE)]));
add("tar first member dir without slash", DL, spec([{ name: TOP, type: "dir" }, F(`${TOP}/template.yaml`, TEMPLATE_YAML), F(`${TOP}/Dockerfile`, DOCKERFILE)]));
add("tar symlink member skipped", DL, spec([...good, { name: `${TOP}/link`, type: "sym", linkname: "/etc/passwd" }]));
add("tar symlink then file through it", DL, spec([...good, { name: `${TOP}/lnk`, type: "sym", linkname: ".." }, F(`${TOP}/lnk/escaped.txt`, "pwn")]));
add("tar symlink dir then file", DL, spec([...good, { name: `${TOP}/sub`, type: "sym", linkname: "/tmp" }, F(`${TOP}/sub/x.txt`, "pwn")]));
add("tar hardlink member skipped", DL, spec([...good, { name: `${TOP}/hl`, type: "hard", linkname: `${TOP}/template.yaml` }]));
add("tar device/fifo skipped", DL, spec([...good, { name: `${TOP}/dev`, type: "chr" }, { name: `${TOP}/fifo`, type: "fifo" }]));
add("tar only dirs", DL, spec([D(`${TOP}/`), D(`${TOP}/sub/`)]));
add("tar empty archive", DL, spec([]));
add("tar duplicate names later wins", DL, spec([...good, F(`${TOP}/dup.txt`, "first"), F(`${TOP}/dup.txt`, "second")]));
add("tar file then dir conflict", DL, spec([...good, F(`${TOP}/a`, "file"), F(`${TOP}/a/b.txt`, "child")]));
add("tar dir then file conflict", DL, spec([...good, F(`${TOP}/a/b.txt`, "child"), F(`${TOP}/a`, "file")]));
add("tar backslash names", DL, spec([...good, F(`${TOP}/..\\evil.txt`, "x"), F(`${TOP}/a\\b.txt`, "y")]));
add("tar unicode names", DL, spec([...good, F(`${TOP}/数据/文件.txt`, "中文\n"), F(`${TOP}/emoji-😀.txt`, "e\n")]));
add("tar name with newline/space", DL, spec([...good, F(`${TOP}/a b\nc.txt`, "x")]));
add("tar component too long", DL, spec([...good, F(`${TOP}/${"x".repeat(300)}.txt`, "x")], { format: "pax" }));
add("tar very long path", DL, spec([...good, F(`${TOP}/${"d/".repeat(120)}f.txt`, "x")], { format: "pax" }));
add("tar pax format", DL, spec(good, { format: "pax" }));
add("tar ustar format", DL, spec(good, { format: "ustar" }));
add("tar file modes", DL, spec([...good, F(`${TOP}/run.sh`, "#!/bin/sh\n", { mode: 0o755 }), F(`${TOP}/secret.txt`, "s", { mode: 0o000 }), F(`${TOP}/suid.sh`, "s", { mode: 0o4755 })]));
add("tar empty file", DL, spec([...good, F(`${TOP}/empty.txt`, "")]));
add("tar big file 12MB", DL, spec([...good, { name: `${TOP}/big.bin`, type: "file", b64: Buffer.alloc(12 << 20, 7).toString("base64") }]));
add("tar bzip2 not gzip", DL, spec(good, { compress: "bz2" }));
add("tar truncated gzip", DL, spec(good, { compress: "trunc" }));
add("tar uncompressed", DL, spec(good, { compress: "none" }));
add("tar html error page 200", DL, { tarball: { status: 200, raw: Buffer.from("<html>login</html>") } });
add("tar zero bytes 200", DL, { tarball: { status: 200, raw: Buffer.alloc(0) } });
add("tar gzip of garbage", DL, { tarball: { status: 200, raw: pyTar({ members: [], compress: "gz" }).subarray(0, 20) } });
add("tar yaml name traversal (registry)", DL, spec([D(`${TOP}/`), F(`${TOP}/template.yaml`, 'name: "../../../escape-reg"\nports: [9000]\n'), F(`${TOP}/Dockerfile`, DOCKERFILE)]));
add("tar yaml name absolute (registry)", DL, spec([D(`${TOP}/`), F(`${TOP}/template.yaml`, 'name: "/tmp/abs-escape-reg"\nports: [9000]\n'), F(`${TOP}/Dockerfile`, DOCKERFILE)]));
add("tar subdir ok", [...T, "install", "owner/repo//sub", ...REG, "--download-only"], spec([D(`${TOP}/`), F(`${TOP}/sub/template.yaml`, TEMPLATE_YAML), F(`${TOP}/sub/Dockerfile`, DOCKERFILE), F(`${TOP}/sub2/x.txt`, "no")]));
add("tar subdir traversal", [...T, "install", "owner/repo//sub/..", ...REG, "--download-only"], spec([D(`${TOP}/`), F(`${TOP}/template.yaml`, TEMPLATE_YAML), F(`${TOP}/Dockerfile`, DOCKERFILE)]));
add("tar subdir traversal dotdot x", [...T, "install", "owner/repo//../x", ...REG, "--download-only"], spec(good));
add("tar subdir empty slash", [...T, "install", "owner/repo//", ...REG, "--download-only"], spec(good));
add("tar subdir leading slash", [...T, "install", "owner/repo///sub", ...REG, "--download-only"], spec([D(`${TOP}/`), F(`${TOP}/sub/template.yaml`, TEMPLATE_YAML), F(`${TOP}/sub/Dockerfile`, DOCKERFILE)]));
add("tar subdir trailing slash", [...T, "install", "owner/repo//sub/", ...REG, "--download-only"], spec([D(`${TOP}/`), F(`${TOP}/sub/template.yaml`, TEMPLATE_YAML), F(`${TOP}/sub/Dockerfile`, DOCKERFILE)]));
add("tar subdir traversal member", [...T, "install", "owner/repo//sub", ...REG, "--download-only"], spec([D(`${TOP}/`), F(`${TOP}/sub/../../../evil.txt`, "pwn"), F(`${TOP}/sub/template.yaml`, TEMPLATE_YAML), F(`${TOP}/sub/Dockerfile`, DOCKERFILE)]));
add("tar subdir with dir entry only", [...T, "install", "owner/repo//sub", ...REG, "--download-only"], spec([D(`${TOP}/`), D(`${TOP}/sub/`)]));
add("tar token header", DL.concat(["--token", "tok-123"]), spec(good));
add("tar redirected (302)", DL, { ...spec(good), env: {} });

// ---- install --dir ------------------------------------------------------------------------------------------------
add("install --dir missing parents", [...DL, "--dir", "{work}/a/b/c"], spec(good));
add("install --dir is a file", [...DL, "--dir", "{work}/f"], { ...spec(good), files: { f: "x" } });
add("install --dir exists empty", [...DL, "--dir", "{work}/e"], { ...spec(good), files: { "e/.keep": "" }, modes: {} });
add("install --dir relative", [...DL, "--dir", "rel/out"], spec(good));
add("install --dir tilde", [...DL, "--dir", "~/out"], spec(good));
add("install --dir dot", [...DL, "--dir", "."], spec(good));
add("install --dir dotdot", [...DL, "--dir", ".."], spec(good));
add("install --dir symlink to dir", [...DL, "--dir", "{work}/lnk"], { ...spec(good), symlinks: [["lnk", "{work}/real"]], files: { "real/.keep": "" } });
add("install --dir empty string", [...DL, "--dir", ""], spec(good));
add("install local --dir copies symlinks", [...T, "install", "{work}/src", "--registry-type", "local", "--download-only", "--dir", "{work}/out"], { files: TPL_IN("src"), symlinks: [["src/link", "/etc/hostname"], ["src/dirlink", "{work}/src"]] });
add("install local default cache", [...T, "install", "{work}/src", "--registry-type", "local", "--download-only"], { files: TPL_IN("src"), repeat: 2 });
add("install local cache name hostile alias", [...T, "install", "{work}/src", "--registry-type", "local", "--download-only", "--alias", "../../escape"], { files: TPL_IN("src") });
add("install local name from yaml traversal", [...T, "install", "{work}/src", "--registry-type", "local", "--download-only"], { files: { ...TPL_IN("src"), "src/template.yaml": 'name: "../../../escape"\n' } });
add("install local name absolute", [...T, "install", "{work}/src", "--registry-type", "local", "--download-only"], { files: { ...TPL_IN("src"), "src/template.yaml": "name: /tmp/abs-escape\n" } });
add("install local src is cache itself", [...T, "install", "{home}/.ebx/templates/demo-tpl", "--registry-type", "local", "--download-only"], { homeFiles: Object.fromEntries(Object.entries(TPL).map(([k, v]) => [`.ebx/templates/demo-tpl/${k}`, v])) });
add("install local src symlink to dir", [...T, "install", "{work}/lnk", "--registry-type", "local", "--download-only"], { files: TPL_IN("src"), symlinks: [["lnk", "{work}/src"]] });
add("install local file path", [...T, "install", "{work}/src/template.yaml", "--registry-type", "local", "--download-only"], { files: TPL_IN("src") });
add("install local trailing slash", [...T, "install", "{work}/src/", "--download-only"], { files: TPL_IN("src") });
add("install local dot", [...T, "install", ".", "--download-only"], { files: TPL_IN(".") });
add("install local tilde", [...T, "install", "~/tpl", "--download-only"], { homeFiles: Object.fromEntries(Object.entries(TPL).map(([k, v]) => [`tpl/${k}`, v])) });

// ---- hostile template.yaml via local install --------------------------------------------------------------------
const ly = (yaml, extra = {}) => ({ files: { "src/template.yaml": yaml, "src/Dockerfile": DOCKERFILE }, ...extra });
const LI = [...T, "install", "{work}/src", "--registry-type", "local", "--download-only", "--dir", "{work}/out"];
for (const [n, y] of Object.entries({
  empty: "",
  "only comment": "# nothing\n",
  list: "- a\n- b\n",
  scalar: "hello\n",
  "int scalar": "42\n",
  null: "null\n",
  "name int": "name: 123\n",
  "name list": "name: [a, b]\n",
  "name null": "name:\n",
  "name empty str": 'name: ""\n',
  "name bool": "name: yes\n",
  "name float": "name: 1.0\n",
  "version number": "name: x\nversion: 1.0\n",
  "version int": "name: x\nversion: 2\n",
  "resources scalar": "name: x\nresources: 4\n",
  "resources list": "name: x\nresources: [1]\n",
  "cpu string": "name: x\nresources:\n  cpu: lots\n",
  "cpu float": "name: x\nresources:\n  cpu: 2.5\n",
  "cpu negative": "name: x\nresources:\n  cpu: -1\n",
  "cpu huge": "name: x\nresources:\n  cpu: 99999999999999999999\n",
  "memory string numeric": 'name: x\nresources:\n  memory: "512"\n',
  "memory bool": "name: x\nresources:\n  memory: true\n",
  "cpu_count flat": "name: x\ncpu_count: 3\nmemory_mb: 128\n",
  "both cpu forms": "name: x\ncpu_count: 3\nresources:\n  cpu: 4\n",
  "unknown field": "name: x\nbogus_field: 1\n",
  "capabilities none": "name: x\ncapabilities: ~\n",
  "capabilities str": "name: x\ncapabilities: shell\n",
  "capabilities bad": "name: x\ncapabilities: [nope]\n",
  "commands odd": "name: x\ncommands: 5\n",
  "tabs": "name:\tx\n",
  "bad indent": "name: x\n  bad: 1\n bad2: 2\n",
  "unclosed flow": "name: [unclosed\n",
  "duplicate keys": "name: a\nname: b\n",
  anchors: "base: &b {cpu: 1}\nname: x\nresources: *b\n",
  "merge key": "base: &b {cpu: 2}\nname: x\nresources:\n  <<: *b\n",
  "python tag": "name: !!python/object/apply:os.system ['echo pwn']\n",
  "binary tag": "name: !!binary aGVsbG8=\n",
  "set tag": "name: x\ntags: !!set {a, b}\n",
  "timestamp": "name: x\nbuilt: 2026-01-01\nbuilt2: 2026-01-01 10:00:00\n",
  "yaml 1.1 bools": "name: x\non: off\nyes: no\n",
  "octal": "name: x\nresources:\n  cpu: 010\n",
  "hex": "name: x\nresources:\n  cpu: 0x10\n",
  "sexagesimal": "name: x\nresources:\n  cpu: 1:30\n",
  "underscore int": "name: x\nresources:\n  cpu: 1_000\n",
  "inf nan": "name: x\nresources:\n  cpu: .inf\n  memory: .nan\n",
  "multi doc": "name: a\n---\nname: b\n",
  "doc marker only": "---\n",
  "bom": "\ufeffname: bom\n",
  "crlf": "name: crlf\r\nversion: '1'\r\n",
  "cjk name": "name: 模板\n",
  "emoji key": "name: x\n😀: 1\n",
  "very deep": `name: x\n${"a: ".repeat(1)}${"[".repeat(200)}${"]".repeat(200)}\n`,
  "huge": `name: x\ndescription: ${"y".repeat(2_000_000)}\n`,
  "null byte": "name: x\u0000y\n",
  "tab key": "\tname: x\n",
  "complex key": "? [a, b]\n: c\nname: x\n",
  "alias undefined": "name: *nope\n",
  "directive": "%YAML 1.1\n---\nname: x\n",
  "directive 1.2": "%YAML 1.2\n---\nname: x\n",
  "block scalar": "name: x\ndescription: |\n  line1\n  line2\n",
  "quoted escapes": 'name: "a\\x41\\u00e9\\U0001F600"\n',
  "bad escape": 'name: "a\\qb"\n',
})) {
  add(`local yaml ${n}`, LI, ly(y));
}
add("local yaml invalid utf8", LI, { files: { "src/template.yaml": Buffer.from([0x6e, 0x61, 0x6d, 0x65, 0x3a, 0x20, 0xff, 0xfe, 0x0a]), "src/Dockerfile": DOCKERFILE } });
add("local yaml utf16", LI, { files: { "src/template.yaml": Buffer.from("\ufeffname: u16\n", "utf16le"), "src/Dockerfile": DOCKERFILE } });
add("local yaml is dir", LI, { files: { "src/template.yaml/inner": "x", "src/Dockerfile": DOCKERFILE } });
add("local yaml is dangling symlink", LI, { files: { "src/Dockerfile": DOCKERFILE }, symlinks: [["src/template.yaml", "{work}/nope"]] });
add("local yaml unreadable", LI, { files: { "src/template.yaml": "name: x\n", "src/Dockerfile": DOCKERFILE }, modes: { "src/template.yaml": 0o000 } });
add("local sandbox-template.yaml fallback", LI, { files: { "src/sandbox-template.yaml": "name: legacy\n", "src/Dockerfile": DOCKERFILE } });
add("local yaml priority", LI, { files: { "src/template.yaml": "name: a\n", "src/sandbox.yaml": "name: b\n", "src/sandbox-template.yaml": "name: c\n", "src/Dockerfile": DOCKERFILE } });

// ---- `_read_yaml_defaults` through template build ---------------------------------------------------------------
const BUILD = [...T, "build", "{work}/tpl", "--acr-namespace", "ns", "--yes"];
for (const [n, y] of Object.entries({
  list: "- a\n",
  scalar: "hello\n",
  "bad yaml": "name: [unclosed\n",
  "cpu text": "name: t\nresources:\n  cpu: lots\n",
  "cpu float": "name: t\nresources:\n  cpu: 2.9\n",
  "cpu bool": "name: t\nresources:\n  cpu: true\n",
  "memory str": 'name: t\nresources:\n  memory: " 2048 "\n',
  "memory neg": "name: t\nresources:\n  memory: -5\n",
  "memory huge": "name: t\nresources:\n  memory: 1e3\n",
  "resources scalar": "name: t\nresources: abc\n",
  "gen": "name: t\ngeneration: 2\n",
  "name list": "name: [a]\n",
  "name int": "name: 7\n",
  "name uppercase": "name: My_Template\n",
  "name unicode": "name: 模板\n",
  "name long": `name: ${"a".repeat(300)}\n`,
})) {
  add(`build yaml ${n}`, BUILD, { files: { "tpl/template.yaml": y, "tpl/Dockerfile": DOCKERFILE }, env: CREDS, docker: true });
}

// ---- search with hostile index ----------------------------------------------------------------------------------
const IDX_URL = ["--index-url", "http://127.0.0.1:{port}/index.yaml"];
const S = (idx, extra = []) => [...T, "search", "x", ...IDX_URL, ...extra];
const entry = (o) => Object.entries(o).map(([k, v]) => `    ${k}: ${v}`).join("\n");
for (const [n, body] of Object.entries({
  empty: "",
  "not a mapping": "- a\n- b\n",
  "no templates": "schema_version: 1\n",
  "templates null": "schema_version: 1\ntemplates:\n",
  "templates not list": "schema_version: 1\ntemplates: abc\n",
  "templates dict": "schema_version: 1\ntemplates:\n  a: 1\n",
  "entry not mapping": "schema_version: 1\ntemplates:\n  - abc\n  - 5\n",
  "entry missing name": `schema_version: 1\ntemplates:\n  -\n${entry({ repo: "o/r", description: "x thing" })}\n`,
  "entry name int": `schema_version: 1\ntemplates:\n  -\n${entry({ name: 123, repo: "o/r", description: "x" })}\n`,
  "entry missing repo": `schema_version: 1\ntemplates:\n  -\n${entry({ name: "x1", description: "x" })}\n`,
  "entry tags str": `schema_version: 1\ntemplates:\n  -\n${entry({ name: "x1", repo: "o/r", tags: "a,b", description: "x" })}\n`,
  "entry tags mixed": `schema_version: 1\ntemplates:\n  -\n${entry({ name: "x1", repo: "o/r", tags: "[1, null, a, [b]]", description: "x" })}\n`,
  "entry status bogus": `schema_version: 1\ntemplates:\n  -\n${entry({ name: "x1", repo: "o/r", status: "weird", description: "x" })}\n`,
  "entry null desc": `schema_version: 1\ntemplates:\n  -\n${entry({ name: "x1", repo: "o/r", description: "~" })}\n`,
  "entry path traversal": `schema_version: 1\ntemplates:\n  -\n${entry({ name: "x1", repo: "o/r", path: "../../etc", ref: "main", description: "x" })}\n`,
  "entry repo url": `schema_version: 1\ntemplates:\n  -\n${entry({ name: "x1", repo: "https://github.com/o/r.git", description: "x" })}\n`,
  "entry repo evil": `schema_version: 1\ntemplates:\n  -\n${entry({ name: "x1", repo: "'o/r@x//y'", ref: "'a b'", description: "x" })}\n`,
  "entry cjk wide": `schema_version: 1\ntemplates:\n  -\n${entry({ name: "x模板", repo: "o/r", description: "'数据分析 😀 x'", author: "作者" })}\n`,
  "entry long desc": `schema_version: 1\ntemplates:\n  -\n${entry({ name: "x1", repo: "o/r", description: `"${"word ".repeat(100)}x"` })}\n`,
  "schema version 2": "schema_version: 2\ntemplates: []\n",
  "schema version str": 'schema_version: "1"\ntemplates: []\n',
  "schema version missing": "templates:\n  - name: x1\n    repo: o/r\n    description: x\n",
  "bad yaml": "templates: [unclosed\n",
  "html": "<html><body>login</body></html>",
  "binary": "\u0000\u0001\u0002",
  "duplicate names": `schema_version: 1\ntemplates:\n  -\n${entry({ name: "x1", repo: "o/r", description: "x" })}\n  -\n${entry({ name: "x1", repo: "o/r2", description: "x" })}\n`,
})) {
  add(`search index ${n}`, S(), { index: text(200, body, "application/yaml") });
  add(`search index ${n} json`, ["--json", ...S()], { index: text(200, body, "application/yaml") });
}
add("search index big", S(), { index: text(200, `schema_version: 1\ntemplates:\n${Array.from({ length: 300 }, (_, i) => `  - {name: x${i}, repo: o/r, description: "x ${i}"}`).join("\n")}\n`) });
add("search index utf8 bom", S(), { index: text(200, "\ufeffschema_version: 1\ntemplates:\n  - {name: x1, repo: o/r, description: x}\n") });
add("search index non-utf8", S(), { index: { status: 200, type: "text/plain", body: Buffer.from([0x73, 0x3a, 0x20, 0xff, 0x0a]) } });
add("search index cached twice", S(), { index: text(200, "schema_version: 1\ntemplates:\n  - {name: x1, repo: o/r, description: x}\n"), repeat: 2 });
add("search index cached then 500 refresh", S(["--refresh"]), { index: text(200, "schema_version: 1\ntemplates:\n  - {name: x1, repo: o/r, description: x}\n"), repeat: 2 });
add("search corrupt cache", S(), { index: text(200, "schema_version: 1\ntemplates:\n  - {name: x1, repo: o/r, description: x}\n"), homeFiles: { ".ebx/cache/template-index.yaml": "garbage: [" } });
add("search index url file://", [...T, "search", "x", "--index-url", "file://{work}/idx.yaml"], { files: { "idx.yaml": "schema_version: 1\ntemplates:\n  - {name: x1, repo: o/r, description: x}\n" } });
add("search index url dir", [...T, "search", "x", "--index-url", "{work}"], {});
add("search index url empty", [...T, "search", "x", "--index-url", ""], {});
add("search query unicode", [...T, "search", "模板", ...IDX_URL], { index: text(200, "schema_version: 1\ntemplates:\n  - {name: x模板, repo: o/r, description: 模板 desc}\n") });
add("search query regex chars", [...T, "search", ".*", ...IDX_URL], { index: text(200, "schema_version: 1\ntemplates:\n  - {name: x1, repo: o/r, description: x}\n") });
add("search query empty string", [...T, "search", "", ...IDX_URL], { index: text(200, "schema_version: 1\ntemplates:\n  - {name: x1, repo: o/r, description: x}\n") });
add("search query uppercase", [...T, "search", "X1", ...IDX_URL], { index: text(200, "schema_version: 1\ntemplates:\n  - {name: x1, repo: o/r, description: x}\n") });
add("search tag filter case", [...T, "search", "x", "--tag", "AI", ...IDX_URL], { index: text(200, "schema_version: 1\ntemplates:\n  - {name: x1, repo: o/r, description: x, tags: [ai]}\n") });

// ---- init --from local with hostile sources -------------------------------------------------------------------------
const IF = [...T, "init", "{work}/dest", "--from", "{work}/src"];
add("init --from symlink in source", IF, { files: TPL_IN("src"), symlinks: [["src/link", "/etc/hostname"], ["src/loop", "{work}/src"]] });
add("init --from src has dotdirs", IF, { files: { ...TPL_IN("src"), "src/.git/config": "[core]\n", "src/.env": "SECRET=1\n", "src/node_modules/x/i.js": "1\n", "src/__pycache__/a.pyc": "x" } });
add("init --from dest inside src", [...T, "init", "{work}/src/dest", "--from", "{work}/src"], { files: TPL_IN("src") });
add("init --from src inside dest", [...T, "init", "{work}", "--from", "{work}/src"], { files: TPL_IN("src") });
add("init --from same dir", [...T, "init", "{work}/src", "--from", "{work}/src", "--force"], { files: TPL_IN("src") });
add("init --from name hostile", [...IF, "--name", "../escape"], { files: TPL_IN("src") });
add("init --from name empty", [...IF, "--name", ""], { files: TPL_IN("src") });
add("init --from name unicode", [...IF, "--name", "模板"], { files: TPL_IN("src") });
add("init --from yaml list", IF, { files: { ...TPL_IN("src"), "src/template.yaml": "- a\n" } });
add("init --from yaml name int", IF, { files: { ...TPL_IN("src"), "src/template.yaml": "name: 5\nversion: 1\n" } });
add("init --from yaml with comments name rewrite", [...IF, "--name", "renamed"], { files: { ...TPL_IN("src"), "src/template.yaml": "# head\nname: orig   # trailing\nversion: '1'\nextra:\n  name: nested\n" } });
add("init --from yaml name rewrite flow", [...IF, "--name", "renamed"], { files: { ...TPL_IN("src"), "src/template.yaml": "{name: orig, version: '1'}\n" } });
add("init --from yaml name rewrite quoted", [...IF, "--name", "renamed"], { files: { ...TPL_IN("src"), "src/template.yaml": 'name: "orig"\nversion: "1"\n' } });
add("init --from yaml name rewrite crlf", [...IF, "--name", "renamed"], { files: { ...TPL_IN("src"), "src/template.yaml": "name: orig\r\nversion: '1'\r\n" } });
add("init --from yaml name missing", [...IF, "--name", "renamed"], { files: { ...TPL_IN("src"), "src/template.yaml": "version: '1'\n" } });
add("init --from yaml name rewrite multi-doc", [...IF, "--name", "renamed"], { files: { ...TPL_IN("src"), "src/template.yaml": "name: orig\n---\nname: other\n" } });
add("init --from dest is file", IF, { files: { ...TPL_IN("src"), dest: "x" } });
add("init --from src unreadable file", IF, { files: TPL_IN("src"), modes: { "src/commands.py": 0o000 } });
add("init --from src is file", [...T, "init", "{work}/dest", "--from", "{work}/src/Dockerfile"], { files: TPL_IN("src") });
add("init --from owner/repo tarball hostile", [...T, "init", "{work}/dest", "--from", "owner/repo", ...REG, "-y"], spec([...good, F(`${TOP}/../../evil.txt`, "pwn")]));
add("init --from owner/repo tarball good", [...T, "init", "{work}/dest", "--from", "owner/repo", ...REG, "-y"], spec(good));
add("init --from owner/repo//sub@ref", [...T, "init", "{work}/dest", "--from", "owner/repo//sub@v1", ...REG, "-y"], spec([D(`${TOP}/`), F(`${TOP}/sub/template.yaml`, TEMPLATE_YAML), F(`${TOP}/sub/Dockerfile`, DOCKERFILE)]));

process.exit((await runSuite(cases, { title: "adv_agent_template_install" })) === 0 ? 0 : 1);

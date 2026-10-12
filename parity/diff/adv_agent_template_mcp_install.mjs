#!/usr/bin/env node
/**
 * Adversarial differential: `mcp install` (IDE config writers: symlinked / dangling / read-only / odd-mode configs, odd key and
 * URL values, odd pre-existing JSON) and `mcp deploy` (artifact bytes: YAML scalar quoting of hostile values, token files,
 * output-dir edge cases).
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/adv_agent_template_mcp_install.mjs [--verbose] [--only <substr>]
 *
 * The Python-only IDE launcher (`command`/`args`) is masked before hashing, see PORTING.md. Exit 0 = identical.
 */
import { requireOracle, runSuite, setFileNormaliser } from "./adv_agent_template_lib.mjs";

requireOracle();
setFileNormaliser((name, data) => {
  if (!/\.(json|yaml)$/.test(name)) return null;
  const t = data
    .toString("utf8")
    .replace(/"command":\s*"[^"]*",\s*"args":\s*\[[^\]]*\]/g, '"command":"<L>","args":"<A>"')
    .replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>");
  return Buffer.from(t);
});

const cases = [];
const add = (name, argv, opts = {}) => {
  const o = { ...opts };
  if (argv[1] === "deploy" && !argv.includes("--auth-token-file") && !(o.env && "EBX_MCP_AUTH_TOKEN" in o.env)) o.env = { ...o.env, EBX_MCP_AUTH_TOKEN: "fixed-token-123" };
  cases.push({ name, argv, ...o });
};
const I = (t) => ["mcp", "install", "--target", t];
const CUR = ".cursor/mcp.json";
const CLA = ".config/claude/claude_desktop_config.json";
const VS = ".vscode/mcp.json";
const KEY = { E2B_API_KEY: "k-1" };

// ---- install: config file topology ----------------------------------------------------------------------------------
add("cursor: symlinked config -> real file", I("cursor"), { env: KEY, homeFiles: { "real.json": '{"mcpServers": {"x": {"command": "y"}}}' }, homeSymlinks: [[CUR, "{home}/real.json"]] });
add("cursor: dangling symlink config", I("cursor"), { env: KEY, homeSymlinks: [[CUR, "{home}/nowhere/new.json"]] });
add("cursor: dangling symlink, parent exists", I("cursor"), { env: KEY, homeFiles: { "elsewhere/.keep": "" }, homeSymlinks: [[CUR, "{home}/elsewhere/new.json"]] });
add("cursor: symlinked .cursor dir", I("cursor"), { env: KEY, homeFiles: { "other/mcp.json": '{"a": 1}' }, homeSymlinks: [[".cursor", "{home}/other"]] });
add("cursor: dangling symlinked .cursor dir", I("cursor"), { env: KEY, homeSymlinks: [[".cursor", "{home}/nowhere"]] });
add("cursor: symlink loop", I("cursor"), { env: KEY, homeSymlinks: [[CUR, "{home}/.cursor/mcp.json"]] });
add("cursor: symlink to directory", I("cursor"), { env: KEY, homeFiles: { "d/.keep": "" }, homeSymlinks: [[CUR, "{home}/d"]] });
add("cursor: existing 0600 keeps mode", I("cursor"), { env: KEY, homeFiles: { [CUR]: '{"a": 1}' }, homeModes: { [CUR]: 0o600 } });
add("cursor: existing 0444 read-only", I("cursor"), { env: KEY, homeFiles: { [CUR]: '{"a": 1}' }, homeModes: { [CUR]: 0o444 } });
add("cursor: existing 0000 unreadable", I("cursor"), { env: KEY, homeFiles: { [CUR]: '{"a": 1}' }, homeModes: { [CUR]: 0o000 } });
add("cursor: existing 0755 exec bit", I("cursor"), { env: KEY, homeFiles: { [CUR]: '{"a": 1}' }, homeModes: { [CUR]: 0o755 } });
add("cursor: .cursor dir 0500", I("cursor"), { env: KEY, homeFiles: { [CUR]: '{"a": 1}' }, homeModes: { ".cursor": 0o500 } });
add("cursor: .cursor dir 0500 new file", I("cursor"), { env: KEY, homeFiles: { ".cursor/.keep": "" }, homeModes: { ".cursor": 0o500 } });
add("cursor: home .cursor is a file", I("cursor"), { env: KEY, homeFiles: { ".cursor": "x" } });
add("cursor: hard-linked config (shared inode)", I("cursor"), { env: KEY, homeFiles: { "orig.json": '{"a": 1}' }, homeSymlinks: [] });
add("cursor: first run + second run (idempotent)", I("cursor"), { env: KEY, repeat: 2 });
add("cursor: two targets sequentially via repeat", I("cursor"), { env: KEY, repeat: 3, homeFiles: { [CUR]: '{"mcpServers": {"easy-sandbox": {"x": 1}, "b": 2}}' } });
add("claude: symlinked config dir", I("claude"), { env: KEY, homeFiles: { "cl/.keep": "" }, homeSymlinks: [[".config/claude", "{home}/cl"]] });
add("claude: .config is a file", I("claude"), { env: KEY, homeFiles: { ".config": "x" } });
add("claude: XDG_CONFIG_HOME ignored", I("claude"), { env: { ...KEY, XDG_CONFIG_HOME: "{home}/xdg" } });
add("claude: APPDATA ignored", I("claude"), { env: { ...KEY, APPDATA: "{home}/appdata" } });
add("claude: existing mac-style path untouched", I("claude"), { env: KEY, homeFiles: { "Library/Application Support/Claude/claude_desktop_config.json": '{"a": 1}' } });
add("vscode: .vscode is a file", I("vscode"), { env: KEY, files: { ".vscode": "x" } });
add("vscode: symlinked .vscode", I("vscode"), { env: KEY, files: { "real/.keep": "" }, symlinks: [[".vscode", "{work}/real"]] });
add("vscode: existing with inputs + servers", I("vscode"), { env: KEY, files: { [VS]: '{"inputs": [{"id": "k"}], "servers": {"a": {"command": "b"}, "easy-sandbox": {"old": true}}}' } });
add("vscode: servers is a list", I("vscode"), { env: KEY, files: { [VS]: '{"servers": [1]}' } });
add("vscode: key never copied", I("vscode"), { env: { E2B_API_KEY: "SECRET-KEY-XYZ", E2B_API_URL: "http://u", SANDBOX_REGION: "r" } });
add("vscode: only region env", I("vscode"), { env: { SANDBOX_REGION: "r" } });
add("vscode: only key env (env block dropped)", I("vscode"), { env: KEY });

// ---- install: values -----------------------------------------------------------------------------------------------
const WEIRD = {
  quote: 'a"b',
  backslash: "a\\b",
  newline: "a\nb",
  tab: "a\tb",
  unicode: "héllo 模板 😀",
  lsep: "a\u2028b",
  nel: "a\u0085b",
  del: "a\u007fb",
  ctl: "a\u0001b",
  slash: "a/b</script>",
  space: "  padded  ",
  long: "x".repeat(5000),
  json: '{"a":1}',
  nullish: "null",
  zero: "0",
  bom: "\ufeffk",
};
for (const [n, v] of Object.entries(WEIRD)) {
  add(`cursor: key value ${n}`, I("cursor"), { env: { E2B_API_KEY: v } });
  add(`cursor: api url value ${n}`, I("cursor"), { env: { E2B_API_URL: v } });
  add(`cursor: region value ${n}`, I("cursor"), { env: { SANDBOX_REGION: v } });
}
add("cursor: env file key with quotes (.env)", I("cursor"), { files: { ".env": 'E2B_API_KEY="quoted key"\n' } });
add("cursor: env file key single quotes", I("cursor"), { files: { ".env": "E2B_API_KEY='single'\n" } });
add("cursor: env file key with export", I("cursor"), { files: { ".env": "export E2B_API_KEY=exported\n" } });
add("cursor: env file key with comment", I("cursor"), { files: { ".env": "E2B_API_KEY=abc # trailing\n" } });
add("cursor: env file CRLF", I("cursor"), { files: { ".env": "E2B_API_KEY=crlf\r\nOTHER=1\r\n" } });
add("cursor: env file BOM", I("cursor"), { files: { ".env": "\ufeffE2B_API_KEY=bom\n" } });
add("cursor: env file unicode", I("cursor"), { files: { ".env": "E2B_API_KEY=héllo\n" } });
add("cursor: env file invalid utf8", I("cursor"), { files: { ".env": Buffer.from("E2B_API_KEY=\xff\xfe\n", "latin1") } });
add("cursor: env file dup keys", I("cursor"), { files: { ".env": "E2B_API_KEY=a\nE2B_API_KEY=b\n" } });
add("cursor: env file multi-line quoted", I("cursor"), { files: { ".env": 'E2B_API_KEY="a\nb"\n' } });
add("cursor: env file interpolation", I("cursor"), { files: { ".env": "BASE=x\nE2B_API_KEY=${BASE}y\n" } });
add("cursor: env file escapes in double quotes", I("cursor"), { files: { ".env": 'E2B_API_KEY="a\\nb\\tc\\"d"\n' } });
add("cursor: env file spaces around =", I("cursor"), { files: { ".env": "E2B_API_KEY = spaced \n" } });
add("cursor: env file empty value", I("cursor"), { files: { ".env": "E2B_API_KEY=\n" }, homeFiles: { ".ebx/.env": "E2B_API_KEY=home\n" } });
add("cursor: env file is a directory", I("cursor"), { files: { ".env/x": "1" } });
add("cursor: config.toml odd key", I("cursor"), { homeFiles: { ".ebx/config.toml": '[transport]\napi_key = "a\\"b"\n' } });
add("cursor: config.toml invalid", I("cursor"), { homeFiles: { ".ebx/config.toml": "[transport\napi_key = 1\n" } });
add("cursor: config.toml key not string", I("cursor"), { homeFiles: { ".ebx/config.toml": "[transport]\napi_key = 5\n" } });
add("cursor: config.toml top-level api_key", I("cursor"), { homeFiles: { ".ebx/config.toml": 'api_key = "top"\n' } });

// ---- install: odd pre-existing JSON ---------------------------------------------------------------------------------
const PRE = {
  "dup keys": '{"mcpServers": {"easy-sandbox": 1, "a": 2, "easy-sandbox": 3}, "k": 1, "k": 2}',
  "key order": '{"z": 1, "mcpServers": {"b": 1, "easy-sandbox": {"old": 1}, "a": 2}, "a": 3}',
  "numeric keys": '{"2": 1, "10": 2, "1": 3, "mcpServers": {}}',
  "big int": `{"n": ${"9".repeat(40)}}`,
  "float forms": '{"a": 1.0, "b": 1e5, "c": 1E-5, "d": -0.0, "e": 0.1, "f": 1e22, "g": 123456789012345678.0}',
  "huge float": '{"a": 1e999, "b": -1e999}',
  "neg zero int": '{"a": -0}',
  "escapes": '{"a": "\\u00e9\\n\\t\\/\\b\\f\\r\\u0000\\u001f\\u007f\\u2028\\ud83d\\ude00"}',
  "lone surrogate": '{"a": "\\ud800"}',
  "raw non-bmp": '{"a": "😀𝒜"}',
  "tabs indent": '{\n\t"a":\t1\n}\n',
  "crlf": '{\r\n  "a": 1\r\n}\r\n',
  "trailing ws": '{"a": 1}   \n\n\n',
  "leading ws": '\n\n  {"a": 1}',
  "mcpServers null": '{"mcpServers": null}',
  "mcpServers list": '{"mcpServers": []}',
  "mcpServers string": '{"mcpServers": "x"}',
  "mcpServers has easy-sandbox string": '{"mcpServers": {"easy-sandbox": "x"}}',
  "nested deep": `{"a": ${"[".repeat(900)}${"]".repeat(900)}}`,
  "nested too deep": `{"a": ${"[".repeat(5000)}${"]".repeat(5000)}}`,
  "long string": `{"a": "${"é".repeat(100000)}"}`,
  "empty object": "{}",
  "only ws": "   \n",
  "nul byte": '{"a": 1}\u0000',
  "two docs": '{"a": 1}{"b": 2}',
  "single quotes": "{'a': 1}",
  "number root": "1",
  "bool root": "true",
  "bom crlf": '\ufeff{"a": 1}',
  "key with newline": '{"a\\nb": 1}',
  "empty key": '{"": 1}',
  "comment": '{"a": 1} // x',
  "hex": '{"a": 0x10}',
  "leading plus": '{"a": +1}',
  "leading zero": '{"a": 01}',
  "capitalised literals": '{"a": True}',
  "nan key": '{"NaN": NaN, "-Infinity": -Infinity}',
};
for (const [n, c] of Object.entries(PRE)) add(`cursor: existing ${n}`, I("cursor"), { env: KEY, homeFiles: { [CUR]: c } });
add("cursor: existing 10MB", I("cursor"), { env: KEY, homeFiles: { [CUR]: `{"pad": "${"a".repeat(10 << 20)}"}` } });
add("cursor: existing invalid utf8 in string", I("cursor"), { env: KEY, homeFiles: { [CUR]: Buffer.from('{"a": "\xff"}', "latin1") } });
add("cursor: existing utf-16 file", I("cursor"), { env: KEY, homeFiles: { [CUR]: Buffer.from('\ufeff{"a": 1}', "utf16le") } });
add("claude: existing dup keys", I("claude"), { env: KEY, homeFiles: { [CLA]: PRE["dup keys"] } });
add("vscode: existing dup keys", I("vscode"), { env: KEY, files: { [VS]: '{"servers": {"easy-sandbox": 1, "a": 2, "easy-sandbox": 3}}' } });

// ---- install: option parsing ---------------------------------------------------------------------------------------
add("install: --target twice (last wins)", ["mcp", "install", "--target", "cursor", "--target", "vscode"], { env: KEY });
add("install: --target=cursor form", ["mcp", "install", "--target=cursor"], { env: KEY });
add("install: --tar prefix abbreviation", ["mcp", "install", "--tar", "cursor"], { env: KEY });
add("install: --target empty", ["mcp", "install", "--target", ""], { env: KEY });
add("install: global --json", ["--json", "mcp", "install", "--target", "vscode"], { env: KEY });
add("install: global --no-color", ["--no-color", "mcp", "install", "--target", "claude"], { env: KEY });
add("install: -- terminator", ["mcp", "install", "--target", "cursor", "--"], { env: KEY });
add("install: NO_COLOR env", I("cursor"), { env: { ...KEY, NO_COLOR: "1" } });
add("install: FORCE_COLOR env", I("cursor"), { env: { ...KEY, FORCE_COLOR: "1" } });
add("install: COLUMNS narrow", I("cursor"), { env: { ...KEY, COLUMNS: "20" } });
add("install: path with spaces / unicode home", I("cursor"), { env: KEY, homeFiles: {} });

// ---- deploy: scalar quoting of hostile values in config.yaml ------------------------------------------------------------
const D = (extra = []) => ["mcp", "deploy", "--output-dir", "out", ...extra];
const SCALARS = [
  "yes", "no", "on", "off", "true", "false", "True", "NULL", "null", "~", "Null", "y", "n", "Y", "N",
  "1", "-1", "+1", "1.5", "1e3", "1E3", ".5", "-.5", "+.5", ".inf", "-.inf", ".nan", ".NaN", "0x1f", "0o17", "017", "0b101", "1_000", "08", "09", "1:30", "1:30:00", "190:20:30", "1,000",
  "2026-01-01", "2026-1-1", "2026-01-01 10:00:00", "2026-01-01T10:00:00Z", "2026-13-01",
  "=", "<<", "<< ", "!", "!!str", "!!int 5", "&a", "*a", "- a", "-", "--", "---", "...", "? a", "?", ":", ": a", "a: b", "a:b", "a :b", "a: ", "a:", "a #b", "a#b", "#a", " #a",
  "[a]", "{a}", "[", "]", "{", "}", ",", "a, b", "[a, b]", "{a: b}", "'", '"', "'a'", '"a"', "`a`", "@a", "%a", "|", ">", "| a", "> a", "|-", "a|", "a>",
  " ", "  a", "a  ", " a ", "a\tb", "\ta", "a\t", "a\nb", "a\n", "\na", "a\n\nb", "a\r\nb", "a\rb", "\n", "\t", "a\u00a0b", "\u00a0", "a\u2028b", "a\u2029b", "a\u0085b", "\u0085",
  "a\u007fb", "a\u0001b", "a\u001bb", "a\u0007b", "a\u0000b".replace("\u0000", "\u0002"), "\ufeff", "a\ufeffb", "a\ufffeb", "a\uffffb",
  "é", "模板", "😀", "😀 a", "a 😀", "\u200b", "a\u200bb", "\u3000", "ａ", "İ", "ǅ", "ﬃ",
  "a".repeat(79), "a".repeat(80), "a".repeat(81), "a".repeat(200), `${"word ".repeat(40)}end`, `${"word ".repeat(40)} `, `${"é".repeat(100)}`, `${"模".repeat(100)}`, `${"a ".repeat(100)}`, `${"a".repeat(70)} b`, `${"a".repeat(79)} b`, `${"a".repeat(78)} b c`, "a ".repeat(39) + "b", `x: ${"a".repeat(100)}`, `"${"a ".repeat(50)}"`,
  "http://x.example/a?b=c#d", "C:\\path", "a\\b", "a\\nb", "$HOME", "${X}", "a'b", 'a"b', "a'b\"c", "it's", "'a", 'a"', "tab\there", "a:\tb", "a: b: c", "key: value\nother: x", "- a\n- b", "[1, 2]\n", "{{x}}", "a, b: c",
  "0", "00", "0.", "0.0", ".0", "0e0", "1.", "1.e3", "+1.5e+3", "-0", "-0.0", "0xG", "0x", "1e", "e3", "1e3e", "1__0", "_1", "1_", "0_8", "0b", "0o", "0b2", "0o8", "12e03", "6.02e23", "1.0e+3",
  "Yes", "YES", "No", "NO", "On", "ON", "Off", "OFF", "tRuE", "nULL", "NuLL", "TRUE", "FALSE", "False",
  "<<:", "= a", "=a", "a =", "a=b",
  "\\", "\\\\", "\"\\\"", "/", "//", "a//b",
  "%YAML 1.1", "%TAG ! tag:x,2000:", "--- a", "... a", "a ---", "a ...",
];
const seen = new Set();
let si = 0;
for (const v of SCALARS) {
  if (seen.has(v)) continue;
  seen.add(v);
  si += 1;
  const label = JSON.stringify(v).slice(0, 40);
  if (v.includes("\u0000")) continue;
  add(`deploy: name ${si} ${label}`, D(["--name", v, "--api-key", "k"]));
  add(`deploy: api-key ${si} ${label}`, D(["--api-key", v]));
  add(`deploy: template ${si} ${label}`, D(["--template", v, "--api-key", "k"]));
}
add("deploy: custom-domain odd", D(["--custom-domain", "a: b # c", "--api-key", "k"]));
add("deploy: custom-domain empty", D(["--custom-domain", "", "--api-key", "k"]));
add("deploy: api-key empty uses env", D(["--api-key", ""]), { env: { E2B_API_KEY: "envk" } });
add("deploy: api-key empty uses .env", D(["--api-key", ""]), { files: { ".env": "E2B_API_KEY=dotenv\n" }, env: { E2B_API_KEY: null } });
add("deploy: api-key from env only", D([]), { env: { E2B_API_KEY: "x y" } });
add("deploy: api url env odd", D(["--api-key", "k"]), { env: { E2B_API_URL: "http://u?a=b&c=d#e" } });
add("deploy: api url SANDBOX_API_BASE_URL", D(["--api-key", "k"]), { env: { E2B_API_URL: null, SANDBOX_API_BASE_URL: "http://base" } });
add("deploy: memory/timeout negative", D(["--memory", "-5", "--timeout", "-1", "--api-key", "k"]));
add("deploy: memory/timeout zero", D(["--memory", "0", "--timeout", "0", "--api-key", "k"]));
add("deploy: memory huge", D(["--memory", "99999999999999999999999", "--api-key", "k"]));
add("deploy: memory underscore", D(["--memory", "1_0", "--api-key", "k"]));
add("deploy: memory plus sign", D(["--memory", "+7", "--api-key", "k"]));
add("deploy: memory whitespace", D(["--memory", " 7 ", "--api-key", "k"]));
add("deploy: memory float", D(["--memory", "7.0", "--api-key", "k"]));
add("deploy: memory unicode digits", D(["--memory", "\u0667", "--api-key", "k"]));
add("deploy: memory fullwidth digits", D(["--memory", "７", "--api-key", "k"]));
add("deploy: memory hex", D(["--memory", "0x10", "--api-key", "k"]));
add("deploy: memory empty", D(["--memory", "", "--api-key", "k"]));
add("deploy: no-session-affinity", D(["--no-session-affinity", "--api-key", "k"]));
add("deploy: enable then disable (last wins)", D(["--enable-session-affinity", "--no-session-affinity", "--api-key", "k"]));
add("deploy: region odd", D(["--region", "cn-x: y", "--api-key", "k"]));
add("deploy: region empty", D(["--region", "", "--api-key", "k"]));
add("deploy: region env odd", D(["--api-key", "k"]), { env: { SANDBOX_REGION: "  r  " } });

// ---- deploy: token sources ------------------------------------------------------------------------------------------
const TF = (content, extra = []) => ["mcp", "deploy", "--auth-token-file", "tok", "--output-dir", "out", "--api-key", "k", ...extra];
for (const [n, c] of Object.entries({
  plain: "secret\n",
  "crlf": "secret\r\n",
  "bom": "\ufeffsecret\n",
  "inner spaces": "se cret\n",
  "inner newline": "line1\nline2\n",
  "tabs": "\tsecret\t\n",
  "empty": "",
  "only whitespace": " \n\t\n",
  "unicode": "tök😀\n",
  "yaml special": "a: b # c\n",
  "quotes": "a'b\"c\n",
  "long 5000": `${"a".repeat(5000)}\n`,
  "long with spaces": `${"ab ".repeat(100)}\n`,
  "nbsp": "\u00a0secret\u00a0\n",
  "unicode ws": "\u2003secret\u2003\n",
  "ctrl chars": "a\u0001b\n",
  "vt ff": "\u000bsecret\u000c\n",
  "x1c-x1f": "\u001csecret\u001f\n",
  "nul": "a\u0000b\n",
  "json": '{"token": "x"}\n',
  "numeric": "12345\n",
  "bool-like": "yes\n",
  "null-like": "null\n",
})) add(`deploy: token file ${n}`, TF(c), { files: { tok: c } });
add("deploy: token file invalid utf-8", TF(""), { files: { tok: Buffer.from([0x61, 0xff, 0x62]) } });
add("deploy: token file utf-16", TF(""), { files: { tok: Buffer.from("\ufeffsecret", "utf16le") } });
add("deploy: token file is directory", TF(""), { files: { "tok/x": "1" } });
add("deploy: token file missing", TF(""));
add("deploy: token file unreadable", TF(""), { files: { tok: "secret" }, modes: { tok: 0o000 } });
add("deploy: token file symlink", TF(""), { files: { real: "secret\n" }, symlinks: [["tok", "{work}/real"]] });
add("deploy: token file 1MB", TF(""), { files: { tok: `${"a".repeat(1 << 20)}\n` } });
add("deploy: token file beats --generate-token", ["mcp", "deploy", "--auth-token-file", "tok", "--generate-token", "--output-dir", "out", "--api-key", "k"], { files: { tok: "filetoken\n" } });
add("deploy: empty token file beats --generate-token", ["mcp", "deploy", "--auth-token-file", "tok", "--generate-token", "--output-dir", "out", "--api-key", "k"], { files: { tok: "" } });
add("deploy: env token", ["mcp", "deploy", "--output-dir", "out", "--api-key", "k"], { env: { EBX_MCP_AUTH_TOKEN: "  envtok  " } });
add("deploy: env token whitespace only", ["mcp", "deploy", "--output-dir", "out", "--api-key", "k"], { env: { EBX_MCP_AUTH_TOKEN: "  " } });
add("deploy: env token newline", ["mcp", "deploy", "--output-dir", "out", "--api-key", "k"], { env: { EBX_MCP_AUTH_TOKEN: "a\nb" } });
add("deploy: no token at all", ["mcp", "deploy", "--output-dir", "out", "--api-key", "k"], { env: { EBX_MCP_AUTH_TOKEN: null } });
add("deploy: token printed masked (short)", TF(""), { files: { tok: "abc\n" } });
add("deploy: token printed masked (8)", TF(""), { files: { tok: "12345678\n" } });
add("deploy: token printed masked (9)", TF(""), { files: { tok: "123456789\n" } });
add("deploy: token printed masked (unicode 9)", TF(""), { files: { tok: "ééééééééé\n" } });
add("deploy: token printed masked (emoji)", TF(""), { files: { tok: "😀😀😀😀😀😀😀😀😀\n" } });

// ---- deploy: output dir topology -----------------------------------------------------------------------------------
add("deploy: output-dir exists with files (overwrite)", D(["--api-key", "k"]), { files: { "out/app.py": "OLD", "out/extra.txt": "keep", "out/requirements.txt": "OLD" } });
add("deploy: output-dir is a file", D(["--api-key", "k"]), { files: { out: "x" } });
add("deploy: output-dir parent is a file", ["mcp", "deploy", "--output-dir", "f/out", "--api-key", "k"], { files: { f: "x" } });
add("deploy: output-dir nested new", ["mcp", "deploy", "--output-dir", "a/b/c", "--api-key", "k"]);
add("deploy: output-dir symlink to dir", D(["--api-key", "k"]), { files: { real: "" }, symlinks: [["out", "{work}/real-dir"]], homeFiles: {} });
add("deploy: output-dir symlinked file inside", D(["--api-key", "k"]), { files: { "out/.keep": "" }, symlinks: [["out/app.py", "{work}/target.py"]] });
add("deploy: output-dir dangling symlink inside", D(["--api-key", "k"]), { files: { "out/.keep": "" }, symlinks: [["out/config.yaml", "{work}/nowhere/x.yaml"]] });
add("deploy: output-dir read-only", D(["--api-key", "k"]), { files: { "out/.keep": "" }, modes: { out: 0o500 } });
add("deploy: output-dir existing files read-only", D(["--api-key", "k"]), { files: { "out/app.py": "OLD" }, modes: { "out/app.py": 0o444 } });
add("deploy: output-dir with spaces/unicode", ["mcp", "deploy", "--output-dir", "my out/模板 dir", "--api-key", "k"]);
add("deploy: output-dir dot", ["mcp", "deploy", "--output-dir", ".", "--api-key", "k"]);
add("deploy: output-dir dotdot", ["mcp", "deploy", "--output-dir", "sub/..", "--api-key", "k"], { files: { "sub/.keep": "" } });
add("deploy: output-dir trailing slash", ["mcp", "deploy", "--output-dir", "out/", "--api-key", "k"]);
add("deploy: output-dir empty (falls to tmp)", ["mcp", "deploy", "--output-dir", "", "--api-key", "k"]);
add("deploy: output-dir with sibling dirs listed", D(["--api-key", "k"]), { files: { "out/zz/.keep": "", "out/AA": "x", "out/.hidden": "y", "out/é": "z" } });
add("deploy: two runs same dir (tokens differ)", D(["--api-key", "k"]), { repeat: 2 });
add("deploy: name with slash", D(["--name", "a/b", "--api-key", "k"]));
add("deploy: name empty", D(["--name", "", "--api-key", "k"]));
add("deploy: unknown option", D(["--bogus"]));
add("deploy: positional arg", D(["extra"]));
add("deploy: --json", ["--json", "mcp", "deploy", "--output-dir", "out", "--api-key", "k"]);
add("deploy: --quiet", ["--quiet", "mcp", "deploy", "--output-dir", "out", "--api-key", "k"]);
add("deploy: no api key anywhere", D([]), { env: { E2B_API_KEY: null } });
add("deploy: COLUMNS narrow", D(["--api-key", "k"]), { env: { COLUMNS: "20" } });

process.exit((await runSuite(cases, { title: "adv_agent_template_mcp_install" })) ? 1 : 0);

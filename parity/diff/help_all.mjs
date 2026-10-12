#!/usr/bin/env node
/**
 * Differential test of the `--help` / `-h` output of EVERY command the original Python CLI registers (the tree is
 * enumerated from the oracle itself, so a command missing in the port shows up as a diff), at several terminal widths,
 * plus the root usage-error paths. Isolated HOME per run, no credentials.
 *
 *   ORACLE_VENV=/path/to/venv node parity/diff/help_all.mjs [--verbose] [--only <substr>] [--widths 80,40,200]
 *
 * Compared per case: exit code, stdout, stderr. Exit code 0 = identical, 1 = differences, 2 = oracle missing.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORACLE_VENV = process.env.ORACLE_VENV;
const verbose = process.argv.includes("--verbose");
const argAfter = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
};
const only = argAfter("--only");
const widths = (argAfter("--widths") ?? "80,40,200").split(",").map(Number);

if (!ORACLE_VENV || !existsSync(join(ORACLE_VENV, "bin", "ebx"))) {
  console.error("ORACLE_VENV must point to a venv with the original easy-sandbox installed (see docs/PORTING.md).");
  process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), "ebx-help-"));
const WALK = `
import click, json
from easy_sandbox.cli.main import cli
out = []
def walk(cmd, path):
    ctx = click.Context(cmd, info_name=" ".join(path))
    if isinstance(cmd, click.Group):
        for n in cmd.list_commands(ctx):
            sub = cmd.get_command(ctx, n)
            if sub is None:
                continue
            out.append(path + [n])
            walk(sub, path + [n])
walk(cli, [])
print(json.dumps(out))
`;
const home0 = mkdtempSync(join(scratch, "walk-"));
const walked = spawnSync(join(ORACLE_VENV, "bin", "python"), ["-c", WALK], {
  env: { ...process.env, HOME: home0, USERPROFILE: home0, EBX_NO_KEYCHAIN: "1" },
  encoding: "utf8",
});
if (walked.status !== 0) {
  console.error(walked.stderr);
  process.exit(2);
}
const PATHS = [[], ...JSON.parse(walked.stdout.trim().split("\n").pop())];

const cases = [];
for (const w of widths) {
  for (const p of PATHS) cases.push({ name: `${p.join(" ") || "<root>"} --help @${w}`, argv: [...p, "--help"], env: { COLUMNS: String(w) } });
}
for (const p of PATHS) cases.push({ name: `${p.join(" ") || "<root>"} -h @80`, argv: [...p, "-h"], env: { COLUMNS: "80" } });
// Root behaviours that are not a plain --help of a command.
cases.push(
  { name: "<no args>", argv: [], env: { COLUMNS: "80" } },
  { name: "--version", argv: ["--version"], env: { COLUMNS: "80" } },
  { name: "unknown command", argv: ["frobnicate"], env: { COLUMNS: "80" } },
  { name: "unknown option", argv: ["--frobnicate"], env: { COLUMNS: "80" } },
  { name: "bad --log-level", argv: ["--log-level", "LOUD", "list"], env: { COLUMNS: "80" } },
  { name: "bad --timeout", argv: ["--timeout", "x", "list"], env: { COLUMNS: "80" } },
  { name: "--help NO_COLOR unset + FORCE_COLOR", argv: ["--help"], env: { COLUMNS: "80", NO_COLOR: "", FORCE_COLOR: "1" } },
  { name: "sandbox no args", argv: ["sandbox"], env: { COLUMNS: "80" } },
  { name: "sandbox files no args", argv: ["sandbox", "files"], env: { COLUMNS: "80" } },
  { name: "mcp no args", argv: ["mcp"], env: { COLUMNS: "80" } },
  { name: "template no args", argv: ["template"], env: { COLUMNS: "80" } },
  { name: "config no args", argv: ["config"], env: { COLUMNS: "80" } },
  { name: "unknown sandbox subcommand", argv: ["sandbox", "frobnicate"], env: { COLUMNS: "80" } },
  { name: "unknown config subcommand", argv: ["config", "frobnicate"], env: { COLUMNS: "80" } },
  { name: "missing argument", argv: ["info"], env: { COLUMNS: "80" } },
  { name: "unexpected extra argument", argv: ["info", "a", "b"], env: { COLUMNS: "80" } },
  { name: "--json missing argument", argv: ["--json", "info"], env: { COLUMNS: "80" } },
);

const tsx = pathToFileURL(join(CLI_ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs")).href;
const entry = join(CLI_ROOT, "src", "bin", "ebx.ts");

function runOne(kind, argv, extraEnv) {
  const home = mkdtempSync(join(scratch, `${kind}-`));
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    EBX_NO_KEYCHAIN: "1",
    NO_COLOR: "1",
    TERM: "dumb",
    LANG: "C.UTF-8",
    ...extraEnv,
  };
  if (env.NO_COLOR === "") delete env.NO_COLOR;
  const [cmd, args] =
    kind === "py" ? [join(ORACLE_VENV, "bin", "ebx"), argv] : [process.execPath, ["--import", tsx, entry, ...argv]];
  return new Promise((ok) => {
    const proc = spawn(cmd, args, { cwd: home, env, stdio: ["ignore", "pipe", "pipe"] });
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
  });
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
let diffs = 0;
try {
  const results = await pool(selected, 8, async (c) => ({ py: await runOne("py", c.argv, c.env), node: await runOne("node", c.argv, c.env) }));
  selected.forEach((c, i) => {
    const { py, node } = results[i];
    const problems = [];
    if (py.code !== node.code) problems.push(`exit: py=${py.code} node=${node.code}`);
    if (py.stdout !== node.stdout) problems.push(`stdout:\n    py:   ${JSON.stringify(py.stdout)}\n    node: ${JSON.stringify(node.stdout)}`);
    if (py.stderr !== node.stderr) problems.push(`stderr:\n    py:   ${JSON.stringify(py.stderr)}\n    node: ${JSON.stringify(node.stderr)}`);
    if (problems.length) {
      diffs += 1;
      console.log(`DIFF ${c.name}  [${c.argv.join(" ")}]\n  ${problems.join("\n  ")}`);
    } else if (verbose) {
      console.log(`ok   ${c.name} (exit ${py.code}, ${py.stdout.length}b out, ${py.stderr.length}b err)`);
    }
  });
  console.log(`${diffs === 0 ? "IDENTICAL" : "DIFFERENCES"}: ${diffs} differing case(s) of ${selected.length} (${PATHS.length} command paths, widths ${widths.join("/")})`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(diffs === 0 ? 0 : 1);

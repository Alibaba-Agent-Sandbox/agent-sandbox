#!/usr/bin/env node
/**
 * ADV-commands: Rich-replacement rendering through real commands: tables with CJK / emoji / combining / RTL / control
 * chars / very long cells / many rows / markup-looking text, at many COLUMNS widths, piped (non-TTY) and on a pty,
 * with NO_COLOR / FORCE_COLOR / TERM=dumb. Oracle vs Node.
 *   ORACLE_VENV=... node parity/diff/adv_commands_rich.mjs [--only substr] [--jobs N] [--pty]
 */
import { argOf, requireOracle, runAll } from "./adv_commands_lib.mjs";
requireOracle();
const SB = "sbx-ev-001";
const weird = [
  "日本語テキスト", "🎉🚀✨", "e\u0301e\u0301", "مرحبا بالعالم", "[bold]x[/bold]", "[red]r", "\\[escaped]", "a\tb", "a\u200bb", "👨‍👩‍👧‍👦", "🇯🇵🇨🇳", "x".repeat(300), "ｱｲｳ", "Ａｂｃ", "\u0007bell", "a\rb", "{0}{x}%s", "<b>html</b>", "a&amp;b", "\u00a0nbsp", "\u3000ideographic", "a\u0301\u0302\u0303", "ᄀ ᅡ", "𝔘𝔫𝔦",
];
const mkWorld = (rows) => {
  const sandboxes = {};
  rows.forEach((w, i) => { sandboxes[`sb${i}`] = { sandboxID: `sbx-${w}`.slice(0, 400), templateID: w, state: "running", cpuCount: 2, memoryMB: 2048, startedAt: "2026-01-02T03:04:05Z", endAt: "2026-01-02T03:09:05Z", envdVersion: "0.5.2", metadata: { k: w } }; });
  return { sandboxes, templates: rows.map((w, i) => ({ templateID: `t-${i}-${w}`, aliases: [w], names: [w], cpuCount: 1, memoryMB: 512, public: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", builds: [{ buildID: "b", status: w }] })), dirs: { "/home/user": rows.map((w) => ({ name: w, type: "file", size: 12 })) } };
};
const cases = [];
const pty = process.argv.includes("--pty");
const widths = [1, 5, 10, 17, 25, 40, 60, 80, 120, 300];
const sets = { all: mkWorld(weird), single: (i) => mkWorld([weird[i]]), many: mkWorld(Array.from({ length: 60 }, (_, i) => `row-${i}`)), none: mkWorld([]) };
for (const w of widths) for (const [sn, world] of Object.entries(sets)) {
  if (typeof world === "function") continue;
  for (const argv of [["list"], ["template", "list"], ["sandbox", "files", "list", SB, "--path", "/home/user"], ["info", "sb0"]]) {
    for (const env of [{ COLUMNS: String(w) }, { COLUMNS: String(w), FORCE_COLOR: "1", NO_COLOR: null }, { COLUMNS: String(w), TERM: "xterm-256color", NO_COLOR: null, FORCE_COLOR: "1" }]) {
      cases.push({ name: `w=${w} ${sn} ${argv.join(" ")} ${JSON.stringify(env)}`, argv, world, env, keepAnsi: true, ...(pty ? { pty: { steps: [], timeout: 30 } } : {}) });
    }
  }
}
weird.forEach((x, i) => { cases.push({ name: `single ${i} ${JSON.stringify(x).slice(0, 30)} list`, argv: ["list"], world: mkWorld([x]), env: { COLUMNS: "40" }, keepAnsi: true }); cases.push({ name: `single ${i} json`, argv: ["--json", "list"], world: mkWorld([x]) }); cases.push({ name: `single ${i} info`, argv: ["info", "sb0"], world: mkWorld([x]) }); cases.push({ name: `single ${i} quiet`, argv: ["--quiet", "list"], world: mkWorld([x]) }); });
const diffs = await runAll(cases, { jobs: Number(argOf("--jobs") ?? 4), only: argOf("--only") });
process.exitCode = diffs.length ? 1 : 0;

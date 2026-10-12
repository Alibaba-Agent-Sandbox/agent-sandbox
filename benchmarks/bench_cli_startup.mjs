#!/usr/bin/env node
// CLI 启动时间基准测试。目标：< 200ms
// CLI startup-time benchmark. Target: < 200 ms.
// Usage: node benchmarks/bench_cli_startup.mjs   (EBX_BIN overrides the ebx executable, default: ebx)
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const EBX_BIN = process.env.EBX_BIN || "ebx";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function timeRun(args) {
  const start = performance.now();
  spawnSync(EBX_BIN, args, { cwd: ROOT, stdio: "pipe" });
  return (performance.now() - start) / 1000;
}

function benchCliHelp() {
  const times = [];
  for (let i = 0; i < 5; i++) {
    times.push(timeRun(["--help"]));
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p95 = [...times].sort((a, b) => a - b)[Math.floor(times.length * 0.95)];
  console.log(`CLI --help startup: avg=${avg.toFixed(3)}s, p95=${p95.toFixed(3)}s (target: <0.2s)`);
  return [avg, p95];
}

function benchCliSubcommand() {
  const commands = [
    ["sandbox", "--help"],
    ["template", "--help"],
    ["session", "--help"],
    ["mcp", "--help"],
  ];
  for (const cmd of commands) {
    const elapsed = timeRun(cmd);
    console.log(`  ebx ${cmd.join(" ")}: ${elapsed.toFixed(3)}s`);
  }
}

console.log("=== CLI Startup Benchmark ===");
benchCliHelp();
console.log();
benchCliSubcommand();

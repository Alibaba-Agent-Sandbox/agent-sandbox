import { TEMPLATE_YAML_FIELDS } from "./templateManifest.js";
/**
 * Shared harness of the `adv_*.test.ts` files (adversarial review of the agent/template area): runs the CLI in an
 * isolated HOME and work directory. Expected values in those tests were captured from the Python oracle; setting
 * `ADV_ORACLE_BIN=$ORACLE_VENV/bin/abx` runs the CLI-level tests against the Python CLI instead (they must all pass there).
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, vi } from "vitest";

export const CLI_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const TSX = pathToFileURL(
  path.join(CLI_ROOT, "node_modules/tsx/dist/esm/index.mjs"),
).href;
export const ENTRY = path.join(CLI_ROOT, "src/bin/abx.ts");
export const ORACLE_BIN = process.env.ADV_ORACLE_BIN ?? "";

const scratch: string[] = [];

/** Call at the top level of a test file: removes the sandboxes created by {@link sandbox} after the file's tests. */
export function useAdvSandboxes(): void {
  vi.setConfig({ testTimeout: 90_000 });
  afterAll(() => {
    for (const d of scratch) rmSync(d, { recursive: true, force: true });
  });
}

export interface Sandbox {
  root: string;
  home: string;
  work: string;
}
export function sandbox(): Sandbox {
  const root = mkdtempSync(path.join(tmpdir(), "adv-at-"));
  scratch.push(root);
  const home = path.join(root, "home");
  const work = path.join(root, "work");
  mkdirSync(home);
  mkdirSync(work);
  return { root, home, work };
}

export interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function abx(
  sb: Sandbox,
  args: string[],
  env: Record<string, string> = {},
): Promise<Run> {
  const cmd = ORACLE_BIN || process.execPath;
  const argv = ORACLE_BIN ? args : ["--import", TSX, ENTRY, ...args];
  return new Promise((resolve) => {
    const proc = spawn(cmd, argv, {
      cwd: sb.work,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: sb.home,
        ABX_NO_KEYCHAIN: "1",
        NO_COLOR: "1",
        TERM: "dumb",
        COLUMNS: "80",
        LANG: "C.UTF-8",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.stderr.on("data", (d: Buffer) => err.push(d));
    const timer = setTimeout(() => proc.kill("SIGKILL"), 60_000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
    proc.stdin.on("error", () => {});
    proc.stdin.end("");
  });
}

export function put(root: string, rel: string, data: string): void {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, data);
}

export const DOCKERFILE =
  'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nCMD ["python3", "commands.py"]\n';
export const TEMPLATE_YAML = TEMPLATE_YAML_FIELDS +
  'name: demo-tpl\nversion: "1.0.0"\ndescription: demo\nresources:\n  cpu: 1\n  memory: 512\n';

/** Install a local template whose template.yaml is `yaml`; returns the CLI run. */
export async function localInstall(
  sb: Sandbox,
  yaml: string,
  extra: string[] = ["--dir", "out"],
): Promise<Run> {
  put(sb.work, "src/Dockerfile", DOCKERFILE);
  put(sb.work, "src/template.yaml", yaml);
  return abx(sb, [
    "template",
    "install",
    path.join(sb.work, "src"),
    "--registry-type",
    "local",
    "--download-only",
    ...extra,
  ]);
}

export function ustar(
  entries: {
    name: string;
    type: "file" | "dir";
    mode: number;
    data?: string;
  }[],
): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const body = Buffer.from(e.data ?? "");
    const h = Buffer.alloc(512);
    h.write(e.name, 0, "utf8");
    h.write(e.mode.toString(8).padStart(7, "0") + "\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136);
    h.write("        ", 148);
    h.write(e.type === "dir" ? "5" : "0", 156);
    h.write("ustar\0" + "00", 257);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

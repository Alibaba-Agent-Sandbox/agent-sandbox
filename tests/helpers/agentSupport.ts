/**
 * Shared helpers for the `tests/test_agent/*` ports of the coding-agent modules (qwen_code, coding_agent, clarify,
 * codegen, adopt, template_guide, dockerfile_sources).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));

export const CLI_ROOT = resolve(HERE, "..", "..");
export const FIXTURES = join(CLI_ROOT, "tests", "fixtures", "agent");

/** Fresh temp dir (realpath'd, like pytest's `tmp_path` on macOS). */
export function makeTmp(prefix = "abx-agent-"): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export function rmTmp(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export function writeFile(path: string, content: string | Uint8Array, mode?: number): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (mode !== undefined) chmodSync(path, mode);
  return path;
}

export function readGolden(): Record<string, any> {
  return JSON.parse(readFileSync(join(FIXTURES, "golden.json"), "utf8"));
}

/** Locate a python interpreter on PATH (None when absent). */
export function findPython(): string | null {
  for (const candidate of ["python3", "python"]) {
    const r = spawnSync(candidate, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim() === "3") return candidate;
  }
  return null;
}

/**
 * `PYTHONPATH` that makes the container-side `agent_sandbox.server` importable: `ABX_SERVER_SDK_SRC` (a
 * path-delimited list), else `$ORIG_REPO/src` / `$ORIG_REPO/python-sdk/*\/src`, else `<repo>/python-sdk/*\/src`.
 */
export function serverSdkPythonPath(python: string): string | null {
  const roots: string[] = [];
  if (process.env.ABX_SERVER_SDK_SRC) roots.push(process.env.ABX_SERVER_SDK_SRC);
  const repos = [process.env.ORIG_REPO, resolve(CLI_ROOT, "..")].filter((p): p is string => !!p);
  for (const repo of repos) {
    roots.push(join(repo, "src"));
    roots.push([join(repo, "python-sdk", "server-sdk", "src"), join(repo, "python-sdk", "client-sdk", "src")].join(delimiter));
  }
  for (const candidate of roots) {
    if (!candidate.split(delimiter).every((p) => existsSync(p))) continue;
    const r = spawnSync(python, ["-c", "import agent_sandbox.server"], {
      encoding: "utf8",
      env: { ...process.env, PYTHONPATH: candidate },
    });
    if (r.status === 0) return candidate;
  }
  return null;
}

export interface PythonReference {
  python: string;
  /** `PYTHONPATH` that makes `agent_sandbox.server` importable; `null` when only the interpreter is available. */
  sdk: string | null;
}

let cachedReference: PythonReference | null | undefined;

/**
 * The optional Python reference used by a handful of cross-checks (`python3` for `ast.parse`, the container-side
 * `agent_sandbox.server` package for the template guide). `golden.json` stays the default oracle: when the reference is
 * absent the dependent tests are skipped (see {@link itWithPython} / {@link itWithServerSdk}) with a one-time notice.
 */
export function pythonReference(): PythonReference | null {
  if (cachedReference !== undefined) return cachedReference;
  const python = findPython();
  cachedReference = python === null ? null : { python, sdk: serverSdkPythonPath(python) };
  return cachedReference;
}

const announced = new Set<string>();

function announceSkip(kind: string, message: string): void {
  if (announced.has(kind)) return;
  announced.add(kind);
  process.stderr.write(`[tests] SKIPPED ${kind}: ${message}\n`);
}

type TestFn = typeof import("vitest").it;

/** `it` when `python3` is on PATH, otherwise `it.skip` (CPython-only cross-checks). */
export function itWithPython(it: TestFn): TestFn {
  if (pythonReference() !== null) return it;
  announceSkip("python3 cross-checks", "no python3 on PATH; golden.json fixtures remain the oracle");
  return it.skip as TestFn;
}

/** `it` when `agent_sandbox.server` is importable by `python3`, otherwise `it.skip`. */
export function itWithServerSdk(it: TestFn): TestFn {
  if (pythonReference()?.sdk) return it;
  announceSkip(
    "server SDK cross-checks",
    "python3 cannot import agent_sandbox.server (keep python-sdk/server-sdk next to cli/, or set ABX_SERVER_SDK_SRC or ORIG_REPO); golden.json fixtures remain the oracle",
  );
  return it.skip as TestFn;
}

/** `pytest.raises(cls, match=...)`: `fn` may be sync or async; the regex is searched in `String(exc)` (= `str(exc)`). */
export async function raises<E extends Error>(
  fn: () => unknown,
  cls: abstract new (...args: any[]) => E,
  match?: RegExp | string,
): Promise<E> {
  let caught: unknown;
  let threw = false;
  try {
    await fn();
  } catch (exc) {
    caught = exc;
    threw = true;
  }
  if (!threw) throw new Error(`DID NOT RAISE ${cls.name}`);
  if (!(caught instanceof cls)) {
    throw new Error(`expected ${cls.name}, got ${caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught)}`);
  }
  if (match !== undefined) {
    const re = typeof match === "string" ? new RegExp(match) : match;
    const text = String(caught);
    if (!re.test(text)) throw new Error(`Regex pattern did not match.\n Regex: ${re}\n Input: ${text}`);
  }
  return caught;
}

// ---------------------------------------------------------------------------
// Archive builders (stand-ins for Python's tarfile / zipfile writers)
// ---------------------------------------------------------------------------


export interface TarEntry {
  name: string;
  content?: Uint8Array | string;
  mode?: number;
  /** ustar type flag: `"0"` file (default), `"5"` dir, `"2"` symlink, `"1"` hardlink, `"3"` char device. */
  type?: string;
  linkname?: string;
}

function putField(header: Buffer, offset: number, length: number, text: string): void {
  Buffer.from(text, "utf8").copy(header, offset, 0, length);
}

function octalField(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

/** Uncompressed ustar archive (names must fit the 100-byte field). */
export function tarBytes(entries: readonly TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.content ?? "");
    const type = entry.type ?? "0";
    const size = type === "0" ? data.length : 0;
    const header = Buffer.alloc(512);
    putField(header, 0, 100, entry.name);
    putField(header, 100, 8, octalField(entry.mode ?? (type === "5" ? 0o755 : 0o644), 8));
    putField(header, 108, 8, octalField(0, 8));
    putField(header, 116, 8, octalField(0, 8));
    putField(header, 124, 12, octalField(size, 12));
    putField(header, 136, 12, octalField(0, 12));
    header.fill(0x20, 148, 156);
    header.write(type, 156, 1, "ascii");
    putField(header, 157, 100, entry.linkname ?? "");
    header.write("ustar\0", 257, "ascii");
    header.write("00", 263, "ascii");
    let sum = 0;
    for (const byte of header) sum += byte;
    putField(header, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header);
    if (size > 0) {
      blocks.push(data);
      const pad = (512 - (size % 512)) % 512;
      if (pad) blocks.push(Buffer.alloc(pad));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

export function tarGzBytes(entries: readonly TarEntry[]): Buffer {
  return gzipSync(tarBytes(entries));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** `ZipFile(..., "w")` with `ZIP_STORED` members. */
export function zipBytes(entries: ReadonlyArray<{ name: string; content: Uint8Array | string; crc?: number }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.content);
    const crc = entry.crc ?? crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    local.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

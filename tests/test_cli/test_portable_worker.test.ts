import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, expect, it, vi} from "vitest";
import {dispatchPortableWorker, portableWorkerInvocation, portableWorkerSeams} from "../../src/application/portable_worker.js";

const roots: string[] = [];
const original = portableWorkerSeams.seaRuntime;
function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-portable-test-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  portableWorkerSeams.seaRuntime = original;
  for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});
});
function embedded(source: string): void {
  portableWorkerSeams.seaRuntime = () => ({isSea: () => true, getAsset: key => {
    expect(key).toBe("abx/devs-parser.cjs");
    const bytes = new TextEncoder().encode(source);
    return bytes.buffer as ArrayBuffer;
  }});
}

it("keeps npm fallback lazy and does not require SEA APIs on ordinary Node", () => {
  portableWorkerSeams.seaRuntime = () => undefined;
  const fallback = vi.fn(() => ({argv: ["node", "parser.cjs"], modulePath: "native-parser"}));
  expect(portableWorkerInvocation("parser", "/unused", fallback)).toEqual(fallback.mock.results[0].value);
  expect(fallback).toHaveBeenCalledOnce();
  expect(dispatchPortableWorker(["node", "abx", "deploy"])).toBe(false);
});

it("runs only its embedded asset from caller-owned scratch and leaves cleanup to the caller", () => {
  const root = scratch(), marker = path.join(root, "done");
  embedded(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'embedded');`);
  const fallback = vi.fn(() => {throw new Error("must not resolve npm dependencies");});
  const invocation = portableWorkerInvocation("parser", root, fallback);
  expect(invocation.argv).toEqual([process.execPath, "--abx-internal-worker", "parser", root]);
  expect(fs.readdirSync(root)).toEqual([]);
  expect(dispatchPortableWorker([invocation.argv[0], "abx", ...invocation.argv.slice(1)])).toBe(true);
  expect(fs.readFileSync(marker, "utf8")).toBe("embedded");
  expect(fs.statSync(path.join(root, "devs-parser.cjs")).mode & 0o777).toBe(0o600);
  expect(fs.existsSync(root)).toBe(true);
  expect(fallback).not.toHaveBeenCalled();
});

it.each(["file", "symlink"])("refuses an existing %s instead of executing caller-provided code", kind => {
  const root = scratch(), marker = path.join(root, "untrusted"), filename = path.join(root, "devs-parser.cjs");
  embedded("module.exports = {};");
  const code = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`;
  if (kind === "file") fs.writeFileSync(filename, code);
  else {fs.writeFileSync(path.join(root, "target.cjs"), code); fs.symlinkSync(path.join(root, "target.cjs"), filename);}
  expect(() => dispatchPortableWorker([process.execPath, "abx", "--abx-internal-worker", "parser", root])).toThrow();
  expect(fs.existsSync(marker)).toBe(false);
});

it("rejects arbitrary worker modes, arguments, and symlink scratch directories", () => {
  const root = scratch(); embedded("module.exports = {};");
  const base = [process.execPath, "abx", "--abx-internal-worker"];
  expect(() => dispatchPortableWorker([...base, "run-file", root])).toThrow("Invalid internal worker invocation");
  expect(() => dispatchPortableWorker([...base, "parser", root, "extra"])).toThrow("Invalid internal worker invocation");
  fs.symlinkSync(root, path.join(root, "link"));
  expect(() => dispatchPortableWorker([...base, "parser", path.join(root, "link")])).toThrow("Invalid internal worker directory");
});

/** Private Devs workers share the installed Node runtime or the embedded SEA runtime. */
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";

export type PortableWorkerKind = "parser" | "component";
interface SeaRuntime {isSea(): boolean; getAsset(key: string): ArrayBuffer}
const require = createRequire(import.meta.url);
function seaRuntime(): SeaRuntime | undefined {
  // Earlier Node 20 releases may lack node:sea. Ordinary npm use needs no SEA API.
  try {
    const sea = require("node:sea") as Partial<SeaRuntime>;
    return typeof sea.isSea === "function" && sea.isSea() && typeof sea.getAsset === "function" ? sea as SeaRuntime : undefined;
  } catch {return undefined;}
}
export const portableWorkerSeams = {seaRuntime};
const workerFiles: Record<PortableWorkerKind, string> = {parser: "devs-parser.cjs", component: "devs-component.cjs"};
const workerAsset = (kind: PortableWorkerKind): string => `abx/${workerFiles[kind]}`;
export interface PortableWorkerInvocation {argv: string[]; modulePath?: string}

/** The caller owns scratch and removes it only after the child terminates. */
export function portableWorkerInvocation(kind: PortableWorkerKind, scratch: string, fallback: () => PortableWorkerInvocation): PortableWorkerInvocation {
  const sea = portableWorkerSeams.seaRuntime();
  if (!sea) return fallback();
  if (!Object.hasOwn(workerFiles, kind)) throw new Error("Unsupported internal worker.");
  const directory = fs.realpathSync(scratch);
  if (fs.lstatSync(scratch).isSymbolicLink() || !fs.statSync(directory).isDirectory()) throw new Error("Invalid internal worker directory.");
  return {argv: [process.execPath, "--abx-internal-worker", kind, directory]};
}

/** Dispatch only the two embedded workers, before importing the public CLI and its handlers. */
export function dispatchPortableWorker(argv: string[] = process.argv): boolean {
  if (argv[2] !== "--abx-internal-worker") return false;
  const sea = portableWorkerSeams.seaRuntime(), kind = argv[3] as PortableWorkerKind;
  if (!sea || argv.length !== 5 || !Object.hasOwn(workerFiles, kind) || !path.isAbsolute(argv[4])) throw new Error("Invalid internal worker invocation.");
  const directory = fs.realpathSync(argv[4]);
  if (fs.lstatSync(argv[4]).isSymbolicLink() || !fs.statSync(directory).isDirectory()) throw new Error("Invalid internal worker directory.");
  const filename = path.join(directory, workerFiles[kind]);
  // Never execute a caller-provided file, even when it has the fixed worker name.
  fs.writeFileSync(filename, Buffer.from(sea.getAsset(workerAsset(kind))), {flag: "wx", mode: 0o600});
  // Loading a normal extracted CJS module preserves the official loader/parser's dynamic
  // filesystem requires; SEA's injected main only supports built-in require targets.
  createRequire(filename)(filename);
  return true;
}

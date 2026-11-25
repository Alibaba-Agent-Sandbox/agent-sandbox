/** npm component workers are isolated Node children; SEA packaging is a separate delivery gate. */
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
export type PortableWorkerKind = "parser" | "component";
export interface PortableWorkerInvocation {argv: string[]; modulePath?: string}
function seaRuntime(): boolean {
  try {return Boolean((require("node:sea") as {isSea?: () => boolean}).isSea?.());} catch {return false;}
}
export const portableWorkerSeams = {seaRuntime};
export function portableWorkerInvocation(_kind: PortableWorkerKind, _scratch: string, fallback: () => PortableWorkerInvocation): PortableWorkerInvocation {
  if (portableWorkerSeams.seaRuntime()) throw new Error("Native resource components currently require the npm CLI. Standalone worker support is not included in this candidate.");
  return fallback();
}

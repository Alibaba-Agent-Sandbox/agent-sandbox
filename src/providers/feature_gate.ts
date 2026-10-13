/**
 * Runtime enforcement of a manifest's `[features] supported` list for providers that reuse the built-in protocol classes
 * (`rest` providers). `exec` providers enforce their own list inside the EPP adapters; this module gives the other kinds
 * the same behaviour: a method whose feature is not declared fails with `E8004` before any request is sent.
 */

import { ProviderFeatureNotSupportedError } from "./errors.js";

/** Method name -> features of which at least one must be supported. */
export type FeatureRules = Readonly<Record<string, readonly string[]>>;

export const SANDBOX_RULES: FeatureRules = {
  create: ["sandbox.lifecycle"],
  list: ["sandbox.lifecycle"],
  listV2: ["sandbox.lifecycle"],
  getInfo: ["sandbox.lifecycle"],
  connect: ["sandbox.lifecycle"],
  isRunning: ["sandbox.lifecycle"],
  kill: ["sandbox.lifecycle"],
  setTimeout: ["sandbox.timeout"],
  pause: ["sandbox.pause"],
  resume: ["sandbox.pause"],
};

export const PROCESS_RULES: FeatureRules = {
  start: ["exec.run", "exec.stream"],
  listProcesses: ["process.manage"],
  connectToProcess: ["process.manage"],
  update: ["process.manage"],
  sendInput: ["process.manage"],
  sendSignal: ["process.manage"],
  sendStdin: ["process.manage"],
  kill: ["process.manage"],
};

const FILE_METHODS = ["stat", "listDir", "makeDir", "remove", "move", "uploadFile", "downloadFile", "exists", "getInfo", "read", "readText", "write", "rename"];

export const FILESYSTEM_RULES: FeatureRules = {
  ...Object.fromEntries(FILE_METHODS.map((m) => [m, ["files.rw"]])),
  watchDir: ["files.watch"],
};

export const CODE_RULES: FeatureRules = Object.fromEntries(
  ["runCode", "createContext", "listContexts", "restartContext", "removeContext"].map((m) => [m, ["code.interpret"]]),
);

/** Wrap `target` so a method needing an undeclared feature throws `ProviderFeatureNotSupportedError` (E8004). */
export function gateProtocol<T extends object>(target: T, providerId: string, rules: FeatureRules, supported: ReadonlySet<string>): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value: unknown = Reflect.get(obj, prop, obj);
      const needed = typeof prop === "string" ? rules[prop] : undefined;
      if (needed !== undefined && !needed.some((f) => supported.has(f))) {
        return async (): Promise<never> => {
          throw new ProviderFeatureNotSupportedError(providerId, needed[0] as string);
        };
      }
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(obj) : value;
    },
  });
}

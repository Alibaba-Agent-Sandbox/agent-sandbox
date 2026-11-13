/** Execute a pinned native Devs component with the CLI's credential and output contracts. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { ApplicationError, record } from "./config.js";
import type { CredentialSnapshot } from "./bindings.js";
import { COMPONENT_RUNNER_SOURCE } from "./component_runner.js";
import { portableWorkerInvocation } from "./portable_worker.js";
import { execute } from "./process.js";
import { getLogger } from "../utils/logging.js";

const require = createRequire(import.meta.url);
export type ComponentLogLevel = "debug" | "info" | "warning" | "error";
export interface ComponentLogEvent {
  level: ComponentLogLevel;
  message: string;
  component: string;
  resource: string;
  command: string;
}
export interface ComponentExecutionInput {
  component: string;
  command: string;
  args?: string[];
  cwd: string;
  name: string;
  resource: string;
  props: Record<string, unknown>;
  credential: CredentialSnapshot;
  onLog?: (event: ComponentLogEvent) => void;
  timeoutSeconds?: number;
  sensitiveValues?: string[];
  functionCreationGuard?: {endpoint: string; functionName: string};
}
/** Injectable loader path for component protocol tests; production uses the official pinned loader. */
export const componentHostSeams = { loaderPath: (): string => require.resolve("@serverless-devs/load-component") };

/** Route native progress to the existing CLI logger, preserving stderr, verbosity and quiet modes. */
export function emitComponentLog(event: ComponentLogEvent): void {
  getLogger("components")[event.level]("[%s] %s", event.resource, event.message);
}

function environment(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: home, USERPROFILE: home, serverless_devs_config_home: home,
    CI: "1", SERVERLESS_DEVS_CICD: "1", S_INTERACTIVE: "0", NO_COLOR: "1", DEBUG: "" };
  for (const key of ["PATH", "SYSTEMROOT", "TMPDIR", "TMP", "TEMP", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH", "DOCKER_CONFIG"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  // Native build/deploy needs the user's Docker authentication; changing the component
  // cache HOME must not silently switch Docker to an empty credentials directory.
  env.DOCKER_CONFIG ??= path.join(os.homedir(), ".docker");
  return env;
}

/**
 * Invoke the original component method, preserving project-relative paths and native results.
 * The credential snapshot is sent privately once; repeated callbacks return copies of it.
 * No actions are executed here: the resource executor owns their ordering.
 */
export async function invokeDevsComponent(input: ComponentExecutionInput): Promise<unknown> {
  const component = input.component.replace(/^serverless-devs\//, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*@\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(component)) throw new ApplicationError("Components require an exact version, for example serverless-devs/fc3@0.1.26.");
  if (!/^[a-z][a-zA-Z0-9-]*$/.test(input.command) || ["constructor", "prototype"].includes(input.command)) throw new ApplicationError("Invalid component command.");
  if (input.functionCreationGuard) {
    const guard = input.functionCreationGuard;
    let endpoint: URL;
    try {endpoint = new URL(/^https?:\/\//.test(guard.endpoint) ? guard.endpoint : `https://${guard.endpoint}`);}
    catch {throw new ApplicationError("Invalid FC creation guard endpoint.");}
    if (!component.startsWith("fc3@") || input.command !== "deploy" || guard.functionName !== input.props.functionName ||
        !["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new ApplicationError("Invalid FC creation guard target.");
  }
  const cwd = fs.realpathSync(input.cwd);
  if (!fs.statSync(cwd).isDirectory()) throw new ApplicationError("Component working directory must be a directory.");
  const home = path.join(cwd, ".abx", "components"); fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "abx-component-host-"));
  let pending = "";
  const onEventData = (data: string): void => {
    pending += data;
    for (;;) {
      const end = pending.indexOf("\n"); if (end < 0) break;
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      const value: unknown = JSON.parse(line);
      if (!record(value) || !["debug", "info", "warning", "error"].includes(String(value.level)) ||
          typeof value.message !== "string" || typeof value.component !== "string" || typeof value.resource !== "string" || typeof value.command !== "string") throw new ApplicationError("Invalid component log event.");
      (input.onLog ?? emitComponentLog)(value as unknown as ComponentLogEvent);
    }
  };
  try {
    const runner = path.join(scratch, "runner.cjs"); fs.writeFileSync(runner, COMPONENT_RUNNER_SOURCE, { mode: 0o600 });
    const worker = portableWorkerInvocation("component", scratch, () => ({argv: [process.env.ABX_APP_NODE || process.execPath, runner], modulePath: componentHostSeams.loaderPath()}));
    const output = await execute({ argv: worker.argv, cwd, env: environment(home),
      input: JSON.stringify({ action: "invoke", events: true, loaderPath: worker.modulePath, component,
        componentReference: component, command: input.command, args: input.args ?? [], cwd, name: input.name,
        resource: input.resource, yamlPath: path.join(cwd, "template.yaml"), props: input.props,
        credential: input.credential, functionCreationGuard: input.functionCreationGuard, sensitiveValues: input.sensitiveValues ?? [] }),
      privateResult: true, onEventData, timeoutSeconds: input.timeoutSeconds ?? 1800, maxBytes: 8 * 1024 * 1024 });
    if (pending.trim()) throw new ApplicationError("Component log stream ended with an incomplete event.");
    let value: unknown;
    try { value = JSON.parse(output); } catch { throw new ApplicationError("Component returned an invalid result; raw output withheld."); }
    if (!record(value)) throw new ApplicationError("Component returned an invalid result.");
    if (value.error) throw new ApplicationError(`Component ${component} ${input.command} failed during ${value.stage === "invoke" ? "execution" : "loading"}${typeof value.code === "string" ? ` (${value.code})` : ""}${typeof value.message === "string" ? `: ${value.message}` : "."}`);
    return input.command === "logs" ? value.logs : value.result;
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

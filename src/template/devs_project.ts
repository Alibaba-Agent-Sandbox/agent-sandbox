/** The official Devs parser resolves the one local project; no parallel expression language. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { stringify } from "yaml";
import { TemplateParseError } from "../models/errors.js";
import { DEVS_PARSE_RUNNER_SOURCE } from "./devs_runner.js";

const require = createRequire(import.meta.url);
const payloadKey = "xAbxResolvedTemplate";
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export interface DevsStep {
  resource: string;
  component: string;
  order?: number;
}
export interface DevsActionDeclaration {
  scope: "project" | "resource";
  resource?: string;
  definition: unknown;
}
/** Private resolved values may contain credentials. Persist only the original resource intent. */
export interface ResolvedDevsProject {
  document: Record<string, unknown>;
  steps: DevsStep[];
  actions: DevsActionDeclaration[];
}
export interface DevsResolutionOptions {
  /** Original local configuration source, when the immutable source snapshot excludes dotenv/private files. */
  configurationSource?: string;
}

/** List original action declarations without evaluating or executing their commands. */
export function devsActionDeclarations(deployment: Record<string, unknown>): DevsActionDeclaration[] {
  const out: DevsActionDeclaration[] = [];
  if (deployment.actions !== undefined) out.push({ scope: "project", definition: structuredClone(deployment.actions) });
  if (object(deployment.resources)) for (const [resource, value] of Object.entries(deployment.resources)) {
    if (object(value) && value.actions !== undefined) out.push({ scope: "resource", resource, definition: structuredClone(value.actions) });
  }
  return out;
}

function environmentPaths(value: unknown, key: string, pointer = ""): string[] {
  if (typeof value === "string") {
    const matches = [...value.matchAll(/env\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\)/g)];
    return matches.some(match => match[1] === key) ? [pointer || "/"] : [];
  }
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([part, child]) => environmentPaths(child, key, `${pointer}/${part.replaceAll("~", "~0").replaceAll("/", "~1")}`));
}

/**
 * Resolve native vars/env/file expressions with the official parser in an isolated process.
 * Actions are planned only; this function never invokes components or the Devs engine.
 */
export function resolveDevsProject(document: Record<string, unknown>, file: string, environment: NodeJS.ProcessEnv = process.env, options: DevsResolutionOptions = {}): ResolvedDevsProject {
  const deployment = object(document.deployment) ? document.deployment : {};
  if (Object.hasOwn(deployment, payloadKey)) throw new TemplateParseError("Reserved native project payload field.");
  const { deployment: _deployment, ...payload } = document;
  const nativeProject = { edition: "3.0.0", name: document.name ?? "abx-project", resources: {}, ...deployment, [payloadKey]: payload };
  const parserPath = require.resolve("@serverless-devs/parse-spec");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "abx-devs-parse-"));
  try {
    const runner = path.join(scratch, "parse.cjs");
    fs.writeFileSync(runner, DEVS_PARSE_RUNNER_SOURCE, { mode: 0o600 });
    const result = spawnSync(environment.ABX_APP_NODE || process.execPath, [runner], {
      cwd: options.configurationSource ? fs.realpathSync(options.configurationSource) : path.dirname(fs.realpathSync(file)),
      env: { ...environment, DEBUG: "", CI: "1", S_INTERACTIVE: "0", NO_COLOR: "1" },
      input: JSON.stringify({ parserPath, command: "deploy", content: stringify(nativeProject) }),
      stdio: ["pipe", "ignore", "ignore", "pipe"], encoding: "utf8", timeout: 30000,
      maxBuffer: 4 * 1024 * 1024, killSignal: "SIGKILL",
    });
    if (result.error) throw new TemplateParseError("Native project parser could not complete; verify Node.js and local project inputs. Raw output withheld.");
    let value: unknown;
    try { value = JSON.parse(result.output[3] || ""); }
    catch { throw new TemplateParseError("Native project parser returned an invalid result. Raw output withheld."); }
    if (!object(value) || result.status !== 0 || value.error) {
      if (object(value) && typeof value.missingEnvironment === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.missingEnvironment)) {
        const paths = environmentPaths(document, value.missingEnvironment);
        throw new TemplateParseError(`Missing environment variable ${value.missingEnvironment}${paths.length ? ` at ${paths.join(", ")}` : ""}; provide it before preview or deployment.`);
      }
      throw new TemplateParseError("Native project references or structure could not be resolved. Raw output withheld.");
    }
    if (!object(value.content) || !object(value.content[payloadKey]) || !Array.isArray(value.steps)) throw new TemplateParseError("Native project parser returned an invalid document.");
    const { [payloadKey]: resolvedPayload, ...resolvedDeployment } = value.content;
    const resolved = { ...resolvedPayload, ...(document.deployment === undefined ? {} : { deployment: resolvedDeployment }) };
    const steps: DevsStep[] = value.steps.map(step => {
      if (!object(step) || typeof step.resource !== "string" || typeof step.component !== "string") throw new TemplateParseError("Native project parser returned an invalid resource step.");
      return { resource: step.resource, component: step.component, ...(typeof step.order === "number" ? { order: step.order } : {}) };
    });
    return { document: resolved, steps, actions: devsActionDeclarations(deployment) };
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

/**
 * Choose one template publish path and expand `template.yaml` `build:` into platform steps.
 *
 * See `docs/en/design/template-build-modes.md`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { isMapping, loadYaml } from "../utils/yaml_io.js";

export type BuildMode = "auto" | "dockerfile" | "steps";

export interface PlatformStep {
  type: string;
  args: string[];
}

export type BuildPlan =
  | { kind: "dockerfile"; dockerfile: string; ignoredSteps: boolean }
  | { kind: "steps"; image: string; steps: PlatformStep[] };

export class BuildModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildModeError";
  }
}

const MODES = new Set<BuildMode>(["auto", "dockerfile", "steps"]);

export function resolveBuildPlan(
  templateDir: string,
  opts: { mode?: string | null; dockerfile?: string | null } = {},
): BuildPlan {
  const flag = _mode(opts.mode ?? "auto", "--build");
  const file = _readTemplate(templateDir);
  const selected = flag === "auto" ? (file.mode ?? "auto") : flag;
  const dockerfile = _dockerfile(templateDir, opts.dockerfile ?? null);
  const hasSteps = file.steps.length > 0;

  if (selected === "dockerfile") {
    if (!dockerfile) {
      throw new BuildModeError("Build mode dockerfile needs a Dockerfile. Pass --build steps to use template.yaml build steps.");
    }
    return { kind: "dockerfile", dockerfile, ignoredSteps: hasSteps };
  }
  if (selected === "steps") {
    if (!file.image) throw new BuildModeError("Build mode steps needs base.image in template.yaml.");
    if (!hasSteps) throw new BuildModeError("Build mode steps needs a build: block or build.steps in template.yaml.");
    return { kind: "steps", image: file.image, steps: file.steps };
  }
  if (dockerfile) return { kind: "dockerfile", dockerfile, ignoredSteps: hasSteps };
  if (hasSteps) {
    if (!file.image) throw new BuildModeError("Platform build steps need base.image in template.yaml.");
    return { kind: "steps", image: file.image, steps: file.steps };
  }
  throw new BuildModeError("No Dockerfile and no template.yaml build steps. Add a Dockerfile or a build: block.");
}

interface FileBuild {
  mode: BuildMode | null;
  image: string | null;
  steps: PlatformStep[];
}

function _readTemplate(templateDir: string): FileBuild {
  const file = path.join(templateDir, "template.yaml");
  if (!fs.existsSync(file)) return { mode: null, image: null, steps: [] };
  const data = loadYaml(fs.readFileSync(file, "utf8"));
  if (!isMapping(data)) throw new BuildModeError(`${file} must be a YAML mapping`);
  const root = data as Record<string, unknown>;
  const base = _mapping(root["base"], "base");
  const image = typeof base["image"] === "string" && base["image"].trim() ? base["image"].trim() : null;
  const build = _mapping(root["build"], "build");
  const mode = build["mode"] === undefined ? null : _mode(build["mode"], "build.mode");
  return { mode, image, steps: _expand(build) };
}

function _expand(build: Record<string, unknown>): PlatformStep[] {
  const steps: PlatformStep[] = [];
  const apt = _strings(build["apt_install"], "build.apt_install");
  if (apt.length) {
    steps.push({
      type: "RUN",
      args: [`apt-get update && apt-get install -y ${apt.join(" ")} && rm -rf /var/lib/apt/lists/*`],
    });
  }
  const pip = _strings(build["pip_install"], "build.pip_install");
  if (pip.length) steps.push({ type: "RUN", args: [`pip install --no-cache-dir ${pip.join(" ")}`] });
  const npm = _strings(build["npm_install"], "build.npm_install");
  if (npm.length) steps.push({ type: "RUN", args: [`npm install -g ${npm.join(" ")}`] });
  const env = _mapping(build["env"], "build.env");
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") throw new BuildModeError(`build.env.${key} must be a string`);
    steps.push({ type: "ENV", args: [`${key}=${value}`] });
  }
  for (const command of _strings(build["run"], "build.run")) {
    steps.push({ type: "RUN", args: [command] });
  }
  const raw = build["steps"];
  if (raw !== undefined && raw !== null) {
    if (!Array.isArray(raw)) throw new BuildModeError("build.steps must be a list");
    for (const item of raw) {
      if (!isMapping(item)) throw new BuildModeError("each build.steps entry must be a mapping");
      const row = item as Record<string, unknown>;
      const type = row["type"];
      if (typeof type !== "string" || !type.trim()) throw new BuildModeError("build.steps.type must be a non-empty string");
      const args = row["args"];
      if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
        throw new BuildModeError("build.steps.args must be a list of strings");
      }
      steps.push({ type: type.trim(), args: args as string[] });
    }
  }
  return steps;
}

function _dockerfile(templateDir: string, explicit: string | null): string | null {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new BuildModeError(`Dockerfile not found: ${explicit}`);
    return explicit;
  }
  const candidate = path.join(templateDir, "Dockerfile");
  return fs.existsSync(candidate) ? candidate : null;
}

function _mode(value: unknown, where: string): BuildMode {
  if (typeof value !== "string" || !MODES.has(value as BuildMode)) {
    throw new BuildModeError(`${where} must be auto, dockerfile, or steps`);
  }
  return value as BuildMode;
}

function _mapping(value: unknown, where: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isMapping(value)) throw new BuildModeError(`${where} must be a mapping`);
  return value as Record<string, unknown>;
}

function _strings(value: unknown, where: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new BuildModeError(`${where} must be a list of non-empty strings`);
  }
  return value as string[];
}

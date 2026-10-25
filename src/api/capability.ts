/**
 * Capability resolver — resolves template capabilities (port of `api/capability.py`).
 *
 * Phase 1: local-only resolution from `~/.abx/templates/` cache. Phase 2 will add online fallback via
 * `GET /templates/{id}` metadata.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { CapabilityNotSupportedError, TemplateParseError } from "../models/errors.js";
import { SandboxTemplate } from "../models/template.js";
import { getLogger, ExcInfo } from "../utils/logging.js";
import { pyRepr } from "../utils/_pyformat.js";
import { dictGet, pyExcStr } from "../utils/_pyerrors.js";
import { rglobName } from "../utils/_pyos.js";
import { loadYaml as safeLoad } from "../utils/yaml_io.js";

const logger = getLogger("api.capability");

export const TEMPLATE_CACHE_DIR: string = path.join(os.homedir(), ".abx", "templates");

/** Module-level mutable state patched by tests (Python `monkeypatch.setattr(capability_mod, "TEMPLATE_CACHE_DIR", ...)`). */
export const _seams = {
  TEMPLATE_CACHE_DIR,
};

export interface ResolvedCapabilitiesInit {
  capabilities?: Iterable<string>;
}

/** The resolved capability set for a sandbox. */
export class ResolvedCapabilities {
  capabilities: Set<string>;

  constructor(init: ResolvedCapabilitiesInit = {}) {
    this.capabilities = init.capabilities !== undefined ? new Set(init.capabilities) : new Set<string>();
  }
}

// ---------------------------------------------------------------------------
// Capability gate helper
// ---------------------------------------------------------------------------

/** Raise `CapabilityNotSupportedError` when `required` is missing. */
export function checkCapability(capabilities: ReadonlySet<string>, required: string): void {
  if (!capabilities.has(required)) {
    throw new CapabilityNotSupportedError(required);
  }
}

// ---------------------------------------------------------------------------
// Local resolution
// ---------------------------------------------------------------------------

function isDict(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

/**
 * Return true when `data` (a raw template dict at `yaml_path`) refers to `template_id`.
 *
 * Matching is intentionally broad: it compares against the `name` field, the `alias` / `aliases` fields, and the
 * containing directory name.
 */
export function _templateMatches(data: Record<string, any>, yaml_path: string, template_id: string): boolean {
  if (dictGet(data, "name") === template_id) return true;

  const alias = dictGet(data, "alias");
  if (typeof alias === "string" && alias === template_id) return true;

  const aliases = dictGet(data, "aliases");
  if (typeof aliases === "string" && aliases === template_id) return true;
  if (Array.isArray(aliases) && aliases.includes(template_id)) return true;

  return path.basename(path.dirname(yaml_path)) === template_id;
}

/**
 * Scan `~/.abx/templates/` for a `template.yaml` that matches `template_id` by `name`, `alias`/`aliases`, or directory
 * name. Returns `null` when nothing matches.
 *
 * Fail-closed: when a template matches but fails model validation, a `TemplateParseError` is raised instead of
 * skipping it. Only unreadable files and non-dict documents are skipped.
 */
export function _findLocalTemplate(template_id: string): SandboxTemplate | null {
  const cacheDir = _seams.TEMPLATE_CACHE_DIR;
  if (!fs.existsSync(cacheDir)) return null;

  for (const yaml_path of rglobName(cacheDir, "template.yaml")) {
    let data: unknown;
    try {
      data = safeLoad(fs.readFileSync(yaml_path, { encoding: "utf8" }));
    } catch (e) {
      logger.debug("Skipping unreadable template at %s", yaml_path, new ExcInfo(e));
      continue;
    }
    if (!isDict(data)) continue;

    if (!_templateMatches(data, yaml_path, template_id)) continue;

    try {
      return parseTemplateData(data);
    } catch (exc) {
      logger.warning(
        "Matched template at %s failed validation; refusing an invalid template manifest (fail-closed)",
        yaml_path,
        new ExcInfo(exc),
      );
      throw new TemplateParseError(`Template ${pyRepr(template_id)} at ${yaml_path} is malformed: ${pyExcStr(exc)}`);
    }
  }

  return null;
}

/**
 * Parse a raw template dict (as loaded from `template.yaml`).
 *
 * Public so that other layers can validate a generated manifest against the same schema and the same
 * `resources.cpu` / `resources.memory` shorthand handling.
 *
 * Throws `ValidationError` when the manifest fails schema validation.
 */
export function parseTemplateData(data: Record<string, any>): SandboxTemplate {
  const resources = dictGet(data, "resources", {}) || {};
  if ("cpu" in resources && !("cpu_count" in data)) {
    data["cpu_count"] = resources["cpu"];
  }
  if ("memory" in resources && !("memory_mb" in data)) {
    data["memory_mb"] = resources["memory"];
  }
  return SandboxTemplate.modelValidate(data);
}

// ---------------------------------------------------------------------------
// Public resolver
// ---------------------------------------------------------------------------

/**
 * Resolve capabilities for a template.
 *
 * Resolution order:
 *
 * 1. If `local_yaml_path` is given, parse it directly.
 * 2. Scan `~/.abx/templates/` for a matching template name.
 * 3. TODO(Phase2): `GET /templates/{id}` metadata fallback.
 * 4. Return no inferred permissions when no manifest is available.
 */
/** A cache directory name: no separators, so the copy stays inside `~/.abx/templates`. */
function _cacheDirName(raw: string): string | null {
  const name = raw.trim();
  if (!name || name === "N/A" || name === "." || name === "..") return null;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
  return name;
}

/**
 * Remember a deployed template under `~/.abx/templates/<templateId>/template.yaml`.
 *
 * `also` copies the same file under extra directory names (the `--alias`, and the
 * template name when it differs). `abx create <id-or-alias>` matches that
 * directory name, the yaml `name`, or an `alias` field.
 */
export function cacheDeployedTemplate(yamlPath: string, templateId: string, also: readonly string[] = []): void {
  const id = _cacheDirName(templateId);
  if (!id) return;
  if (!fs.existsSync(yamlPath)) return;
  const names = new Set<string>([id]);
  for (const extra of also) {
    const name = _cacheDirName(extra);
    if (name) names.add(name);
  }
  for (const name of names) {
    const destDir = path.join(_seams.TEMPLATE_CACHE_DIR, name);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(yamlPath, path.join(destDir, "template.yaml"));
  }
}

export async function resolveCapabilities(
  template_id: string | null = null,
  opts: { local_yaml_path?: string | null } = {},
): Promise<ResolvedCapabilities> {
  const local_yaml_path = opts.local_yaml_path ?? null;
  let template: SandboxTemplate | null = null;

  // 1. Explicit local path
  if (local_yaml_path) {
    if (fs.existsSync(local_yaml_path)) {
      let data: unknown;
      try {
        data = safeLoad(fs.readFileSync(local_yaml_path, { encoding: "utf8" }));
      } catch (e) {
        throw new TemplateParseError(`Explicit template YAML is unreadable: ${pyExcStr(e)}`);
      }
      if (!isDict(data)) throw new TemplateParseError("Explicit template YAML must contain a template manifest mapping.");
      if (isDict(data)) {
        try {
          template = parseTemplateData(data);
        } catch (exc) {
          logger.warning(
            "Local template YAML at %s failed validation; refusing an invalid template manifest (fail-closed)",
            local_yaml_path,
            new ExcInfo(exc),
          );
          throw new TemplateParseError(`Template at ${local_yaml_path} is malformed: ${pyExcStr(exc)}`);
        }
      }
    }
  }

  // 2. Scan local cache
  if (template === null && template_id) {
    template = _findLocalTemplate(template_id);
  }

  // Template contents do not grant adapter operations or caller permissions.
  // A matching source is still validated above; discovery is supplied by the provider.
  return new ResolvedCapabilities();
}

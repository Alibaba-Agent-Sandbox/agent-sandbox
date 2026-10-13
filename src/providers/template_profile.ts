/**
 * Template image profile owned by the CLI provider, not by `easy_sandbox.server`.
 *
 * The server listens on port 9000 either way. Which `FROM`, whether `ENTRYPOINT` may be replaced, `CMD` versus a
 * platform `start_cmd` / `ready_cmd`, arch, workdir, reserved ports, and the registry note come from the selected
 * provider. Built-in `alicloud-express` has a profile constant here. A plugin may declare the same fields in
 * `ebx-provider.toml` under `[template]`. An unknown id, or a plugin with no `[template]` table, uses the generic
 * Docker profile and the generator says so. That fallback is never the Function Compute image.
 *
 * Provider id resolution matches the rest of `ebx`: explicit id, else `--provider` / `EBX_PROVIDER` / config /
 * `alicloud-express` (`resolveProviderId`).
 */

import { BUILTIN_PROVIDER_ID } from "../utils/config_keys.js";
import { ProviderManifestError } from "./errors.js";
import { loadManifest } from "./manifest.js";
import { cliProvider } from "./selection.js";
import { pluginRoot, resolveProviderId } from "./registry.js";
import * as store from "./store.js";

export type ServerStart = "image_cmd" | "platform_start_cmd";

/** Image contract the template generator renders. `registry` is a pull/push note, not credentials. */
export interface TemplateProfile {
  readonly provider_id: string;
  /** True when this provider declared no profile and the generic profile was substituted. */
  readonly missing_profile: boolean;
  /** Sentence the generator includes when `missing_profile` is true. Empty otherwise. */
  readonly notice: string;
  readonly base_image: string;
  readonly entrypoint_replaceable: boolean;
  readonly server_start: ServerStart;
  readonly cmd: readonly string[] | null;
  readonly start_cmd: string | null;
  readonly ready_cmd: string | null;
  readonly arch: string;
  /** Login user persisted as the sandbox default. Empty means the image default. */
  readonly user: string;
  readonly workdir: string;
  readonly reserved_ports: readonly number[];
  readonly registry: string;
}

interface ProfileFields {
  base_image: string;
  entrypoint_replaceable: boolean;
  server_start: ServerStart;
  cmd: readonly string[] | null;
  start_cmd: string | null;
  ready_cmd: string | null;
  arch: string;
  user: string;
  workdir: string;
  reserved_ports: readonly number[];
  registry: string;
}

/** Wheel install used by the guide and by `ebx template init`. The package is `easy-sandbox-server`, not the client. */
export const EASY_SANDBOX_SERVER_INSTALL = `COPY *.whl /tmp/
RUN if ls /tmp/*.whl 1>/dev/null 2>&1; then \\
        pip install --no-cache-dir /tmp/*.whl && rm -f /tmp/*.whl; \\
    else \\
        pip install --no-cache-dir easy-sandbox-server; \\
    fi`;

/** FC Agent Sandbox profile (section 2 of the template/provider boundary review). */
const ALICLOUD_EXPRESS_FIELDS: ProfileFields = {
  base_image: "fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>",
  entrypoint_replaceable: false,
  server_start: "platform_start_cmd",
  cmd: null,
  start_cmd: "easy-sandbox-server serve --port 9000 --commands /home/user/app/commands.py",
  ready_cmd: "easy-sandbox-server healthcheck --port 9000",
  arch: "linux/amd64",
  user: "user",
  workdir: "/home/user/app",
  reserved_ports: [49983, 5000, 49999],
  registry:
    "public pull; image region must equal the sandbox region; a non-matching FROM takes platform copy + envdInject; no ACR image acceleration",
};

/** Generic Docker profile. OpenSandbox and any provider without `[template]` use this, not the FC image. */
const GENERIC_FIELDS: ProfileFields = {
  base_image: "python:3.12-slim",
  entrypoint_replaceable: true,
  server_start: "image_cmd",
  cmd: ["python3", "commands.py"],
  start_cmd: null,
  ready_cmd: null,
  arch: "linux/amd64",
  user: "",
  workdir: "/app",
  reserved_ports: [],
  registry:
    "pull by image URI; no region-locked FC registry; no envdInject; private-registry auth stays in provider config",
};

export function missingProfileNotice(providerId: string): string {
  return (
    `Provider '${providerId}' has no template profile; using the generic Docker profile ` +
    `(FROM ${GENERIC_FIELDS.base_image}), not the Alibaba Cloud Express FC image.`
  );
}

function bind(fields: ProfileFields, providerId: string, missing: boolean): TemplateProfile {
  return {
    provider_id: providerId,
    missing_profile: missing,
    notice: missing ? missingProfileNotice(providerId) : "",
    base_image: fields.base_image,
    entrypoint_replaceable: fields.entrypoint_replaceable,
    server_start: fields.server_start,
    cmd: fields.cmd ? [...fields.cmd] : null,
    start_cmd: fields.start_cmd,
    ready_cmd: fields.ready_cmd,
    arch: fields.arch,
    user: fields.user,
    workdir: fields.workdir,
    reserved_ports: [...fields.reserved_ports],
    registry: fields.registry,
  };
}

/** Built-in profile for `alicloud-express`. */
export function alicloudExpressProfile(): TemplateProfile {
  return bind(ALICLOUD_EXPRESS_FIELDS, BUILTIN_PROVIDER_ID, false);
}

/** Generic Docker profile bound to `providerId` (not a fallback). */
export function genericProfile(providerId: string): TemplateProfile {
  return bind(GENERIC_FIELDS, providerId, false);
}

function genericFallback(providerId: string): TemplateProfile {
  return bind(GENERIC_FIELDS, providerId, true);
}

function isTable(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function profileError(msg: string): ProviderManifestError {
  return new ProviderManifestError(`Invalid ebx-provider.toml: [template] ${msg}.`);
}

function optionalString(table: Record<string, unknown>, key: string): string | null {
  if (!(key in table) || table[key] === null) return null;
  const val = table[key];
  if (typeof val !== "string") throw profileError(`${key} must be a string`);
  const text = val.trim();
  return text ? text : null;
}

/** Parse a `[template]` table. Throws `ProviderManifestError` when the table is present but invalid. */
export function parseTemplateTable(table: unknown, providerId: string): TemplateProfile {
  if (!isTable(table)) throw profileError("must be a table");
  const base = table["base_image"];
  if (typeof base !== "string" || !base.trim()) throw profileError("base_image is required");
  if (typeof table["entrypoint_replaceable"] !== "boolean") throw profileError("entrypoint_replaceable must be a bool");
  const start = table["server_start"];
  if (start !== "image_cmd" && start !== "platform_start_cmd") {
    throw profileError("server_start must be 'image_cmd' or 'platform_start_cmd'");
  }
  const arch = table["arch"];
  const workdir = table["workdir"];
  const registry = table["registry"];
  if (typeof arch !== "string" || !arch.trim()) throw profileError("arch is required");
  if (typeof workdir !== "string" || !workdir.trim()) throw profileError("workdir is required");
  if (typeof registry !== "string" || !registry.trim()) throw profileError("registry is required");

  let cmd: string[] | null = null;
  if ("cmd" in table && table["cmd"] !== null) {
    const raw = table["cmd"];
    if (!Array.isArray(raw) || !raw.every((part) => typeof part === "string" && part !== "")) {
      throw profileError("cmd must be an array of non-empty strings");
    }
    cmd = raw.length > 0 ? [...raw] : null;
  }
  const startCmd = optionalString(table, "start_cmd");
  const readyCmd = optionalString(table, "ready_cmd");
  let ports: number[] = [];
  if ("reserved_ports" in table && table["reserved_ports"] !== null) {
    const raw = table["reserved_ports"];
    if (!Array.isArray(raw) || !raw.every((n) => typeof n === "number" && Number.isInteger(n) && n > 0 && n < 65536)) {
      throw profileError("reserved_ports must be an array of port numbers");
    }
    ports = [...raw];
  }
  if (start === "image_cmd") {
    if (!cmd) throw profileError("cmd is required when server_start is image_cmd");
    if (startCmd) throw profileError("start_cmd must be empty when server_start is image_cmd");
  } else {
    if (cmd) throw profileError("cmd must be empty when server_start is platform_start_cmd");
    if (!startCmd) throw profileError("start_cmd is required when server_start is platform_start_cmd");
  }
  return {
    provider_id: providerId,
    missing_profile: false,
    notice: "",
    base_image: base.trim(),
    entrypoint_replaceable: table["entrypoint_replaceable"],
    server_start: start,
    cmd,
    start_cmd: startCmd,
    ready_cmd: readyCmd,
    arch: arch.trim(),
    user: typeof table["user"] === "string" ? table["user"].trim() : "",
    workdir: workdir.trim(),
    reserved_ports: ports,
    registry: registry.trim(),
  };
}

function declaredProfile(providerId: string): TemplateProfile | null {
  const receipt = store.readReceipt(providerId);
  if (receipt === null) return null;
  const root = pluginRoot(providerId, receipt);
  const manifest = loadManifest(root);
  if (!("template" in manifest.raw) || manifest.raw["template"] === null || manifest.raw["template"] === undefined) {
    return null;
  }
  return parseTemplateTable(manifest.raw["template"], providerId);
}

/**
 * Profile for one provider id. Never returns the FC image unless the id is `alicloud-express` or the plugin's
 * `[template]` table names that image itself.
 */
export function profileForProvider(providerId: string): TemplateProfile {
  if (providerId === BUILTIN_PROVIDER_ID) return alicloudExpressProfile();
  const declared = declaredProfile(providerId);
  if (declared) return declared;
  return genericFallback(providerId);
}

/**
 * Profile for the provider `ebx` would use.
 *
 * `explicit` is the `--provider` id when the caller already has one. Omit it to use `cliProvider()` /
 * `EBX_PROVIDER` / the configured default (`alicloud-express`).
 */
export function resolveTemplateProfile(explicit?: string | null): TemplateProfile {
  const id = explicit !== undefined && explicit !== null && explicit.trim() ? explicit.trim() : resolveProviderId(cliProvider());
  return profileForProvider(id);
}

/** Dockerfile `CMD` line for `image_cmd`, or null when the profile must not emit one. */
export function dockerfileCmdLine(profile: TemplateProfile): string | null {
  if (profile.server_start !== "image_cmd" || !profile.cmd || profile.cmd.length === 0) return null;
  return `CMD [${profile.cmd.map((part) => JSON.stringify(part)).join(", ")}]`;
}

/** True when the Dockerfile text contains a `CMD` or `ENTRYPOINT` instruction (comments ignored). */
export function dockerfileSetsCmdOrEntrypoint(text: string): boolean {
  let logical = "";
  const hit = (stmt: string): boolean => {
    const s = stmt.trim();
    if (!s || s.startsWith("#")) return false;
    return /^(CMD|ENTRYPOINT)(?:\s|$)/i.test(s);
  };
  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (!logical && (trimmed === "" || trimmed.startsWith("#"))) continue;
    const cont = rawLine.trimEnd().endsWith("\\");
    logical += cont ? `${rawLine.trimEnd().slice(0, -1)} ` : rawLine;
    if (!cont) {
      if (hit(logical)) return true;
      logical = "";
    }
  }
  return logical ? hit(logical) : false;
}

const SERVE_CALL_RE = /\.serve\s*\(|\bstart\s*\(/;
const MAIN_HEAD_RE = /^if\s+__name__\s*==\s*['"]__main__['"]\s*:/;

/**
 * True when a `serve()` / `start()` call runs at import time.
 *
 * A call only inside `if __name__ == "__main__":` is not import time. No main guard counts as import time when a
 * call exists anywhere in the file.
 */
export function serveCallIsImportTime(source: string): boolean {
  const lines = source.split(/\r\n|\r|\n/);
  const rest: string[] = [];
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!found && MAIN_HEAD_RE.test(line.trim()) && !/^[ \t]/.test(line)) {
      found = true;
      i++;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        if (next.trim() === "" || /^[ \t]/.test(next)) i++;
        else {
          i--;
          break;
        }
      }
      continue;
    }
    rest.push(line);
  }
  if (!found) return SERVE_CALL_RE.test(source);
  return SERVE_CALL_RE.test(rest.join("\n"));
}

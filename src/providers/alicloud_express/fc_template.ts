/**
 * Official Alibaba Cloud FCSandbox CreateTemplate API adapter (port of `agent_sandbox/api/fc_template.py`).
 *
 * This module wraps the `@alicloud/fcsandbox20260509` SDK (Node counterpart of the Python
 * `alibabacloud-fcsandbox20260509` wheel) to provide a clean, SDK-independent interface for creating sandbox templates
 * via the official Alibaba Cloud API.
 *
 * Layer: L3 (API) — may import L0 (models, utils) and L1 (transport).
 *
 * All public functions are async (the Python versions were blocking calls into a synchronous SDK).
 */

import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

import { NetworkError, SandboxError, TemplateBuildError, TemplateBuildTimeoutError, TemplateNotFoundError } from "../../models/errors.js";
import { getLogger } from "../../utils/logging.js";
import { pyRepr } from "../../utils/_pyformat.js";
import { pyExcStr } from "../../utils/_pyerrors.js";

const logger = getLogger("api.fc_template");

// ---------------------------------------------------------------------------
// Friendly import guard
// ---------------------------------------------------------------------------

export const _SDK_INSTALL_HINT =
  "Official Alibaba Cloud FCSandbox SDK is not installed.\n" +
  "Install with: npm install @alicloud/fcsandbox20260509 @alicloud/openapi-core";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The slice of the Alibaba Cloud SDK this module needs (swappable in tests through `_sdkLoader`). */
export interface FcSdk {
  /** All generated model classes (`CreateTemplateRequest`, ...). */
  models: Record<string, any>;
  /** `Client` class (`new Client(config)`). */
  Client: new (config: any) => any;
  /** OpenAPI `Config` class (`new Config({accessKeyId, ...})`). */
  Config: new (opts: Record<string, unknown>) => any;
}

const nodeRequire = createRequire(import.meta.url);

function defaultLoadSdk(): FcSdk {
  // Keep SDK loading lazy while exposing literal dependencies to the SEA bundler.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Literal require is necessary for lazy SEA bundling.
  const mod = typeof require === "function" ? require("@alicloud/fcsandbox20260509") : nodeRequire("@alicloud/fcsandbox20260509");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Literal require is necessary for lazy SEA bundling.
  const core = typeof require === "function" ? require("@alicloud/openapi-core") : nodeRequire("@alicloud/openapi-core");
  const Client = mod.default ?? mod.Client;
  const Config = core.$OpenApiUtil?.Config ?? core.OpenApiUtil?.Config;
  if (typeof Client !== "function" || typeof Config !== "function") {
    throw new Error("unexpected @alicloud/fcsandbox20260509 module shape");
  }
  return { models: mod, Client, Config };
}

/** Seam: tests replace `load` to inject a fake SDK (the Python tests patch `alibabacloud_fcsandbox20260509.client.Client`). */
export const _sdkLoader: { load: () => FcSdk } = { load: defaultLoadSdk };

/** Module-level functions/clock the Python tests patch (`get_team_id`, `get_template`, `time.sleep`, `time.monotonic`). */
export const _seams = {
  getTeamId: (...a: Parameters<typeof getTeamId>) => getTeamId(...a),
  getTemplate: (...a: Parameters<typeof getTemplate>) => getTemplate(...a),
  monotonic: (): number => performance.now() / 1000,
  sleep: (seconds: number): Promise<void> => new Promise((r) => setTimeout(r, seconds * 1000)),
};

/** Raise a clear error when the Alibaba Cloud SDK cannot be loaded. */
export function _requireSdk(): FcSdk {
  try {
    return _sdkLoader.load();
  } catch {
    throw new SandboxError(_SDK_INSTALL_HINT, {
      suggestion: "npm install @alicloud/fcsandbox20260509 @alicloud/openapi-core",
    });
  }
}

/** Python `str(exc)` for an Alibaba Cloud SDK exception (`Error: {code} {message} Response: {data}`). */
function sdkErrStr(exc: unknown): string {
  if (exc !== null && typeof exc === "object" && ("code" in exc || "data" in exc) && exc instanceof Error) {
    const e = exc as Error & { code?: unknown; data?: unknown; statusCode?: unknown };
    if (e.code !== undefined && e.code !== null && e.code !== "") {
      const data = e.data && typeof e.data === "object" ? { ...(e.data as object), ...(e.statusCode !== undefined && !("statusCode" in (e.data as object)) ? { statusCode: e.statusCode } : {}) } : e.data;
      // The JS SDK prefixes `message` with `<code>: `; the Python `TeaException.message` does not.
      const code = String(e.code);
      const message = e.message.startsWith(`${code}: `) ? e.message.slice(code.length + 2) : e.message;
      return `Error: ${code} ${message} Response: ${data === undefined ? "None" : pyRepr(data)}`;
    }
  }
  return pyExcStr(exc);
}

// ---------------------------------------------------------------------------
// Envd target-image derivation
// ---------------------------------------------------------------------------

/**
 * Derive a distinct target image ref from a source image.
 *
 * When envd-inject is enabled the platform's `copy.image` (destination) MUST differ from `sandboxConfig.image` (source).
 * This helper appends a random `-fcsandbox-<hex>` suffix to the tag so the two never collide.
 *
 * The parser handles `host:port/path:tag` correctly — a colon followed by a `/` is a port separator, not a tag delimiter.
 */
export function _deriveTargetImage(image: string): string {
  const suffix = randomBytes(3).toString("hex"); // 6 hex chars
  const idx = image.lastIndexOf(":");
  const name_part = idx >= 0 ? image.slice(0, idx) : "";
  const tag = idx >= 0 ? image.slice(idx + 1) : image;
  const sep = idx >= 0 ? ":" : "";
  // A real tag has no "/" after the colon; a port would be followed by "/path", so if "/" appears in *tag* the colon
  // was a port separator.
  if (sep && !tag.includes("/")) {
    return `${name_part}:${tag}-fcsandbox-${suffix}`;
  }
  return `${image}:fcsandbox-${suffix}`;
}

/**
 * Return a target image guaranteed to differ from `source`.
 *
 * When `target` is `null` **or** equals `source`, a derived image ref with a random suffix is returned via
 * {@link _deriveTargetImage}. Otherwise `target` is returned as-is.
 */
export function _resolveTargetImage(source: string, target: string | null | undefined): string {
  if (target === null || target === undefined || target === source) {
    return _deriveTargetImage(source);
  }
  return target;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

function makeClient(sdk: FcSdk, access_key_id: string, access_key_secret: string, region: string, endpoint?: string | null): any {
  const config = new sdk.Config({
    accessKeyId: access_key_id,
    accessKeySecret: access_key_secret,
    regionId: region,
    endpoint: endpoint || `fcsandbox.${region}.aliyuncs.com`,
  });
  return new sdk.Client(config);
}

/**
 * Retrieve the first available team ID via `ListTeams`.
 *
 * @throws SandboxError if SDK is missing or no teams found.
 */
export async function getTeamId(
  access_key_id: string,
  access_key_secret: string,
  region = "cn-hangzhou",
  opts: { endpoint?: string | null } = {},
): Promise<string> {
  const sdk = _requireSdk();
  const client = makeClient(sdk, access_key_id, access_key_secret, region, opts.endpoint);

  let resp: any;
  try {
    resp = await client.listTeams(new sdk.models["ListTeamsRequest"]());
  } catch (exc) {
    throw new NetworkError(`ListTeams API call failed: ${sdkErrStr(exc)}`, {
      suggestion: "Check AK/SK credentials and network connectivity.",
    });
  }

  const teams: any[] = resp.body && resp.body.teams ? resp.body.teams : [];
  if (!teams.length) {
    throw new SandboxError("No teams found for the given credentials.", {
      suggestion: "Ensure the Alibaba Cloud account has FCSandbox teams, or pass --team-id explicitly.",
    });
  }

  const team_id: string = teams[0].teamID || "";
  logger.info("Resolved team ID: %s (from %d team(s))", team_id, teams.length);
  return team_id;
}

export interface GetTemplateOptions {
  access_key_id: string;
  access_key_secret: string;
  region?: string;
  endpoint?: string | null;
  team_id?: string | null;
}

/** Query template status via `GetTemplate`. Returns a dict with template details from the API response. */
export async function getTemplate(template_id: string, opts: GetTemplateOptions): Promise<Record<string, any>> {
  const { access_key_id, access_key_secret, region = "cn-hangzhou", endpoint = null } = opts;
  let team_id = opts.team_id ?? null;
  const sdk = _requireSdk();
  const client = makeClient(sdk, access_key_id, access_key_secret, region, endpoint);

  if (!team_id) {
    team_id = await _seams.getTeamId(access_key_id, access_key_secret, region, { endpoint });
  }

  let resp: any;
  try {
    resp = await client.getTemplate(template_id, new sdk.models["GetTemplateRequest"]({ teamID: team_id }));
  } catch (exc) {
    const sdkError = exc as { statusCode?: unknown; code?: unknown } | null;
    if (sdkError?.statusCode === 404 && sdkError.code === "TemplateNotFound") {
      throw new TemplateNotFoundError(`Template ${template_id} was not found.`);
    }
    throw new NetworkError(`GetTemplate API call failed: ${sdkErrStr(exc)}`, {
      suggestion: "Check template ID, AK/SK, and network connectivity.",
    });
  }

  const body = resp.body;
  const result: Record<string, any> = {};
  if (body) {
    const body_map = typeof body.toMap === "function" ? body.toMap() : {};
    Object.assign(result, body_map);
  }
  result["statusCode"] = resp.statusCode;
  return result;
}

/** Delete an Express template through the official FCSandbox API. */
export async function deleteTemplate(template_id: string, opts: GetTemplateOptions): Promise<void> {
  const { access_key_id, access_key_secret, region = "cn-hangzhou", endpoint = null } = opts;
  const sdk = _requireSdk();
  const client = makeClient(sdk, access_key_id, access_key_secret, region, endpoint);
  const team = opts.team_id || await _seams.getTeamId(access_key_id, access_key_secret, region, { endpoint });
  try {
    await client.deleteTemplate(template_id, new sdk.models["DeleteTemplateRequest"]({ teamID: team }));
  } catch (exc) {
    throw new NetworkError(`DeleteTemplate API call failed: ${sdkErrStr(exc)}`, {
      suggestion: "Check template ID, AK/SK, and network connectivity.",
    });
  }
}

export interface WaitForTemplateReadyOptions extends GetTemplateOptions {
  timeout?: number;
  poll_interval?: number;
  on_poll?: ((state: string, elapsed: number) => void) | null;
}

/**
 * Poll the official API until a template is ready or definitively fails.
 *
 * `on_poll`: optional callback invoked after each poll with `(state, elapsed_seconds)` — used by the CLI to refresh a
 * spinner with the current build state and elapsed time.
 */
export async function waitForTemplateReady(
  template_id: string,
  opts: WaitForTemplateReadyOptions,
): Promise<Record<string, any>> {
  const { access_key_id, access_key_secret, region = "cn-hangzhou", endpoint = null, timeout = 600, poll_interval = 5.0 } = opts;
  const on_poll = opts.on_poll ?? null;
  let team_id = opts.team_id ?? null;

  if (!team_id) {
    team_id = await _seams.getTeamId(access_key_id, access_key_secret, region, { endpoint });
  }

  const start = _seams.monotonic();
  const deadline = start + timeout;
  let last_state = "unknown";
  while (_seams.monotonic() < deadline) {
    const data = await _seams.getTemplate(template_id, {
      access_key_id,
      access_key_secret,
      region,
      endpoint,
      team_id,
    });
    const status = data["status"] || {};
    const isDict = status !== null && typeof status === "object" && !Array.isArray(status);
    const state = isDict ? (status["state"] ?? "unknown") : status;
    last_state = String(state).toLowerCase();
    if (on_poll !== null) on_poll(last_state, _seams.monotonic() - start);
    if (last_state === "ready") return data;
    if (last_state === "error") {
      const reason = isDict ? (status["reason"] ?? {}) : {};
      const reasonIsDict = reason !== null && typeof reason === "object" && !Array.isArray(reason);
      const message = reasonIsDict ? (reason["message"] ?? "unknown build error") : reason;
      throw new TemplateBuildError(`Template '${template_id}' entered error state: ${String(message)}`);
    }
    await _seams.sleep(poll_interval);
  }

  throw new TemplateBuildTimeoutError(
    `Template '${template_id}' did not become ready within ${timeout}s (last state: ${last_state}).`,
  );
}

export interface ListOfficialTemplatesOptions {
  access_key_id: string;
  access_key_secret: string;
  region?: string;
  team_id?: string | null;
  endpoint?: string | null;
  max_results?: number;
}

/**
 * List templates via the official `ListTemplates` API (paginated).
 *
 * Returns a flat list of template dicts (all pages concatenated). Each item contains at minimum `templateID`, `name` and
 * `status` when returned by the platform.
 */
export async function listOfficialTemplates(opts: ListOfficialTemplatesOptions): Promise<Array<Record<string, any>>> {
  const { access_key_id, access_key_secret, region = "cn-hangzhou", endpoint = null, max_results = 100 } = opts;
  let team_id = opts.team_id ?? null;
  const sdk = _requireSdk();
  const client = makeClient(sdk, access_key_id, access_key_secret, region, endpoint);

  if (!team_id) {
    team_id = await _seams.getTeamId(access_key_id, access_key_secret, region, { endpoint });
  }

  const results: Array<Record<string, any>> = [];
  let next_token: string | null = null;
  for (;;) {
    const req = new sdk.models["ListTemplatesRequest"]({
      teamID: team_id,
      maxResults: max_results,
      nextToken: next_token ?? undefined,
    });
    let resp: any;
    try {
      resp = await client.listTemplates(req);
    } catch (exc) {
      throw new NetworkError(`ListTemplates API call failed: ${sdkErrStr(exc)}`, {
        suggestion: "Check AK/SK, region and network connectivity.",
      });
    }

    const body = resp.body;
    const page: any[] = body && body.templates ? body.templates : [];
    for (const tpl of page) {
      const item = typeof tpl.toMap === "function" ? tpl.toMap() : {};
      results.push(item);
    }

    next_token = body ? (body.nextToken ?? null) : null;
    if (!next_token) break;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers: find + update existing template (409 fallback)
// ---------------------------------------------------------------------------

/**
 * Search for a template by name in the given team.
 *
 * Returns the templateID if found, else `null`. Handles pagination to ensure all templates are checked.
 */
export async function _findTemplateByName(client: any, team_id: string, name: string, sdk?: FcSdk): Promise<string | null> {
  const s = sdk ?? _requireSdk();
  let next_token: string | null = null;
  for (;;) {
    let resp: any;
    try {
      const req = new s.models["ListTemplatesRequest"]({
        teamID: team_id,
        maxResults: 100,
        nextToken: next_token ?? undefined,
      });
      resp = await client.listTemplates(req);
    } catch {
      return null;
    }

    const templates: any[] = resp.body && resp.body.templates ? resp.body.templates : [];
    for (const tpl of templates) {
      if (tpl.name === name) return String(tpl.templateID);
    }

    next_token = resp.body ? (resp.body.nextToken ?? null) : null;
    if (!next_token) break;
  }

  return null;
}

/** Platform text when UpdateTemplate is given a start command for a generation-1 template. */
export const GEN1_START_COMMAND =
  "sandboxConfig.startCommand is only supported when updating a generation 2 sandbox template";

export function generation1UpdateMessage(name: string, templateId: string): string {
  return (
    `Template '${name}' (${templateId}) is generation 1. ${GEN1_START_COMMAND}. ` +
    "A generation-1 template cannot be updated to generation 2."
  );
}

export function generation1UpdateSuggestion(templateId: string): string {
  return (
    `abx template delete ${templateId} -y\n` +
    `abx template deploy . -y\n` +
    "Or rerun the same deploy with --force to delete that template and create it again."
  );
}

function _generationOf(value: unknown): number | null {
  if (value === null || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const direct = rec["generation"];
  if (typeof direct === "number" && Number.isFinite(direct)) return Math.trunc(direct);
  if (typeof direct === "string" && /^\d+$/.test(direct.trim())) return Number(direct.trim());
  const runtime = rec["runtimeConfig"] ?? rec["runtime_config"];
  if (runtime !== null && typeof runtime === "object") {
    const sandbox = (runtime as Record<string, unknown>)["sandboxConfig"] ?? (runtime as Record<string, unknown>)["sandbox_config"];
    return _generationOf(sandbox);
  }
  return null;
}

async function _templateGeneration(client: any, sdk: FcSdk, templateId: string, teamId: string): Promise<number | null> {
  if (typeof client.getTemplate !== "function") return null;
  try {
    const resp = await client.getTemplate(templateId, new sdk.models["GetTemplateRequest"]({ teamID: teamId }));
    const body = resp?.body;
    const map = body && typeof body.toMap === "function" ? body.toMap() : body;
    return _generationOf(map);
  } catch {
    return null;
  }
}

async function _deleteTemplate(client: any, sdk: FcSdk, templateId: string, teamId: string): Promise<void> {
  try {
    await client.deleteTemplate(templateId, new sdk.models["DeleteTemplateRequest"]({ teamID: teamId }));
  } catch (exc) {
    throw new TemplateBuildError(`Could not delete generation-1 template ${templateId}: ${sdkErrStr(exc)}`, {
      suggestion: generation1UpdateSuggestion(templateId),
    });
  }
}

export interface UpdateExistingTemplateOptions {
  client: any;
  name: string;
  team_id: string;
  image: string;
  cpu: number;
  memory_size: number;
  disk_size: number | null;
  internet_access: boolean | null;
  generation: number;
  start_command: string | null;
  ready_command: string | null;
  envd_inject: boolean;
  effective_registry_type: string | null;
  acr_instance_id: string | null;
  registry_username: string | null;
  registry_password: string | null;
  registry_vpc_id: string | null;
  registry_vswitch_id: string | null;
  registry_security_group_id: string | null;
  target_image?: string | null;
}

/** Update an existing template by name (fallback for 409). */
export async function _updateExistingTemplate(opts: UpdateExistingTemplateOptions): Promise<Record<string, any>> {
  const {
    client,
    name,
    team_id,
    image,
    cpu,
    memory_size,
    disk_size,
    internet_access,
    start_command,
    ready_command,
    envd_inject,
    effective_registry_type,
    acr_instance_id,
    registry_username,
    registry_password,
    registry_vpc_id,
    registry_vswitch_id,
    registry_security_group_id,
  } = opts;
  const target_image = opts.target_image ?? null;
  const sdk = _requireSdk();
  const m = sdk.models;

  const template_id = await _findTemplateByName(client, team_id, name, sdk);
  if (!template_id) {
    throw new TemplateBuildError(`Template '${name}' already exists but could not be found for update.`, {
      suggestion: "Delete the old template or use a different name.",
    });
  }

  // Build registry config for copy action
  let copy_registry_config: any = null;
  if (registry_username || registry_password) {
    const copy_auth = new m["PublicUpdateTemplateRegistryAuthConfig"]({
      userName: registry_username || "",
      password: registry_password || "",
    });
    let copy_network: any = null;
    if (registry_vpc_id || registry_vswitch_id || registry_security_group_id) {
      copy_network = new m["PublicUpdateTemplateRegistryNetworkConfig"]({
        vpcId: registry_vpc_id ?? undefined,
        vSwitchId: registry_vswitch_id ?? undefined,
        securityGroupId: registry_security_group_id ?? undefined,
      });
    }
    copy_registry_config = new m["PublicUpdateTemplateRegistryConfig"]({
      authConfig: copy_auth,
      networkConfig: copy_network ?? undefined,
    });
  }

  // Note: generation and osType cannot be modified via UpdateTemplate; only image, start_command, ready_command,
  // registry_* are allowed.
  const sandbox_config = new m["PublicUpdateTemplateSandboxConfig"]({
    image,
    registryType: effective_registry_type ?? undefined,
    acrInstanceId: acr_instance_id ?? undefined,
    startCommand: start_command ?? undefined,
    readyCommand: ready_command ?? undefined,
    registryConfig: copy_registry_config ?? undefined,
  });

  const runtime_config = new m["PublicUpdateTemplateRuntimeConfig"]({
    cpu,
    memorySize: memory_size,
    diskSize: disk_size ?? undefined,
    internetAccess: internet_access ?? undefined,
    sandboxConfig: sandbox_config,
  });

  let build_config: any = null;
  if (envd_inject) {
    const resolved_target = _resolveTargetImage(image, target_image);
    const copy_action = new m["PublicUpdateTemplateCopyAction"]({
      enabled: true,
      image: resolved_target,
      registryType: effective_registry_type ?? undefined,
      acrInstanceId: acr_instance_id ?? undefined,
      registryConfig: copy_registry_config ?? undefined,
    });
    build_config = new m["PublicUpdateTemplateBuildConfig"]({
      envdInject: new m["PublicUpdateTemplateEnvdInjectAction"]({ enabled: true }),
      copy: copy_action,
    });
  }

  const update_input = new m["PublicUpdateTemplateInput"]({
    runtimeConfig: runtime_config,
    buildConfig: build_config ?? undefined,
  });
  const request = new m["UpdateTemplateRequest"]({ body: update_input, teamID: team_id });

  logger.info("Calling UpdateTemplate: id=%s, name=%s, image=%s", template_id, name, image);

  let resp: any;
  try {
    resp = await client.updateTemplate(template_id, request);
  } catch (exc) {
    throw new TemplateBuildError(`UpdateTemplate API call failed: ${sdkErrStr(exc)}`, {
      suggestion: "Check template status, AK/SK credentials, and image URL.",
    });
  }

  const body = resp.body;
  const result: Record<string, any> = {
    templateID: template_id,
    requestId: body ? body.requestId : null,
    code: null,
    message: "updated (was already existing)",
    statusCode: resp.statusCode,
  };

  logger.info("UpdateTemplate succeeded: templateID=%s, statusCode=%s", template_id, resp.statusCode);

  return result;
}

function _platformSteps(m: any, steps?: Array<{ type: string; args: string[] }> | null): any[] | undefined {
  if (!steps?.length) return undefined;
  return steps.map((step) => new m["CreateTemplateStep"]({ type: step.type, args: step.args }));
}

// ---------------------------------------------------------------------------
// Core: create_official_template
// ---------------------------------------------------------------------------

export interface CreateOfficialTemplateOptions {
  name: string;
  image: string;
  access_key_id: string;
  access_key_secret: string;
  region?: string;
  team_id?: string | null;
  endpoint?: string | null;
  cpu?: number;
  memory_size?: number;
  disk_size?: number | null;
  internet_access?: boolean | null;
  generation?: number;
  start_command?: string | null;
  ready_command?: string | null;
  envd_inject?: boolean;
  registry_type?: string | null;
  acr_instance_id?: string | null;
  registry_username?: string | null;
  registry_password?: string | null;
  registry_vpc_id?: string | null;
  registry_vswitch_id?: string | null;
  registry_security_group_id?: string | null;
  target_image?: string | null;
  steps?: Array<{ type: string; args: string[] }> | null;
  /** Delete a generation-1 template of the same name and create it again. */
  force?: boolean;
  /** Refuse name conflicts instead of updating an existing template (including a concurrent create race). */
  update_existing?: boolean;
  /** Internal: a generation-1 template was already deleted once for this call. */
  _replaced?: boolean;
}

/**
 * Create a sandbox template via the official Alibaba Cloud CreateTemplate API.
 *
 * Lazily loads the `@alicloud/fcsandbox20260509` SDK and raises a friendly error if it is not installed.
 *
 * @returns Dict with keys: `templateID`, `requestId`, `code`, `message`, `statusCode`.
 * @throws SandboxError if the SDK is missing; TemplateBuildError if the API call fails.
 */
export async function createOfficialTemplate(opts: CreateOfficialTemplateOptions): Promise<Record<string, any>> {
  const {
    name,
    image,
    access_key_id,
    access_key_secret,
    region = "cn-hangzhou",
    endpoint = null,
    cpu = 2,
    memory_size = 2048,
    disk_size = null,
    internet_access = null,
    generation = 1,
    start_command = null,
    ready_command = null,
    envd_inject = false,
    registry_type = null,
    acr_instance_id = null,
    registry_username = null,
    registry_password = null,
    registry_vpc_id = null,
    registry_vswitch_id = null,
    registry_security_group_id = null,
    target_image = null,
    steps = null,
  } = opts;
  const force = opts.force ?? false;
  let team_id = opts.team_id ?? null;
  const sdk = _requireSdk();
  const m = sdk.models;

  // Auto-resolve team_id if not provided
  if (!team_id) {
    logger.info("No team_id provided, auto-resolving via ListTeams...");
    team_id = await _seams.getTeamId(access_key_id, access_key_secret, region, { endpoint });
  }

  // Auto-detect registry_type
  let effective_registry_type: string | null = registry_type;
  if (!effective_registry_type) {
    effective_registry_type = acr_instance_id ? "acree" : null;
  }

  // Build registry config if credentials provided
  let registry_config: any = null;
  if (registry_username || registry_password) {
    const auth_config = new m["CreateTemplateRegistryAuthConfig"]({
      userName: registry_username || "",
      password: registry_password || "",
    });
    let network_config: any = null;
    if (registry_vpc_id || registry_vswitch_id || registry_security_group_id) {
      network_config = new m["CreateTemplateRegistryNetworkConfig"]({
        vpcId: registry_vpc_id ?? undefined,
        vSwitchId: registry_vswitch_id ?? undefined,
        securityGroupId: registry_security_group_id ?? undefined,
      });
    }
    registry_config = new m["CreateTemplateRegistryConfig"]({
      authConfig: auth_config,
      networkConfig: network_config ?? undefined,
    });
  }

  const sandbox_config = new m["CreateTemplateSandboxConfig"]({
    image,
    generation,
    registryType: effective_registry_type ?? undefined,
    acrInstanceId: acr_instance_id ?? undefined,
    startCommand: start_command ?? undefined,
    readyCommand: ready_command ?? undefined,
    registryConfig: registry_config ?? undefined,
    steps: _platformSteps(m, steps),
  });

  const runtime_config = new m["CreateTemplateRuntimeConfig"]({
    cpu,
    memorySize: memory_size,
    diskSize: disk_size ?? undefined,
    internetAccess: internet_access ?? undefined,
    sandboxConfig: sandbox_config,
  });

  // Pre-compute the resolved target image so both the create path and the 409->update fallback use the exact same
  // value (no double-derivation).
  const resolved_target = _resolveTargetImage(image, target_image);

  // When envdInject is enabled, the API requires copy.enabled=True as well.
  let build_config: any = null;
  if (envd_inject) {
    // Copy action — copies the user image into an internal registry so that envd can inject into it.
    let copy_auth: any = null;
    if (registry_username || registry_password) {
      copy_auth = new m["CreateTemplateRegistryAuthConfig"]({
        userName: registry_username || "",
        password: registry_password || "",
      });
    }
    let copy_network: any = null;
    if (registry_vpc_id || registry_vswitch_id || registry_security_group_id) {
      copy_network = new m["CreateTemplateRegistryNetworkConfig"]({
        vpcId: registry_vpc_id ?? undefined,
        vSwitchId: registry_vswitch_id ?? undefined,
        securityGroupId: registry_security_group_id ?? undefined,
      });
    }
    let copy_registry_config: any = null;
    if (copy_auth || copy_network) {
      copy_registry_config = new m["CreateTemplateRegistryConfig"]({
        authConfig: copy_auth ?? undefined,
        networkConfig: copy_network ?? undefined,
      });
    }
    const copy_action = new m["CreateTemplateCopyAction"]({
      enabled: true,
      image: resolved_target,
      registryType: effective_registry_type ?? undefined,
      acrInstanceId: acr_instance_id ?? undefined,
      registryConfig: copy_registry_config ?? undefined,
    });
    build_config = new m["CreateTemplateBuildConfig"]({
      envdInject: new m["CreateTemplateEnvdInjectAction"]({ enabled: true }),
      copy: copy_action,
    });
  }

  const create_input = new m["CreateTemplateInput"]({
    name,
    teamID: team_id,
    runtimeConfig: runtime_config,
    buildConfig: build_config ?? undefined,
  });
  const request = new m["CreateTemplateRequest"]({ body: create_input });

  const client = makeClient(sdk, access_key_id, access_key_secret, region, endpoint);

  logger.info(
    "Calling CreateTemplate: name=%s, image=%s, team=%s, region=%s, envdInject=%s, generation=%d",
    name,
    image,
    team_id,
    region,
    envd_inject,
    generation,
  );

  let resp: any;
  try {
    resp = await client.createTemplate(request);
  } catch (exc) {
    const exc_str = sdkErrStr(exc);
    // Handle 409 TemplateAlreadyExists by falling back to UpdateTemplate
    if (exc_str.includes("TemplateAlreadyExists") || exc_str.includes("409")) {
      if (opts.update_existing === false) {
        throw new TemplateBuildError(`Template '${name}' already exists; choose a new version name.`, {
          suggestion: "Existing template was not updated or deleted.",
        });
      }
      logger.info("Template '%s' already exists, attempting UpdateTemplate...", name);
      const team = team_id || "";
      if ((start_command || ready_command) && !opts._replaced) {
        const existing = await _findTemplateByName(client, team, name, sdk);
        if (existing) {
          const existingGeneration = await _templateGeneration(client, sdk, existing, team);
          if (existingGeneration !== null && existingGeneration !== 2) {
            if (!force) {
              throw new TemplateBuildError(generation1UpdateMessage(name, existing), {
                suggestion: generation1UpdateSuggestion(existing),
              });
            }
            logger.info("Deleting generation-%s template %s before recreating it", existingGeneration, existing);
            await _deleteTemplate(client, sdk, existing, team);
            return createOfficialTemplate({ ...opts, team_id: team, _replaced: true });
          }
        }
      }
      try {
        return await _updateExistingTemplate({
          client,
          name,
          team_id: team,
          image,
          cpu,
          memory_size,
          disk_size,
          internet_access,
          generation,
          start_command,
          ready_command,
          envd_inject,
          effective_registry_type,
          acr_instance_id,
          registry_username,
          registry_password,
          registry_vpc_id,
          registry_vswitch_id,
          registry_security_group_id,
          target_image: resolved_target,
        });
      } catch (updateErr) {
        const updateText = updateErr instanceof Error ? updateErr.message : String(updateErr);
        if (
          (start_command || ready_command) &&
          !opts._replaced &&
          updateText.includes("startCommand is only supported when updating a generation 2")
        ) {
          const existing = await _findTemplateByName(client, team, name, sdk);
          if (existing && force) {
            logger.info("UpdateTemplate rejected a start command; deleting %s and recreating", existing);
            await _deleteTemplate(client, sdk, existing, team);
            return createOfficialTemplate({ ...opts, team_id: team, _replaced: true });
          }
          if (existing) {
            throw new TemplateBuildError(generation1UpdateMessage(name, existing), {
              suggestion: generation1UpdateSuggestion(existing),
            });
          }
        }
        throw updateErr;
      }
    }

    throw new TemplateBuildError(`CreateTemplate API call failed: ${exc_str}`, {
      suggestion:
        "Check AK/SK credentials, image URL, and network. Ensure the image is accessible from the FC sandbox platform.",
    });
  }

  const body = resp.body;
  const result: Record<string, any> = {
    templateID: body ? body.templateID : null,
    requestId: body ? body.requestId : null,
    code: body ? body.code : null,
    message: body ? body.message : null,
    statusCode: resp.statusCode,
  };

  logger.info("CreateTemplate succeeded: templateID=%s, statusCode=%s", result["templateID"], result["statusCode"]);

  return result;
}

// ---------------------------------------------------------------------------
// Request body builder (for testing / inspection)
// ---------------------------------------------------------------------------

export interface BuildCreateTemplateRequestMapOptions {
  name: string;
  image: string;
  team_id: string;
  cpu?: number;
  memory_size?: number;
  disk_size?: number | null;
  internet_access?: boolean | null;
  generation?: number;
  start_command?: string | null;
  ready_command?: string | null;
  envd_inject?: boolean;
  registry_type?: string | null;
  acr_instance_id?: string | null;
  registry_username?: string | null;
  registry_password?: string | null;
  target_image?: string | null;
  steps?: Array<{ type: string; args: string[] }> | null;
}

/**
 * Build the CreateTemplateRequest as a dict (for testing / debugging).
 *
 * This constructs the same request body that {@link createOfficialTemplate} would send, but returns the `toMap()` dict
 * without making an API call.
 */
export function buildCreateTemplateRequestMap(opts: BuildCreateTemplateRequestMapOptions): Record<string, any> {
  const {
    name,
    image,
    team_id,
    cpu = 2,
    memory_size = 2048,
    disk_size = null,
    internet_access = null,
    generation = 1,
    start_command = null,
    ready_command = null,
    envd_inject = false,
    registry_type = null,
    acr_instance_id = null,
    registry_username = null,
    registry_password = null,
    target_image = null,
    steps = null,
  } = opts;
  const sdk = _requireSdk();
  const m = sdk.models;

  let effective_registry_type: string | null = registry_type;
  if (!effective_registry_type) {
    effective_registry_type = acr_instance_id ? "acree" : null;
  }

  let registry_config: any = null;
  if (registry_username || registry_password) {
    registry_config = new m["CreateTemplateRegistryConfig"]({
      authConfig: new m["CreateTemplateRegistryAuthConfig"]({
        userName: registry_username || "",
        password: registry_password || "",
      }),
    });
  }

  const sandbox_config = new m["CreateTemplateSandboxConfig"]({
    image,
    generation,
    registryType: effective_registry_type ?? undefined,
    acrInstanceId: acr_instance_id ?? undefined,
    startCommand: start_command ?? undefined,
    readyCommand: ready_command ?? undefined,
    registryConfig: registry_config ?? undefined,
    steps: _platformSteps(m, steps),
  });

  const runtime_config = new m["CreateTemplateRuntimeConfig"]({
    cpu,
    memorySize: memory_size,
    diskSize: disk_size ?? undefined,
    internetAccess: internet_access ?? undefined,
    sandboxConfig: sandbox_config,
  });

  let build_config: any = null;
  if (envd_inject) {
    let copy_rc: any = null;
    if (registry_username || registry_password) {
      copy_rc = new m["CreateTemplateRegistryConfig"]({
        authConfig: new m["CreateTemplateRegistryAuthConfig"]({
          userName: registry_username || "",
          password: registry_password || "",
        }),
      });
    }
    const resolved_target = _resolveTargetImage(image, target_image);
    const copy_action = new m["CreateTemplateCopyAction"]({
      enabled: true,
      image: resolved_target,
      registryType: registry_type ? registry_type : acr_instance_id ? "acree" : undefined,
      acrInstanceId: acr_instance_id ?? undefined,
      registryConfig: copy_rc ?? undefined,
    });
    build_config = new m["CreateTemplateBuildConfig"]({
      envdInject: new m["CreateTemplateEnvdInjectAction"]({ enabled: true }),
      copy: copy_action,
    });
  }

  const create_input = new m["CreateTemplateInput"]({
    name,
    teamID: team_id,
    runtimeConfig: runtime_config,
    buildConfig: build_config ?? undefined,
  });
  const request = new m["CreateTemplateRequest"]({ body: create_input });
  return { ...request.toMap() };
}

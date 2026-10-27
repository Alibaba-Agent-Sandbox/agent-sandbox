import type { ResourceJournalCallbacks } from "../../../template/resource_journal.js";
import type { PreparedTemplate } from "../../template_contract.js";
import { DockerSetupError, runTool } from "../../shared/project.js";
import { prepareTemplateBuildInputs } from "../../../cli/template_project.js";
import { withGuidedConfiguration, canGuideConfiguration, type GuidanceField } from "../../../cli/config_guidance.js";
import { getOperationConfig } from "../../../utils/operation_config.js";
import { templateUi } from "./metadata.js";
export { _installParams, _GITHUB_TOKEN_HELP } from "./metadata.js";
import { _printInitSummary, _GITHUB_TOKEN_HELP, _configCmd, _withGithubRateLimitRetry, usageError, _lazyModule, _isNlDescription, _findTemplateYaml, _selectScaffoldCase, _codePointCompare, _LAZY_MODULES, _githubRateLimitSetupAvailable, _offerGithubTokenSetup, _tryArrowCasePicker, _scaffoldPickerAvailable, pyStrip, templateSeams as catalogSeams, search, init } from "../../../cli/template_catalog.js";
export * from "../../../cli/template_catalog.js";
/**
 * Template management CLI commands (`abx template ...`; `abx deploy` is the top-level shortcut of `template deploy`).
 *
 * Port of `cli/commands/template.py`. Helper functions keep the Python names (snake_case -> `_camelCase`); keyword
 * arguments of the internal helpers keep their Python (snake_case) spelling because they are plain data. Every module
 * attribute the Python tests monkeypatch is reachable through the mutable {@link templateSeams} object: all internal
 * calls read it at call time.
 */
import fs from "node:fs";
import nodePath from "node:path";
import { getCurrentContext, group, type Context } from "../../../cli/kit.js";
import { CliError, UsageError, sysExit } from "../../../cli/errors.js";
import { echo, sys } from "../../../cli/io.js";
import { confirm } from "../../../cli/prompts.js";
import { isatty } from "../../../cli/io.js";
import { cleandoc } from "../../../utils/_py.js";
import { EXIT_NOT_FOUND, handleErrors } from "../../../cli/error_handler.js";
import { getFormatter } from "../../../cli/formatters.js";
import { requireTemplateFeature } from "./selection.js";
import { enableVerbose, getOutput, isCiEnv } from "../../../cli/output.js";
import { ACRConfig, DockerBuilder, contextHasPinnedServerRequirement, dockerBuildxAvailable } from "../docker_builder.js";
import { cacheDeployedTemplate } from "../../../api/capability.js";
import * as fcTemplate from "../fc_template.js";
import { formatFixed0, homeDir, which } from "../../../agent/_pycompat.js";
import { ACRLoginError, NetworkError, TemplateBuildError, TemplateNotFoundError } from "../../../models/errors.js";
import { AKSK_ENV_SUGGESTION } from "../credential_names.js";
import { loadConfig } from "../../../transport/config.js";
import { dotenvValues } from "../../../utils/_dotenv.js";
import { pyRepr, pyStr, pyTruthy } from "../../../utils/_pyformat.js";
import { AttributeError, OSError, mkdirParents, pathExists, pyCopytree, pyJoin, pyResolve, pyTypeNameOf, readTextPy } from "../../../utils/_pyos.js";
import { loadYaml as yamlSafeLoad } from "../../../utils/yaml_io.js";
import * as registryMod from "../../../utils/registry.js";
import { BUILTIN_TEMPLATES, RegistryClient, loadTemplateFromYaml } from "../../../utils/registry.js";
import { resolveTemplateProfile, type TemplateProfile } from "../../template_profile.js";
import { BuildModeError, commandWithStepEnvironment, resolveBuildPlan, type BuildPlan } from "../../../template/build_plan.js";
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any


/** True when this process was started with `--acr-namespace` (an env value does not count). */
export function explicitAcrNamespaceArgv(argv: readonly string[] = process.argv): boolean {
    return argv.some((arg) => arg === "--acr-namespace" || arg.startsWith("--acr-namespace="));
}

/**
 * True when the parsed command passed `--acr-namespace`.
 * An `ACR_NAMESPACE` environment value is not explicit.
 */
export function acrNamespacePassedOnCli(): boolean {
    const ctx = getCurrentContext(true);
    for (const cmd of [ctx?.cmd, ctx?.parent?.cmd]) {
        if (cmd?.getOptionValueSource("acrNamespace") === "cli")
            return true;
    }
    return explicitAcrNamespaceArgv();
}

const IGNORED_PLATFORM_STEPS = "A Dockerfile is selected, so template.yaml build steps were not sent. Pass --build steps to register those steps instead.";

const STEPS_WITH_ACR = "--acr-namespace cannot be used with platform build steps.";


/** `dict.get(key, default)`: only a missing key falls back (a stored `null` stays `null`). */
function _get(obj: Record<string, Any>, key: string, dflt: Any): Any {
    return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : dflt;
}

function _isDict(value: unknown): value is Record<string, Any> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Extract a human-readable error message from a Platform error response. */
export function _extractPlatformError(resp: Any): string {
    let data: Any;
    try {
        data = resp.json();
    }
    catch {
        const text = pyStrip(resp.text || "");
        return text || `HTTP ${resp.status_code}`;
    }
    if (_isDict(data)) {
        for (const key of ["error", "message", "Message", "ErrorMessage", "errorMessage", "detail"]) {
            const val = data[key];
            if (typeof val === "string" && pyStrip(val))
                return pyStrip(val);
        }
        return pyStr(data);
    }
    if (typeof data === "string" && pyStrip(data))
        return pyStrip(data);
    return `HTTP ${resp.status_code}`;
}

/** Map a Platform `httpx.HTTPStatusError` to a friendly `SandboxError`. */
export function _translatePlatformError(exc: Any, opts: {
    context: string;
    template_id?: string | null;
}): Error {
    const { context, template_id = null } = opts;
    const resp = exc.response;
    const status = resp.status_code;
    const detail = _extractPlatformError(resp);
    if (status === 404 && template_id !== null) {
        return new TemplateNotFoundError(`Template '${template_id}' not found on the platform: ${detail}`, {
            suggestion: "Check the TEMPLATE_ID (run 'abx template list' to see available templates).",
        });
    }
    return new NetworkError(`${context} failed (HTTP ${status}): ${detail}`, {
        suggestion: status === 401 || status === 403
            ? "Review the selected provider, region and API host with 'abx config list'. Change the Sandbox API key with 'abx config set sandbox_api_key'; a permission or service-admission failure may need account access changes. No automatic retry was made."
            : "Check the platform status and reconcile any submitted operation before retrying.",
    });
}

/** Read template.yaml and extract default values for cpu, memory, name (and generation). */
export function _readYamlDefaults(template_dir: string): Record<string, Any> {
    const yamlPath = _findTemplateYaml(template_dir);
    if (yamlPath === null)
        return {};
    try {
        const raw = yamlSafeLoad(readTextPy(yamlPath));
        const yamlData: Any = pyTruthy(raw) ? raw : {};
        if (!_isDict(yamlData))
            throw new AttributeError(`'${pyTypeNameOf(yamlData)}' object has no attribute 'get'`);
        let resources: Any = Object.prototype.hasOwnProperty.call(yamlData, "resources") ? yamlData["resources"] : {};
        resources = pyTruthy(resources) ? resources : {};
        if (!_isDict(resources))
            throw new AttributeError(`'${pyTypeNameOf(resources)}' object has no attribute 'get'`);
        const get = (obj: Record<string, Any>, key: string): Any => (Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : null);
        return {
            name: get(yamlData, "name"),
            cpu: get(resources, "cpu") !== null ? get(resources, "cpu") : get(yamlData, "cpu_count"),
            memory: get(resources, "memory") !== null ? get(resources, "memory") : get(yamlData, "memory_mb"),
            generation: get(yamlData, "generation"),
            start_cmd: get(yamlData, "start_cmd"),
            ready_cmd: get(yamlData, "ready_cmd"),
        };
    }
    catch (e) {
        if (e instanceof OSError || _isNodeOsError(e))
            return {};
        echo(`Warning: Failed to parse template.yaml: ${e instanceof Error ? pyStr(e) : String(e)}`, { err: true });
        return {};
    }
}

export interface DeployRuntime {
    generation: number;
    start_cmd: string | null;
    ready_cmd: string | null;
}

function _yamlString(value: unknown): string | null {
    if (typeof value !== "string")
        return null;
    const text = value.trim();
    return text ? text : null;
}

/**
 * Generation and platform start/ready commands for a deploy.
 *
 * A flag wins, then `template.yaml`, then the provider profile when that profile starts the server and `commands.py`
 * is in the directory. The profile default is generation 2 plus `start_cmd` / `ready_cmd`. Other templates stay on
 * generation 1 with no start command.
 */
export function resolveDeployRuntime(templateDir: string, flags: {
    generation?: number | null;
    start_cmd?: string | null;
    ready_cmd?: string | null;
} = {}, profile?: TemplateProfile | null): DeployRuntime {
    const yaml = _readYamlDefaults(templateDir);
    const resolvedProfile = profile ?? resolveTemplateProfile(null);
    const platform = resolvedProfile.server_start === "platform_start_cmd" && pathExists(nodePath.join(templateDir, "commands.py"));
    const yamlGeneration = yaml["generation"];
    const generation = flags.generation !== null && flags.generation !== undefined
        ? flags.generation
        : yamlGeneration !== null && yamlGeneration !== undefined
            ? _coerceInt(yamlGeneration, platform ? 2 : 1)
            : platform
                ? 2
                : 1;
    const useProfile = generation === 2 && platform;
    return {
        generation,
        start_cmd: _yamlString(flags.start_cmd) ?? _yamlString(yaml["start_cmd"]) ?? (useProfile ? resolvedProfile.start_cmd : null),
        ready_cmd: _yamlString(flags.ready_cmd) ?? _yamlString(yaml["ready_cmd"]) ?? (useProfile ? resolvedProfile.ready_cmd : null),
    };
}

function _rememberTemplate(templateDir: string, templateId: unknown, out: Any, also: readonly string[] = []): void {
    const id = pyStr(templateId ?? "").trim();
    if (!id || id === "N/A")
        return;
    try {
        const yaml = _findTemplateYaml(templateDir);
        if (!yaml)
            return;
        const names = [...also];
        const yamlName = _readYamlDefaults(templateDir)["name"];
        if (typeof yamlName === "string" && yamlName.trim())
            names.push(yamlName.trim());
        cacheDeployedTemplate(yaml, id, names);
    }
    catch (e) {
        out.warning(`Could not cache template.yaml under ~/.abx/templates/${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
}

function _isNodeOsError(e: unknown): boolean {
    const err = e as NodeJS.ErrnoException;
    return e instanceof Error && typeof err.code === "string" && /^E[A-Z0-9]+$/.test(err.code) && typeof err.syscall === "string";
}

/**
 * Resolve a bare template name through the remote template index (SSOT).
 *
 * Raises `TemplateNotFoundError` when the name is not in the index; `NetworkError` when the index is unreachable and no
 * cache exists.
 */
export async function _resolveIndexName(name: string, opts: {
    token: string | null;
    fmt: Any;
    out: Any;
}): Promise<string> {
    const { _resolveIndexName: resolveIndexName } = await import("../../../cli/template_catalog.js");
    return resolveIndexName(name, opts);
}

/**
 * Resolve ACR namespace from CLI > os.environ > .env file.
 *
 * `.env` is looked up in the current working directory first and then in `~/.abx/.env` (mirroring the SDK config
 * loader). Raises `UsageError` if the namespace is not found in any source.
 */
export function _resolveAcrNamespace(cli_value: string | null | undefined): string {
    if (cli_value && pyStrip(cli_value))
        return pyStrip(cli_value);
    const operationNamespace = getOperationConfig()?.["acr_namespace"];
    if (typeof operationNamespace === "string" && pyStrip(operationNamespace)) return pyStrip(operationNamespace);
    const envVal = process.env["ACR_NAMESPACE"];
    if (envVal && pyStrip(envVal))
        return pyStrip(envVal);
    // Try .env files: CWD first, then ~/.abx/.env. A blank value does not count.
    for (const dotenvPath of [nodePath.join(process.cwd(), ".env"), nodePath.join(homeDir(), ".abx", ".env")]) {
        if (pathExists(dotenvPath)) {
            const ns = dotenvValues(dotenvPath).get("ACR_NAMESPACE");
            if (ns && pyStrip(ns))
                return pyStrip(ns);
        }
    }
    throw usageError("Missing ACR namespace. Provide via:\n" +
        "  1. --acr-namespace flag\n" +
        "  2. export ACR_NAMESPACE=<ns>\n" +
        "  3. ACR_NAMESPACE=<ns> in ./.env\n" +
        "  4. abx config set acr_namespace <ns>   (or run 'abx config init --build')");
}

/**
 * Safely coerce `value` to int, returning `dflt` on failure.
 *
 * Emits a warning on stderr for truly invalid values so users learn why their `template.yaml` value was ignored.
 */
export function _coerceInt(value: unknown, dflt: number): number {
    if (value === null || value === undefined)
        return dflt;
    if (typeof value === "boolean")
        return dflt;
    if (typeof value === "number") {
        if (Number.isFinite(value))
            return Math.trunc(value);
    }
    else {
        const text = pyStr(value).trim();
        if (/^[+-]?\d+(?:_\d+)*$/.test(text))
            return Number(text.replace(/_/g, ""));
    }
    echo(`Warning: invalid integer in template.yaml: ${pyRepr(value)}; using default ${dflt}`, { err: true });
    return dflt;
}

/** How many build/push lines to remember. The display keeps the last `ABX_ACTIVITY_LINES` of them (default 6). */
const _STEP_LOG_LINES = 10;

/**
 * Progress reporter for the long-running build/push/deploy steps.
 *
 * On an interactive terminal each {@link phase} is the same block as agent generation: a `message... 12s` header, and
 * under it the last few log lines in grey ({@link log} appends docker build / push / poll output). The block is redrawn
 * once a second even when the tool is silent, so the elapsed time does not freeze. `--verbose` prints every line in
 * full instead. Quiet, JSON, CI, and non-TTY sessions get one progress line and no per-line log.
 */
export class _StepReporter {
    private _out: Any;
    private _verbose: boolean;
    private _handle: {
        update: ((text: string) => void) | null;
        close(): void;
    } | null = null;
    private _update: ((text: string) => void) | null = null;
    private _lines: string[] = [];
    private _tick: ReturnType<typeof setTimeout> | null = null;
    private _tickStopped = true;
    constructor(out: Any, opts: {
        verbose?: boolean;
    } = {}) {
        this._out = out;
        this._verbose = opts.verbose ?? false;
    }
    /** Report that a new long-running step has started. */
    phase(message: string): void {
        this._stop();
        this._lines = [];
        const live = this._out.use_activity_line ?? this._out.useActivityLine;
        if (this._verbose || !live) {
            this._out.progress(message);
            return;
        }
        this._handle = this._out.startActivity(message);
        this._update = this._handle?.update ?? null;
        this._startTick();
    }
    /** Append one tool output line to the grey feed (or print it in verbose). */
    log(line: string): void {
        if (this._verbose) {
            const text = line.replace(/\s+$/, "");
            if (text)
                this._out.info(text);
            return;
        }
        const text = line.split(/\s+/).filter((part) => part !== "").join(" ");
        if (!text)
            return;
        this._lines.push(text);
        if (this._lines.length > _STEP_LOG_LINES)
            this._lines.splice(0, this._lines.length - _STEP_LOG_LINES);
        const snapshot = this._lines.join("\n");
        const update = this._update;
        if (update !== null) {
            try {
                update(snapshot);
            }
            catch {
                /* suppress: a failed redraw never breaks the step */
            }
        }
    }
    /** Stop any live block and print a completion message. */
    done(message: string): void {
        this._stop();
        this._out.progress(message);
    }
    /** Stop the live block. Safe to call more than once. */
    close(): void {
        this._stop();
    }
    private _startTick(): void {
        this._tickStopped = false;
        const schedule = (): void => {
            const timer = setTimeout(() => {
                if (this._tickStopped)
                    return;
                const update = this._update;
                if (update !== null) {
                    try {
                        update(this._lines.join("\n"));
                    }
                    catch {
                        /* suppress */
                    }
                }
                if (!this._tickStopped)
                    schedule();
            }, templateSeams._STEP_TICK_SECONDS * 1000);
            timer.unref();
            this._tick = timer;
        };
        schedule();
    }
    private _stop(): void {
        this._tickStopped = true;
        if (this._tick !== null)
            clearTimeout(this._tick);
        this._tick = null;
        this._update = null;
        const handle = this._handle;
        this._handle = null;
        if (handle !== null) {
            try {
                handle.close();
            }
            catch {
                /* suppress */
            }
        }
    }
}

/** Print a notice only when `--provenance=false` will actually be added to `docker build`. */
export async function _provenanceNotice(out: Any): Promise<void> {
    if (out.jsonMode || out.quiet)
        return;
    if (!(await dockerBuildxAvailable()))
        return;
    out.info("\u2139 Auto-added --provenance=false" + " (prevents FC image optimization failure; set DOCKER_BUILDKIT=0 to skip)");
}

export interface BuildImageOptions {
    tag: string;
    repo: string | null;
    platform: string;
    dockerfile: string | null;
    on_progress: (message: string) => void;
    on_output?: ((line: string) => void) | null;
}

/** Read-only prerequisites run before any build ownership intent is registered. */
async function ensureDockerDaemon(builder: DockerBuilder): Promise<void> {
    while (!(await builder.checkDocker())) {
        const ctx = getCurrentContext(true);
        const error = new DockerSetupError(which("docker") ? "unavailable" : "missing");
        if (!canGuideConfiguration(ctx ?? undefined, Boolean(ctx?.params["yes"]))) throw error;
        getOutput(ctx).warning(error.message);
        if (!(await confirm("After fixing Docker, check again?", { default: true, err: true }))) throw new DockerSetupError("cancelled");
    }
}

/**
 * Build a Docker image locally from a template directory and return the local image tag (`<name>:<tag>`).
 * Shared by the `build` and `deploy` commands.
 */
export async function _buildImage(template_dir: string, opts: BuildImageOptions): Promise<string> {
    const { tag, repo, platform, dockerfile, on_progress, on_output = null } = opts;
    const tdir = pyResolve(String(template_dir));
    const imageName = repo || nodePath.basename(tdir);
    const localTag = `${imageName}:${tag}`;
    const builder = new templateSeams.DockerBuilder();
    on_progress("[1/3] Checking Docker daemon...");
    await ensureDockerDaemon(builder);
    let injectedWheels: string[] = [];
    if (!process.env.ABX_SERVER_SDK_SOURCE && contextHasPinnedServerRequirement(tdir, dockerfile)) {
        on_progress("[2/3] Using the Dockerfile's pinned agent-sandbox-server requirement");
    }
    else {
        on_progress("[2/3] Injecting SDK wheel into build context...");
        injectedWheels = await templateSeams.DockerBuilder.injectSdkWheel(tdir, null, dockerfile);
    }
    on_progress(`[3/3] Building Docker image locally: ${localTag}`);
    try {
        await builder.build(tdir, localTag, { platform, dockerfile, on_output });
    }
    finally {
        for (const whl of injectedWheels) {
            try {
                fs.rmSync(whl, { force: true });
            }
            catch {
                /* contextlib.suppress(OSError) */
            }
        }
    }
    return localTag;
}

export interface PushImageOptions {
    acr: Any;
    tag: string;
    region: string;
    on_progress: (message: string) => void;
    on_output?: ((line: string) => void) | null;
}

/**
 * Login to ACR, tag, and push a local image.
 *
 * Returns `[acr_ref, creds]` where `creds` is the credential dict from the ACR login. Shared by the `push` and `deploy`
 * commands.
 */
export async function _pushImage(local_image: string, opts: PushImageOptions): Promise<[
    string,
    Record<string, Any>
]> {
    const { acr, tag, region, on_progress, on_output = null } = opts;
    const builder = new templateSeams.DockerBuilder();
    const acrRef = acr.tagged_ref(tag);
    on_progress(`Logging into ACR: ${acr.registry}`);
    const creds = await builder.loginAcrWithAksk(acr.registry, acr.username, acr.password, {
        region,
        instance_id: acr.acree_instance_id || null,
    });
    on_progress(`Tagging: ${local_image} \u2192 ${acrRef}`);
    await builder.tag(local_image, acrRef);
    on_progress(`Pushing to ACR: ${acrRef}`);
    await builder.push(acrRef, { on_output });
    return [acrRef, creds];
}

interface RunReportedDeployOptions {
    journal?: ResourceJournalCallbacks;
    owned_resources?: NonNullable<PreparedTemplate["owned_resources"]>;
    out: Any;
    config: Any;
    template_dir: string;
    acr: Any;
    template_name: string;
    region: string;
    tag: string;
    platform: string;
    resolved_cpu: number;
    resolved_memory: number;
    start_cmd: string | null;
    ready_cmd: string | null;
    timeout: number;
    dockerfile: string | null;
    disk_size: number | null;
    internet_access: boolean | null;
    team_id: string | null;
    envd_inject: boolean;
    resolved_generation: number;
    force: boolean;
    target_image: string | null;
    platform_ak: string;
    platform_sk: string;
}

/** Build, push, and register, streaming tool output through `reporter`. */
async function _runReportedDeploy(reporter: _StepReporter, o: RunReportedDeployOptions): Promise<Record<string, Any>> {
    const { out, template_dir, acr, template_name, region, tag, platform, start_cmd, ready_cmd, timeout, dockerfile } = o;
    if ((start_cmd || ready_cmd) && o.resolved_generation !== 2) {
        // Diagnostic channel: rendered once on stderr, suppressed by --quiet/--ci/--json instead of bypassing the output
        // manager.
        out.warning("--start-cmd / --ready-cmd only take effect with --generation 2 (MicroVM).");
    }
    // A missing/unreachable Docker daemon cannot create an image. Do not record an
    // ambiguous resource intent until this read-only prerequisite has passed.
    await ensureDockerDaemon(new templateSeams.DockerBuilder());
    // Provenance notice only when buildx will accept the flag.
    await _provenanceNotice(out);
    let templateId: string;
    let buildId: string;
    let acrRef: string;
    let buildStatus: string;
    {
        const localIntent = await o.journal?.intent({ kind: "image", correlation_key: `${acr.repo}:${tag}`, cleanup: "manual" });
        const localTag = await templateSeams._buildImage(template_dir, {
            tag,
            repo: acr.repo,
            platform,
            dockerfile,
            on_progress: (m) => reporter.phase(m),
            on_output: (l) => reporter.log(l),
        });
        if (localIntent) {
            await o.journal!.created(localIntent, localTag);
            o.owned_resources!.push({ intent_id: localIntent, kind: "image", id: localTag, cleanup: "manual", owned: true });
        }
        const pushIntent = await o.journal?.intent({ kind: "image", correlation_key: acr.tagged_ref(tag), cleanup: "manual" });
        const [ref, creds] = await templateSeams._pushImage(localTag, {
            acr,
            tag,
            region,
            on_progress: (m) => reporter.phase(m),
            on_output: (l) => reporter.log(l),
        });
        acrRef = ref;
        if (pushIntent) {
            const digests: unknown = JSON.parse(await runTool("docker", ["image", "inspect", "--format", "{{json .RepoDigests}}", ref], { timeout: 30 }));
            const repository = ref.slice(0, ref.lastIndexOf(":"));
            const immutable = Array.isArray(digests) ? digests.find((value: unknown) => typeof value === "string" && value.startsWith(`${repository}@sha256:`) && /@sha256:[a-f0-9]{64}$/.test(value)) : undefined;
            if (!immutable) throw new TemplateBuildError("Published image has no observable immutable digest; inspect the resource journal.");
            // Preserve the observed digest as evidence. Express currently resolves tagged ACR
            // images itself; digest input can fail with a platform manifest digest mismatch.
            // Workflow tags are unique per preparation, so do not replace this native API input.
            await o.journal!.created(pushIntent, immutable);
            o.owned_resources!.push({ intent_id: pushIntent, kind: "image", id: immutable, cleanup: "manual", owned: true });
        }
        reporter.done(`Image pushed to ACR: ${acrRef}`);
        const registryType = acr.acree_instance_id ? "acree" : "acr";
        reporter.phase(`Creating template via official API: ${template_name}`);
        const envdTarget = o.journal && o.envd_inject ? acr.tagged_ref(`${tag}-envd`) : o.target_image;
        const copyIntent = o.journal && o.envd_inject && envdTarget ? await o.journal.intent({ kind: "image", correlation_key: envdTarget, cleanup: "manual" }) : undefined;
        const templateIntent = await o.journal?.intent({ kind: "template", correlation_key: template_name, cleanup: "template.delete" });
        const apiResult = await fcTemplate.createOfficialTemplate({
            update_existing: o.journal ? false : undefined,
            name: template_name,
            image: acrRef,
            access_key_id: o.platform_ak,
            access_key_secret: o.platform_sk,
            region,
            team_id: o.team_id,
            cpu: o.resolved_cpu,
            memory_size: o.resolved_memory,
            disk_size: o.disk_size,
            internet_access: o.internet_access,
            generation: o.resolved_generation,
            start_command: start_cmd,
            ready_command: ready_cmd,
            force: o.force,
            envd_inject: o.envd_inject,
            registry_type: registryType,
            acr_instance_id: acr.acree_instance_id || null,
            registry_username: creds["tempUserName"] ?? null,
            registry_password: creds["authorizationToken"] ?? null,
            registry_vpc_id: acr.vpc_id || null,
            registry_vswitch_id: acr.vswitch_ids || null,
            registry_security_group_id: acr.security_group_id || null,
            target_image: envdTarget,
        });
        templateId = apiResult["templateID"] ?? "";
        if (!templateId) {
            throw new TemplateBuildError("CreateTemplate returned no template ID.", {
                suggestion: "Inspect 'abx template list' before retrying; registration may already have been submitted.",
            });
        }
        if (templateIntent) {
            await o.journal!.created(templateIntent, templateId);
            o.owned_resources!.push({ intent_id: templateIntent, kind: "template", id: templateId, cleanup: "template.delete", owned: true });
        }
        reporter.phase(`Waiting for template to become READY: ${templateId}`);
        const onPoll = (state: string, elapsed: number): void => {
            reporter.log(`${state}  ${formatFixed0(elapsed)}s`);
        };
        const finalData = await fcTemplate.waitForTemplateReady(templateId, {
            access_key_id: o.platform_ak,
            access_key_secret: o.platform_sk,
            region,
            team_id: o.team_id,
            timeout,
            on_poll: onPoll,
        });
        if (copyIntent && envdTarget) {
            await o.journal!.created(copyIntent, envdTarget);
            o.owned_resources!.push({ intent_id: copyIntent, kind: "image", id: envdTarget, cleanup: "manual", owned: true });
        }
        const finalStatus = pyTruthy(finalData["status"]) ? finalData["status"] : {};
        buildStatus = _isDict(finalStatus) ? pyStr(finalStatus["state"] ?? "unknown").toLowerCase() : pyStr(finalStatus).toLowerCase();
        buildId = "";
    }
    return {
        TemplateID: templateId || "N/A",
        BuildID: buildId || "N/A",
        "ACR Image": acrRef || "N/A",
        Status: buildStatus,
        _build_logs: [],
    };
}

export interface DoDeployOptions {
    /** Workflow launches retain exact owned identities and start the service after creation. */
    journal?: ResourceJournalCallbacks;
    template_launch?: boolean;
    acr_namespace?: string;
    /** Existing batch consent; never makes missing secrets interactive. */
    yes?: boolean;
    acr_registry?: string;
    acr_repo?: string | null;
    acr_username?: string | null;
    acr_password?: string | null;
    acree_instance_id?: string;
    vpc_id?: string;
    vswitch_ids?: string;
    security_group_id?: string;
    alias?: string | null;
    tag?: string;
    platform?: string;
    cpu?: number | null;
    memory?: number | null;
    start_cmd?: string | null;
    ready_cmd?: string | null;
    timeout?: number;
    dockerfile?: string | null;
    disk_size?: number | null;
    internet_access?: boolean | null;
    team_id?: string | null;
    envd_inject?: boolean;
    generation?: number | null;
    /** Delete a generation-1 template of the same name and create a generation-2 template. */
    force?: boolean;
    target_image?: string | null;
    region?: string | null;
    ctx?: Context | null;
    verbose?: boolean;
    /** `auto` (default), `dockerfile`, or `steps`. A flag of `auto` still honors `build.mode` in template.yaml. */
    build?: string | null;
    /** Set when the user passed `--acr-namespace`. An ambient `ACR_NAMESPACE` must stay false. */
    explicit_acr_namespace?: boolean;
}

/** Offer a manual tool fix without installing software or changing Docker context. */
async function ensureDockerExecutable(ctx: Context, yes: boolean): Promise<void> {
    while (!which("docker")) {
        const message = "Docker not found in PATH. Install Docker and start Docker Desktop/the Docker daemon.";
        if (!canGuideConfiguration(ctx, yes)) throw new CliError(message + " Downloaded template files have been retained; use --download-only for source only.");
        getOutput(ctx).warning(message);
        if (!(await confirm("After installing Docker, check again?", { default: true, err: true }))) throw new CliError("Docker setup cancelled; downloaded template files have been retained.");
    }
}

/** Keep provider-owned consumers and configuration guidance on the same effective snapshot. */
async function withExpressConfiguration<T>(ctx: Context, params: Any, requirements: readonly (string | GuidanceField)[], action: () => Promise<T>, extra: Record<string, unknown> = {}): Promise<T> {
    const config = templateSeams.loadConfig({ region: params["region"] });
    return withGuidedConfiguration(ctx, { provider: "alicloud-express", validateProvider: false, operation: `Template ${ctx.command.name}`, yes: Boolean(params["yes"]), requirements,
        values: { sandbox_api_key: config.api_key, access_key_id: config.access_key_id, access_key_secret: config.access_key_secret, region: config.region, ...extra },
        overrides: { region: params["region"] } }, action);
}

async function withPushConfiguration<T>(ctx: Context, params: Any, action: () => Promise<T>): Promise<T> {
    const requirements: (string | GuidanceField)[] = ["acr_namespace"];
    const config = templateSeams.loadConfig({ region: params["region"] });
    const extra: Record<string, unknown> = {};
    try { extra["acr_namespace"] = _resolveAcrNamespace(params["acr_namespace"]); } catch (error) { if (!(error instanceof UsageError)) throw error; }
    if (params["acr_username"] || params["acr_password"]) {
        requirements.push({ key: "acr_username", label: "ACR username / AccessKey ID", env: "ACR_USERNAME", flag: "--acr-username", persist: false },
            { key: "acr_password", label: "ACR password / AccessKey Secret", secret: true, env: "ACR_PASSWORD", flag: "--acr-password", persist: false });
        extra["acr_username"] = params["acr_username"] || config.access_key_id;
        extra["acr_password"] = params["acr_password"] || config.access_key_secret;
    } else requirements.push("access_key_id", "access_key_secret");
    if (canGuideConfiguration(ctx, Boolean(params["yes"]))) {
        const registry = String(params["acr_registry"] || "registry.cn-hangzhou.aliyuncs.com");
        try { getOutput(ctx).info(`Registry host: ${new URL(`https://${registry}`).host}`); } catch { throw usageError("Invalid ACR registry host."); }
    }
    return withExpressConfiguration(ctx, params, requirements, action, extra);
}

/** Resolve the complete operation requirements before local builds or cloud mutations. */
export async function withDeployConfiguration<T>(directory: string, opts: DoDeployOptions, action: () => Promise<T>): Promise<T> {
    let plan: BuildPlan;
    try { plan = resolveBuildPlan(directory, { mode: opts.build ?? "auto", dockerfile: opts.dockerfile }); }
    catch (error) { if (error instanceof BuildModeError) throw usageError(error.message); throw error; }
    resolveDeployRuntime(directory, opts);
    if (plan.kind === "steps") {
        if (opts.explicit_acr_namespace) throw usageError(STEPS_WITH_ACR);
    }
    const config = templateSeams.loadConfig({ region: opts.region });
    const requirements: (string | GuidanceField)[] = ["access_key_id", "access_key_secret"];
    const values: Record<string, unknown> = { access_key_id: config.access_key_id, access_key_secret: config.access_key_secret,
        sandbox_api_key: config.api_key, region: config.region };
    if (plan.kind === "dockerfile") {
        requirements.push("acr_namespace");
        try { values["acr_namespace"] = _resolveAcrNamespace(opts.acr_namespace); } catch (error) { if (!(error instanceof UsageError)) throw error; }
        // Explicit ACR fields can be a different identity. Preserve that choice and only complete its missing half.
        if (opts.acr_username || opts.acr_password) {
            requirements.push({ key: "acr_username", label: "ACR username / AccessKey ID", env: "ACR_USERNAME", flag: "--acr-username", persist: false },
                { key: "acr_password", label: "ACR password / AccessKey Secret", secret: true, env: "ACR_PASSWORD", flag: "--acr-password", persist: false });
            values["acr_username"] = opts.acr_username || config.access_key_id;
            values["acr_password"] = opts.acr_password || config.access_key_secret;
        }
    }
    if (plan.kind === "dockerfile" && canGuideConfiguration(opts.ctx ?? undefined, Boolean(opts.yes))) {
        const registry = opts.acr_registry || "registry.cn-hangzhou.aliyuncs.com";
        try { getOutput(opts.ctx).info(`Registry host: ${new URL(`https://${registry}`).host}`); } catch { throw usageError("Invalid ACR registry host."); }
    }
    return withGuidedConfiguration(opts.ctx ?? undefined, { operation: plan.kind === "steps" ? "Register template from platform steps" : "Build and deploy template",
        provider: "alicloud-express", validateProvider: false, requirements, yes: opts.yes, values, overrides: { region: opts.region } }, action);
}

/** Current-command ACR fields include values collected without persisting secrets. */
function effectiveAcrCredentials(options: Pick<DoDeployOptions, "acr_username" | "acr_password">, config: Any): [string, string] {
    const current = getOperationConfig();
    return [String(options.acr_username || current?.["acr_username"] || config.access_key_id || ""),
        String(options.acr_password || current?.["acr_password"] || config.access_key_secret || "")];
}

/**
 * Shared deploy logic: docker build -> ACR push -> CreateTemplate -> poll.
 *
 * Used by both `template build`/`deploy` and `install` (when not `--download-only`). Returns a summary dict with
 * TemplateID, Status, etc.
 */
export async function _doDeploy(template_dir: string, opts: DoDeployOptions): Promise<Record<string, Any>> {
    requireTemplateFeature("templates.build");
    return withDeployConfiguration(template_dir, opts, () => deployConfigured(template_dir, opts));
}

async function deployConfigured(template_dir: string, opts: DoDeployOptions): Promise<Record<string, Any>> {
    const { acr_namespace: requestedNamespace, acr_registry = "registry.cn-hangzhou.aliyuncs.com", acr_repo = null, acr_username = null, acr_password = null, acree_instance_id = "", vpc_id = "", vswitch_ids = "", security_group_id = "", alias = null, tag = "latest", platform = "linux/amd64", cpu = null, memory = null, start_cmd = null, ready_cmd = null, timeout = 600, dockerfile = null, disk_size = null, internet_access = null, team_id = null, envd_inject = false, generation = null, force = false, target_image = null, region = null, ctx = null, verbose = false, build = null, explicit_acr_namespace = false, } = opts;
    const config = templateSeams.loadConfig({ region });
    const yamlDefaults = _readYamlDefaults(template_dir);
    const resolvedCpu: number = cpu !== null ? cpu : _coerceInt(yamlDefaults["cpu"], 2);
    const resolvedMemory: number = memory !== null ? memory : _coerceInt(yamlDefaults["memory"], 2048);
    const runtime = resolveDeployRuntime(template_dir, { generation, start_cmd, ready_cmd });
    const resolvedGeneration = runtime.generation;
    const resolvedStart = opts.template_launch ? null : runtime.start_cmd;
    const resolvedReady = opts.template_launch ? null : runtime.ready_cmd;
    const ownedResources: NonNullable<PreparedTemplate["owned_resources"]> = [];
    const [resolvedAcrUsername, resolvedAcrPassword] = effectiveAcrCredentials({ acr_username, acr_password }, config);
    const resolvedRepo = acr_repo || yamlDefaults["name"] || nodePath.basename(pyResolve(String(template_dir)));
    const templateName = alias || resolvedRepo;
    let plan: BuildPlan;
    try {
        plan = resolveBuildPlan(template_dir, { mode: build ?? "auto", dockerfile });
    }
    catch (e) {
        if (e instanceof BuildModeError)
            throw usageError(e.message);
        throw e;
    }
    const out = templateSeams.getOutput(ctx);
    if (plan.kind === "steps") {
        if (explicit_acr_namespace)
            throw usageError(STEPS_WITH_ACR);
        if (!config.access_key_id || !config.access_key_secret) {
            throw new CliError("Alibaba Cloud credentials missing. Run 'abx config init --build', or " +
                "'abx config set access_key_id' / 'abx config set access_key_secret'. " +
                AKSK_ENV_SUGGESTION);
        }
        const reporter = new _StepReporter(out, { verbose });
        try {
            reporter.phase(`Creating template from platform steps: ${templateName}`);
            const templateIntent = await opts.journal?.intent({ kind: "template", correlation_key: templateName, cleanup: "template.delete" });
            const apiResult = await fcTemplate.createOfficialTemplate({
                update_existing: opts.journal ? false : undefined,
                name: templateName,
                image: plan.image,
                steps: plan.steps,
                access_key_id: config.access_key_id,
                access_key_secret: config.access_key_secret,
                region: config.region,
                team_id,
                cpu: resolvedCpu,
                memory_size: resolvedMemory,
                disk_size,
                internet_access,
                generation: resolvedGeneration,
                start_command: commandWithStepEnvironment(plan, resolvedStart),
                ready_command: commandWithStepEnvironment(plan, resolvedReady),
                force,
                envd_inject: false,
            });
            const templateId = pyStr(apiResult["templateID"] ?? "");
            if (!templateId) {
                throw new TemplateBuildError("CreateTemplate returned no template ID.", {
                    suggestion: "Inspect 'abx template list' before retrying; registration may already have been submitted.",
                });
            }
            if (templateIntent) {
                await opts.journal!.created(templateIntent, templateId);
                ownedResources.push({ intent_id: templateIntent, kind: "template", id: templateId, cleanup: "template.delete", owned: true });
            }
            reporter.done(`Template registration submitted: ${templateId}`);
            _rememberTemplate(template_dir, templateId, out, [alias ?? "", templateName].filter((n) => Boolean(n)));
            return {
                TemplateID: templateId,
                BuildID: "N/A",
                "ACR Image": "N/A",
                "Build mode": "steps",
                ...(opts.journal ? { owned_resources: ownedResources } : {}),
                Status: "submitted",
                _build_logs: [],
            };
        }
        finally {
            reporter.close();
        }
    }
    if (!resolvedAcrUsername || !resolvedAcrPassword) {
        throw new CliError("ACR credentials missing. Run 'abx config init --build', or " +
            "'abx config set access_key_id' / 'abx config set access_key_secret', " +
            "or pass --acr-username/--acr-password. " +
            AKSK_ENV_SUGGESTION);
    }
    const platformAk = config.access_key_id || "";
    const platformSk = config.access_key_secret || "";
    const acr_namespace = _resolveAcrNamespace(requestedNamespace);
    const acr = new ACRConfig({
        registry: acr_registry,
        namespace: acr_namespace,
        repo: resolvedRepo,
        username: resolvedAcrUsername,
        password: resolvedAcrPassword,
        acree_instance_id,
        vpc_id,
        vswitch_ids,
        security_group_id,
    });
    const finalRegion: string = config.region;
    const reporter = new _StepReporter(out, { verbose });
    try {
        if (plan.ignoredSteps)
            out.warning(IGNORED_PLATFORM_STEPS);
        const reported = await _runReportedDeploy(reporter, {
            journal: opts.journal, owned_resources: ownedResources,
            out,
            config,
            template_dir,
            acr,
            template_name: templateName,
            region: finalRegion,
            tag,
            platform,
            resolved_cpu: resolvedCpu,
            resolved_memory: resolvedMemory,
            start_cmd: resolvedStart,
            ready_cmd: resolvedReady,
            timeout,
            dockerfile: plan.dockerfile,
            disk_size,
            internet_access,
            team_id,
            envd_inject,
            resolved_generation: resolvedGeneration,
            force,
            target_image,
            platform_ak: platformAk,
            platform_sk: platformSk,
        });
        _rememberTemplate(template_dir, reported["TemplateID"], out, [alias ?? "", templateName].filter((n) => Boolean(n)));
        return { ...reported, ...(opts.journal ? { owned_resources: ownedResources } : {}) };
    }
    finally {
        reporter.close();
    }
}

/**
 * Mutable seams: the TypeScript counterpart of the module attributes the Python tests monkeypatch. Internal calls read
 * them at call time.
 */
export const templateSeams: {
    _STEP_TICK_SECONDS: number;
    _doDeploy: typeof _doDeploy;
    _buildImage: typeof _buildImage;
    _pushImage: typeof _pushImage;
    _githubRateLimitSetupAvailable: typeof _githubRateLimitSetupAvailable;
    _offerGithubTokenSetup: typeof _offerGithubTokenSetup;
    _tryArrowCasePicker: (cases: Array<[
        string,
        string
    ]>) => Promise<string | null>;
    _scaffoldPickerAvailable: (fmt: Any) => boolean;
    getOutput: typeof getOutput;
    loadConfig: typeof loadConfig;
    isCiEnv: () => boolean;
    stdinIsatty: () => boolean;
    DockerBuilder: typeof DockerBuilder;
} = Object.assign(catalogSeams, {
    _STEP_TICK_SECONDS: 1.0,
    _doDeploy: (...a: Parameters<typeof _doDeploy>) => _doDeploy(...a),
    _buildImage: (...a: Parameters<typeof _buildImage>) => _buildImage(...a),
    _pushImage: (...a: Parameters<typeof _pushImage>) => _pushImage(...a),
    _githubRateLimitSetupAvailable: (...a: Parameters<typeof _githubRateLimitSetupAvailable>) => _githubRateLimitSetupAvailable(...a),
    _offerGithubTokenSetup: (...a: Parameters<typeof _offerGithubTokenSetup>) => _offerGithubTokenSetup(...a),
    _tryArrowCasePicker: (...a: Parameters<typeof _tryArrowCasePicker>) => _tryArrowCasePicker(...a),
    _scaffoldPickerAvailable: (...a: Parameters<typeof _scaffoldPickerAvailable>) => _scaffoldPickerAvailable(...a),
    getOutput: (...a: Parameters<typeof getOutput>) => getOutput(...a),
    loadConfig: (...a: Parameters<typeof loadConfig>) => loadConfig(...a),
    isCiEnv: () => isCiEnv(),
    stdinIsatty: () => isatty(sys.stdin),
    DockerBuilder,
});

/** Public alias so other commands (e.g. `abx create` AI path) can reuse the build -> push -> CreateTemplate -> poll pipeline. */
export const do_deploy = (...a: Parameters<typeof _doDeploy>): ReturnType<typeof _doDeploy> => templateSeams._doDeploy(...a);

/** Public alias used by the `abx create` AI path to resolve the ACR namespace. */
export const resolve_acr_namespace = _resolveAcrNamespace;

export const template = group("template", {
    help: cleandoc(`Discover, scaffold, build, publish and install sandbox templates.

    \b
    Examples:
      abx template search python
      abx template scaffold --template python --name my-template
      abx template list

    \b
    Related commands:
      abx create TEMPLATE  Launch a sandbox from a template
      abx deploy [PATH]               Same as 'template deploy'
      abx config --help               Configure credentials and region
    `),
});

/** The option set of `template install`. */


export const install = template.command("install", {
    help: templateUi["install"]!.help,
    params: templateUi["install"]!.params,
    callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
        if (!params["download_only"])
            requireTemplateFeature("templates.build");
        const { registry_url: registryUrl, registry_type: registryType, token, alias, download_only: downloadOnly, dest_dir: destDir, acr_namespace: acrNamespace, cpu, memory, yes, region, } = params;
        let templateRef: string = params["template_ref"];
        const cfgMod = await _configCmd();
        const resolveGithubToken = cfgMod.resolveGithubToken;
        const fmt = getFormatter(ctx);
        const out = getOutput(ctx);
        // BUG-05: Early validation for local paths to avoid raw traceback.
        const looksLocal = registryType === "local" ||
            templateRef.startsWith("./") ||
            templateRef.startsWith("../") ||
            templateRef.startsWith("/") ||
            pathExists(templateRef);
        if (looksLocal && !pathExists(templateRef)) {
            fmt.printError(`Path not found: ${templateRef}`, {
                suggestion: "Verify the path exists, or use owner/repo format for GitHub templates.",
            });
            sysExit(EXIT_NOT_FOUND);
        }
        const activeToken = await resolveGithubToken(token);
        const acquire = async (active: string | null): Promise<[
            Any,
            string | null
        ]> => {
            const client = new RegistryClient(registryUrl, active);
            let ref = await client.resolve(templateRef, registryType);
            if (ref.is_builtin) {
                if (BUILTIN_TEMPLATES.has(templateRef)) {
                    fmt.printSuccess(`'${templateRef}' is a built-in template. No installation needed.`);
                    fmt.printSuccess(`Use it directly: abx create ${templateRef}`);
                    return [ref, null];
                }
                // Bare name that is not built-in: resolve it through the remote template index (single source of truth),
                // then continue as usual.
                templateRef = await _resolveIndexName(templateRef, { token: active, fmt, out });
                ref = await client.resolve(templateRef, registryType);
                if (ref.is_builtin) {
                    throw new CliError(`Template index resolved '${templateRef}' to a built-in template.`);
                }
            }
            // Fetch the template sources.
            if (ref.registry_type === "local") {
                fmt.printSuccess(`Using local template from ${ref.local_path}...`);
                return [ref, await client.fetch(ref)];
            }
            fmt.printSuccess(`Fetching template from ${ref.owner}/${ref.repo}...`);
            return [ref, await out.spinner(`Fetching template ${templateRef}`, () => client.fetch(ref))];
        };
        const [ref, sourcePath] = await _withGithubRateLimitRetry(acquire, { token: activeToken, fmt, out });
        if (sourcePath === null)
            return; // built-in template: nothing to install
        // Locate template.yaml
        const yamlPath = _findTemplateYaml(sourcePath);
        if (yamlPath === null) {
            fmt.printError(`No template.yaml found in ${sourcePath}`, {
                suggestion: "Ensure the repository contains a template.yaml at the root.",
            });
            sysExit(1);
        }
        const tmpl = loadTemplateFromYaml(yamlPath);
        const installName: string = alias || tmpl.name || nodePath.basename(sourcePath);
        // --dir: download into a user-specified directory
        let cachedPath: string;
        if (destDir !== null) {
            const destPath = pyResolve(destDir);
            if (pathExists(destPath) && fs.readdirSync(destPath).length > 0) {
                throw new CliError(`Directory '${destPath}' already exists and is not empty. ` + "Remove or empty it first, or choose a different --dir path.");
            }
            fs.mkdirSync(destPath, { recursive: true });
            pyCopytree(sourcePath, destPath);
            cachedPath = destPath;
        }
        else if (ref.registry_type === "local") {
            // Copy to local cache (default)
            const dest = pyJoin(registryMod.TEMPLATE_CACHE_DIR, installName);
            if (pyResolve(sourcePath) !== pyResolve(dest)) {
                mkdirParents(dest);
                pyCopytree(sourcePath, dest);
            }
            cachedPath = dest;
        }
        else {
            cachedPath = sourcePath;
        }
        const cacheData: Record<string, Any> = {
            Alias: installName || "N/A",
            Source: String(sourcePath),
            Cached: String(cachedPath),
            Status: "installed-locally",
        };
        if (downloadOnly) {
            if (fmt.use_json) {
                fmt.printData(cacheData);
            }
            else {
                fmt.printDict(cacheData);
                fmt.printSuccess(`Template '${installName}' installed to the local cache. ` + "Build and push the image with 'abx template build'.");
            }
            return;
        }
        // Download is complete and retained. Only now can the actual build plan determine prerequisites.
        let plan: BuildPlan;
        try { plan = resolveBuildPlan(String(cachedPath)); }
        catch (error) {
            if (!(error instanceof BuildModeError)) throw error;
            throw new CliError(`${error.message} Downloaded files remain at ${cachedPath}. Use --download-only to fetch without deploying.`);
        }
        if (plan.kind === "steps" && acrNamespacePassedOnCli()) throw usageError(STEPS_WITH_ACR);
        return withDeployConfiguration(String(cachedPath), { region, acr_namespace: acrNamespace ?? undefined, ctx, yes, build: plan.kind }, async () => {
        const resolvedNs = plan.kind === "dockerfile" ? _resolveAcrNamespace(acrNamespace) : "";
        if (plan.kind === "dockerfile") await ensureDockerExecutable(ctx, yes);
        // Confirmation
        if (!yes) {
            if (!canGuideConfiguration(ctx, false) || !templateSeams.stdinIsatty()) {
                throw usageError("Confirmation required for build + deploy. " + "Use --yes/-y to skip in non-interactive mode.");
            }
            await confirm(`Download complete. Build and deploy template '${installName}'?`, { abort: true });
        }
        // Run deploy via shared helper
        out.info(`Building and deploying template '${installName}' from ${cachedPath}`);
        const deployData = await templateSeams._doDeploy(String(cachedPath), {
            acr_namespace: resolvedNs,
            cpu,
            memory,
            alias,
            region,
            ctx,
            build: plan.kind,
            yes,
        });
        const buildStatus = _get(deployData, "Status", "unknown");
        delete deployData["_build_logs"];
        if (fmt.use_json) {
            fmt.printData({ ...cacheData, ...deployData });
        }
        else {
            fmt.printDict(deployData);
            if (buildStatus === "ready") {
                fmt.printSuccess("Template installed, built, and ready!");
                fmt.printSuccess(`Use: abx create ${pyStr(_get(deployData, "TemplateID", null))}`);
            }
            else if (_get(deployData, "Build mode", null) === "steps" && buildStatus === "submitted") {
                fmt.printSuccess("Template registration submitted from platform build steps.");
                fmt.printSuccess(`Use: abx create ${pyStr(_get(deployData, "TemplateID", null))}`);
            }
            else if (buildStatus === "pushed" || buildStatus === "submitted") {
                fmt.printSuccess("Template downloaded and image pushed; registration submitted.");
            }
            else {
                fmt.printError(`Build status: ${buildStatus}`);
            }
        }
        }).catch((error: unknown) => {
            if (error instanceof CliError && error.message.startsWith("Missing configuration")) {
                throw new CliError(`${error.message}\nDownloaded template files remain at ${cachedPath}. Use --download-only to fetch without deploying, or deploy that directory after configuration.`);
            }
            throw error;
        });
    }),
});

export const list_templates = template.command("list", {
    help: templateUi["list"]!.help,
    params: templateUi["list"]!.params,
    callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
        requireTemplateFeature("templates.read");
        return withExpressConfiguration(ctx, params, ["access_key_id", "access_key_secret"], async () => {
        const fmt = getFormatter(ctx);
        const config = templateSeams.loadConfig({ region: params["region"] });
        {
            if (!(config.access_key_id && config.access_key_secret)) {
                throw new CliError("Template management requires AccessKey/AccessSecret in the environment.");
            }
            const templates = await fcTemplate.listOfficialTemplates({
                access_key_id: config.access_key_id,
                access_key_secret: config.access_key_secret,
                region: config.region,
            });
            if (!templates || templates.length === 0) {
                fmt.printSuccess("No official templates found for this team.");
                return;
            }
            const headers = ["TemplateID", "Name", "Alias", "Status"];
            const rows = templates.map((t: Any) => [
                pyStr(pyTruthy(t["templateID"]) ? t["templateID"] : pyTruthy(t["template_id"]) ? t["template_id"] : "N/A"),
                pyStr(_get(t, "name", "N/A")),
                pyStr(pyTruthy(t["alias"]) ? t["alias"] : ""),
                pyStr(_isDict(t["status"]) ? _get(t["status"], "state", "N/A") : _get(t, "status", "N/A")),
            ]);
            fmt.printTable(headers, rows);
            return;
        }
        });
    }),
});

export const info = template.command("info", {
    help: templateUi["info"]!.help,
    params: templateUi["info"]!.params,
    callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
        requireTemplateFeature("templates.read");
        return withExpressConfiguration(ctx, params, ["access_key_id", "access_key_secret"], async () => {
        const templateId: string = params["template_id"];
        const fmt = getFormatter(ctx);
        const config = templateSeams.loadConfig({ region: params["region"] });
        {
            if (!(config.access_key_id && config.access_key_secret)) {
                throw new CliError("Template management requires AccessKey/AccessSecret in the environment.");
            }
            const data = await fcTemplate.getTemplate(templateId, {
                access_key_id: config.access_key_id,
                access_key_secret: config.access_key_secret,
                region: config.region,
            });
            if (fmt.use_json) {
                fmt.printData(data);
            }
            else if (_isDict(data)) {
                fmt.printDict(_stringifyValues(data));
            }
            else {
                fmt.printData(data);
            }
            return;
        }
        });
    }),
});

/** `{str(k): str(v) for k, v in data.items()}` */
function _stringifyValues(data: Record<string, Any>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(data))
        result[k] = pyStr(v);
    return result;
}

export const create_template = template.command("create", {
    help: templateUi["create"]!.help,
    params: templateUi["create"]!.params,
    callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
        requireTemplateFeature("templates.build");
        const required: (string | GuidanceField)[] = ["access_key_id", "access_key_secret"];
        const privateFields: Record<string, unknown> = {};
        if (params["registry_username"] || params["registry_password"]) {
            required.push({ key: "registry_username", label: "Private image pull username", flag: "--registry-username", persist: false },
                { key: "registry_password", label: "Private image pull password", secret: true, flag: "--registry-password", persist: false });
            privateFields["registry_username"] = params["registry_username"];
            privateFields["registry_password"] = params["registry_password"];
        }
        return withExpressConfiguration(ctx, params, required, async () => {
        const { image, name, team_id: teamId, cpu, memory, disk_size: diskSize, internet_access: internetAccess } = params;
        const { start_cmd: startCmd, ready_cmd: readyCmd, generation, envd_inject: envdInject, target_image: targetImage } = params;
        const { registry_type: registryType, acree_instance_id: acreeInstanceId } = params;
        const { registry_username: registryUsername, registry_password: registryPassword, region } = params;
        const fmt = getFormatter(ctx);
        const config = templateSeams.loadConfig({ region });
        const ak = config.access_key_id || "";
        const sk = config.access_key_secret || "";
        if (!ak || !sk) {
            fmt.printError("Alibaba Cloud AK/SK credentials required for official CreateTemplate API.", {
                suggestion: "Run 'abx config init --build', or " +
                    "'abx config set access_key_id' / 'abx config set access_key_secret'. " +
                    AKSK_ENV_SUGGESTION,
            });
            sysExit(1);
        }
        const finalRegion: string = config.region;
        const resolvedGeneration: number = generation !== null ? generation : 1;
        // Warn if start/ready commands used without generation 2
        if ((startCmd || readyCmd) && resolvedGeneration !== 2) {
            echo("Warning: --start-cmd / --ready-cmd only take effect with --generation 2 (MicroVM).", { err: true });
        }
        const result = await templateSeams.getOutput(ctx).spinner(`Creating template ${name}`, () => fcTemplate.createOfficialTemplate({
            name,
            image,
            access_key_id: ak,
            access_key_secret: sk,
            region: finalRegion,
            team_id: teamId,
            cpu,
            memory_size: memory,
            disk_size: diskSize,
            internet_access: internetAccess,
            generation: resolvedGeneration,
            start_command: startCmd,
            ready_command: readyCmd,
            force: Boolean(params["force"]),
            envd_inject: envdInject,
            registry_type: registryType,
            acr_instance_id: acreeInstanceId,
            registry_username: registryUsername || getOperationConfig()?.["registry_username"],
            registry_password: registryPassword || getOperationConfig()?.["registry_password"],
            target_image: targetImage,
        }));
        const data = {
            TemplateID: _get(result, "templateID", "N/A"),
            RequestID: _get(result, "requestId", "N/A"),
            StatusCode: _get(result, "statusCode", "N/A"),
            Message: pyTruthy(result["message"]) ? result["message"] : "N/A",
        };
        if (fmt.use_json) {
            fmt.printData(data);
        }
        else {
            fmt.printDict(data);
            const templateId = result["templateID"];
            if (pyTruthy(templateId)) {
                fmt.printSuccess(`Template created! Use: abx create ${templateId}`);
            }
        }
        }, privateFields);
    }),
});

export const push = template.command("push", {
    help: templateUi["push"]!.help,
    params: templateUi["push"]!.params,
    callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
        requireTemplateFeature("templates.build");
        return withPushConfiguration(ctx, params, async () => {
        const image: string = params["image"];
        const fmt = getFormatter(ctx);
        const config = templateSeams.loadConfig({ region: params["region"] });
        // Parse the local image reference into repo name + tag.
        let repoPart: string;
        let imageTag: string;
        if (image.includes(":")) {
            const i = image.lastIndexOf(":");
            repoPart = image.slice(0, i);
            imageTag = image.slice(i + 1);
        }
        else {
            repoPart = image;
            imageTag = "latest";
        }
        const repoName = repoPart.slice(repoPart.lastIndexOf("/") + 1);
        // Resolve ACR namespace: CLI > env > .env file (CWD, then ~/.abx/.env)
        const resolvedNamespace = _resolveAcrNamespace(params["acr_namespace"]);
        const [resolvedUsername, resolvedPassword] = effectiveAcrCredentials(params, config);
        if (!resolvedUsername || !resolvedPassword) {
            throw new ACRLoginError("ACR credentials missing.", {
                suggestion: "Run 'abx config init --build', or " +
                    "'abx config set access_key_id' / 'abx config set access_key_secret', " +
                    "or pass --acr-username/--acr-password. " +
                    AKSK_ENV_SUGGESTION,
            });
        }
        const acr = new ACRConfig({
            registry: params["acr_registry"],
            namespace: resolvedNamespace,
            repo: repoName,
            username: resolvedUsername,
            password: resolvedPassword,
            acree_instance_id: params["acree_instance_id"],
        });
        // Login/tag/push: header plus the last few push lines in grey (or the full log with --verbose; one progress line
        // when there is no TTY).
        const out = templateSeams.getOutput(ctx);
        const reporter = new _StepReporter(out, { verbose: out.verbose });
        let acrRef: string;
        try {
            [acrRef] = await templateSeams._pushImage(image, {
                acr,
                tag: imageTag,
                region: config.region,
                on_progress: (m) => reporter.phase(m),
                on_output: (l) => reporter.log(l),
            });
            reporter.done(`Image pushed to ACR: ${acrRef}`);
        }
        finally {
            reporter.close();
        }
        const data = { "ACR Image": acrRef, Status: "pushed" };
        if (fmt.use_json) {
            fmt.printData(data);
        }
        else {
            fmt.printDict(data);
            fmt.printSuccess(`Image pushed to ACR: ${acrRef}`);
        }
        });
    }),
});

export const build = template.command("build", {
    help: templateUi["build"]!.help,
    params: templateUi["build"]!.params,
    callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
        requireTemplateFeature("templates.build");
        const templateDir = await prepareTemplateBuildInputs(ctx, String(params["template_dir"]), Boolean(params["yes"]), params);
        if (params["verbose_flag"])
            enableVerbose(ctx);
        const fmt = getFormatter(ctx);
        const out = templateSeams.getOutput(ctx);
        let plan: BuildPlan;
        try {
            plan = resolveBuildPlan(templateDir, { mode: params["build"] ?? "auto", dockerfile: params["dockerfile"] });
        }
        catch (e) {
            if (e instanceof BuildModeError)
                throw usageError(e.message);
            throw e;
        }
        const explicitAcr = acrNamespacePassedOnCli();
        if (plan.kind === "steps") {
            if (explicitAcr)
                throw usageError(STEPS_WITH_ACR);
        }
        return withDeployConfiguration(templateDir, { ...params, ctx, explicit_acr_namespace: explicitAcr }, async () => {
        // Resolve ACR namespace: CLI > env > .env file. Platform steps do not push an image.
        const resolvedNamespace = plan.kind === "dockerfile" ? _resolveAcrNamespace(params["acr_namespace"]) : "";
        const yamlDefaults = _readYamlDefaults(templateDir);
        const resolvedRepo: Any = pyTruthy(params["acr_repo"])
            ? params["acr_repo"]
            : pyTruthy(yamlDefaults["name"])
                ? yamlDefaults["name"]
                : nodePath.basename(pyResolve(templateDir));
        const resolvedCpu: number = params["cpu"] !== null ? params["cpu"] : _coerceInt(yamlDefaults["cpu"], 2);
        const resolvedMemory: number = params["memory"] !== null ? params["memory"] : _coerceInt(yamlDefaults["memory"], 2048);
        const runtime = resolveDeployRuntime(templateDir, {
            generation: params["generation"],
            start_cmd: params["start_cmd"],
            ready_cmd: params["ready_cmd"],
        });
        const templateName: Any = params["alias"] || resolvedRepo;
        // Early credential check (before confirmation prompt)
        const config = templateSeams.loadConfig({ region: params["region"] });
        const [resolvedAcrUsername, resolvedAcrPassword] = effectiveAcrCredentials(params, config);
        if (plan.kind === "steps") {
            if (!config.access_key_id || !config.access_key_secret) {
                fmt.printError("Alibaba Cloud credentials missing.", {
                    suggestion: "Run 'abx config init --build', or 'abx config set access_key_id' / 'abx config set access_key_secret'. " +
                        AKSK_ENV_SUGGESTION,
                });
                sysExit(1);
            }
        }
        else if (!resolvedAcrUsername || !resolvedAcrPassword) {
            fmt.printError("ACR credentials missing.", {
                suggestion: "Run 'abx config init --build', or " +
                    "'abx config set access_key_id' / 'abx config set access_key_secret', " +
                    "or pass --acr-username/--acr-password. " +
                    AKSK_ENV_SUGGESTION,
            });
            sysExit(1);
        }
        // Show the resolved configuration so users can see the effective values.
        // `--json` keeps stdout as one object (`TemplateID` included); the summary stays on stderr via progress.
        if (!fmt.use_json) {
            echo(`Template: ${pyStr(templateName)}`);
            if (plan.kind === "steps") {
                echo(`Build mode: steps`);
                echo(`Base image: ${plan.image}`);
                echo(`Platform steps: ${plan.steps.length}`);
            }
            else {
                echo(`ACR: ${resolvedNamespace}/${pyStr(resolvedRepo)}:${params["tag"]}`);
                if (plan.ignoredSteps)
                    echo(IGNORED_PLATFORM_STEPS);
            }
            echo(`Resources: cpu=${resolvedCpu}, memory=${resolvedMemory}MB, generation=${runtime.generation}`);
            if (runtime.start_cmd)
                echo(`Start command: ${runtime.start_cmd}`);
        }
        else if (plan.kind !== "steps" && plan.ignoredSteps) {
            out.warning(IGNORED_PLATFORM_STEPS);
        }
        // Confirmation before destructive cloud operations.
        if (!params["yes"]) {
            if (!canGuideConfiguration(ctx, false) || !templateSeams.stdinIsatty()) {
                throw usageError("Confirmation required for deploying to cloud. " + "Use --yes/-y to skip in non-interactive mode.");
            }
            const prompt = plan.kind === "steps"
                ? `\nRegister template '${pyStr(templateName)}' with ${plan.steps.length} platform build steps?`
                : `\nPush image to ${resolvedNamespace}/${pyStr(resolvedRepo)}:${params["tag"]} ` + `and register template '${pyStr(templateName)}'?`;
            await confirm(prompt, { abort: true });
        }
        const data = await templateSeams._doDeploy(templateDir, {
            acr_namespace: resolvedNamespace,
            acr_registry: params["acr_registry"],
            acr_repo: params["acr_repo"],
            acr_username: params["acr_username"],
            acr_password: params["acr_password"],
            acree_instance_id: params["acree_instance_id"],
            vpc_id: params["vpc_id"],
            vswitch_ids: params["vswitch_ids"],
            security_group_id: params["security_group_id"],
            alias: params["alias"],
            tag: params["tag"],
            platform: params["platform"],
            cpu: params["cpu"],
            memory: params["memory"],
            start_cmd: runtime.start_cmd,
            ready_cmd: runtime.ready_cmd,
            timeout: params["timeout"],
            dockerfile: params["dockerfile"],
            disk_size: params["disk_size"],
            internet_access: params["internet_access"],
            team_id: params["team_id"],
            envd_inject: params["envd_inject"],
            generation: runtime.generation,
            force: Boolean(params["force"]),
            target_image: params["target_image"],
            region: params["region"],
            ctx,
            verbose: out.verbose,
            build: params["build"],
            explicit_acr_namespace: explicitAcr,
        });
        const buildStatus = _get(data, "Status", "unknown");
        const buildLogs: string[] = _get(data, "_build_logs", []);
        delete data["_build_logs"];
        if (fmt.use_json) {
            fmt.printData(data);
        }
        else {
            fmt.printDict(data);
            if (buildStatus === "ready") {
                fmt.printSuccess("Template built and ready!");
                fmt.printSuccess(`Use: abx create ${pyStr(_get(data, "TemplateID", null))}`);
            }
            else if (_get(data, "Build mode", null) === "steps" && buildStatus === "submitted") {
                fmt.printSuccess("Template registration submitted from platform build steps.");
                fmt.printSuccess(`Use: abx create ${pyStr(_get(data, "TemplateID", null))}`);
            }
            else if (buildStatus === "pushed" || buildStatus === "submitted") {
                fmt.printSuccess("Image pushed to ACR; template registration submitted.");
            }
            else {
                fmt.printError(`Build status: ${buildStatus}`);
                if (buildLogs.length > 0) {
                    for (const log of buildLogs) {
                        out.info(`  ${log}`);
                    }
                }
            }
        }
        });
    }),
});

export const deploy = template.command("deploy", {
    params: templateUi["deploy"]!.params,
    help: templateUi["deploy"]!.help,
    callback: async (ctx: Context, params: Any): Promise<void> => {
        await ctx.invoke(build, { ...params });
    },
});

export const delete_ = template.command("delete", {
    help: templateUi["delete"]!.help,
    params: templateUi["delete"]!.params,
    callback: handleErrors(async (ctx: Context, params: Any): Promise<void> => {
        requireTemplateFeature("templates.build");
        return withExpressConfiguration(ctx, params, ["access_key_id", "access_key_secret"], async () => {
        const templateId: string = params["template_id"];
        if (!params["yes"]) {
            if (!canGuideConfiguration(ctx, false) || !templateSeams.stdinIsatty()) {
                throw usageError("Confirmation required for deleting template. " + "Use --yes/-y to skip in non-interactive mode.");
            }
            await confirm(`Delete template '${templateId}'? This action cannot be undone.`, { abort: true });
        }
        const fmt = getFormatter(ctx);
        const config = templateSeams.loadConfig({ region: params["region"] });
        await fcTemplate.deleteTemplate(templateId, {
            access_key_id: config.access_key_id!, access_key_secret: config.access_key_secret!, region: config.region,
        });
        fmt.printSuccess(`Template ${templateId} deleted.`);
        });
    }),
});
template.addCommand(search);
template.addCommand(init);

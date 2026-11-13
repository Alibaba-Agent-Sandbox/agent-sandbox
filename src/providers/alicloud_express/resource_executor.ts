/** Resource deployment with native components and explicit owned/borrowed lifecycle records. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { ApplicationError, record, digest, writeJson, sourceDigest } from "../../application/config.js";
import { invokeDevsComponent, emitComponentLog } from "../../application/component_host.js";
import { execute } from "../../application/process.js";
import { createFcTransport, resolveDeployCredentials, nativeFcEndpoint } from "../../application/fc.js";
import type { CredentialSnapshot } from "../../application/bindings.js";
import { loadLayeredConfig, explainConfig } from "../../transport/config_layers.js";
import { expressResourceApi, templateRequest, resourceAbsent, type ExpressResourceApi } from "./resource_api.js";
import { withPrivateBuildContext, privateBuildFingerprint } from "./build_context.js";
import { DockerBuilder } from "./docker_builder.js";
import { getLogger } from "../../utils/logging.js";
import type { SandboxV1, DevsResourceV1, TemplateV1, ResourceActions } from "../../template/contract-v1/normalize.mjs";
import { resourcePlan, resourceValues, type ResourceOutput } from "../../template/resource_plan.js";
import { readProjectIntent } from "../../template/project.js";
import { resolveDevsProject } from "../../template/devs_project.js";
import { compileResolvedProject } from "../../template/definition.mjs";

const logger = getLogger("template.resources");
const require = createRequire(import.meta.url);
const parseArgs = require("string-argv") as {parseArgsStringToArgv(value: string): string[]};
type Dict = Record<string, unknown>;
export interface ResourceEntry {
  name: string; kind: "template" | "volume" | "serving" | "image"; region: string; provider: string;
  id?: string; nativeName: string; team?: string; owned: boolean; retain?: boolean;
  status: "pending" | "created" | "ready" | "failed" | "deleted" | "retained";
  configDigest: string; identity?: {functionId: string; createdTime: string}; component?: string; ownerTag?: string; endpoint?: string;
}
export interface ResourceReceipt {
  kind: "ResourceDeployment"; version: 1; name: string; accountId: string;
  source: string; status: "preparing" | "ready" | "requires_recovery" | "deleted";
  resources: ResourceEntry[];
  buildOnly?: boolean; sourceDigest?: string; consumers?: string[];
  builtServing?: Record<string, {image?: string}>;
  retainedComponentResources?: Array<{resource: string; nativeName: string; field: string; status: "requested" | "observed"; references: string[]}>;
}
export interface ResourceServices {
  credentials(): Promise<CredentialSnapshot>;
  express(credential: CredentialSnapshot, region: string): ExpressResourceApi;
  component: typeof invokeDevsComponent;
  fc: typeof createFcTransport;
  docker: DockerBuilder;
  run: typeof execute;
}
export const resourceServices: ResourceServices = {credentials: () => resolveDeployCredentials("abx"), express: expressResourceApi, component: invokeDevsComponent, fc: createFcTransport, docker: new DockerBuilder(), run: execute};

/** Parse variables without running actions or loading components. Output references remain deferred. */
export function loadResourceProject(file: string, environment?: NodeJS.ProcessEnv): TemplateV1 {
  const intent = readProjectIntent(file);
  return resolveDevsProject(intent as unknown as Dict, file, environment).document as unknown as TemplateV1;
}
/** Source-only preview never reads private env/files and never creates dynamic instances. */
export function previewResourceProject(file: string): Dict {
  const intent = readProjectIntent(file);
  // Variables may carry output references. Native private resolution occurs only during apply.
  const plan = resourcePlan(intent);
  return {name: intent.name, status: "preview", createsDynamicInstances: false, resources: plan.map(node => ({name: node.name, kind: node.kind,
    ...(node.kind === "sandbox" ? {provider: (node.declaration as SandboxV1).provider, volumes: Object.keys((node.declaration as SandboxV1).volumes ?? {})} : {component: (node.declaration as DevsResourceV1).component}), dependsOn: node.dependencies}))};
}
function identity(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,1023}$/.test(value)) throw new ApplicationError(`Missing or invalid ${label}; preserve the pending operation for recovery.`);
  return value;
}
function sameFunction(entry: ResourceEntry, actual: Dict | null): void {
  if (!actual || !entry.identity || actual.functionId !== entry.identity.functionId || actual.createdTime !== entry.identity.createdTime) throw new ApplicationError(`Serving identity '${entry.name}' changed; refusing to modify a replacement.`);
}
function projectPath(root: string, input: string): string {
  const target = path.resolve(root, input), relative = path.relative(root, target);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new ApplicationError("Build/action path escapes the project.");
  const real = fs.realpathSync(target), rel = path.relative(fs.realpathSync(root), real);
  if (rel.startsWith(`..${path.sep}`) || rel === ".." || path.isAbsolute(rel)) throw new ApplicationError("Build/action symlink escapes the project.");
  return real;
}
/** Load only the identity record, never cached resolved credentials or component props. */
export function readResourceReceipt(file: string): ResourceReceipt {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!record(value) || value.kind !== "ResourceDeployment" || value.version !== 1 || !Array.isArray(value.resources) || typeof value.accountId !== "string") throw new ApplicationError("Invalid resource deployment record.");
  for (const entry of value.resources) if (!record(entry) || !["template", "volume", "serving", "image"].includes(String(entry.kind)) || typeof entry.region !== "string" || typeof entry.owned !== "boolean") throw new ApplicationError("Invalid resource ownership record.");
  return value as unknown as ResourceReceipt;
}
/** Apply resources in dependency order. A saved pending write is never silently replayed. */
export async function deployResourceProject(file: string, receiptFile: string, options: {name?: string; timeoutSeconds?: number; buildOnly?: boolean; buildReceipt?: string; onProgress?: (message: string) => void; services?: ResourceServices; environment?: NodeJS.ProcessEnv} = {}): Promise<ResourceReceipt> {
  const services = options.services ?? resourceServices, timeout = options.timeoutSeconds ?? 600;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 3600) throw new ApplicationError("Deployment timeout must be in (0, 3600].");
  const root = fs.realpathSync(path.dirname(file)), document = loadResourceProject(file, options.environment), plan = resourcePlan(document);
  // Reject unsupported adapters before any hooks or cloud changes.
  for (const node of plan) {
    if (node.kind === "sandbox" && (node.declaration as SandboxV1).provider !== "alicloud-express") throw new ApplicationError(`Provider '${(node.declaration as SandboxV1).provider}' has no named-resource adapter yet.`);
    if (node.kind === "serving" && !/^serverless-devs\/fc3@\d+\.\d+\.\d+$/.test((node.declaration as DevsResourceV1).component)) throw new ApplicationError("Serving lifecycle currently requires an exact serverless-devs/fc3 version.");
  }
  const originalYaml = fs.readFileSync(file, "utf8");
  for (const node of plan) {
    for (const actions of Object.values(node.declaration.actions ?? {})) for (const item of actions ?? []) projectPath(root, item.path ?? ".");
    const template = node.kind === "sandbox" ? (node.declaration as SandboxV1).template : undefined;
    if (template?.buildConfig && "dockerfile" in template.buildConfig && template.buildConfig.dockerfile) {
      projectPath(root, template.buildConfig.dockerfile); projectPath(root, template.buildConfig.context ?? path.dirname(template.buildConfig.dockerfile));
    }
  }
  const build = options.buildReceipt ? readResourceReceipt(options.buildReceipt) : undefined;
  if (build && (!build.buildOnly || build.status !== "ready" || build.source !== root || build.sourceDigest !== sourceDigest(root))) throw new ApplicationError("Build source changed or the artifact is not ready; prepare a new build.");
  const credential = await services.credentials();
  if (build && build.accountId !== credential.AccountID) throw new ApplicationError("Build belongs to another account.");
  const receipt: ResourceReceipt = fs.existsSync(receiptFile) ? readResourceReceipt(receiptFile) : {kind: "ResourceDeployment", version: 1, name: options.name ?? document.name,
    accountId: credential.AccountID, source: root, status: "preparing", resources: build ? build.resources.map(entry => ({...entry, owned: false})) : [], ...(options.buildOnly ? {buildOnly: true, builtServing: {}} : {})};
  if (receipt.accountId !== credential.AccountID || receipt.name !== (options.name ?? document.name)) throw new ApplicationError("Deployment identity differs from its saved owner.");
  if (receipt.resources.some(entry => entry.status === "pending" || entry.status === "failed")) throw new ApplicationError("A previous operation is unresolved. Inspect its resource identity before retrying or deleting.");
  const save = (): void => writeJson(receiptFile, receipt);
  const outputs: Record<string, ResourceOutput> = {};
  const secretValues = [credential.AccessKeyID, credential.AccessKeySecret, credential.SecurityToken ?? ""];
  const collectSecrets = (value: unknown, key = ""): void => {
    if (record(value)) for (const [childKey, child] of Object.entries(value)) collectSecrets(child, childKey);
    else if (Array.isArray(value)) value.forEach(child => collectSecrets(child, key));
    else if (typeof value === "string" && /password|secret|token|api.?key|database.?url|authorization/i.test(key) && value) secretValues.push(value);
  };
  collectSecrets(document);
  collectSecrets(process.env);
  collectSecrets(options.environment ?? {});
  const redact = (text: string): string => secretValues.filter(Boolean).reduce((result, secret) => result.split(secret).join("[REDACTED]"), text);
  const progress = (message: string): void => options.onProgress?.(redact(message));
  const onLog: NonNullable<Parameters<typeof invokeDevsComponent>[0]["onLog"]> = event => {emitComponentLog(event); if (event.level !== "debug") progress(`[${event.resource}] ${event.message}`);};
  const action = async (phase: keyof ResourceActions, actions: ResourceActions | undefined, nodeName: string, nativeProps: Dict): Promise<boolean> => {
    let built = false;
    for (const raw of actions?.[phase] ?? []) {
      const item = resourceValues(raw, outputs), cwd = projectPath(root, item.path ?? ".");
      if (item.run) {
        // Shell is intentional for explicitly declared host actions. No configuration value is concatenated into argv.
        const buffered = {stdout: "", stderr: ""};
        const emit = (stream: "stdout" | "stderr", chunk: string): void => {
          buffered[stream] += chunk;
          for (;;) {const index = buffered[stream].indexOf("\n"); if (index < 0) break;
            const line = buffered[stream].slice(0, index); buffered[stream] = buffered[stream].slice(index + 1);
            logger[stream === "stderr" ? "warning" : "info"]("[%s] %s", nodeName, redact(line)); progress(`[${nodeName}] ${line}`);}
        };
        const out = await services.run({argv: process.platform === "win32" ? ["cmd.exe", "/d", "/s", "/c", item.run] : ["/bin/sh", "-c", item.run], cwd, env: {...(options.environment ?? process.env), ALIBABA_CLOUD_ACCESS_KEY_ID: credential.AccessKeyID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: credential.AccessKeySecret, ALIBABA_CLOUD_SECURITY_TOKEN: credential.SecurityToken ?? ""}, timeoutSeconds: timeout, onOutput: emit});
        for (const [stream, value] of Object.entries(buffered)) if (value) logger[stream === "stderr" ? "warning" : "info"]("[%s] %s", nodeName, redact(value));
        void out;
      } else if (item.component) {
        const [component, command, ...args] = parseArgs.parseArgsStringToArgv(item.component);
        if (!component || !command) throw new ApplicationError("Component actions require a component and command.");
        if (phase === "pre-deploy" && command === "build" && build?.builtServing?.[nodeName]) {
          const image = build.builtServing[nodeName].image;
          if (image && record(nativeProps.customContainerConfig)) nativeProps.customContainerConfig.image = image;
          built = true; continue;
        }
        const result = await services.component({component, command, args, cwd, name: receipt.name, resource: nodeName, props: nativeProps, credential, timeoutSeconds: timeout, sensitiveValues: secretValues, onLog});
        built ||= command === "build";
        // FC cloud-build results are explicitly handed to deploy; local builds retain native project state.
        if (command === "build" && record(result) && typeof result.image === "string" && record(nativeProps.customContainerConfig)) nativeProps.customContainerConfig.image = result.image;
      }
    }
    return built;
  };
  const createEntry = (entry: ResourceEntry): ResourceEntry => {receipt.resources.push(entry); save(); return entry;};
  receipt.status = "preparing"; save();
  try {
    for (const node of plan) {
      progress(`Preparing ${node.kind} ${node.name}`);
      if (fs.readFileSync(file, "utf8") !== originalYaml) throw new ApplicationError("A deployment action changed template.yaml; review it before applying resources.");
      const fresh = loadResourceProject(file, options.environment);
      if (digest(resourcePlan(fresh).map(n => [n.name, n.kind, n.dependencies])) !== digest(plan.map(n => [n.name, n.kind, n.dependencies]))) throw new ApplicationError("A deployment action changed the resource dependency graph.");
      const raw = fresh[node.kind]![node.name];
      let controls = resourceValues(node.kind === "sandbox" ? (raw as SandboxV1).template : (raw as DevsResourceV1).props, outputs) as Dict;
      // Validate concrete native values after output substitution, without evaluating output strings again.
      const {actions: _actions, ...withoutActions} = raw;
      compileResolvedProject({specVersion: 1, name: document.name, [node.kind]: {[node.name]: {...withoutActions, ...(node.kind === "sandbox" ? {template: controls} : {props: controls})}}});
      const configured = loadLayeredConfig({provider: "alicloud-express"});
      if (node.kind === "sandbox" && controls.region === undefined) controls.region = configured.region;
      const region = identity(controls.region, "resource region");
      const secrets = record(controls.environmentVariables) ? Object.values(controls.environmentVariables).filter((v): v is string => typeof v === "string" && v.length >= 8) : [];
      secretValues.push(...secrets);
      let failure: unknown;
      try {
        const built = await action("pre-deploy", raw.actions, node.name, controls);
        if (raw.actions?.["pre-deploy"]?.length) {
          if (fs.readFileSync(file, "utf8") !== originalYaml) throw new ApplicationError("A deployment action changed template.yaml; review the changes before applying them.");
          const refreshed = loadResourceProject(file, options.environment), next = refreshed[node.kind]?.[node.name];
          if (!next || digest(resourcePlan(refreshed).map(n => [n.name, n.kind, n.dependencies])) !== digest(plan.map(n => [n.name, n.kind, n.dependencies]))) throw new ApplicationError("A deployment action changed the resource dependency graph.");
          const resolved = resourceValues(node.kind === "sandbox" ? (next as SandboxV1).template : (next as DevsResourceV1).props, outputs) as Dict;
          // Component build may return a new image. Preserve that explicit result across dotenv refresh.
          if (built && record(controls.customContainerConfig) && record(resolved.customContainerConfig)) resolved.customContainerConfig.image = controls.customContainerConfig.image;
          controls = resolved;
          if (node.kind === "sandbox" && controls.region === undefined) controls.region = configured.region;
          if (controls.region !== region) throw new ApplicationError("A deployment action changed the selected region.");
          collectSecrets(controls);
          if (record(controls.environmentVariables)) secretValues.push(...Object.values(controls.environmentVariables).filter((v): v is string => typeof v === "string" && v.length >= 8));
        }
        const sourceIdentity = record(controls.buildConfig) && typeof controls.buildConfig.dockerfile === "string"
          ? digest({context: privateBuildFingerprint(projectPath(root, String(controls.buildConfig.context ?? path.dirname(controls.buildConfig.dockerfile))), projectPath(root, controls.buildConfig.dockerfile)), baseRegion: process.env.ABX_BASE_IMAGE_REGION ?? "", baseTag: process.env.ABX_BASE_IMAGE_TAG ?? ""}) : undefined;
        const templateHash = digest({controls, sourceIdentity});
        if (node.kind === "sandbox") {
          const declaration = raw as SandboxV1, api = services.express(credential, region);
          const localRegistry = explainConfig({provider: "alicloud-express"});
          const acrInstanceId = typeof localRegistry.acree_instance_id?.value === "string" ? localRegistry.acree_instance_id.value : undefined;
          const team = await api.team(typeof configured.provider_options.team_id === "string" ? configured.provider_options.team_id : undefined);
          const volumes: Record<string, Dict> = {};
          for (const [name, volume] of Object.entries(declaration.volumes ?? {})) {
            const spec = resourceValues(volume, outputs), key = `${node.name}.volumes.${name}`, hash = digest(spec);
            let entry = receipt.resources.find(value => value.name === key && value.status !== "deleted");
            if (entry && (entry.region !== region || entry.team !== team)) throw new ApplicationError(`Volume '${key}' region/Team changed; refusing to redirect ownership.`);
            if (entry && entry.configDigest !== hash) {
              if (!entry.owned || spec.reference || (spec.props?.volumeName && spec.props.volumeName !== entry.nativeName)) throw new ApplicationError(`Volume '${key}' identity changed; use another logical name.`);
              entry.status = "pending"; save();
              const {volumeName: _name, ...properties} = spec.props ?? {};
              await api.call("UpdateVolume", {id: entry.id, query: {teamID: team}, body: properties});
              entry.configDigest = hash; entry.retain = spec.retain; entry.status = "created"; save();
            }
            if (!entry) {
              const nativeName = String(spec.reference ?? spec.props?.volumeName ?? `${receipt.name}-${node.name}-${name}`);
              const found = await api.call("ListVolumes", {query: {teamID: team, volumeName: nativeName, maxResults: 100}});
              const matches = Array.isArray(found.volumes) ? found.volumes.filter(v => record(v) && v.volumeName === nativeName) : [];
              if (spec.reference) {
                if (matches.length !== 1 || !record(matches[0])) throw new ApplicationError(`Borrowed volume '${key}' was not found unambiguously.`);
                entry = createEntry({name: key, kind: "volume", region, provider: declaration.provider, team, nativeName, id: identity(matches[0].volumeID, "volume ID"), owned: false, configDigest: hash, status: "created"});
              } else {
                if (matches.length) throw new ApplicationError(`Volume '${nativeName}' already exists; use reference to borrow it.`);
                entry = createEntry({name: key, kind: "volume", region, provider: declaration.provider, team, nativeName, owned: true, retain: spec.retain, configDigest: hash, status: "pending"});
                const created = await api.call("CreateVolume", {body: {...spec.props, volumeName: nativeName, teamID: team}});
                entry.id = identity(record(created.volume) ? created.volume.volumeID : undefined, "volume ID"); entry.status = "created"; save();
              }
            }
            await api.ready("volume", entry.id!, team, timeout); entry.status = "ready"; save();
            volumes[name] = {volumeId: entry.id, volumeName: entry.nativeName};
          }
          let entry = receipt.resources.find(value => value.name === node.name && value.kind === "template" && value.status !== "deleted");
          if (entry && (entry.region !== region || entry.team !== team)) throw new ApplicationError(`Template '${node.name}' region/Team changed; use another logical name.`);
          if (entry && entry.configDigest !== templateHash) {
            // A new immutable template does not mutate existing sessions. The old owned version stays in the receipt for cleanup.
            entry.name = `${node.name}.previous.${entry.id}`; save(); entry = undefined;
          }
          if (!entry) {
            if (typeof controls.reference === "string") entry = createEntry({name: node.name, kind: "template", region, provider: declaration.provider, team, id: controls.reference, nativeName: controls.reference, owned: false, status: "created", configDigest: templateHash});
            else {
              if (record(controls.buildConfig) && typeof controls.buildConfig.dockerfile === "string") {
                const dockerfile = projectPath(root, controls.buildConfig.dockerfile), context = projectPath(root, String(controls.buildConfig.context ?? path.dirname(controls.buildConfig.dockerfile)));
                if (controls.image === undefined) {
                  const local = explainConfig({provider: "alicloud-express"}), namespace = local.acr_namespace?.value;
                  if (typeof namespace !== "string" || !namespace) throw new ApplicationError("Set template.image or configure an existing ACR namespace with abx config init --build.");
                  const registry = String(local.acr_registry?.value || `registry.${region}.aliyuncs.com`), repo = String(local.acr_repo?.value || `${receipt.name}-${node.name}`);
                  controls.image = `${registry}/${namespace}/${repo}:${randomUUID().replaceAll("-", "")}`;
                }
                if (typeof controls.image !== "string" || !controls.image || controls.image.includes("@")) throw new ApplicationError("A Dockerfile build needs a writable template.image tag.");
                const auth = record(controls.registryConfig) && record(controls.registryConfig.authConfig) ? controls.registryConfig.authConfig : undefined;
                const registry = controls.image.split("/")[0];
                if (auth && typeof auth.userName === "string" && typeof auth.password === "string") await services.docker.loginAcr(registry, auth.userName, auth.password);
                else if (/aliyuncs\.com$/.test(registry)) {
                  const login = await services.docker.loginAcrWithAksk(registry, credential.AccessKeyID, credential.AccessKeySecret, {region, instance_id: acrInstanceId});
                  if (typeof login.tempUserName === "string" && typeof login.authorizationToken === "string") {
                    controls.registryConfig = {...(record(controls.registryConfig) ? controls.registryConfig : {}), authConfig: {userName: login.tempUserName, password: login.authorizationToken}};
                    secretValues.push(login.authorizationToken);
                  }
                }
                const priorImage = receipt.resources.find(value => value.kind === "image" && value.id === controls.image);
                if (priorImage && priorImage.configDigest !== sourceIdentity) throw new ApplicationError("Use a new template.image tag for changed Dockerfile/context contents.");
                const imageEntry = priorImage ?? createEntry({name: `${node.name}.image`, kind: "image", region, provider: declaration.provider, nativeName: controls.image, id: controls.image,
                  owned: true, retain: true, status: "pending", configDigest: sourceIdentity!});
                if (!priorImage) {
                  const image = controls.image, deadline = Date.now() + timeout * 1000;
                  const remaining = (): number => {const seconds = (deadline - Date.now()) / 1000; if (seconds <= 0) throw new ApplicationError("Image build/push deadline exceeded; preserve the image receipt for inspection."); return seconds;};
                  await withPrivateBuildContext(context, dockerfile, async staged => {
                    const stagedIdentity = digest({context: privateBuildFingerprint(staged.context, staged.dockerfile), baseRegion: process.env.ABX_BASE_IMAGE_REGION ?? "", baseTag: process.env.ABX_BASE_IMAGE_TAG ?? ""});
                    if (stagedIdentity !== sourceIdentity) throw new ApplicationError("Build inputs changed during preparation; no image build was started.");
                    return services.docker.build(staged.context, image, {dockerfile: staged.dockerfile, timeout: remaining(), on_output: line => {logger.info("%s", redact(line)); progress(line);}});
                  });
                  await services.docker.push(image, {timeout: remaining()});
                } imageEntry.status = "ready"; save();
              }
              const nativeName = `${receipt.name}-${node.name}-${randomUUID().slice(0, 8)}`.slice(0, 63);
              entry = createEntry({name: node.name, kind: "template", region, provider: declaration.provider, team, nativeName, owned: true, status: "pending", configDigest: templateHash});
              const created = await api.call("CreateTemplate", {body: templateRequest(controls, nativeName, team, typeof controls.image === "string" && /(?:^|\.)[a-z0-9-]+\.cr\.aliyuncs\.com\//.test(controls.image) && acrInstanceId ? {registryType: "acree", acrInstanceId} : typeof controls.image === "string" && /^registry(?:-vpc)?\.[a-z0-9-]+\.aliyuncs\.com\//.test(controls.image) ? {registryType: "acr"} : undefined)});
              entry.id = identity(created.templateID, "template ID"); entry.status = "created"; save();
            }
          }
          await api.ready("template", entry.id!, team, timeout); entry.status = "ready"; save();
          outputs[node.name] = {templateId: entry.id, volumes};
        } else {
          if (options.buildOnly) {
            if (built) receipt.builtServing![node.name] = { ...(record(controls.customContainerConfig) && typeof controls.customContainerConfig.image === "string" ? {image: controls.customContainerConfig.image} : {}) };
            save(); outputs[node.name] = {functionName: controls.functionName}; continue;
          }
          const declaration = raw as DevsResourceV1, name = identity(controls.functionName, "FC functionName"), fc = services.fc(credential, region, typeof controls.endpoint === "string" ? controls.endpoint : undefined);
          let entry = receipt.resources.find(value => value.kind === "serving" && value.name === node.name && value.status !== "deleted");
          const before = await fc.describeFunction(name);
          let createOnly = false;
          if (entry && (entry.region !== region || entry.endpoint !== controls.endpoint)) throw new ApplicationError("Serving region changed; use a new resource name.");
          if (entry && entry.nativeName !== name) {entry.name = `${node.name}.previous.${entry.nativeName}`; save(); entry = undefined;}
          if (entry) {if (entry.component !== declaration.component) throw new ApplicationError("Serving component changed; inspect the owned resource before upgrading its lifecycle adapter."); sameFunction(entry, before);}
          if (!entry) {
            if (before) throw new ApplicationError(`FC function '${name}' already exists outside this deployment.`);
            createOnly = true;
            entry = createEntry({name: node.name, kind: "serving", region, provider: "alicloud-express", nativeName: name, component: declaration.component, ...(typeof controls.endpoint === "string" ? {endpoint: controls.endpoint} : {}), ownerTag: randomUUID(), owned: true, status: "pending", configDigest: digest(controls)});
          }
          const userTags = Array.isArray(controls.tags) ? controls.tags : [];
          if (userTags.some(tag => record(tag) && tag.key === "abx-resource-owner")) throw new ApplicationError("Tag abx-resource-owner is reserved for deployment ownership.");
          if (entry.ownerTag) controls.tags = [...userTags, {key: "abx-resource-owner", value: entry.ownerTag}];
          // Native FC auto resources can be shared. Preserve native behavior, record their retention,
          // and never infer exclusive ownership merely because the component created/reused them.
          const autoFields = ["role", "logConfig", "vpcConfig", "nasConfig", "ossMountConfig"].filter(field => controls[field] === "auto" || (field === "vpcConfig" && record(controls[field]) && controls[field].vSwitchIds === "auto"));
          receipt.retainedComponentResources ??= [];
          for (const field of autoFields) if (!receipt.retainedComponentResources.some(item => item.nativeName === name && item.field === field)) receipt.retainedComponentResources.push({resource: node.name, nativeName: name, field, status: "requested", references: []});
          if (autoFields.length) progress(`FC ${node.name}: component-managed ${autoFields.join(", ")} resources will be retained after function deletion.`);
          entry.status = "pending"; save();
          const result = await services.component({component: declaration.component, command: "deploy", args: ["--assume-yes", ...(!built && controls.runtime === "custom-container" ? ["--skip-push"] : [])], cwd: root,
            name: receipt.name, resource: node.name, props: controls, credential, timeoutSeconds: timeout, sensitiveValues: secretValues, onLog, ...(createOnly ? {functionCreationGuard: {endpoint: nativeFcEndpoint(credential.AccountID, region, typeof controls.endpoint === "string" ? controls.endpoint : undefined), functionName: name}} : {})});
          const actual = await fc.describeFunction(name);
          if (!actual) throw new ApplicationError("FC deploy returned without an observable function.");
          const referenceKeys = new Set(["role", "project", "logstore", "vpcId", "securityGroupId", "vSwitchIds", "serverAddr", "bucketName"]);
          const refs = (value: unknown, key = ""): string[] => Array.isArray(value) ? value.flatMap(v => refs(v, key)) : record(value) ? Object.entries(value).flatMap(([k, v]) => refs(v, k)) : referenceKeys.has(key) && typeof value === "string" ? [value] : [];
          for (const item of receipt.retainedComponentResources) if (item.nativeName === name && autoFields.includes(item.field)) {item.references = [...new Set([...item.references, ...refs(actual[item.field], item.field)])]; item.status = "observed";}
          entry.id = identity(actual.functionArn, "FC function ARN"); entry.identity = {functionId: identity(actual.functionId, "FC function ID"), createdTime: String(actual.createdTime)};
          entry.configDigest = digest(controls); entry.status = "ready"; save();
          outputs[node.name] = {...(record(result) ? result : {result}), functionName: name, functionArn: actual.functionArn};
        }
        await action("success-deploy", raw.actions, node.name, controls);
        progress(`${node.name} ready`);
      } catch (error) {
        failure = error;
        try {await action("fail-deploy", raw.actions, node.name, controls);} catch {logger.warning("Failure action also failed for %s.", node.name);}
      } finally {
        try {await action("complete-deploy", raw.actions, node.name, controls);} catch (error) {if (!failure) failure = error; else logger.warning("Completion action also failed for %s.", node.name);}
      }
      if (failure) throw failure;
    }
    receipt.status = "ready";
    if (options.buildOnly) receipt.sourceDigest = sourceDigest(root);
    save(); return receipt;
  } catch (error) {
    receipt.status = "requires_recovery"; save();
    if (error instanceof Error) error.message = redact(error.message);
    throw error;
  }
}
/** Removal uses recorded identities, never re-runs actions or rebuilds a changed project. */
export async function deleteResourceProject(file: string, services: ResourceServices = resourceServices): Promise<ResourceReceipt> {
  const receipt = readResourceReceipt(file);
  if (receipt.buildOnly && receipt.consumers?.length) throw new ApplicationError("This build is used by a deployment; delete its consumers before cleaning it.");
  const credential = await services.credentials();
  if (credential.AccountID !== receipt.accountId) throw new ApplicationError("Current account differs from the deployment owner.");
  const failures: string[] = [];
  for (const entry of [...receipt.resources].reverse()) {
    if (["deleted", "retained"].includes(entry.status)) continue;
    if (!entry.owned || entry.retain || entry.kind === "image") {entry.status = "retained"; writeJson(file, receipt); continue;}
    if (!entry.id || entry.status === "pending") {failures.push(entry.name); continue;}
    try {
      if (entry.kind === "serving") {
        const actual = await services.fc(credential, entry.region, entry.endpoint).describeFunction(entry.nativeName);
        if (actual) {
          sameFunction(entry, actual);
          await services.component({component: entry.component!, command: "remove", args: ["--assume-yes"], cwd: path.dirname(fs.realpathSync(file)), name: receipt.name, resource: entry.name,
            props: {region: entry.region, functionName: entry.nativeName, ...(entry.endpoint ? {endpoint: entry.endpoint} : {})}, credential});
          if (await services.fc(credential, entry.region, entry.endpoint).describeFunction(entry.nativeName)) throw new ApplicationError("FC deletion remains unconfirmed.");
        }
      } else {
        const api = services.express(credential, entry.region), kind = entry.kind === "template" ? "Template" : "Volume";
        try {await api.call(`Delete${kind}`, {id: entry.id, query: {teamID: entry.team}});} catch (error) {if (!resourceAbsent(error)) throw error;}
        try {await api.call(`Get${kind}`, {id: entry.id, query: {teamID: entry.team}}); throw new ApplicationError("Deletion remains unconfirmed.");} catch (error) {if (!resourceAbsent(error)) throw error;}
      }
      entry.status = "deleted";
    } catch {failures.push(entry.name);}
    writeJson(file, receipt);
  }
  receipt.status = failures.length ? "requires_recovery" : "deleted"; writeJson(file, receipt);
  if (failures.length) throw new ApplicationError(`Some resources still need recovery: ${failures.join(", ")}.`);
  return receipt;
}

/** Observe saved operations without replaying writes. Identity is required before enabling cleanup. */
export async function recoverResourceProject(file: string, services: ResourceServices = resourceServices): Promise<ResourceReceipt> {
  const receipt = readResourceReceipt(file), credential = await services.credentials();
  if (credential.AccountID !== receipt.accountId) throw new ApplicationError("Current account differs from the deployment owner.");
  for (const entry of receipt.resources) {
    if (["deleted", "retained"].includes(entry.status) || entry.kind === "image") continue;
    if (entry.kind === "serving") {
      const actual = await services.fc(credential, entry.region, entry.endpoint).describeFunction(entry.nativeName);
      if (!actual) {if (entry.status !== "pending") entry.status = "deleted"; continue;}
      if (entry.identity) sameFunction(entry, actual);
      else {
        const tags = Array.isArray(actual.tags) ? actual.tags : [];
        if (!entry.ownerTag || !tags.some(tag => record(tag) && tag.key === "abx-resource-owner" && tag.value === entry.ownerTag)) continue;
        entry.id = identity(actual.functionArn, "FC function ARN");
        entry.identity = {functionId: identity(actual.functionId, "FC function ID"), createdTime: String(actual.createdTime)};
      }
      // Observing a function proves identity, not completion of all component subresources or hooks.
      if (entry.status === "pending") entry.status = "created";
    } else {
      const api = services.express(credential, entry.region), kind = entry.kind === "template" ? "Template" : "Volume";
      if (!entry.id) continue; // Name alone is not authority to adopt an uncertain create.
      try {
        const result = await api.call(`Get${kind}`, {id: entry.id, query: {teamID: entry.team}});
        const value = entry.kind === "volume" && record(result.volume) ? result.volume : result;
        if (value.teamID !== entry.team || (entry.kind === "template" ? value.templateID : value.volumeID) !== entry.id) throw new ApplicationError("Cloud resource ownership differs from the saved identity.");
        const state = String(record(value.status) ? value.status.state : value.status).toLowerCase();
        entry.status = state === "ready" || state === "available" ? "ready" : "created";
      } catch (error) {if (resourceAbsent(error)) entry.status = "deleted"; else throw error;}
    }
    writeJson(file, receipt);
  }
  // A read-only recovery never claims deployment hooks or incomplete cloud changes succeeded.
  writeJson(file, receipt); return receipt;
}

/** Native FC logs use the recorded identity and the same isolated component logger. */
export async function resourceLogs(file: string, selected?: string, follow = false, services: ResourceServices = resourceServices): Promise<unknown> {
  const receipt = readResourceReceipt(file), entries = receipt.resources.filter(entry => entry.kind === "serving" && !["deleted", "retained"].includes(entry.status) && (!selected || entry.name === selected));
  if (entries.length !== 1) throw new ApplicationError(entries.length ? "Select one Serving resource with --resource." : "No matching Serving resource. Sandbox instance logs require a running instance ID.");
  const entry = entries[0], credential = await services.credentials();
  if (credential.AccountID !== receipt.accountId) throw new ApplicationError("Current account differs from the deployment owner.");
  sameFunction(entry, await services.fc(credential, entry.region, entry.endpoint).describeFunction(entry.nativeName));
  return services.component({component: entry.component!, command: "logs", args: follow ? ["--tail"] : [], cwd: path.dirname(fs.realpathSync(file)), name: receipt.name, resource: entry.name,
    props: {region: entry.region, functionName: entry.nativeName, ...(entry.endpoint ? {endpoint: entry.endpoint} : {})}, credential, timeoutSeconds: follow ? 3600 : 120});
}

/** Local image preparation. No provider credentials, cloud registration or deployment actions. */
import fs from "node:fs";
import path from "node:path";
import { ApplicationError, digest, readYaml, record, writeJson } from "../../application/config.js";
import { execute } from "../../application/process.js";
import { withApplicationLock } from "../../application/lock.js";
import { paths } from "../../transport/config_layers.js";
import { DockerBuilder } from "./docker_builder.js";
import { privateBuildFingerprint, withPrivateBuildContext } from "./build_context.js";
import { readProjectIntent } from "../../template/project.js";
import { resolveBuildPlan } from "../../template/build_plan.js";

export interface LocalBuildRecipe { resource: string; context: string; dockerfile: string; platform: string }
export interface LocalImage { resource: string; image_id: string; cached: boolean }
export interface LocalBuildServices { docker: Pick<DockerBuilder, "build" | "tag">; run: typeof execute }
export const localBuildServices: LocalBuildServices = {docker: new DockerBuilder(), run: execute};
interface CachedImage {version: 1; identity: string; imageId: string}
const imageId = /^sha256:[a-f0-9]{64}$/;

/** Constrain build paths to the source; relative context defaults to the Dockerfile directory. */
export function localBuildRecipe(root: string, resource: string, dockerfile: string, context = path.dirname(dockerfile)): LocalBuildRecipe {
  const base = fs.realpathSync(root);
  const resolve = (value: string): string => {
    if (value.includes("${")) throw new ApplicationError("Local builds require concrete Dockerfile and context paths. Resolve these paths in template.yaml before building.");
    const resolved = fs.realpathSync(path.resolve(base, value)), relative = path.relative(base, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new ApplicationError("Dockerfile and context must remain inside the project.");
    return resolved;
  };
  return {resource, dockerfile: resolve(dockerfile), context: resolve(context), platform: "linux/amd64"};
}
export function localBuildIdentity(recipe: LocalBuildRecipe): string {
  return digest({inputs: privateBuildFingerprint(recipe.context, recipe.dockerfile), platform: recipe.platform,
    baseRegion: process.env.ABX_BASE_IMAGE_REGION ?? "", baseTag: process.env.ABX_BASE_IMAGE_TAG ?? ""});
}
function cacheFile(identity: string): string {return path.join(paths.abxDir, "local-images", `${identity}.json`);}
async function inspectImage(id: string, services: LocalBuildServices): Promise<string | undefined> {
  try {
    const actual = (await services.run({argv: ["docker", "image", "inspect", "--format", "{{.Id}}", id], cwd: process.cwd(), env: process.env, timeoutSeconds: 30})).trim();
    return imageId.test(actual) ? actual : undefined;
  } catch {return undefined;}
}
/** A mutable tag is never sufficient cache authority; verify the actual local image ID. */
export async function cachedLocalImage(recipe: LocalBuildRecipe, services: LocalBuildServices = localBuildServices): Promise<string | undefined> {
  const identity = localBuildIdentity(recipe), file = cacheFile(identity);
  if (!fs.existsSync(file)) return undefined;
  let cached: CachedImage;
  try {cached = JSON.parse(fs.readFileSync(file, "utf8"));} catch {return undefined;}
  if (cached.version !== 1 || cached.identity !== identity || !imageId.test(cached.imageId)) return undefined;
  return await inspectImage(cached.imageId, services) === cached.imageId ? cached.imageId : undefined;
}
export async function buildLocalImage(recipe: LocalBuildRecipe, timeoutSeconds = 600, services: LocalBuildServices = localBuildServices): Promise<LocalImage> {
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 3600) throw new ApplicationError("Build timeout must be in (0, 3600].");
  const identity = localBuildIdentity(recipe);
  return withApplicationLock(path.join(paths.abxDir, "local-image-locks"), identity, async () => {
    const cached = await cachedLocalImage(recipe, services);
    if (cached) return {resource: recipe.resource, image_id: cached, cached: true};
    const tag = `abx-local:${identity}`;
    await withPrivateBuildContext(recipe.context, recipe.dockerfile, async staged => {
      if (localBuildIdentity({...recipe, ...staged}) !== identity) throw new ApplicationError("Build inputs changed while staging; retry after source changes finish.");
      await services.docker.build(staged.context, tag, {dockerfile: staged.dockerfile, platform: recipe.platform, timeout: timeoutSeconds});
    });
    if (localBuildIdentity(recipe) !== identity) throw new ApplicationError("Build inputs changed during construction; the image will not be reused.");
    const built = await inspectImage(tag, services);
    if (!built) throw new ApplicationError("Docker did not return an observable local image.");
    try {writeJson(cacheFile(identity), {version: 1, identity, imageId: built});}
    catch {throw new ApplicationError("The image was built, but its local cache could not be saved. Check that the CLI configuration directory is writable before retrying.");}
    return {resource: recipe.resource, image_id: built, cached: false};
  });
}

/** Discover only literal local recipe inputs; unrelated runtime secrets are never resolved. */
export async function buildLocalProject(file: string, options: {timeoutSeconds?: number; buildProfile?: string; services?: LocalBuildServices} = {}): Promise<Record<string, unknown>> {
  const raw = readYaml(file), root = path.dirname(fs.realpathSync(file)), recipes: LocalBuildRecipe[] = [];
  const deferred: Array<{resource: string; reason: string}> = [];
  if (!record(raw)) throw new ApplicationError("Template must be a YAML mapping.");
  if (raw.specVersion === 1) {
    if (options.buildProfile) throw new ApplicationError("Resource specVersion: 1 declares buildConfig on each template; --build-profile applies only to source spec_version: 5.");
    const document = readProjectIntent(file);
    for (const [name, resource] of Object.entries(document.sandbox ?? {})) {
      if (resource.provider !== "alicloud-express") throw new ApplicationError(`Provider '${resource.provider}' has no local resource-build adapter.`);
      const build = resource.template.buildConfig;
      if (build && "dockerfile" in build && build.dockerfile) recipes.push(localBuildRecipe(root, name, build.dockerfile, build.context));
      else deferred.push({resource: name, reason: build ? "Native Steps execute during deployment; no local image is produced." : "Uses an existing template or image; no local build is required."});
    }
    for (const name of Object.keys(document.serving ?? {})) deferred.push({resource: name, reason: "Serving component actions execute during deployment. Local build does not run deployment hooks."});
  } else if (raw.spec_version === 5 && !raw.application) {
    const profiles = record(raw.build_profiles) ? raw.build_profiles : {};
    const profile = options.buildProfile ? profiles[options.buildProfile] : undefined;
    if (options.buildProfile && (!record(profile) || typeof profile.dockerfile !== "string")) throw new ApplicationError("Unknown Docker build profile.");
    if (raw.template_id || raw.image) deferred.push({resource: String(raw.name), reason: "Uses an existing template or image; no local build is required."});
    else {
      const plan = resolveBuildPlan(root, {dockerfile: record(profile) ? path.join(root, String(profile.dockerfile)) : undefined});
      if (plan.kind === "dockerfile") recipes.push(localBuildRecipe(root, String(raw.name), path.relative(root, plan.dockerfile), "."));
      else deferred.push({resource: String(raw.name), reason: "Native Steps execute during deployment; no local image is produced."});
    }
  } else throw new ApplicationError("Local image builds support resource specVersion: 1 and source spec_version: 5. This application recipe uses deployment-managed builds; use abx deploy SOURCE.");
  const images: LocalImage[] = [];
  for (const recipe of recipes) images.push(await buildLocalImage(recipe, options.timeoutSeconds, options.services));
  return {status: images.length ? (deferred.length ? "partially_built" : "built") : "no_local_build", images, deferred};
}

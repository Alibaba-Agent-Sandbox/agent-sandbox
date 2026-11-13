/** Current Express resource API, using the official signer without lossy generated-model projection. */
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import type { CredentialSnapshot } from "../../application/bindings.js";
import { ApplicationError, record } from "../../application/config.js";

const require = createRequire(import.meta.url);
type Dict = Record<string, unknown>;
type Constructor = new (value: Dict) => unknown;
const sdk = require("@alicloud/sandbox20260820") as { default: new (value: unknown) => {callApi(params: unknown, request: unknown, runtime: unknown): Promise<unknown>} };
const core = require("@alicloud/openapi-core") as {$OpenApiUtil: {Config: Constructor; Params: Constructor; OpenApiRequest: Constructor}};
const dara = require("@darabonba/typescript") as {RuntimeOptions: Constructor};
const routes: Record<string, [string, string]> = {
  ListTeams: ["GET", "teams"], ListVolumes: ["GET", "volumes"],
  CreateTemplate: ["POST", "templates"], GetTemplate: ["GET", "templates"], UpdateTemplate: ["PUT", "templates"], DeleteTemplate: ["DELETE", "templates"],
  CreateVolume: ["POST", "volumes"], GetVolume: ["GET", "volumes"], UpdateVolume: ["PUT", "volumes"], DeleteVolume: ["DELETE", "volumes"],
};
/** Only an authenticated, classified NotFound establishes absence. */
export function resourceAbsent(error: unknown): boolean {
  return record(error) && error.statusCode === 404 && typeof error.code === "string" && /NotFound|NotExist/.test(error.code);
}
export interface ExpressResourceApi {
  call(action: string, input?: {id?: string; query?: Dict; body?: Dict}): Promise<Dict>;
  team(configured?: string): Promise<string>;
  ready(kind: "template" | "volume", id: string, team: string, seconds: number): Promise<Dict>;
}
/** Region belongs to the template; the same client is used by that resource's volumes. */
export function expressResourceApi(credential: CredentialSnapshot, region: string): ExpressResourceApi {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(region)) throw new ApplicationError("Invalid template region.");
  const client = new sdk.default(new core.$OpenApiUtil.Config({regionId: region, endpoint: `sandbox.${region}.aliyuncs.com`, accessKeyId: credential.AccessKeyID,
    accessKeySecret: credential.AccessKeySecret, retryOptions: {retryable: false}, ...(credential.SecurityToken ? {securityToken: credential.SecurityToken} : {})}));
  const call: ExpressResourceApi["call"] = async (action, input = {}) => {
    const route = routes[action];
    if (!route) throw new ApplicationError("Unknown Express resource operation.");
    const [method, collection] = route;
    const result = await client.callApi(new core.$OpenApiUtil.Params({action, version: "2026-08-20", protocol: "HTTPS", pathname: `/pop/2026-08-20/${collection}${input.id ? `/${encodeURIComponent(input.id)}` : ""}`,
      method, authType: "AK", style: "ROA", reqBodyType: "json", bodyType: "json"}),
    new core.$OpenApiUtil.OpenApiRequest({query: input.query, body: input.body}),
    new dara.RuntimeOptions({autoretry: false, maxAttempts: 1, readTimeout: 30000, connectTimeout: 10000}));
    if (!record(result) || !record(result.body) || Number(result.statusCode) < 200 || Number(result.statusCode) >= 300) throw new ApplicationError(`Express ${action} returned an invalid response.`);
    const code = result.body.code;
    if (code !== undefined && !["200", "201", "202", "204", "Success", "success", "OK"].includes(String(code))) throw new ApplicationError(`Express ${action} failed; inspect the resource before retrying.`);
    return result.body;
  };
  return {call,
    async team(configured) {
      if (configured) return configured;
      const body = await call("ListTeams", {query: {pageNumber: 1, pageSize: 2}});
      const teams = Array.isArray(body.teams) ? body.teams.filter(record) : [];
      if (teams.length !== 1 || Number(body.total ?? teams.length) !== 1 || typeof teams[0].teamID !== "string") throw new ApplicationError("Select the existing Team in abx configuration; the account does not have one unambiguous Team.");
      return teams[0].teamID;
    },
    async ready(kind, id, team, seconds) {
      const end = Date.now() + seconds * 1000;
      do {
        const result = await call(kind === "template" ? "GetTemplate" : "GetVolume", {id, query: {teamID: team}});
        const value = kind === "volume" && record(result.volume) ? result.volume : result;
        const state = String(record(value.status) ? value.status.state : value.status).toLowerCase();
        if (state === "ready" || state === "available") return value;
        if (state === "error" || state === "failed") throw new ApplicationError(`Express ${kind} preparation failed; inspect its status and configured logs.`);
        if (!["pending", "building", "updating", "creating"].includes(state)) throw new ApplicationError(`Express ${kind} has an unrecognized preparation state.`);
        await delay(Math.min(2000, Math.max(0, end - Date.now())));
      } while (Date.now() < end);
      throw new ApplicationError(`Express ${kind} is still preparing after the deadline; its identity has been retained.`);
    },
  };
}
/** Omitted values stay omitted. Public build recipes never leak into the native buildConfig. */
export function templateRequest(template: Dict, name: string, teamID: string, inferredRegistry?: {registryType?: string; acrInstanceId?: string}): Dict {
  const runtime: Dict = {}, sandbox: Dict = {};
  for (const key of ["cpu", "memorySize", "diskSize", "internetAccess", "logConfig", "vpcConfig"]) if (Object.hasOwn(template, key)) runtime[key] = template[key];
  for (const key of ["image", "generation", "registryConfig", "startCommand", "readyCommand"]) if (Object.hasOwn(template, key)) sandbox[key] = template[key];
  if (inferredRegistry?.registryType) sandbox.registryType = inferredRegistry.registryType;
  if (inferredRegistry?.acrInstanceId) sandbox.acrInstanceId = inferredRegistry.acrInstanceId;
  if (record(template.buildConfig) && Object.hasOwn(template.buildConfig, "steps")) sandbox.steps = template.buildConfig.steps;
  runtime.sandboxConfig = sandbox;
  return {name, teamID, runtimeConfig: runtime, ...(template.resourceTags !== undefined ? {resourceTags: template.resourceTags} : {})};
}

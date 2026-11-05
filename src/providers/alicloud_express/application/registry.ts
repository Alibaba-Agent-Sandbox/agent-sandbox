/** Personal ACR ROA API, signed by the official OpenAPI client with explicit identity. */
import { createRequire } from "node:module";
import { ApplicationError, record } from "../../../application/config.js";
import type { CredentialSnapshot } from "../../../application/bindings.js";
import type { OwnedServerImage } from "../../../application/types.js";

const require = createRequire(import.meta.url);
interface Models { Config: new (value: unknown) => unknown; Params: new (value: unknown) => unknown; OpenApiRequest: new (value: unknown) => unknown }
const core = require("@alicloud/openapi-core") as { default: new (value: unknown) => { callApi(params: unknown, request: unknown, runtime: unknown): Promise<Record<string, unknown>> }; $OpenApiUtil: Models };
const dara = require("@darabonba/typescript") as { RuntimeOptions: new (value: unknown) => unknown };
export interface RegistryClient {
  token(): Promise<{ username: string; password: string }>;
  inspect(namespace: string, repository: string, tag: string, timeoutSeconds?: number): Promise<{ digest: string; imageId: string } | null>;
  remove(image: OwnedServerImage): Promise<void>;
}
/** GET/DELETE paths match the official CR20160607 SDK; use JSON body projection to retain native fields. */
export function createRegistryClient(credential: CredentialSnapshot, region: string): RegistryClient {
  const client = new core.default(new core.$OpenApiUtil.Config({ accessKeyId: credential.AccessKeyID, accessKeySecret: credential.AccessKeySecret,
    ...(credential.SecurityToken ? { securityToken: credential.SecurityToken } : {}), endpoint: `cr.${region}.aliyuncs.com`, protocol: "https" }));
  const call = async (action: string, method: string, pathname: string, query: Record<string, string> = {}, timeoutMs = 30000): Promise<Record<string, unknown>> => {
    const response = await client.callApi(new core.$OpenApiUtil.Params({ action, version: "2016-06-07", protocol: "HTTPS", pathname, method, authType: "AK", style: "ROA", reqBodyType: "json", bodyType: method === "GET" ? "json" : "none" }),
      new core.$OpenApiUtil.OpenApiRequest({ headers: {}, query }), new dara.RuntimeOptions({ autoretry: false, maxAttempts: 1, readTimeout: timeoutMs, connectTimeout: Math.min(10000, timeoutMs) }));
    if (method !== "GET") return {};
    if (!record(response.body) || !record(response.body.data)) throw new ApplicationError("ACR returned an incomplete native resource response.");
    return response.body.data;
  };
  const inspect: RegistryClient["inspect"] = async (namespace, repository, tag, timeoutSeconds = 30) => {
    const deadline = Date.now() + timeoutSeconds * 1000;
    try {
      for (let page = 1; page <= 1000; page++) {
        const remaining = Math.floor(deadline - Date.now()); if (remaining <= 0) throw new ApplicationError("ACR inspection exceeded its deadline.");
        const data = await call("GetRepoTags", "GET", `/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repository)}/tags`, { Page: String(page), PageSize: "100" }, remaining);
        const tags = data.tags;
        if (!Array.isArray(tags) || !Number.isInteger(data.total) || Number(data.total) < 0) throw new ApplicationError("ACR tag inspection returned an incomplete bounded list.");
        const match = tags.find(item => record(item) && item.tag === tag);
        if (record(match)) {
          const native = (value: unknown): string => { if (value === undefined || value === null || value === "") return ""; if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(String(value))) throw new ApplicationError("ACR returned an invalid immutable image identity."); return String(value).replace(/^sha256:/, ""); };
          const remoteDigest = native(match.digest); return { digest: remoteDigest ? `sha256:${remoteDigest}` : "", imageId: native(match.imageId) };
        }
        if (page * 100 >= Number(data.total)) return null;
      }
      throw new ApplicationError("ACR tag inspection exceeded its bounded page budget.");
    } catch (error) {
      if (record(error) && error.statusCode === 404 && ["REPO_NOT_EXIST", "REPO_TAG_NOT_EXIST"].includes(String(error.code))) return null;
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError("ACR inspection failed; image absence was not established.");
    }
  };
  return { inspect,
    async token() { try { const value = await call("GetAuthorizationToken", "GET", "/tokens"); if (typeof value.authorizationToken !== "string" || typeof value.tempUserName !== "string") throw new Error(); return { username: value.tempUserName, password: value.authorizationToken }; } catch { throw new ApplicationError("ACR temporary registry authentication could not be resolved for the selected identity."); } },
    async remove(image) {
      if (image.accountId !== credential.AccountID || image.region !== region || image.state !== "confirmed" || !image.digest) throw new ApplicationError("ACR cleanup requires a confirmed owned image for this account and region.");
      const current = await inspect(image.namespace, image.repository, image.tag); if (!current) return;
      if (current.digest !== image.digest || current.imageId !== image.localImageId?.replace(/^sha256:/, "")) throw new ApplicationError("ACR tag identity changed; refusing to delete a replacement.");
      try { await call("DeleteImage", "DELETE", `/repos/${encodeURIComponent(image.namespace)}/${encodeURIComponent(image.repository)}/tags/${encodeURIComponent(image.tag)}`); }
      catch { throw new ApplicationError("Owned ACR tag deletion is unconfirmed."); }
      if (await inspect(image.namespace, image.repository, image.tag)) throw new ApplicationError("Owned ACR tag remains visible after deletion.");
    } };
}

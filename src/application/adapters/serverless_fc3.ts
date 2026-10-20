/** Typed FC inspection with exactly the same credential snapshot used by Serverless Devs. */
import { createRequire } from "node:module";
import { ApplicationError } from "../config.js";

/** Raw function configuration is sensitive; callers must persist only an allowlisted receipt. */
export interface FcInspector {
  accountId: string;
  describeFunction(region: string, name: string): Promise<Record<string, unknown> | null>;
  /** Atomically create a new function; an existing name is never updated or adopted. */
  createFunction(region: string, props: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Child-process environment only: never print or persist the returned credential snapshot. */
  serverlessEnvironment(): NodeJS.ProcessEnv;
}
interface CredentialResult { credential: Record<string, string> }
interface CredentialReader { get(access: string): Promise<CredentialResult> }
interface FcResponse { statusCode?: number; body?: Record<string, unknown> }
interface FcClient {
  getFunction(name: string, request: unknown): Promise<FcResponse>;
  createFunction(request: unknown): Promise<FcResponse>;
}
interface OfficialSdk {
  createClient(config: Record<string, unknown>): FcClient;
  request(): unknown;
  createRequest(props: Record<string, unknown>): unknown;
}
const require = createRequire(import.meta.url);
const silentLogger = { debug: (): void => {}, info: (): void => {}, warn: (): void => {}, error: (): void => {}, log: (): void => {} };
const snapshotAlias = "abx_application_serverless_devs_key";

/** Test seams keep secret resolution and official SDK transport independently observable. */
export const fcInspectSeams: { credentials(): CredentialReader; sdk(): OfficialSdk } = {
  credentials: () => {
    const loaded = require("@serverless-devs/credential") as { default: new (input: { logger: typeof silentLogger }) => CredentialReader };
    return new loaded.default({ logger: silentLogger });
  },
  sdk: () => {
    const loaded = require("@alicloud/fc20230330") as {
      default: new (config: unknown) => FcClient;
      GetFunctionRequest: new (input: { qualifier: string }) => unknown;
      CreateFunctionRequest: new (input: { body: unknown }) => unknown;
      CreateFunctionInput: new (input: Record<string, unknown>) => unknown;
    };
    const core = require("@alicloud/openapi-core") as { $OpenApiUtil: { Config: new (input: Record<string, unknown>) => unknown } };
    return {
      createClient: input => new loaded.default(new core.$OpenApiUtil.Config(input)),
      request: () => new loaded.GetFunctionRequest({ qualifier: "LATEST" }),
      createRequest: props => {
        const allowed = new Set(["functionName", "runtime", "customContainerConfig", "role", "description", "timeout", "memorySize", "cpu", "diskSize", "environmentVariables", "internetAccess", "vpcConfig", "logConfig", "instanceConcurrency"]);
        const auxiliary = new Set(["region", "triggers", "asyncInvokeConfig"]);
        if (Object.keys(props).some(key => !allowed.has(key) && !auxiliary.has(key))) throw new ApplicationError("Function configuration contains unsupported deployment-only fields.");
        const native = Object.fromEntries(Object.entries(props).filter(([key]) => allowed.has(key)));
        return new loaded.CreateFunctionRequest({ body: new loaded.CreateFunctionInput(native) });
      },
    };
  },
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validIdentifiers(region: string, name: unknown): name is string {
  return /^[a-z][a-z0-9-]{1,63}$/.test(region) && typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name);
}
function identity(body: unknown, accountId: string, region: string, name: string): Record<string, unknown> {
  if (!record(body) || body.functionName !== name || typeof body.functionId !== "string" || !body.functionId || typeof body.functionArn !== "string") throw new Error("Malformed native response");
  const arn = /^acs:fc:([^:]+):(\d+):functions\/([^:]+)(?::LATEST)?$/.exec(body.functionArn);
  if (!arn || arn[1] !== region || arn[2] !== accountId || arn[3] !== name) throw new Error("Unexpected native identity");
  return body;
}

/** Resolve the explicit SD profile once; every later call uses its immutable AK/STS snapshot. */
export async function createFcInspector(accessRef: string): Promise<FcInspector> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accessRef)) throw new ApplicationError("An explicit Serverless Devs access reference is required.");
  let credentials: Record<string, string>;
  try {
    const result = await fcInspectSeams.credentials().get(accessRef);
    const input = result.credential;
    if (!record(input) || typeof input.AccountID !== "string" || !/^\d+$/.test(input.AccountID)
      || typeof input.AccessKeyID !== "string" || !input.AccessKeyID.trim()
      || typeof input.AccessKeySecret !== "string" || !input.AccessKeySecret.trim()
      || (input.SecurityToken !== undefined && (typeof input.SecurityToken !== "string" || !input.SecurityToken.trim()))) {
      throw new Error("Unsupported credential profile");
    }
    credentials = { AccountID: input.AccountID, AccessKeyID: input.AccessKeyID, AccessKeySecret: input.AccessKeySecret,
      ...(input.SecurityToken ? { SecurityToken: input.SecurityToken } : {}) };
  } catch {
    throw new ApplicationError("Could not resolve the Serverless Devs Alibaba Cloud access profile; credentials and parser output were withheld.");
  }
  const accountId = credentials.AccountID;
  // Official credential 0.0.10 reads this JSON environment alias after access.yaml.
  // Its top-level three-variable shortcut has priority over aliases and omits STS tokens.
  const environment = { ...process.env };
  for (const key of ["AccountID", "AccessKeyID", "AccessKeySecret", "SecurityToken", "core_load_serverless_devs_component"]) delete environment[key];
  environment[snapshotAlias] = JSON.stringify(credentials);
  environment.SERVERLESS_DEVS_CICD = "1";
  environment.serverless_devs_access_cicd_alias_name = snapshotAlias;
  const clients = new Map<string, FcClient>();
  const clientFor = (sdk: OfficialSdk, region: string): FcClient => {
    let client = clients.get(region);
    if (!client) {
      // Same official endpoints as fc3/src/resources/fc/impl/client.ts; custom endpoint overrides are unsupported.
      const endpoint = region === "cn-heyuan-acdr-1" ? `${accountId}.${region}-internal.fc.aliyuncs.com` : `fcv3.${region}.aliyuncs.com`;
      client = sdk.createClient({ accessKeyId: credentials.AccessKeyID, accessKeySecret: credentials.AccessKeySecret,
        ...(credentials.SecurityToken ? { securityToken: credentials.SecurityToken } : {}),
        endpoint, protocol: "https", readTimeout: 15000, connectTimeout: 10000 });
      clients.set(region, client);
    }
    return client;
  };
  return {
    accountId,
    serverlessEnvironment: () => ({ ...environment }),
    describeFunction: async (region, name) => {
      if (!validIdentifiers(region, name)) throw new ApplicationError("FC inspection requires literal region and function identifiers.");
      try {
        const sdk = fcInspectSeams.sdk();
        const response = await clientFor(sdk, region).getFunction(name, sdk.request());
        if (response.statusCode !== 200) throw new Error("Unexpected native status");
        return identity(response.body, accountId, region, name);
      } catch (error) {
        // A generic 404, error text, missing profile or denial must never establish absence.
        if (record(error) && error.statusCode === 404 && error.code === "FunctionNotFound") return null;
        throw new ApplicationError("FC function inspection failed or returned an unexpected identity; absence was not established. Sensitive response details were withheld.");
      }
    },
    createFunction: async (region, props) => {
      const name = props.functionName;
      if (!validIdentifiers(region, name)) throw new ApplicationError("FC creation requires literal region and function identifiers.");
      try {
        const sdk = fcInspectSeams.sdk();
        const request = sdk.createRequest(props);
        const response = await clientFor(sdk, region).createFunction(request);
        if (response.statusCode !== 200 && response.statusCode !== 201) throw new Error("Unexpected native status");
        const body = identity(response.body, accountId, region, name);
        if (typeof body.createdTime !== "string" || !body.createdTime) throw new Error("Missing native creation receipt");
        return body;
      } catch (error) {
        if (record(error) && error.statusCode === 409 && error.code === "FunctionAlreadyExists") throw new ApplicationError("FC function already exists; create-only deployment refused to overwrite it.");
        throw new ApplicationError("FC create-only request failed or its outcome is unconfirmed; inspect the saved operation before retrying. Sensitive details were withheld.");
      }
    },
  };
}

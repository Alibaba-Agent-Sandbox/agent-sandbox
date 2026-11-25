/** Local OpenAPI contracts. This module never resolves endpoints or credentials. */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema, ValidateFunction } from "ajv";
import { parseDocument } from "yaml";
import { digest } from "../application/config.js";
import { ProviderConfigError } from "../models/provider_errors.js";

type JsonObject = Record<string, unknown>;
export interface ApiContract { name: string; resource: string; port: number; digest: string; document: JsonObject }
export interface ApiParameter extends JsonObject { name: string; in: "path" | "query" | "header"; schema: unknown; required?: boolean }
export interface ApiOperation { operationId: string; method: string; path: string; definition: JsonObject; parameters: ApiParameter[] }
export interface SelectedApiOperation { api: ApiContract; operation: ApiOperation }
export type SecurityRequirement = Record<string, string[]>;
export interface SecurityScheme extends JsonObject { type: "http" | "apiKey"; scheme?: string; in?: "header"; name?: string }
export interface PreparedApiRequest {
  method: string; path: string; query: [string, string][]; headers: Record<string, string>; body?: unknown;
  security: SecurityRequirement[]; schemes: Record<string, SecurityScheme>;
}
export interface ApiOperationInput { body?: unknown; path?: string[]; query?: string[]; header?: string[] }

const MAX_BYTES = 1024 * 1024;
const MAX_NODES = 20000;
const METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch"]);
const RESERVED_HEADERS = /^(authorization|proxy-authorization|proxy-authenticate|host|cookie|set-cookie|accept|content-type|content-length|connection|transfer-encoding|keep-alive|trailer|te|upgrade|x-access-token|forwarded|x-forwarded-.*)$/i;
function fail(message: string): never { throw new ProviderConfigError(message); }
const own = (object: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(object, key);
function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(`${label} must be an object.`);
  return value as JsonObject;
}

function checkJson(value: unknown): void {
  let count = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): void {
    if (++count > MAX_NODES || depth > 48) fail("API contract or input exceeds the supported complexity limit.");
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object" || ancestors.has(item)) fail("API contract and input must be finite, acyclic JSON.");
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      fail("API contract and input must contain plain JSON objects.");
    ancestors.add(item);
    for (const [key, child] of Object.entries(item)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) fail("API contract or input contains an unsupported object key.");
      visit(child, depth + 1);
    }
    ancestors.delete(item);
  }
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_BYTES) fail("API contract or input exceeds 1 MiB.");
}

function readYaml(file: string): JsonObject {
  if (!statSync(file).isFile() || statSync(file).size > MAX_BYTES) fail("Registry and OpenAPI files must be regular files no larger than 1 MiB.");
  const document = parseDocument(readFileSync(file, "utf8"), { version: "1.2", uniqueKeys: true });
  if (document.errors.length || document.warnings.length) fail("Invalid YAML in Registry or OpenAPI file; duplicate keys and unsupported tags are not allowed.");
  let value: unknown;
  try { value = document.toJS({ maxAliasCount: 0 }); } catch { return fail("YAML aliases are not supported in API contracts."); }
  checkJson(value);
  return object(value, "Registry or OpenAPI document");
}

function pointer(document: JsonObject, ref: unknown): unknown {
  if (typeof ref !== "string" || !ref.startsWith("#/")) fail("Only internal OpenAPI JSON Pointer references are supported; bundle external references before binding.");
  let fragment: string;
  try { fragment = decodeURIComponent(ref.slice(1)); } catch { return fail("Invalid OpenAPI reference encoding."); }
  let value: unknown = document;
  for (let key of fragment.slice(1).split("/")) {
    if (/~(?:[^01]|$)/.test(key)) fail("Invalid OpenAPI JSON Pointer escape.");
    key = key.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!value || typeof value !== "object" || !own(value, key)) fail("OpenAPI reference does not exist.");
    value = (value as JsonObject)[key];
  }
  return value;
}

/** Resolve a non-Schema Reference Object without applying Schema merge semantics. */
function reference(value: unknown, document: JsonObject, label: string, stack = new Set<unknown>()): JsonObject {
  const result = object(value, label);
  if (!own(result, "$ref")) return result;
  if (stack.has(result)) fail("Recursive OpenAPI references are not supported.");
  if (Object.keys(result).some(key => !["$ref", "summary", "description"].includes(key))) fail(`${label} has unsupported Reference Object siblings.`);
  stack.add(result);
  const target = reference(pointer(document, result["$ref"]), document, label, stack);
  stack.delete(result);
  return { ...target, ...Object.fromEntries(Object.entries(result).filter(([key]) => key !== "$ref")) };
}

function scanReferences(document: JsonObject): void {
  let count = 0;
  const active = new Set<object>();
  const done = new Set<object>();
  function visit(value: unknown, map = false): void {
    if (!value || typeof value !== "object") return;
    if (active.has(value)) fail("Recursive OpenAPI references are not supported.");
    if (done.has(value)) return;
    if (++count > MAX_NODES) fail("OpenAPI references exceed the supported complexity limit.");
    active.add(value);
    if (!map && !Array.isArray(value) && own(value, "$ref")) visit(pointer(document, (value as JsonObject)["$ref"]));
    for (const [key, child] of Object.entries(value)) {
      if (!map && key.startsWith("x-abx-")) fail("This CLI does not yet support x-abx invocation extensions.");
      if (!map && ["example", "examples", "default", "enum", "const"].includes(key)) continue;
      visit(child, !map && ["properties", "patternProperties", "$defs", "dependentSchemas", "schemas", "securitySchemes", "parameters", "requestBodies", "paths", "content", "responses", "headers", "callbacks", "webhooks"].includes(key));
    }
    active.delete(value); done.add(value);
  }
  visit(document);
}

function schema(value: unknown, document: JsonObject, budget = { count: 0 }): unknown {
  if (++budget.count > MAX_NODES) fail("Expanded request schema exceeds the supported complexity limit.");
  if (typeof value === "boolean") return value;
  const source = object(value, "JSON Schema");
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(source)) {
    if (["$id", "$anchor", "$dynamicAnchor", "$dynamicRef", "$recursiveRef", "nullable", "format", "contentEncoding", "contentMediaType", "contentSchema"].includes(key))
      fail(`Request schema keyword '${key}' is not supported by this CLI.`);
    if (key === "$schema") {
      if (child !== "https://json-schema.org/draft/2020-12/schema" && child !== "https://spec.openapis.org/oas/3.1/dialect/base") fail("Unsupported request schema dialect.");
      continue;
    }
    if (key === "$ref") continue;
    if (["properties", "patternProperties", "$defs", "dependentSchemas"].includes(key))
      result[key] = Object.fromEntries(Object.entries(object(child, key)).map(([name, nested]) => [name, schema(nested, document, budget)]));
    else if (["allOf", "anyOf", "oneOf", "prefixItems"].includes(key)) {
      if (!Array.isArray(child)) fail(`${key} must be an array.`);
      result[key] = (child as unknown[]).map(nested => schema(nested, document, budget));
    } else if (["items", "contains", "additionalProperties", "unevaluatedProperties", "unevaluatedItems", "propertyNames", "not", "if", "then", "else"].includes(key))
      result[key] = schema(child, document, budget);
    else result[key] = child;
  }
  if (own(source, "$ref")) return { allOf: [schema(pointer(document, source["$ref"]), document, budget), result] };
  return result;
}

function compile(definition: unknown, document: JsonObject, label: string): ValidateFunction {
  const ajv = new Ajv2020({ strict: true, strictTypes: false, strictTuples: false, strictRequired: false,
    coerceTypes: false, useDefaults: false, removeAdditional: false, ownProperties: true, addUsedSchema: false });
  for (const keyword of ["example", "externalDocs", "xml"]) ajv.addKeyword({ keyword, valid: true });
  try { return ajv.compile(schema(definition, document) as AnySchema); }
  catch (error) { if (error instanceof ProviderConfigError) throw error; return fail(`${label} uses an invalid or unsupported JSON Schema.`); }
}
function validate(value: unknown, valid: ValidateFunction, label: string): void {
  if (!valid(value)) fail(`${label} does not match its JSON Schema (${valid.errors?.[0]?.keyword ?? "validation"}).`);
}

function parameters(pathItem: JsonObject, operation: JsonObject, document: JsonObject): ApiParameter[] {
  const result = new Map<string, ApiParameter>();
  for (const source of [pathItem["parameters"], operation["parameters"]]) {
    if (source === undefined) continue;
    if (!Array.isArray(source)) fail("OpenAPI parameters must be arrays.");
    const keys = new Set<string>();
    for (const raw of source as unknown[]) {
      const param = reference(raw, document, "OpenAPI parameter");
      if (typeof param["name"] !== "string" || !param["name"] || !["path", "query", "header"].includes(String(param["in"])))
        fail("Only named path, query and header parameters are supported.");
      const name = param["in"] === "header" ? param["name"].toLowerCase() : param["name"];
      const key = `${param["in"]}:${name}`;
      if (keys.has(key)) fail("Duplicate OpenAPI parameter.");
      keys.add(key); result.set(key, param as ApiParameter);
    }
  }
  return [...result.values()];
}

function operations(api: ApiContract): ApiOperation[] {
  const document = api.document;
  if (typeof document["openapi"] !== "string" || !/^3\.1\.\d+$/.test(document["openapi"])) fail("Sandbox API binding currently supports OpenAPI 3.1 only.");
  const paths = object(document["paths"], "OpenAPI paths");
  const result: ApiOperation[] = [];
  const ids = new Set<string>();
  for (const [path, rawItem] of Object.entries(paths)) {
    if (path.startsWith("x-")) continue;
    if (!path.startsWith("/") || path.startsWith("//") || /[?#\\\x00-\x20]/.test(path)) fail("OpenAPI operation path must be a relative HTTP path.");
    const item = reference(rawItem, document, "OpenAPI path item");
    for (const [method, rawOperation] of Object.entries(item)) {
      if (method === "trace") fail("TRACE operations are not supported.");
      if (!METHODS.has(method)) continue;
      const definition = object(rawOperation, "OpenAPI operation");
      const id = definition["operationId"];
      if (id === undefined) continue;
      if (typeof id !== "string" || !id || /[\s\x00-\x1f]/.test(id) || id.startsWith("-")) fail("Callable operations need a nonempty operationId without whitespace or a leading '-'.");
      if (ids.has(id)) fail("OpenAPI operationId must be unique within an API.");
      ids.add(id); result.push({ operationId: id, method: method.toUpperCase(), path, definition, parameters: parameters(item, definition, document) });
    }
  }
  return result;
}

/** Import package-local OpenAPI files; the resulting documents are self-contained. */
export function loadRegistryApis(file: string): ApiContract[] {
  const registryFile = realpathSync(file);
  const base = dirname(registryFile);
  const registry = readYaml(registryFile);
  const entries = object(registry["apis"], "registry.apis");
  if (Object.keys(entries).length === 0 || Object.keys(entries).length > 32) fail("registry.apis must contain between 1 and 32 APIs.");
  return Object.entries(entries).map(([name, raw]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) fail("API names must start with a letter and contain letters, digits, '_' or '-'.");
    const entry = object(raw, "Registry API entry");
    if (Object.keys(entry).some(key => !["resource", "port", "openapi"].includes(key))) fail("Registry API entries support resource, port and openapi only.");
    if (typeof entry["resource"] !== "string" || !/^sandbox\.[A-Za-z][A-Za-z0-9_-]*$/.test(entry["resource"])) fail("API binding requires a sandbox.NAME resource.");
    if (!Number.isSafeInteger(entry["port"]) || Number(entry["port"]) < 1 || Number(entry["port"]) > 65535) fail("Registry API port must be an integer between 1 and 65535.");
    if (typeof entry["openapi"] !== "string" || isAbsolute(entry["openapi"]) || /^[a-z][a-z0-9+.-]*:/i.test(entry["openapi"])) fail("Registry OpenAPI must reference a package-local file.");
    const source = realpathSync(resolve(base, entry["openapi"]));
    const path = relative(base, source);
    if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) fail("Registry OpenAPI file escapes its package directory.");
    const document = readYaml(source);
    scanReferences(document);
    const api: ApiContract = { name, resource: entry["resource"], port: Number(entry["port"]), digest: digest(document), document };
    if (operations(api).length === 0) fail("OpenAPI document has no callable operationId.");
    return api;
  });
}

/** Select one operation without reading local configuration or accessing the target. */
export function selectApiOperation(apis: ApiContract[], operationId: string, apiName?: string): SelectedApiOperation {
  const candidates = apis.filter(api => apiName === undefined || api.name === apiName);
  if (candidates.length === 0) fail("The selected API is not bound to this Sandbox.");
  const matches = candidates.flatMap(api => operations(api).filter(operation => operation.operationId === operationId).map(operation => ({ api, operation })));
  if (matches.length === 0) fail("Unknown API operation; use target --help to inspect its bound contract.");
  if (matches.length > 1) fail("Operation exists in multiple APIs; select one with --api.");
  return matches[0];
}
/** Cached, public operation metadata for offline help. */
export function describeApiOperations(apis: ApiContract[]): JsonObject[] {
  return apis.flatMap(api => operations(api).map(operation => ({ api: api.name, operationId: operation.operationId,
    method: operation.method, path: operation.path, summary: operation.definition["summary"], description: operation.definition["description"] })));
}
/** Include examples and response documentation without evaluating any parameter source. */
export function describeApiOperation(selected: SelectedApiOperation): JsonObject {
  const { api, operation } = selected;
  return { api: api.name, operationId: operation.operationId, method: operation.method, path: operation.path,
    ...operation.definition, parameters: operation.parameters, security: effectiveSecurity(selected),
    openapi: api.document["openapi"],
    ...(api.document["components"] !== undefined ? { components: api.document["components"] } : {}) };
}
function effectiveSecurity({ api, operation }: SelectedApiOperation): unknown {
  return own(operation.definition, "security") ? operation.definition["security"] : own(api.document, "security") ? api.document["security"] : [];
}
function auth(selected: SelectedApiOperation): { security: SecurityRequirement[]; schemes: Record<string, SecurityScheme> } {
  const { api } = selected;
  const requirements = effectiveSecurity(selected);
  if (!Array.isArray(requirements) || requirements.length > 16) fail("OpenAPI security must be an array with at most 16 alternatives.");
  const components = api.document["components"] === undefined ? {} : object(api.document["components"], "OpenAPI components");
  const definitions = components["securitySchemes"] === undefined ? {} : object(components["securitySchemes"], "OpenAPI securitySchemes");
  const schemes: Record<string, SecurityScheme> = {};
  for (const raw of requirements as unknown[]) {
    const requirement = object(raw, "OpenAPI security requirement");
    const occupied = new Set<string>();
    for (const [name, scopes] of Object.entries(requirement)) {
      if (!Array.isArray(scopes) || scopes.length !== 0) fail("Bearer and apiKey requirements must use an empty scopes array.");
      const definition = reference(definitions[name], api.document, "OpenAPI security scheme");
      let header: string;
      if (definition["type"] === "http" && typeof definition["scheme"] === "string" && definition["scheme"].toLowerCase() === "bearer") header = "authorization";
      else if (definition["type"] === "apiKey" && definition["in"] === "header" && typeof definition["name"] === "string" && /^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/.test(definition["name"])) {
        header = definition["name"].toLowerCase();
        if (RESERVED_HEADERS.test(header) && header !== "x-access-token") fail("API key uses a reserved authentication or transport header.");
      } else return fail("This CLI supports HTTP bearer and header apiKey authentication only.");
      if (occupied.has(header)) fail("Authentication schemes compete for the same request header.");
      occupied.add(header); schemes[name] = definition as SecurityScheme;
    }
  }
  return { security: requirements as SecurityRequirement[], schemes };
}
/** Supported schemes referenced by callable operations, including internal references. */
export function apiSecuritySchemes(api: ApiContract): Record<string, SecurityScheme> {
  return Object.assign({}, ...operations(api).map(operation => auth({ api, operation }).schemes));
}
function pairs(values: string[] | undefined, location: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const pair of values ?? []) {
    const separator = pair.indexOf("=");
    if (separator < 1) fail(`--${location} requires NAME=VALUE.`);
    const name = location === "header" ? pair.slice(0, separator).toLowerCase() : pair.slice(0, separator);
    if (result.has(name)) fail(`Duplicate --${location} parameter.`);
    result.set(name, pair.slice(separator + 1));
  }
  return result;
}
function scalarType(definition: unknown): string {
  const value = object(definition, "Parameter schema");
  if (typeof value["type"] === "string" && ["string", "number", "integer", "boolean"].includes(value["type"])) return value["type"];
  if (Array.isArray(value["allOf"])) {
    const types = value["allOf"].flatMap(child => {
      const nested = object(child, "Parameter schema");
      return nested["type"] !== undefined || nested["allOf"] !== undefined ? [scalarType(nested)] : [];
    });
    if (types.length && new Set(types).size === 1) return types[0];
  }
  return fail("Parameters require a single string, number, integer or boolean schema type; arrays and objects are not yet supported.");
}

/** Validate and serialize one JSON operation before the caller connects to a Sandbox. */
export function prepareApiOperation(selected: SelectedApiOperation, input: ApiOperationInput): PreparedApiRequest {
  const { api, operation } = selected;
  checkJson(api.document); scanReferences(api.document);
  const authentication = auth(selected);
  const supplied = { path: pairs(input.path, "path"), query: pairs(input.query, "query"), header: pairs(input.header, "header") };
  const request: PreparedApiRequest = { method: operation.method, path: operation.path, query: [], headers: {}, ...authentication };
  const placeholders = [...operation.path.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]);
  if (new Set(placeholders).size !== placeholders.length || /[{}]/.test(operation.path.replace(/\{[^{}]+\}/g, ""))) fail("Invalid or repeated path parameter placeholder.");
  const authHeaders = new Set(Object.values(authentication.schemes).map(s => s.type === "http" ? "authorization" : s.name!.toLowerCase()));
  for (const param of operation.parameters) {
    const name = param.in === "header" ? param.name.toLowerCase() : param.name;
    const defaultStyle = param.in === "query" ? "form" : "simple";
    for (const field of ["required", "explode", "allowReserved", "allowEmptyValue"]) {
      if (param[field] !== undefined && typeof param[field] !== "boolean") fail(`Parameter ${field} must be boolean.`);
    }
    if (param["content"] !== undefined || param["schema"] === undefined || (param["style"] !== undefined && param["style"] !== defaultStyle) || param["allowReserved"] === true || param["allowEmptyValue"] === true)
      fail("Unsupported parameter serialization; use scalar form query or simple path/header schemas.");
    if (param.in === "header" && (!/^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/.test(param.name) || RESERVED_HEADERS.test(name) || authHeaders.has(name))) fail("Ordinary parameters cannot override authentication or transport headers.");
    if (param.in === "path" && (param.required !== true || !placeholders.includes(param.name))) fail("Path parameters must be required and appear in the path template.");
    const normalized = schema(param.schema, api.document);
    const type = scalarType(normalized);
    const validator = compile(normalized, api.document, `${param.in} parameter`);
    let value: unknown;
    if (supplied[param.in].has(name)) {
      const raw = supplied[param.in].get(name)!; supplied[param.in].delete(name);
      if (type === "string") value = raw;
      else if (type === "boolean") {
        if (!["true", "false"].includes(raw)) fail("Boolean parameters must be true or false.");
        value = raw === "true";
      } else {
        if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) fail("Numeric parameters must be JSON numbers.");
        value = Number(raw);
      }
    } else if (param.required === true) fail(`Missing required ${param.in} parameter '${param.name}'.`);
    else continue;
    checkJson(value); validate(value, validator, `${param.in} parameter`);
    const serialized = String(value);
    if (param.in === "path") {
      if (!serialized || serialized === "." || serialized === ".." || /[/\\%\x00-\x1f\x7f]/.test(serialized)) fail("Path parameter escapes its Sandbox binding.");
      request.path = request.path.replace(`{${param.name}}`, encodeURIComponent(serialized));
    } else if (param.in === "query") request.query.push([param.name, serialized]);
    else {
      if (/[\x00-\x1f\x7f]/.test(serialized)) fail("Header parameter contains control characters.");
      request.headers[param.name] = serialized;
    }
  }
  if (Object.values(supplied).some(values => values.size > 0)) fail("An input parameter is not declared by the selected operation.");
  if (/[{}]/.test(request.path) || request.path.split("/").some(part => part === "." || part === "..") || /\/\/|%(?:2e|2f|5c|25)/i.test(request.path)) fail("Operation path escapes its Sandbox binding or has an undeclared path parameter.");
  const rawBody = operation.definition["requestBody"];
  if (rawBody !== undefined) {
    const body = reference(rawBody, api.document, "OpenAPI requestBody");
    if (body["required"] !== undefined && typeof body["required"] !== "boolean") fail("Request body required must be boolean.");
    const content = object(body["content"], "requestBody.content");
    if (!own(content, "application/json")) fail("Only application/json request bodies are supported.");
    const media = object(content["application/json"], "JSON request body");
    if (media["encoding"] !== undefined) fail("Request body encoding overrides are not supported.");
    if (media["schema"] === undefined) fail("JSON request bodies require a schema.");
    const validator = compile(media["schema"], api.document, "Request body");
    if (input.body === undefined) {
      if (body["required"] === true) fail("This operation requires --body JSON or @FILE.");
    } else {
      if (operation.method === "GET" || operation.method === "HEAD") fail("GET and HEAD request bodies are not supported.");
      checkJson(input.body); validate(input.body, validator, "Request body"); request.body = input.body;
    }
  } else if (input.body !== undefined) fail("The selected operation does not declare a request body.");
  return request;
}

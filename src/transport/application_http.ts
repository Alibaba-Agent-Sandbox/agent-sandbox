/** Bound application HTTP requests. Control-plane and envd clients are never reused. */
import { ProviderConfigError } from "../models/provider_errors.js";
import type { ApplicationEndpoint } from "../protocol/port_contract.js";

const hasControl = (value: string): boolean => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

export const applicationHttpSeams = { fetch: globalThis.fetch };
export interface ApplicationResponse { is_success: boolean; status_code: number; text: string; json(): any }

/** Validate the adapter's binding before any credential can be sent. */
export function validateApplicationEndpoint(endpoint: ApplicationEndpoint, sandboxId: string, port: number): ApplicationEndpoint {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || endpoint.sandbox_id !== sandboxId || endpoint.port !== port ||
      endpoint.authentication_audience !== "gateway" || !["prefix", "operation-signed"].includes(endpoint.path_mode))
    throw new ProviderConfigError("Application endpoint does not match the selected sandbox and port.");
  if (typeof endpoint.url !== "string" || hasControl(endpoint.url)) throw new ProviderConfigError("Application endpoint contains control characters.");
  let url: URL;
  try { url = new URL(endpoint.url); } catch { throw new ProviderConfigError("Invalid application endpoint."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new ProviderConfigError("Application endpoint must be HTTP(S) without user information or a fragment.");
  if (endpoint.expires_at !== undefined && (!Number.isFinite(Date.parse(endpoint.expires_at)) || Date.parse(endpoint.expires_at) <= Date.now()))
    throw new ProviderConfigError("Application endpoint expired; resolve the same binding again.");
  for (const [name, value] of Object.entries(endpoint.headers)) {
    if (!/^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/.test(name) || /[\r\n]/.test(value) || /^(host|cookie|x-api-key|proxy-authorization)$/i.test(name))
      throw new ProviderConfigError("Invalid application gateway headers.");
  }
  return endpoint;
}

/** Append a protocol-owned operation path without losing proxy scope or signed query. */
export function applicationOperationUrl(endpoint: ApplicationEndpoint, operationPath: string): string {
  validateApplicationEndpoint(endpoint, endpoint.sandbox_id, endpoint.port);
  if (endpoint.path_mode !== "prefix") throw new ProviderConfigError("This endpoint requires adapter-signed operation requests.");
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(operationPath); } catch { throw new ProviderConfigError("Application operation path has invalid encoding."); }
  if (hasControl(operationPath) || hasControl(decodedPath)) throw new ProviderConfigError("Application operation path escapes its binding.");
  if (!operationPath.startsWith("/") || operationPath.startsWith("//") || /[?#\\]/.test(operationPath) ||
      operationPath.split("/").slice(1).some(part => !part || part === "." || part === ".." || /%(?:2e|2f|5c|25)/i.test(part)))
    throw new ProviderConfigError("Application operation path escapes its binding.");
  const url = new URL(endpoint.url);
  // Reject ambiguous provider prefixes rather than normalizing them into another sandbox binding.
  if (hasControl(decodeURIComponent(url.pathname)) || /\\|\/\/|%(?:2e|2f|5c|25)/i.test(url.pathname)) throw new ProviderConfigError("Ambiguous application proxy prefix.");
  url.pathname = url.pathname.replace(/\/$/, "") + operationPath;
  return url.href;
}

/** Send exactly once. Redirects, anonymous retries and non-idempotent replay are forbidden. */
export async function requestApplication(endpoint: ApplicationEndpoint, operationPath: string, options: {
  method: "GET" | "POST"; json?: unknown; application_token?: string; timeout?: number;
}): Promise<ApplicationResponse> {
  const url = applicationOperationUrl(endpoint, operationPath);
  const headers: Record<string, string> = { ...endpoint.headers };
  if (options.application_token !== undefined) {
    if (!options.application_token || /[\r\n]/.test(options.application_token) || Object.keys(headers).some(k => k.toLowerCase() === "authorization"))
      throw new ProviderConfigError("Application and gateway authentication must have separate audiences.");
    headers["Authorization"] = `Bearer ${options.application_token}`;
    // Some server proxies strip Authorization. Use the server's existing token
    // header too, unless that name is already occupied by the gateway.
    if (!Object.keys(headers).some(name => name.toLowerCase() === "x-access-token"))
      headers["X-Access-Token"] = options.application_token;
  }
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await applicationHttpSeams.fetch(url, { method: options.method, headers,
      body: options.json === undefined ? undefined : JSON.stringify(options.json), redirect: "manual",
      signal: AbortSignal.timeout((options.timeout ?? 30) * 1000) });
  } catch { throw new ProviderConfigError("Application request failed on the selected sandbox binding; no alternate path was attempted."); }
  if (response.status >= 300 && response.status < 400) throw new ProviderConfigError("Application redirects are not allowed.");
  const text = await response.text();
  return { is_success: response.ok, status_code: response.status, text, json: () => JSON.parse(text) };
}

/** Check the selected application's v2 protocol and identity before sending an operation. */
export async function requireApplicationOperation(endpoint: ApplicationEndpoint, operation: "list_commands" | "run_command" | "health", application_token?: string): Promise<void> {
  const response = await requestApplication(endpoint, "/capabilities", { method: "GET", application_token });
  if (!response.is_success) throw new ProviderConfigError(`Application protocol discovery failed (HTTP ${response.status_code}).`);
  let document: unknown;
  try { document = response.json(); } catch { throw new ProviderConfigError("Invalid application protocol discovery."); }
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new ProviderConfigError("Invalid application protocol discovery.");
  const value = document as Record<string, unknown>;
  if (value["api_version"] !== 2 || !value["endpoints"] || typeof value["endpoints"] !== "object" || Array.isArray(value["endpoints"]))
    throw new ProviderConfigError("Application requires protocol version 2 and an endpoint map.");
  const rule = (value["endpoints"] as Record<string, unknown>)[operation];
  if (!rule || typeof rule !== "object" || Array.isArray(rule) || (rule as Record<string, unknown>)["enabled"] !== true || (rule as Record<string, unknown>)["allowed"] !== true)
    throw new ProviderConfigError(`Application endpoint '${operation}' is unavailable to the selected identity.`);
}

/** Probe the protocol's health operation without requiring named-command authorization. */
export async function checkApplicationHealth(endpoint: ApplicationEndpoint, application_token?: string): Promise<void> {
  const response = await requestApplication(endpoint, "/health", {method: "GET", application_token});
  let document: unknown;
  try { document = response.json(); } catch { throw new ProviderConfigError("Invalid application health response."); }
  if (!response.is_success || !document || typeof document !== "object" || Array.isArray(document) || (document as Record<string, unknown>)["status"] !== "ok")
    throw new ProviderConfigError("Application health check failed.");
}

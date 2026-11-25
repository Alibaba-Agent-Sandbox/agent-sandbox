/** One bounded HTTP request to an already verified Provider application endpoint. */
import type { ApplicationEndpoint } from "../protocol/port_contract.js";
import { ProviderConfigError } from "../models/provider_errors.js";
import { applicationOperationUrl } from "./application_http.js";

export const openApiHttpSeams = { fetch: globalThis.fetch };
export interface OpenApiRequest { method: string; path: string; query: [string, string][]; headers: Record<string, string>; body?: unknown }
export interface OpenApiResponse { status: number; body: unknown; bytes?: Uint8Array }

export async function requestOpenApi(endpoint: ApplicationEndpoint, request: OpenApiRequest, timeout = 30, outputBytes = false): Promise<OpenApiResponse> {
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 300) throw new ProviderConfigError("Request timeout must be greater than zero and at most 300 seconds.");
  // Existing scope validation forbids path escapes; / is the one valid empty operation path.
  const url = new URL(applicationOperationUrl(endpoint, request.path === "/" ? "/__abx_root__" : request.path));
  if (request.path === "/") url.pathname = url.pathname.slice(0, -"__abx_root__".length);
  const names = new Set(url.searchParams.keys());
  const appended = new URLSearchParams();
  for (const [name, value] of request.query) {
    if (names.has(name)) throw new ProviderConfigError("An API parameter conflicts with the Provider endpoint query.");
    names.add(name); appended.append(name, value);
  }
  // Mutating searchParams would re-encode the Provider's existing signed bytes.
  if (request.query.length) url.search = `${url.search}${url.search ? "&" : "?"}${appended}`;
  const headers = new Headers(endpoint.headers);
  for (const [name, value] of Object.entries(request.headers)) {
    if (headers.has(name) || /^(host|cookie|proxy-authorization|content-length|transfer-encoding|connection)$/i.test(name) || /[\r\n]/.test(value))
      throw new ProviderConfigError("An application header conflicts with the Provider endpoint or HTTP transport.");
    headers.set(name, value);
  }
  let body: string | undefined;
  if (request.body !== undefined) {
    body = JSON.stringify(request.body);
    if (Buffer.byteLength(body) > 1024 * 1024) throw new ProviderConfigError("JSON request exceeds 1 MiB.");
    if (headers.has("content-type")) throw new ProviderConfigError("Content-Type is set by the declared JSON request body.");
    headers.set("content-type", "application/json");
  }
  try {
    const response = await openApiHttpSeams.fetch(url, { method: request.method, headers, body, redirect: "manual", signal: AbortSignal.timeout(Math.ceil(timeout * 1000)) });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new ProviderConfigError("Application redirects are not allowed.");
    }
    if (/^(text\/event-stream|multipart\/)/i.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel();
      throw new ProviderConfigError("Streaming and multipart responses are not supported by this command.");
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new ProviderConfigError("Application response exceeds 8 MiB."); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    // Saving is an explicit caller action. Never decode successful download bytes.
    if (outputBytes && response.status >= 200 && response.status < 300) return { status: response.status, body: null, bytes };
    const media = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const json = media === "application/json" || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(media);
    if (bytes.length && media && !json && !media.startsWith("text/")) {
      if (response.status < 200 || response.status >= 300) return { status: response.status, body: { error: "non_text_response", content_type: media, bytes: bytes.length } };
      throw new ProviderConfigError("Application returned binary content. For future calls, use --output FILE to save the original bytes. This request may already have changed the service; do not repeat it blindly.");
    }
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new ProviderConfigError("Application response is not valid UTF-8. For future calls, use --output FILE to save original bytes. This request may already have changed the service; do not repeat it blindly."); }
    let value: unknown = text;
    if (!text) value = null;
    else if (json) {
      try { value = JSON.parse(text); } catch { throw new ProviderConfigError("Application returned invalid JSON."); }
    }
    return { status: response.status, body: value };
  } catch (error) {
    if (error instanceof ProviderConfigError) throw error;
    throw new ProviderConfigError("Application request failed or timed out. No retry or alternate endpoint was attempted.");
  }
}

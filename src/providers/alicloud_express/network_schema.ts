/** Express network inputs; caller-visible names remain snake_case, wire names are explicit. */
import { isIP } from "node:net";
import { z } from "zod";
import { ProviderConfigError } from "../../models/provider_errors.js";

const text = z.string().min(1).max(253);
const headers = z.record(z.string().min(1).max(64), z.string().max(65536));
const rules = z.record(text, z.array(z.strictObject({ transform: z.strictObject({ headers: headers.optional() }).optional() })).length(1));
const egress = {
  allow_internet_access: z.boolean().optional(),
  allow_out: z.array(text).max(1024).optional(),
  deny_out: z.array(text).max(1024).optional(),
  rules: rules.optional(),
};
export const networkUpdateSchema = z.strictObject(egress);
export const networkCreateSchema = z.strictObject({
  ...egress,
  allow_public_traffic: z.boolean().optional(),
  mask_request_host: z.string().min(1).max(253).optional(),
});

const replacementCarrier = "fc.sandbox.network.header-value-replacements";
const forbiddenHeaders = new Set(["host", "content-length", "transfer-encoding", "connection", "upgrade", "proxy-authorization", "proxy-authenticate"]);
/** Semantic checks complement the host's deliberately bounded schema dialect. Errors never contain input values. */
export function validateNetworkRules(network: z.infer<typeof networkCreateSchema>): void {
  const entries = Object.entries(network.rules ?? {});
  if (entries.length > 10 || Buffer.byteLength(JSON.stringify(network.rules ?? {})) > 65536) throw new ProviderConfigError("Network rules exceed the documented domain or serialized-size limit.");
  for (const [host, rules] of entries) {
    if (isIP(host) || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i.test(host)) throw new ProviderConfigError("Network transformation rules require exact domain names without wildcards, IPs, ports or paths.");
    const values = Object.entries(rules[0]?.transform?.headers ?? {});
    if (values.filter(([key]) => key.toLowerCase() !== replacementCarrier).length > 20) throw new ProviderConfigError("Network transformation rules permit at most 20 ordinary headers per domain.");
    for (const [name, value] of values) {
      const lower = name.toLowerCase();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || forbiddenHeaders.has(lower) || lower.startsWith("x-envoy-") || lower.startsWith("x-forwarded-")) throw new ProviderConfigError("Network rules contain an unsupported request header name.");
      if (lower !== replacementCarrier && Buffer.byteLength(value) > 2048) throw new ProviderConfigError("Network transformation header values exceed 2048 bytes.");
    }
  }
}

/** Convert an explicit replacement object; omitted fields stay omitted and {} stays {}. */
export function networkWire(network: z.infer<typeof networkCreateSchema>): Record<string, unknown> {
  validateNetworkRules(network);
  return {
    ...(network.allow_internet_access === undefined ? {} : { allowInternetAccess: network.allow_internet_access }),
    ...(network.allow_out === undefined ? {} : { allowOut: network.allow_out }),
    ...(network.deny_out === undefined ? {} : { denyOut: network.deny_out }),
    ...(network.rules === undefined ? {} : { rules: network.rules }),
    ...(network.allow_public_traffic === undefined ? {} : { allowPublicTraffic: network.allow_public_traffic }),
    ...(network.mask_request_host === undefined ? {} : { maskRequestHost: network.mask_request_host }),
  };
}

/** Runtime PUT retains the standard API's mixed spelling for its total-egress switch. */
export function networkUpdateWire(network: z.infer<typeof networkUpdateSchema>): Record<string, unknown> {
  const { allowInternetAccess, ...egress } = networkWire(network);
  return { ...egress, ...(allowInternetAccess === undefined ? {} : { allow_internet_access: allowInternetAccess }) };
}

/** Validate native create before credentials or network are used; the cloud receives top-level network fields. */
export function parseCreateNetwork(input: unknown, secure = true): Record<string, unknown> {
  const parsed = networkCreateSchema.safeParse(input);
  if (!parsed.success) throw new ProviderConfigError("Invalid network configuration; use the declared snake_case network fields.");
  if (parsed.data.allow_public_traffic === false && !secure) throw new ProviderConfigError("Private public-port traffic requires secure=true for envd access.");
  validateNetworkRules(parsed.data);
  return parsed.data;
}

/** Header values can contain credentials; include replacement payload values and Bearer secrets in redaction. */
export function networkSecretValues(input: unknown): string[] {
  const parsed = networkCreateSchema.safeParse(input);
  if (!parsed.success) return [];
  const result: string[] = [];
  for (const list of Object.values(parsed.data.rules ?? {})) for (const rule of list) {
    for (const [name, value] of Object.entries(rule.transform?.headers ?? {})) {
      if (value) result.push(value);
      const bearer = /^Bearer\s+(.+)$/i.exec(value);
      if (bearer?.[1]) result.push(bearer[1]);
      if (name.toLowerCase() === replacementCarrier) {
        try {
          const replacements: unknown = JSON.parse(value);
          if (Array.isArray(replacements)) for (const entry of replacements) {
            if (entry !== null && typeof entry === "object" && typeof entry.value === "string" && entry.value) result.push(entry.value);
          }
        } catch { /* The service validates the reserved carrier; the whole value is still redacted. */ }
      }
    }
  }
  return result;
}

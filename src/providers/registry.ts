/** Provider registry: built-in, programmatically registered and installed providers. */


import { collectSources, ProviderSchema, selectProviderId, setSchemaLookup } from "../transport/config_layers.js";
import { BUILTIN_PROVIDER_ID, validateProviderId } from "../utils/config_keys.js";
import { Provider } from "./base.js";
import { AlicloudExpressProvider } from "./builtin.js";
import { ExecProvider } from "./exec_provider.js";
import { ProviderConflictError, ProviderNotFoundError } from "./errors.js";
import { loadManifest } from "./manifest.js";
import { RestProvider } from "./rest_provider.js";
import * as store from "./store.js";

export interface ProviderSummary {
  id: string;
  name: string;
  name_zh: string;
  version: string;
  kind: string;
  trust: string;
  error?: string;
}

const registered = new Map<string, Provider>();
let builtin: AlicloudExpressProvider | null = null;

export function builtinProvider(): AlicloudExpressProvider {
  builtin ??= new AlicloudExpressProvider();
  return builtin;
}

/** Register a programmatic provider object under `provider.id`. */
export function registerProvider(provider: Provider, opts: { replace?: boolean } = {}): Provider {
  const problem = validateProviderId(provider.id);
  if (problem) throw new ProviderConflictError(`Cannot register provider '${provider.id}': ${problem}.`);
  if (registered.has(provider.id) && !opts.replace) {
    throw new ProviderConflictError(`Provider id '${provider.id}' is already registered.`);
  }
  registered.set(provider.id, provider);
  return provider;
}

export function unregisterProvider(providerId: string): void {
  registered.delete(providerId);
}

/** Drop cached state about `providerId` (after uninstall). */
export function forget(providerId: string): void {
  unregisterProvider(providerId);
}

/** Forget every registered provider (tests). */
export function resetRegistry(): void {
  registered.clear();
}

export function pluginRoot(providerId: string, receipt: Record<string, unknown>): string {
  if (receipt["trust"] === "link") return String((receipt["source"] as Record<string, unknown>)["path"]);
  return store.providerDir(providerId);
}

/** Build a provider object from the store (verifies the receipt; exec providers verify the digest on start). */
export function loadInstalled(providerId: string): Provider {
  const receipt = store.readReceipt(providerId);
  if (receipt === null) throw new ProviderNotFoundError(`Provider '${providerId}' is not installed.`);
  const root = pluginRoot(providerId, receipt as Record<string, unknown>);
  const manifest = loadManifest(root);
  if (manifest.id !== providerId) throw new ProviderNotFoundError(`Provider '${providerId}' is not installed.`);
  if (manifest.kind === "rest") {
    if (receipt["trust"] !== "link") store.verifyIntegrity(providerId);
    return new RestProvider(manifest, receipt as Record<string, unknown>);
  }
  return new ExecProvider(manifest, root, receipt as Record<string, unknown>);
}

/** The provider object for `providerId` (default: the configured default). */
export function getProvider(providerId?: string | null): Provider {
  const id = providerId ?? resolveProviderId();
  if (id === BUILTIN_PROVIDER_ID) return builtinProvider();
  const reg = registered.get(id);
  if (reg) return reg;
  if (validateProviderId(id) !== null) {
    throw new ProviderNotFoundError(`Provider '${id}' is not installed.`, { suggestion: hint(id) });
  }
  try {
    return loadInstalled(id);
  } catch (exc) {
    if (exc instanceof ProviderNotFoundError) {
      throw new ProviderNotFoundError(`Provider '${id}' is not installed.`, { suggestion: hint(id) });
    }
    throw exc;
  }
}

/** `difflib.SequenceMatcher.ratio()` for short ids. */
function ratio(a: string, b: string): number {
  const matches = (x: string, y: string): number => {
    if (!x || !y) return 0;
    let best = 0;
    let bi = 0;
    let bj = 0;
    for (let i = 0; i < x.length; i++) {
      for (let j = 0; j < y.length; j++) {
        let k = 0;
        while (i + k < x.length && j + k < y.length && x[i + k] === y[j + k]) k++;
        if (k > best) {
          best = k;
          bi = i;
          bj = j;
        }
      }
    }
    if (best === 0) return 0;
    return best + matches(x.slice(0, bi), y.slice(0, bj)) + matches(x.slice(bi + best), y.slice(bj + best));
  };
  return a.length + b.length === 0 ? 1 : (2 * matches(a, b)) / (a.length + b.length);
}

function hint(wanted: string): string {
  let known: string[];
  try {
    known = listProviders().map((p) => p.id);
  } catch {
    known = [BUILTIN_PROVIDER_ID];
  }
  let close: string | null = null;
  let top = 0.6;
  for (const k of known) {
    const r = ratio(wanted, k);
    if (r >= top && (close === null || r > top)) {
      close = k;
      top = r;
    }
  }
  const base = "Run 'ebx provider list'; install with 'ebx provider install <path-or-git-url>'.";
  return close ? `Did you mean '${close}'? ${base}` : base;
}

function summary(provider: Provider, trust: string): ProviderSummary {
  return {
    id: provider.id,
    name: provider.displayName,
    name_zh: provider.displayNameZh,
    version: provider.version,
    kind: provider.kind,
    trust,
  };
}

/** Summaries of every known provider: built-in first, then the others sorted by id. */
export function listProviders(): ProviderSummary[] {
  const out: ProviderSummary[] = [summary(builtinProvider(), "builtin")];
  const seen = new Set<string>([BUILTIN_PROVIDER_ID]);
  const others: ProviderSummary[] = [];
  for (const [pid, prov] of registered) {
    if (!seen.has(pid)) {
      seen.add(pid);
      others.push(summary(prov, "python"));
    }
  }
  for (const pid of store.listInstalledIds()) {
    if (seen.has(pid)) continue;
    const receipt = store.readReceipt(pid) ?? {};
    const trust = String(receipt["trust"] ?? "local");
    try {
      others.push(summary(loadInstalled(pid), trust));
    } catch (exc) {
      others.push({
        id: pid,
        name: pid,
        name_zh: "",
        version: String(receipt["version"] ?? ""),
        kind: "exec",
        trust,
        error: exc instanceof Error ? exc.message : String(exc),
      });
    }
    seen.add(pid);
  }
  others.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...out, ...others];
}

/** explicit > `EBX_PROVIDER` > `./.env` > `~/.ebx/.env` > `[core]` > built-in. */
export function resolveProviderId(explicit?: string | null): string {
  const overrides = explicit ? { provider: explicit } : {};
  return selectProviderId(collectSources(overrides));
}

/** The configured default, ignoring any explicit per-call choice. */
export function ambientProviderId(): string {
  return resolveProviderId(null);
}

/** Split `provider:sandbox_id`; the prefix counts only if it names a known provider. */
export function parseSandboxRef(ref: string): [string | null, string] {
  const idx = ref.indexOf(":");
  if (idx >= 0) {
    const prefix = ref.slice(0, idx);
    const rest = ref.slice(idx + 1);
    const valid = prefix === BUILTIN_PROVIDER_ID || validateProviderId(prefix) === null;
    if (rest && valid) {
      try {
        getProvider(prefix);
      } catch (exc) {
        if (exc instanceof ProviderNotFoundError) return [null, ref];
        throw exc;
      }
      return [prefix, rest];
    }
  }
  return [null, ref];
}

/** Printable sandbox reference: bare only in the legacy single-provider case. */
export function qualify(providerId: string, sandboxId: string, opts: { ambient?: string } = {}): string {
  const ambient = opts.ambient ?? ambientProviderId();
  if (providerId === BUILTIN_PROVIDER_ID && ambient === BUILTIN_PROVIDER_ID) return sandboxId;
  return `${providerId}:${sandboxId}`;
}

setSchemaLookup((providerId) => {
  const provider = getProvider(providerId);
  return new ProviderSchema(provider.id, provider.configKeys(), new Set(provider.inherit), { ...provider.derive }, {
    ...provider.endpointDefaults,
  });
});


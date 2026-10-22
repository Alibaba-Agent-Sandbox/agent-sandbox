#!/usr/bin/env node
/**
 * Generate `src/utils/config_keys.ts` from `docs/design/fixtures/config-keys.json`.
 *
 * The JSON (exported by the Python SDK: `python -m agent_sandbox.utils.config_keys --json`) is the contract; the
 * TypeScript module is derived data and must never be edited by hand.
 *
 *   node scripts/gen-config-keys.mjs          # rewrite src/utils/config_keys.ts
 *   node scripts/gen-config-keys.mjs --check  # exit 1 when the file drifted from the JSON
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_JSON = path.join(ROOT, "docs", "design", "fixtures", "config-keys.json");
export const TARGET_TS = path.join(ROOT, "src", "utils", "config_keys.ts");

const HEADER = `/**
 * Canonical configuration-key registry (GENERATED - do not edit).
 *
 * Source of truth: docs/design/fixtures/config-keys.json (exported by the Python SDK with
 * \`python -m agent_sandbox.utils.config_keys --json\`). Regenerate with \`node scripts/gen-config-keys.mjs\`;
 * \`tests/test_utils/test_config_keys.test.ts\` fails when this file drifts from the JSON.
 *
 * The pure layered resolver lives in \`./config_resolver.ts\`.
 *
 * Keys only the CLI reads (\`llm_*\`, \`acr_*\`, \`team_id\`) are declared by hand in \`./cli_config_keys.ts\` and appended
 * to the shared keys at load time; \`exportSchema()\` and the JSON contain the shared keys only.
 */

import { CLI_BUILTIN_KEYS, CLI_CORE_KEYS } from "./cli_config_keys.js";
`;

const BODY = `
export type KeyType = "str" | "url" | "int" | "float" | "bool" | "enum" | "path" | "csv";
export type AliasKind = "native";
export type AliasSurface = "env" | "config" | "kwarg" | "flag";

export interface Alias {
  readonly name: string;
  readonly kind: AliasKind;
  readonly surface: AliasSurface;
}

export interface Storage {
  readonly file: "env" | "toml";
  readonly name: string;
  readonly section?: string;
}

/** One configuration key; \`scope\` is "core" or a provider id. */
export interface ConfigKey {
  readonly key: string;
  readonly scope: string;
  readonly type: KeyType;
  readonly secret: boolean;
  readonly credential: boolean;
  readonly settable: boolean;
  readonly env: string;
  readonly aliases: readonly Alias[];
  readonly env_names: readonly string[];
  readonly toml_section: string | null;
  readonly storage: Storage | null;
  readonly default: string | number | boolean | null;
  readonly choices: readonly string[];
  readonly group: string;
  readonly description: string;
  /** Optional, provider-declared (manifest fields); the generated registry never sets it. */
  readonly required?: boolean;
  readonly description_zh?: string;
}

export interface ConfigKeysSchema {
  readonly schema_version: number;
  readonly builtin_provider: { readonly id: string; readonly name: string; readonly name_zh: string };
  readonly reserved_provider_ids: readonly string[];
  readonly reserved_provider_prefixes: readonly string[];
  readonly generic_endpoint_keys: readonly string[];
  readonly tuning_keys: readonly string[];
  readonly keys: readonly ConfigKey[];
}

export const BUILTIN_PROVIDER_ID: string = SCHEMA.builtin_provider.id;
export const BUILTIN_PROVIDER_NAME: string = SCHEMA.builtin_provider.name;
export const BUILTIN_PROVIDER_NAME_ZH: string = SCHEMA.builtin_provider.name_zh;
export const RESERVED_PROVIDER_IDS: readonly string[] = SCHEMA.reserved_provider_ids;
export const RESERVED_PROVIDER_PREFIXES: readonly string[] = SCHEMA.reserved_provider_prefixes;
export const GENERIC_ENDPOINT_KEYS: readonly string[] = SCHEMA.generic_endpoint_keys;
/** Core keys whose value reaches every provider (non-secret tuning). */
export const TUNING_KEYS: readonly string[] = SCHEMA.tuning_keys;

/** Official catalog ids. Must match Python \`OFFICIAL_CATALOG_IDS\`. */
export const OFFICIAL_CATALOG_IDS: readonly string[] = ["opensandbox", "cubesandbox", "e2b", "alicloud-container"];

export const PROVIDER_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;

export const KEY_TYPES: readonly KeyType[] = ["str", "url", "int", "float", "bool", "enum", "path", "csv"];
export const ALIAS_KINDS: readonly AliasKind[] = ["native"];
export const ALIAS_SURFACES: readonly AliasSurface[] = ["env", "config", "kwarg", "flag"];

/** Shared keys followed by the CLI-only keys (\`cli_config_keys.ts\`). */
export const CORE_KEYS: readonly ConfigKey[] = [...SCHEMA.keys.filter((k) => k.scope === "core"), ...CLI_CORE_KEYS];
export const ALICLOUD_EXPRESS_KEYS: readonly ConfigKey[] = [
  ...SCHEMA.keys.filter((k) => k.scope === BUILTIN_PROVIDER_ID),
  ...CLI_BUILTIN_KEYS,
];
export const CORE_KEY_NAMES: readonly string[] = CORE_KEYS.map((k) => k.key);

const BY_KEY = new Map<string, ConfigKey>([...CORE_KEYS, ...ALICLOUD_EXPRESS_KEYS, ...SCHEMA.keys.filter((k) => k.scope !== "core" && k.scope !== BUILTIN_PROVIDER_ID)].map((k) => [\`\${k.scope}\\u0000\${k.key}\`, k]));

export function getKey(key: string, scope = "core"): ConfigKey | undefined {
  return BY_KEY.get(\`\${scope}\\u0000\${key}\`);
}

export function builtinKeys(): readonly ConfigKey[] {
  return ALICLOUD_EXPRESS_KEYS;
}

export function providerEnvPrefix(providerId: string): string {
  return "ABX_" + providerId.toUpperCase().replaceAll("-", "_") + "_";
}

export function providerEnvName(providerId: string, key: string): string {
  return providerEnvPrefix(providerId) + key.toUpperCase();
}

/** Return an error message when \`providerId\` is not a valid third-party id, else \`null\`. */
export function validateProviderId(providerId: string): string | null {
  if (providerId.length < 2 || providerId.length > 40 || !PROVIDER_ID_RE.test(providerId)) {
    return "provider id must be 2-40 chars of lowercase letters, digits and single hyphens, starting with a letter";
  }
  if (OFFICIAL_CATALOG_IDS.includes(providerId)) return null;
  if (RESERVED_PROVIDER_IDS.includes(providerId) || RESERVED_PROVIDER_PREFIXES.some((p) => providerId.startsWith(p))) {
    return \`provider id '\${providerId}' is reserved\`;
  }
  return null;
}

export function aliasNames(key: ConfigKey, surface: AliasSurface, ...kinds: AliasKind[]): string[] {
  return key.aliases.filter((a) => a.surface === surface && (kinds.length === 0 || kinds.includes(a.kind))).map((a) => a.name);
}

/** Look up a core key by canonical name or by an alias on \`surface\`. */
export function findKeyByAlias(name: string, surface: AliasSurface): ConfigKey | undefined {
  for (const k of CORE_KEYS) if (k.key === name) return k;
  for (const k of [...CORE_KEYS, ...ALICLOUD_EXPRESS_KEYS]) {
    if (aliasNames(k, surface).includes(name)) return k;
  }
  return undefined;
}

/**
 * Environment names for \`key\`, most specific first: [provider-scoped override], canonical, provider-native.
 * \`scopedFor\` adds the provider-scoped override name for an inherited core key.
 */
export function envNames(key: ConfigKey, opts: { scopedFor?: string | null } = {}): string[] {
  const names: string[] = [];
  if (opts.scopedFor && key.scope === "core") names.push(providerEnvName(opts.scopedFor, key.key));
  names.push(key.env);
  names.push(...key.aliases.filter((a) => a.surface === "env" && a.kind === "native").map((a) => a.name));
  return [...new Set(names)];
}

/** Language-neutral schema export of the shared keys (identical to docs/design/fixtures/config-keys.json). */
export function exportSchema(extraProviderKeys: readonly ConfigKey[] = []): ConfigKeysSchema {
  return {
    ...SCHEMA,
    keys: [...SCHEMA.keys, ...extraProviderKeys],
  };
}
`;

/** Render the TypeScript module for the given parsed JSON document. */
export function renderConfigKeys(schema) {
  const json = JSON.stringify(schema, null, 2);
  return `${HEADER}
const SCHEMA: ConfigKeysSchema = ${json} as ConfigKeysSchema;
${BODY}`;
}

export function generate() {
  const schema = JSON.parse(fs.readFileSync(SOURCE_JSON, "utf8"));
  return renderConfigKeys(schema);
}

function main(argv) {
  const out = generate();
  if (argv.includes("--check")) {
    const current = fs.existsSync(TARGET_TS) ? fs.readFileSync(TARGET_TS, "utf8") : "";
    if (current !== out) {
      process.stderr.write("src/utils/config_keys.ts is stale: run `node scripts/gen-config-keys.mjs`\n");
      return 1;
    }
    return 0;
  }
  fs.writeFileSync(TARGET_TS, out);
  process.stdout.write("wrote src/utils/config_keys.ts\n");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}

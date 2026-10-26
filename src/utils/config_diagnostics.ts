/** Safe local configuration diagnostics. Source text and parsed secret values never enter errors. */
import * as fs from "node:fs";
import { parseTomlBytes } from "./toml_plain.js";
import { parseStream } from "./_dotenv.js";
import { aliasNames, envNames, type ConfigKey } from "./config_keys.js";
import { validateConfigValue, overrideNames, type Sources } from "./config_resolver.js";

function readExisting(file: string): Buffer | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error("not a regular file");
    return fs.readFileSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Cannot read configuration file '${file}'. Check the path and file permissions; existing configuration was not changed.`, { cause: error });
  }
}

/** Reject unreadable or malformed configuration before offering missing-value setup or writing values. */
export function assertConfigFilesReadable(configPath: string, envPaths: readonly string[] = []): void {
  const toml = readExisting(configPath);
  if (toml !== null) {
    try { parseTomlBytes(toml); }
    catch { throw new Error(`Cannot parse configuration file '${configPath}'. Repair its TOML syntax before configuring values; existing configuration was not changed.`); }
  }
  for (const file of new Set(envPaths)) {
    const data = readExisting(file);
    if (data === null) continue;
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); }
    catch { throw new Error(`Cannot decode configuration file '${file}' as UTF-8. Existing configuration was not changed.`); }
    for (const binding of parseStream(text)) {
      if (binding.error) throw new Error(`Cannot parse configuration file '${file}' at line ${binding.original.line}. Repair its dotenv syntax before configuring values; existing configuration was not changed.`);
    }
  }
}

/** Diagnose an invalid explicit value before the resolver can silently fall back to a lower layer/default. */
export function assertConfigValuesValid(keys: readonly ConfigKey[], sources: Sources, providerId: string): void {
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const pairs = (values: Readonly<Record<string, unknown>>, names: readonly string[], label: string): Array<[unknown, string]> => names.filter((name) => Object.hasOwn(values, name)).map((name) => [values[name], `${label} ${name}`]);
  for (const key of keys) {
    const names = envNames(key, { scopedFor: providerId });
    const toml = sources.toml ?? {};
    const section = key.toml_section ?? "transport";
    const scoped = object(object(toml["providers"])[providerId]);
    const aliases = [...new Set([key.key, ...aliasNames(key, "config"), ...aliasNames(key, "kwarg")])];
    const candidates: Array<[unknown, string]> = [
      ...pairs(sources.overrides ?? {}, overrideNames(key), "command option"),
      ...pairs(sources.environ ?? {}, names, "environment variable"),
      ...(sources.dotenv ?? []).flatMap((layer, index) => pairs(layer, names, `dotenv layer ${index + 1}`)),
      ...pairs(scoped, [key.key], `config providers.${providerId}`),
      ...(key.scope === "core" || key.scope === "alicloud-express" ? pairs(object(toml[section] ?? (section === "transport" ? toml : {})), aliases, `config ${section}`) : []),
    ];
    const explicit = candidates.find(([raw]) => raw !== null && raw !== undefined && String(raw).trim() !== "");
    if (!explicit) continue;
    const [raw, location] = explicit;
    const valid = validateConfigValue(key, raw) !== null;
    if (!valid) throw new Error(`Invalid ${key.type} configuration for '${key.key}' from ${location}. Correct that source before continuing; its value is not shown.`);
  }
}

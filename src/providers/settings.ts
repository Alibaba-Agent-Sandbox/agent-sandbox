/** Targeted, comment-preserving edits of `config.toml` / `.env` for provider settings (port of `providers/settings.py`). */

import * as fs from "node:fs";
import * as path from "node:path";

import { paths } from "../transport/config_layers.js";
import { BUILTIN_PROVIDER_ID, providerEnvPrefix } from "../utils/config_keys.js";

const HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/;

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC, 0o600);
  try {
    fs.writeSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
}

function readLines(file: string): string[] | null {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  const text = fs.readFileSync(file, "utf-8");
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Write `[core] provider = "<id>"` (`null` or the built-in id removes the key). */
export function setDefaultProvider(providerId: string | null, configPath?: string): void {
  const file = configPath ?? paths.configFile;
  const existing = readLines(file);
  const lines = existing ?? [];
  const remove = providerId === null || providerId === BUILTIN_PROVIDER_ID;
  const out: string[] = [];
  let inCore = false;
  let coreSeen = false;
  let written = false;
  for (const line of lines) {
    const m = HEADER.exec(line);
    if (m) {
      if (inCore && !written && !remove) {
        out.push(`provider = "${providerId}"`);
        written = true;
      }
      inCore = (m[1] as string).trim() === "core";
      coreSeen = coreSeen || inCore;
      out.push(line);
      continue;
    }
    if (inCore && /^\s*provider\s*=/.test(line)) {
      if (!remove && !written) {
        out.push(`provider = "${providerId}"`);
        written = true;
      }
      continue;
    }
    out.push(line);
  }
  if (!remove && !written) {
    if (coreSeen && inCore) {
      out.push(`provider = "${providerId}"`);
    } else {
      if (out.length > 0 && (out[out.length - 1] as string).trim()) out.push("");
      out.push("[core]", `provider = "${providerId}"`);
    }
  }
  if (remove && existing === null) return;
  write(file, `${out.join("\n")}\n`);
}

/** Remove `[providers.<id>]` from config.toml and `ABX_<ID>_*` from the user `.env`. */
export function purgeProviderSettings(providerId: string, configPath?: string, envPath?: string): void {
  const cfg = configPath ?? paths.configFile;
  const cfgLines = readLines(cfg);
  if (cfgLines !== null) {
    const keep: string[] = [];
    let skipping = false;
    const target = `providers.${providerId}`;
    for (const line of cfgLines) {
      const m = HEADER.exec(line);
      if (m) skipping = (m[1] as string).replace(/ /g, "") === target;
      if (!skipping) keep.push(line);
    }
    write(cfg, `${keep.join("\n")}\n`);
  }
  const envFile = envPath ?? path.join(path.dirname(cfg), ".env");
  const envLines = readLines(envFile);
  if (envLines !== null) {
    const prefix = providerEnvPrefix(providerId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^\\s*(export\\s+)?${prefix}`);
    const kept = envLines.filter((ln) => !re.test(ln));
    write(envFile, `${kept.join("\n")}${kept.length > 0 ? "\n" : ""}`);
  }
}

function tomlLiteral(value: string | number | boolean): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

/**
 * Set (or, with `null`, remove) `key` in the TOML table `[table]`, preserving everything else. The table is created on
 * demand and removed again when it becomes empty.
 */
export function setTomlValue(table: string, key: string, value: string | number | boolean | null, configPath?: string): void {
  const file = configPath ?? paths.configFile;
  const existing = readLines(file);
  if (existing === null && value === null) return;
  const lines = existing ?? [];
  const out: string[] = [];
  const assignment = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
  let inTable = false;
  let tableSeen = false;
  let written = false;
  const flush = (): void => {
    if (inTable && !written && value !== null) {
      const blanks: string[] = [];
      while (out.length > 0 && !(out[out.length - 1] as string).trim()) blanks.push(out.pop() as string);
      out.push(`${key} = ${tomlLiteral(value)}`, ...blanks);
      written = true;
    }
  };
  for (const line of lines) {
    const m = HEADER.exec(line);
    if (m) {
      flush();
      inTable = (m[1] as string).replace(/ /g, "") === table;
      tableSeen = tableSeen || inTable;
      out.push(line);
      continue;
    }
    if (inTable && assignment.test(line)) {
      if (value !== null && !written) {
        out.push(`${key} = ${tomlLiteral(value)}`);
        written = true;
      }
      continue;
    }
    out.push(line);
  }
  flush();
  if (value !== null && !written) {
    if (tableSeen) {
      out.push(`${key} = ${tomlLiteral(value)}`);
    } else {
      if (out.length > 0 && (out[out.length - 1] as string).trim()) out.push("");
      out.push(`[${table}]`, `${key} = ${tomlLiteral(value)}`);
    }
  }
  const pruned: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const m = HEADER.exec(out[i] as string);
    if (m && (m[1] as string).replace(/ /g, "") === table) {
      let j = i + 1;
      while (j < out.length && !(out[j] as string).trim()) j++;
      if (j >= out.length || HEADER.test(out[j] as string)) {
        i = j - 1;
        continue;
      }
    }
    pruned.push(out[i] as string);
  }
  write(file, pruned.length > 0 ? `${pruned.join("\n")}\n` : "");
}

/** Set (or, with `null`, remove) `NAME=value` in a dotenv file (default `~/.abx/.env`, mode 0600). */
export function setEnvValue(name: string, value: string | null, envPath?: string): void {
  const file = envPath ?? path.join(path.dirname(paths.configFile), ".env");
  const existing = readLines(file);
  if (existing === null && value === null) return;
  const re = new RegExp(`^\\s*(export\\s+)?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
  const kept = (existing ?? []).filter((ln) => !re.test(ln));
  if (value !== null) kept.push(`${name}=${/[\s#"']/.test(value) ? JSON.stringify(value) : value}`);
  write(file, kept.length > 0 ? `${kept.join("\n")}\n` : "");
}

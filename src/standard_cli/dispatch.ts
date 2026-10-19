/** Standard sandbox commands use one pinned behavior contract; project extensions stay native. */

import { collectSources, explainConfig, loadLayeredConfig } from "../transport/config_layers.js";
import { ambientProviderId } from "../providers/registry.js";

const shortcuts = new Set(["create", "list", "info", "kill", "exec", "connect", "pause", "resume"]);
const sandboxExtensions = new Set(["upload", "download", "capabilities", "files", "process", "command", "system"]);
const templateExtensions = new Set(["launch", "from-image", "build", "deploy", "scaffold", "install", "push", "search", "info"]);
const nativeRootFlags = new Set(["--json", "-j", "--quiet", "-q", "--verbose", "-v", "--no-color", "--ci"]);


/** A qualified resource belongs to the provider router, including install/mismatch errors. */
function hasQualifiedSandboxReference(args: readonly string[]): boolean {
  const commandIndex = args[0] === "sandbox" ? 1 : 0;
  const verb = args[commandIndex] ?? "";
  if (!["exec", "ex", "info", "in", "connect", "cn", "kill", "kl", "pause", "resume"].includes(verb)) return false;
  const valued = new Set(["-u", "--user", "-c", "--cwd", "-e", "--env", "-f", "--format", "-t", "--timeout", "-s", "--state", "-m", "--metadata"]);
  let optionsEnded = false;
  for (let index = commandIndex + 1; index < args.length; index++) {
    const value = args[index]!;
    if (!optionsEnded && value === "--") { optionsEnded = true; continue; }
    if (!optionsEnded && valued.has(value)) { index++; continue; }
    if (!optionsEnded && value.startsWith("-")) continue;
    if (value.includes(":")) return true;
    // Anything after the exec ID is remote command input, never a provider reference.
    if (!["kill", "kl"].includes(verb)) return false;
  }
  return false;
}

/** Return standard argv, or null for an explicit project extension/provider invocation. */
export function standardArguments(input: readonly string[]): string[] | null {
  const args = [...input];
  const rootOptions: string[] = [];
  // Native output flags must never select a different create/connect implementation.
  // Preserve them for the standard parser to reject explicitly, before backend work.
  for (let index = 0; index < args.length;) {
    const value = args[index]!;
    if (value === "--provider") { index += 2; continue; }
    if (value.startsWith("--provider=")) { index++; continue; }
    const flag = nativeRootFlags.has(value) || /^-[jqv]+$/.test(value) || value.startsWith("--log-level=");
    if (value === "--log-level") {
      rootOptions.push(...args.splice(index, Math.min(2, args.length - index)));
    } else if (flag) {
      rootOptions.push(...args.splice(index, 1));
    } else {
      break;
    }
  }
  if (args[0] === "sbx") args[0] = "sandbox";
  if (args[0] === "tpl") args[0] = "template";

  let execIdSeen = false;
  for (let index = 0; index < args.length; index++) {
    if (args[0] === "sbx") args[0] = "sandbox";
    if (args[0] === "tpl") args[0] = "template";
    if (execIdSeen) break;
    const value = args[index]!;
    if (value === "--provider" || value.startsWith("--provider=")) {
      const provider = value === "--provider" ? args[index + 1] : value.slice("--provider=".length);
      if (provider !== "alicloud-express") return null;
      args.splice(index, value === "--provider" ? 2 : 1);
      index--;
      continue;
    }
    const execPosition = args[0] === "exec" ? 0 : args[0] === "sandbox" && ["exec", "ex"].includes(args[1] ?? "") ? 1 : -1;
    if (execPosition >= 0 && index > execPosition) {
      if (["-u", "--user", "-c", "--cwd", "-e", "--env"].includes(value)) {
        index++;
      } else if (!value.startsWith("-")) {
        execIdSeen = true;
      }
    }
  }
  // Cross-provider listing is an explicit project extension, not an upstream filter.
  const listPosition = args[0] === "list" ? 0 : args[0] === "sandbox" && args[1] === "list" ? 1 : -1;
  if (listPosition >= 0 && args.slice(listPosition + 1).includes("--all-providers")) return null;
  if (hasQualifiedSandboxReference(args)) return null;
  const isCreate = args[0] === "create" || args[0] === "sandbox" && ["create", "cr", "spawn", "sp"].includes(args[1] ?? "");
  if (isCreate && args.some((a) => a === "--prompt" || a.startsWith("--prompt="))) return null;
  if (args[0] && shortcuts.has(args[0])) return [...rootOptions, "sandbox", ...args];
  if (args[0] === "sandbox" && (!args[1] || !sandboxExtensions.has(args[1]))) return [...rootOptions, ...args];
  if (args[0] === "template" && (!args[1] || !templateExtensions.has(args[1]))) return [...rootOptions, ...args];
  return null;
}

/** Execute the project's bundled standard client. No external e2b executable/package is loaded. */
export async function dispatchStandard(args: readonly string[]): Promise<boolean> {
  const normalized = standardArguments(args);
  if (normalized === null) return false;
  const expressOptions = (values: readonly string[]): number => values.filter((arg, index) => arg === "--provider=alicloud-express" || (arg === "--provider" && values[index + 1] === "alicloud-express")).length;
  const expressOverride = expressOptions(args) > expressOptions(normalized);
  if (!expressOverride && ambientProviderId() !== "alicloud-express") return false;
  const snapshot = collectSources();
  // Standard E2B settings are an entry-specific namespace. Core/provider config
  // keeps its canonical ABX names and is never mutated by compatibility aliases.
  const standardLayer = (layer: Readonly<Record<string, string>>): Record<string, string> => {
    const normalized = { ...layer };
    for (const [standard, project] of [["E2B_API_KEY", "ABX_SANDBOX_API_KEY"],
      ["E2B_API_URL", "ABX_SANDBOX_BASE_URL"], ["E2B_DOMAIN", "ABX_SANDBOX_DOMAIN"]]) {
      const value = layer[standard!];
      if (value?.trim()) normalized[project!] = value;
    }
    return normalized;
  };
  const sources = { ...snapshot, environ: standardLayer(snapshot.environ ?? {}),
    dotenv: (snapshot.dotenv ?? []).map(standardLayer) };

  const config = loadLayeredConfig({ provider: "alicloud-express" }, { sources });
  if (config.api_key) process.env["E2B_API_KEY"] = config.api_key;
  const urlSource = explainConfig({ provider: "alicloud-express" }, { sources })["sandbox_base_url"]?.source;
  const explicitUrl = urlSource !== undefined && ["override", "environ", "dotenv", "toml"].includes(urlSource);
  process.env["E2B_API_URL"] = explicitUrl ? config.api_url : `https://api.${config.domain}`;
  process.env["E2B_DOMAIN"] = config.domain;
  process.argv = [process.argv[0]!, process.argv[1]!, ...normalized];
  // An embedded, independently released CLI must not check for updates to @e2b/cli.
  process.env["NO_UPDATE_NOTIFIER"] = "1";
  const runtime = await import("./runtime.mjs");
  await runtime.default.completion;
  return true;
}

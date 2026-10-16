/** Standard sandbox commands use one pinned behavior contract; project extensions stay native. */

import { loadConfig } from "../transport/config.js";
import { explainConfig } from "../transport/config_layers.js";
import { ambientProviderId } from "../providers/registry.js";

const shortcuts = new Set(["create", "list", "info", "kill", "exec", "connect", "pause", "resume"]);
const sandboxExtensions = new Set(["upload", "download", "capabilities", "files", "process", "command", "system"]);
const templateExtensions = new Set(["from-image", "build", "deploy", "scaffold", "install", "push", "search", "info"]);

/** Return standard argv, or null for an explicit project extension/provider invocation. */
export function standardArguments(input: readonly string[]): string[] | null {
  const args = [...input];
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
  const isCreate = args[0] === "create" || args[0] === "sandbox" && ["create", "cr", "spawn", "sp"].includes(args[1] ?? "");
  if (isCreate && args.some((a) => a === "--prompt" || a.startsWith("--prompt="))) return null;
  if (args[0] && shortcuts.has(args[0])) return ["sandbox", ...args];
  if (args[0] === "sandbox" && (!args[1] || !sandboxExtensions.has(args[1]))) return [...args];
  if (args[0] === "template" && (!args[1] || !templateExtensions.has(args[1]))) return [...args];
  return null;
}

/** Execute the project's bundled standard client. No external e2b executable/package is loaded. */
export async function dispatchStandard(args: readonly string[]): Promise<boolean> {
  const normalized = standardArguments(args);
  if (normalized === null) return false;
  const expressOptions = (values: readonly string[]): number => values.filter((arg, index) => arg === "--provider=alicloud-express" || (arg === "--provider" && values[index + 1] === "alicloud-express")).length;
  const expressOverride = expressOptions(args) > expressOptions(normalized);
  if (!expressOverride && ambientProviderId() !== "alicloud-express") return false;
  const config = loadConfig();
  if (config.api_key) process.env["E2B_API_KEY"] ??= config.api_key;
  const urlSource = explainConfig({ provider: "alicloud-express" })["sandbox_base_url"]?.source;
  const explicitUrl = urlSource !== undefined && ["override", "environ", "dotenv", "toml"].includes(urlSource);
  process.env["E2B_API_URL"] ??= explicitUrl ? config.api_url : `https://api.${config.domain}`;
  process.env["E2B_DOMAIN"] ??= config.domain;
  process.argv = [process.argv[0]!, process.argv[1]!, ...normalized];
  // An embedded, independently released CLI must not check for updates to @e2b/cli.
  process.env["NO_UPDATE_NOTIFIER"] = "1";
  const runtime = await import("./runtime.mjs");
  await runtime.default.completion;
  return true;
}

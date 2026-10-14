/**
 * `abx provider` — manage sandbox providers (backends): install, inspect, select, update and test them.
 *
 * The built-in provider is `alicloud-express` (Alibaba Cloud Express Edition, 阿里云极速版). Further providers are
 * plugins installed from a directory or a git URL; nothing from a plugin is executed while installing. Grammar, JSON
 * shapes and exit codes: `docs/design/providers-and-credentials-cli.md` section 5.
 *
 * The group stays hidden from `abx --help` until a provider is installed or selected (`providersInUse()`); it is always
 * callable and documented here and in the guides.
 */

import { Argument, Context, argument, command, group, option } from "../kit.js";
import { Choice } from "../types.js";
import { sysExit } from "../errors.js";
import { echo, sys } from "../io.js";
import { confirm } from "../prompts.js";
import { providersInUse } from "../../providers/in_use.js";
import * as installer from "../../providers/installer.js";
import { doctor, verifyHandshake } from "../../providers/doctor.js";
import { ProviderConfigError, ProviderConflictError, ProviderInstallError, ProviderNotFoundError, ProviderTrustError } from "../../providers/errors.js";
import * as registry from "../../providers/registry.js";
import { setDefaultProvider, setEnvValue, setTomlValue } from "../../providers/settings.js";
import * as store from "../../providers/store.js";
import { runContractSuite, summarizeContract } from "../../providers/testing.js";
import { collectSources, loadLayeredConfig, resetLayeredConfig } from "../../transport/config_layers.js";
import { resolveKey, coerce } from "../../utils/config_resolver.js";
import { BUILTIN_PROVIDER_ID, getKey, providerEnvName } from "../../utils/config_keys.js";
import { compactFeatures, configFieldToKey, type ConfigField } from "../../providers/base.js";
import { getFormatter, type OutputFormatter } from "../formatters.js";
import { handleErrors } from "../main.js";
import { engine } from "./provider_engine.js";

type Params = Record<string, unknown>;

const PROVIDER_HELP = [
  "Manage sandbox providers (backends).",
  "",
  "    The built-in provider is 'alicloud-express' (Alibaba Cloud Express Edition,",
  "    阿里云极速版). Install more with a directory or a git URL; nothing from a",
  "    plugin is executed while installing.",
  "",
  "    Select a provider for one command with the global '--provider ID' (any",
  "    position) and set provider options with '--opt KEY=VALUE' (repeatable).",
  "    Sandbox references may be qualified: 'abx kill local-process:sbx-1'.",
  "",
  "    \b",
  "    Examples:",
  "      abx provider list",
  "      abx provider install ./my-provider",
  "      abx provider install https://github.com/acme/abx-provider-acme.git --ref 4f1c2ab9e0d5c3b7a1f2e8d9c0b1a2f3e4d5c6b7",
  "      abx provider default acme",
  "      abx create --provider acme --template base",
  "      abx list --all-providers",
  "",
  "    \b",
  "    Related commands:",
  "      abx config      Credentials and defaults (keys: provider, providers.<id>.<key>)",
  "      abx info        Show one sandbox",
  "    ",
].join("\n");

export const provider = group("provider", { help: PROVIDER_HELP, hidden: !providersInUse() });

// ---------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------

function isInteractive(fmt: OutputFormatter): boolean {
  return sys.stdin.isatty() && !fmt.use_json && !fmt.quiet;
}

function ambientId(): string {
  return registry.ambientProviderId();
}

function defaultSource(): "env" | "dotenv" | "config" | "builtin" {
  const sources = collectSources();
  const key = getKey("provider");
  if (!key) return "builtin";
  const res = resolveKey(key, sources);
  if (res === null || res.layer === "default") return "builtin";
  if (res.layer === "environ" || res.layer === "override") return "env";
  if (res.layer === "dotenv") return "dotenv";
  return "config";
}

function pairsToMap(pairs: Array<[string, unknown]>): Map<string, unknown> {
  return new Map(pairs);
}

function printRows(rows: Array<[string, string]>): void {
  const width = rows.reduce((m, [k]) => Math.max(m, k.length), 0);
  for (const [k, v] of rows) echo(`${k.padEnd(width)}  ${v}`);
}

function redactReceipt(receipt: Record<string, unknown>): Record<string, unknown> {
  const out = { ...receipt };
  const src = out["source"];
  if (src && typeof src === "object") {
    const copy = { ...(src as Record<string, unknown>) };
    if (typeof copy["url"] === "string") copy["url"] = store.redactUrl(copy["url"]);
    out["source"] = copy;
  }
  return out;
}

function securityLine(sec: { network: string[]; filesystem: string[]; spawns_processes: boolean }): string {
  const net = sec.network.length ? sec.network.join(",") : "none";
  const fsys = sec.filesystem.length ? sec.filesystem.join(",") : "none";
  return `network: ${net} · filesystem: ${fsys} · spawns processes: ${sec.spawns_processes ? "yes" : "no"}`;
}

function sourceLine(source: Record<string, unknown>, trust: string): string {
  const where = String(source["url"] ? store.redactUrl(String(source["url"])) : (source["path"] ?? ""));
  const commit = source["commit"] ? ` @ ${String(source["commit"]).slice(0, 8)}…` : "";
  return `${where}${commit} (${trust})`;
}

/** The consent screen (stdout) shown before an install or a risky update. */
function renderConsent(plan: installer.InstallPlan): void {
  const s = plan.summary() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const name = s["name_zh"] && s["name_zh"] !== s["name"] ? `${s["name"]} / ${s["name_zh"]}` : String(s["name"]);
  const rows: Array<[string, string]> = [
    ["Provider", `${s["id"]} ${s["version"]}  (${name})`],
    ["Source", sourceLine(s["source"], s["trust"])],
  ];
  if (s["tree_sha256"]) rows.push(["Digest", `sha256:${s["tree_sha256"]}`]);
  rows.push(["Runs", (s["runtime"] as string[]).join(" ")]);
  rows.push(["Features", (s["features"] as string[]).join(", ")]);
  rows.push(["Security", `${securityLine(s["security"])}  (declared by the plugin, not enforced)`]);
  if ((s["fields"] as Array<{ key: string; secret: boolean }>).length) {
    rows.push(["Config", (s["fields"] as Array<{ key: string; secret: boolean }>).map((f) => (f.secret ? `${f.key} (secret)` : f.key)).join(", ")]);
  }
  if ((s["inherit"] as string[]).length) {
    rows.push(["Inherit", `${(s["inherit"] as string[]).join(", ")}   <- your generic sandbox credentials WILL BE SENT to this plugin`]);
  }
  if (s["trust"] === "link") rows.push(["Trust", "unpinned, development only (the directory is used in place, no integrity check)"]);
  else if (s["trust"] === "unpinned") rows.push(["Trust", "tag/branch installs are not pinned: pass --ref <40-hex commit> or --sha256 to pin"]);
  if ((s["changes"] as string[]).length) rows.push(["Changes", (s["changes"] as string[]).join(", ")]);
  printRows(rows);
  echo("");
  echo("This plugin runs as a program on your machine with your credentials for this provider.");
}

async function askConsent(fmt: OutputFormatter, plan: installer.InstallPlan, question: string): Promise<boolean> {
  if (!isInteractive(fmt)) return false;
  renderConsent(plan);
  return confirm(question, { default: false });
}

function nonInteractiveRefusal(source: string): ProviderTrustError {
  return new ProviderTrustError("Installing a provider requires confirmation.", {
    suggestion: `Re-run with --yes after reviewing: abx provider install ${source} --ref <commit>`,
  });
}

function table(fmt: OutputFormatter, headers: string[], rows: string[][]): void {
  fmt.printTable(headers, rows);
}

function describeFor(id: string): Record<string, unknown> {
  const p = registry.getProvider(id);
  const d = p.describe() as unknown as Record<string, unknown>;
  const receipt = id === BUILTIN_PROVIDER_ID ? null : store.readReceipt(id);
  return {
    ...d,
    default: id === ambientId(),
    trust: id === BUILTIN_PROVIDER_ID ? "builtin" : String(receipt?.["trust"] ?? "python"),
    install: receipt ? redactReceipt(receipt as Record<string, unknown>) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// list / info
// ---------------------------------------------------------------------------------------------------------------------

const list_cmd = command("list", {
  help: [
    "List built-in and installed providers.",
    "",
    "    Columns: ID, Version, Kind (builtin|rest|exec), Trust",
    "    (builtin|pinned|local|link|unpinned), how many features the provider",
    "    supports (a command that needs another feature fails with E8004; 'abx",
    "    provider info ID' lists them; --json lists them inline as",
    "    sandbox(lifecycle,pause) exec(run,stream) files(rw) ...) and whether it is",
    "    the default. --json adds the Name. With --quiet only the ids are printed.",
    "",
    "    \b",
    "    Examples:",
    "      abx provider list",
    "      abx --json provider list",
    "    ",
  ].join("\n"),
  callback: handleErrors(async (ctx: Context) => {
    const fmt = getFormatter(ctx);
    const def = ambientId();
    const rows = registry.listProviders();
    if (fmt.quiet && !fmt.use_json) {
      for (const r of rows) echo(r.id);
      return;
    }
    const unusable = (r: (typeof rows)[number]): string | null => (r.error ? `(unusable: ${r.error})` : null);
    // JSON keeps the full compact feature list; the text table shows a count so it stays readable at 80 columns.
    const features = (r: (typeof rows)[number]): string =>
      unusable(r) ?? (fmt.use_json ? compactFeatures(r.features) : String(r.features.length));
    if (fmt.use_json) {
      table(
        fmt,
        ["ID", "Name", "Version", "Kind", "Trust", "Features", "Default"],
        rows.map((r) => [r.id, r.name, r.version, r.kind, r.trust, features(r), r.id === def ? "yes" : ""]),
      );
      return;
    }
    table(
      fmt,
      ["ID", "Version", "Kind", "Trust", "Features", "Default"],
      rows.map((r) => [r.id, r.version, r.kind, r.trust, features(r), r.id === def ? "yes" : ""]),
    );
    echo("Features is a count; 'abx provider info ID' shows the name and the features.");
  }),
});

const INFO_HELP = [
  "Show a provider's manifest, features and configuration.",
  "",
  "    Installed providers additionally show their source, commit, tree digest,",
  "    runtime command, declared (advisory) security permissions and the generic",
  "    credentials they were allowed to inherit. 'show' is an alias.",
  "",
  "    \b",
  "    Examples:",
  "      abx provider info alicloud-express",
  "      abx --json provider show local-process",
  "    ",
].join("\n");

const info_cmd = command("info", {
  help: INFO_HELP,
  params: [argument(["provider_id"], { metavar: "ID" }) as Argument],
  callback: handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const id = params["provider_id"] as string;
    const d = describeFor(id);
    if (fmt.use_json) {
      fmt.printData(d);
      return;
    }
    const fields = d["config_fields"] as Array<{ key: string; secret: boolean }>;
    const rows: Array<[string, string]> = [
      ["ID", String(d["id"])],
      ["Name", d["name_zh"] ? `${d["name"]} (${d["name_zh"]})` : String(d["name"])],
      ["Version", String(d["version"])],
      ["Kind", String(d["kind"])],
      ["Default", d["default"] ? "yes" : "no"],
      ["Trust", String(d["trust"])],
      ["Features", (d["features"] as string[]).join(", ")],
      ["Config", fields.map((f) => (f.secret ? `${f.key} (secret)` : f.key)).join(", ") || "(none)"],
      ["Inherits", (d["inherit"] as string[]).join(", ") || "(none)"],
    ];
    const install = d["install"] as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (install) {
      const src = (install["source"] ?? {}) as Record<string, unknown>;
      rows.push(["Source", sourceLine(src, String(install["trust"]))]);
      if (src["commit"]) rows.push(["Commit", String(src["commit"])]);
      if (install["tree_sha256"]) rows.push(["Digest", `sha256:${install["tree_sha256"]}`]);
      const consented = (install["consented"] ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (consented["runtime"]) rows.push(["Runtime", (consented["runtime"] as string[]).join(" ")]);
      if (consented["security"]) rows.push(["Security", `${securityLine(consented["security"])}  (declared, not enforced)`]);
      rows.push(["Installed", String(install["installed_at"] ?? "")]);
    }
    if (fmt.quiet) {
      for (const [, v] of rows) echo(v);
      return;
    }
    printRows(rows);
  }),
});

// ---------------------------------------------------------------------------------------------------------------------
// install / uninstall / update
// ---------------------------------------------------------------------------------------------------------------------

const install_cmd = command("install", {
  help: [
    "Install a provider plugin from a directory or a git URL.",
    "",
    "    SOURCE is a local directory, owner/repo//subdir[@ref] (same // as",
    "    'abx template install'), or a git URL (https://, ssh://, git@host:path).",
    "    Nothing from the plugin is executed during installation; the plugin's",
    "    abx-provider.toml is validated and its tree digest recorded. A consent screen",
    "    lists what the plugin runs, which features it provides and which generic",
    "    credentials it would receive. Non-interactive installs need --yes.",
    "",
    "    A full 40-hex commit (--ref) or --sha256 pins the install. Tag and branch",
    "    installs are unpinned: they are accepted only after you read the consent",
    "    screen in a terminal (without --yes) or with --allow-unpinned; --yes alone",
    "    never accepts a moving ref.",
    "",
    "    \b",
    "    Examples:",
    "      abx provider install ./my-provider",
    "      abx provider install ./my-provider --link --yes     # development: use in place",
    "      abx provider install alibaba-agent-sandbox/awesome-providers//opensandbox",
    "      abx provider install https://github.com/acme/abx-provider-acme.git --ref <commit>",
    "    ",
  ].join("\n"),
  params: [
    argument(["source"]) as Argument,
    option(["--ref"], { help: "Git tag, branch or commit (a full 40-hex commit pins the install)" }),
    option(["--subdir"], { help: "Plugin directory inside the repository" }),
    option(["--sha256"], { help: "Expected tree digest; the install fails if it differs (pins the install)" }),
    option(["--link"], { is_flag: true, help: "Link a local directory for development (no copy, no integrity check; requires --yes; POSIX only)" }),
    option(["--force"], { is_flag: true, help: "Replace an installed provider with the same id" }),
    option(["--allow-unpinned"], { is_flag: true, help: "Allow a tag/branch install without --sha256 in non-interactive mode" }),
    option(["--allow-insecure-transport"], { is_flag: true, help: "Allow file://, git:// and http:// sources (testing only)" }),
    option(["--no-verify"], { is_flag: true, hidden: true }),
    option(["--yes", "-y"], { is_flag: true, help: "Skip the confirmation prompt (required in non-interactive mode)" }),
  ],
  callback: handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const source = params["source"] as string;
    const interactive = isInteractive(fmt);
    const receipt = await installer.install(source, {
      ref: (params["ref"] as string | null) ?? null,
      subdir: (params["subdir"] as string | null) ?? null,
      sha256: (params["sha256"] as string | null) ?? null,
      link: Boolean(params["link"]),
      force: Boolean(params["force"]),
      allowUnpinned: Boolean(params["allow_unpinned"]),
      allowInsecureTransport: Boolean(params["allow_insecure_transport"]),
      yes: Boolean(params["yes"]),
      interactive,
      confirm: params["yes"] ? undefined : async (plan) => {
        const ok = await askConsent(fmt, plan, "Install and trust it?");
        if (!ok && !interactive) throw nonInteractiveRefusal(source);
        return ok;
      },
      verify: params["no_verify"] ? undefined : verifyHandshake,
    });
    registry.forget(String(receipt["id"]));
    const trust = String(receipt["trust"]);
    const src = (receipt["source"] ?? {}) as Record<string, unknown>;
    if (fmt.use_json) {
      fmt.printData(
        pairsToMap([
          ["status", "success"],
          ["message", `Installed provider '${receipt["id"]}' ${receipt["version"]} (${trust})`],
          ["id", receipt["id"]],
          ["version", receipt["version"]],
          ["trust", trust],
          ["commit", src["commit"] ?? null],
          ["tree_sha256", receipt["tree_sha256"] ?? null],
        ]),
      );
      return;
    }
    fmt.printSuccess(`Installed provider '${receipt["id"]}' ${receipt["version"]} (${trust})`);
  }),
});

const uninstall_cmd = command("uninstall", {
  help: [
    "Remove an installed provider.",
    "",
    "    The plugin's data directory is kept unless --purge is given; --purge also",
    "    removes [providers.<id>] from config.toml and ABX_<ID>_* from ~/.abx/.env.",
    "    If the provider was the default, the default is reset to alicloud-express.",
    "    ",
  ].join("\n"),
  params: [
    argument(["provider_id"], { metavar: "ID" }) as Argument,
    option(["--purge"], { is_flag: true, help: "Also remove the provider's data directory and settings" }),
    option(["--yes", "-y"], { is_flag: true, help: "Skip the confirmation prompt" }),
  ],
  callback: handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const id = params["provider_id"] as string;
    if (id === BUILTIN_PROVIDER_ID) throw new ProviderConflictError("The built-in provider cannot be removed.");
    if (store.readReceipt(id) === null && !registryHas(id)) {
      throw new ProviderNotFoundError(`Provider '${id}' is not installed.`, { suggestion: "Run 'abx provider list'." });
    }
    if (!params["yes"]) {
      if (!isInteractive(fmt)) {
        throw new ProviderTrustError("Removing a provider requires confirmation.", { suggestion: `Re-run with --yes: abx provider uninstall ${id} --yes` });
      }
      if (!(await confirm(`Remove provider '${id}'?`, { default: false }))) {
        echo("Aborted.", { err: true });
        return sysExit(1);
      }
    }
    const result = await installer.uninstall(id, { purge: Boolean(params["purge"]) });
    if (result.default_reset) echo(`Default provider reset to '${BUILTIN_PROVIDER_ID}'.`, { err: true });
    if (fmt.use_json) {
      fmt.printData(pairsToMap([["status", "success"], ["message", `Removed provider '${id}'`], ["id", id], ["purged", result.purged], ["default_reset", result.default_reset]]));
      return;
    }
    fmt.printSuccess(`Removed provider '${id}'`);
  }),
});

function registryHas(id: string): boolean {
  try {
    registry.getProvider(id);
    return true;
  } catch {
    return false;
  }
}

const update_cmd = command("update", {
  help: [
    "Update installed providers from their recorded git source.",
    "",
    "    Without ID (or with --all) every git-installed provider is checked. A",
    "    pinned install stays put unless --ref names a new commit. --check only",
    "    reports what would change. Changes to runtime, security, features, config",
    "    fields or inherited credentials ask for consent again. A failed handshake",
    "    rolls back to the previous version (the data directory is preserved).",
    "    Directory and --link installs cannot be updated: reinstall with --force.",
    "    ",
  ].join("\n"),
  params: [
    argument(["provider_id"], { metavar: "ID", required: false }) as Argument,
    option(["--ref"], { help: "Git tag, branch or commit to update to" }),
    option(["--check"], { is_flag: true, help: "Only report available updates" }),
    option(["--all"], { is_flag: true, help: "Update every installed git provider" }),
    option(["--allow-unpinned"], { is_flag: true, help: "Allow an unpinned update in non-interactive mode" }),
    option(["--allow-insecure-transport"], { is_flag: true, help: "Allow file://, git:// and http:// sources (testing only)" }),
    option(["--yes", "-y"], { is_flag: true, help: "Skip the confirmation prompt" }),
  ],
  callback: handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const given = (params["provider_id"] as string | null) ?? null;
    const ids = given ? [given] : store.listInstalledIds();
    const results: installer.UpdateResult[] = [];
    const interactive = isInteractive(fmt);
    for (const id of ids) {
      try {
        results.push(
          await installer.update(id, {
            ref: (params["ref"] as string | null) ?? null,
            check: Boolean(params["check"]),
            yes: Boolean(params["yes"]),
            allowUnpinned: Boolean(params["allow_unpinned"]),
            allowInsecureTransport: Boolean(params["allow_insecure_transport"]),
            confirm: params["yes"] ? undefined : async (plan) => {
              const ok = await askConsent(fmt, plan, "Apply the update?");
              if (!ok && !interactive) {
                throw new ProviderTrustError("Updating a provider requires confirmation.", { suggestion: `Re-run with --yes after reviewing: abx provider update ${id}` });
              }
              return ok;
            },
            verify: verifyHandshake,
          }),
        );
        registry.forget(id);
      } catch (exc) {
        if (!given && exc instanceof ProviderInstallError) continue;
        throw exc;
      }
    }
    if (fmt.use_json) {
      fmt.printData(results.map((r) => pairsToMap([["id", r.id], ["status", r.status], ["installed", r.installed], ["available", r.available], ["changes", r.changes]])));
      return;
    }
    if (params["check"]) {
      const pending = results.filter((r) => r.status === "available");
      if (!pending.length) {
        fmt.printSuccess("All providers are up to date.");
        return;
      }
      table(fmt, ["ID", "Installed", "Available", "Changes"], pending.map((r) => [r.id, short(r.installed), short(r.available), r.changes.join(", ")]));
      return;
    }
    if (!results.length || results.every((r) => r.status === "up-to-date")) {
      fmt.printSuccess("All providers are up to date.");
      return;
    }
    for (const r of results) {
      if (r.status === "updated") fmt.printSuccess(`Updated provider '${r.id}' (${short(r.installed)} -> ${short(r.available)})`);
      else if (r.status === "pinned") fmt.printSuccess(`Provider '${r.id}' is pinned; pass --ref <commit> to move it.`);
    }
  }),
});

function short(commit: string | null): string {
  return commit ? commit.slice(0, 8) : "-";
}

// ---------------------------------------------------------------------------------------------------------------------
// default
// ---------------------------------------------------------------------------------------------------------------------

const default_cmd = command("default", {
  help: [
    "Show or set the default provider.",
    "",
    "    Without ID prints the effective default (ABX_PROVIDER wins over the stored",
    "    value). With ID stores '[core] provider' in ~/.abx/config.toml; --unset",
    "    returns to alicloud-express.",
    "",
    "    \b",
    "    Examples:",
    "      abx provider default",
    "      abx provider default local-process",
    "      abx provider default --unset",
    "    ",
  ].join("\n"),
  params: [argument(["provider_id"], { metavar: "ID", required: false }) as Argument, option(["--unset"], { is_flag: true, help: "Reset the default to alicloud-express" })],
  callback: handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const id = (params["provider_id"] as string | null) ?? null;
    if (params["unset"]) {
      setDefaultProvider(null);
      resetLayeredConfig();
      fmt.printSuccess(`Default provider reset to '${BUILTIN_PROVIDER_ID}'`);
      return;
    }
    if (id === null) {
      const current = ambientId();
      if (fmt.use_json) fmt.printData(pairsToMap([["default", current], ["source", defaultSource()]]));
      else echo(current);
      return;
    }
    registry.getProvider(id);
    setDefaultProvider(id === BUILTIN_PROVIDER_ID ? null : id);
    resetLayeredConfig();
    const override = process.env["ABX_PROVIDER"];
    if (override && override.trim() && override.trim() !== id) echo(`note: ABX_PROVIDER=${override.trim()} overrides this at runtime.`, { err: true });
    fmt.printSuccess(`Default provider set to '${id}'`);
  }),
});

// ---------------------------------------------------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------------------------------------------------

function fieldOf(id: string, key: string): ConfigField {
  const p = registry.getProvider(id);
  const f = p.configFields.find((x) => x.key === key);
  if (!f) {
    throw new ProviderConfigError(`Unknown option '${key}' for provider '${id}'.`, { suggestion: `Available: ${p.configFields.map((x) => x.key).join(", ") || "(none)"}` });
  }
  return f;
}

function validateFieldValue(id: string, field: ConfigField, text: string): string | number | boolean {
  const ck = configFieldToKey(field, id);
  const value = coerce(ck, text);
  if (value === null) {
    const reason = field.type === "enum" ? `expected one of ${(field.choices ?? []).join(", ")}` : `expected ${field.type ?? "str"}`;
    throw new ProviderConfigError(`Invalid value for '${field.key}': ${reason}.`);
  }
  if (field.type === "url") {
    try {
      new URL(String(value));
    } catch {
      throw new ProviderConfigError(`Invalid value for '${field.key}': not a URL.`);
    }
  }
  return value as string | number | boolean;
}

function configRow(f: ConfigField, id: string): string[] {
  const raw = loadLayeredConfig({ provider: id }).provider_options[f.key];
  const shown = raw === undefined || raw === null || raw === "" ? "(not set)" : f.secret ? "********" : String(raw);
  return [f.key, f.type ?? "str", shown, f.secret ? "secret" : "", f.required ? "required" : ""];
}

async function promptPlain(text: string): Promise<string> {
  const { prompt } = await import("../prompts.js");
  return String(await prompt(text.replace(/: $/, "")));
}

function removeField(id: string, f: ConfigField): void {
  if (f.secret) setEnvValue(providerEnvName(id, f.key), null);
  else setTomlValue(`providers.${id}`, f.key, null);
  resetLayeredConfig();
}

async function readValue(id: string, f: ConfigField, given: string | null): Promise<string> {
  if (given !== null) return given;
  if (!sys.stdin.isatty()) {
    throw new ProviderConfigError(`No value given for '${f.key}'.`, { suggestion: `abx provider config ${id} set ${f.key} VALUE` });
  }
  const { _promptSecret } = await import("./config_cmd.js");
  return f.secret ? await _promptSecret(`${f.key} (input masked; press Enter to cancel)`) : await promptPlain(`${f.key}: `);
}

function storeField(fmt: OutputFormatter, id: string, f: ConfigField, value: string): void {
  if (value === "") {
    removeField(id, f);
    fmt.printSuccess(`Cleared ${f.key} for provider '${id}'.`);
    return;
  }
  const typed = validateFieldValue(id, f, value);
  if (f.secret) setEnvValue(providerEnvName(id, f.key), String(typed));
  else setTomlValue(`providers.${id}`, f.key, typed);
  resetLayeredConfig();
  fmt.printSuccess(f.secret ? `Stored ${f.key} for provider '${id}' in ~/.abx/.env.` : `Set ${f.key} = ${typed} for provider '${id}'.`);
}

export const config_cmd = command("config", {
  help: [
    "Show or edit one provider's configuration.",
    "",
    "    ACTION is one of list, get, set, unset, init. Secrets (fields marked secret",
    "    in the manifest) are stored in ~/.abx/.env as ABX_<ID>_<KEY> and always",
    "    shown masked; other options go to [providers.<id>] in ~/.abx/config.toml.",
    "    The same keys are reachable as 'abx config get providers.<id>.<key>'.",
    "",
    "    \b",
    "    Examples:",
    "      abx provider config local-process list",
    "      abx provider config local-process set workdir_root /tmp/abx",
    "      abx provider config my-cloud set token       # masked prompt",
    "      abx provider config my-cloud unset token",
    "      abx provider config my-cloud init            # prompt for every field",
    "    ",
  ].join("\n"),
  params: [
    argument(["provider_id"], { metavar: "ID" }) as Argument,
    argument(["action"], { metavar: "ACTION", type: new Choice(["list", "get", "set", "unset", "init"]) }) as Argument,
    argument(["key"], { required: false }) as Argument,
    argument(["value"], { required: false }) as Argument,
  ],
  callback: handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const id = params["provider_id"] as string;
    const action = params["action"] as string;
    const p = registry.getProvider(id);
    const key = (params["key"] as string | null) ?? null;
    const value = (params["value"] as string | null) ?? null;

    if (action === "list") {
      if (!p.configFields.length) {
        fmt.printSuccess(`Provider '${id}' has no options.`);
        return;
      }
      table(fmt, ["Key", "Type", "Value", "Secret", "Required"], p.configFields.map((f) => configRow(f, id)));
      return;
    }
    if (action === "init") {
      if (!sys.stdin.isatty()) {
        throw new ProviderConfigError("'init' needs an interactive terminal.", { suggestion: `Use 'abx provider config ${id} set KEY VALUE' for each field.` });
      }
      const total = p.configFields.length;
      for (const [i, f] of p.configFields.entries()) {
        const label = `${i + 1}/${total} ${f.description || f.key} (${f.key})${f.required ? " *" : ""}`;
        echo(label);
        const entered = await readValue(id, f, null);
        if (entered.trim() !== "") storeField(fmt, id, f, entered);
      }
      fmt.printSuccess(`Configuration complete. Review it with 'abx provider config ${id} list'.`);
      return;
    }
    if (key === null) {
      throw new ProviderConfigError(`'${action}' needs a KEY.`, { suggestion: `abx provider config ${id} ${action} KEY` });
    }
    const f = fieldOf(id, key);
    if (action === "get") {
      const raw = loadLayeredConfig({ provider: id }).provider_options[f.key];
      if (raw === undefined || raw === null || raw === "") fmt.printData("(not set)");
      else fmt.printData(f.secret ? "********" : String(raw));
    } else if (action === "set") {
      storeField(fmt, id, f, await readValue(id, f, value));
    } else {
      removeField(id, f);
      fmt.printSuccess(`Cleared ${f.key} for provider '${id}'.`);
    }
  }),
});

// ---------------------------------------------------------------------------------------------------------------------
// doctor / test
// ---------------------------------------------------------------------------------------------------------------------

const doctor_cmd = command("doctor", {
  help: [
    "Check a provider: installed, integrity, configuration and (for plugins) the handshake.",
    "",
    "    Runs without side effects on the sandbox backend. Lines are 'ok|fail  <check>",
    "    <detail>'; exit code 0 when everything is ok, 1 on any failure.",
    "    ",
  ].join("\n"),
  params: [argument(["provider_id"], { metavar: "ID", required: false }) as Argument, option(["--no-handshake"], { is_flag: true, help: "Do not start the plugin process" })],
  callback: handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const id = (params["provider_id"] as string | null) ?? ambientId();
    const report = await doctor(id, { handshake: !params["no_handshake"] });
    if (fmt.use_json) {
      fmt.printData(report.checks.map((c) => pairsToMap([["check", c.name], ["status", c.ok ? "ok" : "fail"], ["detail", c.detail]])));
    } else if (!fmt.quiet) {
      for (const c of report.checks) echo(`${c.ok ? "ok  " : "fail"}  ${c.name}${c.detail ? `  ${c.detail}` : ""}`);
    }
    if (!report.ok) return sysExit(1);
  }),
});

const test_cmd = command("test", {
  help: [
    "Run the provider contract tests against a provider.",
    "",
    "    Exercises the provider through the same adapters the CLI uses (sandbox",
    "    lifecycle, exec, files, ... as far as the provider declares them) and reports",
    "    one line per case. Cases for features the provider does not declare are",
    "    skipped. Exit code 0 when no case failed, 1 otherwise.",
    "",
    "    \b",
    "    Examples:",
    "      abx provider test local-process",
    "      abx provider test opensandbox -o domain=127.0.0.1:8080 -o use_server_proxy=true",
    "    ",
  ].join("\n"),
  params: [
    argument(["provider_id"], { metavar: "ID" }) as Argument,
    option(["--opt", "--option", "-o", "opt"], { multiple: true, metavar: "KEY=VALUE", help: "Provider option (repeatable)" }),
    option(["-k", "filter"], { help: "Only run cases whose name contains this text" }),
  ],
  callback: handleErrors(async (ctx: Context, params: Params) => {
    const fmt = getFormatter(ctx);
    const id = params["provider_id"] as string;
    registry.getProvider(id);
    const options: Record<string, unknown> = {};
    for (const pair of (params["opt"] as string[] | undefined) ?? []) {
      const idx = pair.indexOf("=");
      if (idx <= 0) throw new ProviderConfigError(`Invalid option '${pair}': expected KEY=VALUE.`);
      options[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
    }
    const results = await runContractSuite(id, { options, filter: (params["filter"] as string | null) ?? undefined });
    const sum = summarizeContract(results);
    if (fmt.use_json) {
      fmt.printData(
        pairsToMap([
          ["provider", id],
          ["passed", sum.passed],
          ["failed", sum.failed],
          ["skipped", sum.skipped],
          ["results", results.map((r) => pairsToMap([["name", r.name], ["outcome", r.outcome], ["detail", r.detail], ["ms", r.ms]]))],
        ]),
      );
    } else {
      if (!fmt.quiet) {
        for (const r of results) echo(`${r.outcome.padEnd(7)} ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
      }
      echo(`${sum.passed} passed, ${sum.failed} failed, ${sum.skipped} skipped`);
    }
    if (sum.failed > 0 || sum.passed + sum.skipped === 0) return sysExit(1);
  }),
});

provider.addCommand(list_cmd, "list");
provider.addCommand(info_cmd, "info");
provider.addCommand(info_cmd, "show");
provider.addCommand(install_cmd, "install");
provider.addCommand(uninstall_cmd, "uninstall");
provider.addCommand(update_cmd, "update");
provider.addCommand(default_cmd, "default");
provider.addCommand(config_cmd, "config");
provider.addCommand(doctor_cmd, "doctor");
provider.addCommand(test_cmd, "test");
provider.addCommand(engine, "engine");


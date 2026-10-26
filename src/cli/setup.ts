/** Continue first-time CLI setup using the ordinary catalog and launch commands. */
import type { Context } from "./kit.js";
import { canPrompt } from "./interaction.js";
import { prompt, select } from "./prompts.js";
import { getOutput } from "./output.js";
import { getFormatter } from "./formatters.js";
import { UsageError, Abort } from "./errors.js";
import { fetchIndex } from "../utils/template_index.js";
import { getProvider, resolveProviderId } from "../providers/registry.js";
import { cliProvider } from "../providers/selection.js";
import { resolveGithubToken } from "./commands/config_cmd.js";
import { _withGithubRateLimitRetry } from "./template_catalog.js";

/** Pick a catalog template without requiring users to find or copy repository references. */
export async function chooseTemplate(ctx: Context): Promise<string> {
  if (!canPrompt(ctx)) throw new UsageError("Choose a template with 'abx template search QUERY', then run 'abx template launch NAME' in a terminal, or supply NAME and --yes in automation.");
  const out = getOutput(ctx), fmt = getFormatter(ctx);
  const provider = getProvider(resolveProviderId(cliProvider()));
  const index = await _withGithubRateLimitRetry(token => fetchIndex(null, { token }), { token: resolveGithubToken(), fmt, out });
  if (index.notice) out.warning(index.notice);
  for (;;) {
    const query = String(await prompt("Find a template by name or purpose (Enter lists all)", { default: "", show_default: false, err: true }));
    const entries = index.filter(query).filter(entry => !entry.manifest || entry.manifest["provider"] === provider.id)
      .sort((a, b) => Number(b.name.toLowerCase() === query.trim().toLowerCase()) - Number(a.name.toLowerCase() === query.trim().toLowerCase()));
    if (!entries.length) { out.info("No matching templates for this provider. Try another name or purpose."); continue; }
    const selected = await select("Choose a template", {
      choices: [...entries.map(entry => ({ name: `${entry.name} — ${entry.description}`, value: entry.name })),
        { name: "Search again", value: "?" }, { name: "Cancel", value: "" }],
      default: entries[0]!.name, err: true,
    });
    if (selected === "?") continue;
    if (!selected) throw new Abort();
    return selected;
  }
}

/** Offer a direct continuation after configuration, with an explicit finish option. */
export async function continueSetup(ctx: Context): Promise<void> {
  if (!canPrompt(ctx)) return;
  const next = await select("What would you like to do next?", {
    choices: [{ name: "Find and launch a template", value: "launch" }, { name: "Finish setup", value: "" }],
    default: "launch", err: true,
  });
  if (next !== "launch") {
    getOutput(ctx).info("Ready. Run 'abx template launch' to find and launch a template; missing build settings can be filled in the same command.");
    return;
  }
  const { launchTemplate } = await import("./template_launch.js");
  await launchTemplate(ctx, { template_ref: await chooseTemplate(ctx) });
}

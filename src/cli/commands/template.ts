/** Template authoring; deployment and Provider-native resources have separate owners. */
import { argument, command, option, type Command } from "../kit.js";
import { handleErrors } from "../error_handler.js";
import { FLOAT } from "../types.js";
import { providerCliExtension } from "../provider_extensions.js";
import { template } from "../template_catalog.js";
import { buildTemplate } from "../template_build.js";
import { publishTemplate } from "../template_publish.js";
export * from "../template_catalog.js";

/** Internal Provider UI access; these are not commands in the authoring namespace. */
export async function providerTemplateCommand(name: string): Promise<Command | null> {
  const extension = providerCliExtension();
  if (!extension) return null;
  const module = await extension.loadTemplates();
  const aliases: Record<string, string> = { list: "list_templates", create: "create_template", delete: "delete_" };
  return (module[aliases[name] ?? name] as Command | undefined) ?? null;
}

export const build = command("build", {
  help: "Build a reusable template artifact without starting an application. Retains a private source snapshot and resource journal. --out never replaces an existing artifact.",
  params: [argument(["source"], { default: ".", required: false }), option(["--out"]), option(["--clean"], { help: "Clean owned resources from an unused build artifact; retain its journal." }), option(["--build-profile"]),
    option(["--alias", "-a"]), option(["--timeout"], { type: FLOAT, default: 600 }), option(["--yes", "-y"], { is_flag: true })],
  callback: handleErrors(buildTemplate),
});
template.addCommand(build);

export const publish = command("publish", {
  help: "Publish a clean committed template to an existing GitHub remote using a new version tag. Returns a commit-pinned source reference; does not create a catalog listing.",
  params: [argument(["source"], { default: ".", required: false }), option(["--tag"], { required: true }),
    option(["--remote"], { default: "origin" }), option(["--yes", "-y"], { is_flag: true })],
  callback: handleErrors(publishTemplate),
});
template.addCommand(publish);

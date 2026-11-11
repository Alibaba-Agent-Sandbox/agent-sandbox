/** Test the retained Express template adapter directly, without a public CLI alias. */
import { cli as publicCli } from "../../src/cli/main.js";
import { group } from "../../src/cli/kit.js";
import { template } from "../../src/providers/alicloud_express/cli/template.js";

export const providerTemplateCli = group("adapter-test", {
  params: publicCli.params,
  ...(publicCli.callback ? { callback: publicCli.callback } : {}),
});
providerTemplateCli.addCommand(template);

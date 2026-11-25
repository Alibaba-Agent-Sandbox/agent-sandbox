/** Private harness for existing lifecycle callback tests; never registered in the product CLI. */
import { group } from "../../src/cli/kit.js";
import { cli as product } from "../../src/cli/main.js";
import { create, list_cmd, info, kill, exec_cmd, connect, upload, download } from "../../src/cli/commands/sandbox.js";
export const cli = group("abx", { params: product.params, callback: product.callback ?? undefined });
const internalSandbox = group("sandbox");
for (const value of [exec_cmd, connect, upload, download]) cli.addCommand(value);
for (const value of [create, list_cmd, info, kill]) { cli.addCommand(value); internalSandbox.addCommand(value); }
cli.addCommand(internalSandbox);

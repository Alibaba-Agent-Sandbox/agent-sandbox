# Writing an abx command

The executable enters `src/bin/abx.ts`; `cli/main.ts` owns the root command and
loads command modules lazily through the fixed `command_surface.ts` table.
Commander handles parsing/help through the declarations in `cli/kit.ts`.
There is no `src/framework/` directory. Only use attributes actually declared by
`OptionAttrs`, `ArgumentAttrs` and `CommandAttrs`; former Click factories are not
an API of this CLI.

## Define and register

```ts
import { command, option } from "../kit.js";
import { getOutput } from "../output.js";
import { handleErrors } from "../error_handler.js";

export const example = command("example", {
  help: "Show an example.",
  params: [option(["--name"], { default: "example", help: "Name to show" })],
  callback: handleErrors(async (ctx, params) => {
    getOutput(ctx).data({ name: params.name });
  }),
});
```

Add the exported command to the appropriate existing group or the fixed root
surface. A new root module also needs a literal import in `COMMAND_MODULES` so
SEA bundling includes it. Keep host configuration, provider selection and
feature gating in the established paths; do not bypass them with direct cloud
calls. `mainSeams.importModule` is the lazy-loader test seam.

A lazy export may also be a zero-argument factory returning a fresh `Command`.
`createProviderGroup` uses this to compose invocation-local operation leaves from
static Provider metadata without mutating a shared command map. Use `helpFooter`
for context that should be computed only when help renders. Provider operations
belong under the fixed `provider run` namespace; their descriptors and handlers
remain in the Provider, not in the host root command table.

## Output and errors

Use `getOutput(ctx)` for result/diagnostic channels. Results go to stdout;
progress, warnings and errors go to stderr. `formatters.ts`, `table.ts`, `io.ts`
and `output.ts` own formatting and terminal I/O. Preserve JSON keys, output
policy, help and exit behavior. `handleErrors` maps domain errors to exit codes.
The existing command/root import cycle is retained by this cleanup; it is not
an invitation to add other dependencies on the entry point.

## Verify

Exercise the command with `tests/helpers/cliRunner.ts`, including observable
success/failure behavior and output channels. Run typecheck, lint, build, the
full test suite and parity coverage. For changes to command output regenerate
the affected captures through `scripts/capture-cli-evidence.mjs` and review the
result; never delete golden files. Real-component acceptance and the owner
`.agents` record follow the repository definition of done.

Named local session persistence and the former Image/TemplateManager SDK ports
are outside the CLI. See the [retirement guide](../../../docs/en/design/cli-module-retirement.md).

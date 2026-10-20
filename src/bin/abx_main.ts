/**
 * `abx` executable: runs the root click group in standalone mode and exits with its exit code.
 *
 * Ctrl+C outside an interactive prompt behaves like Click on Python's `KeyboardInterrupt`: a blank line, `Aborted!`
 * on stderr, exit code 1.
 */

import { drainRealStreams, finalizeStreams, writeFdSync } from "../cli/io.js";
import { main } from "../cli/main.js";
import { STANDARD_LICENSES } from "../standard_cli/notices.js";
import { RUNTIME_DEPENDENCY_NOTICES } from "../licenses/runtime_dependencies.js";
import { dispatchStandard } from "../standard_cli/dispatch.js";

void (async () => {
  try {
    if (process.argv.length === 3 && process.argv[2] === "--licenses") {
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(STANDARD_LICENSES + RUNTIME_DEPENDENCY_NOTICES, (error) => error ? reject(error) : resolve());
      });
      return;
    }
    if (await dispatchStandard(process.argv.slice(2))) {
      await drainRealStreams();
      process.exit(finalizeStreams(0));
    }
    process.on("SIGINT", () => {
      writeFdSync(2, "\nAborted!\n");
      process.exit(1);
    });
    const code = await main();
    await drainRealStreams();
    process.exit(finalizeStreams(code));
  } catch (e) {
    await drainRealStreams();
    const err = e instanceof Error ? (e.stack ?? e.message) : String(e);
    writeFdSync(2, `${err}\n`);
    process.exit(finalizeStreams(1));
  }
})();

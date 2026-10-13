/**
 * `abx` executable: runs the root click group in standalone mode and exits with its exit code.
 *
 * Ctrl+C outside an interactive prompt behaves like Click on Python's `KeyboardInterrupt`: a blank line, `Aborted!`
 * on stderr, exit code 1.
 */

import { drainRealStreams, finalizeStreams, writeFdSync } from "../cli/io.js";
import { main } from "../cli/main.js";

process.on("SIGINT", () => {
  writeFdSync(2, "\nAborted!\n");
  process.exit(1);
});

void (async () => {
  try {
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

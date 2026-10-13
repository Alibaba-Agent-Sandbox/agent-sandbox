/**
 * Side-effect module: point `HOME` at a throw-away directory and disable the keychain.
 *
 * Importing `cli/main.js` can read (and a command can write) `~/.abx`. Import this file FIRST in any test that imports
 * `main.js` so that nothing touches the developer's real home directory:
 *
 * ```ts
 * import "../_support/isolatedHome.js";
 * import { cli } from "../../src/cli/main.js";
 * ```
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env["ABX_TEST_HOME_ISOLATED"]) {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-home-"));
  process.env["HOME"] = home;
  process.env["USERPROFILE"] = home;
  process.env["ABX_NO_KEYCHAIN"] = "1";
  process.env["ABX_TEST_HOME_ISOLATED"] = "1";
  process.on("exit", () => {
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
}

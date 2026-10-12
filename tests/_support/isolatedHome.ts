/**
 * Side-effect module: point `HOME` at a throw-away directory and disable the keychain.
 *
 * `cli/main.ts` merges the `[shortcuts]` of `~/.ebx/config.toml` when it is imported (and creates the default file on a
 * fresh install), exactly like the Python module. Import this file FIRST in any test that imports `main.js` so that the
 * bootstrap never touches the developer's real home directory:
 *
 * ```ts
 * import "../_support/isolatedHome.js";
 * import { cli } from "../../src/cli/main.js";
 * ```
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env["EBX_TEST_HOME_ISOLATED"]) {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ebx-home-"));
  process.env["HOME"] = home;
  process.env["USERPROFILE"] = home;
  process.env["EBX_NO_KEYCHAIN"] = "1";
  process.env["EBX_TEST_HOME_ISOLATED"] = "1";
  process.on("exit", () => {
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
}

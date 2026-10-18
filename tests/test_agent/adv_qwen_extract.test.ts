/** Adversarial review fix (AT-04): qwen-code standalone archive extraction keeps the archive's directory modes. */
import { statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { _extractTar } from "../../src/agent/qwen_code.js";
import {
  ORACLE_BIN,
  sandbox,
  ustar,
  useAdvSandboxes,
} from "../helpers/advAgentTemplate.js";

useAdvSandboxes();

describe("ADV-agent-template: qwen-code standalone extraction", () => {
  it.skipIf(!!ORACLE_BIN)(
    "ADV-agent-template-08 extracted directory members keep the archive mode (0755), not mkdir's 0700",
    () => {
      const sb = sandbox();
      const archive = path.join(sb.root, "q.tar.gz");
      writeFileSync(
        archive,
        gzipSync(
          ustar([
            { name: "qwen-code/", type: "dir", mode: 0o755 },
            { name: "qwen-code/bin/", type: "dir", mode: 0o755 },
            {
              name: "qwen-code/bin/qwen",
              type: "file",
              mode: 0o755,
              data: "#!/bin/sh\n",
            },
          ]),
        ),
      );
      const dest = path.join(sb.root, "out");
      // data_filter leaves directory modes to normal creation permissions. Pin the
      // oracle's umask so a restricted caller umask does not change this assertion.
      const savedUmask = process.umask(0o022);
      try {
        _extractTar(archive, dest);
      } finally {
        process.umask(savedUmask);
      }
      const mode = (p: string) => (statSync(p).mode & 0o777).toString(8);
      expect([
        mode(path.join(dest, "qwen-code")),
        mode(path.join(dest, "qwen-code/bin")),
        mode(path.join(dest, "qwen-code/bin/qwen")),
      ]).toEqual(["755", "755", "755"]);
    },
  );
});

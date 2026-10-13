/**
 * Adversarial review fixes (agent-template area): `template install` / `init --from` / `build` behave like the Python
 * oracle (tarfile / pathlib / shutil.copytree / PyYAML `safe_load` semantics). See tests/helpers/advAgentTemplate.ts.
 */
import { chmodSync, existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DOCKERFILE,
  TEMPLATE_YAML,
  abx,
  localInstall,
  put,
  sandbox,
  useAdvSandboxes,
} from "../helpers/advAgentTemplate.js";

useAdvSandboxes();

describe("ADV-agent-template: template install / init / build", () => {
  it("ADV-agent-template-01 a zero-byte tarball body is reported as 'empty file' (tarfile.ReadError), not 'not a gzip file'", async () => {
    const sb = sandbox();
    const srv = http.createServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "application/gzip",
        "content-length": "0",
      });
      res.end();
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    try {
      const { port } = srv.address() as { port: number };
      const r = await abx(sb, [
        "template",
        "install",
        "owner/repo",
        "--registry-url",
        `http://127.0.0.1:${port}`,
        "--download-only",
      ]);
      expect(r.stderr.split("\n")[0]).toBe("Unexpected error: empty file");
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  it("ADV-agent-template-02 --alias ../../x prints and creates the cache path un-normalised (Path / alias keeps '..')", async () => {
    const sb = sandbox();
    put(sb.work, "src/Dockerfile", DOCKERFILE);
    put(sb.work, "src/template.yaml", TEMPLATE_YAML);
    const r = await abx(sb, [
      "template",
      "install",
      path.join(sb.work, "src"),
      "--registry-type",
      "local",
      "--download-only",
      "--alias",
      "../../escape",
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      `Cached  ${sb.home}/.abx/templates/../../escape\n`,
    );
    expect(existsSync(path.join(sb.home, ".abx", "templates"))).toBe(true);
    expect(existsSync(path.join(sb.home, "escape", "Dockerfile"))).toBe(true);
  });

  it("ADV-agent-template-03 a list-valued template.yaml is rejected as not a mapping", async () => {
    const sb = sandbox();
    const r = await localInstall(sb, "- a\n- b\n");
    expect(r.code).toBe(1);
    expect(r.stderr.split("\n")[0]).toMatch(/^Unexpected error: .*template\.yaml must be a YAML mapping$/);
  });

  it("ADV-agent-template-04 safe_load accepts !!binary / !!omap / !!set tags in template.yaml", async () => {
    const cases = [
      "x: !!binary aGVsbG8=\n",
      "x: !!omap [a: 1, b: 2]\n",
      "x: !!set {a, b}\n",
    ];
    const got: string[] = [];
    for (const extra of cases) {
      const sb = sandbox();
      const r = await localInstall(sb, `name: x\nversion: "1"\n${extra}`);
      got.push(`${r.code}:${r.stderr.split("\n")[0]}`);
    }
    expect(got).toEqual(["0:", "0:", "0:"]);
  });

  it("ADV-agent-template-05 template build with a list-valued name prints Python's repr of the list in the plan", async () => {
    const sb = sandbox();
    put(sb.work, "tpl/Dockerfile", DOCKERFILE);
    put(sb.work, "tpl/template.yaml", "name: [a]\nversion: '1'\n");
    const r = await abx(
      sb,
      [
        "template",
        "build",
        path.join(sb.work, "tpl"),
        "--acr-namespace",
        "ns",
        "--yes",
      ],
      {
        ALICLOUD_ACCESS_KEY_ID: "ak-test",
        ALICLOUD_ACCESS_KEY_SECRET: "sk-test",
      },
    );
    expect(r.stdout.startsWith("Template: ['a']\nACR: ns/['a']:latest\n")).toBe(
      true,
    );
  });

  it("ADV-agent-template-06 template init --from tolerates a destination inside the source (copytree recursion)", async () => {
    const sb = sandbox();
    put(sb.work, "src/Dockerfile", DOCKERFILE);
    put(sb.work, "src/template.yaml", TEMPLATE_YAML);
    put(sb.work, "src/commands.py", "print(1)\n");
    const r = await abx(sb, [
      "template",
      "init",
      path.join(sb.work, "src", "dest"),
      "--from",
      path.join(sb.work, "src"),
    ]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("Template files copied from");
    expect(existsSync(path.join(sb.work, "src", "dest", "Dockerfile"))).toBe(
      true,
    );
  });

  it.skipIf(process.getuid?.() === 0)(
    "ADV-agent-template-07 template init --from keeps copying the other files when one source file is unreadable",
    async () => {
      const sb = sandbox();
      put(sb.work, "src/Dockerfile", DOCKERFILE);
      put(sb.work, "src/template.yaml", TEMPLATE_YAML);
      put(sb.work, "src/commands.py", "print(1)\n");
      chmodSync(path.join(sb.work, "src", "commands.py"), 0o000);
      const r = await abx(sb, [
        "template",
        "init",
        path.join(sb.work, "dest"),
        "--from",
        path.join(sb.work, "src"),
      ]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("OS error: [('");
      expect(existsSync(path.join(sb.work, "dest", "Dockerfile"))).toBe(true);
      expect(existsSync(path.join(sb.work, "dest", "template.yaml"))).toBe(
        true,
      );
    },
  );
});

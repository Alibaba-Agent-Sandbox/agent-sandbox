import * as health from "../../scripts/lib/repository-health.mjs";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";


describe("repository health syntax and historical provenance", () => {
  it("accepts only the actual repository and Issue endpoint", () => {
    expect(health.canonicalRepository("git+https://github.com/alibaba-agent-sandbox/agent-sandbox.git")).toBe(true);
    expect(health.canonicalRepository("https://github.com/Alibaba-Agent-Sandbox/agent-sandbox/issues", true)).toBe(true);
    for (const wrong of ["https://github.com/another/agent-sandbox", "https://github.com/alibaba-agent-sandbox/cli", "https://github.com/alibaba-agent-sandbox/agent-sandbox/issues/extra"]) {
      expect(health.canonicalRepository(wrong, true)).toBe(false);
    }
  });
  it("extracts real imports without parsing comments and string examples as code", () => {
    const text = `// import "comment-package";
      const example = 'import "KEY=VALUE"';
      const dynamic = \`import "\${providerId}"\`;
      import "real-side-effect";
      import { tool } from "@scope/package/subpath";
      export * from "real-export";
      const value = require("real-require/subpath");
      const lazy = import("real-dynamic");`;
    expect(health.imports(text, "fixture.ts")).toEqual(["real-side-effect", "@scope/package/subpath", "real-export", "real-require/subpath", "real-dynamic"]);
  });
  it("keeps a real undeclared runtime package blocking in the complete checker", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-health-regression-"));
    try {
      fs.mkdirSync(path.join(root, "scripts/lib"), { recursive: true });
      fs.mkdirSync(path.join(root, "src"));
      fs.symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
      for (const file of ["scripts/check-repo-health.sh", "scripts/lib/repository-health.mjs"]) fs.copyFileSync(file, path.join(root, file));
      fs.writeFileSync(path.join(root, "scripts/repository-health-history.json"), "{}");
      fs.writeFileSync(path.join(root, "src/fixture.ts"), `import value from "undeclared-runtime/subpath";\nconst example = 'import "KEY=VALUE"';`);
      const run = (dependencies: Record<string, string>): string => {
        fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies }));
        const result = spawnSync("bash", ["scripts/check-repo-health.sh", "--quiet"], { cwd: root, encoding: "utf8", env: { ...process.env, NODE_PATH: path.resolve("node_modules") } });
        expect(result.error).toBeUndefined();
        return result.stdout;
      };
      expect(run({})).toContain("src/ imports packages missing from dependencies: undeclared-runtime");
      expect(run({})).not.toContain("dependencies: KEY=VALUE");
      expect(run({ "undeclared-runtime": "1.0.0" })).not.toContain("src/ imports packages missing from dependencies:");
      fs.unlinkSync(path.join(root, "node_modules"));
      expect(run({})).toContain("repository-health requires the lockfile development toolchain; run npm ci");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("preserves the parity oracle while rejecting product Python files", () => {
    for (const path of ["parity/diff/oracle.py", "parity/review/inventory/doc_paths.py", ".agents/research/helper.py", "tests/fixtures/templates/python-hello/commands.py"]) expect(health.productPython(path)).toBe(false);
    for (const path of ["src/old_cli.py", "scripts/old_cli.py", "src/parity/old.py", "parity-lookalike/old.py"]) expect(health.productPython(path)).toBe(true);
  });
  it("ignores removed-CLI discussion but rejects executable invocations", () => {
    expect(health.removedCli('// formerly python -m agent_sandbox.cli\nconst value = "safe";', "script.mjs")).toBe(false);
    expect(health.removedCli('# python -m agent_sandbox.cli\necho safe', "script.sh")).toBe(false);
    expect(health.removedCli('exec("python -m agent_sandbox.cli");', "script.mjs")).toBe(true);
    expect(health.removedCli('python3 -m agent_sandbox.cli --help', "script.sh")).toBe(true);
  });
  it("recognizes only unchanged registered historical bytes and specific findings", () => {
    const path = ".agents/evidence/verify/2026-10-12-fixture.md";
    const bytes = Buffer.from("historical capture");
    const entry = { sha256: createHash("sha256").update(bytes).digest("hex"), localPaths: ["captured-paths"] };
    const manifest = { [path]: entry, "src/product.ts": entry };
    expect(health.historicalContext(manifest, path, bytes, "localPaths", "captured-paths")).toBe(true);
    expect(health.historicalContext(manifest, path, Buffer.from("edited capture"), "localPaths", "captured-paths")).toBe(false);
    expect(health.historicalContext(manifest, path, bytes, "slugs", "unknown-reference")).toBe(false);
    expect(health.historicalContext(manifest, "src/product.ts", bytes, "localPaths", "captured-paths")).toBe(false);
  });
});

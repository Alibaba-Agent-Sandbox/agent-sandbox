import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SDK_ROOT = path.resolve(CLI_ROOT, "../python-sdk");
const BIN = path.join(CLI_ROOT, "dist/bin/abx.js");
const haveBin = existsSync(BIN);
const haveSdk = existsSync(path.join(SDK_ROOT, "docs"));

function read(rel: string): string {
  return readFileSync(path.join(CLI_ROOT, rel), "utf8");
}

function walkMd(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walkMd(p, out);
    else if (n.endsWith(".md")) out.push(p);
  }
  return out;
}

function abx(args: string[], env: Record<string, string> = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "adv-compl-"));
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: home, ABX_NO_KEYCHAIN: "1", NO_COLOR: "1", ...env },
    timeout: 20000,
  });
}

describe("completeness (adversarial)", () => {
  it("ADV-completeness-01 maintainer docs do not point at files that do not exist", () => {
    const docs = ["AGENTS.md", "parity/KNOWN-GAPS.md", "parity/blocked-tests.md", "docs/PORTING.md", "tests/integration/README.md"];
    const missing: string[] = [];
    for (const rel of docs) {
      read(rel)
        .split("\n")
        .forEach((line, i) => {
          for (const m of line.matchAll(/`((?:src|tests|scripts|parity|docs)\/[^`\s*<>{}]+\.(?:ts|mjs|md|json|sh))`/g)) {
            const target = m[1].replace(/:\d+$/, "");
            if (!existsSync(path.join(CLI_ROOT, target))) missing.push(`${rel}:${i + 1} -> ${target}`);
          }
        });
    }
    expect(missing).toEqual([]);
  });

  it("ADV-completeness-02 AGENTS.md does not claim the evidence capture script stayed in python-sdk", () => {
    const text = read("AGENTS.md");
    const stale = text.split("\n").filter((l) => l.includes("capture_cli_evidence.py") && !l.includes("capture-cli-evidence.mjs"));
    expect(existsSync(path.join(CLI_ROOT, "scripts/capture-cli-evidence.mjs"))).toBe(true);
    expect(stale).toEqual([]);
  });

  it("ADV-completeness-03 the canonical sandbox key is E2B_API_KEY and retired names are not aliases", () => {
    const keys = read("docs/design/fixtures/config-keys.json");
    expect(keys).toContain('"env": "E2B_API_KEY"');
    expect(keys).not.toMatch(/"ABX_SANDBOX_API_KEY"/);
    expect(keys).not.toMatch(/"SANDBOX_API_KEY"/);
    expect(keys).toContain('"env": "ALIBABA_CLOUD_REGION_ID"');
    expect(keys).toContain('"env": "ALICLOUD_ACCESS_KEY_ID"');
    expect(keys).toContain('"env": "ALICLOUD_ACCESS_KEY_SECRET"');
  });

  it.skipIf(!haveBin || !haveSdk)(
    "ADV-completeness-04 python-sdk user docs only advertise `abx` commands the Node CLI has",
    () => {
      const roots = [path.join(SDK_ROOT, "docs/en/guide"), path.join(SDK_ROOT, "docs/en/reference"), path.join(SDK_ROOT, "examples")];
      const claims = new Map<string, string>();
      for (const f of roots.flatMap((r) => walkMd(r))) {
        if (/migrating-from-0\.2/.test(f)) continue;
        readFileSync(f, "utf8")
          .split("\n")
          .forEach((line, i) => {
            const m = /`abx (provider)(?: (list|info|install|doctor|update|uninstall|default|config))?/.exec(line) ?? /`abx (config) (check|migrate)\b/.exec(line);
            if (m) claims.set(`${m[1]}${m[2] ? " " + m[2] : ""}`, `${path.relative(SDK_ROOT, f)}:${i + 1}`);
          });
      }
      const broken: string[] = [];
      for (const [cmd, where] of claims) {
        const r = abx([...cmd.split(" "), "--help"]);
        if (r.status !== 0) broken.push(`${where}: abx ${cmd} --help exited ${r.status}`);
      }
      expect(broken).toEqual([]);
    },
  );

  const ADV_KEY = "sk-" + "adv-canonical-123456";
  it.skipIf(!haveBin)("ADV-completeness-05 only E2B_API_KEY is honoured", () => {
    const viaRetired = abx(["config", "get", "sandbox_api_key"], { ABX_SANDBOX_API_KEY: ADV_KEY });
    const viaCanonical = abx(["config", "get", "sandbox_api_key"], { E2B_API_KEY: ADV_KEY });
    expect(viaRetired.stdout.trim()).toBe("(not set)");
    expect(viaCanonical.stdout.trim()).toMatch(/^sk-/);
    expect(viaCanonical.stdout).not.toContain(ADV_KEY);
  });
});

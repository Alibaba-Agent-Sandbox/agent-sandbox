/** Language-neutral conformance fixtures run against the TypeScript implementation (port of `test_conformance.py`). */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { configFieldToKey, type ConfigField } from "../../src/providers/base.js";
import { exitCodeFor, mapError } from "../../src/providers/epp.js";
import * as store from "../../src/providers/store.js";
import { ProviderSchema, builtinSchema, resolveAll } from "../../src/transport/config_layers.js";
import { CLI_ONLY_KEYS } from "../../src/utils/cli_config_keys.js";
import { exportSchema } from "../../src/utils/config_keys.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "..", "fixtures");

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function load(name: string): J {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf-8"));
}

// The vectors come from the Python registry, which does not declare the CLI-only keys (src/utils/cli_config_keys.ts).
const CLI_ONLY_NAMES = new Set(CLI_ONLY_KEYS.map((k) => k.key));

describe("resolution vectors", () => {
  for (const vector of load("config-resolution-vectors.json")["vectors"] as J[]) {
    it(`test_resolution_vectors[${vector["name"]}]`, () => {
      const src = vector["sources"];
      const sources = { overrides: src.overrides, environ: src.environ, dotenv: src.dotenv, toml: src.toml };
      const spec = vector["provider_schema"] as J | undefined | null;
      let schema: ProviderSchema;
      if (!spec) schema = builtinSchema();
      else {
        const keys = (spec["fields"] as J[]).map((f) =>
          configFieldToKey(
            {
              key: f["key"],
              type: f["type"] ?? "str",
              secret: f["secret"] ?? false,
              default: f["default"] ?? null,
              env: f["env"] ?? [],
              choices: f["choices"] ?? [],
            } as ConfigField,
            vector["provider"],
          ),
        );
        schema = new ProviderSchema(vector["provider"], keys, new Set(spec["inherit"]), spec["derive"], spec["endpoint_defaults"]);
      }
      const { resolved } = resolveAll(sources, schema);
      const got: J = {};
      for (const [k, r] of resolved) if (!CLI_ONLY_NAMES.has(k)) got[k] = { value: r.value, source: r.layer, name: r.name };
      expect(got).toEqual(vector["expect"]);
    });
  }
});

describe("tree digest vectors", () => {
  const entriesOf = (vector: J): store.FileEntry[] =>
    (vector["files"] as J[]).map((f) => ({ path: f["path"], executable: f["executable"], data: Buffer.from(f["content_b64"], "base64") }));

  for (const vector of load("tree-digest-vectors.json")["vectors"] as J[]) {
    it(`test_tree_digest_vectors[${vector["name"]}]`, () => {
      const entries = entriesOf(vector);
      expect(store.digestFiles(entries)).toBe(vector["tree_sha256"]);
      expect(store.digestFiles([...entries].reverse())).toBe(vector["tree_sha256"]);
    });
  }

  it("test_tree_digest_of_an_installed_directory_matches_entries", () => {
    const vec = (load("tree-digest-vectors.json")["vectors"] as J[]).find((v) => v["name"] === "nested and unicode paths") as J;
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "abx-digest-"));
    try {
      for (const f of vec["files"] as J[]) {
        const target = path.join(tmp, ...String(f["path"]).split("/"));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(f["content_b64"], "base64"));
        fs.chmodSync(target, f["executable"] ? 0o755 : 0o644);
      }
      expect(store.digestDir(tmp)).toBe(vec["tree_sha256"]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("epp error vectors", () => {
  for (const vector of load("epp-error-mapping.json")["vectors"] as J[]) {
    it(`test_epp_error_vectors[${vector["name"]}]`, () => {
      const exc = mapError(vector["error"], vector["provider_id"], vector["secrets"]);
      const exp = vector["expect"];
      expect(exc.constructor.name).toBe(exp["class"]);
      expect(exc.code).toBe(exp["sdk_code"]);
      expect(exitCodeFor(exc)).toBe(exp["exit_code"]);
      expect(exc.message).toBe(exp["message"]);
      expect(exc.suggestion).toBe(exp["suggestion"]);
      for (const secret of vector["secrets"] as string[]) expect(exc.message).not.toContain(secret);
    });
  }
});

describe("config keys fixture", () => {
  it("test_config_keys_fixture_matches_registry", () => {
    expect(load("config-keys.json")).toEqual(exportSchema());
    const keys = new Set((load("config-keys.json")["keys"] as J[]).map((k) => `${k["scope"]}/${k["key"]}`));
    expect(keys.has("core/sandbox_api_key") && keys.has("alicloud-express/region")).toBe(true);
  });
});

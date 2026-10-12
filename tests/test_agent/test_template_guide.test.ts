/**
 * The server SDK reference given to the coding agent must match the real SDK.
 *
 * Port of `tests/test_agent/test_template_guide.py`. The guide is prompt text, so nothing else would notice if
 * `easy_sandbox.server` changed and the guide kept teaching the agent an API that no longer exists. The Python
 * facts (capability groups, `__all__`, the `serve` default port) and the reference `commands.py` run are obtained
 * from the real container-side package through `python3` (see `tests/helpers/agentSupport.ts` for how the package
 * is located: `EBX_SERVER_SDK_SRC`, `ORIG_REPO`, or the monorepo `python-sdk/`). Those cross-checks are skipped (with a
 * notice on stderr) when `python3` or the package is unavailable; the `TestGuideGolden` tests need neither.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as templateGuide from "../../src/agent/template_guide.js";
import {
  REFERENCE_COMMANDS_PY,
  REQUIRED_TEMPLATE_FILES,
  SERVER_ENTRYPOINT,
  SERVER_PORT,
  TEMPLATE_GUIDE,
  buildTemplateGuide,
} from "../../src/agent/template_guide.js";
import { STANDARD_CAPABILITIES } from "../../src/models/template.js";
import { FIXTURES, findPython, itWithPython, itWithServerSdk, readGolden, serverSdkPythonPath } from "../helpers/agentSupport.js";

const serverIt = itWithServerSdk(it);
const pythonIt = itWithPython(it);

interface ServerFacts {
  all: string[];
  groups: string[];
  serve_default_port: number;
}

const PROBE = join(FIXTURES, "server_probe.py");

function probeEnv(): { python: string; env: NodeJS.ProcessEnv } {
  const python = findPython();
  if (python === null) throw new Error("python3 is required to check the guide against the real server SDK");
  const sdk = serverSdkPythonPath(python);
  if (sdk === null) {
    throw new Error("easy_sandbox.server is not importable: set EBX_SERVER_SDK_SRC or ORIG_REPO");
  }
  return { python, env: { ...process.env, PYTHONPATH: sdk, PYTHONDONTWRITEBYTECODE: "1" } };
}

function runProbe(mode: "facts" | "reference", input?: string): any {
  const { python, env } = probeEnv();
  const r = spawnSync(python, [PROBE, mode], { env, input, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`server probe failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const facts: () => ServerFacts = (() => {
  let cached: ServerFacts | null = null;
  return () => (cached ??= runProbe("facts") as ServerFacts);
})();

describe("TestConstants", () => {
  it("test_required_files_include_the_server_entry_point", () => {
    expect(REQUIRED_TEMPLATE_FILES).toContain(SERVER_ENTRYPOINT);
    for (const name of ["Dockerfile", "template.yaml"]) expect(REQUIRED_TEMPLATE_FILES).toContain(name);
  });

  serverIt("test_port_matches_the_server_default", () => {
    expect(facts().serve_default_port).toBe(SERVER_PORT);
  });

  it("test_public_names_are_exported", () => {
    for (const name of templateGuide.__all__) {
      expect(name in templateGuide).toBe(true);
    }
  });
});

describe("TestGuideText", () => {
  it("test_explains_why_a_server_is_needed", () => {
    const alicloud = buildTemplateGuide("create", "alicloud-express");
    const generic = buildTemplateGuide("create", "opensandbox");
    expect(alicloud).toContain("HTTP");
    expect(alicloud).toContain("commands.py");
    expect(alicloud).toContain(`EXPOSE ${SERVER_PORT}`);
    expect(alicloud).toContain("FROM fc-e2b-registry.<region>.cr.aliyuncs.com/runtime/base:<tag>");
    expect(alicloud).not.toMatch(/(?:^|\n)[ \t]*CMD[ \t]/);
    expect(generic).toContain('CMD ["python3", "commands.py"]');
    expect(generic).toContain("FROM python:3.12-slim");
    expect(generic).toContain("opensandbox");
    expect(generic).toContain("has no template profile");
    expect(generic).not.toContain("fc-e2b-registry");
  });

  it("test_sdk_install_pattern_is_the_established_one", () => {
    expect(TEMPLATE_GUIDE).toContain("COPY *.whl /tmp/");
    expect(TEMPLATE_GUIDE).toContain("pip install --no-cache-dir easy-sandbox-server");
  });

  it("test_no_clarification_wording_leaks_into_the_prompt", () => {
    expect(TEMPLATE_GUIDE).not.toContain("澄清");
  });

  serverIt("test_every_capability_group_it_names_exists", () => {
    // `CapabilityGroup.X` is the guide's own placeholder, not a group.
    const named = new Set([...TEMPLATE_GUIDE.matchAll(/CapabilityGroup\.([A-Z_]+)/g)].map((m) => m[1] as string));
    named.delete("X");
    expect(named.size).toBeGreaterThan(0);
    const groups = new Set(facts().groups);
    for (const name of named) expect(groups.has(name)).toBe(true);
  });

  serverIt("test_describes_every_capability_group", () => {
    // Groups added to the server SDK after the ported guide text (python-sdk/docs/*/design/cli-followups.md section 5
    // schedules the guide update, see parity/KNOWN-GAPS.md): exempt only while the guide really lacks them.
    const taughtLater = new Set(["AGENTS"]);
    for (const group of facts().groups) {
      if (taughtLater.has(group) && !TEMPLATE_GUIDE.includes(group)) continue;
      expect(TEMPLATE_GUIDE).toContain(group);
    }
  });

  it("test_default_disabled_groups_are_called_out", () => {
    expect(TEMPLATE_GUIDE).toMatch(/DEV_TOOLS[^\n]*默认关闭/);
    expect(TEMPLATE_GUIDE).toMatch(/BROWSER[^\n]*默认关闭/);
  });

  it("test_capability_tokens_are_the_standard_ones", () => {
    const line = TEMPLATE_GUIDE.split("\n").find((entry) => entry.includes("`capabilities` 取自"));
    expect(line).toBeDefined();
    const afterMarker = (line as string).split("取自").slice(1).join("取自");
    const head = afterMarker.split("，")[0] as string;
    const tokens = new Set(head.match(/[a-z]+/g) ?? []);
    expect(tokens).toEqual(new Set(STANDARD_CAPABILITIES));
  });

  serverIt("test_imports_shown_in_the_guide_exist", () => {
    const block = /from easy_sandbox\.server import \(([\s\S]*?)\)/.exec(TEMPLATE_GUIDE);
    expect(block).not.toBeNull();
    const names = (block as RegExpExecArray)[1]!
      .replace(/\n/g, " ")
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(facts().all, name).toContain(name);
  });
});

describe("TestReferenceCommandsPy", () => {
  pythonIt("test_is_valid_python", () => {
    const r = spawnSync(findPython() as string, ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], {
      input: REFERENCE_COMMANDS_PY,
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
  });

  serverIt("test_only_imports_public_server_names", () => {
    const ran = runProbe("reference", REFERENCE_COMMANDS_PY);
    expect(ran.imported.length).toBeGreaterThan(0);
    const all = new Set(facts().all);
    for (const name of ran.imported as string[]) expect(all.has(name), name).toBe(true);
    expect(ran.imports_public).toBe(true);
  });

  serverIt("test_loads_registers_a_command_and_serves_on_the_documented_port", () => {
    // Run the reference exactly like the template e2e tests do: serve() patched out.
    const ran = runProbe("reference", REFERENCE_COMMANDS_PY);
    expect(ran.hello_registered).toBe(true);
    expect(ran.hello_result).toBe("Hello, Ada!");
    // Imported as a module: serve() is under __main__ so --commands does not bind the port.
    expect(ran.serve_call_count).toBe(0);
    expect(REFERENCE_COMMANDS_PY).toContain('if __name__ == "__main__":');
    expect(REFERENCE_COMMANDS_PY).toContain(`server.serve(port=${SERVER_PORT})`);
    expect(ran.route_found).toBe(true);
    expect(ran.params).toEqual({ name: "Ada" });
  });

  it("test_registry_is_frozen_before_serving", () => {
    const source = REFERENCE_COMMANDS_PY;
    expect(source.indexOf("registry.freeze()")).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("registry.freeze()")).toBeLessThan(source.indexOf(".serve("));
    expect(source.indexOf('if __name__ == "__main__":')).toBeLessThan(source.indexOf(".serve("));
  });

  for (const marker of ["FILE_OPS", "PROCESS", "SYSTEM"]) {
    it(`test_enables_the_groups_the_capabilities_example_relies_on [${marker}]`, () => {
      expect(REFERENCE_COMMANDS_PY).toContain(`CapabilityGroup.${marker}`);
    });
  }
});

describe("TestGuideGolden", () => {
  const golden = readGolden();

  it("keeps the required files in the original order", () => {
    expect([...REQUIRED_TEMPLATE_FILES]).toEqual(golden.required_template_files);
  });

  it("reference commands.py is provider-free and serves only as main", () => {
    expect(REFERENCE_COMMANDS_PY).toContain("from easy_sandbox.server import");
    expect(REFERENCE_COMMANDS_PY).not.toMatch(/alicloud|opensandbox|easy_sandbox\.providers/);
    expect(REFERENCE_COMMANDS_PY).toContain('if __name__ == "__main__":');
    const serveAt = REFERENCE_COMMANDS_PY.indexOf("server.serve(port=9000)");
    expect(serveAt).toBeGreaterThan(REFERENCE_COMMANDS_PY.indexOf('if __name__ == "__main__":'));
  });

  it("rejects unknown modes like the Python ValueError", () => {
    expect(() => buildTemplateGuide("nope")).toThrow("Unknown template guide mode 'nope'; expected 'create' or 'adopt'.");
  });
});

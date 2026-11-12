import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDevsProject } from "../../src/template/devs_project.js";

const folders: string[] = [];
function project(): { root: string; file: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-devs-test-")); folders.push(root);
  const file = path.join(root, "template.yaml"); fs.writeFileSync(file, "specVersion: 1\n");
  return { root, file };
}
afterEach(() => { for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });

describe("official native Devs project resolution", () => {
  it("preserves string scalars and multiline content through the actual native parser", () => {
    const { file } = project();
    const literals = { FLAG: "on", WHEN: "2026-11-12", LEADING_ZERO: "0123", MULTILINE: "first line\nsecond line\n" };
    const value = resolveDevsProject({ specVersion: 1, name: "scalars", sandbox: { instance: { envs: {
      ...literals, FROM_ENV: "${env('ABX_TEST_WIRE_STRING')}",
    } } }, deployment: { edition: "3.0.0", vars: { memory: 4096 }, resources: {
      api: { component: "fc3@0.1.26", props: { memorySize: "${vars.memory}", environmentVariables: literals } },
    } } }, file, { ...process.env, ABX_TEST_WIRE_STRING: "2026-11-12" });
    expect(value.document.sandbox).toEqual({ instance: { envs: { ...literals, FROM_ENV: "2026-11-12" } } });
    expect(value.document.deployment).toMatchObject({ resources: { api: { props: { memorySize: 4096, environmentVariables: literals } } } });
  });

  it("resolves native vars, environment and private application payload without renaming FC props", () => {
    const { file } = project();
    const value = resolveDevsProject({ specVersion: 1, name: "test", sandbox: { instance: { envs: { MODEL: "${vars.model}" } } },
      application: { bindings: { model: { apiKey: "${env('ABX_TEST_MODEL_KEY')}" } } },
      deployment: { edition: "3.0.0", vars: { model: "fixture-model" }, resources: {
        api: { component: "fc3@0.1.26", props: { memorySize: 4096, environmentVariables: { MODEL: "${vars.model}" } } },
      } } }, file, { ...process.env, ABX_TEST_MODEL_KEY: "private-fixture-value" });
    expect(value.document.application).toEqual({ bindings: { model: { apiKey: "private-fixture-value" } } });
    expect(value.document.sandbox).toEqual({ instance: { envs: { MODEL: "fixture-model" } } });
    expect(value.document.deployment).toMatchObject({ resources: { api: { props: { memorySize: 4096, environmentVariables: { MODEL: "fixture-model" } } } } });
  });

  it("preserves native output references and their dependency order", () => {
    const { file } = project();
    const value = resolveDevsProject({ specVersion: 1, deployment: { edition: "3.0.0", resources: {
      domain: { component: "fc3-domain@0.0.29", props: { target: "${resources.api.output.endpoint}" } },
      api: { component: "fc3@0.1.26", props: { memorySize: 4096 } },
    } } }, file);
    expect(value.steps.map(step => step.resource)).toEqual(["api", "domain"]);
    expect(value.document.deployment).toMatchObject({ resources: { domain: { props: { target: "${resources.api.output.endpoint}" } } } });
  });

  it("resolves relative native file references from the actual project directory", () => {
    const { root, file } = project();
    fs.writeFileSync(path.join(root, "values.json"), JSON.stringify({ model: "relative-fixture" }));
    const value = resolveDevsProject({ specVersion: 1, deployment: { edition: "3.0.0", vars: { model: "${json(file('./values.json')).model}" }, resources: {} },
      sandbox: { instance: { envs: { MODEL: "${vars.model}" } } } }, file);
    expect(value.document.sandbox).toEqual({ instance: { envs: { MODEL: "relative-fixture" } } });
  });

  it("contains dotenv changes in the child instead of modifying the CLI environment", () => {
    const { root, file } = project(), key = "ABX_TEST_DEVS_DOTENV";
    const before = process.env[key];
    fs.writeFileSync(path.join(root, ".env"), `${key}=child-only\n`);
    const value = resolveDevsProject({ specVersion: 1, sandbox: { instance: { envs: { VALUE: "${env('ABX_TEST_DEVS_DOTENV')}" } } } }, file);
    expect(value.document.sandbox).toEqual({ instance: { envs: { VALUE: "child-only" } } });
    expect(process.env[key]).toBe(before);
  });

  it("resolves private configuration from its explicit original source after making a secret-free snapshot", () => {
    const original = project(), snapshot = project();
    fs.writeFileSync(path.join(original.root, ".env"), "ABX_TEST_SNAPSHOT_MODEL_KEY=private-snapshot-fixture\n");
    const document = { specVersion: 1, application: { bindings: { model: { apiKey: "${env('ABX_TEST_SNAPSHOT_MODEL_KEY')}" } } } };
    fs.copyFileSync(original.file, snapshot.file);
    expect(fs.existsSync(path.join(snapshot.root, ".env"))).toBe(false);
    const value = resolveDevsProject(document, snapshot.file, process.env, { configurationSource: original.root });
    expect(value.document.application).toEqual({ bindings: { model: { apiKey: "private-snapshot-fixture" } } });
    expect(fs.readFileSync(snapshot.file, "utf8")).not.toContain("private-snapshot-fixture");
    expect(process.env.ABX_TEST_SNAPSHOT_MODEL_KEY).toBeUndefined();
  });

  it("reports a missing environment name and field path without exposing other resolved values", () => {
    const { file } = project();
    const environment = { ...process.env }; delete environment.ABX_TEST_MISSING_MODEL;
    const raw = { specVersion: 1, application: { bindings: { model: { apiKey: "${env('ABX_TEST_MISSING_MODEL')}" }, other: { apiKey: "private-fixture-value" } } } };
    let message = "";
    try { resolveDevsProject(raw, file, environment); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("ABX_TEST_MISSING_MODEL");
    expect(message).toContain("/application/bindings/model/apiKey");
    expect(message).not.toContain("private-fixture-value");
  });

  it("lists action intent and does not execute it while parsing", () => {
    const { root, file } = project(), marker = path.join(root, "must-not-exist");
    const actions = { pre: [{ run: `touch ${marker}` }] };
    const value = resolveDevsProject({ specVersion: 1, deployment: { edition: "3.0.0", actions, resources: {} } }, file);
    expect(value.actions).toEqual([{ scope: "project", definition: actions }]);
    expect(fs.existsSync(marker)).toBe(false);
  });
});

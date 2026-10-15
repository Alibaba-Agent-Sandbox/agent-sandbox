/**
 * Publish-path selection and template.yaml → platform step expansion.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BuildModeError, resolveBuildPlan } from "../../src/template/build_plan.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abx-plan-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function write(dir: string, name: string, text: string): void {
  fs.writeFileSync(path.join(dir, name), text);
}

describe("resolveBuildPlan", () => {
  it("uses a Dockerfile when auto finds one", () => {
    const dir = tempDir();
    write(dir, "Dockerfile", "FROM python:3.12\n");
    write(dir, "template.yaml", "name: demo\nbuild:\n  run: ['echo hi']\nbase:\n  image: python:3.12\n");

    const plan = resolveBuildPlan(dir);

    expect(plan).toEqual({ kind: "dockerfile", dockerfile: path.join(dir, "Dockerfile"), ignoredSteps: true });
  });

  it("expands build declarations when no Dockerfile is present", () => {
    const dir = tempDir();
    write(
      dir,
      "template.yaml",
      [
        "name: demo",
        "base:",
        "  image: python:3.12-slim",
        "build:",
        "  apt_install: [curl]",
        "  pip_install: ['pandas>=2']",
        "  npm_install: [http-server]",
        "  env:",
        "    PYTHONUNBUFFERED: '1'",
        "  run:",
        "    - python -c 'import pandas'",
        "  steps:",
        "    - type: RUN",
        "      args: ['echo done']",
        "",
      ].join("\n"),
    );

    expect(resolveBuildPlan(dir)).toEqual({
      kind: "steps",
      image: "python:3.12-slim",
      steps: [
        { type: "RUN", args: ["apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*"] },
        { type: "RUN", args: ["pip install --no-cache-dir pandas>=2"] },
        { type: "RUN", args: ["npm install -g http-server"] },
        { type: "ENV", args: ["PYTHONUNBUFFERED=1"] },
        { type: "RUN", args: ["python -c 'import pandas'"] },
        { type: "RUN", args: ["echo done"] },
      ],
    });
  });

  it("lets the command flag override a Dockerfile", () => {
    const dir = tempDir();
    write(dir, "Dockerfile", "FROM python:3.12\n");
    write(dir, "template.yaml", "base:\n  image: python:3.12-slim\nbuild:\n  run: ['true']\n");

    const plan = resolveBuildPlan(dir, { mode: "steps" });

    expect(plan.kind).toBe("steps");
  });

  it("lets build.mode in the file win when the flag is auto", () => {
    const dir = tempDir();
    write(dir, "Dockerfile", "FROM python:3.12\n");
    write(dir, "template.yaml", "base:\n  image: python:3.12-slim\nbuild:\n  mode: steps\n  run: ['true']\n");

    expect(resolveBuildPlan(dir, { mode: "auto" }).kind).toBe("steps");
    expect(resolveBuildPlan(dir, { mode: "dockerfile" }).kind).toBe("dockerfile");
  });

  it("rejects an empty directory, a bad mode, and steps without a base image", () => {
    const empty = tempDir();
    expect(() => resolveBuildPlan(empty)).toThrow(BuildModeError);
    expect(() => resolveBuildPlan(empty)).toThrow(/No Dockerfile and no template.yaml build steps/);

    const bad = tempDir();
    write(bad, "template.yaml", "build:\n  mode: image\n");
    expect(() => resolveBuildPlan(bad)).toThrow(/build\.mode must be auto, dockerfile, or steps/);

    const noImage = tempDir();
    write(noImage, "template.yaml", "build:\n  run: ['true']\n");
    expect(() => resolveBuildPlan(noImage, { mode: "steps" })).toThrow(/base\.image/);
  });

  it("accepts a string base as the image", () => {
    const dir = tempDir();
    write(dir, "template.yaml", 'base: "python:3.12-slim"\nbuild:\n  run: ["true"]\n');

    const plan = resolveBuildPlan(dir, { mode: "steps" });

    expect(plan).toMatchObject({ kind: "steps", image: "python:3.12-slim" });
  });

  it("still rejects a base that is neither a string nor a mapping", () => {
    const dir = tempDir();
    write(dir, "template.yaml", "base: [python]\nbuild:\n  run: ['true']\n");
    expect(() => resolveBuildPlan(dir, { mode: "steps" })).toThrow(/base must be a mapping/);
  });
});

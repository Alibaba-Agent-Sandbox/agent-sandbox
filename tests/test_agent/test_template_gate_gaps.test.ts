/**
 * Gaps from the agent-template review that the adversarial cases did not pin:
 * A UTF-8 BOM in `.dockerignore` is kept (so line 1 does not match), publication
 * metadata is rejected in the resource document, and invalid UTF-8 is rejected
 * before YAML admission.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateTemplateWorkspace } from "../../src/agent/codegen.js";
import { AICodegenError } from "../../src/models/errors.js";
import { dotenvValues } from "../../src/utils/_dotenv.js";
import { DockerIgnore } from "../../src/utils/dockerignore.js";

const COMMANDS =
  "from agent_sandbox.server import SandboxServer\n\nSandboxServer().serve(port=9000)\n";
const DOCKERFILE =
  "FROM python:3.12-slim\nWORKDIR /app\nCOPY commands.py /app/\nCMD [\"python3\", \"commands.py\"]\n";

function workspace(template: string | Buffer): string {
  const dir = mkdtempSync(path.join(tmpdir(), "gap-at-"));
  writeFileSync(path.join(dir, "Dockerfile"), DOCKERFILE);
  writeFileSync(path.join(dir, "commands.py"), COMMANDS);
  writeFileSync(path.join(dir, "template.yaml"), template);
  return dir;
}

describe("agent-template gaps", () => {
  it("keeps a UTF-8 BOM on the first .dockerignore line, so **/.env does not exclude .env", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gap-di-"));
    const file = path.join(dir, ".dockerignore");
    writeFileSync(file, Buffer.from("\uFEFF**/.env\n", "utf8"));
    expect(DockerIgnore.fromFile(file).excludes(".env")).toBe(false);
  });

  it("rejects Registry publication fields in a resource document", () => {
    const dir = workspace(
      'specVersion: 1\nname: x\nsandbox:\n  template:\n    source: {dockerfile: Dockerfile, context: .}\nversion: 1.0\ndescription: d\n',
    );
    expect(() => validateTemplateWorkspace(dir, "demo", { providerId: "generic" })).toThrow(
      /Template v1.*schema validation failed/,
    );
  });

  it("rejects invalid UTF-8 in template.yaml before parsing", () => {
    const dir = workspace(Buffer.concat([Buffer.from("name: demo\n"), Buffer.from([0xff])]));
    expect(() => validateTemplateWorkspace(dir, "demo", { providerId: "generic" })).toThrow(
      AICodegenError,
    );
    expect(() => validateTemplateWorkspace(dir, "demo", { providerId: "generic" })).toThrow(
      "YAML must contain valid UTF-8",
    );
    try { validateTemplateWorkspace(dir, "demo", { providerId: "generic" }); }
    catch (error) {
      expect(String(error)).not.toContain("capabilities are NOT granted");
      expect(String(error)).not.toContain("Suggestion: Fix the template.yaml");
      expect(String(error)).toContain(dir);
    }
  });

  it("rejects invalid UTF-8 in a dotenv file with the byte and position", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gap-env-"));
    const file = path.join(dir, ".env");
    writeFileSync(file, Buffer.from("E2B_API_KEY=\xff\xfe\n", "latin1"));
    expect(() => dotenvValues(file)).toThrow(
      /'utf-8' codec can't decode byte 0xff in position 12: invalid start byte/,
    );
  });
});

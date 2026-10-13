/**
 * Gaps from the agent-template review that the adversarial cases did not pin:
 * a UTF-8 BOM in `.dockerignore` is kept (so line 1 does not match), `version: 1.0` stays a float in the
 * schema error, and invalid UTF-8 uses CPython's codec message.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateTemplateWorkspace } from "../../src/agent/codegen.js";
import { UnicodeDecodeError } from "../../src/utils/_pyos.js";
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

  it("rejects version: 1.0 (a float) with the offending field named", () => {
    const dir = workspace(
      'name: x\nversion: 1.0\ndescription: d\nports: [9000]\nresources:\n  cpu: 1\n  memory: 512\n',
    );
    expect(() => validateTemplateWorkspace(dir, "demo", { providerId: "generic" })).toThrow(
      /version/,
    );
  });

  it("rejects invalid UTF-8 in template.yaml with CPython's codec message", () => {
    const dir = workspace(Buffer.concat([Buffer.from("name: demo\n"), Buffer.from([0xff])]));
    expect(() => validateTemplateWorkspace(dir, "demo", { providerId: "generic" })).toThrow(
      UnicodeDecodeError,
    );
    expect(() => validateTemplateWorkspace(dir, "demo", { providerId: "generic" })).toThrow(
      "'utf-8' codec can't decode byte 0xff in position 11: invalid start byte",
    );
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

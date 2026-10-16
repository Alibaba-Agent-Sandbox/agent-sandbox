import { describe, expect, it } from "vitest";
import { standardArguments } from "../../src/standard_cli/dispatch.js";

describe("standard command routing", () => {
  it("treats a positional argument as a template without rewriting options", () => {
    expect(standardArguments(["sandbox", "create", "code-interpreter-v1", "--detach"]))
      .toEqual(["sandbox", "create", "code-interpreter-v1", "--detach"]);
  });

  it("normalizes root shortcuts to the same command implementation", () => {
    expect(standardArguments(["create", "base"])).toEqual(["sandbox", "create", "base"]);
    expect(standardArguments(["list", "--format", "json"])).toEqual(["sandbox", "list", "--format", "json"]);
  });

  it("reserves natural language for the explicit prompt option", () => {
    expect(standardArguments(["sandbox", "create", "--prompt", "a Python sandbox"])).toBeNull();
    expect(standardArguments(["create", "--prompt=a Python sandbox"])).toBeNull();
  });

  it("keeps the standard behavior for an explicit Express provider", () => {
    expect(standardArguments(["create", "base", "--provider", "alicloud-express"]))
      .toEqual(["sandbox", "create", "base"]);
    expect(standardArguments(["sandbox", "list", "--provider=alicloud-express"]))
      .toEqual(["sandbox", "list"]);
  });

  it("preserves provider and prompt arguments inside the remote exec command", () => {
    const args = ["sandbox", "exec", "--cwd", "/tmp", "sandbox-id", "agent", "--provider", "opensandbox", "--prompt", "hello"];
    expect(standardArguments(args)).toEqual(args);
    expect(standardArguments(["--provider", "alicloud-express", ...args])).toEqual(args);
    const root = ["exec", "sandbox-id", "agent", "--provider=opensandbox"];
    expect(standardArguments(root)).toEqual(["sandbox", ...root]);
  });

  it("retains explicit provider and project extension routing", () => {
    expect(standardArguments(["sandbox", "create", "base", "--provider", "opensandbox"])).toBeNull();
    expect(standardArguments(["sandbox", "command", "run", "id", "hello"])).toBeNull();
    expect(standardArguments(["template", "deploy"])).toBeNull();
    expect(standardArguments(["template", "from-image", "registry.example/image"])).toBeNull();
    expect(standardArguments(["template", "dl", "template-id"])).toEqual(["template", "dl", "template-id"]);
  });
});

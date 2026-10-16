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

  it("keeps native root flags on the standard path for explicit parser rejection", () => {
    for (const flag of ["--json", "-j", "--quiet", "-q", "--verbose", "-v", "--no-color", "--ci", "-qv"]) {
      expect(standardArguments([flag, "create", "base"]))
        .toEqual([flag, "sandbox", "create", "base"]);
    }
    expect(standardArguments(["--log-level", "INFO", "sbx", "create", "base"]))
      .toEqual(["--log-level", "INFO", "sandbox", "create", "base"]);
    expect(standardArguments(["--provider=alicloud-express", "--json", "create", "base"]))
      .toEqual(["--json", "sandbox", "create", "base"]);
    expect(standardArguments(["--json", "--provider", "alicloud-express", "exec", "id", "agent", "--provider", "remote"]))
      .toEqual(["--json", "sandbox", "exec", "id", "agent", "--provider", "remote"]);
    expect(standardArguments(["--json", "create", "--prompt", "test environment"])).toBeNull();
    expect(standardArguments(["--json", "create", "base", "--provider", "opensandbox"])).toBeNull();
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

  it("keeps qualified resources in provider routing instead of the Express client", () => {
    for (const verb of ["exec", "info", "connect", "kill", "pause", "resume"]) {
      expect(standardArguments(["sandbox", verb, "opensandbox:resource-id"])).toBeNull();
      expect(standardArguments([verb, "opensandbox:resource-id"])).toBeNull();
    }
    expect(standardArguments(["exec", "--cwd", "/tmp", "opensandbox:resource-id", "true"])).toBeNull();
    expect(standardArguments(["kill", "one", "opensandbox:two"])).toBeNull();
    for (const ref of ["default:id", "none:id", "alicloud-compute:id", "UPPER:id", ":id"]) {
      expect(standardArguments(["info", ref])).toBeNull();
      expect(standardArguments(["exec", ref, "curl", "https://example.invalid"])).toBeNull();
    }
    expect(standardArguments(["exec", "plain-id", "curl", "https://example.invalid"]))
      .toEqual(["sandbox", "exec", "plain-id", "curl", "https://example.invalid"]);
    expect(standardArguments(["create", "image:tag", "--detach"]))
      .toEqual(["sandbox", "create", "image:tag", "--detach"]);
  });

});

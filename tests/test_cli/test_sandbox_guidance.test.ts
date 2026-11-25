/** Relocated platform groups retain preflight; registered API help stays independent. */
import "../_support/isolatedHome.js";

import { afterEach, expect, it, vi } from "vitest";
import { Context, command, group } from "../../src/cli/kit.js";
import { withSandboxConfiguration } from "../../src/cli/sandbox_guidance.js";
import * as guidance from "../../src/cli/config_guidance.js";
import * as deployments from "../../src/cli/deployment_store.js";
import * as registry from "../../src/providers/registry.js";

afterEach(() => vi.restoreAllMocks());

it.each(["files", "process", "system", "snapshot", "network"])("retains provider guidance for the root %s group", async name => {
  const requireFeature = vi.fn();
  vi.spyOn(deployments, "sandboxTarget").mockReturnValue({ id: "sandbox-id", provider: "alicloud-express" });
  vi.spyOn(registry, "getProvider").mockReturnValue({ id: "alicloud-express", require: requireFeature } as unknown as ReturnType<typeof registry.getProvider>);
  const guided = vi.spyOn(guidance, "withGuidedConfiguration").mockImplementation(async (_ctx, _options, action) => action({} as never));
  const root = new Context(group("abx"));
  const parent = new Context(group(name), root);
  const leaf = new Context(command("inspect"), parent);
  const result = await withSandboxConfiguration(leaf, { sandbox_id: "sandbox-id" }, async () => "called");
  expect(result).toBe("called");
  expect(guided).toHaveBeenCalledOnce();
  expect(requireFeature).toHaveBeenCalledWith("sandbox.lifecycle");
});

it("does not preflight the registered API entry as an implicit platform command", async () => {
  const provider = vi.spyOn(registry, "getProvider").mockImplementation(() => { throw new Error("must not load provider"); });
  const target = vi.spyOn(deployments, "sandboxTarget").mockImplementation(() => { throw new Error("must not resolve target"); });
  const guided = vi.spyOn(guidance, "withGuidedConfiguration").mockImplementation(() => { throw new Error("must not read credentials"); });
  const root = new Context(group("abx"));
  const leaf = new Context(command("sandbox"), root);
  expect(await withSandboxConfiguration(leaf, { target: "exec", help: true }, async () => "local help")).toBe("local help");
  expect(provider).not.toHaveBeenCalled();
  expect(target).not.toHaveBeenCalled();
  expect(guided).not.toHaveBeenCalled();
});

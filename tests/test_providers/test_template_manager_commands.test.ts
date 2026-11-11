/** Existing plugin template managers remain reachable through CLI, SDK and engine command discovery. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderTemplateManager } from "../../src/providers/template_contract.js";
import { Provider } from "../../src/providers/base.js";
import { registerProvider } from "../../src/providers/registry.js";
import { getProviderCommand, listProviderCommands, runProviderCommand } from "../../src/providers/commands.js";
import { TemplateInfo } from "../../src/models/template.js";
import { main } from "../../src/cli/main.js";
import { startEngine } from "../../src/engine/server.js";
import { useIso } from "../_support/iso.js";
import { useCapsys } from "../test_cli/conftest.js";
useIso(); const cap = useCapsys();
afterEach(() => vi.restoreAllMocks());
class Fixture extends Provider {
  readonly id = "manager-fixture";
  override features = new Set(["templates.read", "templates.build"]);
  infra = vi.fn(async (): Promise<never> => { throw Error("lifecycle infra is unrelated"); });
  closeManager = vi.fn(async () => {});
  item = new TemplateInfo({ template_id: "template-one", build_status: "building", created_at: new Date("2026-11-10T00:00:00Z") });
  manager = { list: vi.fn(async () => [this.item]), get: vi.fn(async (_id: string) => this.item), create: vi.fn(async (_image: string, _options: Readonly<Record<string, unknown>>) => this.item), delete: vi.fn(async (_id: string) => {}), close: this.closeManager };
  factory = vi.fn(async () => this.manager);
  async buildInfra(): Promise<never> { return this.infra(); }
  override async buildTemplateManager(): Promise<ProviderTemplateManager> { return this.factory(); }
}
describe("template manager command bridge", () => {
  it("discovers statically and closes every CRUD invocation without lifecycle infrastructure", async () => {
    const provider = new Fixture(); registerProvider(provider);
    expect(listProviderCommands(provider.id).map(x => x.id)).toEqual(["template.create", "template.delete", "template.get", "template.list"]);
    expect(provider.factory).not.toHaveBeenCalled();
    const listed = await runProviderCommand(provider.id, "template.list", {});
    expect(listed).toMatchObject({ templates: [{ template_id: "template-one", build_status: "building", created_at: "2026-11-10T00:00:00.000Z" }] });
    await runProviderCommand(provider.id, "template.get", { template_id: "one" });
    await runProviderCommand(provider.id, "template.create", { image: "image:v1", options: { cpu: 2 } });
    await runProviderCommand(provider.id, "template.delete", { template_id: "one" });
    expect(provider.manager.get).toHaveBeenCalledWith("one"); expect(provider.manager.create).toHaveBeenCalledWith("image:v1", { cpu: 2 });
    expect(provider.manager.delete).toHaveBeenCalledWith("one"); expect(provider.closeManager).toHaveBeenCalledTimes(4); expect(provider.infra).not.toHaveBeenCalled();
  });
  it("preserves explicit same-name commands and never redirects them into a manager", async () => {
    const provider = new Fixture();
    provider.commands = [{ ...getProviderCommand("alicloud-express", "template.list"), input_schema: { type: "object", additionalProperties: false }, output_schema: { type: "object" } }];
    const run = vi.fn(async () => ({ native: true })); const closed = vi.fn(async () => {});
    vi.spyOn(provider, "buildCommandRunner").mockResolvedValue({ run, close: closed }); registerProvider(provider);
    expect(listProviderCommands(provider.id).filter(x => x.id === "template.list")).toHaveLength(1);
    expect(await runProviderCommand(provider.id, "template.list", {})).toEqual({ native: true });
    expect(provider.factory).not.toHaveBeenCalled(); expect(closed).toHaveBeenCalledOnce();
  });
  it("rejects a missing optional method and closes acquired manager without calling another operation", async () => {
    const provider = new Fixture(); registerProvider(provider);
    vi.spyOn(provider, "buildTemplateManager").mockResolvedValue({ close: provider.closeManager });
    await expect(runProviderCommand(provider.id, "template.get", { template_id: "one" })).rejects.toMatchObject({ code: "E8004" });
    expect(provider.closeManager).toHaveBeenCalledOnce(); expect(provider.infra).not.toHaveBeenCalled();
  });
  it("routes public parser commands and preserves explicit mutation confirmation", async () => {
    const provider = new Fixture(); registerProvider(provider);
    expect(await main({ args: ["--json", "--provider", provider.id, "provider", "run", "template.list"] })).toBe(0);
    expect(JSON.parse(cap.readouterr().out)).toMatchObject({ templates: [{ template_id: "template-one" }] });
    expect(await main({ args: ["--ci", "--provider", provider.id, "provider", "run", "template.delete", "--input", '{"template_id":"one"}'] })).not.toBe(0);
    cap.readouterr(); expect(provider.manager.delete).not.toHaveBeenCalled();
    expect(await main({ args: ["--json", "--provider", provider.id, "provider", "run", "template.delete", "--yes", "--input", '{"template_id":"one"}'] })).toBe(0);
    expect(JSON.parse(cap.readouterr().out)).toEqual({ template_id: "one", deleted: true });
  });
  it("uses the same descriptors and manager through the authenticated engine HTTP API", async () => {
    const provider = new Fixture(); registerProvider(provider); const engine = await startEngine({ idle_timeout: 0 });
    const base = `http://127.0.0.1:${engine.record.port}/v1/providers/${provider.id}/commands`;
    const headers = { Authorization: `Bearer ${engine.record.token}`, "Content-Type": "application/json" };
    try {
      const discovery = await fetch(base, { headers }); expect(discovery.status).toBe(200);
      expect((await discovery.json() as { commands: unknown[] }).commands).toHaveLength(4); expect(provider.factory).not.toHaveBeenCalled();
      const refused = await fetch(`${base}/template.delete`, { method: "POST", headers, body: JSON.stringify({ input: { template_id: "one" } }) }); expect(refused.status).toBe(400);
      expect(provider.factory).not.toHaveBeenCalled();
      const ran = await fetch(`${base}/template.delete`, { method: "POST", headers, body: JSON.stringify({ input: { template_id: "one" }, confirm: true }) });
      expect(ran.status).toBe(200); expect(await ran.json()).toEqual({ template_id: "one", deleted: true }); expect(provider.closeManager).toHaveBeenCalledOnce();
    } finally { await engine.close(); }
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, expect, it } from "vitest";
import { componentHostSeams, invokeDevsComponent, type ComponentLogEvent } from "../../src/application/component_host.js";
import { COMPONENT_RUNNER_SOURCE } from "../../src/application/component_runner.js";
import { execute } from "../../src/application/process.js";

const roots: string[] = [];
const originalLoader = componentHostSeams.loaderPath;
afterEach(() => { componentHostSeams.loaderPath = originalLoader; for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const fixtureCredential = { AccountID: "1234567890123456", AccessKeyID: "fixture-access-id", AccessKeySecret: "fixture-secret-value", SecurityToken: "fixture-session-token" };
function project(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-component-host-test-")); roots.push(root); fs.writeFileSync(path.join(root, "template.yaml"), "specVersion: 1\n"); return root; }
function loader(root: string, body: string): void {
  const file = path.join(root, "loader.cjs");
  fs.writeFileSync(file, `module.exports = async (component, {logger}) => { ${body} };`);
  componentHostSeams.loaderPath = () => file;
}
function invocation(root: string) { return { cwd: root, component: "serverless-devs/fc3@0.1.26", command: "build", name: "sample", resource: "api", credential: fixtureCredential, props: { code: "./server", environmentVariables: { PRIVATE_TOKEN: "fixture-prop-token" } } }; }

it("preserves native build paths, arguments and artifacts for a following deployment", async () => {
  const root = project(), events: ComponentLogEvent[] = [];
  loader(root, `const fs = require('node:fs'); return {
    async build(input) {
      const first = await input.getCredential(); first.AccessKeySecret = 'changed';
      const second = await input.getCredential();
      fs.mkdirSync('.s', {recursive:true}); fs.writeFileSync('.s/built', input.props.code);
      logger.info('Building resource'); logger.spin('building', 'image'); logger.warnOnce('warning'); logger.warnOnce('warning');
      return {cwd:process.cwd(), yaml:input.yaml.path, args:input.args, component:input.resource.component, stableCredential:second.AccessKeySecret === 'fixture-secret-value'};
    }, async deploy() { return {artifact:fs.readFileSync('.s/built','utf8')}; }
  };`);
  const result = await invokeDevsComponent({ ...invocation(root), args: ["--dockerfile", "./server/Dockerfile", "--context", "./server"], onLog: event => events.push(event) });
  expect(result).toEqual({ cwd: root, yaml: path.join(root, "template.yaml"), args: ["--dockerfile", "./server/Dockerfile", "--context", "./server"], component: "fc3@0.1.26", stableCredential: true });
  expect(events.map(event => event.message)).toEqual(["Building resource", "building image", "warning"]);
  expect(await invokeDevsComponent({ ...invocation(root), command: "deploy", onLog: event => events.push(event) })).toEqual({ artifact: "./server" });
});

it("redacts logger, console, stream and error diagnostics before crossing the event channel", async () => {
  const root = project(), events: ComponentLogEvent[] = [];
  loader(root, `return { async build(input) {
    const c = await input.getCredential();
    logger.debug(JSON.stringify({AccessKeySecret:c.AccessKeySecret}));
    logger.error(input.props.environmentVariables.PRIVATE_TOKEN);
    console.log('token %s', c.SecurityToken);
    process.stdout.write(c.AccessKeyID.slice(0,5)); process.stdout.write(c.AccessKeyID.slice(5)+'\\n');
    process.stderr.write('完成✓\\n');
    const error = new Error('Failed with '+c.AccessKeySecret); error.code='Unauthorized'; throw error;
  }};`);
  await expect(invokeDevsComponent({ ...invocation(root), onLog: event => events.push(event) })).rejects.toThrow("Unauthorized");
  const text = JSON.stringify(events);
  for (const secret of [...Object.values(fixtureCredential).slice(1), "fixture-prop-token"]) expect(text).not.toContain(secret);
  expect(text).toContain("REDACTED"); expect(text).toContain("完成✓");
  await expect(invokeDevsComponent({ ...invocation(root), onLog: () => {} })).rejects.toThrow("Failed with [REDACTED]");
});

it("rejects floating versions and prototype method dispatch before loading components", async () => {
  const root = project();
  await expect(invokeDevsComponent({ ...invocation(root), component: "fc3@latest" })).rejects.toThrow("exact version");
  await expect(invokeDevsComponent({ ...invocation(root), command: "constructor" })).rejects.toThrow("Invalid component command");
});

it("uses the official loader and full logger surface in a real isolated local component", async () => {
  const root = project(), component = path.join(root, "component"), runner = path.join(root, "runner.cjs");
  fs.mkdirSync(component);
  fs.writeFileSync(path.join(component, "package.json"), JSON.stringify({ main: "index.cjs" }));
  fs.writeFileSync(path.join(component, "publish.yaml"), "Name: fixture\nVersion: 1.2.3\n");
  fs.writeFileSync(path.join(component, "index.cjs"), `module.exports = class {
    constructor({logger}) { this.logger=logger; logger.info('loaded'); }
    async build(input) {
      this.logger.progress().start(10); this.logger.getProgressBar().update(3);
      this.logger.append('progress'); this.logger.output('native output');
      const c=await input.getCredential(); console.log(c.AccessKeySecret);
      return {path:input.yaml.path, args:input.args, hasCredential:!!c.AccessKeyID};
    }
  };`);
  fs.writeFileSync(runner, COMPONENT_RUNNER_SOURCE);
  let events = "";
  const output = await execute({ argv: [process.execPath, runner], cwd: root, env: { ...process.env, NODE_PATH: "" }, privateResult: true, onEventData: data => { events += data; }, timeoutSeconds: 15,
    input: JSON.stringify({ action: "invoke", events: true, loaderPath: createRequire(import.meta.url).resolve("@serverless-devs/load-component"), component, cwd: root, name: "fixture", resource: "api", command: "build", args: ["--context", "."], yamlPath: path.join(root, "template.yaml"), props: {}, credential: fixtureCredential }) });
  expect(JSON.parse(output).result).toEqual({ path: path.join(root, "template.yaml"), args: ["--context", "."], hasCredential: true });
  expect(events).toContain("native output"); expect(events).toContain("REDACTED"); expect(events).not.toContain(fixtureCredential.AccessKeySecret);
});

it("kills a timed-out component's descendants before they can finish a side effect", async () => {
  const root = project(), marker = path.join(root, "late-result");
  loader(root, `return { async build() { require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'late'),1000)`)}], {stdio:'ignore'}); await new Promise(resolve=>setTimeout(resolve,5000)); } };`);
  await expect(invokeDevsComponent({ ...invocation(root), timeoutSeconds: 0.2, onLog: () => {} })).rejects.toThrow("deadline");
  await new Promise(resolve => setTimeout(resolve, 1100)); expect(fs.existsSync(marker)).toBe(false);
});

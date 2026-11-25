/** Actual CLI + Docker smoke test. FROM scratch requires no pull, cloud account or registry. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "abx-local-build-e2e-"));
const images = new Set();
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(ABX_|SANDBOX_|E2B_|ALI(?:CLOUD|BABA_CLOUD)_|OPENAI_|NODE_OPTIONS$|NODE_PATH$)/.test(key)));
environment.HOME = path.join(root, "home"); environment.USERPROFILE = environment.HOME;
fs.mkdirSync(environment.HOME); fs.mkdirSync(path.join(root, "guest"));
const cli = fileURLToPath(new URL("../dist/bin/abx.js", import.meta.url));
const run = (command, args, timeout = 120000) => {
  const result = spawnSync(command, args, {cwd: root, env: environment, encoding: "utf8", timeout, maxBuffer: 2 * 1024 * 1024});
  assert.equal(result.status, 0, `${command} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
};
try {
  run("docker", ["info", "--format", "{{.ServerVersion}}"], 15000);
  fs.writeFileSync(path.join(root, "guest", "Dockerfile"), "FROM scratch\nCOPY data /data\n");
  fs.writeFileSync(path.join(root, "guest", "data"), randomUUID());
  fs.writeFileSync(path.join(root, "template.yaml"), JSON.stringify({specVersion: 1, name: "local-build", vars: {runtimeSecret: "${env('UNAVAILABLE_RUNTIME_SECRET')}"}, sandbox: {agent: {provider: "alicloud-express", actions: {"pre-deploy": [{run: "exit 99"}]}, template: {buildConfig: {dockerfile: "guest/Dockerfile"}}}}}));
  const firstText = run(process.execPath, [cli, "--json", "template", "build", "."]), first = JSON.parse(firstText);
  assert.equal(first.status, "built"); assert.equal(first.images.length, 1); assert.equal(first.images[0].cached, false);
  const id = first.images[0].image_id; assert.match(id, /^sha256:[a-f0-9]{64}$/); images.add(id);
  assert.equal(run("docker", ["image", "inspect", "--format", "{{.Id}}", id]), id);
  assert.doesNotMatch(firstText, /build\.json|resources\.json|receipt|journal|UNAVAILABLE_RUNTIME_SECRET/);
  const second = JSON.parse(run(process.execPath, [cli, "--json", "template", "build", "."]));
  assert.equal(second.images[0].image_id, id); assert.equal(second.images[0].cached, true);
  assert.equal(fs.existsSync(path.join(environment.HOME, ".abx", "deployments")), false);
  console.log(JSON.stringify({status: "passed", actual_docker_build: true, cache_verified: true, cloud_deployment: false}));
} finally {
  for (const id of images) run("docker", ["image", "rm", id], 30000);
  fs.rmSync(root, {recursive: true, force: true});
}

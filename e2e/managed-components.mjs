/** Opt-in real FC component and owned ACR build lifecycle. Run after npm run build. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { readTemplate } from "../dist/application/config.js";
import { buildApplication, cleanBuild, prepareTools, invokeComponent } from "../dist/application/tools.js";
import { resolveDeployCredentials, createFcTransport, verifyFunction } from "../dist/application/fc.js";
import { loadLayeredConfig } from "../dist/transport/config_layers.js";

const mode = process.argv[2] ?? "all";
if (!["all", "fc", "image"].includes(mode)) throw new Error("Usage: node e2e/managed-components.mjs [all|fc|image]");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "abx-managed-components-"));
const region = loadLayeredConfig({ provider: "alicloud-express" }).region;
const credential = await resolveDeployCredentials(process.env.ABX_APP_E2E_ACCESS_REF ?? "abx");
const result = { scope: "real-managed-components", mode, fc: "not-run", image: "not-run", cleanup: [] };
let safeToRemove = true;
try {
  if (mode !== "image") {
    const fc = createFcTransport(credential, region), name = `abx-fc3-contract-${randomBytes(6).toString("hex")}`;
    const lock = await prepareTools(directory, "fc3@0.1.26"), code = path.join(directory, "code"); fs.mkdirSync(code);
    fs.writeFileSync(path.join(code, "index.py"), "def handler(event, context):\n    return 'managed-component-ok'\n");
    const zip = "UEsDBBQAAAAIAByAZV1Aji6uPgAAAD8AAAAIAAAAaW5kZXgucHlLSU1TyEjMS8lJLdJILUvNK9FRSM7PK0mtKNG04lIAgqLUktKiPAWl3MS8xPTUFN3k/NyC/DygQt38bCUuAFBLAQIUAxQAAAAIAByAZV1Aji6uPgAAAD8AAAAIAAAAAAAAAAAAAACAAQAAAABpbmRleC5weVBLBQYAAAAAAQABADYAAABkAAAAAAA=";
    let native, failure;
    // This private ledger precedes the first cloud write and survives an unknown create outcome.
    fs.writeFileSync(path.join(directory, "fc-intent.json"), JSON.stringify({ name, region, createdAt: new Date().toISOString() }), { mode: 0o600 });
    try {
      result.fcStep = "reserve";
      if (await fc.describeFunction(name)) throw new Error("Unexpected existing test function");
      native = await fc.createFunction({ functionName: name, runtime: "python3.10", handler: "index.handler", cpu: 0.05, memorySize: 128, diskSize: 512, timeout: 10,
        description: "Agent Sandbox owned component lifecycle acceptance", code: { zipFile: zip } });
      result.fcStep = "deploy";
      await invokeComponent(lock, { command: "deploy", resource: "component-contract", credential, props: { region, functionName: name, runtime: "python3.10", handler: "index.handler", cpu: 0.05, memorySize: 128, diskSize: 512, timeout: 10,
        description: "Agent Sandbox component lifecycle changed", code } });
      result.fcStep = "readback"; const actual = await fc.describeFunction(name);
      verifyFunction(actual, credential.AccountID, region, name, { functionName: name, functionArn: native.functionArn, functionId: native.functionId, createdTime: native.createdTime });
      if (actual.description !== "Agent Sandbox component lifecycle changed") throw new Error("Component configuration was not applied");
      result.fcStep = "info"; await invokeComponent(lock, { command: "info", resource: "component-contract", credential, props: { region, functionName: name } });
      result.fcStep = "remove"; await invokeComponent(lock, { command: "remove", resource: "component-contract", credential, props: { region, functionName: name } });
      if (await fc.describeFunction(name)) throw new Error("Component remove did not establish absence");
      result.fc = "pass";
    } catch (error) { failure = error; }
    try {
      if (native) { await fc.deleteFunction(name); if (await fc.describeFunction(name)) throw new Error("Owned test function remains"); result.cleanup.push("fc-native-absence"); }
      else if (await fc.describeFunction(name)) { safeToRemove = false; throw new Error("Unknown function creation retained in private test ledger"); }
    } catch (error) { safeToRemove = false; failure ??= error; }
    if (failure) throw failure;
  }
  if (mode !== "fc") {
    const template = readTemplate(fileURLToPath(new URL("../tests/fixtures/application-managed/template.yaml", import.meta.url)));
    delete template.application.deployment.serverImage;
    Object.assign(template.application.deployment, { region, serverBuildRecipe: { dockerfile: "Dockerfile.server", context: "." } });
    fs.writeFileSync(path.join(directory, "template.yaml"), stringify(template));
    fs.writeFileSync(path.join(directory, "Dockerfile.server"), "FROM scratch\nCOPY marker.txt /marker.txt\n");
    fs.writeFileSync(path.join(directory, "marker.txt"), randomBytes(12).toString("hex"));
    const receipt = path.join(directory, ".abx", "build.json");
    try {
      const build = await buildApplication(template, directory, credential, receipt);
      if (build.ownedServerImage?.state !== "confirmed") throw new Error("Native image ownership was not confirmed");
      await cleanBuild(receipt, credential); result.image = "pass"; result.cleanup.push("acr-native-and-local-tag-absence");
    } catch (error) { if (fs.existsSync(receipt)) safeToRemove = false; throw error; }
  }
} catch (error) {
  result.failure = /^(?:FC |Component |ACR |Application |Published |Owned |Local |Image )/.test(String(error.message)) || error instanceof TypeError ? error.message : "Real component acceptance failed; inspect its private recovery ledger";
  process.exitCode = 1;
} finally {
  if (safeToRemove) fs.rmSync(directory, { recursive: true, force: true }); else result.recovery_directory = directory;
  process.stdout.write(JSON.stringify(result) + "\n");
}

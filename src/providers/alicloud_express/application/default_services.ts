/** Bootstrap real managed deployment dependencies without copying host identities into Server. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ApplicationError, record, sourceDigest } from "../../../application/config.js";
import { createFcTransport } from "./fc.js";
import { childEnvironment, invokeComponent, removeOwnedImage } from "./tools.js";
import { execute } from "../../../application/process.js";
import { runHooks, type ApplicationServices } from "../../../application/service.js";
import type { CredentialSnapshot, ResolvedBindings } from "../../../application/bindings.js";
import type { ApplicationPlan, PreparedSandbox } from "../../../application/types.js";
import { explainConfig, paths } from "../../../transport/config_layers.js";
import { deleteTemplate, getTemplate } from "../fc_template.js";
import { TemplateNotFoundError } from "../../../models/errors.js";

export function defaultServices(plan: ApplicationPlan, credential: CredentialSnapshot, binding: ResolvedBindings): ApplicationServices {
  const fc = createFcTransport(credential, plan.template.application.deployment.region);
  return { credential, binding, fc,
    async removeImage(image) { await removeOwnedImage(image, credential); },
    async prepare(frozen, progress) {
      if (credential.SecurityToken) throw new ApplicationError("The current Express template preparation adapter requires a long-lived deployment AK; STS preparation is not supported by that adapter.");
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "abx-managed-prepare-"));
      let pending = "", result: PreparedSandbox | undefined;
      try {
        const env = childEnvironment(home);
        const snapshot = path.join(home, "source");
        fs.cpSync(frozen.projectRoot, snapshot, { recursive: true, filter: source => ![".git", ".abx", ".agents", "node_modules", ".venv", "__pycache__", ".pytest_cache", ".env"].includes(path.basename(source)) && !path.basename(source).startsWith(".env.") });
        if (sourceDigest(snapshot) !== frozen.sourceDigest) throw new ApplicationError("Application source changed before immutable preparation.");
        Object.assign(env, { ABX_ACCESS_KEY_ID: credential.AccessKeyID, ABX_ACCESS_KEY_SECRET: credential.AccessKeySecret,
          ALICLOUD_ACCESS_KEY_ID: credential.AccessKeyID, ALICLOUD_ACCESS_KEY_SECRET: credential.AccessKeySecret,
          ALIBABA_CLOUD_ACCESS_KEY_ID: credential.AccessKeyID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: credential.AccessKeySecret,
          ABX_SANDBOX_API_KEY: binding.provider.apiKey, ABX_SANDBOX_BASE_URL: binding.provider.baseUrl, ABX_SANDBOX_DOMAIN: binding.provider.domain,
          ALIBABA_CLOUD_REGION_ID: frozen.template.application.deployment.region, ACR_NAMESPACE: String(explainConfig({ provider: "alicloud-express" }).acr_namespace?.value ?? process.env.ACR_NAMESPACE ?? "") });
        const modulePath = fileURLToPath(new URL("./preparation_runner.js", import.meta.url));
        if (!fs.existsSync(modulePath)) throw new ApplicationError("Build the CLI before running managed template preparation.");
        const source = `import {runPreparation} from ${JSON.stringify(pathToFileURL(modulePath).href)}; await runPreparation();`;
        await execute({ argv: [frozen.toolchain.node.path, "--input-type=module", "--eval", source], cwd: home, env, input: JSON.stringify({ plan: { ...frozen, projectRoot: snapshot }, journalRoot: paths.abxDir }), timeoutSeconds: 1900,
          maxBytes: 16 * 1024 * 1024, privateResult: true, onPrivateData(data) {
            pending += data;
            for (;;) { const newline = pending.indexOf("\n"); if (newline < 0) break; const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
              const value: unknown = JSON.parse(line);
              if (!record(value) || !record(value.sandbox) || !Array.isArray(value.sandbox.resources)) throw new ApplicationError("Invalid private preparation receipt.");
              const sandbox = value.sandbox as unknown as PreparedSandbox; progress(sandbox); if (value.type === "result") result = sandbox;
            }
          } });
        if (!result) throw new ApplicationError("Preparation did not return a confirmed template reference.");
        return result;
      } finally { fs.rmSync(home, { recursive: true, force: true }); }
    },
    async deploy(frozen, role, props) { await invokeComponent(frozen.toolchain, { command: "deploy", resource: role, props: { region: frozen.template.application.deployment.region, ...props }, credential }); },
    async deleteTemplate(sandbox) {
      if (!sandbox.reference || !sandbox.resources.some(item => item.kind === "template" && item.id === sandbox.reference && item.state === "created" && item.cleanup === "template.delete")) throw new ApplicationError("Template cleanup requires an exact owned journal entry.");
      const options = { access_key_id: credential.AccessKeyID, access_key_secret: credential.AccessKeySecret, region: plan.template.application.deployment.region };
      try { await getTemplate(sandbox.reference, options); }
      catch (error) { if (error instanceof TemplateNotFoundError) return; throw new ApplicationError("Template inspection failed; absence was not established."); }
      try { await deleteTemplate(sandbox.reference, options); }
      catch { throw new ApplicationError("Owned template deletion is unconfirmed."); }
      try { await getTemplate(sandbox.reference, options); }
      catch (error) { if (error instanceof TemplateNotFoundError) return; throw new ApplicationError("Template deletion could not be independently confirmed."); }
      throw new ApplicationError("Template remains visible after deletion.");
    },
    async hooks(phase, receipt, endpoint, token) {
      for (const hook of receipt.plan.template.application.hooks?.[phase] ?? []) if (hook.type === "serverless-devs") {
        const owned = receipt.functions.find(item => item.role === hook.step);
        if (!owned) throw new ApplicationError("Component inspection hook requires a confirmed role.");
        await invokeComponent(receipt.plan.toolchain, { command: "info", resource: hook.step!, props: { region: receipt.plan.template.application.deployment.region, functionName: owned.functionName }, credential });
      }
      await runHooks(phase, receipt, endpoint, token);
    } };
}

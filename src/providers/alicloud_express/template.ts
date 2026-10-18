/**
 * Template management — high-level API (port of `api/template.py`).
 *
 * Usage:
 *
 *     const config = loadConfig({ api_key: "..." });
 *     const auth = createAuthProvider({ api_key: config.api_key });
 *     const http = new HttpClient(config, auth);
 *
 *     const manager = new TemplateManager(http);
 *     const info = await manager.get("existing-template-id");
 */

import { BuildStatus, TemplateInfo } from "../../models/template.js";
import { TemplateProtocol } from "./template_protocol.js";
import type { HttpClient } from "../../transport/http.js";
import { getLogger } from "../../utils/logging.js";

const logger = getLogger("api.template");

export interface BuildFromImageOptions {
  name: string;
  cpu_count?: number;
  memory_mb?: number;
  start_cmd?: string | null;
  ready_cmd?: string | null;
  tags?: string[] | null;
  acr_headers?: Record<string, string> | null;
  timeout?: number;
  poll_interval?: number;
}

/** Template management high-level API. Wraps TemplateProtocol with a friendlier interface that returns typed TemplateInfo objects. */
export class TemplateManager {
  _http: HttpClient;
  _protocol: TemplateProtocol;

  constructor(http_client: HttpClient) {
    this._http = http_client;
    this._protocol = new TemplateProtocol(http_client);
  }

  async close(): Promise<void> { await this._http.close(); }

  /** List all templates. */
  async list(): Promise<TemplateInfo[]> {
    const items = await this._protocol.list();
    return items.map((item) => TemplateInfo.modelValidate(item));
  }

  /** Get template details. */
  async get(template_id: string): Promise<TemplateInfo> {
    const data = await this._protocol.get(template_id);
    return TemplateInfo.modelValidate(data);
  }

  /** Delete a template. */
  async delete(template_id: string): Promise<void> {
    await this._protocol.delete(template_id);
    logger.info("Template deleted: %s", template_id);
  }

  /** Get build status for a template build. */
  async getBuildStatus(template_id: string, build_id: string): Promise<Record<string, any>> {
    return this._protocol.getBuildStatus(template_id, build_id);
  }

  // ------------------------------------------------------------------ //
  // v3/v2 API — current backend
  // ------------------------------------------------------------------ //

  /**
   * Build a template from a pre-built image via v3/v2 APIs (aligned with E2B SDK 2.31.0):
   *
   * 1. `POST /v3/templates` — create metadata
   * 2. `POST /v2/templates/{tpl}/builds/{build}` — trigger build
   * 3. Poll build status until ready.
   */
  async buildFromImage(from_image: string, opts: BuildFromImageOptions): Promise<TemplateInfo> {
    const {
      name,
      cpu_count = 2,
      memory_mb = 2048,
      start_cmd = null,
      ready_cmd = null,
      tags = null,
      acr_headers = null,
      timeout = 600,
      poll_interval = 5,
    } = opts;
    // Step 1: Create metadata
    const v3_data = await this._protocol.createV3(name, { cpu_count, memory_mb, tags });
    const template_id = pyKey(v3_data, "templateID");
    const build_id = pyKey(v3_data, "buildID");
    logger.info("Template v3 metadata created: templateID=%s, buildID=%s", template_id, build_id);

    // Step 2: Trigger build
    await this._protocol.triggerBuildV2(template_id, build_id, { from_image, start_cmd, ready_cmd, acr_headers });

    // Step 3: Wait for build
    await this._protocol.waitForBuild(template_id, build_id, { timeout, poll_interval });

    // Fetch final info
    const data = await this._protocol.get(template_id);
    const info = TemplateInfo.modelValidate(data);
    info.build_status = BuildStatus.READY;
    logger.info("Template built from image: %s", template_id);
    return info;
  }
}

/** Python `d[key]` — raises `KeyError` when missing. */
function pyKey(d: Record<string, any>, key: string): any {
  if (d === null || typeof d !== "object" || !Object.prototype.hasOwnProperty.call(d, key)) {
    const err = new Error(`'${key}'`);
    err.name = "KeyError";
    throw err;
  }
  return d[key];
}

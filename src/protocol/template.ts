/**
 * Platform API protocol — template management (REST) (port of `protocol/template.py`).
 *
 * Endpoints (relative to Platform API base URL):
 *
 * **Current v3/v2 API (aligned with E2B SDK 2.31.0)**:
 *   POST /v3/templates → creates metadata, returns templateID + buildID.
 *   POST /v2/templates/{tpl}/builds/{build} → triggers real build from an image reference (requires ACR EE registry
 *   headers).
 */

import { SandboxError, TemplateBuildError, TemplateBuildTimeoutError } from "../models/errors.js";
import { HTTPStatusError, type HttpClient } from "../transport/http.js";
import { dictGet, hasBodyContent, pyBytesRepr, pyExcStr } from "../utils/_pyerrors.js";
import { getLogger } from "../utils/logging.js";
import { pyStr } from "../utils/_pyformat.js";

export { TemplateBuildError, TemplateBuildTimeoutError };

const logger = getLogger("protocol.template");

export const _seams = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

function responseJson(exc: HTTPStatusError): any {
  return exc.response.json();
}

function bytesDecodeReplace(raw: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(raw);
}

export interface TriggerBuildV2Options {
  from_image?: string | null;
  from_image_registry?: Record<string, string> | null;
  from_template?: string | null;
  start_cmd?: string | null;
  ready_cmd?: string | null;
  steps?: Record<string, any>[] | null;
  force?: boolean;
  acr_headers?: Record<string, string> | null;
}

export interface WaitForBuildOptions {
  timeout?: number;
  poll_interval?: number;
  on_poll?: ((status: string, elapsed: number) => void) | null;
}

/** Typed wrapper for current Platform API template operations. */
export class TemplateProtocol {
  _http: HttpClient;

  constructor(http_client: HttpClient) {
    this._http = http_client;
  }

  /** List templates. GET /templates → 200 */
  async list(): Promise<Record<string, any>[]> {
    const response = await this._http.platformRequest("GET", "/templates");
    const data = response.json();
    // API may return list directly or wrapped in a data field
    if (Array.isArray(data)) return data;
    return dictGet(data, "data", dictGet(data, "templates", []));
  }

  /** Get template details. GET /templates/{id} → 200 */
  async get(template_id: string): Promise<Record<string, any>> {
    const response = await this._http.platformRequest("GET", `/templates/${template_id}`);
    return response.json();
  }

  /** Delete a template. DELETE /templates/{id} → 204 */
  async delete(template_id: string): Promise<void> {
    try {
      await this._http.platformRequest("DELETE", `/templates/${template_id}`);
      logger.info("Template deleted: %s", template_id);
    } catch (exc) {
      if (exc instanceof HTTPStatusError) {
        if (exc.response.status_code === 404) {
          logger.warning("Template %s not found (already deleted?)", template_id);
          return;
        }
      }
      throw exc;
    }
  }

  /** Query build status. GET /templates/{id}/builds/{buildId}/status → 200 */
  async getBuildStatus(template_id: string, build_id: string): Promise<Record<string, any>> {
    const response = await this._http.platformRequest("GET", `/templates/${template_id}/builds/${build_id}/status`);
    const content = response.content;
    if (hasBodyContent(content)) {
      try {
        return response.json();
      } catch {
        logger.warning("Build status response not valid JSON: %s", pyBytesRepr(content.subarray(0, 200)));
        return { status: "building" };
      }
    }
    return { status: "building" };
  }

  // ------------------------------------------------------------------ //
  // v3/v2 API — current backend (aligned with E2B SDK 2.31.0)
  // ------------------------------------------------------------------ //

  /**
   * Create template metadata via the v3 API. POST /v3/templates → 200
   *
   * Returns dict with templateID, buildID, aliases, names, tags, public.
   */
  async createV3(
    name: string,
    opts: { cpu_count?: number | null; memory_mb?: number | null; tags?: string[] | null } = {},
  ): Promise<Record<string, any>> {
    const { cpu_count = null, memory_mb = null, tags = null } = opts;
    const payload: Record<string, unknown> = { name };
    if (cpu_count !== null) payload["cpuCount"] = cpu_count;
    if (memory_mb !== null) payload["memoryMb"] = memory_mb;
    if (tags !== null) payload["tags"] = tags;

    try {
      const response = await this._http.platformRequest("POST", "/v3/templates", { json: payload });
      const data = response.json();
      logger.info("Template v3 created: templateID=%s, buildID=%s", dictGet(data, "templateID"), dictGet(data, "buildID"));
      return data;
    } catch (exc) {
      if (exc instanceof HTTPStatusError) {
        const status = exc.response.status_code;
        let body: any;
        try {
          body = responseJson(exc);
        } catch {
          body = {};
        }
        const message = dictGet(body, "message", pyExcStr(exc));
        throw new SandboxError(message, { code: `E7${status}` });
      }
      throw exc;
    }
  }

  /** Trigger a template build via the v2 API. POST /v2/templates/{tpl}/builds/{build} */
  async triggerBuildV2(template_id: string, build_id: string, opts: TriggerBuildV2Options = {}): Promise<Record<string, any>> {
    const {
      from_image = null,
      from_image_registry = null,
      from_template = null,
      start_cmd = null,
      ready_cmd = null,
      steps = null,
      force = false,
      acr_headers = null,
    } = opts;
    const payload: Record<string, unknown> = {};
    if (from_image !== null) payload["fromImage"] = from_image;
    if (from_image_registry !== null) payload["fromImageRegistry"] = from_image_registry;
    if (from_template !== null) payload["fromTemplate"] = from_template;
    if (start_cmd !== null) payload["startCmd"] = start_cmd;
    if (ready_cmd !== null) payload["readyCmd"] = ready_cmd;
    if (steps !== null) payload["steps"] = steps;
    if (force) payload["force"] = true;

    const path = `/v2/templates/${template_id}/builds/${build_id}`;
    try {
      const response = await this._http.platformRequest("POST", path, { json: payload, headers: acr_headers });
      logger.info(
        "Template v2 build triggered: templateID=%s, buildID=%s, HTTP %s, content-length=%s",
        template_id,
        build_id,
        response.status_code,
        response.headers.get("content-length") ?? "?",
      );
      // v2 trigger may return empty body (202/204 with no content)
      const content = response.content;
      let data: Record<string, any>;
      if (hasBodyContent(content)) {
        try {
          data = response.json();
        } catch (json_err) {
          logger.warning("v2 trigger response not valid JSON: %s (body=%s)", pyExcStr(json_err), pyBytesRepr(content.subarray(0, 200)));
          data = { status: "triggered", raw: bytesDecodeReplace(content).slice(0, 200) };
        }
      } else {
        data = { status: "triggered" };
      }
      return data;
    } catch (exc) {
      if (exc instanceof HTTPStatusError) {
        const status = exc.response.status_code;
        const raw = exc.response.content;
        let body: any;
        try {
          body = responseJson(exc);
        } catch {
          body = { raw: raw && raw.length ? bytesDecodeReplace(raw).slice(0, 200) : "" };
        }
        const message = dictGet(body, "message", pyExcStr(exc));
        throw new TemplateBuildError(`Template build trigger failed (HTTP ${status}): ${message}`);
      }
      throw exc;
    }
  }

  /**
   * Fetch build log entries. GET /templates/{id}/builds/{buildId}/logs → 200
   * Returns list of log entry dicts (timestamp, message, level, step).
   */
  async getBuildLogs(template_id: string, build_id: string): Promise<Record<string, any>[]> {
    try {
      const response = await this._http.platformRequest("GET", `/templates/${template_id}/builds/${build_id}/logs`);
      const content = response.content;
      if (hasBodyContent(content)) {
        try {
          const data = response.json();
          if (Array.isArray(data)) return data;
          return dictGet(data, "logEntries", dictGet(data, "logs", []));
        } catch {
          return [];
        }
      }
      return [];
    } catch (exc) {
      logger.debug("Failed to fetch build logs: %s", pyExcStr(exc));
      return [];
    }
  }

  // ------------------------------------------------------------------ //
  // Shared: build polling
  // ------------------------------------------------------------------ //

  /**
   * Wait for a template build to complete. Polls build status until ready or error.
   *
   * `on_poll`: optional `(status, elapsed_seconds)` callback, fired once per poll including the terminal poll.
   */
  async waitForBuild(template_id: string, build_id: string, opts: WaitForBuildOptions = {}): Promise<Record<string, any>> {
    const { timeout = 600, poll_interval = 5, on_poll = null } = opts;
    let elapsed = 0;
    while (elapsed < timeout) {
      const status_data = await this.getBuildStatus(template_id, build_id);
      const status = pyStr(dictGet(status_data, "status", "building"));
      if (on_poll !== null) on_poll(status, elapsed);

      if (status === "ready") {
        logger.info("Template build complete: templateID=%s, buildID=%s", template_id, build_id);
        return status_data;
      } else if (status === "error") {
        const error_msg = dictGet(status_data, "error", "Unknown build error");
        throw new TemplateBuildError(`Template build failed: ${error_msg}`);
      }

      await _seams.sleep(poll_interval * 1000);
      elapsed += poll_interval;
    }

    throw new TemplateBuildTimeoutError(
      `Template build timed out after ${timeout}s (templateID=${template_id}, buildID=${build_id})`,
    );
  }
}

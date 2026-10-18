/**
 * Run an EPP/1 method table inside the host process.
 *
 * A `node` provider that already speaks EPP (its methods are `sandbox.create`, `exec.run`, ...) does not need a child
 * process: the host calls its dispatcher directly and reuses the exec adapters, so the plugin behaves the same as
 * when it is spawned over stdio. The same module still runs standalone for any other host.
 */

import { SandboxError } from "../models/errors.js";
import { FilesystemProtocol } from "./shared/e2b/filesystem.js";
import { ProcessProtocol } from "./shared/e2b/process.js";
import type { HttpClient } from "../transport/http.js";
import { getLogger } from "../utils/logging.js";
import { AsyncQueue, PROTOCOL, mapError, sanitizeText, type EppPeer, type Notification } from "./epp.js";
import { ExecFilesystemProtocol, ExecProcessProtocol, ExecSandboxProtocol } from "./exec_provider.js";
import { ProviderFeatureNotSupportedError, ProviderProcessError, ProviderProtocolError, ProviderTimeoutError } from "./errors.js";
import { hostVersion } from "./host.js";
import type { NodeContext, NodeInfra } from "./node_provider.js";

type Dict = Record<string, unknown>;

const logger = getLogger("providers.node_epp");

/** The dispatcher a plugin module exposes: `(method, params, call) => result`, throwing `{ code, message, data }`. */
export interface EppDispatcher {
  dispatch(method: string, params: Dict, call: DispatchCall): Promise<unknown>;
}

export interface DispatchCall {
  signal: AbortSignal;
  notify(method: string, params: Dict): void;
  afterResponse(fn: () => void): void;
  shutdown(): void;
}

export interface EppFactory {
  (options: { log: (message: string) => void }): EppDispatcher;
}

function isRpcError(exc: unknown): exc is { code: number; message: string; data?: unknown } {
  return typeof exc === "object" && exc !== null && typeof (exc as { code?: unknown }).code === "number" && "message" in exc;
}

export class InProcessEppClient implements EppPeer {
  features: ReadonlySet<string> = new Set();
  failure: SandboxError | null = null;

  private readonly queues = new Map<string, AsyncQueue<Notification | null>>();
  private readonly early = new Map<string, Notification[]>();
  private readonly pending = new Set<AbortController>();
  private closed = false;

  constructor(
    readonly provider_id: string,
    private readonly plugin: EppDispatcher,
    private readonly secrets: readonly string[],
    private readonly callTimeout = 60,
  ) {}

  private route(method: string, params: Dict): void {
    if (method === "log") {
      logger.debug("[%s] %s", this.provider_id, sanitizeText(String(params["message"] ?? ""), this.secrets));
      return;
    }
    const pid = params["process_id"];
    if (pid === undefined || pid === null) return;
    const key = String(pid);
    const note: Notification = { method, ...params };
    const queue = this.queues.get(key);
    if (queue !== undefined) {
      queue.push(note);
      return;
    }
    const list = this.early.get(key) ?? [];
    list.push(note);
    this.early.set(key, list);
  }

  async start(initParams: Dict): Promise<void> {
    const res = (await this.call("initialize", initParams)) as Dict;
    if (res["protocol"] !== PROTOCOL) {
      throw new ProviderProtocolError(`Provider '${this.provider_id}' answered protocol '${String(res["protocol"])}', expected '${PROTOCOL}'.`);
    }
    const feats = res["features"];
    this.features = Array.isArray(feats) ? new Set(feats.filter((f): f is string => typeof f === "string")) : new Set();
  }

  async call(method: string, params: Dict = {}, opts: { timeout?: number; startup?: boolean } = {}): Promise<unknown> {
    if (this.failure !== null) throw this.failure;
    if (this.closed) throw new ProviderProcessError(`Provider '${this.provider_id}' was closed.`);
    const controller = new AbortController();
    this.pending.add(controller);
    const after: Array<() => void> = [];
    const limit = opts.timeout ?? this.callTimeout;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ProviderTimeoutError(`Provider '${this.provider_id}' did not answer '${method}' within ${limit}s.`));
      }, limit * 1000);
    });
    const run = (async () => {
      try {
        const result = await this.plugin.dispatch(method, params, {
          signal: controller.signal,
          notify: (m, p) => this.route(m, p),
          afterResponse: (fn) => after.push(fn),
          shutdown: () => undefined,
        });
        return result === undefined ? {} : result;
      } catch (exc) {
        if (exc instanceof SandboxError) throw exc;
        if (isRpcError(exc)) throw mapError({ code: exc.code, message: exc.message, data: exc.data }, this.provider_id, this.secrets);
        const message = exc instanceof Error ? `${exc.name}: ${exc.message}` : String(exc);
        throw mapError({ code: -32000, message }, this.provider_id, this.secrets);
      }
    })();
    run.catch(() => undefined);
    try {
      return await Promise.race([run, timeout]);
    } finally {
      clearTimeout(timer);
      this.pending.delete(controller);
      // Hooks run after the caller holds the response, like the stdio loop that writes it first.
      setImmediate(() => {
        for (const fn of after) {
          try {
            fn();
          } catch (exc) {
            logger.debug("[%s] afterResponse hook failed: %s", this.provider_id, String(exc));
          }
        }
      });
    }
  }

  openStream(processId: string): AsyncQueue<Notification | null> {
    const queue = new AsyncQueue<Notification | null>();
    this.queues.set(processId, queue);
    for (const note of this.early.get(processId) ?? []) queue.push(note);
    this.early.delete(processId);
    if (this.failure !== null) queue.push(null);
    return queue;
  }

  closeStream(processId: string): void {
    this.queues.delete(processId);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await this.call("shutdown", {}, { timeout: 2 });
    } catch {
      /* the module may already be down */
    }
    this.closed = true;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
    for (const queue of this.queues.values()) queue.push(null);
    this.queues.clear();
  }
}

/** Protocol objects for an EPP method table that runs in this process (the kit's `epp.infra`). */
export async function eppInfra(ctx: NodeContext, factory: EppFactory): Promise<NodeInfra> {
  const secretKeys = new Set(ctx.secretKeys);
  const secrets = [...secretKeys].map((k) => ctx.options[k]).filter((v): v is string => typeof v === "string" && v !== "");
  const apiKey = ctx.core["sandbox_api_key"];
  if (typeof apiKey === "string" && apiKey) secrets.push(apiKey);

  const plugin = factory({ log: (message) => logger.debug("[%s] %s", ctx.id, sanitizeText(message, secrets)) });
  const client = new InProcessEppClient(ctx.id, plugin, secrets, ctx.callTimeout);
  try {
    await client.start({
      protocol: PROTOCOL,
      host: { name: "abx", version: hostVersion() },
      provider_id: ctx.id,
      config: ctx.options,
      core: ctx.core,
      locale: "en",
      data_dir: "",
    });
  } catch (exc) {
    await client.close();
    throw exc;
  }

  const supported = new Set([...ctx.features].filter((f) => client.features.size === 0 || client.features.has(f)));
  let http: HttpClient | null = null;
  const needsHttp = ["exec.run", "exec.stream", "files.rw", "process.manage"].some((f) => supported.has(f));
  if (needsHttp) http = ctx.http({ base_url: "", domain: "", auth: ctx.noAuth() });
  const nativeProcess = http === null ? null : new ProcessProtocol(http);
  const nativeFiles = http === null ? null : new FilesystemProtocol(http);

  return {
    provider_commands: {
      run: async (command, input) => {
        try { return await client.call("provider.commands.run", { command, input }); }
        catch (exc) {
          if (exc instanceof ProviderProtocolError && exc.rpc_code === -32601) throw new ProviderFeatureNotSupportedError(ctx.id, `command:${command}`);
          throw exc;
        }
      },
    },
    sandbox_protocol: new ExecSandboxProtocol(client, supported, secretKeys),
    process_protocol: new ExecProcessProtocol(client, supported, nativeProcess),
    filesystem_protocol: new ExecFilesystemProtocol(client, supported, nativeFiles),
    http_client: http,
    auth: ctx.noAuth(),
    close: async () => {
      await client.close();
    },
  };
}

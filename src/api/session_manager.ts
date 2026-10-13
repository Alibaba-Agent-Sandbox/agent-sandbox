/**
 * Session manager — create, connect, list, and stop named sessions (port of `api/session_manager.py`).
 *
 * A *session* is a thin wrapper that pairs a human-friendly name with a sandbox ID and persists the mapping so a user
 * can resume work later.
 */

import { SessionAlreadyExistsError, SessionNotFoundError } from "../models/errors.js";
import { SessionInfo } from "../models/session.js";
import { LocalSessionStore } from "../session/local.js";
import { getLogger, ExcInfo } from "../utils/logging.js";
import { pyRepr } from "../utils/_pyformat.js";
import { Sandbox } from "./sandbox.js";

const logger = getLogger("api.session_manager");

function utcNow(): Date {
  return new Date();
}

export interface SessionStartOptions {
  timeout?: number;
  metadata?: Record<string, string> | null;
  envs?: Record<string, string> | null;
  api_key?: string | null;
  api_url?: string | null;
  domain?: string | null;
}

export interface SessionConnectOptions {
  api_key?: string | null;
  api_url?: string | null;
  domain?: string | null;
}

/** High-level API for named session lifecycle management. `store`: pluggable storage backend (defaults to `LocalSessionStore`). */
export class SessionManager {
  _store: LocalSessionStore;

  constructor(store: LocalSessionStore | null = null) {
    this._store = store || new LocalSessionStore();
  }

  /** Create a new sandbox and persist the session. Throws `SessionAlreadyExistsError` if `name` is already in use. */
  async start(name: string, template: string = "base", opts: SessionStartOptions = {}): Promise<Sandbox> {
    const { timeout = 300, metadata = null, envs = null, api_key = null, api_url = null, domain = null } = opts;
    const existing = await this._store.load(name);
    if (existing !== null) {
      throw new SessionAlreadyExistsError(`Session ${pyRepr(name)} already exists (sandbox ${existing.sandbox_id})`);
    }

    const sandbox = await Sandbox.create(template, { timeout, metadata, envs, api_key, api_url, domain });

    const session_info = new SessionInfo({
      name,
      sandbox_id: sandbox.id,
      template,
      api_url: api_url || "",
      domain: domain || "",
      envd_access_token: sandbox.info.envd_access_token || "",
      status: "running",
      created_at: utcNow(),
      last_connected: utcNow(),
      metadata: metadata && Object.keys(metadata).length ? metadata : {},
    });
    await this._store.save(name, session_info);
    logger.info("Session %r started (sandbox %s)", name, sandbox.id);
    return sandbox;
  }

  /** Resume a session by name. Throws `SessionNotFoundError` if the session does not exist. */
  async connect(name: string, opts: SessionConnectOptions = {}): Promise<Sandbox> {
    const { api_key = null, api_url = null, domain = null } = opts;
    const session = await this._store.load(name);
    if (session === null) {
      throw new SessionNotFoundError(`Session ${pyRepr(name)} not found`);
    }

    const sandbox = await Sandbox.connect(session.sandbox_id as string, {
      api_key,
      api_url: api_url || session.api_url || null,
      domain: domain || session.domain || null,
    });

    // Update last_connected timestamp
    session.last_connected = utcNow();
    session.status = "running";
    await this._store.save(name, session);

    logger.info("Session %r reconnected (sandbox %s)", name, sandbox.id);
    return sandbox;
  }

  /** Return all persisted sessions. */
  async listSessions(): Promise<SessionInfo[]> {
    return this._store.listAll();
  }

  /**
   * Stop a session. If `kill` is true (default), kill the sandbox and remove the session record. If false, keep the
   * sandbox alive and only mark the session as stopped.
   */
  async stop(name: string, opts: { kill?: boolean } = {}): Promise<void> {
    const kill = opts.kill ?? true;
    const session = await this._store.load(name);
    if (session === null) {
      throw new SessionNotFoundError(`Session ${pyRepr(name)} not found`);
    }

    if (kill && session.sandbox_id) {
      try {
        await Sandbox.killById(session.sandbox_id);
        logger.info("Sandbox %s killed for session %r", session.sandbox_id, name);
      } catch (e) {
        logger.warning("Failed to kill sandbox %s for session %r", session.sandbox_id, name, new ExcInfo(e));
      }
    }

    if (kill) {
      await this._store.delete(name);
    } else {
      session.status = "stopped";
      await this._store.save(name, session);
    }
  }

  /** Return session info. Throws `SessionNotFoundError` if the session does not exist. */
  async getInfo(name: string): Promise<SessionInfo> {
    const session = await this._store.load(name);
    if (session === null) {
      throw new SessionNotFoundError(`Session ${pyRepr(name)} not found`);
    }
    return session;
  }
}

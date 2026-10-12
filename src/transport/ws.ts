/**
 * WebSocket client for PTY terminal and bidirectional channels.
 *
 * WebSocket disconnection typically means the sandbox has been terminated.  Reconnection is the caller's
 * responsibility — this client provides only basic connect / disconnect / send / receive functionality.
 *
 * The protocol layer is a port of the Python `websockets` library the SDK uses (see `_websockets.ts`), so handshake
 * redirects, environment proxies, close-code semantics and the exception texts match: heartbeat is a ping every
 * `ws_ping_interval` seconds with a keepalive failure (close code 1011) when no pong arrives within
 * `ws_ping_interval * 2`; the handshake is bounded by `open_timeout=10` and the closing handshake by `close_timeout=10`;
 * messages above 1 MiB are rejected (`max_size=2**20`).
 */

import { ConnectionError_ } from "../models/errors.js";
import { getLogger } from "../utils/logging.js";
import { CancelSignal, CancelledError, ConnectionClosed, connect as wsConnect, type Connection } from "./_websockets.js";
import type { TransportConfig } from "./config.js";

const logger = getLogger("transport.ws");

/** Lightweight alias — a lost connection is still a ConnectionError_. */
export const ConnectionLostError = ConnectionError_;
export type ConnectionLostError = ConnectionError_;

export const HAS_WEBSOCKETS = true;

/** Python `asyncio.TimeoutError` (raised by `receive(timeout=...)`). */
export class AsyncioTimeoutError extends Error {
  constructor() {
    super("");
    this.name = "TimeoutError";
  }
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Async WebSocket client with native heartbeat.
 *
 * Used for PTY terminal connections and other bidirectional channels.  Auto-reconnect has been intentionally removed:
 * a WebSocket disconnection usually signals that the sandbox has been terminated, so reconnection decisions belong to
 * the higher-level caller.
 */
export class WebSocketClient {
  _url: string;
  _config: TransportConfig;
  _extra_headers: Record<string, string>;
  _ws: Connection | null = null;
  _connected = false;
  _closed = false;

  constructor(url: string, opts: { config: TransportConfig; extra_headers?: Record<string, string> | null }) {
    this._url = url;
    this._config = opts.config;
    this._extra_headers = opts.extra_headers || {};
  }

  /**
   * Establish WebSocket connection.
   *
   * Heartbeat is driven by `ws_ping_interval` / `ws_ping_interval * 2`.
   */
  async connect(): Promise<void> {
    try {
      const interval = this._config.ws_ping_interval;
      this._ws = await wsConnect(this._url, {
        additionalHeaders: this._extra_headers,
        pingInterval: interval || null,
        pingTimeout: interval ? interval * 2 : null,
        closeTimeout: 10,
      });
      this._connected = true;
      this._closed = false;
      logger.debug("WebSocket connected to %s", this._url);
    } catch (exc) {
      throw new ConnectionError_(`Failed to establish WebSocket connection: ${errText(exc)}`, {
        suggestion: "Check WebSocket URL and network connectivity.",
      });
    }
  }

  /** Send a message over the WebSocket. */
  async send(data: string | Uint8Array): Promise<void> {
    if (!this._connected || this._ws === null) {
      throw new ConnectionLostError("WebSocket is not connected");
    }
    try {
      await this._ws.send(data);
    } catch (exc) {
      this._connected = false;
      throw new ConnectionLostError(`Failed to send WebSocket message: ${errText(exc)}`);
    }
  }

  /**
   * Receive the next message from the WebSocket.
   *
   * `timeout`: Max seconds to wait. null = wait forever.
   * Raises ConnectionLostError if connection is lost while waiting, AsyncioTimeoutError if the timeout expires.
   */
  async receive(opts: { timeout?: number | null } = {}): Promise<string | Buffer> {
    const timeout = opts.timeout ?? null;
    if (!this._connected || this._ws === null) {
      throw new ConnectionLostError("WebSocket is not connected");
    }
    try {
      if (timeout === null) return await this._ws.recv();
      const signal = new CancelSignal();
      const pending = this._ws.recv(signal);
      return await new Promise<string | Buffer>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal.abort();
          reject(new AsyncioTimeoutError());
        }, Math.max(0, timeout) * 1000);
        pending.then(
          (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          (e) => {
            clearTimeout(timer);
            if (!(e instanceof CancelledError)) reject(e);
          },
        );
      });
    } catch (exc) {
      if (exc instanceof AsyncioTimeoutError) throw exc;
      this._connected = false;
      throw new ConnectionLostError(`WebSocket receive error: ${errText(exc)}`);
    }
  }

  /** Iterate over received messages until the connection closes. */
  async *recvIter(): AsyncGenerator<string | Buffer> {
    if (this._ws === null) {
      throw new ConnectionLostError("WebSocket is not connected");
    }
    try {
      for (;;) {
        let message: string | Buffer;
        try {
          message = await this._ws.recv();
        } catch (e) {
          if (e instanceof ConnectionClosed && e.ok) return;
          throw e;
        }
        if (this._closed) break;
        yield message;
      }
    } catch (exc) {
      if (!this._closed) {
        this._connected = false;
        throw new ConnectionLostError(`WebSocket connection lost: ${errText(exc)}`);
      }
    }
  }

  get is_connected(): boolean {
    return this._connected;
  }

  /** Close the WebSocket connection. */
  async close(): Promise<void> {
    this._closed = true;
    this._connected = false;

    const ws = this._ws;
    if (ws) {
      try {
        await ws.close();
      } catch {
        /* contextlib.suppress(Exception) */
      }
      this._ws = null;
    }
    logger.debug("WebSocket closed");
  }

  async __aenter__(): Promise<WebSocketClient> {
    await this.connect();
    return this;
  }

  async __aexit__(..._args: unknown[]): Promise<void> {
    await this.close();
  }
}

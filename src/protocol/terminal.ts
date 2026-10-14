/**
 * PTY terminal protocol — WebSocket bidirectional channel (port of `protocol/terminal.py`).
 *
 * Provides interactive terminal access to sandboxes via WebSocket. Supports terminal resize, input/output streaming.
 */

import { WebSocketClient } from "../transport/ws.js";
import type { EnvdTokenManager } from "../transport/auth.js";
import type { TransportConfig } from "../transport/config.js";
import { getLogger } from "../utils/logging.js";
import { pyJsonDumps } from "../utils/_pyformat.js";

const logger = getLogger("protocol.terminal");

/** Interactive PTY terminal session over WebSocket. */
export class TerminalSession {
  _ws: WebSocketClient;

  constructor(ws_client: WebSocketClient) {
    this._ws = ws_client;
  }

  /** Create a new terminal session. Establishes WebSocket connection to the sandbox PTY endpoint. */
  static async create(
    envd_url: string,
    envd_token: EnvdTokenManager,
    config: TransportConfig,
    opts: { cols?: number; rows?: number; shell?: string; dial?: readonly [string, number] | null } = {},
  ): Promise<TerminalSession> {
    const { cols = 80, rows = 24, shell = "/bin/bash" } = opts;
    // Convert HTTP URL to WebSocket URL
    let ws_url = envd_url.split("https://").join("wss://").split("http://").join("ws://");
    ws_url = `${ws_url}/terminal`;

    const headers = { ...envd_token.getHeaders() };

    const ws_client = new WebSocketClient(ws_url, { config, extra_headers: headers, dial: opts.dial ?? null });
    await ws_client.connect();

    const session = new TerminalSession(ws_client);

    // Send initial resize
    await session.resize(cols, rows);

    logger.debug("Terminal session created (%dx%d, shell=%s)", cols, rows, shell);
    return session;
  }

  /** Send input to the terminal. */
  async send(data: string): Promise<void> {
    await this._ws.send(data);
  }

  /** Send raw bytes to the terminal. */
  async sendBytes(data: Uint8Array): Promise<void> {
    await this._ws.send(data);
  }

  /** Receive output from the terminal. */
  async receive(timeout: number | null = null): Promise<string | Uint8Array> {
    return this._ws.receive({ timeout });
  }

  /** Iterate over terminal output. */
  async *outputStream(): AsyncGenerator<string | Uint8Array> {
    for await (const msg of this._ws.recvIter()) {
      yield msg;
    }
  }

  /** Resize the terminal. Sends a JSON control message to resize the PTY. */
  async resize(cols: number, rows: number): Promise<void> {
    const control_msg = pyJsonDumps({ type: "resize", cols, rows });
    await this._ws.send(control_msg);
    logger.debug("Terminal resized to %dx%d", cols, rows);
  }

  get is_connected(): boolean {
    return this._ws.is_connected;
  }

  /** Close the terminal session. */
  async close(): Promise<void> {
    await this._ws.close();
    logger.debug("Terminal session closed");
  }

  async __aenter__(): Promise<this> {
    return this;
  }

  async __aexit__(): Promise<void> {
    await this.close();
  }
}

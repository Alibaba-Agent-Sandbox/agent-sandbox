/** Tests for protocol.terminal module — PTY WebSocket terminal. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const wsState = vi.hoisted(() => ({ captured: {} as Record<string, any> }));

vi.mock("../../src/transport/ws.js", () => {
  class FakeWS {
    is_connected = true;
    constructor(url: string, opts: { config: unknown; extra_headers?: Record<string, string> }) {
      wsState.captured["url"] = url;
      wsState.captured["headers"] = opts.extra_headers;
    }
    async connect() {}
    async send(_data: unknown) {}
    async close() {}
  }
  return { WebSocketClient: FakeWS };
});

import { TerminalSession } from "../../src/providers/shared/e2b/terminal.js";
import { EnvdTokenManager } from "../../src/providers/alicloud_express/auth.js";
import { TransportConfig } from "../../src/transport/config.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function mock_ws(): any {
  return {
    send: vi.fn(async () => undefined),
    receive: vi.fn(async () => "output data"),
    close: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    is_connected: true,
  };
}

beforeEach(() => {
  wsState.captured = {};
});

describe("TestTerminalSession", () => {
  // Test TerminalSession construction and basic ops.
  it("test_init", () => {
    const ws = mock_ws();
    const session = new TerminalSession(ws);
    expect(session._ws).toBe(ws);
  });

  it("test_send", async () => {
    const ws = mock_ws();
    const session = new TerminalSession(ws);
    await session.send("ls\n");
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(ws.send).toHaveBeenCalledWith("ls\n");
  });

  it("test_send_bytes", async () => {
    const ws = mock_ws();
    const session = new TerminalSession(ws);
    await session.sendBytes(new Uint8Array([0x03]));
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(ws.send).toHaveBeenCalledWith(new Uint8Array([0x03]));
  });

  it("test_receive", async () => {
    const ws = mock_ws();
    const session = new TerminalSession(ws);
    const result = await session.receive(5.0);
    expect(result).toBe("output data");
    expect(ws.receive).toHaveBeenCalledTimes(1);
    expect(ws.receive).toHaveBeenCalledWith({ timeout: 5.0 });
  });

  it("test_resize_sends_json", async () => {
    const ws = mock_ws();
    const session = new TerminalSession(ws);
    await session.resize(120, 40);

    expect(ws.send).toHaveBeenCalledTimes(1);
    const sent = ws.send.mock.calls[0][0];
    const parsed = JSON.parse(sent);
    expect(parsed).toEqual({ type: "resize", cols: 120, rows: 40 });
  });

  it("test_close", async () => {
    const ws = mock_ws();
    const session = new TerminalSession(ws);
    await session.close();
    expect(ws.close).toHaveBeenCalledTimes(1);
  });

  it("test_is_connected", () => {
    const ws = mock_ws();
    const session = new TerminalSession(ws);
    expect(session.is_connected).toBe(true);
  });

  it("test_context_manager", async () => {
    const ws = mock_ws();
    const session = await new TerminalSession(ws).__aenter__();
    try {
      await session.send("test");
    } finally {
      await session.__aexit__();
    }
    expect(ws.close).toHaveBeenCalledTimes(1);
  });
});

describe("TestTerminalURLConversion", () => {
  // Test URL conversion logic in TerminalSession.create().
  it("test_https_to_wss", async () => {
    // Verify that HTTPS envd_url is converted to WSS.
    const envd_url = "https://envd-sbx-123.example.com";
    const envd_token = new EnvdTokenManager("tok-123");
    const config = new TransportConfig({ http2: false });

    await TerminalSession.create(envd_url, envd_token, config, { cols: 80, rows: 24 });
    expect(wsState.captured["url"]).toBe("wss://envd-sbx-123.example.com/terminal");
    expect("X-Access-Token" in wsState.captured["headers"]).toBe(true);
    expect(wsState.captured["headers"]["X-Access-Token"]).toBe("tok-123");
  });

  it("test_http_to_ws", async () => {
    // Verify that HTTP envd_url is converted to WS.
    const envd_url = "http://localhost:3000";
    const envd_token = new EnvdTokenManager("tok-local");
    const config = new TransportConfig({ http2: false });

    await TerminalSession.create(envd_url, envd_token, config);
    expect(wsState.captured["url"]).toBe("ws://localhost:3000/terminal");
  });
});

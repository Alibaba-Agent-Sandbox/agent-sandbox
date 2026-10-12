/** Tests for transport.ws module. */

import { describe, expect, it } from "vitest";

import { TransportConfig } from "../../src/transport/config.js";
import { WebSocketClient } from "../../src/transport/ws.js";

// ws_config fixture
function ws_config(): TransportConfig {
  return new TransportConfig({ ws_ping_interval: 10.0 });
}

describe("TestWebSocketClient", () => {
  // Test WebSocketClient construction and properties.

  it("test_construction", () => {
    const cfg = ws_config();
    const ws = new WebSocketClient("wss://example.com/ws", { config: cfg });
    expect(ws._url).toBe("wss://example.com/ws");
    expect(ws._config).toBe(cfg);
    expect(ws.is_connected).toBeFalsy();
    expect(ws._closed).toBeFalsy();
  });

  it("test_construction_with_extra_headers", () => {
    const headers = { "X-Access-Token": "my-token" };
    const ws = new WebSocketClient("wss://example.com/ws", { config: ws_config(), extra_headers: headers });
    expect(ws._extra_headers).toEqual(headers);
  });

  it("test_is_connected_default_false", () => {
    const ws = new WebSocketClient("wss://example.com/ws", { config: ws_config() });
    expect(ws.is_connected).toBe(false);
  });

  it("test_close_without_connect", async () => {
    const ws = new WebSocketClient("wss://example.com/ws", { config: ws_config() });
    await ws.close();
    expect(ws._closed).toBe(true);
    expect(ws.is_connected).toBe(false);
  });

  it("test_close_idempotent", async () => {
    const ws = new WebSocketClient("wss://example.com/ws", { config: ws_config() });
    await ws.close();
    await ws.close(); // Should not raise
    expect(ws._closed).toBe(true);
  });
});

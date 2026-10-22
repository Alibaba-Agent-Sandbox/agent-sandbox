/** Explicit placeholder configuration for tests that replace cloud APIs, not the configuration preflight. */
import { afterEach, beforeEach } from "vitest";
import { resetConfig } from "../../src/transport/config.js";
import { resetLayeredConfig } from "../../src/transport/config_layers.js";

/** Register after environment-isolation fixtures so SDK mock tests reach their mocked remote behavior. */
export function useMockCloudConfiguration(): void {
  const values = { ABX_SANDBOX_API_KEY: "placeholder-sandbox", ALICLOUD_ACCESS_KEY_ID: "placeholder-ak", ALICLOUD_ACCESS_KEY_SECRET: "placeholder-sk" };
  let previous: Record<string, string | undefined> = {};
  beforeEach(() => {
    previous = {};
    for (const [name, value] of Object.entries(values)) {
      previous[name] = process.env[name];
      if (!process.env[name]) process.env[name] = value;
    }
    resetConfig(); resetLayeredConfig();
  });
  afterEach(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    resetConfig(); resetLayeredConfig();
  });
}

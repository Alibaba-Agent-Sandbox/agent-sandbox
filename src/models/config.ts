/** Global configuration data model. */

import { z } from "zod";

import { defineModel, lax } from "./base.js";

/**
 * SDK-wide configuration settings.
 *
 * This is the data model for configuration. The actual loading logic (env vars, .env files, config.toml) is in
 * `transport/config.ts`.
 */
export class GlobalConfig extends defineModel(
  z.object({
    api_key: z.string().nullable().default(null),
    access_key_id: z.string().nullable().default(null),
    access_key_secret: z.string().nullable().default(null),

    api_url: z.string().default("https://api.cn-hangzhou.e2b.fc.aliyuncs.com"),
    domain: z.string().default("cn-hangzhou.e2b.fc.aliyuncs.com"),
    region: z.string().default("cn-hangzhou"),
    timeout: lax.int(1).default(300),
    max_retries: lax.int(0, 10).default(3),
    secure: lax.bool().default(true),

    log_level: z.string().default("WARNING"),

    default_template: z.string().default("base"),
  }),
) {
  /** Generate the Platform API URL for a given region. */
  static apiUrlForRegion(region: string): string {
    return `https://api.${region}.e2b.fc.aliyuncs.com`;
  }

  /** Generate the data-plane domain for a given region. */
  static domainForRegion(region: string): string {
    return `${region}.e2b.fc.aliyuncs.com`;
  }
}

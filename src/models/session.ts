/**
 * Session management data models.
 *
 * 注意：Session 管理为 SDK 扩展功能，阿里云官方文档中未定义此概念。
 */

import { z } from "zod";

import { defineModel, lax, nested } from "./base.js";

/** Configuration for a session. */
export class SessionConfig extends defineModel(
  z.object({
    name: z.string(),
    description: z.string().default(""),
    sandbox_template: z.string().default("base"),
    auto_connect: lax.bool().default(true),
    ttl: lax.int(0).default(86400), // Session TTL in seconds, 0=infinite
    envs: lax.stringMap().default(() => ({})),
    metadata: lax.stringMap().default(() => ({})),
  }),
) {}

/** Information about a persisted session. */
export class SessionInfo extends defineModel(
  z.object({
    session_id: z.string().default(""),
    name: z.string(),
    sandbox_id: z.string().nullable().default(null),
    template: z.string().default("base"),
    api_url: z.string().default(""),
    domain: z.string().default(""),
    envd_access_token: z.string().default(""),
    status: z.string().default("active"),
    created_at: lax.date().nullable().default(null),
    last_connected: lax.date().nullable().default(null),
    metadata: lax.stringMap().default(() => ({})),
    config: nested(SessionConfig).nullable().default(null),
  }),
  {
    aliases: {
      session_id: "sessionId",
      sandbox_id: "sandboxId",
      api_url: "apiUrl",
      envd_access_token: "envdAccessToken",
      created_at: "createdAt",
      last_connected: "lastConnected",
    },
  },
) {}

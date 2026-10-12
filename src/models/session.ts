/**
 * Session management data models (port of `models/session.py`).
 *
 * 注意：Session 管理为 SDK 扩展功能，阿里云官方文档中未定义此概念。
 */

import {
  BaseModel,
  type ModelInput,
  bool,
  datetime,
  dict,
  field,
  int,
  modelOf,
  optional,
  str,
  type PyDatetime,
} from "./_pydantic.js";

/** Configuration for a session. */
export class SessionConfig extends BaseModel {
  static override modelFields = {
    name: field(str()),
    description: field(str(), { default: "" }),
    sandbox_template: field(str(), { default: "base" }),
    auto_connect: field(bool(), { default: true }),
    ttl: field(int({ ge: 0 }), { default: 86400 }), // Session TTL in seconds, 0=infinite
    envs: field(dict(str(), str()), { default_factory: () => ({}) }),
    metadata: field(dict(str(), str()), { default_factory: () => ({}) }),
  };

  declare name: string;
  declare description: string;
  declare sandbox_template: string;
  declare auto_connect: boolean;
  declare ttl: number;
  declare envs: Record<string, string>;
  declare metadata: Record<string, string>;

  constructor(data: ModelInput = {}) {
    super(data);
  }
}

/** Information about a persisted session. */
export class SessionInfo extends BaseModel {
  static override modelConfig = { populate_by_name: true };
  static override modelFields = {
    session_id: field(str(), { alias: "sessionId", default: "" }),
    name: field(str()),
    sandbox_id: field(optional(str()), { alias: "sandboxId", default: null }),
    template: field(str(), { default: "base" }),
    api_url: field(str(), { alias: "apiUrl", default: "" }),
    domain: field(str(), { default: "" }),
    envd_access_token: field(str(), { alias: "envdAccessToken", default: "" }),
    status: field(str(), { default: "active" }),
    created_at: field(optional(datetime()), { alias: "createdAt", default: null }),
    last_connected: field(optional(datetime()), { alias: "lastConnected", default: null }),
    metadata: field(dict(str(), str()), { default_factory: () => ({}) }),
    config: field(optional(modelOf(() => SessionConfig)), { default: null }),
  };

  declare session_id: string;
  declare name: string;
  declare sandbox_id: string | null;
  declare template: string;
  declare api_url: string;
  declare domain: string;
  declare envd_access_token: string;
  declare status: string;
  declare created_at: PyDatetime | null;
  declare last_connected: PyDatetime | null;
  declare metadata: Record<string, string>;
  declare config: SessionConfig | null;

  constructor(data: ModelInput = {}) {
    super(data);
  }
}

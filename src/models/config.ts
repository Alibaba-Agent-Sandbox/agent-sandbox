/** Global configuration data model (port of `models/config.py`). */

import { BaseModel, type ModelInput, bool, field, int, optional, str } from "./_pydantic.js";

/**
 * SDK-wide configuration settings.
 *
 * This is the data model for configuration. The actual loading logic (env vars, .env files, config.toml) is in
 * `transport/config.ts`.
 */
export class GlobalConfig extends BaseModel {
  static override modelFields = {
    // Authentication
    api_key: field(optional(str()), { default: null }),
    access_key_id: field(optional(str()), { default: null }),
    access_key_secret: field(optional(str()), { default: null }),

    // Connection
    api_url: field(str(), { default: "https://api.cn-hangzhou.e2b.fc.aliyuncs.com" }),
    domain: field(str(), { default: "cn-hangzhou.e2b.fc.aliyuncs.com" }),
    region: field(str(), { default: "cn-hangzhou" }),
    timeout: field(int({ ge: 1 }), { default: 300 }),
    max_retries: field(int({ ge: 0, le: 10 }), { default: 3 }),
    secure: field(bool(), { default: true }),

    // Logging
    log_level: field(str(), { default: "WARNING" }),

    // CLI
    default_template: field(str(), { default: "base" }),
  };

  declare api_key: string | null;
  declare access_key_id: string | null;
  declare access_key_secret: string | null;
  declare api_url: string;
  declare domain: string;
  declare region: string;
  declare timeout: number;
  declare max_retries: number;
  declare secure: boolean;
  declare log_level: string;
  declare default_template: string;

  constructor(data: ModelInput = {}) {
    super(data);
  }

  /** Generate the Platform API URL for a given region. */
  static apiUrlForRegion(region: string): string {
    return `https://api.${region}.e2b.fc.aliyuncs.com`;
  }

  /** Generate the data-plane domain for a given region. */
  static domainForRegion(region: string): string {
    return `${region}.e2b.fc.aliyuncs.com`;
  }
}

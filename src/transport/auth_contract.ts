/** Authentication contracts and explicit bearer credentials, independent of any cloud. */
import { InvalidAPIKeyError, type InvalidCredentialsError } from "../models/errors.js";
import { pyStrip } from "../utils/_pyformat.js";
export interface AuthProvider {
  getHeaders(): Promise<Record<string, string>>;
  refresh(): Promise<void>;
  authenticationError?(path: string): InvalidAPIKeyError | InvalidCredentialsError;
}
export interface DataPlaneAuth {
  readonly token: string | null;
  readonly sandbox_id: string | null;
  getHeaders(): Record<string, string>;
  setToken(token: string, sandbox_id?: string | null): void;
  clear(): void;
}
export const PLATFORM_AUTH_HEADER = "Authorization";
export class ApiKeyAuth implements AuthProvider {
  _api_key: string;

  constructor(api_key: string) {
    if (!api_key || !pyStrip(api_key)) {
      throw new InvalidAPIKeyError("API key cannot be empty");
    }
    this._api_key = pyStrip(api_key);
  }

  /** Return Authorization: Bearer header (已实测验证). */
  async getHeaders(): Promise<Record<string, string>> {
    return { [PLATFORM_AUTH_HEADER]: `Bearer ${this._api_key}` };
  }

  /** No-op for API key auth. */
  async refresh(): Promise<void> {
    /* nothing to do */
  }
}

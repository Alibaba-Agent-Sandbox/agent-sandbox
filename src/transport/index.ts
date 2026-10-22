/** L1 Transport and Authentication layer. */

export { ApiKeyAuth, type AuthProvider } from "../providers/alicloud_express/auth.js";
export { TransportConfig } from "./config.js";
export { HttpClient } from "./http.js";

export const __all__ = ["TransportConfig", "HttpClient", "ApiKeyAuth", "AuthProvider"];

export type { DataPlaneAuth } from "./auth_contract.js";

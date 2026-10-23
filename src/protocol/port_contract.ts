/** Port addressing and gateway authentication supplied by a provider. */
export interface PortContext {
  sandbox_id: string;
  domain: string;
  secure: boolean;
  access_token: string | null;
}

export interface PortAccess {
  getHost(port: number): string;
  getUrl(port: number): string;
  getAccessHeaders(): Record<string, string>;
  getServerHeaders(): Record<string, string>;
}

/** Private adapter-resolved endpoint; URLs, signed queries and headers must not enter ordinary logs. */
export interface ApplicationEndpoint {
  provider_id: string;
  sandbox_id: string;
  port: number;
  url: string;
  headers: Record<string, string>;
  authentication_audience: "gateway";
  path_mode: "prefix" | "operation-signed";
  expires_at?: string;
}

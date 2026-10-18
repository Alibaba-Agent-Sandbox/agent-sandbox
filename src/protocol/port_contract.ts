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

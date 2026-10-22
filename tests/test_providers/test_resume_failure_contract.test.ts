/** Backend permission and server failures must never become successful read-only connects. */
import http from "node:http";
import { expect, it, vi } from "vitest";
import { resumeConnect } from "../../src/providers/node_provider.js";
import { SandboxProtocol } from "../../src/providers/shared/e2b/sandbox.js";
import { HttpClient } from "../../src/transport/http.js";
import { TransportConfig } from "../../src/transport/config.js";
import { ApiKeyAuth } from "../../src/transport/auth_contract.js";
import { AlicloudExpressProvider } from "../../src/providers/alicloud_express/index.js";
import { ProviderFeatureNotSupportedError } from "../../src/models/provider_errors.js";
import { TerminalSession } from "../../src/providers/shared/e2b/terminal.js";
import type { TerminalContext } from "../../src/providers/base.js";
it.each([403,409,429,500,503])("preserves HTTP %i and never sends the fallback GET", async status => {
  const requests: string[]=[];
  const server=http.createServer((req,res)=>{
    requests.push(req.method!);
    res.writeHead(req.method==='POST'?status:200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ sandboxID:'owned',templateID:'base' }));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as import('node:net').AddressInfo;
  const client=new HttpClient(new TransportConfig({api_url:`http://127.0.0.1:${address.port}`,http2:false}),new ApiKeyAuth('synthetic-fixture-key'));
  try {
    const protocol=resumeConnect(new SandboxProtocol(client));
    await expect(protocol.connect('owned')).rejects.toMatchObject({response:{status_code:status}});
    expect(requests).toEqual(['POST']);
  } finally { await client.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
it("checks the native PTY feature before invoking its wire adapter",async()=>{
  const provider=new AlicloudExpressProvider();(provider.features as Set<string>).delete('pty');
  const start=vi.spyOn(TerminalSession,'create');
  try {
    await expect(provider.openTerminal({} as TerminalContext,{cols:80,rows:24,shell:'sh'})).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError);
    expect(start).not.toHaveBeenCalled();
  } finally {start.mockRestore();}
});

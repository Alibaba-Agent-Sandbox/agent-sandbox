import { afterEach, describe, expect, it, vi } from "vitest";
import { applicationHttpSeams, applicationOperationUrl, requestApplication, validateApplicationEndpoint } from "../../src/transport/application_http.js";
import type { ApplicationEndpoint } from "../../src/protocol/port_contract.js";
const originalFetch = applicationHttpSeams.fetch;
afterEach(() => { applicationHttpSeams.fetch = originalFetch; });
const endpoint = (): ApplicationEndpoint => ({provider_id: "opensandbox", sandbox_id: "owned", port: 9000,
  url: "https://gateway.invalid/sandboxes/owned/ports/9000?signature=private", headers: {"X-Gateway-Token": "gateway-only"},
  authentication_audience: "gateway", path_mode: "prefix"});
describe("application port binding", () => {
  it("preserves the sandbox proxy path and signed query while isolating app and gateway credentials", async () => {
    const fetch = vi.fn(async () => new Response('{"result":42}', {status:200})); applicationHttpSeams.fetch = fetch as never;
    await requestApplication(validateApplicationEndpoint(endpoint(), "owned", 9000), "/commands/run", {method: "POST",json:{x:1},application_token: "application-only"});
    expect(fetch.mock.calls[0]).toEqual(["https://gateway.invalid/sandboxes/owned/ports/9000/commands/run?signature=private", expect.objectContaining({
      redirect: "manual", headers:{"X-Gateway-Token":"gateway-only","Authorization":"Bearer application-only","X-Access-Token":"application-only","Content-Type":"application/json"}})]);
  });
  it.each(["//other", "/../other", "/%2e%2e/other", "/%252e%252e/other", "/commands/%2fother", "/commands//other", "/commands?other=1", "/\t../\t../victim/9000/health", "/%09../%09../victim/9000/health", "/commands/%00", "/commands/%7f"])("rejects ambiguous or escaping operation %s before sending credentials", async operation => {
    const fetch = vi.fn(); applicationHttpSeams.fetch = fetch;
    await expect(requestApplication(endpoint(), operation, {method: "POST"})).rejects.toThrow("path escapes"); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a same-origin cross-sandbox redirect and never replays payload or credentials", async () => {
    const fetch = vi.fn(async () => new Response(null, {status:307,headers:{Location:"/sandboxes/other/ports/9000/commands/run"}})); applicationHttpSeams.fetch = fetch as never;
    await expect(requestApplication(endpoint(), "/commands/run", {method: "POST",json:{payload:1}})).rejects.toThrow("redirects");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not retry an authentication failure with anonymous identity", async () => {
    const fetch = vi.fn(async () => new Response('{"error":"unauthorized"}', {status:401})); applicationHttpSeams.fetch = fetch as never;
    expect((await requestApplication(endpoint(), "/commands", {method:"GET"})).status_code).toBe(401); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects userinfo, expired descriptors and a different sandbox or port", () => {
    expect(() => validateApplicationEndpoint({...endpoint(),url:"https://user:password@gateway.invalid"},"owned",9000)).toThrow("user information");
    expect(() => validateApplicationEndpoint({...endpoint(),expires_at:"2000-01-01T00:00:00Z"},"owned",9000)).toThrow("expired");
    expect(() => validateApplicationEndpoint(endpoint(),"other",9000)).toThrow("does not match");
    expect(() => validateApplicationEndpoint(endpoint(),"owned",9001)).toThrow("does not match");
  });
  it("requires adapter signing for a path-scoped signed URL", () => {
    expect(() => applicationOperationUrl({...endpoint(),path_mode:"operation-signed"},"/commands")).toThrow("adapter-signed");
  });
});

it("executes against a real HTTP server with the exact proxy binding and separate credentials", async () => {
  const { createServer } = await import("node:http");
  const observed: Array<{url:string;authorization?:string;gateway?:string;body:string}> = [];
  const server=createServer(async(req,res)=>{
    let body="";for await(const chunk of req)body+=String(chunk);
    observed.push({url:req.url??"",authorization:req.headers.authorization,gateway:req.headers["x-gateway-token"] as string,body});
    res.writeHead(200,{"Content-Type":"application/json"});res.end('{"result":42}');
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const address=server.address() as import("node:net").AddressInfo;
    const binding={...endpoint(),url:`http://127.0.0.1:${address.port}/sandboxes/owned/ports/9000?signature=private`};
    const response=await requestApplication(binding,"/commands/add",{method:"POST",json:{x:1,y:2},application_token:"application-only"});
    expect(response.json()).toEqual({result:42});
    expect(observed).toEqual([{url:"/sandboxes/owned/ports/9000/commands/add?signature=private",authorization:"Bearer application-only",gateway:"gateway-only",body:'{"x":1,"y":2}'}]);
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

it("refuses to reconstruct an async provider endpoint from the synchronous default scheme",async()=>{
  const {NetworkModule}=await import("../../src/api/network.js");
  const network=new NetworkModule({sandbox_id:"owned",domain:"gateway.invalid",port_resolver:async()=>["http://proxy.invalid/owned/9000",{}],port_access:{getUrl:()=>"https://wrong.invalid",getHost:()=>"wrong.invalid",getAccessHeaders:()=>({}),getServerHeaders:()=>({})}});
  await expect(network.resolveEndpoint(9000)).rejects.toThrow("explicit sandbox/port descriptor");
});


it.each(["X-Access-Token", "x-access-token", "X-aCcEsS-ToKeN"])("preserves gateway credential %s without changing the descriptor", async name => {
  const binding = {...endpoint(), headers: {[name]: "gateway-only"}};
  const fetch = vi.fn(async () => new Response("{}", {status: 200}));
  applicationHttpSeams.fetch = fetch as never;
  await requestApplication(binding, "/capabilities", {method: "GET", application_token: "application-only"});
  expect(fetch.mock.calls[0]).toEqual([expect.any(String), expect.objectContaining({headers: {
    [name]: "gateway-only", Authorization: "Bearer application-only",
  }})]);
  expect(binding.headers).toEqual({[name]: "gateway-only"});
});

it("does not synthesize application authentication without an explicit token", async () => {
  const fetch = vi.fn(async () => new Response("{}", {status: 200}));
  applicationHttpSeams.fetch = fetch as never;
  await requestApplication(endpoint(), "/health", {method: "GET"});
  expect(fetch.mock.calls[0]).toEqual([expect.any(String), expect.objectContaining({headers: {"X-Gateway-Token": "gateway-only"}})]);
});

it.each(["bearer-only", "authorization-stripped"])("authenticates a real HTTP %s service", async mode => {
  const {createServer} = await import("node:http");
  const server = createServer((req, res) => {
    // The proxy forwards only X-Access-Token; the old service understands only Bearer.
    const accepted = mode === "authorization-stripped"
      ? req.headers["x-access-token"] === "application-only"
      : req.headers.authorization === "Bearer application-only";
    res.writeHead(accepted ? 200 : 401, {"Content-Type": "application/json"});
    res.end(JSON.stringify(accepted ? {result: 42} : {error: "unauthorized"}));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as import("node:net").AddressInfo).port;
    const binding = {...endpoint(), url: `http://127.0.0.1:${port}/proxy/owned/9000`};
    const response = await requestApplication(binding, "/commands/hello", {method: "POST", json: {}, application_token: "application-only"});
    expect(response.status_code).toBe(200);
    expect(response.json()).toEqual({result: 42});
  } finally {await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));}
});

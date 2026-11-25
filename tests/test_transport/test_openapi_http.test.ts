import { afterEach, expect, it, vi } from "vitest";
import { openApiHttpSeams, requestOpenApi } from "../../src/transport/openapi_http.js";
import type { ApplicationEndpoint } from "../../src/protocol/port_contract.js";
const endpoint = (url = "https://example.test/proxy/id"): ApplicationEndpoint => ({provider_id:"example",sandbox_id:"id",port:9000,url,headers:{"X-Traffic":"test"},authentication_audience:"gateway",path_mode:"prefix"});
afterEach(() => vi.restoreAllMocks());
it("preserves raw signed Provider query bytes when appending application parameters", async () => {
  const fetch = vi.spyOn(openApiHttpSeams,"fetch").mockResolvedValue(new Response('{"ok":true}',{headers:{"content-type":"application/json"}}));
  await requestOpenApi(endpoint("https://example.test/proxy/id?signature=a%20b~"),{method:"GET",path:"/",query:[["q","a b"]],headers:{}});
  expect(String(fetch.mock.calls[0][0])).toBe("https://example.test/proxy/id/?signature=a%20b~&q=a+b");
  expect(fetch.mock.calls[0][1]?.redirect).toBe("manual");
});
it("rejects gateway header/query collisions without fetching", async () => {
  const fetch = vi.spyOn(openApiHttpSeams,"fetch");
  await expect(requestOpenApi(endpoint(),{method:"GET",path:"/report",query:[],headers:{"x-traffic":"other"}})).rejects.toThrow("conflicts");
  await expect(requestOpenApi(endpoint("https://example.test/?q=signed"),{method:"GET",path:"/report",query:[["q","input"]],headers:{}})).rejects.toThrow("conflicts");
  expect(fetch).not.toHaveBeenCalled();
});
it("limits response bytes and cancels oversized streams", async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(8*1024*1024+1));},cancel});
  vi.spyOn(openApiHttpSeams,"fetch").mockResolvedValue(new Response(stream));
  await expect(requestOpenApi(endpoint(),{method:"GET",path:"/report",query:[],headers:{}})).rejects.toThrow("8 MiB");
  expect(cancel).toHaveBeenCalledOnce();
});
it("returns non-JSON error bodies without replaying or unwrapping", async () => {
  const fetch = vi.spyOn(openApiHttpSeams,"fetch").mockResolvedValue(new Response("forbidden",{status:403,headers:{"content-type":"text/plain"}}));
  expect(await requestOpenApi(endpoint(),{method:"POST",path:"/report",query:[],headers:{},body:[]})).toEqual({status:403,body:"forbidden"});
  expect(fetch).toHaveBeenCalledOnce();
});

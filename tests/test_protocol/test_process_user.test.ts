/** Requested OS users must reach envd without mutating shared authentication. */
import { afterEach, expect, it } from "vitest";
import { ProcessProtocol } from "../../src/providers/shared/e2b/process.js";
import { ApiKeyAuth, EnvdTokenManager } from "../../src/providers/alicloud_express/auth.js";
import { HttpClient } from "../../src/transport/http.js";
import { TransportConfig } from "../../src/transport/config.js";
import { MockTransport, Response, _setAsyncClientInitHook } from "../../src/transport/_httpx.js";

afterEach(() => _setAsyncClientInitHook(null));

function frame(payload: Record<string, unknown>): Buffer {
  const body = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(5);
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
}

it.each(["user", "root"])("isolates concurrent requested users from the %s default and preserves gateway headers", async (defaultUser) => {
  const token = new EnvdTokenManager("placeholder-envd-token", "placeholder-sandbox", { basic_user: defaultUser });
  const original = token.getHeaders();
  const seen: string[] = [];
  const transport = new MockTransport(async (request) => {
    await Promise.resolve();
    const principal = Buffer.from(request.headers.get("authorization")!.split(" ")[1]!, "base64").toString("utf8");
    expect(request.headers.get("x-access-token")).toBe("placeholder-envd-token");
    expect(request.headers.get("e2b-sandbox-id")).toBe("placeholder-sandbox");
    expect(request.headers.get("e2b-sandbox-port")).toBe("49983");
    expect(JSON.parse(request.content.toString())).toEqual({ process: { cmd: "id", args: ["-u"] }, stdin: false });
    seen.push(principal);
    return new Response(200, { content: Buffer.concat([
      frame({ event: { data: { stdout: Buffer.from(principal).toString("base64") } } }),
      frame({ event: { end: { exitCode: 0 } } }),
    ]) });
  });
  _setAsyncClientInitHook({ before(options) { options.transport = transport; } });
  const http = new HttpClient(new TransportConfig({ api_url: "https://platform.example.test", http2: false }), new ApiKeyAuth("placeholder-platform-key"));
  const protocol = new ProcessProtocol(http);
  const run = async (user: string): Promise<string> => {
    const reader = await protocol.start("https://envd.example.test", token, { cmd: "id", args: ["-u"], user });
    return (await reader.collect()).map((chunk) => chunk.data ?? "").join("");
  };
  try {
    expect(await Promise.all([run("root"), run("user"), run("")])).toEqual(["root:", "user:", `${defaultUser}:`]);
    expect(await run("")).toBe(`${defaultUser}:`);
    expect(token.getHeaders()).toEqual(original);
    expect(seen).toHaveLength(4);
  } finally { await http.close(); }
});

it.each(["root:password", "root\0", "root\r", "root\n"])("rejects an ambiguous Basic principal before sending: %j", async (user) => {
  let requests = 0;
  _setAsyncClientInitHook({ before(options) { options.transport = new MockTransport(() => { requests++; return new Response(200); }); } });
  const http = new HttpClient(new TransportConfig({ api_url: "https://platform.example.test", http2: false }), new ApiKeyAuth("placeholder-platform-key"));
  try {
    await expect(new ProcessProtocol(http).start("https://envd.example.test", new EnvdTokenManager("placeholder-token"), { cmd: "id", user })).rejects.toThrow("user");
    expect(requests).toBe(0);
  } finally { await http.close(); }
});

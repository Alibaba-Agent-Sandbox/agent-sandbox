/** Unsupported interpreter transports must refuse every operation without HTTP guesses. */
import { describe, expect, it } from "vitest";
import { UnsupportedCodeProtocol } from "../../src/providers/unsupported_code.js";
import { EnvdTokenManager } from "../../src/providers/alicloud_express/auth.js";
import { CodeContextModule } from "../../src/api/code.js";
import { ProviderFeatureNotSupportedError } from "../../src/models/provider_errors.js";
describe("absent interpreter transport",()=>{
  it.each(["code.execute","code.default-context.execute"] as const)("rejects %s before network or shell execution",async operation=>{const protocol=new UnsupportedCodeProtocol("alicloud-express");const module=new CodeContextModule("id","https://unreachable.invalid",new EnvdTokenManager("unused"),protocol);await expect(module.run("payload",{operation})).rejects.toBeInstanceOf(ProviderFeatureNotSupportedError);expect(protocol.operations.size).toBe(0);});
  it("rejects explicit context operations independently",async()=>{const protocol=new UnsupportedCodeProtocol("alicloud-express"),module=new CodeContextModule("id","https://unreachable.invalid",new EnvdTokenManager("unused"),protocol);await expect(module.createContext()).rejects.toThrow("code.context.create");await expect(module.listContexts()).rejects.toThrow("code.context.list");await expect(module.restartContext("ctx")).rejects.toThrow("code.context.restart");await expect(module.removeContext("ctx")).rejects.toThrow("code.context.delete");});
});

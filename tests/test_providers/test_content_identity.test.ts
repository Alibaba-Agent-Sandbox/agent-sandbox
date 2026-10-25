import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { executableContentDigest, providerContentDigest } from "../../src/providers/content_identity.js";
import { useIso } from "../_support/iso.js";
const iso=useIso();
describe("provider source identity",()=>{
  it("binds a bundled provider to executable bytes, including changes beyond the first chunk",()=>{
    const executable=path.join(iso.root,"abx-executable");
    const bytes=Buffer.alloc(1024*1024+17,65);fs.writeFileSync(executable,bytes);
    const expected="sha256:"+createHash("sha256").update(bytes).digest("hex");
    expect(executableContentDigest(executable)).toBe(expected);
    bytes[bytes.length-1]=66;fs.writeFileSync(executable,bytes);
    expect(executableContentDigest(executable)).not.toBe(expected);
  });
  it("refuses a directory as a bundled executable",()=>{
    expect(()=>executableContentDigest(iso.root)).toThrow("regular file");
  });

  it("binds actual code with the shared identity encoding",()=>{
    const root=path.join(iso.root,"plugin");fs.mkdirSync(root);fs.writeFileSync(path.join(root,"provider.mjs"),"export const x=1;\n");fs.writeFileSync(path.join(root,".env"),"credential-not-input");
    const expected="sha256:"+createHash("sha256").update("provider.mjs\0export const x=1;\n\0").digest("hex");
    expect(providerContentDigest(root)).toBe(expected);fs.writeFileSync(path.join(root,"provider.mjs"),"export const x=2;\n");expect(providerContentDigest(root)).not.toBe(expected);
  });
  it("rejects symlinked code before execution",()=>{const root=path.join(iso.root,"plugin");fs.mkdirSync(root);fs.writeFileSync(path.join(root,"code.mjs"),"1");fs.symlinkSync("code.mjs",path.join(root,"provider.mjs"));expect(()=>providerContentDigest(root)).toThrow("symlinked");});
});

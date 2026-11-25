/** Actual CLI parser, stdin bytes, HTTP and files in separate Node processes; no cloud Provider is called. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

const root=fileURLToPath(new URL("../../",import.meta.url));
let tmp:string, server:http.Server, port:number, received:Array<{url?:string;body:string;authorization?:string}>;
const binary=Buffer.from([0,128,255,10,13,65]);
beforeEach(async()=>{
  tmp=fs.mkdtempSync(path.join(os.tmpdir(),"abx-api-process-"));received=[];
  server=http.createServer(async(req,res)=>{
    let body="";for await(const chunk of req)body+=chunk;
    received.push({url:req.url,body,authorization:req.headers.authorization});
    if(req.url?.includes("/artifact/")){res.setHeader("content-type","application/octet-stream");res.end(binary);}
    else{res.setHeader("content-type","application/json");res.end(JSON.stringify({received:JSON.parse(body)}));}
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));port=(server.address() as {port:number}).port;
  const document={openapi:"3.1.0",info:{title:"Process API",version:"1"},security:[{token:[]}],components:{securitySchemes:{token:{type:"http",scheme:"bearer"}}},paths:{
    "/sessions/{id}":{post:{operationId:"ask",parameters:[{name:"id",in:"path",required:true,schema:{type:"string"}}],requestBody:{required:true,content:{"application/json":{schema:{type:"object",required:["message"],additionalProperties:false,properties:{message:{type:"string"},count:{type:"integer"}}}}}},responses:{"200":{description:"Accepted"}}}},
    "/artifact/{id}":{get:{operationId:"artifact",parameters:[{name:"id",in:"path",required:true,schema:{type:"string"}}],responses:{"200":{description:"Bytes"}}}},
  }};
  fs.writeFileSync(path.join(tmp,"openapi.json"),JSON.stringify(document));fs.writeFileSync(path.join(tmp,"registry.yaml"),"apis:\n  app:\n    resource: sandbox.demo\n    port: 9000\n    openapi: ./openapi.json\n");
  const source=(name:string)=>JSON.stringify(pathToFileURL(path.join(root,"src",name)).href);
  fs.writeFileSync(path.join(tmp,"driver.mts"),`
import { cli } from ${source("cli/main.ts")};
import { runCommand } from ${source("cli/kit.ts")};
import { sandboxApiSeams } from ${source("cli/commands/sandbox_api.ts")};
import { loadRegistryApis } from ${source("cli/api_contract.ts")};
import { saveApiBinding } from ${source("cli/api_binding.ts")};
const apis=loadRegistryApis(${JSON.stringify(path.join(tmp,"registry.yaml"))});
saveApiBinding({version:1,target:{id:"process-sandbox",provider:"alicloud-express"},apis,credentials:{"app.token":"env:DEMO_AUTH"},aliases:{}});
sandboxApiSeams.connect=async()=>({id:"process-sandbox",provider:"alicloud-express",close:async()=>{},network:{resolveEndpoint:async()=>({provider_id:"alicloud-express",sandbox_id:"process-sandbox",port:9000,url:"http://127.0.0.1:${port}",headers:{},authentication_audience:"gateway",path_mode:"prefix"})}});
process.exitCode=await runCommand(cli,process.argv.slice(2));
`);
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(tmp,{recursive:true,force:true});});
function invoke(args:string[],input:Buffer=Buffer.alloc(0)):Promise<{code:number|null;out:string;err:string}>{
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,["--import",path.join(root,"node_modules/tsx/dist/loader.mjs"),path.join(tmp,"driver.mts"),"--json","sandbox","process-sandbox",...args],{cwd:tmp,env:{PATH:process.env.PATH,HOME:path.join(tmp,"home"),DEMO_AUTH:"local-process-token"},stdio:["pipe","pipe","pipe"]});
    let out="",err="";const timer=setTimeout(()=>{child.kill("SIGKILL");reject(new Error("CLI process timed out"));},10000);
    child.stdout.on("data",part=>{out+=part;});child.stderr.on("data",part=>{err+=part;});child.on("error",error=>{clearTimeout(timer);reject(error);});
    child.on("close",code=>{clearTimeout(timer);resolve({code,out,err});});child.stdin.on("error",()=>{});child.stdin.end(input);
  });
}
it("runs real target-first natural flags with explicit values and application authentication",async()=>{
  const result=await invoke(["ask","--id","session-1","--message","hello","--count","0"]);
  expect(result.code,result.out+result.err).toBe(0);expect(JSON.parse(result.out)).toEqual({status:200,body:{received:{message:"hello",count:0}}});
  expect(received).toEqual([{url:"/sessions/session-1",body:'{"message":"hello","count":0}',authorization:"Bearer local-process-token"}]);
});
it("reads actual stdin bytes and rejects malformed UTF-8 before an application request",async()=>{
  const invalid=Buffer.concat([Buffer.from('{"message":"'),Buffer.from([255]),Buffer.from('"}')]);
  const rejected=await invoke(["ask","--id","session-1","--body","-"],invalid);
  expect(rejected.code).not.toBe(0);expect(rejected.out+rejected.err).toContain("valid UTF-8");expect(received).toHaveLength(0);
  const success=await invoke(["ask","--id","session-1","--body","-"],Buffer.from('{"message":"你好"}'));
  expect(success.code,success.out+success.err).toBe(0);expect(received).toHaveLength(1);expect(JSON.parse(received[0].body)).toEqual({message:"你好"});
});
it("saves exact binary response bytes from a real HTTP response",async()=>{
  const output=path.join(tmp,"result.bin"),result=await invoke(["artifact","--id","file-1","--output",output]);
  expect(result.code,result.out+result.err).toBe(0);expect(fs.readFileSync(output)).toEqual(binary);expect(JSON.parse(result.out)).toEqual({status:200,output,bytes:binary.length});
  const refused=await invoke(["artifact","--id","file-1","--output",output]);expect(refused.code).not.toBe(0);expect(received).toHaveLength(1);
});

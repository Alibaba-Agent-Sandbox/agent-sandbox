import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import http2 from "node:http2";
import {afterEach, expect, it} from "vitest";
import {componentHostSeams, invokeDevsComponent} from "../../src/application/component_host.js";
const roots:string[]=[],original=componentHostSeams.loaderPath;
afterEach(()=>{componentHostSeams.loaderPath=original;for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function input(endpoint:string,code:string) {
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),"abx-fc-guard-test-"));roots.push(cwd);fs.writeFileSync(path.join(cwd,"template.yaml"),"specVersion: 1\n");
  const loader=path.join(cwd,"loader.cjs");fs.writeFileSync(loader,`module.exports=async()=>({async deploy(input){${code}}});`);componentHostSeams.loaderPath=()=>loader;
  return {cwd,name:"fixture",resource:"api",component:"serverless-devs/fc3@0.1.26",command:"deploy",props:{functionName:"fixture",endpoint},credential:{AccountID:"123",AccessKeyID:"fixture-id",AccessKeySecret:"fixture-secret"},functionCreationGuard:{endpoint,functionName:"fixture"},onLog:()=>{}};
}
const requests=String.raw`
 const http=require('node:http'),endpoint=input.props.endpoint;
 const request=(method,path)=>new Promise((resolve,reject)=>{
   const req=http.request(endpoint+path,{method},res=>setImmediate(()=>{let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body}));}));req.on('error',reject);req.end();
 });`;
it("permits post-create operations only after observing the matching response without consuming it",async()=>{
  const calls:string[]=[];const server=http.createServer((req,res)=>{calls.push(req.method!);req.resume();res.setHeader("content-type","application/json");res.end(JSON.stringify({functionName:"fixture",functionId:"confirmed-id"}));});
  await new Promise<void>(ok=>server.listen(0,"127.0.0.1",ok));const endpoint=`http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  try {expect(await invokeDevsComponent(input(endpoint,requests+`const first=await request('POST','/2023-03-30/functions');await request('PUT','/2023-03-30/functions/fixture');return JSON.parse(first.body).functionId;`))).toBe("confirmed-id");expect(calls).toEqual(["POST","PUT"]);}
  finally{server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));}
});
it("refuses conflict fallback updates and uncertain duplicate submissions",async()=>{
  const calls:string[]=[];const server=http.createServer((req,res)=>{calls.push(req.method!);req.resume();res.statusCode=409;res.end('{}');});await new Promise<void>(ok=>server.listen(0,"127.0.0.1",ok));const endpoint=`http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  try {await expect(invokeDevsComponent(input(endpoint,requests+`await request('POST','/2023-03-30/functions');try{await request('POST','/2023-03-30/functions');}catch{}await request('PUT','/2023-03-30/functions/fixture');`))).rejects.toThrow("ABX_FC_CREATE_CONFLICT");expect(calls).toEqual(["POST"]);}
  finally{server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));}
});
it("blocks HTTPS updates and endpoint substitutions before opening a connection",async()=>{
  await expect(invokeDevsComponent(input("https://selected.invalid",`require('node:https').request('https://selected.invalid/2023-03-30/functions/fixture',{method:'PUT'});`))).rejects.toThrow("ABX_FC_CREATE_CONFLICT");
  await expect(invokeDevsComponent(input("http://selected.invalid",`require('node:http').request('http://other.invalid/2023-03-30/functions',{method:'POST'});`))).rejects.toThrow("ABX_FC_CREATE_CONFLICT");
  await expect(invokeDevsComponent(input("http://selected.invalid",`require('node:http').request({host:'proxy.invalid',path:'http://selected.invalid/2023-03-30/functions/fixture',method:'PUT'});`))).rejects.toThrow("ABX_FC_CREATE_CONFLICT");
});
it("guards HTTP2 streams and preserves successful native response bodies",async()=>{
  const calls:string[]=[];const server=http2.createServer();server.on("stream",(stream,headers)=>{calls.push(String(headers[":method"]));stream.respond({":status":200,"content-type":"application/json"});stream.end(JSON.stringify({functionName:"fixture",functionId:"h2-id"}));});await new Promise<void>(ok=>server.listen(0,"127.0.0.1",ok));const endpoint=`http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  try {const result=await invokeDevsComponent(input(endpoint,`const session=require('node:http2').connect(input.props.endpoint);const send=(method,path)=>new Promise((resolve,reject)=>{const stream=session.request({':method':method,':path':path});let body='';stream.on('data',x=>body+=x);stream.on('error',reject);stream.on('end',()=>resolve(body));stream.end();});try{let blocked=false;try{await send('PUT','/2023-03-30/functions/fixture');}catch{blocked=true;}const first=await send('POST','/2023-03-30/functions');await send('PUT','/2023-03-30/functions/fixture');return {blocked,first:JSON.parse(first).functionId};}finally{session.close();}`));expect(result).toEqual({blocked:true,first:"h2-id"});expect(calls).toEqual(["POST","PUT"]);}
  finally{await new Promise<void>(ok=>server.close(()=>ok()));}
});

it("refuses a successful no-op component result without a confirmed new function", async () => {
  await expect(invokeDevsComponent(input("http://selected.invalid", "return {};"))).rejects.toThrow("ABX_FC_CREATE_UNCONFIRMED");
});

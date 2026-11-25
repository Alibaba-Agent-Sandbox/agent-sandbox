// Explicit opt-in real Express MCP HTTP create/execute/delete verification.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
const root=fileURLToPath(new URL('..', import.meta.url));
const {createMcpApp}=await import(pathToFileURL(path.join(root,'dist/agent/mcp_http.js')));
const {Sandbox}=await import(pathToFileURL(path.join(root,'dist/api/sandbox.js')));
const token=randomBytes(32).toString('hex');
const options={api_key:process.env.ABX_SANDBOX_API_KEY,api_url:process.env.ABX_SANDBOX_BASE_URL,domain:process.env.ABX_SANDBOX_DOMAIN};
const app=createMcpApp({...options,auth_token:token,template:'base'});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'abx-mcp-http-real-'));
const socketPath=path.join(dir,'mcp.sock');
const server=app.createServer();
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
let session,owned; const results=[]; let rpcId=0;
async function call(method,body,authenticated=true){
 const bytes=body===undefined?undefined:Buffer.from(JSON.stringify(body));
 return new Promise((resolve,reject)=>{
  const headers={'Content-Type':'application/json','MCP-Protocol-Version':'2025-06-18'};
  if(authenticated)headers.Authorization=`Bearer ${token}`;
  if(session)headers['Mcp-Session-Id']=session;
  if(bytes)headers['Content-Length']=String(bytes.length);
  const req=http.request({socketPath,path:'/mcp',method,headers,agent:false},res=>{
   const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{ /* The assertion below handles non-JSON error responses. */ }resolve({status:res.statusCode,headers:res.headers,data});});
  });req.on('error',reject);req.setTimeout(90000,()=>req.destroy(new Error('request deadline')));if(bytes)req.write(bytes);req.end();
 });
}
async function rpc(method,params){return call('POST',{jsonrpc:'2.0',id:++rpcId,method,params});}
function record(name,ok){results.push({step:name,passed:!!ok});if(!ok)throw new Error(name);}
function toolValue(response){const result=response.data?.result;if(response.status!==200||result?.isError||response.data?.error)throw new Error('tool failed');return JSON.parse(result.content.find(c=>c.type==='text').text);}
try{
 const denied=await call('POST',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},false);record('unauthenticated initialize refused',denied.status===401);
 const init=await rpc('initialize',{protocolVersion:'2025-06-18',clientInfo:{name:'abx-owned-verification',version:'1'},capabilities:{}});session=init.headers['mcp-session-id'];record('authenticated HTTP initialize',init.status===200&&typeof session==='string');
 const list=await rpc('tools/list',{});record('discover creation and execution tools',list.data?.result?.tools?.some(t=>t.name==='create_sandbox')&&list.data?.result?.tools?.some(t=>t.name==='run_command'));
 const created=toolValue(await rpc('tools/call',{name:'create_sandbox',arguments:{template:'base',timeout:120}}));owned=created.sandbox_id;record('create real Express Sandbox',typeof owned==='string'&&owned.length>0);
 const command=toolValue(await rpc('tools/call',{name:'run_command',arguments:{command:'printf mcp-real-ok',timeout:15,sandbox_id:owned}}));record('execute through same HTTP session',JSON.stringify(command).includes('mcp-real-ok'));
 const removed=await call('DELETE');record('HTTP session deletion',removed.status===200&&removed.data?.status==='session_terminated');
 let absent=false;try{await Sandbox.getInfoById(owned,options);}catch(error){absent=error?.constructor?.name==='SandboxNotFoundError';}
 record('independent native absence',absent);
 const gone=await rpc('ping',{});record('deleted MCP session rejected',gone.status===404);
}catch(error){results.push({step:'failure',type:error?.constructor?.name??'Error'});process.exitCode=1;}
finally{
 try{await app.shutdown();}catch{results.push({step:'shutdown reported unresolved cleanup',passed:false});process.exitCode=1;}
 if(owned){try{await Sandbox.getInfoById(owned,options);await Sandbox.killById(owned,options);results.push({step:'explicit owned cleanup needed',passed:false});process.exitCode=1;}catch(error){if(error?.constructor?.name!=='SandboxNotFoundError'){results.push({step:'final absence unresolved',passed:false});process.exitCode=1;}}}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});
 console.log(JSON.stringify(results,null,2));
}

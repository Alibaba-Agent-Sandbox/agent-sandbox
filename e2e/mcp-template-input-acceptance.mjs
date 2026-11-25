/** Local compiled HTTP contract check; no Provider operation is admitted. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const { createMcpApp } = await import(pathToFileURL(join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist/agent/mcp_http.js')));
const root = mkdtempSync(join(tmpdir(), 'abx-envd-input-'));
const socketPath=join(root,'http.sock'), app=createMcpApp({auth_token:'local-test-token'}), server=app.createServer();
await new Promise(done=>server.listen(socketPath,done));
let session;
async function call(body) {return await new Promise((done,fail)=>{const req=http.request({socketPath,path:'/mcp',method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','Authorization':'Bearer local-test-token',...(session?{'Mcp-Session-Id':session}:{})}},r=>{let text='';r.setEncoding('utf8');r.on('data',s=>text+=s);r.on('end',()=>done({status:r.statusCode,headers:r.headers,body:JSON.parse(text)}));});req.on('error',fail);req.end(JSON.stringify(body));});}
try {
 const init=await call({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'input-test',version:'1'}}}); assert.equal(init.status,200);session=init.headers['mcp-session-id'];
 const listed=await call({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});const tool=listed.body.result.tools.find(t=>t.name==='submit_template_build');assert(tool);assert.equal(tool.inputSchema.additionalProperties,false);assert.equal(Object.hasOwn(tool.inputSchema.properties,'envd_inject'),false);
 for(const [i,value] of [true,false].entries()) {const result=await call({jsonrpc:'2.0',id:3+i,method:'tools/call',params:{name:'submit_template_build',arguments:{team_id:'placeholder-team',name:'test-retired-input',image:'example.invalid/image:1',envd_inject:value}}});assert.equal(result.status,200);assert.equal(result.body.result.isError,true);assert.match(JSON.stringify(result.body.result),/envd_inject/);assert.doesNotMatch(JSON.stringify(result.body.result),/AK\/SK|Missing configuration/);}
 console.log(JSON.stringify({transport:'real compiled HTTP over Unix socket',schema_removed:true,obsolete_true_rejected:true,obsolete_false_rejected:true,cloud_resources_created:0}));
} finally {await app.shutdown();await new Promise(done=>server.close(done));rmSync(root,{recursive:true,force:true});}

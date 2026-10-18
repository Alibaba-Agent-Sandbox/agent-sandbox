// Evaluation-only STDIO bridge. No cloud mocks; each request reaches the built MCP server.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';

const args = process.argv.slice(2);
function option(name, fallback) { const i=args.indexOf(name); if(i<0)return fallback;const value=args[i+1];if(!value)throw new Error(`${name} needs a value`);args.splice(i,2);return value; }
const root=resolve(option('--state-dir', '.scratch-skill-evaluation'));
const repo=resolve(option('--repo', '.'));
const entry=resolve(repo, option('--entry','dist/bin/abx.js'));
const envFile=option('--env-file');
const agent=option('--agent','acceptance-agent');
const socket=join(root,'bridge.sock');
const mode=args[0];
if(mode!=='serve') {
 const request=mode==='tool'?{action:'tool',agent,name:args[1],arguments:JSON.parse(args[2]??'{}')}:{action:mode,agent};
 const output=await new Promise((resolve,reject)=>{const connection=net.connect(socket,()=>connection.end(JSON.stringify(request)+'\n'));let data='';connection.on('data',chunk=>data+=chunk);connection.on('end',()=>resolve(data));connection.on('error',reject)});
 process.stdout.write(output);process.exit(0);
}
if(!envFile)throw new Error('serve requires --env-file');
mkdirSync(root,{recursive:true,mode:0o700});chmodSync(root,0o700);
if(existsSync(socket))throw new Error('Existing socket; do not replace a possibly running evaluation');
const env={...process.env,...parseEnv(readFileSync(resolve(envFile),'utf8'))};
const secrets=Object.entries(env).filter(([key,value])=>/key|secret|token|password/i.test(key)&&value&&value.length>=6).map(([,value])=>value).sort((a,b)=>b.length-a.length);
function redact(value){let text=JSON.stringify(value);for(const secret of secrets)text=text.split(secret).join('<SECRET>');return JSON.parse(text);}
const skillHash=createHash('sha256').update(readFileSync(join(repo,'SKILL.md'))).digest('hex');
const ownedFile=join(root,'owned.json');
const owned=new Set(existsSync(ownedFile)?JSON.parse(readFileSync(ownedFile,'utf8')):[]);
let child, sequence=0;
const pending=new Map();
function start(){
 child=spawn(process.execPath,[entry,'mcp','start'],{cwd:repo,env,stdio:['pipe','pipe','pipe']});
 let buffer='';child.stdout.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const result=JSON.parse(line);pending.get(result.id)?.resolve(result);pending.delete(result.id)}catch{/* not a protocol line */}}});
 child.stderr.on('data',()=>{}); // Raw SDK logs can contain endpoints; never persist them.
 child.on('exit',()=>{for(const request of pending.values())request.reject(new Error('MCP exited before response; outcome uncertain'));pending.clear()});
}
async function rpc(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(id);reject(new Error('MCP response deadline; outcome uncertain, inspect owned resources'))},150000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value)},reject:error=>{clearTimeout(timeout);reject(error)}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});}
async function stop(){if(!child||child.exitCode!==null)return;const current=child;await new Promise(resolve=>{current.once('exit',resolve);current.stdin.end()});}
start();
await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'skill-evaluation',version:'1'}});
const allowed=new Set(['get_capabilities','list_sandboxes','get_sandbox','get_template_build']);
let serial=Promise.resolve();
const server=net.createServer({allowHalfOpen:true},connection=>{let buffer='';connection.on('data',chunk=>buffer+=chunk);connection.on('end',()=>{serial=serial.then(async()=>{
 const at=new Date().toISOString(),started=Date.now();let request,response;
 try{
  request=JSON.parse(buffer);
  if(request.action==='list')response=await rpc('tools/list');
  else if(request.action==='restart'){await stop();start();response=await rpc('initialize',{protocolVersion:'2024-11-05'});}
  else if(request.action==='shutdown'){await stop();response={stopped:true};}
  else if(request.action==='tool'){
   const params=request.arguments??{};
   if(request.name==='create_sandbox'){
    if(owned.size)throw new Error('One test sandbox at a time; clean up the previous one');
    if(!params.template||!Number.isInteger(params.timeout)||params.timeout>600)throw new Error('Evaluation create needs explicit template and lifetime <=600');
   }else if(!allowed.has(request.name)&&!owned.has(params.sandbox_id))throw new Error('Evaluation mutations/execution must target an owned sandbox ID');
   response=await rpc('tools/call',{name:request.name,arguments:params});
   let result;try{result=JSON.parse(response.result.content[0].text)}catch{/* Error responses may have no tool payload. */}
   if(request.name==='create_sandbox'&&!response.result?.isError&&result?.sandbox_id)owned.add(result.sandbox_id);
   if(request.name==='kill_sandbox'&&!response.result?.isError)owned.delete(params.sandbox_id);
   writeFileSync(ownedFile,JSON.stringify([...owned]));
  }else throw new Error('Unknown evaluation action');
 }catch(error){response={bridge_error:error.message};}
 const event=redact({at,elapsed_ms:Date.now()-started,agent:request?.agent,skill:'agent-sandbox',skill_sha256:skillHash,request,response});
 appendFileSync(join(root,'trace.jsonl'),JSON.stringify(event)+'\n',{mode:0o600});connection.end(JSON.stringify(event.response)+'\n');
 if(request?.action==='shutdown'){server.close();unlinkSync(socket);}
 }).catch(error=>connection.end(JSON.stringify({bridge_error:error.message})+'\n'));});});
await new Promise(resolve=>server.listen(socket,resolve));chmodSync(socket,0o600);
console.log('Evaluation MCP bridge ready; credentials loaded without output');

import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const repo=resolve(process.argv[2]),out=resolve(process.argv[4]);mkdirSync(out,{recursive:true});
const env={...process.env,...parseEnv(readFileSync(process.argv[3],'utf8'))};Object.assign(process.env,env);
const cfgModule=await import(pathToFileURL(join(repo,'dist/transport/config.js')));const cfg=cfgModule.loadConfig();
const api=await import(pathToFileURL(join(repo,'dist/api/fc_template.js')));
const team=await api.getTeamId(cfg.access_key_id,cfg.access_key_secret,cfg.region);
const source=await api.getTemplate('y2of2a2kkkci2y10q0qq',{access_key_id:cfg.access_key_id,access_key_secret:cfg.access_key_secret,region:cfg.region,team_id:team});
// Only inspect key names locally; never output private SDK details.
function find(v,key){if(v&&typeof v==='object'){if(typeof v[key]==='string')return v[key];for(const x of Object.values(v)){const got=find(x,key);if(got)return got;}}}
const image=find(source,'image');assert(image,'Selected existing ready template must expose its tested image');
const start=find(source,'startCommand'),ready=find(source,'readyCommand');
const secrets=[team,image,...Object.entries(env).filter(([k,v])=>/key|secret|token|password|domain|base_url/i.test(k)&&v?.length>=6).map(([,v])=>v)].sort((a,b)=>b.length-a.length);
const clean=v=>{let s=JSON.stringify(v);for(const x of secrets)s=s.split(x).join('<REDACTED>');return JSON.parse(s.replace(/https?:\/\/[^\s"\\]+/g,'<URL>'));};
const sha=createHash('sha256').update(readFileSync(join(repo,'SKILL.md'))).digest('hex');
function record(action,sent,returned,expected,observed,result='PASS',ms=0){appendFileSync(join(out,'actions.jsonl'),JSON.stringify(clean({at:new Date().toISOString(),agent:'root-template-recheck',model:'runtime identifier not exposed',skill:'agent-sandbox',skill_sha256:sha,action,sent,returned,expected_effect:expected,observed_effect:observed,result,elapsed_ms:ms}))+'\n');}
record('discover_team_and_tested_image',{source_template:'y2of2a2kkkci2y10q0qq'},{team_source:'Official ListTeams',image_source:'Official GetTemplate',has_start_command:!!start,has_ready_command:!!ready},'Use configured Team and actual tested image','Authenticated official discovery; no Team or image invented');
const child=spawn(process.execPath,[join(repo,'dist/bin/abx.js'),'mcp','start'],{cwd:repo,env,stdio:['pipe','pipe','pipe']});child.stderr.on('data',()=>{});let seq=0,buffer='';const pending=new Map();child.stdout.on('data',b=>{buffer+=b;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const r=JSON.parse(line);pending.get(r.id)?.(r);pending.delete(r.id)}catch{}}});
function rpc(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const timeout=setTimeout(()=>reject(new Error('MCP deadline; outcome uncertain')),150000);pending.set(id,r=>{clearTimeout(timeout);resolve(r)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});}
let created=null;
async function tool(name,args,check){const t=Date.now();let r;try{r=await rpc('tools/call',{name,arguments:args});const d=JSON.parse(r.result.content[0].text);if(name==='submit_template_build'&&!r.result.isError)created=d.template_id;assert.equal(r.result.isError,false);check?.(d);record(name,args,d,'Submit → ready → runtime checks → independently verified cleanup','Actual response assertions passed', 'PASS',Date.now()-t);return d;}catch(e){record(name,args,r??{error:e.message},'Real template acceptance',e.message,'FAIL',Date.now()-t);throw e;}}
let result={result:'FAIL'};
try{
 await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'skill-template-recheck',version:'1'}});
 await tool('get_template_build',{team_id:team,template_id:'y2of2a2kkkci2y10q0qq'},d=>assert.equal(d.status.state,'ready'));
 const submitted=await tool('submit_template_build',{team_id:team,name:'skill-recheck-'+Date.now().toString(36),image,envd_inject:false,...(start?{start_command:start}:{}),...(ready?{ready_command:ready}:{})},d=>assert(d.template_id));writeFileSync(join(out,'owned.json'),JSON.stringify({template:created}));
 let built;
 for(let i=0;i<50;i++){built=await tool('get_template_build',{team_id:team,template_id:created});const state=built.status?.state;if(state==='ready')break;assert(!['failed','error'].includes(state));await new Promise(r=>setTimeout(r,2000));}
 assert.equal(built.status?.state,'ready');
 const validation=await tool('validate_template',{template_id:created},d=>{assert.equal(d.verified,true);assert.equal(d.cleanup_verified,true)});
 result={result:'PASS',template_tools:3,template_id:created,validation,scope:'Existing tested image; arbitrary external OCI inspection not run'};
}catch(e){result.error=clean({message:e.message}).message;process.exitCode=1;}
finally{
 if(created){
  const sdk=api._requireSdk();const client=new sdk.Client(new sdk.Config({accessKeyId:cfg.access_key_id,accessKeySecret:cfg.access_key_secret,regionId:cfg.region,endpoint:`fcsandbox.${cfg.region}.aliyuncs.com`}));
  try{await client.deleteTemplate(created,new sdk.models.DeleteTemplateRequest({teamID:team}));let absent=false;try{await client.getTemplate(created,new sdk.models.GetTemplateRequest({teamID:team}));}catch(e){absent=e.statusCode===404||e.data?.statusCode===404||e.code==='NotFound'||e.code==='TemplateNotFound';if(!absent)throw e;}assert(absent,'New template must be absent');record('cleanup_template',{template_id:created},{absent},'Delete only newly created template','Official GetTemplate returns not-found');result.cleanup_verified=true;created=null;}catch(e){result.cleanup_verified=false;result.cleanup_error=clean({message:e.message}).message;process.exitCode=1;}
 }
 child.stdin.end();await new Promise(r=>child.once('exit',r));writeFileSync(join(out,'owned.json'),JSON.stringify({template:created}));writeFileSync(join(out,'summary.json'),JSON.stringify(clean(result),null,2)+'\n');console.log(JSON.stringify(clean(result)));
}

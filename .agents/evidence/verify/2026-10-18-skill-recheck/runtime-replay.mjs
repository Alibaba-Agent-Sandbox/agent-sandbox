import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
const repo=resolve(process.argv[2]),output=resolve(process.argv[4]);mkdirSync(output,{recursive:true});
const env={...process.env,...parseEnv(readFileSync(process.argv[3],'utf8'))};
Object.assign(process.env,env);
const secrets=Object.entries(env).filter(([k,v])=>/key|secret|token|password|domain|base_url/i.test(k)&&v?.length>=6).map(([,v])=>v).sort((a,b)=>b.length-a.length);
const privateValues=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
const sha=hash(readFileSync(join(repo,'SKILL.md')));
function clean(v){let t=JSON.stringify(v);for(const s of [...secrets,...privateValues])t=t.split(s).join('<REDACTED>');t=t.replace(/https?:\/\/[^\s"\\]+/g,'<URL>');return JSON.parse(t);}
function event(action,sent,returned,expected,observed,result='PASS',elapsed=0){const e=clean({at:new Date().toISOString(),agent:'root-skill-recheck',model:'runtime identifier not exposed',skill:'agent-sandbox',skill_sha256:sha,action,sent,returned,elapsed_ms:elapsed,expected_effect:expected,observed_effect:observed,result});appendFileSync(join(output,'actions.jsonl'),JSON.stringify(e)+'\n');}
let child,sequence=0;const pending=new Map();let owned=null,newTemplate=null;
function start(){child=spawn(process.execPath,[join(repo,'dist/bin/abx.js'),'mcp','start'],{cwd:repo,env,stdio:['pipe','pipe','pipe']});let data='';child.stdout.on('data',b=>{data+=b;let i;while((i=data.indexOf('\n'))>=0){const s=data.slice(0,i);data=data.slice(i+1);try{const j=JSON.parse(s);pending.get(j.id)?.resolve(j);pending.delete(j.id)}catch{}}});child.stderr.on('data',()=>{});child.on('exit',()=>{for(const r of pending.values())r.reject(new Error('MCP exited; outcome uncertain'));pending.clear()});}
async function rpc(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('MCP deadline; outcome uncertain'))},150000);pending.set(id,{resolve:j=>{clearTimeout(timer);resolve(j)},reject:e=>{clearTimeout(timer);reject(e)}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});}
async function init(){start();await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'skill-recheck',version:'1'}});}
async function stop(){if(!child||child.exitCode!==null)return;await new Promise(r=>{child.once('exit',r);child.stdin.end()});}
async function restart(){const at=Date.now();await stop();await init();event('restart_mcp',{}, {restarted:true},'Original sandbox and task remain recoverable','New real STDIO child initialized','PASS',Date.now()-at);}
async function tool(name,args,check,expected,expectError=false){const at=Date.now();let response,data;try{response=await rpc('tools/call',{name,arguments:args});assert(!response.error,JSON.stringify(response.error));data=JSON.parse(response.result.content[0].text);if(name==='create_sandbox'&&!response.result.isError)owned=data.sandbox_id; if(name==='submit_template_build'&&!response.result.isError)newTemplate=data.template_id;assert.equal(response.result.isError,expectError);await check?.(data,response.result);event(name,args,{...data,isError:response.result.isError},expected,'Assertions checked against actual returned values; cross-operation checks recorded separately','PASS',Date.now()-at);return data;}catch(e){event(name,args,response??{error:e.message},expected,e.message,'FAIL',Date.now()-at);throw e;}}
const ok=async(name,args={},check=()=>{},expected='Operation returns a successful result')=>tool(name,args,check,expected);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function terminal(id){for(let i=0;i<80;i++){const d=await ok('get_task',{sandbox_id:owned,task_id:id});if(['succeeded','failed','cancelled'].includes(d.state))return d;await wait(100);}throw new Error('Task did not become terminal');}
async function command(command){return ok('run_command',{sandbox_id:owned,command},d=>assert.equal(d.exit_code,0));}
let summary={result:'FAIL',scope:'Fresh source CLI/real STDIO on tested Alibaba provider/template; advanced original requirements remain unverified'};
try{
 await init(); const catalog=await rpc('tools/list');assert.equal(catalog.result.tools.length,21);event('tools/list',{}, {names:catalog.result.tools.map(t=>t.name)},'Discover actual source-version tools','21 tools discovered');
 await ok('get_capabilities',{},d=>assert.equal(d.verification,'declaration_only'));
 const baseline=await ok('list_sandboxes',{});for(const s of baseline.sandboxes)privateValues.push(s.sandbox_id);
 const template='y2of2a2kkkci2y10q0qq';
 await ok('create_sandbox',{template,timeout:600,retain:true},d=>assert(d.sandbox_id));writeFileSync(join(output,'owned.json'),JSON.stringify({sandbox:owned}));
 const first=await ok('get_sandbox',{sandbox_id:owned},d=>{assert.equal(d.sandbox.timeout,null);assert.equal(typeof d.sandbox.started_at,'string')});
 assert(Math.abs((Date.parse(first.sandbox.end_at)-Date.parse(first.sandbox.started_at))/1000-600)<2);
 event('verify_lifetime',{},first.sandbox,'Requested 600-second lifetime is actually observed','ISO start/end difference is 600 seconds; numeric omitted timeout remains null');
 await ok('verify_sandbox',{sandbox_id:owned},d=>assert.equal(d.verified,true));
 await ok('retain_sandbox',{sandbox_id:owned,retain:true},d=>assert.equal(d.retained,true));
 await ok('run_code',{sandbox_id:owned,code:'print(2+3)',language:'python'},d=>{assert.equal(d.exit_code,0);assert(d.stdout.includes('5'))});
 await ok('write_file',{sandbox_id:owned,path:'/tmp/skill-recheck-note.txt',content:'skill recheck\n'});
 await ok('read_file',{sandbox_id:owned,path:'/tmp/skill-recheck-note.txt'},d=>assert.equal(d.content,'skill recheck\n'));
 await ok('list_files',{sandbox_id:owned,path:'/tmp'},d=>assert(JSON.stringify(d).includes('skill-recheck-note.txt')));
 const csv=Buffer.from('qty,unit_price\n2,10.00\n1,5.50\n3,2.00\n');await ok('upload_file',{sandbox_id:owned,path:'/tmp/skill-recheck-input.csv',content_base64:csv.toString('base64'),sha256:hash(csv)},d=>assert.equal(d.verified,true));
 const analyze="import csv,decimal,json,pathlib,time\ntime.sleep(3)\nr=list(csv.DictReader(open('/tmp/skill-recheck-input.csv')))\nx={'row_count':len(r),'total_qty':sum(int(x['qty']) for x in r),'total_amount':format(sum(decimal.Decimal(x['qty'])*decimal.Decimal(x['unit_price']) for x in r),'.2f')}\npathlib.Path('/tmp/skill-recheck-result.json').write_text(json.dumps(x,sort_keys=True,separators=(',',':'))+'\\n')\n";
 await ok('write_file',{sandbox_id:owned,path:'/tmp/skill-recheck-analyze.py',content:analyze});
 const task=await ok('start_task',{sandbox_id:owned,command:'python3 /tmp/skill-recheck-analyze.py'},d=>assert(d.task_id));await restart();
 const finished=await terminal(task.task_id);assert.equal(finished.state,'succeeded');assert.equal(finished.exit_code,0);
 const artifact=await ok('download_file',{sandbox_id:owned,path:'/tmp/skill-recheck-result.json'},d=>assert.equal(d.sha256,'9c808afca68751e859669502476d9570d6fe5a0a6ac1c8fb774d40ec3346d6f8'));
 const bytes=Buffer.from(artifact.content_base64,'base64');writeFileSync(join(output,'result.json'),bytes);assert.equal(bytes.length,53);assert.equal(hash(readFileSync(join(output,'result.json'))),artifact.sha256);assert.deepEqual(JSON.parse(bytes),{row_count:3,total_qty:6,total_amount:'31.50'});
 event('verify_local_artifact',{task_id:task.task_id},{bytes:bytes.length,sha256:hash(bytes)},'Download original task result across real MCP restart','Local file re-read; hash, bytes, field values and types checked');
 await tool('run_command',{sandbox_id:owned,command:'printf expected-failure >&2; exit 7'},d=>{assert.equal(d.exit_code,7);assert.equal(d.stderr,'expected-failure')},'Remote exit 7 remains a command error',true);
 await tool('retain_sandbox',{sandbox_id:owned,retain:false},d=>assert.match(d.error,/borrowed/i),'Borrowed resource cannot acquire disconnect cleanup ownership',true);
 await restart();await ok('get_sandbox',{sandbox_id:owned},d=>assert.equal(d.sandbox.sandbox_id,owned),'Borrowed sandbox survives retention rejection and disconnect');
 const regular=await ok('start_task',{sandbox_id:owned,command:'while true; do printf tick; sleep .05; done'});await wait(200);await ok('cancel_task',{sandbox_id:owned,task_id:regular.task_id});const cancelled=await terminal(regular.task_id);assert.equal(cancelled.state,'cancelled');await wait(300);await ok('get_task',{sandbox_id:owned,task_id:regular.task_id},d=>assert.equal(d.stdout,cancelled.stdout),'Terminal cancellation has no more output');
 const source="import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN)\nwhile True: print('tick',flush=True); time.sleep(.05)";
 const encoded=Buffer.from(source).toString('base64');const resistant=await ok('start_task',{sandbox_id:owned,command:`python3 -u -c "import base64; exec(base64.b64decode('${encoded}'))"; wait`});
 for(let i=0;i<40;i++){const d=await ok('get_task',{sandbox_id:owned,task_id:resistant.task_id});if(d.stdout.includes('tick'))break;await wait(100);}
 const cr=await ok('cancel_task',{sandbox_id:owned,task_id:resistant.task_id},d=>assert.equal(d.state,'cancelling'));await wait(300);
 const growing=await ok('get_task',{sandbox_id:owned,task_id:resistant.task_id},d=>{assert.equal(d.state,'cancelling');assert(!('exit_code' in d));assert(d.stdout.length>cr.stdout.length)},'Resistant descendant remains cancelling with observable continued output');
 await ok('cancel_task',{sandbox_id:owned,task_id:resistant.task_id},d=>assert.equal(d.state,'cancelling'),'Repeated cancellation recognizes original group after shell leader exit');
 await command(`python3 -c 'import os,signal; os.killpg(${resistant.pid},signal.SIGKILL)'`);const stopped=await terminal(resistant.task_id);assert.equal(stopped.state,'cancelled');await wait(300);await ok('get_task',{sandbox_id:owned,task_id:resistant.task_id},d=>assert.equal(d.stdout,stopped.stdout),'Force-stopped owned process group has no more output');
 event('verify_resistant_descendant',{task_id:resistant.task_id},{initial_output_bytes:cr.stdout.length,later_output_bytes:growing.stdout.length,final_output_bytes:stopped.stdout.length},'No terminal cancelled state while work still runs','Stayed cancelling; repeated TERM preserved identity; explicit KILL followed by stable terminal output');
 const update=await ok('set_sandbox_timeout',{sandbox_id:owned,timeout:300},d=>{assert.equal(d.accepted,true);assert.equal(d.timeout_verified,false);assert(Date.parse(d.sandbox.end_at)<Date.parse(first.sandbox.end_at))});
 const cleaned=owned;await ok('kill_sandbox',{sandbox_id:owned});owned=null;await tool('get_sandbox',{sandbox_id:cleaned},d=>assert(d.error),'Deleted sandbox independently returns not-found',true);
 const after=await ok('list_sandboxes',{},d=>assert(!d.sandboxes.some(x=>x.sandbox_id===cleaned)));assert.equal(after.sandboxes.length,baseline.sandboxes.length);
 summary={...summary,result:'PASS',runtime_tools:18,artifact_sha256:artifact.sha256,resistant_descendant:'PASS',borrowed_ownership:'PASS',cleanup:'Own sandbox absent; resource count matches baseline'};
 writeFileSync(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}catch(e){summary.error=clean({message:e.message}).message;event('run_failure',{}, {error:e.message},'Complete fresh acceptance','Run stopped at actual failure','FAIL');writeFileSync(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));process.exitCode=1;}
finally{if(owned){try{await ok('kill_sandbox',{sandbox_id:owned});owned=null;}catch(e){event('cleanup_failure',{}, {error:e.message},'Delete only own sandbox','Cleanup failed','FAIL');}}await stop();writeFileSync(join(output,'owned.json'),JSON.stringify({sandbox:owned,template:newTemplate}));}

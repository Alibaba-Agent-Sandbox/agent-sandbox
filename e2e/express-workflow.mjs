/** Opt-in source preparation -> template-owned run.py -> CLI/HTTP business verification. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Sandbox} from '../dist/api/sandbox.js';
import {SandboxNotFoundError,TemplateNotFoundError} from '../dist/models/errors.js';
import {requestApplication} from '../dist/transport/application_http.js';
import {loadConfig} from '../dist/transport/config.js';
import {getTemplate} from '../dist/providers/alicloud_express/fc_template.js';
import {paths} from '../dist/transport/config_layers.js';
import {loadCredentials,makeMasker} from './lib/env.mjs';
const credentials=loadCredentials();Object.assign(process.env,credentials);
const cli=fileURLToPath(new URL('../dist/bin/abx.js',import.meta.url)),directory=fs.mkdtempSync(path.join(os.tmpdir(),'abx-express-acceptance-'));
const alias=`workflow-e2e-${randomBytes(6).toString('hex')}`,receiptFile=path.join(paths.abxDir,'deployments',alias,'resources.json'),sessionFile=path.join(directory,'session.json');
const report={result:'FAIL',checks:[],cleanup:{},limitation:'Only this selected python-hello source and its run.py business path are exercised.'};
const config=loadConfig(),nativeOptions={access_key_id:config.access_key_id,access_key_secret:config.access_key_secret,region:config.region};
assert.ok(nativeOptions.access_key_id&&nativeOptions.access_key_secret&&config.api_key,'Configure Express Sandbox key and AccessKeys');
let sandbox,error,templateId;
function session(){return fs.existsSync(sessionFile)?JSON.parse(fs.readFileSync(sessionFile,'utf8')):{};}
function receipt(){return fs.existsSync(receiptFile)?JSON.parse(fs.readFileSync(receiptFile,'utf8')):undefined;}
function sanitize(value){const mask=makeMasker(credentials,[session().application_token,...(receipt()?.resources??[]).map(item=>item.id).filter(Boolean)]);return mask(String(value)).replace(/https?:\/\/[^\s"']+/g,'[url]').slice(-8000);}
async function execute(binary,args,cwd=directory){
  return new Promise(resolve=>{const child=execFile(binary,args,{cwd,env:process.env,encoding:'utf8',timeout:1_500_000,maxBuffer:8*1024*1024},(error,stdout,stderr)=>resolve({code:error?error.code??1:0,stdout,stderr}));child.stdin.end();});
}
async function run(args,json=true){const result=await execute(process.execPath,[cli,...(json?['--json']:[]),...args]);if(result.code!==0){fs.writeFileSync(path.join(directory,'failure.txt'),sanitize(result.stderr+result.stdout),{mode:0o600});throw new Error(`CLI ${args[0]} failed; sanitized diagnostics retained privately`);}return json?JSON.parse(result.stdout):result.stdout;}
function check(name){report.checks.push(name);console.log(`PASS ${name}`);}
try{
  let source;
  if(process.env.ABX_WORKFLOW_SOURCE)source=fs.realpathSync(process.env.ABX_WORKFLOW_SOURCE);
  else{source=path.join(directory,'python-hello');await run(['template','init',source,'--from',process.env.ABX_WORKFLOW_REF||'Alibaba-Agent-Sandbox/awesome-templates//python-hello'],false);}
  assert.ok(fs.existsSync(path.join(source,'run.py')),'Selected source must include its supported dynamic runtime run.py');
  const prepared=await run(['deploy',source,'--name',alias,'--build-timeout','1200','--yes']);
  templateId=prepared.resources.find(item=>item.name==='agent'&&item.kind==='template')?.id;assert.ok(templateId);assert.equal(prepared.sandbox_id,undefined);
  assert.ok(receipt()?.resources.some(item=>item.id===templateId&&item.kind==='template'));check('named resource preparation and exact template receipt');
  const launched=await execute(process.env.ABX_WORKFLOW_PYTHON||'python3',[path.join(source,'run.py'),'--template',templateId,'--provider','alicloud-express','--session',sessionFile,'--timeout','600'],source);
  assert.equal(launched.code,0,'Template run.py failed; private session preserves creation/cleanup outcome');
  const state=session();assert.equal(state.status,'ready');assert.ok(state.sandbox_id&&state.application_token);
  assert.equal(fs.statSync(sessionFile).mode&0o777,0o600);process.env.ABX_SERVER_TOKEN=state.application_token;
  check('template run.py creates instance, starts application and preserves private runtime authentication');
  await run(['status',alias]);await run(['list']);
  const executed=await run(['sandbox','exec',state.sandbox_id,'python3','-c','print(21 * 2)']);assert.equal(executed.exit_code,0);assert.equal(executed.stdout.trim(),'42');check('CLI runtime exec');
  const commands=await run(['sandbox','command','list',state.sandbox_id]);assert.ok(JSON.stringify(commands).includes('hello'));
  const hello=await run(['sandbox','command','run',state.sandbox_id,'hello','--arg','name=Workflow']);assert.ok(JSON.stringify(hello).includes('Hello, Workflow!'));check('CLI command discovery and hello business command');
  sandbox=await Sandbox.connect(state.sandbox_id,{provider:'alicloud-express'});
  const endpoint=await sandbox.network.resolveEndpoint(9000),response=await requestApplication(endpoint,'/commands/hello',{method:'POST',json:{name:'HTTP'},application_token:state.application_token});
  assert.equal(response.status_code,200);assert.equal(response.json().result,'Hello, HTTP!');check('authenticated POST /commands/hello');
  const rejected=await requestApplication(endpoint,'/commands/hello',{method:'POST',json:{name:'HTTP'},application_token:'placeholder-wrong-token'});assert.equal(rejected.status_code,401);check('incorrect application token rejected');
  const local=path.join(directory,'input.txt'),download=path.join(directory,'output.txt');fs.writeFileSync(local,'workflow file roundtrip');
  await run(['sandbox','upload',state.sandbox_id,local,'/tmp/abx-workflow.txt'],false);await run(['sandbox','download',state.sandbox_id,'/tmp/abx-workflow.txt',download],false);assert.equal(fs.readFileSync(download,'utf8'),'workflow file roundtrip');check('CLI file roundtrip');
  report.result='PASS';
}catch(failure){error=failure;}
finally{
  try{
    const state=session();
    if(state.sandbox_id){
      await Sandbox.killById(state.sandbox_id,{provider:'alicloud-express'}).catch(failure=>{if(!(failure instanceof SandboxNotFoundError))throw failure;});
      let absent=false;await Sandbox.getInfoById(state.sandbox_id,{provider:'alicloud-express'}).catch(failure=>{if(failure instanceof SandboxNotFoundError)absent=true;else throw failure;});assert.ok(absent);report.cleanup.sandbox='independently confirmed absent';
    }else assert.ok(!state.status,'Instance creation outcome unresolved; preserve private session');
    const before=receipt();
    if(before){
      await run(['delete',alias,'--yes']);
      for(const item of before.resources.filter(item=>item.kind==='template'&&item.owned&&item.id)){
        let absent=false;await getTemplate(item.id,{...nativeOptions,region:item.region}).catch(failure=>{if(failure instanceof TemplateNotFoundError)absent=true;else throw failure;});assert.ok(absent);
      }
      const remaining=receipt().resources.filter(item=>item.owned&&item.status!=='deleted');
      assert.ok(remaining.every(item=>item.kind==='image'&&item.status==='retained'));
      report.cleanup.templates='owned templates independently confirmed absent';
      report.cleanup.images=remaining.length?'Images retained under their exact tags in the private resource receipt; manual registry cleanup required':'no retained images';
    }
  }catch(failure){report.cleanup.failure=sanitize(failure.message);report.result='FAIL';}
  try{await sandbox?.close();}catch{report.cleanup.client_close='unconfirmed';report.result='FAIL';}
  if(error)report.result='FAIL';
  fs.writeFileSync(process.env.ABX_WORKFLOW_REPORT||path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
}
if(error){console.error(sanitize(error.message));process.exitCode=1;}
if(report.result!=='PASS')process.exitCode=1;

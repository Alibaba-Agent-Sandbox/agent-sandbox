/** Real public catalog-name launch. Requires candidate or public-installed ABX_BIN and Express credentials in the environment. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readdirSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadCredentials,makeMasker} from '../../../../e2e/lib/env.mjs';
import {baseEnv,runBinary,parseBin} from '../../../../e2e/lib/exec.mjs';
assert(process.env.ABX_BIN,'ABX_BIN must identify the tested CLI');
const creds=loadCredentials();
const key=process.env.ABX_SANDBOX_API_KEY||creds.E2B_API_KEY;
const origin=process.env.ABX_SANDBOX_BASE_URL||creds.E2B_API_URL;
assert(key&&origin,'Express API key and endpoint are required');
const root=mkdtempSync(join(tmpdir(),'abx-public-catalog-'));const home=join(root,'home');mkdirSync(home);
const env=baseEnv({home,creds,extra:{ABX_NO_KEYCHAIN:'1',ABX_SANDBOX_API_KEY:key,ABX_SANDBOX_BASE_URL:origin,ABX_SANDBOX_DOMAIN:process.env.ABX_SANDBOX_DOMAIN||creds.E2B_DOMAIN}});
assert(!env.ABX_TEMPLATE_INDEX_URL,'Use the real default catalog without overrides');
const mask=makeMasker(creds,[key,origin,new URL(origin).host,root]);
const check=(result,stage)=>assert.equal(result.code,0,`${stage} exit=${result.code} timeout=${result.timedOut}; ${mask(result.stderr).replace(/https?:\/\/[^\s"']+/g,'<URL>').slice(0,2000)}`);
const run=argv=>runBinary({bin:parseBin(process.env.ABX_BIN),argv,env,cwd:root,timeoutMs:180000});
const api=(id,method='GET')=>fetch(`${origin.replace(/\/$/,'')}/sandboxes/${encodeURIComponent(id)}`,{method,headers:{'X-API-Key':key},signal:AbortSignal.timeout(30000)});
const journalDir=join(home,'.abx','resource-journal');
const journals=()=>existsSync(journalDir)?readdirSync(journalDir).filter(n=>n.endsWith('.json')).flatMap(n=>JSON.parse(readFileSync(join(journalDir,n),'utf8')).entries):[];
const contains42=value=>typeof value==='string'?value.trim()==='42':value&&typeof value==='object'?Object.values(value).some(contains42):false;
let failure,clean=false;
try{
 const version=await run(['--version']);check(version,'CLI version');assert.match(version.stdout,/\b0\.5\.1\b/);
 const launch=await run(['--provider','alicloud-express','--json','template','launch','base','--yes','--sandbox-timeout','300']);
 check(launch,'public catalog launch');
 const result=JSON.parse(launch.stdout);assert(result?.sandbox_id);assert.deepEqual(result.services,{});
 console.log('PASS: public CLI 0.5.1 launched bare catalog name base with TTL 300 and empty initial cache');
 const exec=await run(['--native','--provider','alicloud-express','--json','exec',result.sandbox_id,"python3 -c 'print(6 * 7)'"]);
 check(exec,'remote exec');assert(contains42(JSON.parse(exec.stdout)),'remote result must contain exactly 42');
 console.log('PASS: remote exec returned 42');
 const killed=await run(['--native','--provider','alicloud-express','--json','kill',result.sandbox_id,'--yes']);check(killed,'CLI kill');
 assert.equal((await api(result.sandbox_id)).status,404,'independent API lookup must confirm sandbox absence');
 console.log('PASS: CLI kill and independent API absence check');
}catch(error){failure=error;}
finally{
 try{
  const records=journals();
  for(const item of records.filter(e=>e.kind==='sandbox'&&e.id)){
   let absent=await api(item.id);
   if(absent.status!==404){const deleted=await api(item.id,'DELETE');assert(deleted.ok||deleted.status===404);absent=await api(item.id);}
   assert.equal(absent.status,404,'owned sandbox must be absent');
  }
  assert(!records.some(e=>!e.id&&['intent','uncertain'].includes(e.state)),'unresolved resource intent requires reconciliation');
  clean=true;console.log('PASS: all owned resources independently absent');
 }catch{process.exitCode=1;console.error('BLOCKED: cleanup unresolved; isolated resource journal retained');}
 if(clean)rmSync(root,{recursive:true,force:true});
}
if(failure){console.error(`${failure.name}: ${mask(failure.message)}`);process.exitCode=1;}

#!/usr/bin/env node
/** Opt-in template preparation and explicit instance execution; retains uncertain ownership records. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadCredentials,makeMasker} from './lib/env.mjs';
import {baseEnv,runBinary,parseBin} from './lib/exec.mjs';
const creds=loadCredentials(),key=process.env.ABX_SANDBOX_API_KEY||creds.E2B_API_KEY,origin=process.env.ABX_SANDBOX_BASE_URL||creds.E2B_API_URL;
assert.ok(key&&origin,'Sandbox credentials and endpoint are required');
const root=mkdtempSync(join(tmpdir(),'abx-template-preparation-')),home=join(root,'home');mkdirSync(home);
const env=baseEnv({home,creds,extra:{ABX_NO_KEYCHAIN:'1',ABX_SANDBOX_API_KEY:key,ABX_SANDBOX_BASE_URL:origin,ABX_SANDBOX_DOMAIN:process.env.ABX_SANDBOX_DOMAIN||creds.E2B_DOMAIN}});
const mask=makeMasker(creds,[key,origin]),bin=parseBin(process.env.ABX_BIN||`${process.execPath} ${new URL('../dist/bin/abx.js',import.meta.url).pathname}`);
const run=argv=>runBinary({bin,argv,env,cwd:root,timeoutMs:660000});
const api=(id,method='GET')=>fetch(`${origin.replace(/\/$/,'')}/sandboxes/${encodeURIComponent(id)}`,{method,headers:{'X-API-Key':key},signal:AbortSignal.timeout(30000)});
let failure,uncertain=false;const sandboxes=[],deployments=[];
try {
  for(const mode of process.argv.includes('--managed-only')?['managed']:['managed','source']){
    const directory=join(root,mode);mkdirSync(directory);
    const template=mode==='managed'?{reference:'base',region:env.ABX_REGION||'cn-hangzhou'}:{
      region:env.ABX_REGION||'cn-hangzhou',generation:2,cpu:2,memorySize:2048,
      image:'fc-e2b-registry.cn-hangzhou.cr.aliyuncs.com/runtime/base:v0.0.49',
      buildConfig:{steps:[{type:'RUN',args:['printf whole-template-ready > /tmp/abx-whole-template-marker']}]}};
    writeFileSync(join(directory,'template.yaml'),JSON.stringify({specVersion:1,name:`prepare-${mode}`,sandbox:{agent:{provider:'alicloud-express',template}}}));
    const name=`prepare-${mode}`;deployments.push(name);
    const prepared=await run(['--provider','alicloud-express','--json','deploy',directory,'--name',name,'--yes']);
    assert.equal(prepared.code,0,`${mode} preparation failed; inspect retained private receipt`);
    const result=JSON.parse(prepared.stdout),resource=result.resources.find(item=>item.kind==='template'&&item.name==='agent');assert.ok(resource?.id);
    assert.equal(result.sandbox_id,undefined,'preparation must not create a dynamic instance');
    uncertain=true;
    const created=await run(['--provider','alicloud-express','--json','sandbox','create','--template',resource.id,'--timeout','600','--yes']);
    const body=JSON.parse(created.stdout);if(body.ID){sandboxes.push(body.ID);uncertain=false;}
    assert.equal(created.code,0,'instance creation failed; inspect private records');assert.ok(body.ID);
    writeFileSync(join(root,`${mode}-instance.json`),JSON.stringify({sandbox_id:body.ID}),{mode:0o600});
    const command=mode==='source'?'test "$(cat /tmp/abx-whole-template-marker)" = whole-template-ready':'printf whole-template-ready';
    const executed=await run(['--provider','alicloud-express','--json','sandbox','exec',body.ID,command]);
    assert.equal(executed.code,0,'explicit instance execution failed');
    console.log(`${mode}: named template preparation, explicit creation and remote execution PASS`);
  }
}catch(error){failure=error;}
finally{
  try{
    for(const id of sandboxes){const removed=await api(id,'DELETE');assert.ok(removed.ok||removed.status===404);assert.equal((await api(id)).status,404);}
    for(const name of deployments){
      const file=join(home,'.abx','deployments',name,'resources.json');
      if(!existsSync(file))continue;
      const before=JSON.parse(readFileSync(file,'utf8'));
      const removed=await run(['delete',name,'--yes']);assert.equal(removed.code,0,'resource cleanup failed');
      const after=JSON.parse(readFileSync(file,'utf8'));assert.ok(after.resources.every(entry=>!entry.owned||entry.status==='deleted'));
      const fc=await import('../dist/providers/alicloud_express/fc_template.js');
      const {TemplateNotFoundError}=await import('../dist/models/errors.js');
      for(const entry of before.resources.filter(item=>item.kind==='template'&&item.owned&&item.id)){
        let absent=false;await fc.getTemplate(entry.id,{access_key_id:creds.ALICLOUD_ACCESS_KEY_ID,access_key_secret:creds.ALICLOUD_ACCESS_KEY_SECRET,region:entry.region}).catch(error=>{if(error instanceof TemplateNotFoundError)absent=true;else throw error;});assert.ok(absent);
      }
    }
    assert.equal(uncertain,false,'unknown instance outcome requires private-record reconciliation');
    rmSync(root,{recursive:true,force:true});console.log('owned sandbox/template cleanup PASS; borrowed template retained');
  }catch(error){console.error(`Cleanup incomplete; private records retained: ${mask(String(error.message))}`);process.exitCode=1;}
}
if(failure){console.error(mask(failure.message));process.exitCode=1;}

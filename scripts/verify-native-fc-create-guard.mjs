// Run with node --import tsx scripts/verify-native-fc-create-guard.mjs --bundle /path/to/fc3-0.1.26
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {createRequire} from 'node:module';
import {COMPONENT_RUNNER_SOURCE} from '../src/application/component_runner.ts';import {execute} from '../src/application/process.ts';
const bundle=path.resolve(process.argv[process.argv.indexOf('--bundle')+1] || '');
assert(fs.existsSync(path.join(bundle,'dist/index.js')), 'Pass the unpacked exact fc3 bundle with --bundle');
for(const mode of ['existing','conflict','success']) {
 let events=''; const root=fs.mkdtempSync(path.join(os.tmpdir(),'abx-fc-guard-'));const calls=[];let created=false;const name='guard-fixture';
 const info={functionName:name,functionId:'fixture-id',functionArn:'acs:fc:cn-hangzhou:123:functions/'+name,createdTime:'2026-11-13T00:00:00Z',runtime:'custom-container',state:'Active',lastUpdateStatus:'Successful',memorySize:1024,cpu:1,customContainerConfig:{image:'registry.example.com/test/fixture:old',port:9000},tags:[]};
 const server=http.createServer((req,res)=>{calls.push({method:req.method,path:req.url});req.resume();res.setHeader('content-type','application/json');
  if(req.method==='GET'&&req.url?.split('?')[0]==='/2023-03-30/functions/'+name){if(mode==='existing'||created)return res.end(JSON.stringify(info));res.statusCode=404;return res.end(JSON.stringify({Code:'FunctionNotFound',Message:'fixture absent',RequestId:'fixture'}));}
  if(req.method==='POST'&&req.url==='/2023-03-30/functions'){if(mode==='conflict'){res.statusCode=409;return res.end(JSON.stringify({Code:'FunctionAlreadyExists',Message:'fixture conflict',RequestId:'fixture'}));}created=true;return res.end(JSON.stringify(info));}
  res.statusCode=200;res.end('{}');
 });await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const endpoint='http://127.0.0.1:'+server.address().port;
 try {const runner=path.join(root,'runner.cjs');fs.writeFileSync(runner,COMPONENT_RUNNER_SOURCE);fs.writeFileSync(path.join(root,'template.yaml'),'specVersion: 1\n');
 const output=JSON.parse(await execute({argv:[process.execPath,runner],cwd:root,env:{PATH:process.env.PATH,HOME:root,NO_COLOR:'1',HTTP_PROXY:'',HTTPS_PROXY:'',NO_PROXY:'*'},privateResult:true,onEventData:data=>events+=data,timeoutSeconds:25,input:JSON.stringify({action:'invoke',events:true,loaderPath:createRequire(path.resolve('package.json')).resolve('@serverless-devs/load-component'),component:bundle,componentReference:'fc3@0.1.26',command:'deploy',cwd:root,name:'fixture',resource:'api',args:['--assume-yes','--skip-push','--function','config'],functionCreationGuard:{endpoint,functionName:name},props:{region:'cn-hangzhou',endpoint,functionName:name,runtime:'custom-container',cpu:1,memorySize:1024,role:'acs:ram::123:role/existing',customContainerConfig:{image:'registry.example.com/test/fixture:new',port:9000}},credential:{AccountID:'123',AccessKeyID:'fixture-access',AccessKeySecret:'fixture-secret'}})}));
 assert(!events.includes('fixture-secret'), 'credential leaked to logs');
 if(mode==='success') {assert.equal(output.error,undefined);assert(calls.some(call=>call.method==='POST'));}
 else assert.equal(output.code,'ABX_FC_CREATE_CONFLICT');
 assert(!calls.some(call=>['PUT','DELETE','PATCH'].includes(call.method)));
 assert.equal(calls.filter(call=>call.method==='POST').length,mode==='existing'?0:1);
 console.log(JSON.stringify({mode,result:'PASS',requests:calls.length,mutations:calls.filter(call=>call.method!=='GET').length,cloudRequests:0}));
 }finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));fs.rmSync(root,{recursive:true,force:true});}
}

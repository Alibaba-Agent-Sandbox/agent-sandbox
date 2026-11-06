import test from 'node:test';
import assert from 'node:assert/strict';
import { projectWorkflowImages, selectWorkflowImageJournals } from './express-workflow-images.mjs';
const alias = 'workflow-e2e-0123456789ab', suffix = '0011223344556677';
const id = '00000000-0000-4000-8000-000000000000', profileName = alias + '-' + suffix;
function fixture() {
  const repository = 'registry.cn-hangzhou.aliyuncs.com/placeholder/python-hello';
  const journal = { version: 1, id, provider: 'alicloud-express', plan_digest: 'a'.repeat(64), entries: [
    { kind:'image',intent_id:'00000000-0000-4000-8000-000000000001',cleanup:'manual',state:'retained',
      correlation_key:'python-hello:'+profileName,id:'python-hello:'+profileName,secret:'placeholder-secret' },
    { kind:'image',intent_id:'00000000-0000-4000-8000-000000000002',cleanup:'manual',state:'retained',
      correlation_key:repository+':'+profileName,id:repository+'@sha256:'+'d'.repeat(64) },
    { kind:'template',intent_id:'00000000-0000-4000-8000-000000000003',cleanup:'template.delete',state:'retained',
      correlation_key:profileName,id:'placeholder-template' },
    { kind:'sandbox',intent_id:'00000000-0000-4000-8000-000000000004',cleanup:'sandbox.delete',state:'retained',
      correlation_key:'placeholder-template',id:'placeholder-sandbox' }
  ] };
  return { journal,launch:{provider:'alicloud-express',journal_id:id,plan_digest:'a'.repeat(64),
    source_digest:'b'.repeat(64),template_reference:'placeholder-template',token:'placeholder-secret'},
    window:{startedAt:'2026-11-06T00:00:00Z',finishedAt:'2026-11-06T00:10:00Z'},before:[] };
}
const run = f => projectWorkflowImages([f.journal],alias,f.launch,f.window,f.before);
test('actual two-image/template/sandbox shape freezes full random profile tag and independent digests',()=>{
  const r=run(fixture());assert.equal(r.status,'complete');assert.equal(r.images.length,2);
  assert.equal(r.launchPlanDigest,'a'.repeat(64));assert.equal(r.sourceDigest,'b'.repeat(64));
  assert.ok(r.images.every(x=>x.createdAt===null&&x.correlationKey.endsWith(':'+profileName)));
  assert.equal(r.nativeCreationTimeObserved,false);assert.equal(r.nativeRepositoryIdentityObserved,false);
  assert.equal(JSON.stringify(r).includes('placeholder-secret'),false);
});
for(const[name,change]of[
 ['old plain alias without compiler suffix',f=>f.journal.entries[0].correlation_key='python-hello:'+alias],
 ['same-prefix foreign suffix',f=>f.journal.entries[0].correlation_key+='-foreign'],
 ['wrong launch journal',f=>f.launch.journal_id='00000000-0000-4000-8000-000000000009'],
 ['source digest used as plan digest',f=>f.journal.plan_digest=f.launch.source_digest],
 ['wrong template reference',f=>f.launch.template_reference='foreign-template'],
 ['missing template intent',f=>f.journal.entries=f.journal.entries.filter(x=>x.kind!=='template')],
 ['ambiguous template reference',f=>f.journal.entries.push({...f.journal.entries[2]})],
 ['template full-name mismatch',f=>f.journal.entries[2].correlation_key=alias+'-8899aabbccddeeff'],
 ['immutable repository mismatch',f=>f.journal.entries[1].id='other@sha256:'+'d'.repeat(64)],
 ['unknown state',f=>f.journal.entries[0].state='maybe-created'],
 ['duplicate image intent',f=>f.journal.entries[1].intent_id=f.journal.entries[0].intent_id],
 ['created without identity',f=>delete f.journal.entries[0].id],
 ['preexisting journal UUID',f=>f.before=[id]],
 ['missing prelaunch inventory',f=>f.before=undefined],
])test('does not pass with '+name,()=>{const f=fixture();change(f);assert.equal(run(f).status,'unconfirmed');});
test('the envd tag is projected only when its original image intent exists',()=>{
  const f=fixture(),remote=f.journal.entries[1].correlation_key+'-envd';
  assert.equal(run(f).images.length,2);
  f.journal.entries.push({kind:'image',intent_id:'00000000-0000-4000-8000-000000000005',cleanup:'manual',state:'retained',correlation_key:remote,id:remote});
  const r=run(f);assert.equal(r.status,'complete');assert.equal(r.images.length,3);
});
test('unknown entry preserves the other validated image row without passing',()=>{
  const f=fixture();f.journal.entries[0].state='unknown';const r=run(f);
  assert.equal(r.status,'unconfirmed');assert.equal(r.images.length,1);
});
test('intent and uncertain outcomes remain unconfirmed and never receive a created ID',()=>{
  for(const state of ['intent','uncertain']){const f=fixture();f.journal.entries[0].state=state;delete f.journal.entries[0].id;
    const r=run(f);assert.equal(r.status,'unconfirmed');assert.equal(r.images[0].state,state);assert.equal(r.images[0].id,null);}
});
test('early image-only failure is recoverable after a confirmed prelaunch inventory',()=>{
  const f=fixture();f.journal.entries=f.journal.entries.filter(x=>x.kind==='image');
  assert.ok(f.journal.entries.every(x=>!x.correlation_key.startsWith(alias)));
  const selected=selectWorkflowImageJournals([f.journal],alias);assert.equal(selected.length,1);
  const r=projectWorkflowImages(selected,alias,undefined,f.window,[]);
  assert.equal(r.status,'unconfirmed');assert.equal(r.images.length,2);assert.equal(r.sourceDigest,null);
  assert.ok(r.issues.includes('launch_binding_unconfirmed'));
});
test('selection rejects a non-closed alias prefix neighbor',()=>{
  const f=fixture();for(const x of f.journal.entries.filter(x=>x.kind==='image'))x.correlation_key+='-foreign';
  assert.deepEqual(selectWorkflowImageJournals([f.journal],alias),[]);
});
test('multiple new journals remain ambiguous even when one is the successful launch journal',()=>{
  const f=fixture(),other=structuredClone(f.journal);other.id='00000000-0000-4000-8000-000000000009';
  const r=projectWorkflowImages([f.journal,other],alias,f.launch,f.window,[]);
  assert.equal(r.status,'unconfirmed');assert.equal(r.images.length,2);
});
test('multiple closed full tags in early image-only failure never grant complete status',()=>{
  const f=fixture();f.journal.entries=f.journal.entries.filter(x=>x.kind==='image');
  f.journal.entries[0].correlation_key='python-hello:'+alias+'-8899aabbccddeeff';f.journal.entries[0].id=f.journal.entries[0].correlation_key;
  const r=projectWorkflowImages([f.journal],alias,undefined,f.window,[]);
  assert.equal(r.status,'unconfirmed');assert.ok(r.issues.includes('image_profile_name_ambiguous'));assert.equal(r.images.length,2);
});
test('run-window projection discards extra fields and invalid timestamp strings',()=>{
  const f=fixture();f.window.token='placeholder-secret';assert.equal(JSON.stringify(run(f)).includes('placeholder-secret'),false);
  f.window.startedAt='placeholder-secret';const r=run(f);assert.equal(r.status,'unconfirmed');assert.equal(JSON.stringify(r).includes('placeholder-secret'),false);
});
test('duplicate exact correlation is not a complete image report',()=>{
  const f=fixture();f.journal.entries[1].correlation_key=f.journal.entries[0].correlation_key;
  assert.equal(run(f).status,'unconfirmed');
});

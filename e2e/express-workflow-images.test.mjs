import test from 'node:test';
import assert from 'node:assert/strict';
import { projectWorkflowImages, selectWorkflowImageJournals } from './express-workflow-images.mjs';
const alias = 'workflow-e2e-0123456789ab', id = '00000000-0000-4000-8000-000000000000';
function fixture() {
  const repository = 'registry.cn-hangzhou.aliyuncs.com/placeholder/owned';
  const journal = { version: 1, id, provider: 'alicloud-express', plan_digest: 'a'.repeat(64), entries: [
    { kind: 'image', intent_id: '00000000-0000-4000-8000-000000000001', cleanup: 'manual', state: 'retained',
      correlation_key: repository + ':' + alias, id: repository + '@sha256:' + 'd'.repeat(64), secret: 'placeholder-secret' },
    { kind: 'image', intent_id: '00000000-0000-4000-8000-000000000002', cleanup: 'manual', state: 'retained',
      correlation_key: 'owned:' + alias, id: 'owned:' + alias },
    { kind: 'image', intent_id: '00000000-0000-4000-8000-000000000003', cleanup: 'manual', state: 'retained',
      correlation_key: repository + ':' + alias + '-envd', id: repository + ':' + alias + '-envd' }
  ] };
  return { journal, launch: { journal_id: id, plan_digest: 'a'.repeat(64), source_digest: 'b'.repeat(64), token: 'placeholder-secret' },
    window: { startedAt: '2026-11-06T00:00:00Z', finishedAt: '2026-11-06T00:10:00Z' } };
}
const run = f => projectWorkflowImages([f.journal], alias, f.launch, f.window);
test('projects exact launch journal and distinct plan/source digests without secrets or invented native time', () => {
  const f = fixture(), r = run(f);
  assert.equal(r.status, 'complete'); assert.equal(r.images.length, 3);
  assert.equal(r.launchPlanDigest, 'a'.repeat(64)); assert.equal(r.sourceDigest, 'b'.repeat(64));
  assert.equal(r.nativeCreationTimeObserved, false); assert.equal(r.nativeRepositoryIdentityObserved, false);
  assert.ok(r.images.every(x => x.createdAt === null));
  assert.equal(JSON.stringify(r).includes('placeholder-secret'), false);
});
for (const [name, change] of [
  ['similar alias prefix', f => f.journal.entries[0].correlation_key += '-foreign'],
  ['wrong launch journal', f => f.launch.journal_id = '00000000-0000-4000-8000-000000000009'],
  ['source digest substituted for plan digest', f => f.journal.plan_digest = f.launch.source_digest],
  ['immutable repository mismatch', f => f.journal.entries[0].id = 'other@sha256:' + 'd'.repeat(64)],
  ['unknown state', f => f.journal.entries[0].state = 'maybe-created'],
  ['duplicate intent', f => f.journal.entries[1].intent_id = f.journal.entries[0].intent_id],
  ['created without identity', f => delete f.journal.entries[0].id],
]) test('does not pass with ' + name, () => { const f = fixture(); change(f); assert.equal(run(f).status, 'unconfirmed'); });
test('retains validated rows when another entry is invalid', () => {
  const f = fixture(); f.journal.entries[0].state = 'unknown';
  const r = run(f); assert.equal(r.status, 'unconfirmed'); assert.equal(r.images.length, 2);
});
test('intent and uncertain outcomes stay explicitly unconfirmed', () => {
  for (const state of ['intent', 'uncertain']) {
    const f = fixture(); f.journal.entries[0].state = state; delete f.journal.entries[0].id;
    const r = run(f); assert.equal(r.status, 'unconfirmed'); assert.equal(r.images[0].state, state); assert.equal(r.images[0].id, null);
  }
});
test('failure without a launch preserves exact-tag rows without claiming launch binding', () => {
  const f = fixture(), r = projectWorkflowImages([f.journal], alias, undefined, f.window);
  assert.equal(r.status, 'unconfirmed'); assert.equal(r.images.length, 3); assert.equal(r.sourceDigest, null);
});
test('run window is an allowlist and invalid values are not copied', () => {
  const f = fixture(); f.window.token = 'placeholder-secret';
  assert.equal(JSON.stringify(run(f)).includes('placeholder-secret'), false);
  f.window.startedAt = 'placeholder-secret';
  const r = run(f); assert.equal(r.status, 'unconfirmed');
  assert.equal(JSON.stringify(r).includes('placeholder-secret'), false);
});
test('duplicate exact correlation remains unconfirmed', () => {
  const f = fixture(); f.journal.entries[1].correlation_key = f.journal.entries[0].correlation_key;
  assert.equal(run(f).status, 'unconfirmed');
});
test('early image-only preparation failure preserves actual python-hello alias tags', () => {
  const f = fixture();
  for (const entry of f.journal.entries) {
    entry.correlation_key = entry.correlation_key.replaceAll('owned', 'python-hello');
    entry.id = entry.id.replaceAll('owned', 'python-hello');
  }
  assert.ok(f.journal.entries.every(x => !x.correlation_key.startsWith(alias)));
  const selected = selectWorkflowImageJournals([f.journal], alias);
  assert.equal(selected.length, 1);
  const r = projectWorkflowImages(selected, alias, undefined, f.window);
  assert.equal(r.status, 'unconfirmed'); assert.equal(r.images.length, 3);
});
test('image-only selection rejects an alias prefix neighbor', () => {
  const f = fixture();
  for (const entry of f.journal.entries) entry.correlation_key += '-foreign';
  assert.deepEqual(selectWorkflowImageJournals([f.journal], alias), []);
});

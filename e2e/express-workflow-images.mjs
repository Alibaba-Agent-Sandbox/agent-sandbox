/** Image-only recovery projection for this opt-in workflow; no native calls or secrets. */
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DIGEST = /^(sha256:)?[a-f0-9]{64}$/;
const RESOURCE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,1023}$/;
const STATES = new Set(['intent', 'created', 'uncertain', 'deleted', 'retained']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function imageTag(value, alias) {
  if (typeof value !== 'string' || !RESOURCE.test(value) || value.includes('://') || value.includes('@')) return null;
  const split = value.lastIndexOf(':');
  if (split <= value.lastIndexOf('/')) return null;
  const repository = value.slice(0, split), tag = value.slice(split + 1);
  return repository && [alias, alias + '-envd'].includes(tag) ? { repository, tag } : null;
}
/** Select exact image tags even when preparation failed before a template intent. */
export function selectWorkflowImageJournals(journals, alias) {
  if (!Array.isArray(journals) || !/^workflow-e2e-[a-f0-9]{12}$/.test(alias)) return [];
  return journals.filter(journal => object(journal) && Array.isArray(journal.entries)
    && journal.entries.some(entry => object(entry) && entry.kind === 'image' && imageTag(entry.correlation_key, alias)));
}
/**
 * Preserve only validated task image identities, including unresolved outcomes.
 * Journal timestamps/repository IDs do not exist here and are never invented.
 * @param {unknown} journals Selected resource journals.
 * @param {string} alias This run's exact random workflow alias.
 * @param {unknown} launch Actual successful launch receipt, if available.
 * @param {{startedAt: string, finishedAt: string}} window Observed host run interval.
 * @returns {Record<string, unknown>} Bounded non-secret image metadata and static issues.
 */
export function projectWorkflowImages(journals, alias, launch, window) {
  const issues = new Set(), images = [];
  const report = { schemaVersion: 1, status: 'unconfirmed', runWindow: {startedAt:null,finishedAt:null},
    sourceDigest: null, launchJournalId: null, launchPlanDigest: null,
    nativeCreationTimeObserved: false, nativeRepositoryIdentityObserved: false, images, issues: [] };
  const finish = () => {
    report.issues = [...issues];
    report.status = issues.size === 0 ? 'complete' : 'unconfirmed';
    return report;
  };
  if (!/^workflow-e2e-[a-f0-9]{12}$/.test(alias)
      || !object(window) || typeof window.startedAt !== 'string' || typeof window.finishedAt !== 'string'
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(window.startedAt)
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(window.finishedAt)
      || !Number.isFinite(Date.parse(window.startedAt))
      || !Number.isFinite(Date.parse(window.finishedAt))
      || Date.parse(window.finishedAt) < Date.parse(window.startedAt)
      || !Array.isArray(journals) || journals.length > 16) {
    issues.add('image_metadata_context_unconfirmed'); return finish();
  }
  report.runWindow = {startedAt:window.startedAt,finishedAt:window.finishedAt};
  const hasLaunch = object(launch);
  if (hasLaunch && UUID.test(launch.journal_id) && /^[a-f0-9]{64}$/.test(launch.plan_digest)
      && typeof launch.source_digest === 'string' && DIGEST.test(launch.source_digest)) {
    report.sourceDigest = launch.source_digest;
    report.launchJournalId = launch.journal_id;
    report.launchPlanDigest = launch.plan_digest;
  } else issues.add('launch_binding_unconfirmed');
  const seen = new Set();
  let matchedLaunch = 0;
  for (const journal of journals) {
    if (!object(journal) || journal.version !== 1 || journal.provider !== 'alicloud-express'
        || !UUID.test(journal.id) || !/^[a-f0-9]{64}$/.test(journal.plan_digest)
        || !Array.isArray(journal.entries) || journal.entries.length > 64 || seen.has(journal.id)) {
      issues.add('image_journal_unconfirmed'); continue;
    }
    seen.add(journal.id);
    if (hasLaunch && (journal.id !== report.launchJournalId || journal.plan_digest !== report.launchPlanDigest)) {
      issues.add('image_journal_launch_mismatch'); continue;
    }
    if (hasLaunch) matchedLaunch++;
    const entryIds = new Set(), correlations = new Set();
    for (const entry of journal.entries.filter(row => object(row) && row.kind === 'image')) {
      const tag = imageTag(entry.correlation_key, alias);
      if (!UUID.test(entry.intent_id) || entryIds.has(entry.intent_id) || correlations.has(entry.correlation_key) || entry.cleanup !== 'manual'
          || !STATES.has(entry.state) || !tag) { issues.add('image_entry_unconfirmed'); continue; }
      entryIds.add(entry.intent_id);
      correlations.add(entry.correlation_key);
      let digest = null;
      if (entry.id !== undefined) {
        if (typeof entry.id !== 'string' || !RESOURCE.test(entry.id) || entry.id.includes('://')) {
          issues.add('image_identifier_unconfirmed'); continue;
        }
        const immutable = entry.id.match(/^(.+)@(sha256:[a-f0-9]{64})$/);
        if (immutable) {
          if (immutable[1] !== tag.repository) { issues.add('image_repository_mismatch'); continue; }
          digest = immutable[2];
        } else if (entry.id !== entry.correlation_key) { issues.add('image_identifier_mismatch'); continue; }
      } else if (!['intent', 'uncertain'].includes(entry.state)) {
        issues.add('created_image_identifier_missing'); continue;
      }
      images.push({ journalId: journal.id, planDigest: journal.plan_digest, intentId: entry.intent_id,
        state: entry.state, cleanup: entry.cleanup, correlationKey: entry.correlation_key,
        id: entry.id ?? null, immutableDigest: digest, createdAt: null });
      if (['intent', 'uncertain'].includes(entry.state)) issues.add('image_creation_outcome_unconfirmed');
    }
  }
  if (hasLaunch && matchedLaunch !== 1) issues.add('exact_launch_journal_required');
  if (!images.length) issues.add('no_validated_image_metadata');
  return finish();
}

/** Image-only observer for the opt-in workflow. It never authorizes deletion. */
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DIGEST = /^(sha256:)?[a-f0-9]{64}$/;
const RESOURCE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,1023}$/;
const STATES = new Set(['intent', 'created', 'uncertain', 'deleted', 'retained']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const baseAlias = value => typeof value === 'string' && /^workflow-e2e-[a-f0-9]{12}$/.test(value);
function fullName(value, alias) {
  return typeof value === 'string' && baseAlias(alias) && new RegExp('^' + alias + '-[a-f0-9]{16}$').test(value);
}
function imageTag(value, alias) {
  if (typeof value !== 'string' || !RESOURCE.test(value) || value.includes('://') || value.includes('@')) return null;
  const split = value.lastIndexOf(':');
  if (split <= value.lastIndexOf('/')) return null;
  const repository = value.slice(0, split), tag = value.slice(split + 1);
  const profileName = tag.endsWith('-envd') ? tag.slice(0, -5) : tag;
  return repository && fullName(profileName, alias) ? { repository, tag, profileName } : null;
}
/** Select only closed compiler-tag shapes, including failures before a template intent. */
export function selectWorkflowImageJournals(journals, alias) {
  if (!Array.isArray(journals) || !baseAlias(alias)) return [];
  return journals.filter(journal => object(journal) && Array.isArray(journal.entries)
    && journal.entries.some(entry => object(entry) && entry.kind === 'image' && imageTag(entry.correlation_key, alias)));
}
/**
 * Preserve validated image identities while leaving unresolved launch outcomes failed.
 * @param {unknown} journals Exact image-correlated resource journals.
 * @param {string} alias This run's pre-launch random base alias.
 * @param {unknown} launch Actual successful launch receipt, if available.
 * @param {{startedAt: string, finishedAt: string}} window Observed host interval.
 * @param {unknown} preexistingJournalIds UUIDs observed before the first CLI launch.
 * @returns {Record<string, unknown>} Bounded image-only observation, never cleanup authority.
 */
export function projectWorkflowImages(journals, alias, launch, window, preexistingJournalIds) {
  const issues = new Set(), images = [];
  const report = { schemaVersion: 1, status: 'unconfirmed', runWindow: {startedAt:null,finishedAt:null},
    sourceDigest: null, launchJournalId: null, launchPlanDigest: null,
    prelaunchJournalInventoryConfirmed: false, nativeCreationTimeObserved: false,
    nativeRepositoryIdentityObserved: false, images, issues: [] };
  const finish = () => {
    report.issues = [...issues]; report.status = issues.size === 0 ? 'complete' : 'unconfirmed'; return report;
  };
  if (!baseAlias(alias) || !object(window) || typeof window.startedAt !== 'string' || typeof window.finishedAt !== 'string'
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(window.startedAt)
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(window.finishedAt)
      || !Number.isFinite(Date.parse(window.startedAt)) || !Number.isFinite(Date.parse(window.finishedAt))
      || Date.parse(window.finishedAt) < Date.parse(window.startedAt)
      || !Array.isArray(journals) || journals.length > 16
      || !Array.isArray(preexistingJournalIds) || preexistingJournalIds.length > 10000
      || !preexistingJournalIds.every(id => typeof id === 'string' && UUID.test(id))
      || new Set(preexistingJournalIds).size !== preexistingJournalIds.length) {
    issues.add('image_metadata_context_unconfirmed'); return finish();
  }
  report.runWindow = {startedAt:window.startedAt,finishedAt:window.finishedAt};
  report.prelaunchJournalInventoryConfirmed = true;
  const before = new Set(preexistingJournalIds), hasLaunch = object(launch);
  if (hasLaunch && launch.provider === 'alicloud-express' && UUID.test(launch.journal_id)
      && /^[a-f0-9]{64}$/.test(launch.plan_digest) && typeof launch.source_digest === 'string'
      && DIGEST.test(launch.source_digest) && typeof launch.template_reference === 'string'
      && RESOURCE.test(launch.template_reference) && !launch.template_reference.includes('://')) {
    report.sourceDigest = launch.source_digest; report.launchJournalId = launch.journal_id;
    report.launchPlanDigest = launch.plan_digest;
  } else issues.add('launch_binding_unconfirmed');
  if (journals.length !== 1) issues.add('image_journal_selection_ambiguous');
  const seen = new Set(); let matchedLaunch = 0;
  for (const journal of journals) {
    if (!object(journal) || journal.version !== 1 || journal.provider !== 'alicloud-express'
        || !UUID.test(journal.id) || !/^[a-f0-9]{64}$/.test(journal.plan_digest)
        || !Array.isArray(journal.entries) || journal.entries.length > 64 || seen.has(journal.id)) {
      issues.add('image_journal_unconfirmed'); continue;
    }
    seen.add(journal.id);
    if (before.has(journal.id)) { issues.add('preexisting_image_journal_rejected'); continue; }
    if (hasLaunch && (journal.id !== report.launchJournalId || journal.plan_digest !== report.launchPlanDigest)) {
      issues.add('image_journal_launch_mismatch'); continue;
    }
    let frozenName = null;
    if (hasLaunch) {
      matchedLaunch++;
      const matches = journal.entries.filter(entry => object(entry) && entry.kind === 'template'
        && entry.id === launch.template_reference);
      if (matches.length === 1 && matches[0].cleanup === 'template.delete'
          && ['created','retained','deleted'].includes(matches[0].state)
          && fullName(matches[0].correlation_key, alias)) frozenName = matches[0].correlation_key;
      else issues.add('exact_launch_template_binding_unconfirmed');
    }
    const imageEntries = journal.entries.filter(entry => object(entry) && entry.kind === 'image');
    const names = new Set(imageEntries.map(entry => imageTag(entry.correlation_key, alias)?.profileName).filter(Boolean));
    if (names.size !== 1) issues.add('image_profile_name_ambiguous');
    if (frozenName && (names.size !== 1 || !names.has(frozenName))) issues.add('image_profile_template_mismatch');
    const entryIds = new Set(), correlations = new Set();
    for (const entry of imageEntries) {
      const tag = imageTag(entry.correlation_key, alias);
      if (!UUID.test(entry.intent_id) || entryIds.has(entry.intent_id) || correlations.has(entry.correlation_key)
          || entry.cleanup !== 'manual' || !STATES.has(entry.state) || !tag
          || (frozenName && tag.profileName !== frozenName)) { issues.add('image_entry_unconfirmed'); continue; }
      entryIds.add(entry.intent_id); correlations.add(entry.correlation_key);
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

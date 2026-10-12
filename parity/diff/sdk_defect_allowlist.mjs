// Allow-list of the places where the Node CLI legitimately differs from the original Python `ebx` 0.2.0 oracle
// because the Node port fixed the SDK defects KI-001 .. KI-008 (parity/sdk-defect-fixes.md).
//
// Every allowed divergence is keyed by harness + case id (sdk_defect_ids.json) AND a KI number (the family in
// sdk_defect_entries.mjs). A family lists, per field (`exit`, `stdout`, `stderr`, `req`), a matcher that must accept
// the exact (oracle, node) pair; a differing field no matcher accepts is NOT allowed and the case stays a DIFF. An id
// that no differing case used is reported as STALE (the run fails), so fixed or renamed cases leave no dead exemptions.
//
// Usage in a runner:
//   const allow = createAllowList('sandbox_cmds');
//   const ruling = allow.judgeResults(caseId, pyResult, nodeResult);      // {allowed, kis, unexplained}
//   ...
//   const stale = allow.report({ complete: !only && !fast });             // prints the summary, returns #stale ids
//
// SDK_ALLOWLIST_DISCOVER=<file> accepts every id for every family and appends {harness,id,family} lines to <file>
// (used once to regenerate sdk_defect_ids.json; never in CI).
import { appendFileSync } from 'node:fs';
import { DISCOVER_FILE, familiesFor } from './sdk_defect_entries.mjs';

const idMatches = (fam, id) => (Array.isArray(fam.ids) ? fam.ids.includes(id) : fam.ids.test(id));

/** Fields of a differing (oracle, node) result pair; keys follow the runners (`code`|`exit`, `requests`|`wire`). */
export function differingFields(a, b) {
  const f = {};
  const ea = a.code ?? a.exit;
  const eb = b.code ?? b.exit;
  if (ea !== eb) f.exit = [ea, eb];
  if (a.stdout !== b.stdout) f.stdout = [a.stdout, b.stdout];
  if (a.stderr !== b.stderr) f.stderr = [a.stderr, b.stderr];
  const ra = a.requests ?? a.wire ?? null;
  const rb = b.requests ?? b.wire ?? null;
  if (ra && rb && JSON.stringify(ra) !== JSON.stringify(rb)) f.req = [ra, rb];
  for (const k of ['artifacts', 'tree', 'qlog', 'stdoutHex']) {
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) f[k] = [a[k], b[k]];
  }
  if (a.artifacts && b.artifacts && typeof a.artifacts === 'object') {
    for (const k of new Set([...Object.keys(a.artifacts), ...Object.keys(b.artifacts)])) {
      if (a.artifacts[k] !== b.artifacts[k]) f[`artifact ${k}`] = [a.artifacts[k], b.artifacts[k]];
    }
    delete f.artifacts;
  }
  return f;
}

export function createAllowList(harness) {
  const families = familiesFor(harness);
  const usedIds = new Map(families.map((f) => [f, new Set()]));
  const allowed = [];

  function judge(caseId, fields) {
    const names = Object.keys(fields);
    if (!names.length) return { allowed: false, kis: [], unexplained: [] };
    const candidates = families.filter((f) => idMatches(f, caseId));
    const explainedBy = new Map();
    for (const name of names) {
      const [py, node] = fields[name];
      for (const fam of candidates) {
        const m = fam.fields[name];
        let ok = false;
        try { ok = !!m && m(py, node, fields); } catch { ok = false; }
        if (ok) { explainedBy.set(name, fam); break; }
      }
    }
    const unexplained = names.filter((n) => !explainedBy.has(n));
    if (unexplained.length) return { allowed: false, kis: [], unexplained, partial: [...new Set([...explainedBy.values()].map((f) => `${f.ki}:${f.name}`))] };
    const fams = [...new Set(explainedBy.values())];
    for (const fam of fams) {
      usedIds.get(fam).add(caseId);
      if (DISCOVER_FILE) appendFileSync(DISCOVER_FILE, `${JSON.stringify({ harness, id: caseId, family: fam.name })}\n`);
    }
    const kis = [...new Set(fams.map((f) => f.ki))].sort();
    allowed.push({ id: caseId, kis });
    return { allowed: true, kis, unexplained: [] };
  }

  const judgeResults = (caseId, a, b) => judge(caseId, differingFields(a, b));

  function report({ complete }) {
    const byKi = {};
    for (const a of allowed) for (const k of a.kis) byKi[k] = (byKi[k] ?? 0) + 1;
    const parts = Object.keys(byKi).sort().map((k) => `${k}: ${byKi[k]}`);
    console.log(`[${harness}] allow-listed SDK-defect divergences (parity/sdk-defect-fixes.md): ${allowed.length} case(s)${parts.length ? ` (${parts.join(', ')})` : ''}`);
    let stale = 0;
    if (complete && !DISCOVER_FILE) {
      for (const fam of families) {
        if (!Array.isArray(fam.ids)) continue;
        for (const id of fam.ids) {
          if (!usedIds.get(fam).has(id)) { stale += 1; console.log(`STALE allow-list id (${fam.ki} ${fam.name}, ${harness}): ${JSON.stringify(id)} did not diverge in the way the entry allows; remove or fix it in parity/diff/sdk_defect_ids.json`); }
        }
      }
    }
    return stale;
  }

  return { judge, judgeResults, report, families };
}

// Normalisation of non-deterministic fragments, so scenario assertions and cross-binary
// comparisons are stable. Order matters.
export function normalize(text, { home, cwd, tmp } = {}) {
  let t = String(text ?? '');
  t = t.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  for (const [p, tag] of [[cwd, '<CWD>'], [home, '<HOME>'], [tmp, '<TMP>']]) {
    if (p && p.length > 3) t = t.split(p).join(tag);
  }
  t = t.replace(/sbx-[A-Za-z0-9-]{6,}/g, 'sbx-XXXXX');
  t = t.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)?/g, '<TS>');
  t = t.replace(/"execution_time":\s*[\d.eE+-]+/g, '"execution_time": 0.0');
  t = t.replace(/\bc-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{12}\b/g, '<CONTAINER>');
  t = t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<UUID>');
  t = t.replace(/\d{2}:\d{2}:\d{2} up [^\n]*/g, '<uptime>');
  return t.split('\n').map((l) => l.replace(/\s+$/g, '')).join('\n').trim() + '\n';
}

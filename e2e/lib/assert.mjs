export class ScenarioFailure extends Error {}

export function fail(msg) { throw new ScenarioFailure(msg); }

function describe(m) {
  if (m instanceof RegExp) return String(m);
  if (typeof m === 'function') return m.name || 'predicate';
  return JSON.stringify(m);
}

/** Matchers: string = substring, RegExp = test, fn = predicate or throwing check, {not:m} = negation. */
export function check(label, text, matchers) {
  for (const m of [].concat(matchers ?? [])) {
    if (m && typeof m === 'object' && !(m instanceof RegExp) && 'not' in m) {
      if (matches(text, m.not)) fail(`${label} must not match ${describe(m.not)}\n--- ${label} ---\n${excerpt(text)}`);
    } else if (!matches(text, m)) {
      fail(`${label} did not match ${describe(m)}\n--- ${label} ---\n${excerpt(text)}`);
    }
  }
}

function matches(text, m) {
  if (typeof m === 'string') return text.includes(m);
  if (m instanceof RegExp) return m.test(text);
  if (typeof m === 'function') { const r = m(text); return r === undefined ? true : Boolean(r); }
  return false;
}

export function excerpt(text, n = 1200) {
  const t = String(text);
  return t.length > n ? `${t.slice(0, n)}\n... [${t.length - n} more chars]` : t;
}

export function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** Shape check: { key: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null' | 'any' | 'string|null' | nested shape }. */
export function checkShape(value, shape, path = '$') {
  if (typeof shape === 'string') {
    if (shape === 'any') return;
    const t = typeOf(value);
    if (!shape.split('|').includes(t)) fail(`${path}: expected ${shape}, got ${t} (${excerpt(JSON.stringify(value), 120)})`);
    return;
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) fail(`${path}: expected array`);
    for (let i = 0; i < value.length; i++) checkShape(value[i], shape[0], `${path}[${i}]`);
    return;
  }
  if (typeOf(value) !== 'object') fail(`${path}: expected object, got ${typeOf(value)}`);
  for (const [k, s] of Object.entries(shape)) {
    if (!(k in value)) fail(`${path}: missing key "${k}" (has: ${Object.keys(value).join(', ')})`);
    checkShape(value[k], s, `${path}.${k}`);
  }
}

export function tryJson(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

/** The CLI may print WARNING lines before the JSON document; parse from the first top-level brace. */
export function parseJsonLoose(text) {
  const direct = tryJson(text);
  if (direct !== undefined) return direct;
  const docs = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/^[{\["]/.test(lines[i])) {
      for (let j = lines.length; j > i; j--) {
        const v = tryJson(lines.slice(i, j).join('\n'));
        if (v !== undefined) { docs.push(v); i = j - 1; break; }
      }
    }
  }
  return docs.length ? docs[docs.length - 1] : undefined;
}

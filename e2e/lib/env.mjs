// Credential loading + secret masking for the black-box E2E suite.
// Secrets are read from the process environment or the gitignored cli/.env and are
// NEVER written anywhere: every captured byte goes through mask() first.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const E2E_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CLI_ROOT = join(E2E_DIR, '..');

/** Variables forwarded to the binary under test (credentials + endpoints). */
export const CRED_KEYS = [
  'ABX_SANDBOX_API_KEY', 'ABX_SANDBOX_BASE_URL', 'ABX_SANDBOX_DOMAIN',
  'ACR_NAMESPACE',
  'ABX_LLM_API_KEY', 'ABX_LLM_BASE_URL',
  'ALICLOUD_ACCESS_KEY_ID', 'ALICLOUD_ACCESS_KEY_SECRET',
  'ALIBABA_CLOUD_REGION_ID',
];
const SECRET_KEYS = new Set([
  'ABX_SANDBOX_API_KEY', 'ABX_LLM_API_KEY',
  'ALICLOUD_ACCESS_KEY_ID', 'ALICLOUD_ACCESS_KEY_SECRET', 'ACR_NAMESPACE',
]);
const HOST_KEYS = new Set(['ABX_SANDBOX_BASE_URL', 'ABX_SANDBOX_DOMAIN', 'ABX_LLM_BASE_URL']);

export function parseDotenv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function loadCredentials() {
  const fromFile = {};
  for (const f of [join(CLI_ROOT, '.env'), join(CLI_ROOT, '..', 'python-sdk', '.env')]) {
    if (existsSync(f)) Object.assign(fromFile, { ...parseDotenv(readFileSync(f, 'utf8')), ...fromFile });
  }
  const creds = {};
  for (const k of CRED_KEYS) {
    const v = process.env[k] ?? fromFile[k];
    if (v) creds[k] = v;
  }
  return creds;
}

export function hasCloudCredentials(creds) {
  return Boolean(creds.ABX_SANDBOX_API_KEY && (creds.ABX_SANDBOX_BASE_URL || creds.ABX_SANDBOX_DOMAIN));
}

export function missingCloudCredentials(creds) {
  return ['ABX_SANDBOX_API_KEY', 'ABX_SANDBOX_BASE_URL'].filter((k) => !creds[k]);
}

/** Build a masker that replaces every secret / host value (and short derived forms). */
export function makeMasker(creds, extraSecrets = []) {
  const secrets = [];
  for (const [k, v] of Object.entries(creds)) {
    if (!v || v.length < 4) continue;
    if (SECRET_KEYS.has(k)) secrets.push([v, '<SECRET>']);
    else if (HOST_KEYS.has(k)) {
      secrets.push([v, k === 'ABX_SANDBOX_DOMAIN' ? '<DOMAIN>' : '<API_URL>']);
      try { const h = new URL(v.includes('://') ? v : `https://${v}`).host; if (h.length > 4) secrets.push([h, '<HOST>']); } catch { /* not a URL */ }
    }
  }
  for (const s of extraSecrets) if (s && s.length >= 4) secrets.push([s, '<SECRET>']);
  secrets.sort((a, b) => b[0].length - a[0].length);
  return (text) => {
    if (typeof text !== 'string') return text;
    let out = text;
    for (const [v, tag] of secrets) out = out.split(v).join(tag);
    // The CLI itself prints partially masked values such as "e2b***dc1"; never keep those either.
    out = out.replace(/\b[A-Za-z0-9_-]{2,4}\*{3}[A-Za-z0-9_-]{2,4}\b/g, '<PARTIAL-SECRET>');
    return out;
  };
}

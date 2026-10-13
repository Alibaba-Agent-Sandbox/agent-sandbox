// Families of allowed divergences between the original Python `abx` 0.2.0 (the oracle) and the Node CLI, one per
// observable effect of the SDK defect fixes KI-001 .. KI-008 (parity/sdk-defect-fixes.md describes each).
//
// A family has a KI number and one matcher per field (`exit`, `stdout`, `stderr`, `req`). A matcher accepts the exact
// (oracle, node) pair of a differing field or the field stays unexplained. Text matchers replace the changed fragment
// of both sides with the same token and require the rest to be byte-identical, so nothing else can hide in the same
// field. The case ids each family applies to are listed in sdk_defect_ids.json (harness -> family -> ids).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DISCOVER = process.env.SDK_ALLOWLIST_DISCOVER || null;
const IDS = (() => { try { return JSON.parse(readFileSync(join(HERE, 'sdk_defect_ids.json'), 'utf8')); } catch { return {}; } })();

const TOKEN = (m) => `\u0000${JSON.stringify(m.groups ? Object.fromEntries(Object.entries(m.groups).sort()) : {})}\u0000`;

/** `[pyRe, nodeRe]`: both sides must contain the fragment (same captured groups) and be equal around it. */
const swap = (pyRe, nodeRe) => ({ pyRe: new RegExp(pyRe.source, `${pyRe.flags.replace('g', '')}g`), nodeRe: new RegExp(nodeRe.source, `${nodeRe.flags.replace('g', '')}g`) });
const swapMatches = (pairs) => (py, node) => {
  for (const { pyRe, nodeRe } of pairs) {
    let n = 0;
    const a = String(py ?? '').replace(pyRe, (...args) => { n += 1; const groups = args.at(-1); return typeof groups === 'object' ? TOKEN({ groups }) : TOKEN({}); });
    if (!n) continue;
    const b = String(node ?? '').replace(nodeRe, (...args) => { const groups = args.at(-1); return typeof groups === 'object' ? TOKEN({ groups }) : TOKEN({}); });
    if (a === b) return true;
  }
  return false;
};

const SUGG_404 = "Verify the sandbox ID, template ID, or endpoint URL\\.";
const NODE_SB_SUGG = "Run 'abx list' to see the running sandboxes; a killed or expired sandbox cannot be reconnected\\.";
const NODE_FILE_SUGG = 'Use files\\.list\\(\\) to check available files, or files\\.exists\\(\\) to verify path\\.';
const AUTH_SUGG_PY = 'Check your API key or AK/SK credentials \\(abx config set sandbox_api_key <KEY>\\)\\.';
const AUTH_SUGG_NODE = 'Check your ABX_SANDBOX_API_KEY environment variable or pass sandbox_api_key\\.';
const NODE_AUTH_MSG = "The Platform API rejected the API key \\(HTTP 401\\) for /[^\\n:\"]*: it is invalid, revoked or for another region\\.";
const j = (s) => s.replace(/\n/g, '\\n');

const jsonErr = (message, code, suggestion) => `\\{\\n  "status": "error",\\n  "message": "${message}",\\n  "code": "${code}"${suggestion ? `,\\n  "suggestion": "${suggestion}"` : ''}\\n\\}\\n`;

const textPairs = {
  sandbox404: [
    swap(new RegExp(`\\[E5000\\] Resource not found \\(HTTP 404\\)\\.\\n  Suggestion: ${SUGG_404}\\n`), new RegExp(`\\[E2009\\] Sandbox '[^\\n]*' was not found\\.\\n  Suggestion: ${NODE_SB_SUGG}\\n`)),
    swap(/\[E5000\] Resource not found \(HTTP 404\)\.\n/, /\[E2009\] Sandbox '[^\n]*' was not found\.\n/),
    swap(new RegExp(jsonErr('Resource not found \\(HTTP 404\\)\\.', 'E5000', SUGG_404)), new RegExp(jsonErr("Sandbox '[^\\n]*' was not found\\.", 'E2009', NODE_SB_SUGG))),
  ],
  file404: [
    swap(new RegExp(`\\[E5000\\] Resource not found \\(HTTP 404\\)\\.\\n  Suggestion: ${SUGG_404}\\n`), new RegExp(`\\[E4001\\] File or directory not found in the sandbox: [^\\n]*\\n  Suggestion: ${NODE_FILE_SUGG}\\n`)),
    swap(/\[E5000\] Resource not found \(HTTP 404\)\.\n/, /\[E4001\] File or directory not found in the sandbox: [^\n]*\n/),
    swap(new RegExp(jsonErr('Resource not found \\(HTTP 404\\)\\.', 'E5000', SUGG_404)), new RegExp(jsonErr('File or directory not found in the sandbox: [^\\n]*', 'E4001', NODE_FILE_SUGG))),
  ],
  file403: [
    swap(/\[E1000\] Access denied \(HTTP 403\)\.\n  Suggestion: Check your credentials and permissions\.\n/, new RegExp(`\\[E4002\\] Permission denied in the sandbox: [^\\n]*\\n  Suggestion: Check file permissions in the sandbox\\.\\n`)),
    swap(/\[E1000\] Access denied \(HTTP 403\)\.\n/, /\[E4002\] Permission denied in the sandbox: [^\n]*\n/),
  ],
  fileOther: [
    swap(/\[E5000\] Remote request failed \(HTTP (?<status>\d+)\): [^\n]*\n(?:For more information check: [^\n]*\n)?  Suggestion: Check the platform status and retry\. Use 'abx -v <command>' for details\.\n/, /\[E4000\] envd file operation failed \(HTTP (?<status>\d+)\) for [^\n]*\n/),
    swap(/\[E5000\] Remote request failed \(HTTP (?<status>\d+)\): [^\n]*\n(?:For more information check: [^\n]*\n)?/, /\[E4000\] envd file operation failed \(HTTP (?<status>\d+)\) for [^\n]*\n/),
    swap(/\[E1000\] Authentication failed \(HTTP (?<status>401)\)\.\n  Suggestion: Check your API key or AK\/SK credentials \(abx config set sandbox_api_key <KEY>\)\.\n/, /\[E4000\] envd file operation failed \(HTTP (?<status>401)\) for [^\n]*\n/),
    swap(/\[E2002\] Rate limit exceeded \(HTTP (?<status>429)\)\.\n  Suggestion: Wait a moment and retry, or request a quota increase\.\n/, /\[E4000\] envd file operation failed \(HTTP (?<status>429)\) for [^\n]*\n/),
  ],
  auth401: [
    swap(new RegExp(`\\[E1000\\] Authentication failed \\(HTTP 401\\)\\.\\n  Suggestion: ${AUTH_SUGG_PY}\\n`), new RegExp(`\\[E1001\\] ${NODE_AUTH_MSG}\\n  Suggestion: ${AUTH_SUGG_NODE}\\n`)),
    swap(/\[E1000\] Authentication failed \(HTTP 401\)\.\n/, new RegExp(`\\[E1001\\] ${NODE_AUTH_MSG}\\n`)),
    swap(new RegExp(jsonErr('Authentication failed \\(HTTP 401\\)\\.', 'E1000', AUTH_SUGG_PY)), new RegExp(jsonErr(NODE_AUTH_MSG, 'E1001', AUTH_SUGG_NODE))),
    swap(/Failed to kill (?<id>[^\n:]*): Client error '401 Unauthorized' for url '[^'\n]*'\nFor more information check: [^\n]*\n/, new RegExp(`Failed to kill (?<id>[^\\n:]*): \\[E1001\\] ${NODE_AUTH_MSG}\\n  Suggestion: ${AUTH_SUGG_NODE}\\n`)),
    swap(/Failed to kill (?<id>[^\n:"]*): Client error '401 Unauthorized' for url '[^'\n]*'\\nFor more information check: [^\n"]*"/, new RegExp(`Failed to kill (?<id>[^\\n:"]*): \\[E1001\\] ${NODE_AUTH_MSG}\\\\n  Suggestion: ${AUTH_SUGG_NODE}"`)),
  ],
  create401: [
    swap(/\[E2000\] [^\n]*\n/, new RegExp(`\\[E1001\\] ${NODE_AUTH_MSG}\\n  Suggestion: ${AUTH_SUGG_NODE}\\n`)),
    swap(/\{\n  "status": "error",\n  "message": "[^"\n]*",\n  "code": "E2000"\n\}\n/, new RegExp(jsonErr(NODE_AUTH_MSG, 'E1001', AUTH_SUGG_NODE))),
  ],
  envdRpc: [
    swap(/\[E5000\] Resource not found \(HTTP 404\)\.\n  Suggestion: Verify the sandbox ID, template ID, or endpoint URL\.\n/, /\[E3006\] envd RPC \/process\.Process\/(?:List|SendSignal) failed \(HTTP 404\): [^\n]*\n  Suggestion: The sandbox envd rejected this RPC call\. Check the command and arguments, or run with 'abx -v' for the raw error response\.\n/),
    swap(/\[E5000\] Remote request failed \(HTTP 500\): [^\n]*for url '[^'\n]*?(?<path>\/process\.Process\/(?:List|SendSignal))'\n(?:For more information check: [^\n]*\n)?  Suggestion: Check the platform status and retry\. Use 'abx -v <command>' for details\.\n/, /\[E3006\] envd RPC (?<path>\/process\.Process\/(?:List|SendSignal)) failed \(HTTP 500\): [^\n]*\n  Suggestion: The sandbox envd rejected this RPC call\. Check the command and arguments, or run with 'abx -v' for the raw error response\.\n/),
  ],
};

const bigSafe = (s) => s.replace(/(?<![\w."])(-?\d{16,})(?![\w."])/g, '"__BIG__$1"');

function parseReq(s) {
  if (s === undefined || s === null) return null;
  const t = String(s);
  if (t.startsWith('{')) {
    const o = JSON.parse(t);
    const { method, path, body, ...rest } = o;
    return { form: 'json', method, path, body: body ? JSON.parse(bigSafe(body)) : null, rest };
  }
  const m = /^(\S+) (\S+) (\S*)(?: ([\s\S]*))?$/.exec(t);
  if (!m) return { form: 'raw', raw: t };
  return { form: 'wire', method: m[1], path: m[2], ct: m[3], body: m[4] ? JSON.parse(bigSafe(m[4])) : null };
}
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/** Apply `fn(parsedReq) -> parsedReq[]` to every oracle request and require the result to equal the node's requests. */
const reqTransform = (fn) => (pyArr, nodeArr) => {
  if (!Array.isArray(pyArr) || !Array.isArray(nodeArr)) return false;
  let changed = false;
  const expected = [];
  for (const s of pyArr) {
    const p = parseReq(s);
    const out = p && p.form !== 'raw' ? fn(p) : null;
    if (out) { changed = true; expected.push(...out); } else expected.push(p);
  }
  return changed && canon(expected) === canon(nodeArr.map(parseReq));
};

const SIGNAL_NAMES = { 15: 'SIGNAL_SIGTERM', 9: 'SIGNAL_SIGKILL' };
const isPath = (p, suffix) => typeof p.path === 'string' && p.path.split('?')[0] === suffix;

const reqEnvs = reqTransform((p) => {
  if (!isPath(p, '/process.Process/Start') || !p.body?.process || !('envVars' in p.body.process)) return null;
  const { envVars, ...restProcess } = p.body.process;
  return [{ ...p, body: { ...p.body, process: { ...restProcess, envs: envVars } } }];
});
const reqSignal = reqTransform((p) => {
  if (!isPath(p, '/process.Process/SendSignal') || !p.body || !('pid' in p.body) || !(p.body.signal in SIGNAL_NAMES)) return null;
  const { pid, signal, ...rest } = p.body;
  return [{ ...p, body: { process: { pid }, signal: SIGNAL_NAMES[signal], ...rest } }];
});
const reqSignalRejected = reqTransform((p) => (isPath(p, '/process.Process/SendSignal') && p.body && !(p.body.signal in SIGNAL_NAMES) ? [] : null));
const reqListEmpty = reqTransform((p) => (isPath(p, '/filesystem.Filesystem/ListDir') && p.body ? [p, { ...p, path: '/filesystem.Filesystem/Stat', body: { path: p.body.path } }] : null));

const SIG_REJECT_NODE = (n) => `Unexpected error: envd can only deliver SIGTERM (15) and SIGKILL (9) to a process; got ${n}\n  Suggestion: Use 'abx -v <command>' for more details, or report this issue.\n`;
const sigNumber = (py) => /Signal (-?\d+) sent to process \d+\.\n/.exec(py)?.[1] ?? /"message": "Signal (-?\d+) sent to process \d+\."/.exec(py)?.[1] ?? null;

const exitIs = (a, b) => (py, node) => py === a && node === b;
const exitPair = (pairs) => (py, node) => pairs.some(([a, b]) => py === a && node === b);

export const FAMILIES = {
  'ki001-envs': { ki: 'KI-001', why: 'per-call env is sent as `process.envs` (was `envVars`, ignored by envd)', fields: { req: reqEnvs } },
  'ki002-stat-entry': {
    ki: 'KI-002',
    why: 'Stat answers with a nested `entry`: a flat answer next to an empty `entry` object now renders the (empty) entry, like the fixed Python SDK',
    fields: { stdout: (py, node) => /^Name  app\.py\nPath  \/home\/user\/app\.py\nType  file\nSize  2048\n$/.test(py) && node === 'Name  \nPath  \nType  file\nSize  0\n' },
  },
  'ki004-signal-body': { ki: 'KI-004', why: 'SendSignal body is `{"process":{"pid":N},"signal":"SIGNAL_SIGTERM"|"SIGNAL_SIGKILL"}`', fields: { req: reqSignal } },
  'ki004-signal-rejected': {
    ki: 'KI-004',
    why: 'a signal other than 9/15 is rejected before any request (envd cannot deliver it)',
    fields: {
      exit: exitIs(0, 1),
      req: reqSignalRejected,
      stdout: (py, node) => {
        const n = sigNumber(py);
        if (n === null) return false;
        if (node === '') return /^Signal -?\d+ sent to process \d+\.\n$/.test(py);
        return py === `{\n  "status": "success",\n  "message": "Signal ${n} sent to process ${/process (\d+)\./.exec(py)?.[1]}."\n}\n` && node === `{\n  "status": "error",\n  "message": ${JSON.stringify(SIG_REJECT_NODE(n).split('\n  Suggestion')[0])},\n  "suggestion": "Use 'abx -v <command>' for more details, or report this issue."\n}\n`;
      },
      stderr: (py, node, f) => {
        const n = sigNumber(f.stdout?.[0] ?? '');
        return n !== null && node === `${py}${SIG_REJECT_NODE(n)}`;
      },
    },
  },
  'ki004-signal-huge': {
    ki: 'KI-004',
    why: 'a signal beyond 64 bits is rejected with the envd message instead of the orjson overflow text',
    fields: {
      stderr: (py, node) => {
        const m = /^((?:[^\n]*\n)*?)Unexpected error: Integer exceeds 64-bit range\n  Suggestion: Use 'abx -v <command>' for more details, or report this issue\.\n$/.exec(py);
        const n = /Unexpected error: envd can only deliver SIGTERM \(15\) and SIGKILL \(9\) to a process; got (\d+)\n/.exec(node)?.[1];
        return !!m && !!n && node === `${m[1]}${SIG_REJECT_NODE(n)}`;
      },
    },
  },
  'ki004-envd-error': {
    ki: 'KI-004',
    why: 'HTTP errors of the process RPCs (List/SendSignal/...) are EnvdRpcError (E3006), as in the fixed SDK',
    fields: { exit: exitPair([[4, 1]]), stderr: swapMatches(textPairs.envdRpc) },
  },
  'ki004-help': {
    ki: 'KI-004',
    why: '`sandbox process signal --help` no longer advertises SIGINT (envd only delivers 9 and 15)',
    fields: {
      stdout: (py, node) => {
        const a = py.replace('  Common signals: 15 (SIGTERM), 9 (SIGKILL), 2 (SIGINT).\n', '\u0000\n');
        const b = node.replace("  Supported signals: 15 (SIGTERM), 9 (SIGKILL). The sandbox's envd cannot\n  deliver any other signal; PID is the envd process id shown by 'process\n  list'.\n", '\u0000\n');
        const pyOpt = '  -s, --signal INTEGER  POSIX signal number: 2=SIGINT, 9=SIGKILL, 15=SIGTERM\n                        (default: 15)\n';
        const nodeOpt = '  -s, --signal INTEGER  Signal number: 9=SIGKILL or 15=SIGTERM (default: 15)\n';
        return a.includes('\u0000') && a.includes(pyOpt) && b.includes(nodeOpt) && a.replace(pyOpt, '\u0001') === b.replace(nodeOpt, '\u0001');
      },
    },
  },
  'ki005-sandbox-404': { ki: 'KI-005', why: 'an unknown sandbox is SandboxNotFoundError (E2009, exit 4) instead of the raw HTTP 404 text (E5000)', fields: { stderr: swapMatches(textPairs.sandbox404), stdout: swapMatches(textPairs.sandbox404) } },
  'ki005-file-404': { ki: 'KI-005', why: 'an envd file call answered with 404 is FileNotFoundError_ (E4001)', fields: { stderr: swapMatches(textPairs.file404), stdout: swapMatches(textPairs.file404) } },
  'ki005-file-403': { ki: 'KI-005', why: 'an envd file call answered with 403 is PermissionDeniedError (E4002, exit 1)', fields: { exit: exitIs(3, 1), stderr: swapMatches(textPairs.file403) } },
  'ki005-file-other': {
    ki: 'KI-005',
    why: 'an envd file call answered with any other status is FileOperationError (E4000, exit 1); 401 and 429 no longer take the platform auth/quota paths',
    fields: { exit: exitPair([[3, 1], [6, 1]]), stderr: swapMatches(textPairs.fileOther) },
  },
  'ki006-auth-401': { ki: 'KI-006', why: 'a Platform API 401 is InvalidAPIKeyError (E1001), not the raw HTTP error rendering (E1000)', fields: { stderr: swapMatches(textPairs.auth401), stdout: swapMatches(textPairs.auth401) } },
  'ki006-create-401': { ki: 'KI-006', why: '`create` with a bad key is an authentication error (exit 3, E1001), not SandboxCreationError (exit 1, E2000)', fields: { exit: exitIs(1, 3), stderr: swapMatches(textPairs.create401), stdout: swapMatches(textPairs.create401) } },
  'ki007-list-empty': {
    ki: 'KI-007',
    why: 'listing a directory envd reports as empty is verified with one Stat; a missing directory is FileNotFoundError_ (exit 4) instead of "is empty"',
    fields: {
      exit: exitIs(0, 4),
      req: reqListEmpty,
      stdout: (py, node) => {
        if (node === '') return /^Directory [^\n]* is empty\.\n$/.test(py);
        const m = /^\{\n {2}"status": "success",\n {2}"message": "Directory (.*) is empty\."\n\}\n$/.exec(py);
        if (!m) return false;
        return node === `{\n  "status": "error",\n  "message": ${JSON.stringify(`File or directory not found in the sandbox: ${m[1]}`)},\n  "code": "E4001",\n  "suggestion": "Use files.list() to check available files, or files.exists() to verify path."\n}\n`;
      },
      stderr: (py, node) => {
        const [a, b] = [py, node];
        const m = /\[E4001\] File or directory not found in the sandbox: [^\n]*\n(?:  Suggestion: Use files\.list\(\) to check available files, or files\.exists\(\) to verify path\.\n)?$/.exec(b);
        return !!m && b.slice(0, m.index) === a;
      },
    },
  },
};

const wildcard = /.*/;
export function familiesFor(harness) {
  const out = [];
  for (const [name, fam] of Object.entries(FAMILIES)) {
    const ids = DISCOVER ? wildcard : (IDS[harness]?.[name] ?? []);
    if (!DISCOVER && !ids.length) continue;
    out.push({ harness, name, ki: fam.ki, ids, fields: fam.fields, why: fam.why });
  }
  return out;
}
export const DISCOVER_FILE = DISCOVER;

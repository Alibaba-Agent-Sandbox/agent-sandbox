// Walk every command `ebx --help` exposes, plus the hidden `provider` group, by spawning
// the binary. Each node gets `--help` (exit 0, usage names the command) and one local
// invocation that does not create a sandbox and does not call the cloud or DashScope:
// a usage error when a required argument or option is missing, or a local operation
// (config get/set/list/init, provider list/default/doctor/update, template init of the
// built-in python case, mcp --help/status/stop).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const UNKNOWN = '--not-an-ebx-option';
const DETAIL = join(tmpdir(), 'ebx-all-commands-detail.json');

/** Top-level names the help walk must reach. `provider` is hidden on a fresh HOME. */
const EXPECTED_ROOTS = [
  'config', 'provider', 'sandbox', 'template', 'mcp',
  'create', 'list', 'info', 'kill', 'exec', 'connect', 'upload', 'download',
  'run', 'deploy', 'init', 'install',
];

function parseCommands(text) {
  const lines = String(text).split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim() === 'Commands:');
  if (idx < 0) return [];
  const cmds = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      if (cmds.length) break;
      continue;
    }
    const m = /^ {2}([a-zA-Z][a-zA-Z0-9-]*)\s{2,}/.exec(line);
    if (m) cmds.push(m[1]);
    else if (cmds.length && /^\s+/.test(line)) continue;
    else break;
  }
  return cmds;
}

function usageLine(text) {
  return (String(text).split(/\r?\n/).find((l) => l.startsWith('Usage:')) ?? '').trim();
}

/** Unbracketed positional metavars. `[OPTIONS]` and `[PATH]` are optional; `...` is not an argument. */
function requiredPositionals(usage, path) {
  let rest = usage.replace(/^Usage:\s+ebx\s*/, '');
  for (const part of path) {
    if (!rest.startsWith(part)) return [];
    rest = rest.slice(part.length).trimStart();
  }
  const required = [];
  let depth = 0;
  let cur = '';
  const flush = () => {
    if (cur && depth === 0 && cur !== '...' && !cur.startsWith('-')) required.push(cur);
    cur = '';
  };
  for (const ch of rest) {
    if (ch === '[') { flush(); depth += 1; }
    else if (ch === ']') { flush(); depth = Math.max(0, depth - 1); }
    else if (/\s/.test(ch)) flush();
    else cur += ch;
  }
  flush();
  return required;
}

function labelOf(path) {
  return path.length ? path.join(' ') : '(root)';
}

/**
 * Local argv for one node. Groups print usage (exit 2) except the root, which prints
 * help and exits 0. Leaves with a required positional omit it. Anything else that
 * would reach a backend gets an unknown option so parsing fails before the callback.
 */
function planSafe(path, { isGroup, usage }) {
  const key = path.join(' ');
  if (path.length === 0) return { argv: [], code: 0, match: /Usage: ebx/ };
  if (key === 'config list') return { argv: [...path], code: 0, match: /region/ };
  if (key === 'config get') return { argv: [...path, 'region'], code: 0, match: /^cn-hangzhou$/m };
  if (key === 'config set') return { argv: [...path, 'http_timeout', '45'], code: 0, match: /http_timeout = 45/ };
  if (key === 'config init') return { argv: [...path, '--yes'], code: 0, match: /ebx config set/ };
  if (key === 'provider list' || key === 'provider default') return { argv: [...path], code: 0, match: /alicloud-express/ };
  if (key === 'provider doctor') return { argv: [...path], code: 0, match: /installed/ };
  if (key === 'provider update') return { argv: [...path], code: 0, match: /up to date/ };
  if (key === 'template init' || key === 'init') return { kind: 'scaffold', argv: [...path] };
  if (key === 'mcp') return { argv: ['mcp', '--help'], code: 0, match: /Usage: ebx mcp/ };
  if (key === 'mcp status') return { argv: [...path], code: 0, match: /easy-sandbox/ };
  if (key === 'mcp stop') return { argv: [...path], code: 0, match: /not running/i };
  if (key === 'create' || key === 'sandbox create') return { argv: [...path], code: 2, match: /No DESCRIPTION or --template/ };
  if (key === 'kill' || key === 'sandbox kill') return { argv: [...path], code: 2, match: /sandbox ID/ };
  if (isGroup) return { argv: [...path], code: 2, match: /Usage: ebx/ };
  if (requiredPositionals(usage, path).length) return { argv: [...path], code: 2, match: /Missing argument/ };
  if (key === 'mcp install') return { argv: [...path], code: 2, match: /Missing option '--target'/ };
  return { argv: [...path, UNKNOWN], code: 2, match: /No such option/ };
}

function refuseUnsafe(argv) {
  const has = (s) => argv.includes(s);
  if ((has('create') || argv.at(-1) === 'create') && has('--template')) {
    throw new Error(`refusing to create a sandbox: ${argv.join(' ')}`);
  }
  if (has('start') && argv[0] === 'mcp' && !has(UNKNOWN) && !has('--help')) {
    throw new Error(`refusing to start the MCP server: ${argv.join(' ')}`);
  }
  if (has('kill') && has('--all')) throw new Error(`refusing kill --all: ${argv.join(' ')}`);
}

function cloudLeak(text) {
  // `config list` prints the default llm_base_url. That string is not a DashScope request.
  const stripped = String(text).replace(/https:\/\/dashscope\.aliyuncs\.com\/compatible-mode\/v1/g, '');
  return /dashscope\.aliyuncs|dashscope\.com|Creating sandbox|E1001|No authentication credentials/i.test(stripped);
}

function dump(argv, res) {
  return [
    `$ ebx ${argv.join(' ')}`.trimEnd(),
    `exit ${res.code}${res.timedOut ? ' TIMEOUT' : ''}`,
    '--- stdout ---',
    res.stdout ?? '',
    '--- stderr ---',
    res.stderr ?? '',
  ].join('\n');
}

export default {
  id: 'all-commands',
  title: 'Every command: --help and one local invocation (no cloud, no DashScope)',
  needs: [],
  scenarios: [
    {
      id: 'walk',
      title: 'help tree and safe local invocations for every command and subcommand',
      creds: false,
      timeoutMs: 180_000,
      async run(ctx) {
        const home = ctx.home;
        const cwd = ctx.cwd;
        const cfgHome = ctx.newHome('config');
        const failures = [];
        const nodes = [];
        const seen = new Set();

        const call = (argv, { home: h = home, cwd: c = cwd } = {}) => ctx.rawEbx(argv, {
          creds: false, home: h, cwd: c, timeoutMs: 45_000, stdin: '',
        });

        async function visit(path) {
          const key = labelOf(path);
          if (seen.has(key)) return;
          seen.add(key);
          const node = { command: key, help: null, safe: null };
          nodes.push(node);

          const helpArgv = [...path, '--help'];
          const help = await call(helpArgv);
          const usage = usageLine(help.stdout) || usageLine(help.stderr);
          const named = path.length ? path.join(' ') : 'ebx';
          node.help = { code: help.code, usage };
          const helpBlob = `${help.stdout}\n${help.stderr}`;
          if (help.timedOut || help.code !== 0 || !usage.includes(named) || cloudLeak(helpBlob)) {
            failures.push({ command: key, phase: 'help', output: dump(helpArgv, help) });
          }

          const subs = help.code === 0 ? parseCommands(help.stdout) : [];
          const isGroup = subs.length > 0;
          const plan = planSafe(path, { isGroup, usage });
          const work = path[0] === 'config' ? cfgHome : home;

          if (plan.kind === 'scaffold') {
            const slot = path[0] === 'init' ? 'init-python' : 'template-init-python';
            const dir = ctx.newCwd(slot);
            const argv = [...plan.argv, 'python-case', '--template', 'python', '--name', 'python-case'];
            refuseUnsafe(argv);
            const res = await call(argv, { home: work, cwd: dir });
            const blob = `${res.stdout}\n${res.stderr}`;
            const docker = join(dir, 'python-case', 'Dockerfile');
            const yaml = join(dir, 'python-case', 'template.yaml');
            node.safe = { argv, code: res.code, scaffold: existsSync(docker) };
            const missing = ['Dockerfile', 'commands.py', 'template.yaml'].filter((f) => !existsSync(join(dir, 'python-case', f)));
            const yamlText = existsSync(yaml) ? readFileSync(yaml, 'utf8') : '';
            const dockerText = existsSync(docker) ? readFileSync(docker, 'utf8') : '';
            if (res.timedOut || res.code !== 0 || missing.length || !yamlText.includes('python-case') || cloudLeak(blob) || /dashscope/i.test(dockerText)) {
              failures.push({
                command: key,
                phase: 'scaffold',
                output: `${dump(argv, res)}\nmissing: ${missing.join(', ') || '(none)'}\n--- Dockerfile ---\n${dockerText}\n--- template.yaml ---\n${yamlText}`,
              });
            }
          } else {
            refuseUnsafe(plan.argv);
            const res = await call(plan.argv, { home: work });
            const blob = `${res.stdout}\n${res.stderr}`;
            node.safe = { argv: plan.argv, code: res.code };
            if (res.timedOut || res.code !== plan.code || !plan.match.test(blob) || cloudLeak(blob)) {
              failures.push({
                command: key,
                phase: 'safe',
                output: `${dump(plan.argv, res)}\nexpected exit ${plan.code} matching ${plan.match}`,
              });
            }
          }

          for (const sub of subs) await visit([...path, sub]);
        }

        await visit([]);
        if (!seen.has('provider')) await visit(['provider']);

        for (const name of EXPECTED_ROOTS) {
          if (!seen.has(name)) failures.push({ command: name, phase: 'missing', output: `command ${name} was not reached from --help` });
        }
        for (const group of ['sandbox files', 'sandbox process', 'sandbox system']) {
          if (!seen.has(group)) failures.push({ command: group, phase: 'missing', output: `group ${group} was not reached from --help` });
        }

        const summary = {
          walked: nodes.length,
          helpPass: nodes.length - failures.filter((f) => f.phase === 'help').length,
          safePass: nodes.length - failures.filter((f) => f.phase === 'safe' || f.phase === 'scaffold').length,
          fail: failures.length,
          commands: nodes.map((n) => n.command),
          failures,
        };
        writeFileSync(DETAIL, JSON.stringify(summary, null, 2));
        console.log(`all-commands walked=${summary.walked} helpPass=${summary.helpPass} safePass=${summary.safePass} fail=${summary.fail}`);
        if (failures.length) {
          ctx.fail(failures.map((f) => `## ${f.command} (${f.phase})\n${f.output}`).join('\n\n'));
        }
      },
    },
  ],
};

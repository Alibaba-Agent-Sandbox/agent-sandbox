/** Real Express workdir check. The caller owns sandbox creation and deletion. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  'sandbox-id': { type: 'string' },
  workdir: { type: 'string', default: '/home/user/app' },
  cli: { type: 'string' },
  'expect-read-only': { type: 'boolean', default: false },
} });
assert.ok(values['sandbox-id'], 'Supply --sandbox-id for a sandbox you own');
const probe = `import json, os, tempfile
from pathlib import Path
path = Path(json.loads(${JSON.stringify(JSON.stringify(values.workdir))}))
s = path.stat()
result = {"runtime_uid": os.getuid(), "directory_uid": s.st_uid,
          "directory_gid": s.st_gid, "mode": oct(s.st_mode & 0o777)}
try:
    with tempfile.TemporaryDirectory(prefix="abx-workdir-probe-", dir=path) as directory:
        target = Path(directory) / "probe.txt"
        target.write_text("first")
        target.write_text("second")
        assert target.read_text() == "second"
        target.unlink()
    result["write_read_delete"] = True
    result["temporary_directory_removed"] = not Path(directory).exists()
except PermissionError:
    result["write_read_delete"] = False
print(json.dumps(result))
`;
const command = values.cli ?? process.execPath;
const prefix = values.cli ? [] : [fileURLToPath(new URL('../dist/bin/abx.js', import.meta.url))];
const run = spawnSync(command, [...prefix, '--native', '--json', 'exec', values['sandbox-id'],
  '--', 'python3', '-c', probe], { encoding: 'utf8', timeout: 90_000 });
assert.equal(run.status, 0, 'Remote permission probe failed; inspect your sandbox separately');
const execution = JSON.parse(run.stdout);
assert.equal(execution.exit_code, 0);
const observation = JSON.parse(execution.stdout);
console.log(JSON.stringify(observation));
assert.equal(observation.runtime_uid, 1000, 'Expected the Express non-root user');
assert.equal(observation.write_read_delete, !values['expect-read-only']);
if (!values['expect-read-only']) assert.equal(observation.temporary_directory_removed, true);

// Opt-in existing-Volume data-plane verification. The configured sandbox API key must
// belong to the Volume's Team. No key is exported and no Volume/storage is provisioned.
// Required: ABX_E2E_VOLUME_MOUNT=1, ABX_E2E_VOLUME_NAME, ABX_E2E_VOLUME_MOUNT_PATH.
// This harness restricts paths to /mnt/abx-e2e/...; this is not a backend restriction.
import { randomUUID } from 'node:crypto';

const PROVIDER = 'alicloud-express';
const MARKERS = { probe: 'ABX_MOUNT_VERIFIED', roundtrip: 'ABX_MOUNT_ROUNDTRIP', cleanup: 'ABX_MOUNT_CLEAN' };
const shellQuote = (text) => `'${text.replace(/'/g, `'"'"'`)}'`;

/** A real mount-table entry is required before opening or removing a sentinel. */
export function volumeMountCommand(path, name, payload, mode) {
  const script = String.raw`import json, os, re, stat, sys
config = json.loads(sys.argv[1])
target, name, payload, mode = (config[k] for k in ('path', 'name', 'payload', 'mode'))
def verify_mount():
    if os.path.realpath(target) != target or not os.path.isdir(target):
        raise RuntimeError('mount path is unavailable or contains a symlink')
    found = False
    with open('/proc/self/mountinfo', encoding='utf-8') as mounts:
        for line in mounts:
            fields = line.split()
            mountpoint = re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), fields[4])
            if mountpoint == target:
                found = True
    if not found:
        raise RuntimeError('no exact mount-table entry')
verify_mount()
directory = os.open(target, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    if mode == 'probe':
        print('ABX_MOUNT_VERIFIED')
    elif mode == 'roundtrip':
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        owned = os.fstat(fd)
        try:
            with os.fdopen(fd, 'wb') as sentinel:
                sentinel.write(payload.encode('ascii'))
                sentinel.flush()
                os.fsync(sentinel.fileno())
            reader = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
            with os.fdopen(reader, 'rb') as sentinel:
                current = os.fstat(sentinel.fileno())
                if (current.st_dev, current.st_ino) != (owned.st_dev, owned.st_ino) or sentinel.read(len(payload) + 1) != payload.encode('ascii'):
                    raise RuntimeError('sentinel verification failed')
        finally:
            current = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if not stat.S_ISREG(current.st_mode) or (current.st_dev, current.st_ino) != (owned.st_dev, owned.st_ino):
                raise RuntimeError('sentinel ownership changed; no deletion attempted')
            os.unlink(name, dir_fd=directory)
        print('ABX_MOUNT_ROUNDTRIP')
    elif mode == 'cleanup':
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        except FileNotFoundError:
            pass
        else:
            with os.fdopen(fd, 'rb') as sentinel:
                owned = os.fstat(sentinel.fileno())
                if not stat.S_ISREG(owned.st_mode) or sentinel.read(len(payload) + 1) != payload.encode('ascii'):
                    raise RuntimeError('sentinel ownership is unproven; no deletion attempted')
            current = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if (current.st_dev, current.st_ino) != (owned.st_dev, owned.st_ino):
                raise RuntimeError('sentinel ownership changed; no deletion attempted')
            os.unlink(name, dir_fd=directory)
        print('ABX_MOUNT_CLEAN')
    else:
        raise RuntimeError('unknown verification mode')
finally:
    os.close(directory)
`;
  return `python3 -c ${shellQuote(script)} ${shellQuote(JSON.stringify({ path, name, payload, mode }))}`;
}

function prerequisites(ctx) {
  if (process.env.ABX_E2E_VOLUME_MOUNT !== '1') ctx.skip('opt-in: set ABX_E2E_VOLUME_MOUNT=1 to verify an existing writable Volume using one exclusive temporary file');
  const name = process.env.ABX_E2E_VOLUME_NAME?.trim();
  const path = process.env.ABX_E2E_VOLUME_MOUNT_PATH?.trim();
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) ctx.skip('set ABX_E2E_VOLUME_NAME to an existing Volume accessible to the configured sandbox API key; no Volume is selected automatically');
  if (!path || path.length > 512 || !/^\/mnt\/abx-e2e\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path)) ctx.skip('set ABX_E2E_VOLUME_MOUNT_PATH to a dedicated canonical path under /mnt/abx-e2e/');
  if (!ctx.creds?.ABX_SANDBOX_API_KEY || !(ctx.creds.ABX_SANDBOX_BASE_URL || ctx.creds.ABX_SANDBOX_DOMAIN)) ctx.skip('a configured sandbox API key in the existing Volume Team and its endpoint are required; no API key is created or exported');
  return { name, path };
}

async function invoke(ctx, args, label, timeoutMs = 90_000) {
  let result;
  try { result = await ctx.rawAbx(['--provider', PROVIDER, '--json', ...args], { timeoutMs }); }
  catch { throw new Error(`${label} failed; raw output and resource configuration omitted`); }
  const json = ctx.parseJsonLoose(result.stdout);
  if (result.code !== 0 || result.timedOut) throw new Error(`${label} failed (exit ${result.code}${result.timedOut ? ', timeout; remote outcome may be unknown' : ''}); raw output omitted`);
  return json;
}

async function verify(ctx, id, config, mode) {
  const json = await invoke(ctx, ['exec', id, volumeMountCommand(config.path, config.sentinel, config.payload, mode), '--timeout', '30'], `Volume ${mode}`);
  if (json?.exit_code !== 0 || json.stdout?.trim() !== MARKERS[mode]) throw new Error(`Volume ${mode} did not prove its postcondition; raw command output omitted`);
}

export default {
  id: 'volume-mount-cloud',
  title: 'Opt-in existing Volume mount and exclusive sentinel roundtrip',
  needs: ['cloud'],
  scenarios: [{
    id: 'existing-volume-roundtrip',
    title: 'create with a Volume mount, prove the kernel mount, write/read/delete only an exclusive sentinel, kill the sandbox',
    async run(ctx) {
      const selected = prerequisites(ctx);
      const config = { ...selected, sentinel: `.abx-volume-e2e-${randomUUID()}`, payload: `abx-volume-e2e-${randomUUID()}` };
      let id;
      let sentinelAttempted = false;
      let failure;
      const cleanupErrors = [];
      try {
        // No retry: an unknown create outcome must not silently create another sandbox.
        const created = await invoke(ctx, ['create', '--template', process.env.ABX_E2E_TEMPLATE || 'python-hello', '--timeout', '600', '--volume-mount', `${config.path}=${config.name}`], 'Volume-mounted sandbox create', 180_000);
        if (typeof created?.ID !== 'string' || !/^sbx-[A-Za-z0-9_-]+$/.test(created.ID)) throw new Error('create returned no usable sandbox ID; its remote outcome may be unknown and its 600-second lease must expire');
        id = created.ID;
        ctx.track(id);
        await verify(ctx, id, config, 'probe');
        sentinelAttempted = true;
        await verify(ctx, id, config, 'roundtrip');
      } catch (error) {
        failure = error;
      } finally {
        if (id) {
          if (sentinelAttempted) {
            try { await verify(ctx, id, config, 'cleanup'); }
            catch { cleanupErrors.push(`exclusive sentinel cleanup unverified (${config.sentinel})`); }
          }
          try {
            await invoke(ctx, ['kill', id, '--yes'], 'test-owned sandbox cleanup');
            await ctx.eventually(async () => {
              const result = await ctx.rawAbx(['--provider', PROVIDER, '--json', 'info', id], { timeoutMs: 60_000 });
              if (result.timedOut || result.code !== 4) throw new Error('test-owned sandbox disappearance is not yet verified');
            }, { timeoutMs: 30_000, intervalMs: 2000, what: 'the test-owned mounted sandbox to disappear' });
            ctx.untrack(id);
          } catch { cleanupErrors.push('test-owned sandbox cleanup unverified; its ID remains in the runner ledger'); }
        }
      }
      if (cleanupErrors.length) throw new Error(`${failure ? 'Volume verification failed; ' : ''}${cleanupErrors.join('; ')}. Existing Volume metadata and other storage data were not targeted.`);
      if (failure) throw failure;
    },
  }],
};

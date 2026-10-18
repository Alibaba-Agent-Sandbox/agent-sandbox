// Real CLI/file-system checks for the provider command contract; no cloud credentials.
export default {
  id: 'provider-commands-offline',
  title: 'Provider command discovery and preflight guards',
  scenarios: [
    {
      id: 'bundled-update', title: 'builtin update describes its host lifecycle without plugin or cloud access', creds: false,
      argv: ['--json', 'provider', 'update', 'alicloud-express', '--check'],
      json(j) {
        if (!Array.isArray(j) || j.length !== 1 || j[0].status !== 'bundled' || j[0].available !== null || !j[0].message?.includes('Upgrade abx')) throw new Error('bundled update did not return explicit host-upgrade guidance');
      },
    },
    {
      id: 'static-discovery', title: 'builtin management discovery works without credentials', creds: false,
      argv: ['--json', 'provider', 'command', 'list', 'alicloud-express'],
      json(j) {
        if (!Array.isArray(j) || j.length !== 20) throw new Error('expected 20 public management commands');
        if (!j.some((c) => c.id === 'volume.create') || j.some((c) => c.id.startsWith('domain.'))) throw new Error('capability declarations do not match verified APIs');
      },
    },
    {
      id: 'command-schema', title: 'volume create describes strict input before any cloud request', creds: false,
      argv: ['--json', 'provider', 'command', 'info', 'alicloud-express', 'volume.create'],
      json(j) { if (j.input_schema?.type !== 'object' || j.input_schema.additionalProperties !== false || j.effect !== 'write') throw new Error('invalid command schema'); },
    },
    {
      id: 'mutation-confirmation', title: 'deletes require explicit confirmation before backend access', creds: false,
      argv: ['--json', 'provider', 'command', 'run', 'alicloud-express', 'volume.delete', '--input', '{"team_id":"placeholder","volume_id":"placeholder"}'], exit: 2,
      output: 'E8012',
    },
    {
      id: 'input-schema-preflight', title: 'bad read parameters are rejected before credential lookup', creds: false,
      argv: ['--json', 'provider', 'command', 'run', 'alicloud-express', 'volume.list', '--input', '{"max_results":"10"}'], exit: 2,
      output: 'E8002',
    },
    {
      id: 'unverified-domain-api', title: 'unpublished domain API fails closed', creds: false,
      argv: ['--json', 'provider', 'command', 'run', 'alicloud-express', 'domain.list'], exit: 1,
      output: 'E8004',
    },
  ],
};

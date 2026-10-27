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
        if (!Array.isArray(j) || j.length !== 32) throw new Error('expected 32 public management commands');
        if (!['volume.create', 'api-key.prepare', 'api-key.resolve'].every(id => j.some(c => c.id === id)) || j.some((c) => c.id.startsWith('domain.'))) throw new Error('capability declarations do not match verified APIs');
      },
    },
    {
      id: 'selected-provider-root-help', title: 'ordinary root help summarizes the selected Provider without credentials', creds: false,
      argv: ['--help'], output: ['Provider: alicloud-express', '32 provider operations', 'abx provider --help', { not: 'additionalProperties' }],
    },
    {
      id: 'selected-provider-directory', title: 'provider help lists complete invocation paths', creds: false,
      argv: ['provider', '--help'], output: ['abx provider run volume.create', 'abx provider run volume.list', 'abx provider run sandbox.pause', 'abx --json provider command list alicloud-express'],
    },
    {
      id: 'selected-provider-run-help', title: 'isolated run help exposes the same operation directory', creds: false,
      argv: ['provider', 'run', '--help'], output: ['volume.create', 'sandbox.pause', 'Provider: alicloud-express'],
    },
    {
      id: 'selected-provider-operation-help', title: 'operation help describes schemas and confirmation before credential lookup', creds: false,
      argv: ['provider', 'run', 'volume.create', '--help'], output: ['Provider: alicloud-express', 'Effect: write', 'required', 'Input schema:', 'Output schema:', '--input-file', '--yes'],
    },
    {
      id: 'selected-provider-recovery-help', title: 'missing selected Provider preserves host repair commands', creds: false,
      argv: ['--provider', 'not-installed', 'provider', '--help'], output: ['Provider: not-installed', 'Operations unavailable', 'install', 'default'],
    },
    {
      id: 'selected-provider-no-fallback', title: 'missing selected Provider cannot execute against the builtin backend', creds: false,
      argv: ['--provider', 'not-installed', 'provider', 'run', 'volume.list'], exit: 4, output: 'E8001',
    },
    {
      id: 'selected-provider-mutation-confirmation', title: 'selected Provider mutations retain the confirmation guard', creds: false,
      argv: ['--json', 'provider', 'run', 'volume.delete', '--input', '{"team_id":"placeholder","volume_id":"placeholder"}'], exit: 2, output: 'E8012',
    },
    {
      id: 'selected-provider-input-schema', title: 'selected Provider schema errors offer the exact operation help path', creds: false,
      argv: ['--json', 'provider', 'run', 'volume.list', '--input', '{"max_results":"10"}'], exit: 2,
      output: ['E8002', 'abx --provider alicloud-express provider run volume.list --help'],
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

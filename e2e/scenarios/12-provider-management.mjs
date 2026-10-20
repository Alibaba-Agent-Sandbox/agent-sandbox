// Read actual FC management APIs. No resources are created or mutated by this suite.
export default {
  id: 'provider-management-cloud',
  title: 'FC provider management against the real control plane',
  needs: ['cloud'],
  scenarios: ['volume', 'team', 'api-key', 'quota'].flatMap((resource) => ['legacy', 'context'].map((entry) => ({
    id: `${resource}-${entry === 'legacy' ? '' : 'context-'}list`, title: `list one page of ${resource} resources through the ${entry} entry`,
    argv: entry === 'legacy'
      ? ['--json', 'provider', 'command', 'run', 'alicloud-express', `${resource}.list`]
      : ['--provider', 'alicloud-express', '--json', 'provider', 'run', `${resource}.list`],
    json(j) {
      const key = resource === 'api-key' ? 'api_keys' : `${resource}s`;
      if (!Array.isArray(j.data?.[key]) || !('request_id' in j)) throw new Error('invalid management response');
      const scan = (value) => {
        if (Array.isArray(value)) return value.forEach(scan);
        if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
          if (key === 'api_key_value' && child !== '[REDACTED]') throw new Error('API key secret was not redacted');
          scan(child);
        }
      };
      scan(j);
    },
  }))),
};

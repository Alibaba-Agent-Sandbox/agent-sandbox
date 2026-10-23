// Explicit test-account configuration for the two maintained CLI surfaces.
// Product code deliberately does not alias the standard and project namespaces.
export function configureExpressScenario(ctx) {
  for (const method of ['abx', 'rawAbx']) {
    const execute = ctx[method].bind(ctx);
    ctx[method] = (argv, options = {}) => {
      const overrides = options.creds && typeof options.creds === 'object' ? options.creds : {};
      const selected = { ...(options.creds === false ? {} : ctx.creds), ...overrides, ...options.env };
      const env = { ABX_PROVIDER: 'alicloud-express', ...options.env };
      for (const [standard, project] of [
        ['E2B_API_KEY', 'ABX_SANDBOX_API_KEY'],
        ['E2B_API_URL', 'ABX_SANDBOX_BASE_URL'],
        ['E2B_DOMAIN', 'ABX_SANDBOX_DOMAIN'],
      ]) {
        if (env[project] === undefined) {
          if (overrides[project] !== undefined) env[project] = overrides[project];
          else if (selected[standard] !== undefined) env[project] = selected[standard];
          else if (selected[project] !== undefined) env[project] = selected[project];
        }
      }
      return execute(argv, { ...options, env });
    };
  }
}

export function isExpressSandboxId(value) {
  return typeof value === 'string' && /^sbx-[A-Za-z0-9_-]+$/.test(value) && value !== 'sbx-XXXXX';
}

/** Record the unnormalised detached-create identity before any further assertion. */
export function trackDetachedCreate(ctx, result, attempt) {
  const id = result.maskedStdout.trim();
  if (isExpressSandboxId(id)) { ctx.track(id); if (attempt) ctx.resolveCreateAttempt(attempt); }
  if (result.code !== 0) ctx.fail(`create exit ${result.code}\n${result.out}`);
  if (!isExpressSandboxId(id)) ctx.fail('detached create did not return one real Express sandbox ID');
  return id;
}

/** Validate the actual project process-list contract before drawing absence conclusions. */
export function readProcessInventory(ctx, result) {
  const processes = result.rawJson();
  if (result.code === 0 && processes?.status === 'success' && processes.message === 'No processes found.') return [];
  if (result.code !== 0 || !Array.isArray(processes) || processes.some((item) => !item || typeof item !== 'object' || Array.isArray(item) || !(typeof item.pid === 'number' ? Number.isSafeInteger(item.pid) && item.pid > 0 : typeof item.pid === 'string' && item.pid.trim()))) ctx.fail('invalid process inventory; cannot infer owned process absence');
  return processes;
}

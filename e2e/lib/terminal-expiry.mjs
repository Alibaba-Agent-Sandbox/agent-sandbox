/** Test-only observation budget. The grace is an engineering limit, not a provider SLA. */
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';

export function terminalProbeBudget(deadline, now = () => performance.now()) {
  if (!(deadline - now() >= 60000)) throw Error('complete_terminal_probe_budget_required');
  return 60000;
}

/** Diagnostic I/O can fail the case, but cannot prevent release of an already owned sandbox. */
export async function releaseOwnedSandbox({id, attempted, prepareRemove, confirmAbsent,
  onRecord = () => {}, onConfirmed = () => {}}) {
  let ledgerFailure;
  function record(stage, fields) {
    try { onRecord(stage, fields); }
    catch (error) { ledgerFailure ??= error; }
  }
  if (!attempted.has(id)) {
    record('delete-intent', {sandboxId:id});
    // Compute the real remaining budget after diagnostic I/O, before marking the command attempted.
    const remove = prepareRemove();
    attempted.add(id);
    try { await remove(); }
    catch { record('delete-outcome-unconfirmed', {sandboxId:id}); }
  }
  const absent = await confirmAbsent();
  if (absent) onConfirmed();
  record('independent-typed-absence', {sandboxId:id, confirmed:absent});
  if (!absent) throw Error('owned sandbox cleanup must have independent typed absence');
  if (ledgerFailure) throw Error('owned cleanup diagnostic ledger failed', {cause:ledgerFailure});
}

export async function observeTerminalExpiry({sandboxId, read, confirmAbsent, hardDeadline,
  now = () => performance.now(), sleep = delay, onObservation = () => {}}) {
  let deadline = hardDeadline, firstEndAt, firstLeaseSeconds, attempts = 0;
  while (now() < deadline) {
    const timeoutMs = Math.floor(Math.min(15000, deadline - now()));
    if (timeoutMs <= 0) break;
    const result = await read(timeoutMs);
    const receivedAt = now();
    attempts++;
    const endAt = typeof result.body?.endAt === 'string' ? Date.parse(result.body.endAt) : NaN;
    const serverDate = typeof result.date === 'string' ? Date.parse(result.date) : NaN;
    onObservation({attempt: attempts, status: result.status,
      date: Number.isFinite(serverDate) ? result.date : null,
      endAt: Number.isFinite(endAt) ? result.body.endAt : null,
      state: typeof result.body?.state === 'string' && /^[a-z_-]{1,40}$/i.test(result.body.state) ? result.body.state : null});
    if (result.status === 404) {
      const remaining = Math.floor(Math.min(10000, deadline - now()));
      if (remaining <= 0 || !await confirmAbsent(remaining) || now() > deadline) throw Error('expiry_typed_absence_unconfirmed');
      return {attempts, firstLeaseSeconds, naturalExpiryConfirmed: true, graceSeconds: 90};
    }
    if (result.status !== 200) throw Error('expiry_http_unconfirmed');
    if (result.body?.sandboxID !== sandboxId || !Number.isFinite(endAt) || !Number.isFinite(serverDate)) {
      throw Error('expiry_native_identity_or_time_unconfirmed');
    }
    if (firstEndAt === undefined) {
      firstLeaseSeconds = Math.round((endAt - serverDate) / 1000);
      if (firstLeaseSeconds > 60) throw Error('post_terminal_lease_not_shortened');
      firstEndAt = endAt;
      // Map native wall-clock values exactly once; later reads never extend the deadline.
      deadline = Math.min(deadline, receivedAt + Math.max(0, firstLeaseSeconds) * 1000 + 90000);
    } else if (endAt > firstEndAt) throw Error('post_terminal_lease_moved_later');
    const remaining = Math.floor(deadline - now());
    if (remaining <= 0) break;
    await sleep(Math.min(1000, remaining));
  }
  throw Error('natural_expiry_observation_budget_exceeded');
}

/** Abort covers response headers and the complete bounded body, including error responses. */
export async function readNativeObservation(url, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {headers: {'X-API-Key': apiKey}, redirect: 'error', signal: controller.signal});
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body ?? []) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) throw Error('expiry_response_exceeded');
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { body = null; }
    return {status: response.status, date: response.headers.get('date'), body};
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}

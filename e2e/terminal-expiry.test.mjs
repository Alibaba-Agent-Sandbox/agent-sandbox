import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import {observeTerminalExpiry, readNativeObservation, terminalProbeBudget, releaseOwnedSandbox} from './lib/terminal-expiry.mjs';

function clockFixture({latency = 0, expires = Infinity, hardDeadline = 210000, mutate} = {}) {
  let time = 0, reads = 0, confirms = 0;
  const timeouts = [];
  return {
    state: () => ({time, reads, confirms, timeouts}),
    options: {sandboxId:'test-owned', now:() => time, sleep:async ms => {time += ms;}, hardDeadline,
      read:async timeoutMs => {
        timeouts.push({at:time, timeoutMs});
        time += Math.min(latency, timeoutMs);
        reads++;
        const value = {status:time >= expires ? 404 : 200, date:new Date(time).toUTCString(),
          body:{sandboxID:'test-owned', endAt:new Date(60000).toISOString(), state:'running'}};
        return mutate ? mutate(value, reads) : value;
      },
      confirmAbsent:async () => {confirms++; return true;},
    },
  };
}

test('fast and slow transports both observe expiry after the valid lease within one frozen wall-clock budget', async () => {
  for (const latency of [0, 1000]) {
    const fixture = clockFixture({latency, expires:120000});
    const result = await observeTerminalExpiry(fixture.options);
    assert.equal(result.naturalExpiryConfirmed, true);
    assert.equal(result.graceSeconds, 90);
    assert.ok(fixture.state().time >= 120000 && fixture.state().time <= 121000);
    assert.equal(fixture.state().confirms, 1);
    // A count-based 90-read limit would fail the fast path before expiry.
    if (latency === 0) assert.ok(result.attempts > 90);
  }
});

test('persistent HTTP 200 fails at the same deadline for fast and slow transports without rebasing', async () => {
  for (const latency of [0, 1000]) {
    const fixture = clockFixture({latency});
    await assert.rejects(observeTerminalExpiry(fixture.options), /natural_expiry_observation_budget_exceeded/);
    assert.equal(fixture.state().time, 150000);
    assert.equal(fixture.state().confirms, 0);
    assert.ok(fixture.state().timeouts.every(x => x.timeoutMs <= Math.min(15000, (x.at ? 150000 : 210000) - x.at)));
  }
});

test('a later native endAt fails immediately instead of extending the deadline', async () => {
  const fixture = clockFixture({mutate:(value, read) => read === 2
    ? {...value, body:{...value.body, endAt:new Date(61000).toISOString()}} : value});
  await assert.rejects(observeTerminalExpiry(fixture.options), /post_terminal_lease_moved_later/);
  assert.equal(fixture.state().reads, 2);
});

test('recording observations consumes the frozen budget instead of adding time to it', async () => {
  let time = 0;
  await assert.rejects(observeTerminalExpiry({sandboxId:'test-owned', now:() => time, hardDeadline:210000,
    sleep:async ms => {time += ms;}, onObservation:() => {time += 1000;},
    read:async () => ({status:200, date:new Date(time).toUTCString(),
      body:{sandboxID:'test-owned', endAt:new Date(60000).toISOString()}})}), /budget_exceeded/);
  assert.equal(time, 150000);
});

test('a lease above sixty seconds, wrong identity or invalid native times cannot pass', async () => {
  for (const mutate of [value => ({...value, body:{...value.body, endAt:new Date(61000).toISOString()}}),
    value => ({...value, body:{...value.body, sandboxID:'different'}}),
    value => ({...value, date:'invalid'}), value => ({...value, body:{...value.body, endAt:'invalid'}})]) {
    const fixture = clockFixture({mutate});
    await assert.rejects(observeTerminalExpiry(fixture.options));
    assert.equal(fixture.state().reads, 1);
  }
});

test('HTTP 401, 403, 500 and transport failure are fatal without retries', async () => {
  for (const status of [401, 403, 500]) {
    const fixture = clockFixture({mutate:value => ({...value, status})});
    await assert.rejects(observeTerminalExpiry(fixture.options), /expiry_http_unconfirmed/);
    assert.equal(fixture.state().reads, 1);
  }
  let reads = 0;
  await assert.rejects(observeTerminalExpiry({sandboxId:'test-owned', hardDeadline:150000,
    now:() => 0, read:async () => {reads++; throw Error('transport_failed');}}), /transport_failed/);
  assert.equal(reads, 1);
});

test('404 alone and a typed confirmation after the deadline cannot pass', async () => {
  const fixture = clockFixture({expires:0});
  await assert.rejects(observeTerminalExpiry({...fixture.options, confirmAbsent:async () => false}), /typed_absence_unconfirmed/);
  let time = 0;
  await assert.rejects(observeTerminalExpiry({sandboxId:'test-owned', hardDeadline:10, now:() => time,
    read:async () => ({status:404}), confirmAbsent:async () => {time = 11; return true;}}), /typed_absence_unconfirmed/);
});

test('the outer cleanup reserve clamps requests, delays and the final deadline', async () => {
  const fixture = clockFixture({latency:3000, hardDeadline:20000});
  await assert.rejects(observeTerminalExpiry(fixture.options), /natural_expiry_observation_budget_exceeded/);
  assert.equal(fixture.state().time, 20000);
  assert.ok(fixture.state().timeouts.every(x => x.timeoutMs <= 20000 - x.at));
});

test('a PTY is never started without its complete sixty-second parent budget', () => {
  assert.equal(terminalProbeBudget(60000, () => 0), 60000);
  assert.throws(() => terminalProbeBudget(59999, () => 0), /complete_terminal_probe_budget_required/);
});

test('a failed diagnostic write still kills once, confirms absence and clears ownership before failing the case', async () => {
  let kills = 0, clears = 0, confirms = 0;
  const attempted = new Set();
  await assert.rejects(releaseOwnedSandbox({id:'test-owned', attempted,
    onRecord:() => {throw Error('EIO');}, prepareRemove:() => async () => {kills++;},
    confirmAbsent:async () => {confirms++; return true;}, onConfirmed:() => {clears++;}}), /diagnostic ledger failed/);
  assert.equal(kills, 1);
  assert.equal(confirms, 1);
  assert.equal(clears, 1);
  assert.equal(attempted.has('test-owned'), true);
});

test('an unknown kill is never replayed by the later finally cleanup', async () => {
  let kills = 0, absent = false;
  const options = {id:'test-owned', attempted:new Set(),
    prepareRemove:() => async () => {kills++; throw Error('unknown');}, confirmAbsent:async () => absent};
  await assert.rejects(releaseOwnedSandbox(options), /independent typed absence/);
  absent = true;
  await releaseOwnedSandbox(options);
  assert.equal(kills, 1);
});

test('diagnostic latency is charged before removal admission, and insufficient budget never marks a kill attempted', async () => {
  const attempted = new Set();
  let time = 0, kills = 0;
  await assert.rejects(releaseOwnedSandbox({id:'test-owned', attempted,
    onRecord:() => {time += 30;}, prepareRemove:() => {
      assert.ok(time < 25, 'cleanup_budget_exhausted');
      return async () => {kills++;};
    }, confirmAbsent:async () => true}), /cleanup_budget_exhausted/);
  assert.equal(kills, 0);
  assert.equal(attempted.size, 0);
});

test('real HTTP response-body reads abort at the supplied budget', async () => {
  let served = false;
  const server = http.createServer((_request, response) => {
    served = true;
    response.writeHead(200, {'content-type':'application/json'});
    response.write('{');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(readNativeObservation(`http://127.0.0.1:${server.address().port}/`, 'test-existing-key', 200));
    assert.equal(served, true, 'the real response must have started before the body timeout');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

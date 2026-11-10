import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeApplicationProfile } from './normalize.mjs';
const catalog = JSON.parse(readFileSync(new URL('./profiles.json', import.meta.url)));
const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)));
for (const fixture of fixtures) {
  const original = structuredClone(fixture.input);
  if (fixture.error) assert.throws(() => normalizeApplicationProfile(original, catalog), /Unsupported application deployment profile/);
  else {
    const actual = normalizeApplicationProfile(original, catalog);
    assert.deepEqual(actual, fixture.expected, fixture.name);
    assert.deepEqual(normalizeApplicationProfile(actual, catalog), actual, `${fixture.name} idempotence`);
  }
  assert.deepEqual(original, fixture.input, `${fixture.name} mutation`);
}
console.log(`${fixtures.length} shared profile fixtures passed`);

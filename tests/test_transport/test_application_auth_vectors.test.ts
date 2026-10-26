import fs from 'node:fs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {applicationHttpSeams, requestApplication} from '../../src/transport/application_http.js';
const vectors = JSON.parse(fs.readFileSync(new URL('../fixtures/application-auth-vectors.json', import.meta.url), 'utf8')) as {
  cases: Array<{id: string; token?: string; headers: Record<string,string>; expected: Record<string,string>}>;
};
afterEach(() => vi.restoreAllMocks());
describe('shared application authentication', () => {
  it.each(vectors.cases)('$id', async vector => {
    const fetch = vi.spyOn(applicationHttpSeams, 'fetch').mockResolvedValue(new Response('{}'));
    await requestApplication({url:'https://example.invalid/owned', headers:vector.headers, sandbox_id:'owned', provider_id:'alicloud-express', port:9000,
      authentication_audience:'gateway', path_mode:'prefix'}, '/health', {method:'GET', application_token:vector.token});
    const headers = fetch.mock.calls[0]![1]!.headers as Record<string,string>;
    expect(Object.fromEntries(Object.entries(headers).map(([key,value]) => [key.toLowerCase(),value]))).toEqual(vector.expected);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

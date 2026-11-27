import { afterEach, expect, it, vi } from 'vitest';
import { fetchComponentMatch, fetchPackageDigest } from '../../packages/component-cli/src/integration/registry.js';

afterEach(() => vi.unstubAllGlobals());

it('permits non-loopback HTTP for CLI API and registry reads while keeping credentials separate', async () => {
  const requests: { url: string; authorization: string | null; redirect: string | undefined }[] = [];
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    requests.push({ url, authorization: new Headers(options.headers).get('authorization'), redirect: options.redirect });
    return new Response('{}', { status: url.startsWith('http://api.company.test/') ? 200 : 503 });
  });
  const endpoints = { apiUrl: 'http://api.company.test', registryUrl: 'http://registry.company.test' };
  const credentials = { apiToken: 'api-token', registryToken: 'registry-token' };
  expect(await fetchComponentMatch(endpoints, credentials, {})).toEqual({ ok: true, body: {} });
  expect(await fetchPackageDigest(endpoints, credentials, '@company/example', '1.0.0')).toMatchObject({ ok: false, code: 'REGISTRY_UNAVAILABLE' });
  expect(requests).toEqual([
    { url: 'http://api.company.test/v1/matching/components', authorization: 'Bearer api-token', redirect: 'manual' },
    { url: 'http://registry.company.test/@company/example', authorization: 'Bearer registry-token', redirect: 'manual' },
  ]);
});

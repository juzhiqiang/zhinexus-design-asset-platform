import { describe, expect, it } from 'vitest';
import {
  fetchMyComponents,
  fetchMyVariantRelease,
  fetchMyVariantReports,
  fetchMyVariantArtifactText,
} from '../../apps/gallery/app/lib/library-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('authenticated /v1/me library client', () => {
  it('fetches /v1/me/components with no-store and cookie credentials for session tokens', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seen.push({ url, init });
      return jsonResponse({
        items: [{
          componentId: 'line',
          variants: [{
            variantReleaseId: 'rel-line-vue',
            variantId: 'line-vue',
            framework: 'vue',
            packageName: '@company/charts-vue',
            packageVersion: '0.0.12',
          }],
        }],
        page: 1,
        pageSize: 100,
        total: 1,
      });
    };

    const result = await fetchMyComponents({ token: '__session__' }, { apiUrl: 'http://api.test', fetcher });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.items).toHaveLength(1);
    }
    expect(seen[0]!.url).toContain('/v1/me/components');
    expect(seen[0]!.init?.cache).toBe('no-store');
    expect(seen[0]!.init?.credentials).toBe('include');
  });

  it('classifies 401 and 403 as unauthorized/forbidden so UI clears private state', async () => {
    const res401 = await fetchMyComponents(
      { token: 'bearer-tok' },
      { apiUrl: 'http://api.test', fetcher: async () => jsonResponse({ code: 'UNAUTHENTICATED' }, 401) },
    );
    expect(res401.status).toBe('unauthenticated');

    const res403 = await fetchMyVariantRelease(
      'rel-secret',
      { token: 'bearer-tok' },
      { apiUrl: 'http://api.test', fetcher: async () => jsonResponse({ code: 'FORBIDDEN' }, 403) },
    );
    expect(res403.status).toBe('forbidden');
  });

  it('fetches /v1/me/variant-releases/:id/reports and artifacts with bearer token and omit credentials', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seen.push({ url, init });
      if (url.endsWith('/reports')) {
        return jsonResponse({ variantReleaseId: 'rel-1', reports: [] });
      }
      return new Response('# LineChart Docs', { status: 200, headers: { 'content-type': 'text/markdown' } });
    };

    const reports = await fetchMyVariantReports('rel-1', { token: 'jwt-abc' }, { apiUrl: 'http://api.test', fetcher });
    expect(reports.status).toBe('ok');
    expect(seen[0]!.init?.credentials).toBe('omit');
    expect((seen[0]!.init?.headers as Record<string, string>)?.authorization).toBe('Bearer jwt-abc');

    const artifact = await fetchMyVariantArtifactText('rel-1', 'docs/line.md', { token: 'jwt-abc' }, { apiUrl: 'http://api.test', fetcher });
    expect(artifact.status).toBe('ok');
    if (artifact.status === 'ok') {
      expect(artifact.data).toBe('# LineChart Docs');
    }
    expect(seen[1]!.url).toBe('http://api.test/v1/me/variant-releases/rel-1/artifacts?path=docs%2Fline.md');
  });
});

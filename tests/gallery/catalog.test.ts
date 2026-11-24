import { describe, expect, it } from 'vitest';
import { getCatalogComponents, getComponentDetail } from '../../apps/gallery/app/lib/catalog.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeVariantRelease(overrides: Partial<{
  variantReleaseId: string;
  componentId: string;
  variantId: string;
  framework: 'vue' | 'react';
  packageName: string;
  packageVersion: string;
  availability: 'Ready' | 'DEPRECATED';
  reportSource: 'local-automatic' | 'manual-upload' | 'none';
  baselineStatus: 'unconfirmed' | 'accepted' | 'incompatible';
  indexStatus: 'pending' | 'indexed' | 'failed';
}> = {}) {
  const framework = overrides.framework ?? 'vue';
  const componentId = overrides.componentId ?? 'line';
  const variantId = overrides.variantId ?? `${componentId}-${framework}`;
  const packageName = overrides.packageName ?? (framework === 'vue' ? '@company/charts-vue' : '@company/charts-react');
  const packageVersion = overrides.packageVersion ?? '1.2.3';
  const variantReleaseId = overrides.variantReleaseId ?? `rel-${variantId}`;
  const sha = 'a'.repeat(64);

  const artifact = (path: string) => ({ path, sha256: sha, bytes: 10 });

  return {
    variantReleaseId,
    availability: overrides.availability ?? 'Ready',
    reportSource: overrides.reportSource ?? 'manual-upload',
    baselineStatus: overrides.baselineStatus ?? 'unconfirmed',
    indexStatus: overrides.indexStatus ?? 'pending',
    variant: {
      variantId,
      componentId,
      framework,
      packageName,
      packageVersion,
      exportName: componentId === 'line' ? 'LineChart' : 'CustomGaugeChart',
      exportPath: `./${componentId}`,
      docs: artifact(`docs/${componentId}.md`),
      api: artifact(`api/${componentId}.json`),
      examples: [{
        id: `${variantId}-default`,
        previewEntry: `preview/${variantId}/index.html`,
        previewFiles: [artifact(`preview/${variantId}/index.html`)],
        fixtureDigest: sha,
        renderer: 'canvas',
        theme: 'light',
        width: 800,
        height: 400,
        requiredStates: ['default'],
      }],
      screenshots: [],
      compatibility: [],
    },
    package: {
      name: packageName,
      version: packageVersion,
      tarball: artifact(`packages/${variantId}.tgz`),
      sourceDigest: sha,
      dependencies: {},
      peerDependencies: framework === 'vue' ? { vue: '3.5.45', echarts: '6.1.0' } : { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
    },
  };
}

describe('public catalog real API source of truth', () => {
  it('returns empty array on empty API or failure without fabricating preset Ready assets', async () => {
    const emptyFetcher: typeof fetch = async () => jsonResponse({ items: [], page: 1, pageSize: 20, total: 0 });
    expect(await getCatalogComponents({ apiUrl: 'http://api.test', fetcher: emptyFetcher })).toEqual([]);

    const errorFetcher: typeof fetch = async () => jsonResponse({ code: 'INFRA_UNAVAILABLE' }, 503);
    expect(await getCatalogComponents({ apiUrl: 'http://api.test', fetcher: errorFetcher })).toEqual([]);

    const throwFetcher: typeof fetch = async () => { throw new Error('ECONNREFUSED'); };
    expect(await getCatalogComponents({ apiUrl: 'http://api.test', fetcher: throwFetcher })).toEqual([]);
  });

  it('returns null for /components/line when public API has no published asset (no static bypass)', async () => {
    const emptyFetcher: typeof fetch = async () => jsonResponse({ items: [], page: 1, pageSize: 20, total: 0 });
    expect(await getComponentDetail('line', { apiUrl: 'http://api.test', fetcher: emptyFetcher })).toBeNull();

    const failFetcher: typeof fetch = async () => { throw new Error('ECONNREFUSED'); };
    expect(await getComponentDetail('line', { apiUrl: 'http://api.test', fetcher: failFetcher })).toBeNull();
  });

  it('uses real API version and statuses while only enhancing display fields from static metadata', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/v1/components')) {
        return jsonResponse({
          items: [{
            componentId: 'line',
            variants: [{
              variantReleaseId: 'rel-line-vue',
              variantId: 'line-vue',
              framework: 'vue',
              packageName: '@company/charts-vue',
              packageVersion: '1.2.3',
            }],
          }],
          page: 1,
          pageSize: 20,
          total: 1,
        });
      }
      if (url.endsWith('/v1/variant-releases/rel-line-vue')) {
        return jsonResponse(makeVariantRelease({
          variantReleaseId: 'rel-line-vue',
          componentId: 'line',
          variantId: 'line-vue',
          framework: 'vue',
          packageVersion: '1.2.3',
          availability: 'Ready',
          reportSource: 'manual-upload',
          baselineStatus: 'unconfirmed',
          indexStatus: 'pending',
        }));
      }
      return jsonResponse({}, 404);
    };

    const detail = await getComponentDetail('line', { apiUrl: 'http://api.test', fetcher });
    expect(detail).not.toBeNull();
    // Display fields enhanced from static metadata
    expect(detail!.chineseName).toBe('折线图');
    expect(detail!.name).toBe('LineChart');
    expect(detail!.variants).toHaveLength(1);
    // Real API version and statuses preserved — NEVER overridden with local-automatic/accepted/0.0.4
    const variant = detail!.variants[0]!;
    expect(variant.variantReleaseId).toBe('rel-line-vue');
    expect(variant.packageVersion).toBe('1.2.3');
    expect(variant.availability).toBe('Ready');
    expect(variant.reportSource).toBe('manual-upload');
    expect(variant.baselineStatus).toBe('unconfirmed');
    expect(variant.indexStatus).toBe('pending');
  });

  it('supports public components without static display enhancements', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/v1/components')) {
        return jsonResponse({
          items: [{
            componentId: 'custom-gauge',
            variants: [{
              variantReleaseId: 'rel-custom-gauge-react',
              variantId: 'custom-gauge-react',
              framework: 'react',
              packageName: '@company/charts-react',
              packageVersion: '2.0.0',
            }],
          }],
          page: 1,
          pageSize: 20,
          total: 1,
        });
      }
      if (url.endsWith('/v1/variant-releases/rel-custom-gauge-react')) {
        return jsonResponse(makeVariantRelease({
          variantReleaseId: 'rel-custom-gauge-react',
          componentId: 'custom-gauge',
          variantId: 'custom-gauge-react',
          framework: 'react',
          packageVersion: '2.0.0',
          availability: 'Ready',
          reportSource: 'none',
          baselineStatus: 'unconfirmed',
          indexStatus: 'indexed',
        }));
      }
      return jsonResponse({}, 404);
    };

    const detail = await getComponentDetail('custom-gauge', { apiUrl: 'http://api.test', fetcher });
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe('custom-gauge');
    expect(detail!.variants).toHaveLength(1);
    expect(detail!.variants[0]!.packageVersion).toBe('2.0.0');
    expect(detail!.variants[0]!.reportSource).toBe('none');
  });
});

import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ApiMessages, ScreenshotRef } from '@company/contracts';
import type { ComponentCatalogItem } from '../../apps/gallery/app/lib/types.js';
import { getCatalogComponents } from '../../apps/gallery/app/lib/catalog.js';
import { catalogFixture, releaseFixture } from './echarts-compatibility-fixtures.js';

// The gallery uses Next's bundler resolution; the root check uses NodeNext.
const viewerModule = '../../apps/gallery/app/(public)/components/CatalogViewer.js';
const { CatalogViewer } = await import(viewerModule) as {
  CatalogViewer: ComponentType<{ initialItems: ComponentCatalogItem[] }>;
};

function withScreenshots() {
  const detail = releaseFixture();
  const shot = (state: string): ScreenshotRef => ({
    id: `shot-${state}`, variantId: detail.variant.variantId, framework: 'vue',
    packageVersion: detail.package.version, packageSha256: detail.package.tarball.sha256,
    exampleId: detail.variant.examples[0]!.id, state, source: 'manual-upload',
    environmentKey: 'unknown-manual',
    image: { path: `screenshots/line-vue-${state}.png`, bytes: 10, sha256: 'b'.repeat(64) },
  });
  detail.variant.examples[0]!.requiredStates = ['empty', 'default'];
  detail.variant.screenshots = [shot('empty'), shot('default')];
  return detail;
}

function source(detail: ApiMessages['variantReleaseResponse'] | null) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, init });
    return Response.json(url.pathname === '/v1/components' ? catalogFixture() : detail ?? {}, { status: url.pathname === '/v1/components' || detail ? 200 : 404 });
  };
  return { fetcher, calls };
}

describe('published public catalog thumbnails', () => {
  it('shows the screenshot version when the default framework has no image', async () => {
    const react = releaseFixture('react');
    react.package.version = react.variant.packageVersion = '1.0.0';
    const vue = withScreenshots();
    vue.package.version = vue.variant.packageVersion = '2.0.0';
    for (const shot of vue.variant.screenshots) shot.packageVersion = '2.0.0';
    const catalog = catalogFixture('react');
    catalog.items[0]!.variants = [react, vue].map((detail) => ({
      variantReleaseId: detail.variantReleaseId, variantId: detail.variant.variantId,
      framework: detail.variant.framework, packageName: detail.package.name, packageVersion: detail.package.version,
    }));
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      return Response.json(url.endsWith('/v1/components') ? catalog : url.endsWith('release-vue') ? vue : react);
    };
    const items = await getCatalogComponents({ apiUrl: 'http://api.test', fetcher });
    const html = renderToStaticMarkup(createElement(CatalogViewer, { initialItems: items }));
    expect(html).toContain('screenshots%2Fline-vue-default.png');
    expect(html).toContain('class="card-version">v2.0.0');
  });

  it('renders the matching published default screenshot through the public artifact endpoint', async () => {
    const { fetcher, calls } = source(withScreenshots());
    const items = await getCatalogComponents({ apiUrl: 'http://api.test/', fetcher });
    expect(items[0]!.defaultVariant.thumbnail).toEqual({
      url: 'http://api.test/v1/variant-releases/release-vue/artifacts?path=screenshots%2Fline-vue-default.png',
      width: 800, height: 400,
    });
    const html = renderToStaticMarkup(createElement(CatalogViewer, { initialItems: items }));
    expect(html).toContain('<img');
    expect(html).toContain('screenshots%2Fline-vue-default.png');
    expect(html).toContain('alt="折线图（Vue 3）预览图"');
    expect(html).toContain('loading="lazy"');
    for (const call of calls) {
      expect(call.init?.credentials).toBe('omit');
      expect(new Headers(call.init?.headers).has('authorization')).toBe(false);
    }
  });

  it.each(['missing', 'release', 'framework', 'version', 'digest', 'example'] as const)(
    'keeps the catalog card without exposing a mismatched or %s screenshot', async (reason) => {
      const detail = withScreenshots();
      if (reason === 'release') detail.variantReleaseId = 'other-release';
      for (const shot of detail.variant.screenshots) {
        if (reason === 'framework') shot.framework = 'react';
        if (reason === 'version') shot.packageVersion = '9.0.0';
        if (reason === 'digest') shot.packageSha256 = 'c'.repeat(64);
        if (reason === 'example') shot.exampleId = 'other-example';
      }
      const { fetcher } = source(reason === 'missing' ? null : detail);
      const items = await getCatalogComponents({ apiUrl: 'http://api.test', fetcher });
      expect(items).toHaveLength(1);
      expect(items[0]!.defaultVariant.thumbnail).toBeUndefined();
      expect(renderToStaticMarkup(createElement(CatalogViewer, { initialItems: items }))).not.toContain('<img');
    },
  );
});

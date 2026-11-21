import { describe, expect, it, vi } from 'vitest';
import { fetchMeasuredCompatibility, discoverOfficialEcharts, OFFICIAL_ECHARTS_SOURCE } from '../../apps/gallery/app/lib/echarts-compatibility.js';
import { catalogFixture, compatibilityFixture, officialFixture, releaseFixture } from './echarts-compatibility-fixtures.js';

function fetchSequence(...bodies: unknown[]) {
  return vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(bodies.shift()), { status: 200 }));
}

describe('official ECharts discovery', () => {
  it('reads the fixed official source with no credentials, cache or redirects', async () => {
    const fetcher = fetchSequence(officialFixture());
    const result = await discoverOfficialEcharts({ fetcher });
    expect(result).toMatchObject({ version: '6.2.0', source: OFFICIAL_ECHARTS_SOURCE });
    expect(Number.isFinite(Date.parse(result.checkedAt))).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(OFFICIAL_ECHARTS_SOURCE, expect.objectContaining({ credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }));
  });

  it.each([
    { ...officialFixture(), name: 'another-package' },
    officialFixture('^6.2.0'), officialFixture('6.2.0-rc.1'),
    { ...officialFixture(), dist: { integrity: 'unknown', tarball: 'https://registry.npmjs.org/echarts/-/echarts-6.2.0.tgz' } },
    { ...officialFixture(), dist: { integrity: officialFixture().dist.integrity, tarball: 'https://mirror.example/echarts.tgz' } },
  ])('rejects invalid official metadata without an accepted fallback (%j)', async (metadata) => {
    await expect(discoverOfficialEcharts({ fetcher: fetchSequence(metadata) })).rejects.toThrow();
  });

  it('reports upstream failure instead of supplying a hardcoded version', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('unavailable', { status: 503 }));
    await expect(discoverOfficialEcharts({ fetcher })).rejects.toThrow();
  });
});

describe('measured ECharts support', () => {
  it('uses the actual catalog release, binds package identity and keeps measured versions separate from discovery', async () => {
    const fetcher = fetchSequence(catalogFixture(), releaseFixture(), compatibilityFixture());
    const result = await fetchMeasuredCompatibility('line', 'vue', { apiOrigin: 'http://127.0.0.1:3000', fetcher });
    expect(result).toMatchObject({ kind: 'published', packageVersion: '0.0.12', records: [{ echartsVersion: '6.1.0', frameworkVersion: '3.5.45', compatibilityId: 'accepted-vue' }] });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'http://127.0.0.1:3000/v1/components?framework=vue&query=line&pageSize=100',
      'http://127.0.0.1:3000/v1/variant-releases/release-vue',
      'http://127.0.0.1:3000/v1/variant-releases/release-vue/compatibility',
    ]);
    for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error' });
  });

  it('does not invent measured support for unpublished implementations', async () => {
    const fetcher = fetchSequence({ items: [], page: 1, pageSize: 100, total: 0 });
    expect(await fetchMeasuredCompatibility('line', 'react', { fetcher })).toEqual({ kind: 'unpublished' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps a published release with no accepted record explicitly empty', async () => {
    const fetcher = fetchSequence(catalogFixture(), releaseFixture(), { variantReleaseId: 'release-vue', items: [] });
    expect(await fetchMeasuredCompatibility('line', 'vue', { fetcher })).toMatchObject({ kind: 'published', records: [] });
  });

  it('does not substitute a substring match or another framework', async () => {
    const catalog = catalogFixture('react');
    catalog.items[0]!.componentId = 'line-other';
    expect(await fetchMeasuredCompatibility('line', 'vue', { fetcher: fetchSequence(catalog) })).toEqual({ kind: 'unpublished' });
  });

  it('rejects ambiguous or incomplete catalog responses', async () => {
    const ambiguous = catalogFixture();
    ambiguous.items[0]!.variants.push(ambiguous.items[0]!.variants[0]!);
    for (const catalog of [ambiguous, { ...catalogFixture(), total: 101 }, { items: [] }]) {
      await expect(fetchMeasuredCompatibility('line', 'vue', { fetcher: fetchSequence(catalog) })).rejects.toThrow();
    }
  });

  it.each(['variantReleaseId', 'variantId', 'componentId', 'framework', 'packageName', 'packageVersion', 'package']) ('rejects release identity drift in %s', async (field) => {
    const release = releaseFixture();
    if (field === 'variantReleaseId') release.variantReleaseId = 'another-release';
    else if (field === 'package') release.package.version = '0.0.13';
    else (release.variant as unknown as Record<string, unknown>)[field] = field === 'framework' ? 'react' : field === 'packageVersion' ? '0.0.13' : 'another';
    await expect(fetchMeasuredCompatibility('line', 'vue', { fetcher: fetchSequence(catalogFixture(), release) })).rejects.toThrow();
  });

  it.each([
    ['variantReleaseId', 'another-release'], ['packageName', 'another-package'], ['packageVersion', '0.0.13'],
    ['packageSha256', 'c'.repeat(64)], ['framework', 'react'], ['frameworkVersion', '^3.5.45'], ['echartsVersion', '^6.1.0'],
  ])('rejects a mismatched accepted record in %s', async (field, value) => {
    const compatibility = compatibilityFixture();
    (compatibility.items[0] as unknown as Record<string, unknown>)[field] = value;
    await expect(fetchMeasuredCompatibility('line', 'vue', { fetcher: fetchSequence(catalogFixture(), releaseFixture(), compatibility) })).rejects.toThrow();
  });

  it('rejects a response for another release and duplicate records', async () => {
    const duplicate = compatibilityFixture();
    duplicate.items.push(duplicate.items[0]!);
    for (const compatibility of [{ ...compatibilityFixture(), variantReleaseId: 'another-release' }, duplicate]) {
      await expect(fetchMeasuredCompatibility('line', 'vue', { fetcher: fetchSequence(catalogFixture(), releaseFixture(), compatibility) })).rejects.toThrow();
    }
  });

  it('propagates cancellation to public requests', async () => {
    const controller = new AbortController();
    const fetcher = fetchSequence(catalogFixture(), releaseFixture(), compatibilityFixture());
    await fetchMeasuredCompatibility('line', 'vue', { fetcher, signal: controller.signal });
    const signal = fetcher.mock.calls[0]![1]!.signal!;
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});

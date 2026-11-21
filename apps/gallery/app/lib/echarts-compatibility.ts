import { validateApiMessage, type AcceptedCompatibilityRecord, type Framework } from '@company/contracts';

export const OFFICIAL_ECHARTS_SOURCE = 'https://registry.npmjs.org/echarts/latest';
const API_ORIGIN = process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000';
const REQUEST_TIMEOUT_MS = 8000;

type RequestOptions = { fetcher?: typeof fetch; signal?: AbortSignal };
export type OfficialEchartsDiscovery = { version: string; integrity: string; source: string; checkedAt: string };
export type MeasuredCompatibility =
  | { kind: 'unpublished' }
  | { kind: 'published'; variantReleaseId: string; packageName: string; packageVersion: string; records: AcceptedCompatibilityRecord[] };

async function readJson(url: string, { fetcher = fetch, signal }: RequestOptions): Promise<unknown> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetcher(url, {
    credentials: 'omit', cache: 'no-store', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Compatibility source unavailable');
  return response.json();
}

/** Official discovery is metadata only; it never creates accepted compatibility. */
export async function discoverOfficialEcharts(options: RequestOptions = {}): Promise<OfficialEchartsDiscovery> {
  const input = await readJson(OFFICIAL_ECHARTS_SOURCE, options);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid official metadata');
  const metadata = input as { name?: unknown; version?: unknown; dist?: { integrity?: unknown; tarball?: unknown } };
  const version = metadata.version;
  if (metadata.name !== 'echarts' || typeof version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) ||
    typeof metadata.dist?.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(metadata.dist.integrity) ||
    metadata.dist.tarball !== `https://registry.npmjs.org/echarts/-/echarts-${version}.tgz`) throw new Error('Invalid official metadata');
  return { version, integrity: metadata.dist.integrity, source: OFFICIAL_ECHARTS_SOURCE, checkedAt: new Date().toISOString() };
}

/** Bind accepted records to the real public release instead of the static gallery examples. */
export async function fetchMeasuredCompatibility(componentId: string, framework: Framework, options: RequestOptions & { apiOrigin?: string } = {}): Promise<MeasuredCompatibility> {
  const apiOrigin = (options.apiOrigin ?? API_ORIGIN).replace(/\/$/, '');
  const query = new URLSearchParams({ framework, query: componentId, pageSize: '100' });
  const catalog = validateApiMessage('componentsResponse', await readJson(`${apiOrigin}/v1/components?${query}`, options));
  if (!catalog.ok || catalog.value.page !== 1 || catalog.value.total > catalog.value.items.length) throw new Error('Invalid or incomplete public catalog');
  const matches = catalog.value.items.filter(item => item.componentId === componentId)
    .flatMap(item => item.variants.filter(variant => variant.framework === framework));
  if (matches.length > 1) throw new Error('Ambiguous public implementation');
  const summary = matches[0];
  if (!summary) return { kind: 'unpublished' };

  const releaseUrl = `${apiOrigin}/v1/variant-releases/${encodeURIComponent(summary.variantReleaseId)}`;
  const detail = validateApiMessage('variantReleaseResponse', await readJson(releaseUrl, options));
  if (!detail.ok) throw new Error('Invalid release response');
  const { variant, package: pkg, variantReleaseId } = detail.value;
  if (variantReleaseId !== summary.variantReleaseId || variant.componentId !== componentId ||
    variant.variantId !== summary.variantId || variant.framework !== framework ||
    variant.packageName !== summary.packageName || variant.packageVersion !== summary.packageVersion ||
    pkg.name !== summary.packageName || pkg.version !== summary.packageVersion) throw new Error('Release identity mismatch');

  const compatibility = validateApiMessage('variantCompatibilityResponse', await readJson(`${releaseUrl}/compatibility`, options));
  if (!compatibility.ok || compatibility.value.variantReleaseId !== variantReleaseId) throw new Error('Invalid compatibility response');
  const recordIds = new Set<string>();
  for (const record of compatibility.value.items) {
    if (record.variantReleaseId !== variantReleaseId || record.packageName !== pkg.name ||
      record.packageVersion !== pkg.version || record.packageSha256 !== pkg.tarball.sha256 ||
      record.framework !== framework || recordIds.has(record.compatibilityId)) throw new Error('Compatibility identity mismatch');
    recordIds.add(record.compatibilityId);
  }
  return { kind: 'published', variantReleaseId, packageName: pkg.name, packageVersion: pkg.version, records: compatibility.value.items };
}

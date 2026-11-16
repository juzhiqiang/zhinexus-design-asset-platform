import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  validateReleaseBundle, validateComponentMatchResponse, validateMatchPlan,
  type ComponentMatchQueryV1, type MatchPlanRequest, type ReleaseManifestV1,
} from '@company/contracts';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { platformHarness, grant, upload, release } from '../platform/http-support.js';
import { realRegistry } from '../platform/t06-support.js';
import { expectedSdkComponents, verifyFrozenBundleFiles } from '../fixtures/component-query-sdk.js';
import { loadReleaseBundle } from '../../packages/component-cli/src/local/manifest.js';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bundleDir = process.env.A10_FROZEN_BUNDLE;
if (!bundleDir) throw new Error('P4 requires A10_FROZEN_BUNDLE pointing to the accepted frozen SDK bundle');

describe('冻结 SDK → 真实发布 → GET → POST 身份验收', () => {
  let h: Awaited<ReturnType<typeof platformHarness>> | undefined;
  let manifest: ReleaseManifestV1;
  let files: Map<string, Uint8Array>;
  let auth: string;
  let beforeSha: string;
  let ids: Map<string, string>;

  beforeAll(async () => {
    const raw = await readFile(join(bundleDir, 'manifest.json'));
    beforeSha = digest(raw);
    const loaded = await loadReleaseBundle(bundleDir);
    files = loaded.filesMap;
    const bundleCheck = await validateReleaseBundle(loaded.manifest, files);
    if (!bundleCheck.ok) throw new Error(JSON.stringify(bundleCheck.issues));
    manifest = bundleCheck.value;
    expect(verifyFrozenBundleFiles(bundleDir).mismatches).toEqual([]);
    expect(manifest.variants).toHaveLength(14);
    h = await platformHarness();
    await grant(h, 'alice', true);
    await h.db.query("INSERT INTO package_permissions(subject,package_name) VALUES ('alice','@company/charts-core') ON CONFLICT DO NOTHING");
    auth = await h.token('alice', ['publisher', 'maintainer'], 'cli');
    const result = await release(h, await upload(h, { manifest, files }, auth), auth);
    expect(result.status).toBe(202);
    const { jobId } = await result.json();
    const registry = await realRegistry();
    await new ReleaseWorker(h.db, h.store, registry).runOnce(jobId);
    for (const pkg of manifest.packages) await registry.verifyPackage(pkg);
    expect((await h.db.query('SELECT state FROM release_jobs WHERE id=$1', [jobId])).rows[0]!.state).toBe('READY');
    const rows = (await h.db.query('SELECT id,variant_id,availability FROM variant_releases')).rows;
    expect(rows).toHaveLength(14);
    expect(rows.every(row => row.availability === 'Ready')).toBe(true);
    ids = new Map(rows.map(row => [row.variant_id as string, row.id as string]));
    console.log(JSON.stringify({ event: 'PHASE2_FROZEN_SDK', manifestSha256: beforeSha,
      files: manifest.files.length, variants: manifest.variants.length,
      packages: manifest.packages.map(pkg => ({ name: pkg.name, version: pkg.version, sha256: pkg.tarball.sha256 })),
      productionAcceptance: false }));
  });

  afterAll(async () => {
    try {
      if (beforeSha) expect(digest(await readFile(join(bundleDir, 'manifest.json')))).toBe(beforeSha);
      expect(verifyFrozenBundleFiles(bundleDir).mismatches).toEqual([]);
    } finally { await h?.close(); }
  });

  for (const row of expectedSdkComponents) {
    it(`${row.componentId}/${row.framework} 的包摘要、导出、API、事件和依赖与独立矩阵一致`, async () => {
      const variant = manifest.variants.find(v => v.componentId === row.componentId && v.framework === row.framework)!;
      const pkg = manifest.packages.find(p => p.name === row.packageName)!;
      const query: ComponentMatchQueryV1 = { componentId: row.componentId, framework: row.framework,
        packageVersion: pkg.version, packageName: pkg.name, frameworkVersion: row.framework === 'vue' ? '3.5.45' : '19.3.1',
        echartsVersion: '6.1.0', ...(row.framework === 'react' ? { reactDomVersion: '19.3.1' } : {}) };
      const response = await h!.request('/v1/matching/components?' + new URLSearchParams(query).toString(), undefined, auth, 'GET');
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const checked = validateComponentMatchResponse(await response.json());
      if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
      const value = checked.value;
      expect(value.status).toBe('matched');
      expect(value.query).toEqual(query);
      expect(value.target).toMatchObject({ variantReleaseId: ids.get(variant.variantId), variantId: variant.variantId,
        componentId: row.componentId, framework: row.framework, packageName: pkg.name, packageVersion: pkg.version,
        packageSha256: pkg.tarball.sha256, exportName: row.exportName, exportPath: row.exportPath,
        styleExport: row.styleExport, readyMethod: row.readyMethod, compatibility: { status: 'unverified', recordIds: [] } });
      expect(value.api).toEqual(JSON.parse(Buffer.from(files.get(variant.api.path)!).toString('utf8')));
      expect(value.api!.events.map(event => event.name)).toEqual(row.eventNames);
      expect(value.api!.props.find(prop => prop.name === 'data')?.required).toBe(true);
      for (const kind of ['api', 'docs'] as const) expect(value.target!.evidence).toContainEqual({
        kind, path: variant[kind].path, sha256: variant[kind].sha256,
      });
      const dependencies = [ { name: pkg.name, version: pkg.version },
        { name: row.framework, version: query.frameworkVersion }, { name: 'echarts', version: '6.1.0' },
        ...(row.framework === 'react' ? [{ name: 'react-dom', version: '19.3.1' }] : []),
        ...Object.entries(pkg.dependencies).map(([name, version]) => ({ name, version })) ];
      expect(value.exactDependencies).toEqual(expect.arrayContaining(dependencies));
      expect(value.exactDependencies).toHaveLength(dependencies.length);
      expect(value.gaps.map(gap => gap.code)).toEqual(['COMPATIBILITY_UNVERIFIED']);

      if (row.componentId === 'line') {
        const input: MatchPlanRequest = { context: { framework: row.framework, frameworkVersion: query.frameworkVersion,
          echartsVersion: query.echartsVersion, packageManager: 'pnpm', requirements: [] },
          ...(row.framework === 'react' ? { reactDomVersion: query.reactDomVersion! } : {}),
          design: { schemaVersion: 1, mapping: { schemaVersion: 1, ruleSetId: 'synthetic-query-acceptance', revision: '1',
            entries: [{ designId: 'synthetic/line', framework: row.framework, variantReleaseId: value.target!.variantReleaseId }] },
          elements: [{ instanceId: 'synthetic-node', designId: 'synthetic/line' }] } };
        const post = await h!.request('/v1/matching/plans', input, auth);
        expect(post.status).toBe(200);
        const plan = validateMatchPlan(await post.json());
        if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
        expect(plan.value.elements[0]!.status).toBe('mapped');
        expect(plan.value.elements[0]!.target).toEqual(value.target);
        // POST keeps its existing install plan: package + runtime dependencies.
        // GET additionally reports the explicitly requested host peer versions.
        const postDependencies = [{ name: pkg.name, version: pkg.version },
          ...Object.entries(pkg.dependencies).map(([name, version]) => ({ name, version }))];
        expect(plan.value.exactDependencies).toHaveLength(postDependencies.length);
        expect(plan.value.exactDependencies).toEqual(expect.arrayContaining(postDependencies));
        expect(value.exactDependencies).toEqual(expect.arrayContaining(plan.value.exactDependencies));
      }
    });
  }
});

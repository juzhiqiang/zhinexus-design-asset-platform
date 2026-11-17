import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { canonicalJson, validateIntegrationPlan, validateMatchPlan, validateComponentApi, validateReleaseBundle, type ReleaseManifestV1, type MatchPlanV1 } from '@company/contracts';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { platformHarness, grant, upload, release } from '../platform/http-support.js';
import { registryToken, realRegistry } from '../platform/t06-support.js';
import { localServices } from '../platform/support.js';

const execute = promisify(execFile);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const npmEntry = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const envInput = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required for real installed CLI acceptance`); return resolve(value); };
type Harness = Awaited<ReturnType<typeof platformHarness>>;
let h: Harness | undefined;
let area: string; let bin: string; let manifest: ReleaseManifestV1; let sdkRoot: string; let jobId: string;
let apiToken: string; let readToken: string;
let rows: { id: string; framework: 'vue' | 'react'; metadata: ReleaseManifestV1['variants'][number] }[];
const projects = new Map<string, string>();
const matches = new Map<string, MatchPlanV1>();
let adopted = false;

// Fault transport proxies the actual isolated Verdaccio. Published bytes stay immutable.
async function registryFault(mode: 'corrupt-tarball' | 'unavailable' | 'deferred-tarball') {
  const upstream = localServices().registryOrigin;
  const seen: { path: string; authorized: boolean }[] = [];
  let corrupted = 0;
  let origin = '';
  let releaseDownload!: () => void;
  let notifyDownload!: () => void;
  const downloadGate = new Promise<void>(resolve => { releaseDownload = resolve; });
  const downloadStarted = new Promise<void>(resolve => { notifyDownload = resolve; });
  const server = createServer((request, response) => {
    void (async () => {
      const path = request.url ?? '/';
      seen.push({ path, authorized: request.headers.authorization === `Bearer ${readToken}` });
      if (mode === 'unavailable') { response.writeHead(503); response.end('isolated registry fault'); return; }
      const url = new URL(path, upstream);
      if (url.origin !== new URL(upstream).origin) throw new Error('Unexpected proxy destination');
      const result = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { authorization: request.headers.authorization ?? '' } });
      const contentType = result.headers.get('content-type') ?? 'application/octet-stream';
      let bytes = Buffer.from(await result.arrayBuffer());
      if (result.ok && url.pathname.endsWith('.tgz')) {
        if (mode === 'deferred-tarball') { notifyDownload(); await downloadGate; }
        else { bytes = Buffer.from(bytes); bytes[0] = bytes[0]! ^ 1; corrupted++; }
      } else if (result.ok && contentType.includes('json')) {
        // Only dist.tarball URLs are rewritten; names, versions and integrity remain real.
        const rewrite = (value: unknown): unknown => {
          if (Array.isArray(value)) return value.map(rewrite);
          if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => {
            if (key === 'tarball' && typeof child === 'string') {
              const source = new URL(child);
              if (source.origin !== new URL(upstream).origin) throw new Error('Unexpected real tarball origin');
              return [key, origin + source.pathname + source.search];
            }
            return [key, rewrite(child)];
          }));
          return value;
        };
        bytes = Buffer.from(JSON.stringify(rewrite(JSON.parse(bytes.toString('utf8')))));
      }
      response.writeHead(result.status, { 'content-type': contentType }); response.end(bytes);
    })().catch(() => { response.writeHead(502); response.end('isolated registry transport error'); });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { origin, seen, corrupted: () => corrupted, downloadStarted, releaseDownload,
    close: () => {
      releaseDownload(); server.closeAllConnections();
      return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } };
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(directory: string, prefix = ''): Promise<void> {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + item.name;
      if (item.isSymbolicLink()) throw new Error('Unexpected link in acceptance target');
      if (item.isDirectory()) { result[relative + '/'] = 'directory'; await walk(join(directory, item.name), relative + '/'); }
      else result[relative] = digest(await readFile(join(directory, item.name)));
    }
  }
  await walk(root); return result;
}

async function freshMatch(framework: 'vue' | 'react'): Promise<MatchPlanV1> {
  const row = rows.find(r => r.framework === framework)!;
  const checked = validateComponentApi(JSON.parse(await readFile(join(sdkRoot, row.metadata.api.path), 'utf8')));
  if (!checked.ok) throw new Error('Frozen SDK API invalid');
  const api = checked.value;
  const response = await h!.request('/v1/matching/plans', {
    design: { schemaVersion: 1, mapping: { schemaVersion: 1, ruleSetId: 'synthetic-phase3-acceptance', revision: '1',
      entries: [{ designId: 'synthetic/line', framework, variantReleaseId: row.id }] },
    elements: [{ instanceId: 'instance-1', designId: 'synthetic/line' }] },
    context: { framework, frameworkVersion: framework === 'vue' ? '3.5.45' : '19.3.1', echartsVersion: '6.1.0', packageManager: 'npm', requirements: [] },
    ...(framework === 'react' ? { reactDomVersion: '19.3.1' } : {}),
    bindings: [{ instanceId: 'instance-1', props: api.props.map(p => ({ name: p.name, source: `synthetic.${p.name}` })),
      events: api.events.map(e => ({ name: e.name, handler: 'syntheticHandler' })), layout: 'synthetic grid cell' }],
  }, apiToken);
  expect(response.status).toBe(200);
  const result = validateMatchPlan(await response.json()); expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Real MatchPlan did not validate');
  return result.value;
}

async function callPlan(framework: 'vue' | 'react', match: MatchPlanV1, overrides: { api?: string; registry?: string } = {}) {
  const root = projects.get(framework)!;
  const input = join(area, `match-${framework}.json`); await writeFile(input, JSON.stringify(match));
  const before = await snapshot(root);
  let code = 0; let stdout = ''; let stderr = '';
  try {
    const output = await execute(process.execPath, [bin, 'integrate', 'plan', '--project', root, '--match', input,
      '--api-url', overrides.api ?? h!.origin(), '--registry', overrides.registry ?? localServices().registryOrigin],
    { cwd: area, timeout: 90_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, ZHINEXUS_API_TOKEN: apiToken, ZHINEXUS_REGISTRY_TOKEN: readToken } });
    stdout = output.stdout; stderr = output.stderr;
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string };
    code = typeof result.code === 'number' ? result.code : -1; stdout = result.stdout ?? ''; stderr = result.stderr ?? '';
  }
  expect(await snapshot(root)).toEqual(before);
  expect(stdout + stderr).not.toContain(apiToken); expect(stdout + stderr).not.toContain(readToken);
  await writeFile(join(area, `last-${framework}.json`), JSON.stringify({ code, stdout, stderr }));
  return { code, stdout, stderr };
}
function checkedOutput(result: Awaited<ReturnType<typeof callPlan>>) {
  const parsed = JSON.parse(result.stdout); const checked = validateIntegrationPlan(parsed);
  expect(checked.ok, checked.ok ? '' : JSON.stringify(checked.issues)).toBe(true);
  if (!checked.ok) throw new Error('IntegrationPlan contract invalid');
  return checked.value;
}
async function adoptRealEvidence() {
  if (adopted) return;
  const evidence = JSON.parse(await readFile(envInput('INSTALLED_CLI_EVIDENCE'), 'utf8'));
  expect(evidence.recommendation).toBe('adopt'); expect(evidence.probe.packaged).toBe(true);
  for (const row of rows) {
    const pkg = manifest.packages.find(p => p.name === row.metadata.packageName)!;
    const response = await h!.request(`/v1/variant-releases/${row.id}/compatibility`, {
      packageSha256: pkg.tarball.sha256, reason: 'Reuse actual frozen SDK installed CLI acceptance for T15',
      candidate: { version: evidence.candidate.version, source: evidence.candidate.source, integrity: evidence.candidate.integrity }, evidence,
    }, apiToken);
    expect(response.status, await response.clone().text()).toBe(201);
  }
  adopted = true;
}

beforeAll(async () => {
  sdkRoot = envInput('A10_FROZEN_BUNDLE'); const tarball = envInput('PHASE3_CLI_TARBALL');
  manifest = JSON.parse(await readFile(join(sdkRoot, 'manifest.json'), 'utf8')) as ReleaseManifestV1;
  const files = new Map<string, Uint8Array>();
  for (const entry of manifest.files) { const bytes = await readFile(join(sdkRoot, entry.path)); expect(digest(bytes)).toBe(entry.sha256); expect(bytes.length).toBe(entry.bytes); files.set(entry.path, bytes); }
  const checked = await validateReleaseBundle(manifest, files);
  if (!checked.ok) throw new Error('Frozen SDK bundle invalid: ' + JSON.stringify(checked.issues)); manifest = checked.value;
  area = await mkdtemp(join(tmpdir(), 'zhinexus-t15-installed-'));
  const cliRoot = join(area, 'cli'); await mkdir(cliRoot);
  await writeFile(join(cliRoot, 'package.json'), JSON.stringify({ private: true, dependencies: { '@company/component-cli': `file:${tarball.replaceAll('\\', '/')}` } }));
  await execute(process.execPath, [npmEntry, 'install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: cliRoot, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
  bin = join(cliRoot, 'node_modules/@company/component-cli/dist/bin.js');
  const installed = JSON.parse(await readFile(join(cliRoot, 'node_modules/@company/component-cli/package.json'), 'utf8'));
  expect(installed.dependencies?.['@company/contracts']).toBeUndefined();
  console.log(JSON.stringify({ event: 'T15_INSTALLED_CLI', version: installed.version, sha256: digest(await readFile(tarball)), artifactDirectory: area }));
  h = await platformHarness(); await grant(h, 't15-acceptance', true);
  for (const pkg of manifest.packages) await h.db.query('INSERT INTO package_permissions(subject,package_name) VALUES ($1,$2) ON CONFLICT DO NOTHING', ['t15-acceptance', pkg.name]);
  apiToken = await h.token('t15-acceptance', ['publisher', 'maintainer'], 'cli');
  readToken = await registryToken('g2reader');
  const uploaded = await upload(h, { manifest, files }, apiToken);
  const submitted = await release(h, uploaded, apiToken); expect(submitted.status).toBe(202); jobId = (await submitted.json()).jobId;
  const worker = new ReleaseWorker(h.db, h.store, await realRegistry()); let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    await worker.runOnce(); await worker.tags.runOnce();
    const job = await (await h.request(`/v1/releases/${jobId}`, undefined, apiToken, 'GET')).json();
    if (job.state === 'READY') { ready = true; break; }
    if (['REJECTED', 'CONFLICT'].includes(job.state)) throw new Error(`Frozen SDK release ${job.state}`);
  }
  expect(ready).toBe(true);
  rows = (await h.db.query<{ id: string; framework: 'vue' | 'react'; metadata: ReleaseManifestV1['variants'][number] }>(
    "SELECT vr.id,v.framework,vr.metadata FROM variant_releases vr JOIN variants v ON v.id=vr.variant_id JOIN package_releases p ON p.id=vr.package_release_id WHERE p.job_id=$1 AND v.component_id='line'", [jobId])).rows;
  expect(rows).toHaveLength(2);
  for (const framework of ['vue', 'react'] as const) {
    const root = join(area, `synthetic ${framework} 业务`); await mkdir(root); projects.set(framework, root);
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: `phase3-${framework}`, private: true,
      packageManager: 'npm@11.20.0', dependencies: { [framework]: framework === 'vue' ? '3.5.45' : '19.3.1',
        ...(framework === 'react' ? { 'react-dom': '19.3.1' } : {}), echarts: '6.1.0' } }));
    await execute(process.execPath, [npmEntry, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, timeout: 120_000 });
    await writeFile(join(root, 'user-notes.txt'), 'synthetic untouched user content');
    matches.set(framework, await freshMatch(framework));
  }
});
afterAll(async () => { await h?.close(); });

describe('T15 actual installed CLI and isolated Nest/PG/MinIO/Verdaccio', () => {
  it.each(['vue', 'react'] as const)('%s preserves unverified real publication as conflicted with no project writes', async framework => {
    expect(matches.get(framework)!.elements[0]!.target!.compatibility.status).not.toBe('verified');
    const result = await callPlan(framework, matches.get(framework)!);
    expect(result.code, result.stderr).toBe(2); const plan = checkedOutput(result);
    expect(plan.status).toBe('conflicted'); expect(plan.executionAuthorized).toBe(false);
    expect(plan.conflicts.some(c => c.code === 'COMPATIBILITY_UNVERIFIED')).toBe(true);
  });
  it.each(['vue', 'react'] as const)('%s plans only after real compatibility evidence acceptance and verifies frozen package identities', async framework => {
    await adoptRealEvidence(); const match = await freshMatch(framework);
    const result = await callPlan(framework, match); expect(result.code, result.stderr).toBe(0);
    const plan = checkedOutput(result); expect(plan.status).toBe('planned'); expect(plan.commands.length).toBeGreaterThan(0);
    expect(plan.sourceMatchPlan).toEqual(match);
    expect(plan.matchPlanDigest).toBe(digest(Buffer.from(canonicalJson(match))));
    const pkg = manifest.packages.find(p => p.name === `@company/charts-${framework}`)!;
    expect(plan.registryEvidence).toContainEqual(expect.objectContaining({ name: pkg.name, version: pkg.version, sha256: pkg.tarball.sha256, verification: 'platform-sha256' }));
    expect(plan.exactDependencies).toContainEqual({ name: '@company/charts-core', version: manifest.packages.find(p => p.name === '@company/charts-core')!.version });
    expect(plan.publicationEvidence[0]!.response.target!.compatibility.status).toBe('verified');
    const selected = rows.find(row => row.framework === framework)!;
    expect(plan.publicationEvidence[0]!.response.api).toEqual(JSON.parse(await readFile(join(sdkRoot, selected.metadata.api.path), 'utf8')));
    expect(plan.publicationEvidence[0]!.response.target).toEqual(match.elements[0]!.target);
    expect(plan.changes).toContainEqual({ kind: 'generated-component', path: `src/components/zhinexus/component-0001.${framework === 'vue' ? 'vue' : 'tsx'}`, instanceId: 'instance-1', framework });
  });
  it('refuses a real revoked target', async () => {
    const match = await freshMatch('vue');
    await h!.db.query("UPDATE component_permissions SET can_read=false,can_publish=false,can_maintain=false WHERE subject='t15-acceptance' AND component_id='line'");
    try { const result = await callPlan('vue', match); expect(result.code).toBe(2); expect(checkedOutput(result).status).toBe('conflicted'); }
    finally { await h!.db.query("UPDATE component_permissions SET can_read=true,can_publish=true,can_maintain=true WHERE subject='t15-acceptance' AND component_id='line'"); }
  });
  it('refuses a real deprecated target', async () => {
    const match = await freshMatch('vue');
    const id = rows.find(r => r.framework === 'vue')!.id;
    await h!.db.query("UPDATE variant_releases SET availability='DEPRECATED' WHERE id=$1", [id]);
    try { const result = await callPlan('vue', match); expect(result.code).toBe(2); expect(checkedOutput(result).status).toBe('conflicted'); }
    finally { await h!.db.query("UPDATE variant_releases SET availability='Ready' WHERE id=$1", [id]); }
  });
  it('rechecks real permission revocation after the immutable registry download', async () => {
    await adoptRealEvidence(); const match = await freshMatch('vue'); const fault = await registryFault('deferred-tarball');
    const running = callPlan('vue', match, { registry: fault.origin });
    try {
      const outcome = await Promise.race([
        fault.downloadStarted.then(() => 'download' as const),
        running.then(() => 'exited' as const),
        new Promise<'timeout'>(resolve => { const timer = setTimeout(() => resolve('timeout'), 60_000); timer.unref(); }),
      ]);
      expect(outcome, 'The installed CLI must reach the actual registry tarball before revocation').toBe('download');
      await h!.db.query("UPDATE component_permissions SET can_read=false,can_publish=false,can_maintain=false WHERE subject='t15-acceptance' AND component_id='line'");
      fault.releaseDownload();
      const result = await running;
      expect(fault.seen.some(request => request.path.endsWith('.tgz'))).toBe(true);
      expect(fault.seen.every(request => request.authorized)).toBe(true);
      expect(result.code).toBe(2);
      expect(checkedOutput(result).conflicts.some(conflict => conflict.code === 'TARGET_UNAVAILABLE')).toBe(true);
    } finally {
      fault.releaseDownload(); await running.catch(() => undefined);
      await h!.db.query("UPDATE component_permissions SET can_read=true,can_publish=true,can_maintain=true WHERE subject='t15-acceptance' AND component_id='line'");
      await fault.close();
    }
  });
  it('refuses corrupted real API material metadata', async () => {
    const match = await freshMatch('vue'); const api = rows.find(r => r.framework === 'vue')!.metadata.api;
    await h!.db.query('UPDATE release_artifacts SET sha256=$1 WHERE job_id=$2 AND path=$3', ['f'.repeat(64), jobId, api.path]);
    try { const result = await callPlan('vue', match); expect(result.code).toBe(2); expect(checkedOutput(result).conflicts.length).toBeGreaterThan(0); }
    finally { await h!.db.query('UPDATE release_artifacts SET sha256=$1 WHERE job_id=$2 AND path=$3', [api.sha256, jobId, api.path]); }
  });
  it('does not plan when the actual API endpoint is unavailable', async () => {
    const match = await freshMatch('vue'); const server = createServer(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port; await new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r()));
    const result = await callPlan('vue', match, { api: `http://127.0.0.1:${port}` }); expect(result.code).toBe(1);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stderr).not.toContain('命令尚未实现');
  });
  it('refuses corrupted bytes proxied from the actual immutable registry', async () => {
    await adoptRealEvidence(); const match = await freshMatch('vue'); const fault = await registryFault('corrupt-tarball');
    try {
      const result = await callPlan('vue', match, { registry: fault.origin });
      expect(fault.corrupted()).toBeGreaterThan(0);
      expect(fault.seen.every(request => request.authorized)).toBe(true);
      expect(result.code).toBe(2);
      expect(checkedOutput(result).conflicts.some(c => c.code === 'PACKAGE_DIGEST_MISMATCH')).toBe(true);
    } finally { await fault.close(); }
  });
  it('reports actual registry transport failure without producing a plan', async () => {
    await adoptRealEvidence(); const match = await freshMatch('react'); const fault = await registryFault('unavailable');
    try {
      const result = await callPlan('react', match, { registry: fault.origin });
      expect(fault.seen.length).toBeGreaterThan(0);
      expect(fault.seen.every(request => request.authorized)).toBe(true);
      expect(result.code).toBe(1); expect(() => JSON.parse(result.stdout)).not.toThrow();
    } finally { await fault.close(); }
  });
});

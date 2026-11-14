import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, environmentKey, environmentProjection } from '@company/contracts';
import { createRecoveryStack } from '../../infra/scripts/recovery-stack.js';
import { platformHarness, grant } from '../platform/http-support.js';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { realRegistry } from '../platform/t06-support.js';
import { prepareReleaseBundle } from '../../packages/component-cli/src/local/manifest.js';
import { executeReleaseCommand } from '../../packages/component-cli/src/local/release.js';

const sha256 = (bytes: string | Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

async function buildValidProbeEvidence(params: {
  packageName: string;
  packageVersion: string;
  packageSha256: string;
  packageBytes: number;
  variantId: string;
  components?: string[];
  candidateVersion?: string;
  candidateIntegrity?: string;
  candidateSource?: string;
  overrides?: Record<string, unknown>;
}) {
  const candidateVersion = params.candidateVersion ?? '6.1.0';
  const candidateIntegrity = params.candidateIntegrity ?? 'sha512-official-610==';
  const candidateSource = params.candidateSource ?? 'https://registry.npmjs.org/echarts';
  const components = params.components ?? ['line'];
  const presentations = ['light-canvas', 'dark-canvas', 'light-svg', 'dark-svg'] as const;

  const font = {
    stack: 'system-ui, sans-serif',
    families: [
      { family: 'sans-serif', available: true, advances: [210.123, 320.567, 52.111] },
      { family: 'serif', available: true, advances: [220.123, 320.567, 51.111] },
      { family: 'monospace', available: true, advances: [230.123, 320.567, 53.111] },
    ],
    loadedFonts: [] as string[],
  };
  const fontCanonical = canonicalJson({
    kind: 'font-fingerprint-v1',
    stack: font.stack,
    families: font.families.map((f) => ({ ...f, advances: f.advances.map((a) => Math.round(a * 1000) / 1000) })),
    loadedFonts: [],
  });
  const fontDigest = sha256(fontCanonical);
  const screenshotBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  );
  const screenshotSha = sha256(screenshotBytes);

  const combinations = [];
  for (const [framework, frameworkVersion] of [
    ['vue', '3.5.45'],
    ['react', '19.3.1'],
  ] as Array<['vue' | 'react', string]>) {
    const browserRuns = [];
    const visualRuns = [];
    for (const component of components) {
      for (const presentation of presentations) {
        const [theme, renderer] = presentation.split('-') as ['light' | 'dark', 'canvas' | 'svg'];
        const environment = {
          os: 'windows',
          arch: 'x64',
          browserVersion: '144.0.0.0',
          browserRevision: '1254',
          fontDigest,
          locale: 'zh-CN',
          timezone: 'Asia/Shanghai',
          deviceScaleFactor: 1,
          renderer,
          width: 1,
          height: 1,
          theme,
          frameworkVersion,
          echartsVersion: candidateVersion,
        };
        browserRuns.push({
          component,
          presentation,
          environment,
          environmentKey: await environmentKey(environment),
          environmentAudit: {
            projection: environmentProjection(environment),
            canonical: canonicalJson(environmentProjection(environment)),
            fontDigest,
            fontFingerprint: { ...font, fontDigest, canonical: fontCanonical },
          },
          hostCount: 1,
          pageErrors: [],
          checks: ['mounted', 'data', 'resize', 'events'].map((name) => ({ name, status: 'passed' })),
          clickError: null,
          click: [{ seriesId: 'fixture', dataIndex: 0, value: [0, 1], nativeType: 'click' }],
          screenshot: { file: 'fixture.png', bytes: screenshotBytes.length, sha256: screenshotSha },
        });
        visualRuns.push({ component, presentation, result: 'PASS' });
      }
    }
    combinations.push({
      framework,
      frameworkVersion,
      echartsVersion: candidateVersion,
      consumer: {
        peerMode: 'strict',
        resolved: {
          echarts: candidateVersion,
          vue: '3.5.45',
          react: '19.3.1',
        },
      },
      dimensions: { typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'passed' },
      failures: [],
      evidence: {
        typecheck: [
          { resolution: 'Bundler', exitCode: 0 },
          { resolution: 'NodeNext', exitCode: 0 },
        ],
        build: { exitCode: 0 },
        ssrImport: { exitCode: 0, windowDefined: false, documentDefined: false },
        lifecycle: { status: 'passed' },
        browser: browserRuns,
        visual: visualRuns,
      },
    });
  }

  return {
    schemaVersion: 1,
    kind: 'a-t10-sdk-probe',
    probe: {
      platform: 'windows',
      node: 'v26.13.0',
      browserRevision: '1254',
      fontDigestSource: 'measured',
      fontDigest,
    },
    bundle: {
      version: params.packageVersion,
      packages: [
        {
          name: params.packageName,
          version: params.packageVersion,
          sha256: params.packageSha256,
          bytes: params.packageBytes,
        },
        {
          name: '@company/charts-core',
          version: params.packageVersion,
          sha256: 'a'.repeat(64),
          bytes: 123,
        },
      ],
      variants: [{ variantId: params.variantId }],
    },
    candidate: {
      version: candidateVersion,
      integrity: candidateIntegrity,
      source: candidateSource,
      integrityVerified: true,
      consumerSources: [
        { framework: 'vue', verified: true, reason: null, resolved: candidateSource, version: candidateVersion },
        { framework: 'react', verified: true, reason: null, resolved: candidateSource, version: candidateVersion },
      ],
    },
    combinations,
    policy: {
      peerSatisfied: true,
      hasDualFrameworkCoverage: true,
      supportedRangeUnchanged: true,
      requiresVisualBaselineConfirmation: false,
      candidateIntegrityVerified: true,
    },
    recommendation: 'adopt',
    uncovered: [],
    scopeNotes: ['peerDependencies untouched'],
    ...(params.overrides ?? {}),
  };
}

describe('B2: 候选兼容证据提交、持久化与查询闭环 (PostgreSQL + Nest API)', () => {
  let stack: Awaited<ReturnType<typeof createRecoveryStack>> | undefined;
  let harness: Awaited<ReturnType<typeof platformHarness>> | undefined;
  const tempDirs: string[] = [];

  afterEach(async () => {
    try {
      await harness?.close();
    } finally {
      harness = undefined;
      try {
        await stack?.close();
      } finally {
        stack = undefined;
        for (const dir of tempDirs.splice(0)) {
          await fs.rm(dir, { recursive: true, force: true });
        }
      }
    }
  });

  it(
    '严格验证完整嵌套执行证据、目标组件/全展示、双框架矩阵与版本、URL 净化、公开/私有投影隔离及 409 冲突',
    async () => {
      stack = await createRecoveryStack();
      const services = {
        credentials: stack.secrets,
        postgresPort: stack.ports.postgres,
        storageEndpoint: `http://127.0.0.1:${stack.ports.minio}`,
        registryOrigin: `http://127.0.0.1:${stack.ports.verdaccio}`,
      };
      const h = (harness = await platformHarness({}, services));

      await grant(h, 'alice', true);
      await grant(h, 'bob', false);
      await grant(h, 'carol', false);
      await h.db.query(
        "INSERT INTO package_permissions(subject,package_name) VALUES ('alice','@company/charts-core') ON CONFLICT DO NOTHING",
      );

      const aliceToken = await h.token('alice', ['maintainer', 'publisher'], 'cli');
      const bobToken = await h.token('bob', ['reader'], 'cli');
      const carolToken = await h.token('carol', ['maintainer'], 'cli');
      const apiUrl = h.origin();

      const bundleDir = await fs.mkdtemp(path.join(os.tmpdir(), 'b2-compat-bundle-'));
      tempDirs.push(bundleDir);
      const prepared = await prepareReleaseBundle({
        bundleDir,
        components: ['line', 'bar', 'pie', 'scatter', 'trend-card', 'ranking', 'proportion'],
        frameworks: ['vue', 'react'],
        timeoutMs: 60_000,
      });
      expect(prepared.ok, JSON.stringify(prepared.issues)).toBe(true);

      const worker = new ReleaseWorker(h.db, h.store, await realRegistry(services));
      let runningWorker = true;
      const workerLoop = (async () => {
        while (runningWorker) {
          try {
            await worker.runOnce();
            await worker.tags.runOnce();
          } catch {
            // ignore
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      })();

      try {
        const rel = await executeReleaseCommand({
          bundleDir,
          apiUrl,
          token: aliceToken,
          timeoutMs: 60_000,
          pollIntervalMs: 500,
        });
        expect(rel.ok, rel.error).toBe(true);
        expect(rel.state).toBe('READY');
      } finally {
        runningWorker = false;
        await workerLoop;
      }

      const vrRow = (
        await h.db.query<{
          id: string;
          variant_id: string;
          component_id: string;
          framework: 'vue' | 'react';
          package_name: string;
          package_version: string;
          package_sha256: string;
          pkg_bytes: string;
        }>(
          `SELECT vr.id, vr.variant_id, v.component_id, v.framework, pr.name AS package_name, pr.version AS package_version, pr.sha256 AS package_sha256,
                  COALESCE(pr.metadata->'tarball'->>'bytes', '0') AS pkg_bytes
             FROM variant_releases vr
             JOIN variants v ON v.id = vr.variant_id
             JOIN package_releases pr ON pr.id = vr.package_release_id
            WHERE v.component_id = 'line' AND v.framework = 'vue'
            LIMIT 1`,
        )
      ).rows[0]!;
      expect(vrRow).toBeTruthy();

      const pkgBytes = Number(vrRow.pkg_bytes) || 100;
      const validEvidence = await buildValidProbeEvidence({
        packageName: vrRow.package_name,
        packageVersion: vrRow.package_version,
        packageSha256: vrRow.package_sha256,
        packageBytes: pkgBytes,
        variantId: vrRow.variant_id,
        components: [vrRow.component_id],
      });

      const validPayload = {
        packageSha256: vrRow.package_sha256,
        candidate: {
          version: '6.1.0',
          integrity: 'sha512-official-610==',
          source: 'https://registry.npmjs.org/echarts',
        },
        evidence: validEvidence,
        reason: 'Evidence verified at C:\\Users\\review-person\\private-project\\probe.json',
      };

      const postCompat = async (id: string, body: unknown, token?: string) => {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (token) headers.authorization = `Bearer ${token}`;
        return fetch(`${apiUrl}/v1/variant-releases/${id}/compatibility`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
      };

      // 1. 权限与基础校验 (401 / 403 / 404 / DIGEST_MISMATCH / INVALID_SCHEMA)
      expect((await postCompat(vrRow.id, validPayload)).status).toBe(401);
      expect((await postCompat(vrRow.id, validPayload, bobToken)).status).toBe(403);
      expect((await postCompat(vrRow.id, validPayload, carolToken)).status).toBe(403);
      expect((await postCompat('99999999-9999-4999-8999-999999999999', validPayload, aliceToken)).status).toBe(404);
      expect(
        (await postCompat(vrRow.id, { ...validPayload, packageSha256: 'f'.repeat(64) }, aliceToken)).status,
      ).toBe(400);

      // 2. P1 #1: 仅四维+policy+adopt、无完整嵌套执行明细 (summary-only) -> 必须拒绝
      const summaryOnly = {
        ...validEvidence,
        probe: undefined,
        combinations: validEvidence.combinations.map((c) => ({
          framework: c.framework,
          frameworkVersion: c.frameworkVersion,
          echartsVersion: c.echartsVersion,
          dimensions: c.dimensions,
          failures: [],
        })),
      };
      expect((await postCompat(vrRow.id, { ...validPayload, evidence: summaryOnly }, aliceToken)).status).toBe(400);

      // P1 #1b: 伪造 environmentKey -> 必须拒绝
      const badEnvKeyEv = structuredClone(validEvidence);
      badEnvKeyEv.combinations[0]!.evidence.browser[0]!.environmentKey = '0'.repeat(64);
      expect((await postCompat(vrRow.id, { ...validPayload, evidence: badEnvKeyEv }, aliceToken)).status).toBe(400);

      // P1 #1c: ssrImport.windowDefined = true -> 必须拒绝
      const badSsrEv = structuredClone(validEvidence);
      badSsrEv.combinations[0]!.evidence.ssrImport.windowDefined = true;
      expect((await postCompat(vrRow.id, { ...validPayload, evidence: badSsrEv }, aliceToken)).status).toBe(400);

      // 3. P1 #2: 同包仅 bar-only 证据提交到 line-vue -> 必须拒绝
      const barOnlyEv = await buildValidProbeEvidence({
        packageName: vrRow.package_name,
        packageVersion: vrRow.package_version,
        packageSha256: vrRow.package_sha256,
        packageBytes: pkgBytes,
        variantId: 'bar-vue',
        components: ['bar'],
      });
      expect((await postCompat(vrRow.id, { ...validPayload, evidence: barOnlyEv }, aliceToken)).status).toBe(400);

      // 4. P1 #3: 删 React / React runtime=failed / Vue frameworkVersion=banana -> 必须全部拒绝
      const noReactEv = structuredClone(validEvidence);
      noReactEv.combinations = [noReactEv.combinations[0]!];
      expect((await postCompat(vrRow.id, { ...validPayload, evidence: noReactEv }, aliceToken)).status).toBe(400);

      const reactFailedEv = structuredClone(validEvidence);
      reactFailedEv.combinations[1]!.dimensions.runtime = 'failed';
      expect((await postCompat(vrRow.id, { ...validPayload, evidence: reactFailedEv }, aliceToken)).status).toBe(400);

      const bogusVersionEv = structuredClone(validEvidence);
      bogusVersionEv.combinations[0]!.frameworkVersion = 'banana';
      expect((await postCompat(vrRow.id, { ...validPayload, evidence: bogusVersionEv }, aliceToken)).status).toBe(400);

      // 5. P2 #4: candidate.source 含凭据 / query / hash / 非 HTTPS / 反斜杠 -> 必须全部拒绝
      for (const badSource of [
        'https://user:password@registry.npmjs.org/echarts',
        'https://registry.npmjs.org/echarts?token=secret',
        'https://registry.npmjs.org/echarts#frag',
        'http://registry.npmjs.org/echarts',
        'https://registry.npmjs.org/echarts\\bad',
      ]) {
        const badEv = structuredClone(validEvidence);
        badEv.candidate.source = badSource;
        badEv.candidate.consumerSources = badEv.candidate.consumerSources.map((s) => ({ ...s, resolved: badSource }));
        const res = await postCompat(
          vrRow.id,
          { ...validPayload, candidate: { ...validPayload.candidate, source: badSource }, evidence: badEv },
          aliceToken,
        );
        expect(res.status, `expected 400 for badSource=${badSource}`).toBe(400);
      }

      // 6. 合法完整证据提交 -> 201 持久化 + 重复提交 409 CONFLICT
      const okRes = await postCompat(vrRow.id, validPayload, aliceToken);
      expect(okRes.status).toBe(201);
      const created = (await okRes.json()) as {
        compatibilityId: string;
        status: string;
        evidenceSha256: string;
      };
      expect(created.status).toBe('passed');
      expect(created.evidenceSha256).toBe(sha256(JSON.stringify(validEvidence)));

      const dupRes = await postCompat(vrRow.id, validPayload, aliceToken);
      expect(dupRes.status).toBe(409);

      // 7. P2 #4: 公开投影不返回 reason/subject；普通 reader /v1/me/... 不返回 reason/subject；maintainer 可见
      await h.db.query("UPDATE components SET public = true WHERE id = 'line'");
      await h.db.query(
        "INSERT INTO component_permissions(subject, component_id, can_read) VALUES ('bob', 'line', true) ON CONFLICT (subject, component_id) DO UPDATE SET can_read = true",
      );

      const pubGet = await fetch(`${apiUrl}/v1/variant-releases/${vrRow.id}/compatibility`);
      expect(pubGet.status).toBe(200);
      const pubBody = (await pubGet.json()) as { items: Array<Record<string, unknown>> };
      expect(pubBody.items).toHaveLength(1);
      expect(pubBody.items[0]!.reason).toBeUndefined();
      expect(pubBody.items[0]!.subject).toBeUndefined();

      const readerGet = await fetch(`${apiUrl}/v1/me/variant-releases/${vrRow.id}/compatibility`, {
        headers: { authorization: `Bearer ${bobToken}` },
      });
      expect(readerGet.status).toBe(200);
      const readerBody = (await readerGet.json()) as { items: Array<Record<string, unknown>> };
      expect(readerBody.items[0]!.reason).toBeUndefined();
      expect(readerBody.items[0]!.subject).toBeUndefined();

      const maintainerGet = await fetch(`${apiUrl}/v1/me/variant-releases/${vrRow.id}/compatibility`, {
        headers: { authorization: `Bearer ${aliceToken}` },
      });
      expect(maintainerGet.status).toBe(200);
      const maintainerBody = (await maintainerGet.json()) as { items: Array<Record<string, unknown>> };
      expect(maintainerBody.items[0]!.reason).toBe(validPayload.reason);
      expect(maintainerBody.items[0]!.subject).toBe('alice');
    },
    180_000,
  );
});

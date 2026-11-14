import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecoveryStack } from '../../infra/scripts/recovery-stack.js';
import { platformHarness, grant } from '../platform/http-support.js';
import { ReleaseWorker } from '../../apps/api/dist/releases/worker.js';
import { realRegistry } from '../platform/t06-support.js';
import { prepareReleaseBundle } from '../../packages/component-cli/src/local/manifest.js';
import { executeReleaseCommand } from '../../packages/component-cli/src/local/release.js';

function buildValidProbeEvidence(params: {
  packageName: string;
  packageVersion: string;
  packageSha256: string;
  packageBytes: number;
  framework: 'vue' | 'react';
  candidateVersion?: string;
  candidateIntegrity?: string;
  candidateSource?: string;
  overrides?: Record<string, unknown>;
}) {
  const candidateVersion = params.candidateVersion ?? '6.1.0';
  const candidateIntegrity = params.candidateIntegrity ?? 'sha512-official-610==';
  const candidateSource = params.candidateSource ?? 'https://registry.npmjs.org/echarts';
  return {
    schemaVersion: 1,
    kind: 'a-t10-sdk-probe',
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
    },
    candidate: {
      version: candidateVersion,
      integrity: candidateIntegrity,
      source: candidateSource,
      integrityVerified: true,
    },
    combinations: [
      {
        framework: 'vue',
        frameworkVersion: '3.5.45',
        echartsVersion: candidateVersion,
        dimensions: { typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'passed' },
        failures: [],
      },
      {
        framework: 'react',
        frameworkVersion: '19.3.1',
        echartsVersion: candidateVersion,
        dimensions: { typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'passed' },
        failures: [],
      },
    ],
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
    '验证 maintainer 显式提交、零信任校验（拒绝 hold/缺维度/错摘要/畸形证据/越权/错 release）及重复提交 409 冲突与公开/私有查询边界',
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
      const carolToken = await h.token('carol', ['maintainer'], 'cli'); // 有 maintainer 角色但无该组件 can_maintain
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
          framework: 'vue' | 'react';
          package_name: string;
          package_version: string;
          package_sha256: string;
          pkg_bytes: string;
        }>(
          `SELECT vr.id, vr.variant_id, v.framework, pr.name AS package_name, pr.version AS package_version, pr.sha256 AS package_sha256,
                  COALESCE(pr.metadata->'tarball'->>'bytes', '0') AS pkg_bytes
             FROM variant_releases vr
             JOIN variants v ON v.id = vr.variant_id
             JOIN package_releases pr ON pr.id = vr.package_release_id
            WHERE v.framework = 'vue'
            LIMIT 1`,
        )
      ).rows[0]!;
      expect(vrRow).toBeTruthy();

      const pkgBytes = Number(vrRow.pkg_bytes) || 100;
      const validEvidence = buildValidProbeEvidence({
        packageName: vrRow.package_name,
        packageVersion: vrRow.package_version,
        packageSha256: vrRow.package_sha256,
        packageBytes: pkgBytes,
        framework: vrRow.framework,
      });

      const validPayload = {
        packageSha256: vrRow.package_sha256,
        candidate: {
          version: '6.1.0',
          integrity: 'sha512-official-610==',
          source: 'https://registry.npmjs.org/echarts',
        },
        evidence: validEvidence,
        reason: '本地真实浏览器与双框架 6.1.0 兼容验证通过',
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

      // 1. 未认证 401
      const unauthRes = await postCompat(vrRow.id, validPayload);
      expect(unauthRes.status).toBe(401);

      // 2. reader 角色 403 & maintainer 但无组件 can_maintain 权限 403
      const bobRes = await postCompat(vrRow.id, validPayload, bobToken);
      expect(bobRes.status).toBe(403);
      const carolRes = await postCompat(vrRow.id, validPayload, carolToken);
      expect(carolRes.status).toBe(403);

      // 3. 错 releaseId -> 404
      const notFoundRes = await postCompat('99999999-9999-4999-8999-999999999999', validPayload, aliceToken);
      expect(notFoundRes.status).toBe(404);

      // 4. 错包摘要 -> 400 DIGEST_MISMATCH
      const wrongDigestRes = await postCompat(
        vrRow.id,
        { ...validPayload, packageSha256: 'f'.repeat(64) },
        aliceToken,
      );
      expect(wrongDigestRes.status).toBe(400);
      expect(((await wrongDigestRes.json()) as { code: string }).code).toBe('DIGEST_MISMATCH');

      // 5. 畸形证据 -> 400 INVALID_SCHEMA
      const malformedRes = await postCompat(
        vrRow.id,
        { ...validPayload, evidence: { schemaVersion: 1, kind: 'bad', combinations: [{ failures: [null] }] } },
        aliceToken,
      );
      expect(malformedRes.status).toBe(400);
      expect(((await malformedRes.json()) as { code: string }).code).toBe('INVALID_SCHEMA');

      // 6. hold 或 客户端伪造 recommendation='adopt' 但实际维度失败/缺维度 -> 400 COMPATIBILITY_EVIDENCE_REQUIRED
      const holdEvidence = buildValidProbeEvidence({
        packageName: vrRow.package_name,
        packageVersion: vrRow.package_version,
        packageSha256: vrRow.package_sha256,
        packageBytes: pkgBytes,
        framework: vrRow.framework,
        overrides: { recommendation: 'hold' },
      });
      const holdRes = await postCompat(vrRow.id, { ...validPayload, evidence: holdEvidence }, aliceToken);
      expect(holdRes.status).toBe(400);
      expect(((await holdRes.json()) as { code: string }).code).toBe('COMPATIBILITY_EVIDENCE_REQUIRED');

      const spoofedAdoptEvidence = buildValidProbeEvidence({
        packageName: vrRow.package_name,
        packageVersion: vrRow.package_version,
        packageSha256: vrRow.package_sha256,
        packageBytes: pkgBytes,
        framework: vrRow.framework,
        overrides: {
          recommendation: 'adopt',
          combinations: [
            {
              framework: 'vue',
              frameworkVersion: '3.5.45',
              echartsVersion: '6.1.0',
              dimensions: { typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'not-run' },
              failures: [],
            },
            {
              framework: 'react',
              frameworkVersion: '19.3.1',
              echartsVersion: '6.1.0',
              dimensions: { typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'passed' },
              failures: [],
            },
          ],
        },
      });
      const spoofedRes = await postCompat(vrRow.id, { ...validPayload, evidence: spoofedAdoptEvidence }, aliceToken);
      expect(spoofedRes.status).toBe(400);
      expect(((await spoofedRes.json()) as { code: string }).code).toBe('COMPATIBILITY_EVIDENCE_REQUIRED');

      // 7. 合法 maintainer 显式提交 -> 201 持久化
      const okRes = await postCompat(vrRow.id, validPayload, aliceToken);
      expect(okRes.status).toBe(201);
      const created = (await okRes.json()) as {
        compatibilityId: string;
        variantReleaseId: string;
        echartsVersion: string;
        status: string;
        evidenceSha256: string;
      };
      expect(created.variantReleaseId).toBe(vrRow.id);
      expect(created.echartsVersion).toBe('6.1.0');
      expect(created.status).toBe('passed');
      expect(created.evidenceSha256).toBe(
        crypto.createHash('sha256').update(JSON.stringify(validEvidence)).digest('hex'),
      );

      // 8. 重复提交 / 冲突 -> 409 CONFLICT
      const dupRes = await postCompat(vrRow.id, validPayload, aliceToken);
      expect(dupRes.status).toBe(409);
      expect(((await dupRes.json()) as { code: string }).code).toBe('CONFLICT');

      // 9. 查询闭环：私有组件公开端点不可见 (404)，/v1/me/... 授权可见 (200)
      const pubGetBefore = await fetch(`${apiUrl}/v1/variant-releases/${vrRow.id}/compatibility`);
      expect(pubGetBefore.status).toBe(404);

      const meGet = await fetch(`${apiUrl}/v1/me/variant-releases/${vrRow.id}/compatibility`, {
        headers: { authorization: `Bearer ${aliceToken}` },
      });
      expect(meGet.status).toBe(200);
      const meBody = (await meGet.json()) as {
        variantReleaseId: string;
        items: Array<{ compatibilityId: string; echartsVersion: string; status: string }>;
      };
      expect(meBody.variantReleaseId).toBe(vrRow.id);
      expect(meBody.items).toHaveLength(1);
      expect(meBody.items[0]!.compatibilityId).toBe(created.compatibilityId);
      expect(meBody.items[0]!.status).toBe('passed');
    },
    180_000,
  );
});

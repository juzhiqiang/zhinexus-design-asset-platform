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
import { acceptBaseline } from '../../packages/component-cli/src/commands/baseline.js';
import type { CheckReportV1 } from '../../packages/component-cli/src/contracts/reports.js';

describe('T04: component baseline accept 真实 API 集成验收 (首次成功 + CAS冲突 + 403 + 多版本 client_ref 消歧)', () => {
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
    '真实 PostgreSQL + Nest API 验证首次接受基线、expectedRevision CAS 冲突、403 越权拦截及多版本 client_ref 通过 releaseJob.baselineCandidates 消歧',
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
      await h.db.query(
        "INSERT INTO package_permissions(subject,package_name) VALUES ('alice','@company/charts-core') ON CONFLICT DO NOTHING",
      );

      const aliceToken = await h.token('alice', ['maintainer', 'publisher'], 'cli');
      const bobToken = await h.token('bob', ['reader'], 'cli');
      const apiUrl = h.origin();

      // 1. 生成全量冻结 Bundle 并完成首次发布至 READY
      const bundle1 = await fs.mkdtemp(path.join(os.tmpdir(), 't04-baseline-b1-'));
      tempDirs.push(bundle1);
      const prepared1 = await prepareReleaseBundle({
        bundleDir: bundle1,
        components: ['line', 'bar', 'pie', 'scatter', 'trend-card', 'ranking', 'proportion'],
        frameworks: ['vue', 'react'],
        timeoutMs: 60_000,
      });
      expect(prepared1.ok, JSON.stringify(prepared1.issues)).toBe(true);

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

      let rel1;
      try {
        rel1 = await executeReleaseCommand({
          bundleDir: bundle1,
          apiUrl,
          token: aliceToken,
          timeoutMs: 60_000,
          pollIntervalMs: 500,
        });
      } finally {
        runningWorker = false;
        await workerLoop;
      }
      expect(rel1.ok, rel1.error).toBe(true);
      expect(rel1.state).toBe('READY');
      expect(rel1.jobId).toBeTruthy();

      const reportPath1 = path.join(bundle1, prepared1.manifest.reports[0]!.path);
      const report1 = JSON.parse(await fs.readFile(reportPath1, 'utf8')) as CheckReportV1;

      // 2. 首次接受基线 (携带 jobId 从 releaseJob.baselineCandidates 映射服务端 UUID) -> 成功返回 rev1
      const accept1 = await acceptBaseline({
        reportPath: reportPath1,
        reason: '首次建立 line-vue 基线',
        apiUrl,
        token: aliceToken,
        jobId: rel1.jobId!,
      });
      expect(accept1.ok, accept1.error).toBe(true);
      expect(accept1.revisionId).toBeTruthy();
      const rev1 = accept1.revisionId!;

      // 3. 403 FORBIDDEN: 非 maintainer / 无权限用户 bob 尝试接受基线 -> 被拒绝
      const forbiddenRes = await acceptBaseline({
        reportPath: reportPath1,
        reason: '越权用户尝试确认',
        apiUrl,
        token: bobToken,
        expectedRevision: rev1,
      });
      expect(forbiddenRes.ok).toBe(false);
      expect(forbiddenRes.status).toBe(403);
      expect(forbiddenRes.errorCode).toBe('FORBIDDEN');

      // 4. CAS 冲突: 缺少 expectedRevision 或传入旧 expectedRevision -> 409 CONFLICT
      const conflictNoRev = await acceptBaseline({
        reportPath: reportPath1,
        reason: '未携带 expectedRevision 尝试覆盖',
        apiUrl,
        token: aliceToken,
        jobId: rel1.jobId!,
      });
      expect(conflictNoRev.ok).toBe(false);
      expect(conflictNoRev.status).toBe(409);
      expect(conflictNoRev.errorCode).toBe('CONFLICT');

      const conflictStaleRev = await acceptBaseline({
        reportPath: reportPath1,
        reason: '过期 expectedRevision 尝试覆盖',
        apiUrl,
        token: aliceToken,
        jobId: rel1.jobId!,
        expectedRevision: 'stale-revision-id',
      });
      expect(conflictStaleRev.ok).toBe(false);
      expect(conflictStaleRev.status).toBe(409);
      expect(conflictStaleRev.errorCode).toBe('CONFLICT');

      // 5. 传入正确 expectedRevision=rev1 -> 成功升级基线至 rev2
      const accept2 = await acceptBaseline({
        reportPath: reportPath1,
        reason: '基于 rev1 推进新基线',
        apiUrl,
        token: aliceToken,
        jobId: rel1.jobId!,
        expectedRevision: rev1,
      });
      expect(accept2.ok, accept2.error).toBe(true);
      expect(accept2.revisionId).toBeTruthy();
      expect(accept2.revisionId).not.toBe(rev1);
      const rev2 = accept2.revisionId!;

      // 6. 多版本相同 client_ref 消歧验证：
      // 模拟第二版本释放出完全相同的本地截图 client_ref (report1.screenshots[0].id)
      const dupJobId = '11111111-1111-4111-8111-111111111111';
      const dupVariantReleaseId = '22222222-2222-4222-8222-222222222222';
      const dupPkgReleaseId = '33333333-3333-4333-8333-333333333333';
      const dupShotId = '55555555-5555-4555-8555-555555555555';
      const shot1 = report1.screenshots[0]!;
      const existing = (
        await h.db.query(
          `SELECT s.object_key, s.metadata, s.report_id, pr.job_id, pr.name, pr.metadata AS pkg_metadata, vr.metadata AS vr_metadata,
                  rj.subject, rj.client_id, rj.channel, rj.upload_session_id, rj.manifest_digest, rj.manifest, rj.request_digest
             FROM screenshots s
             JOIN variant_releases vr ON vr.id = s.variant_release_id
             JOIN package_releases pr ON pr.id = vr.package_release_id
             JOIN release_jobs rj ON rj.id = pr.job_id
            WHERE s.client_ref = $1 AND vr.variant_id = $2
            LIMIT 1`,
          [shot1.id, report1.variantId],
        )
      ).rows[0]!;

      await h.db.query(
        `INSERT INTO release_jobs(id,subject,client_id,channel,upload_session_id,manifest_digest,manifest,idempotency_key,request_digest,state,stage)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'dup-idempotency-key',$8,'READY','READY_TX')`,
        [
          dupJobId,
          existing.subject,
          existing.client_id,
          existing.channel,
          existing.upload_session_id,
          existing.manifest_digest,
          existing.manifest,
          existing.request_digest,
        ],
      );
      await h.db.query(
        `INSERT INTO package_releases(id,job_id,name,version,sha256,metadata,state)
         VALUES ($1,$2,$3,'0.0.99-dup',$4,$5,'READY')`,
        [dupPkgReleaseId, dupJobId, existing.name, shot1.packageSha256, existing.pkg_metadata],
      );
      await h.db.query(
        `INSERT INTO variant_releases(id,variant_id,package_release_id,metadata,availability)
         VALUES ($1,$2,$3,$4,'Ready')`,
        [dupVariantReleaseId, report1.variantId, dupPkgReleaseId, existing.vr_metadata],
      );
      await h.db.query(
        `INSERT INTO screenshots(id,job_id,variant_release_id,client_ref,example_id,environment_key,source,report_id,object_key,sha256,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,'local-automatic',$7,$8,$9,$10)`,
        [
          dupShotId,
          dupJobId,
          dupVariantReleaseId,
          shot1.id, // 与首版完全相同的 client_ref！
          report1.exampleId,
          shot1.environmentKey,
          existing.report_id,
          existing.object_key,
          shot1.image.sha256,
          existing.metadata,
        ],
      );

      // 不传 jobId 直接用本地 client_ref 时，数据库匹配两条授权记录 -> 触发 409 CONFLICT
      const ambiguousRes = await acceptBaseline({
        reportPath: reportPath1,
        reason: '未带 jobId 产生多版本歧义',
        apiUrl,
        token: aliceToken,
        expectedRevision: rev2,
      });
      expect(ambiguousRes.ok).toBe(false);
      expect(ambiguousRes.status).toBe(409);
      expect(ambiguousRes.errorCode).toBe('CONFLICT');

      // 传入 jobId 从 releaseJob.baselineCandidates 映射唯一服务端 screenshotId -> 成功推进至 rev3
      const disambiguatedRes = await acceptBaseline({
        reportPath: reportPath1,
        reason: '通过 baselineCandidates 精确消歧确认',
        apiUrl,
        token: aliceToken,
        jobId: rel1.jobId!,
        expectedRevision: rev2,
      });
      expect(disambiguatedRes.ok, disambiguatedRes.error).toBe(true);
      expect(disambiguatedRes.revisionId).toBeTruthy();
      expect(disambiguatedRes.revisionId).not.toBe(rev2);
    },
    180_000,
  );
});


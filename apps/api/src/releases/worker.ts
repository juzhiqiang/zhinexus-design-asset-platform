import { randomUUID } from 'node:crypto';
import type { ApiMessages, ReleaseManifestV1 } from '@company/contracts';
import type { Database } from '../db/database.js';
import { audit, type RequestContext } from '../db/access.js';
import type { ArtifactStore } from '../storage/artifact-store.js';
import { PlatformError } from '../errors.js';
import type { RegistryClient } from './registry-client.js';

export type JobSnapshot = {
  jobId: string;
  state: ApiMessages['releaseJobResponse']['state'];
  stage: ApiMessages['releaseJobResponse']['stage'];
  attempt: number;
  lastError?: ApiMessages['releaseJobResponse']['lastError'] | null;
};

type DbJob = {
  id: string;
  subject: string;
  client_id: string;
  channel: string;
  upload_session_id: string;
  manifest_digest: string;
  manifest: ReleaseManifestV1;
  idempotency_key: string;
  request_digest: string;
  state: ApiMessages['releaseJobResponse']['state'];
  stage: ApiMessages['releaseJobResponse']['stage'];
  attempt: number;
  fencing_token: string;
  lease_until: Date | null;
  last_error: ApiMessages['releaseJobResponse']['lastError'] | null;
};

export async function advanceRelease(
  jobId: string,
  db: Database,
  store: ArtifactStore,
  registry: RegistryClient,
  context?: RequestContext,
): Promise<JobSnapshot> {
  // 1. 读取当前作业状态
  const jobRow = (
    await db.query<DbJob>('SELECT * FROM release_jobs WHERE id=$1', [jobId])
  ).rows[0];

  if (!jobRow) {
    throw new PlatformError('NOT_FOUND');
  }

  if (jobRow.state === 'READY') {
    return {
      jobId: jobRow.id,
      state: 'READY',
      stage: jobRow.stage,
      attempt: jobRow.attempt,
      lastError: jobRow.last_error,
    };
  }

  if (jobRow.state === 'CONFLICT' || jobRow.state === 'REJECTED') {
    return {
      jobId: jobRow.id,
      state: jobRow.state,
      stage: jobRow.stage,
      attempt: jobRow.attempt,
      lastError: jobRow.last_error,
    };
  }

  // 2. CAS 声明并认领租约
  const claimed = await db.transaction(async (client) => {
    const row = (
      await client.query<DbJob>('SELECT * FROM release_jobs WHERE id=$1 FOR UPDATE', [jobId])
    ).rows[0];

    if (!row) throw new PlatformError('NOT_FOUND');
    if (row.state === 'READY' || row.state === 'CONFLICT' || row.state === 'REJECTED') {
      return row;
    }

    if (row.state === 'PUBLISHING' && row.lease_until && row.lease_until.getTime() > Date.now()) {
      // 另一个 worker 正在持有有效租约处理中
      return row;
    }

    const updated = await client.query<DbJob>(
      `UPDATE release_jobs
       SET state='PUBLISHING',
           stage='ENSURE_PACKAGES',
           fencing_token=fencing_token+1,
           lease_until=now()+interval '2 minutes',
           updated_at=now()
       WHERE id=$1
       RETURNING *`,
      [jobId],
    );

    return updated.rows[0]!;
  });

  if (claimed.state !== 'PUBLISHING') {
    return {
      jobId: claimed.id,
      state: claimed.state,
      stage: claimed.stage,
      attempt: claimed.attempt,
      lastError: claimed.last_error,
    };
  }

  const fence = claimed.fencing_token;
  const manifest = claimed.manifest;

  try {
    // 3. 读取该 session 冻结文件的 object_key / frozen_key 映射
    const fileRows = (
      await db.query<{ path: string; bytes: string; frozen_key: string }>(
        'SELECT path, bytes, frozen_key FROM upload_files WHERE session_id=$1',
        [claimed.upload_session_id],
      )
    ).rows;

    const frozenMap = new Map<string, { bytes: number; key: string }>();
    for (const file of fileRows) {
      if (file.frozen_key) {
        frozenMap.set(file.path, { bytes: Number(file.bytes), key: file.frozen_key });
      }
    }

    // 4. 按拓扑顺序依次发布候选包：@company/charts-core 必须先于 vue 和 react
    const orderedPackages = [...manifest.packages].sort((a, b) => {
      if (a.name === '@company/charts-core') return -1;
      if (b.name === '@company/charts-core') return 1;
      return a.name.localeCompare(b.name);
    });

    for (const pkg of orderedPackages) {
      const frozenInfo = frozenMap.get(pkg.tarball.path);
      if (!frozenInfo) {
        throw new PlatformError('INFRA_UNAVAILABLE');
      }

      const tarballBytes = await store.read(frozenInfo.key, frozenInfo.bytes);

      // ensurePackage：同名同版本同摘要返回 already-identical；不同内容抛出 CONFLICT；未发布则发布 candidate 标签
      await registry.ensurePackage(pkg, tarballBytes, `candidate-${claimed.id}`);
    }

    // 5. 校验包在注册表中的依赖拓扑可达性
    const availability = await registry.checkAvailability(manifest);
    if (!availability.ok) {
      const errPayload = {
        code: 'INFRA_UNAVAILABLE' as const,
        message: 'Published packages are not yet available from the registry in topological order',
        details: [],
        requestId: randomUUID(),
      };
      await db.query(
        `UPDATE release_jobs
         SET state='RETRY_WAIT',
             stage='CHECK_AVAILABILITY',
             lease_until=now()+interval '15 seconds',
             attempt=attempt+1,
             last_error=$2,
             updated_at=now()
         WHERE id=$1 AND fencing_token=$3`,
        [jobId, JSON.stringify(errPayload), fence],
      );

      return {
        jobId,
        state: 'RETRY_WAIT',
        stage: 'CHECK_AVAILABILITY',
        attempt: claimed.attempt + 1,
        lastError: errPayload,
      };
    }

    // 6. 推进 npm dist-tag 至 latest
    for (const pkg of manifest.packages) {
      await registry.promoteDistTag(pkg.name, pkg.version, 'latest');
    }

    // 7. READY_TX 原子登记
    await db.transaction(async (client) => {
      const current = await client.query<DbJob>('SELECT * FROM release_jobs WHERE id=$1 FOR UPDATE', [
        jobId,
      ]);
      if (current.rows[0]?.fencing_token !== fence) {
        throw new PlatformError('LEASE_LOST');
      }

      await client.query("UPDATE package_releases SET state='READY' WHERE job_id=$1", [jobId]);
      await client.query(
        `UPDATE variant_releases
         SET availability='Ready'
         WHERE package_release_id IN (SELECT id FROM package_releases WHERE job_id=$1)`,
        [jobId],
      );

      await client.query(
        `UPDATE release_jobs
         SET state='READY',
             stage='READY',
             lease_until=NULL,
             last_error=NULL,
             updated_at=now()
         WHERE id=$1`,
        [jobId],
      );

      await audit(
        client,
        claimed.subject,
        'RELEASE_READY',
        jobId,
        { manifestDigest: claimed.manifest_digest },
        context?.requestId ?? randomUUID(),
      );
    });

    return {
      jobId,
      state: 'READY',
      stage: 'READY',
      attempt: claimed.attempt,
      lastError: null,
    };
  } catch (error) {
    if (error instanceof PlatformError && error.code === 'CONFLICT') {
      const detailMsg = error.details?.[0]?.message;
      const errPayload = {
        code: 'CONFLICT' as const,
        message: detailMsg ?? error.message ?? '同名同版本不同内容严禁覆盖发布',
        details: error.details,
        requestId: randomUUID(),
      };
      await db.query(
        `UPDATE release_jobs
         SET state='CONFLICT',
             stage='CONFLICT',
             lease_until=NULL,
             last_error=$2,
             updated_at=now()
         WHERE id=$1 AND fencing_token=$3`,
        [jobId, JSON.stringify(errPayload), fence],
      );

      return {
        jobId,
        state: 'CONFLICT',
        stage: 'CONFLICT',
        attempt: claimed.attempt,
        lastError: errPayload,
      };
    }

    // 其他可重试异常
    const msg = error instanceof Error ? error.message : String(error);
    const newAttempt = claimed.attempt + 1;
    const isExhausted = newAttempt >= 5;
    const nextState = isExhausted ? 'REJECTED' : 'RETRY_WAIT';
    const errPayload = {
      code: isExhausted ? ('LIMIT_EXCEEDED' as const) : ('INFRA_UNAVAILABLE' as const),
      message: msg,
      details: [],
      requestId: randomUUID(),
    };

    await db.query(
      `UPDATE release_jobs
       SET state=$2,
           stage=$3,
           lease_until=now()+interval '15 seconds',
           attempt=$4,
           last_error=$5,
           updated_at=now()
       WHERE id=$1 AND fencing_token=$6`,
      [
        jobId,
        nextState,
        nextState,
        newAttempt,
        JSON.stringify(errPayload),
        fence,
      ],
    );

    return {
      jobId,
      state: nextState,
      stage: nextState,
      attempt: newAttempt,
      lastError: errPayload,
    };
  }
}

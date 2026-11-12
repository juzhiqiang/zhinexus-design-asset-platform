import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { manifestDigest } from '../contracts/digests.js';
import type { ReleaseManifestV1 } from '../contracts/release-manifest.js';
import type { ApiMessages } from '../contracts/api.js';
import { loadReleaseBundle } from './manifest.js';

export type ReleaseSession = {
  manifestDigest: string;
  idempotencyKey: string;
  uploadSessionId?: string;
  jobId?: string;
  state?: string;
  updatedAt: string;
};

export type ReleaseCommandOptions = {
  bundleDir?: string;
  apiUrl?: string;
  token?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onProgress?: (msg: string) => void;
};

export type ReleaseCommandResult = {
  ok: boolean;
  jobId?: string;
  state?: string;
  stage?: string;
  error?: string;
  session: ReleaseSession;
};

export type StatusCommandOptions = {
  jobId?: string;
  bundleDir?: string;
  apiUrl?: string;
  token?: string;
};

export type StatusCommandResult = {
  ok: boolean;
  status?: ApiMessages['releaseJobResponse'];
  error?: string;
};

const SESSION_FILE = '.release-session.json';

export async function loadReleaseSession(bundleDir: string): Promise<ReleaseSession | null> {
  const sessionPath = path.join(bundleDir, SESSION_FILE);
  if (!fs.existsSync(sessionPath)) return null;
  try {
    const raw = await fs.promises.readFile(sessionPath, 'utf8');
    return JSON.parse(raw) as ReleaseSession;
  } catch {
    return null;
  }
}

export async function saveReleaseSession(
  bundleDir: string,
  session: ReleaseSession,
): Promise<void> {
  const sessionPath = path.join(bundleDir, SESSION_FILE);
  session.updatedAt = new Date().toISOString();
  await fs.promises.writeFile(sessionPath, JSON.stringify(session, null, 2) + '\n', 'utf8');
}

/**
 * 客户端真实发布闭环：
 * 1. 检查是否存在同摘要的本地发布会话（断点恢复）；
 * 2. 上传材料文件至平台存储并完成校验（POST /v1/uploads & complete）；
 * 3. 提交发布作业（POST /v1/releases，附带幂等键）；
 * 4. 轮询作业状态直至终态（READY / CONFLICT / REJECTED）。
 */
export async function executeReleaseCommand(
  options: ReleaseCommandOptions,
): Promise<ReleaseCommandResult> {
  const bundleDir = path.resolve(options.bundleDir ?? '.release-bundle');
  const log = options.onProgress ?? (() => {});

  if (!fs.existsSync(bundleDir)) {
    throw new Error(`BUNDLE_DIR_NOT_FOUND: 指定的 Bundle 目录不存在: ${bundleDir}`);
  }

  const { manifest, filesMap } = await loadReleaseBundle(bundleDir);
  const currentDigest = await manifestDigest(manifest);

  // 检测本地会话以实现断点恢复
  let session = await loadReleaseSession(bundleDir);
  if (session && session.manifestDigest === currentDigest) {
    log(`检测到已存在的同摘要发布会话，复用原幂等键 ${session.idempotencyKey}`);
  } else {
    session = {
      manifestDigest: currentDigest,
      idempotencyKey: options.idempotencyKey ?? `release-${crypto.randomUUID()}`,
      updatedAt: new Date().toISOString(),
    };
    await saveReleaseSession(bundleDir, session);
  }

  const apiUrl = (options.apiUrl ?? process.env.PLATFORM_API_URL ?? 'http://127.0.0.1:3000').replace(
    /\/+$/,
    '',
  );
  const token = options.token ?? process.env.PLATFORM_TOKEN ?? process.env.PLATFORM_API_TOKEN;

  if (!token) {
    throw new Error('AUTH_TOKEN_REQUIRED: 发布必须提供认证凭证 (--token 或 PLATFORM_TOKEN 环境变量)');
  }

  const timeoutMs = options.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;

  // 1. 上传文件会话
  if (!session.uploadSessionId) {
    log('正在向平台创建上传会话 (POST /v1/uploads)...');
    const uploadReqRes = await fetch(`${apiUrl}/v1/uploads`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        manifestDigest: currentDigest,
        files: manifest.files,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!uploadReqRes.ok) {
      const errBody = await uploadReqRes.text();
      throw new Error(`CREATE_UPLOAD_FAILED: 创建上传会话失败 (${uploadReqRes.status}): ${errBody}`);
    }

    const plan = (await uploadReqRes.json()) as ApiMessages['createUploadResponse'];
    session.uploadSessionId = plan.uploadSessionId;
    await saveReleaseSession(bundleDir, session);

    log(`上传计划已就绪，共有 ${plan.files.length} 个文件待传输...`);
    for (const filePlan of plan.files) {
      const fileBytes = filesMap.get(filePlan.path);
      if (!fileBytes) {
        throw new Error(`BUNDLE_FILE_MISSING: Bundle 缺少待上传文件: ${filePlan.path}`);
      }

      const putRes = await fetch(filePlan.uploadUrl, {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
        },
        body: Buffer.from(fileBytes),
        signal: AbortSignal.timeout(60_000),
      });

      if (!putRes.ok) {
        throw new Error(`FILE_UPLOAD_FAILED: 文件上传失败 ${filePlan.path} (${putRes.status})`);
      }
    }

    log('所有文件传输完成，正在通知服务端执行字节与摘要核对 (POST /v1/uploads/:id/complete)...');
    const completeRes = await fetch(`${apiUrl}/v1/uploads/${session.uploadSessionId}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ parts: [] }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!completeRes.ok) {
      const errBody = await completeRes.text();
      throw new Error(`COMPLETE_UPLOAD_FAILED: 完成上传核验失败 (${completeRes.status}): ${errBody}`);
    }
  } else {
    log(`复用已完成的上传会话: ${session.uploadSessionId}`);
  }

  // 2. 提交发布作业
  if (!session.jobId) {
    log('正在向平台提交发布作业 (POST /v1/releases)...');
    const releaseRes = await fetch(`${apiUrl}/v1/releases`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': session.idempotencyKey,
      },
      body: JSON.stringify({
        uploadSessionId: session.uploadSessionId,
        manifest,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!releaseRes.ok && releaseRes.status !== 202) {
      const errBody = await releaseRes.text();
      throw new Error(`CREATE_RELEASE_FAILED: 提交发布作业失败 (${releaseRes.status}): ${errBody}`);
    }

    const relData = (await releaseRes.json()) as ApiMessages['createReleaseResponse'];
    session.jobId = relData.jobId;
    session.state = relData.state;
    await saveReleaseSession(bundleDir, session);
    log(`发布作业已创建: ${session.jobId} (初始状态: ${session.state})`);
  } else {
    log(`复用已存在的发布作业: ${session.jobId}`);
  }

  // 3. 轮询作业状态直至完成
  log('开始轮询发布作业状态...');
  while (Date.now() < deadline) {
    const statusRes = await fetch(`${apiUrl}/v1/releases/${session.jobId}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!statusRes.ok) {
      const errBody = await statusRes.text();
      throw new Error(`QUERY_RELEASE_FAILED: 查询发布作业状态失败 (${statusRes.status}): ${errBody}`);
    }

    const statusData = (await statusRes.json()) as ApiMessages['releaseJobResponse'];
    session.state = statusData.state;
    await saveReleaseSession(bundleDir, session);

    log(`[${statusData.state}] 阶段: ${statusData.stage}, 重试次数: ${statusData.attempt}`);

    if (statusData.state === 'READY') {
      log('✔ 资产已发布成功并达到 Ready 状态！');
      return {
        ok: true,
        jobId: session.jobId,
        state: 'READY',
        stage: statusData.stage,
        session,
      };
    }

    if (statusData.state === 'CONFLICT' || statusData.state === 'REJECTED') {
      const errMessage =
        statusData.lastError?.details?.[0]?.message ??
        statusData.lastError?.message ??
        `发布失败终止于状态: ${statusData.state}`;
      log(`✖ 发布失败: ${errMessage}`);
      return {
        ok: false,
        jobId: session.jobId,
        state: statusData.state,
        stage: statusData.stage,
        error: errMessage,
        session,
      };
    }

    if (statusData.state === 'RETRY_WAIT') {
      log('作业等待重试，正在触发平台重试机制 (POST /v1/releases/:id/retry)...');
      await fetch(`${apiUrl}/v1/releases/${session.jobId}/retry`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => {});
    }

    const pollInterval = options.pollIntervalMs ?? statusData.pollAfterMs ?? 1000;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollInterval, 3000)));
  }

  throw new Error(`RELEASE_TIMEOUT: 发布作业在 ${timeoutMs}ms 内未达到终态 (当前状态: ${session.state})`);
}

/**
 * 查询发布作业状态
 */
export async function executeStatusCommand(
  options: StatusCommandOptions,
): Promise<StatusCommandResult> {
  const bundleDir = path.resolve(options.bundleDir ?? '.release-bundle');
  let jobId = options.jobId;

  if (!jobId && fs.existsSync(bundleDir)) {
    const session = await loadReleaseSession(bundleDir);
    jobId = session?.jobId;
  }

  if (!jobId) {
    return {
      ok: false,
      error: '必须指定 --job-id 或在包含 .release-session.json 的 Bundle 目录下执行',
    };
  }

  const apiUrl = (options.apiUrl ?? process.env.PLATFORM_API_URL ?? 'http://127.0.0.1:3000').replace(
    /\/+$/,
    '',
  );
  const token = options.token ?? process.env.PLATFORM_TOKEN ?? process.env.PLATFORM_API_TOKEN;

  if (!token) {
    return {
      ok: false,
      error: '查询发布作业状态需要认证凭据 (--token 或 PLATFORM_TOKEN)',
    };
  }

  const res = await fetch(`${apiUrl}/v1/releases/${jobId}`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      ok: false,
      error: `查询失败 (${res.status}): ${text}`,
    };
  }

  const status = (await res.json()) as ApiMessages['releaseJobResponse'];
  return {
    ok: true,
    status,
  };
}

/**
 * 恢复中断的发布作业
 */
export async function executeResumeCommand(
  options: ReleaseCommandOptions,
): Promise<ReleaseCommandResult> {
  return executeReleaseCommand(options);
}


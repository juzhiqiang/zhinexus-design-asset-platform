import type {
  ArtifactRef,
  PackageRef,
  ReleaseManifestV1,
  VariantRef,
} from '@company/contracts';
import { manifestDigest } from '@company/contracts';

/**
 * 在浏览器端通过 Web Crypto 计算字节数组的 SHA-256 哈希
 */
export async function computeBrowserSha256(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 将用户导入的 Manifest 强制转换为合规的网页手动提交格式 (channel: 'web')
 * 1. channel 强制为 'web'；
 * 2. 所有关联截图强制转换为 source: 'manual-upload' 与 environmentKey: 'unknown-manual'；
 * 3. 移除伪造的 local-automatic 报告或将兼容性结果置为 candidate；
 * 4. 汇总所有必须上传的文件清单 files。
 */
export function sanitizeWebManifest(input: ReleaseManifestV1): ReleaseManifestV1 {
  const sanitizedVariants: VariantRef[] = input.variants.map((variant) => {
    const manualScreenshots = variant.screenshots.map((shot) => ({
      ...shot,
      source: 'manual-upload' as const,
      environmentKey: 'unknown-manual',
      reportId: undefined, // 手动上传清除非关联报告
    }));

    // 网页手动提交不声称 passed
    const compatibility = variant.compatibility.map((c) => ({
      ...c,
      status: 'candidate' as const,
      reportId: undefined,
    }));

    return {
      ...variant,
      screenshots: manualScreenshots,
      compatibility,
    };
  });

  // 整理 files 清单
  const fileSet = new Map<string, ArtifactRef>();
  for (const pkg of input.packages) {
    fileSet.set(pkg.tarball.path, pkg.tarball);
  }
  for (const v of sanitizedVariants) {
    fileSet.set(v.api.path, v.api);
    fileSet.set(v.docs.path, v.docs);
    for (const ex of v.examples) {
      for (const pf of ex.previewFiles) {
        fileSet.set(pf.path, pf);
      }
    }
    for (const shot of v.screenshots) {
      fileSet.set(shot.image.path, shot.image);
    }
  }

  const files = [...fileSet.values()].sort((a, b) => a.path.localeCompare(b.path));

  return {
    schemaVersion: 1,
    channel: 'web',
    packages: input.packages,
    variants: sanitizedVariants,
    reports: [], // 手动提交无自动检测报告
    files,
  };
}

export type UploadSessionResponse = {
  uploadSessionId: string;
  files: Array<{
    path: string;
    uploadUrl: string;
    expiresAt: string;
  }>;
};

/**
 * 创建上传会话 (POST /v1/uploads)
 */
export async function createUploadSession(
  apiUrl: string,
  token: string,
  manifest: ReleaseManifestV1,
): Promise<UploadSessionResponse> {
  const digest = await manifestDigest(manifest);
  const res = await fetch(`${apiUrl}/v1/uploads`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      manifestDigest: digest,
      files: manifest.files,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`创建上传会话失败 (${res.status}): ${errorText}`);
  }

  return (await res.json()) as UploadSessionResponse;
}

/**
 * 直传单个文件至对象存储预签名 URL (PUT uploadUrl)
 */
export async function uploadFileBytes(
  uploadUrl: string,
  bytes: Uint8Array,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'content-length': String(bytes.length),
    },
    body: bytes as unknown as BodyInit,
  });

  if (!res.ok) {
    throw new Error(`文件上传失败 (${res.status})`);
  }

  if (onProgress) {
    onProgress(bytes.length, bytes.length);
  }
}

/**
 * 完成上传核验 (POST /v1/uploads/:id/complete)
 */
export async function completeUploadSession(
  apiUrl: string,
  token: string,
  sessionId: string,
): Promise<void> {
  const res = await fetch(`${apiUrl}/v1/uploads/${sessionId}/complete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ parts: [] }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`确认上传完成失败 (${res.status}): ${errorText}`);
  }
}

/**
 * 提交发布作业 (POST /v1/releases)
 */
export async function submitReleaseJob(
  apiUrl: string,
  token: string,
  sessionId: string,
  manifest: ReleaseManifestV1,
  idempotencyKey: string,
): Promise<{ jobId: string; state: string }> {
  const res = await fetch(`${apiUrl}/v1/releases`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify({
      uploadSessionId: sessionId,
      manifest,
    }),
  });

  if (!res.ok && res.status !== 202) {
    const errorText = await res.text();
    throw new Error(`提交发布作业失败 (${res.status}): ${errorText}`);
  }

  return (await res.json()) as { jobId: string; state: string };
}

/**
 * 查询发布作业状态 (GET /v1/releases/:jobId)
 */
export async function fetchReleaseJob(
  apiUrl: string,
  token: string,
  jobId: string,
): Promise<any> {
  const res = await fetch(`${apiUrl}/v1/releases/${jobId}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`查询作业状态失败 (${res.status}): ${errorText}`);
  }

  return await res.json();
}

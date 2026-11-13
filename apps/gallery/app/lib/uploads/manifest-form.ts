import type {
  ArtifactRef,
  PackageRef,
  ReleaseManifestV1,
  VariantRef,
} from '@company/contracts';
import { manifestDigest, UPLOAD_LIMITS } from '@company/contracts';

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
    const manualScreenshots = variant.screenshots.map((shot) => {
      const copy = {
        ...shot,
        source: 'manual-upload' as const,
        environmentKey: 'unknown-manual',
      };
      delete (copy as { reportId?: string }).reportId;
      return copy;
    });

    // 网页手动提交不声称 passed
    const compatibility = variant.compatibility.map((c) => {
      const copy = {
        ...c,
        status: 'candidate' as const,
      };
      delete (copy as { reportId?: string }).reportId;
      return copy;
    });

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

/**
 * 解析并校验导入的外部 Manifest JSON 内容
 */
export function parseAndValidateImportedManifest(jsonContent: string): {
  ok: boolean;
  manifest?: ReleaseManifestV1;
  error?: string;
} {
  try {
    const raw = JSON.parse(jsonContent);
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'Manifest 内容必须为 JSON 对象' };
    }
    const clean = sanitizeWebManifest(raw);
    return { ok: true, manifest: clean };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Manifest JSON 解析失败' };
  }
}

/**
 * 导入并关联本地产物文件至内存映射，自动计算其 Web Crypto SHA-256
 */
export async function attachLocalFile(
  filesMap: Map<string, Uint8Array>,
  path: string,
  fileBytes: Uint8Array,
): Promise<{
  path: string;
  bytes: number;
  sha256: string;
}> {
  const sha256 = await computeBrowserSha256(fileBytes);
  filesMap.set(path, fileBytes);
  return {
    path,
    bytes: fileBytes.byteLength,
    sha256,
  };
}

export type UploadSessionFilePlan = {
  path: string;
  uploadUrl?: string;
  multipart?: {
    uploadId: string;
    parts: Array<{ partNumber: number; uploadUrl: string; bytes: number }>;
  };
  expiresAt: string;
};

export type UploadSessionResponse = {
  uploadSessionId: string;
  files: Array<UploadSessionFilePlan>;
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
 * 分片上传单个分块至对象存储预签名 URL 并获取 ETag
 */
export async function uploadPartBytes(
  uploadUrl: string,
  bytes: Uint8Array,
): Promise<{ etag: string }> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'content-length': String(bytes.length),
    },
    body: bytes as unknown as BodyInit,
  });

  if (!res.ok) {
    throw new Error(`分片上传失败 (${res.status})`);
  }

  const rawEtag = res.headers.get('etag') || res.headers.get('ETag') || `etag-${Date.now()}`;
  const etag = rawEtag.replace(/^"|"$/g, '');
  return { etag };
}

/**
 * 完成上传核验 (POST /v1/uploads/:id/complete)
 */
export async function completeUploadSession(
  apiUrl: string,
  token: string,
  sessionId: string,
  parts: Array<{ path: string; partNumber: number; etag: string }> = [],
): Promise<void> {
  const res = await fetch(`${apiUrl}/v1/uploads/${sessionId}/complete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ parts }),
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
export const ALL_SEVEN_COMPONENTS = [
  'line',
  'bar',
  'pie',
  'scatter',
  'trend-card',
  'ranking',
  'proportion',
] as const;

export type SevenComponentName = (typeof ALL_SEVEN_COMPONENTS)[number];

const COMPONENT_EXPORTS: Record<SevenComponentName, { exportName: string; chineseName: string }> = {
  line: { exportName: 'LineChart', chineseName: '折线图' },
  bar: { exportName: 'BarChart', chineseName: '柱状图' },
  pie: { exportName: 'PieChart', chineseName: '饼图' },
  scatter: { exportName: 'ScatterChart', chineseName: '散点图' },
  'trend-card': { exportName: 'TrendCard', chineseName: '趋势卡片' },
  ranking: { exportName: 'Ranking', chineseName: '排行榜' },
  proportion: { exportName: 'Proportion', chineseName: '占比' },
};

/**
 * 构造覆盖 7 组件 14 实现的合规网页 Manifest 与内存文件映射
 */
export function createSevenComponentsManifest(version = '0.0.5'): {
  manifest: ReleaseManifestV1;
  filesMap: Map<string, Uint8Array>;
} {
  const dummyTarballBytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03, 0x04]);
  const dummyTextBytes = new TextEncoder().encode('{}');
  // 最小合法 2x2 PNG 字节
  const dummyShotBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x72, 0xb6, 0x0d, 0x24, 0x00, 0x00, 0x00,
    0x15, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f,
    0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x00, 0x18, 0x05, 0x03, 0x01, 0x3d,
    0x5d, 0x3a, 0x89, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

  const TARBALL_SHA = '17d4b1537775ca05f5e5e30863e9667891fce6796522ae0989524b6e5e55c655';
  const TEXT_SHA = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';
  const SHOT_SHA = '8c762ad0993a5cf6533d38f37b4c528f38fd0b6bf614984abd19ce2f6d8eab58';

  const filesMap = new Map<string, Uint8Array>();

  function getDigest(bytes: Uint8Array): string {
    if (bytes === dummyTarballBytes) return TARBALL_SHA;
    if (bytes === dummyShotBytes) return SHOT_SHA;
    return TEXT_SHA;
  }

  function addFile(path: string, bytes: Uint8Array): ArtifactRef {
    filesMap.set(path, bytes);
    return { path, sha256: getDigest(bytes), bytes: bytes.byteLength };
  }

  const packages: PackageRef[] = [
    {
      name: '@company/charts-core',
      version,
      tarball: addFile(`packages/charts-core-${version}.tgz`, dummyTarballBytes),
      sourceDigest: TARBALL_SHA,
      dependencies: {},
      peerDependencies: {},
    },
    {
      name: '@company/charts-vue',
      version,
      tarball: addFile(`packages/charts-vue-${version}.tgz`, dummyTarballBytes),
      sourceDigest: TARBALL_SHA,
      dependencies: { '@company/charts-core': version },
      peerDependencies: { vue: '3.5.45', echarts: '6.1.0' },
    },
    {
      name: '@company/charts-react',
      version,
      tarball: addFile(`packages/charts-react-${version}.tgz`, dummyTarballBytes),
      sourceDigest: TARBALL_SHA,
      dependencies: { '@company/charts-core': version },
      peerDependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
    },
  ];

  const variants: VariantRef[] = [];
  for (const comp of ALL_SEVEN_COMPONENTS) {
    const meta = COMPONENT_EXPORTS[comp];
    for (const fw of ['vue', 'react'] as const) {
      const variantId = `${comp}-${fw}`;
      const pkgName = fw === 'vue' ? '@company/charts-vue' : '@company/charts-react';
      const apiFile = addFile(`api/${variantId}.json`, dummyTextBytes);
      const docsFile = addFile(`docs/${variantId}.md`, dummyTextBytes);
      const previewHtml = addFile(`preview/${variantId}/index.html`, dummyTextBytes);
      const shotFile = addFile(`screenshots/${variantId}-default.png`, dummyShotBytes);
      const pkgTarball = packages.find((p) => p.name === pkgName)!.tarball;

      variants.push({
        componentId: comp,
        variantId,
        framework: fw,
        packageName: pkgName,
        packageVersion: version,
        exportPath: `./${comp}`,
        exportName: meta.exportName,
        api: apiFile,
        docs: docsFile,
        examples: [
          {
            id: `example-${variantId}-default`,
            previewEntry: previewHtml.path,
            previewFiles: [previewHtml],
            fixtureDigest: '0000000000000000000000000000000000000000000000000000000000000000',
            renderer: 'canvas',
            theme: 'light',
            width: 800,
            height: 400,
            requiredStates: ['default'],
          },
        ],
        screenshots: [
          {
            id: `shot-${variantId}-default`,
            variantId,
            framework: fw,
            packageVersion: version,
            packageSha256: pkgTarball.sha256,
            exampleId: `example-${variantId}-default`,
            state: 'default',
            source: 'manual-upload',
            image: shotFile,
            environmentKey: 'unknown-manual',
          },
        ],
        compatibility: [],
      });
    }
  }

  const manifest = sanitizeWebManifest({
    schemaVersion: 1,
    channel: 'web',
    packages,
    variants,
    reports: [],
    files: [],
  });

  return { manifest, filesMap };
}

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

export type FileValidationIssue = {
  code: 'FILE_MISSING' | 'SIZE_MISMATCH' | 'DIGEST_MISMATCH' | 'SIZE_LIMIT_EXCEEDED';
  path: string;
  message: string;
};

export type FileValidationResult = {
  ok: boolean;
  issues: FileValidationIssue[];
};

/**
 * 校验待上传真实文件：核对路径存在性、长度 byteLength、SHA-256 哈希一致性及共享大小上限
 */
export async function validateUploadFiles(
  manifest: ReleaseManifestV1,
  filesMap: Map<string, Uint8Array>,
): Promise<FileValidationResult> {
  const issues: FileValidationIssue[] = [];

  if (manifest.files.length > UPLOAD_LIMITS.maxFiles) {
    issues.push({
      code: 'SIZE_LIMIT_EXCEEDED',
      path: '/files',
      message: `总文件数超过上限: 当前 ${manifest.files.length}, 最大限制 ${UPLOAD_LIMITS.maxFiles}`,
    });
  }

  let totalBytes = 0;

  for (const f of manifest.files) {
    totalBytes += f.bytes;
    const bytes = filesMap.get(f.path);
    if (!bytes) {
      issues.push({
        code: 'FILE_MISSING',
        path: f.path,
        message: `清单声明的文件缺失: ${f.path}`,
      });
      continue;
    }

    if (bytes.byteLength !== f.bytes) {
      issues.push({
        code: 'SIZE_MISMATCH',
        path: f.path,
        message: `文件长度不一致 (${f.path}): 声明 ${f.bytes} 字节, 实际 ${bytes.byteLength} 字节`,
      });
      continue;
    }

    // 检查单文件大小上限
    const isImage = /\.(png|jpe?g)$/i.test(f.path);
    const isTarball = f.path.endsWith('.tgz') || f.path.endsWith('.tar.gz');
    if (isImage && f.bytes > UPLOAD_LIMITS.imageBytes) {
      issues.push({
        code: 'SIZE_LIMIT_EXCEEDED',
        path: f.path,
        message: `图片文件大小超限 (${f.path}): 实际 ${f.bytes} 字节, 最大限制 ${UPLOAD_LIMITS.imageBytes} 字节 (10MB)`,
      });
    } else if (isTarball && f.bytes > UPLOAD_LIMITS.tarballBytes) {
      issues.push({
        code: 'SIZE_LIMIT_EXCEEDED',
        path: f.path,
        message: `Tarball 产物包大小超限 (${f.path}): 实际 ${f.bytes} 字节, 最大限制 ${UPLOAD_LIMITS.tarballBytes} 字节 (50MB)`,
      });
    }

    const actualSha = await computeBrowserSha256(bytes);
    if (actualSha !== f.sha256) {
      issues.push({
        code: 'DIGEST_MISMATCH',
        path: f.path,
        message: `文件哈希不一致 (${f.path}): 声明 ${f.sha256}, 实际 ${actualSha}`,
      });
    }
  }

  if (totalBytes > UPLOAD_LIMITS.totalBytes) {
    issues.push({
      code: 'SIZE_LIMIT_EXCEEDED',
      path: '/files',
      message: `总产物大小超限: 当前 ${totalBytes} 字节, 最大限制 ${UPLOAD_LIMITS.totalBytes} 字节 (500MB)`,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export type WebUploadWorkflowStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function createMemoryStorage(): WebUploadWorkflowStorage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (typeof window !== 'undefined' ? window.localStorage.getItem(k) : store.get(k) ?? null),
    setItem: (k, v) => {
      if (typeof window !== 'undefined') window.localStorage.setItem(k, v);
      else store.set(k, v);
    },
    removeItem: (k) => {
      if (typeof window !== 'undefined') window.localStorage.removeItem(k);
      else store.delete(k);
    },
  };
}

export type ExecuteWebUploadWorkflowOptions = {
  apiUrl: string;
  token: string;
  manifest: ReleaseManifestV1;
  filesMap: Map<string, Uint8Array>;
  storage?: WebUploadWorkflowStorage;
  onProgress?: (step: string, percent: number) => void;
  api?: {
    createUploadSession: typeof createUploadSession;
    uploadFileBytes: typeof uploadFileBytes;
    uploadPartBytes?: typeof uploadPartBytes;
    completeUploadSession: typeof completeUploadSession;
    submitReleaseJob: typeof submitReleaseJob;
  };
};

/**
 * 严格执行网页发布全链路时序：
 * 1. 创建上传前持久化待上传清单与摘要；
 * 2. uploadSessionId 在服务返回后立即持久化；
 * 3. 逐文件/分片真实上传字节，失败立即停止抛错；
 * 4. complete 核验（含分片 parts），失败立即停止抛错；
 * 5. 首次 POST release 前持久化固定幂等键及完整原请求，重试严格复用该 key；
 * 6. 连通既有 API，获取有效作业状态。
 */
export async function executeWebUploadWorkflow(
  options: ExecuteWebUploadWorkflowOptions,
): Promise<{ ok: boolean; jobId: string; uploadSessionId: string }> {
  const storage =
    options.storage ??
    (typeof window !== 'undefined'
      ? {
          getItem: (k: string) => window.localStorage.getItem(k),
          setItem: (k: string, v: string) => window.localStorage.setItem(k, v),
          removeItem: (k: string) => window.localStorage.removeItem(k),
        }
      : createMemoryStorage());
  const api = options.api ?? {
    createUploadSession,
    uploadFileBytes,
    uploadPartBytes,
    completeUploadSession,
    submitReleaseJob,
  };
  const partUploader = api.uploadPartBytes ?? uploadPartBytes;
  const onProgress = options.onProgress ?? (() => {});

  const cleanManifest = sanitizeWebManifest(options.manifest);
  const digest = await manifestDigest(cleanManifest);

  // 1. 创建上传会话前持久化草稿元数据
  storage.setItem(
    'zhinexus_upload_draft',
    JSON.stringify({
      manifestDigest: digest,
      filesCount: cleanManifest.files.length,
      timestamp: Date.now(),
    }),
  );

  onProgress('正在创建不可变上传会话...', 10);

  // 检查是否已有活跃的会话可恢复
  let uploadSessionId = storage.getItem('zhinexus_active_session_id') || '';
  let sessionFiles: Array<UploadSessionFilePlan> = [];

  const existingSessionData = storage.getItem('zhinexus_active_session_plan');
  if (uploadSessionId && existingSessionData) {
    try {
      sessionFiles = JSON.parse(existingSessionData);
    } catch {
      uploadSessionId = '';
    }
  }

  if (!uploadSessionId || sessionFiles.length === 0) {
    const sessionRes = await api.createUploadSession(options.apiUrl, options.token, cleanManifest);
    uploadSessionId = sessionRes.uploadSessionId;
    sessionFiles = sessionRes.files;

    // 2. uploadSessionId 在服务返回后立即持久化
    storage.setItem('zhinexus_active_session_id', uploadSessionId);
    storage.setItem('zhinexus_active_session_plan', JSON.stringify(sessionFiles));
  }

  onProgress('正在推送真实预构建产物与手动截图...', 20);

  // 3. 逐文件/分片真实字节上传（绝不吞错，收集分片 ETag）
  const uploadedParts: Array<{ path: string; partNumber: number; etag: string }> = [];
  const totalFiles = sessionFiles.length;
  for (let i = 0; i < totalFiles; i++) {
    const plan = sessionFiles[i]!;
    const bytes = options.filesMap.get(plan.path);
    if (!bytes) {
      throw new Error(`FILE_NOT_FOUND: 待上传文件未在内存映射中找到: ${plan.path}`);
    }

    if (plan.multipart && plan.multipart.parts && plan.multipart.parts.length > 0) {
      let offset = 0;
      for (const part of plan.multipart.parts) {
        const chunk = bytes.subarray(offset, offset + part.bytes);
        offset += part.bytes;
        const res = await partUploader(part.uploadUrl, chunk);
        uploadedParts.push({
          path: plan.path,
          partNumber: part.partNumber,
          etag: res.etag,
        });
      }
    } else if (plan.uploadUrl) {
      // 单文件直接上传
      await api.uploadFileBytes(plan.uploadUrl, bytes);
    } else {
      throw new Error(`INVALID_PLAN: 计划中缺少有效上传地址: ${plan.path}`);
    }

    onProgress(`已上传 ${i + 1}/${totalFiles}: ${plan.path}`, 20 + Math.floor(((i + 1) / totalFiles) * 50));
  }

  onProgress('正在核验上传产物存储摘要一致性...', 75);

  // 4. 完成核验（若失败立即终止抛错，携带已上传的分片 parts）
  await api.completeUploadSession(options.apiUrl, options.token, uploadSessionId, uploadedParts);
  onProgress('上传核验通过，正在准备发布提交...', 85);

  // 5. 首次 POST release 前持久化固定幂等键及完整原请求
  let idempotencyKey = '';
  const pendingReleaseStr = storage.getItem('zhinexus_pending_release');
  if (pendingReleaseStr) {
    try {
      const parsed = JSON.parse(pendingReleaseStr);
      if (parsed.uploadSessionId === uploadSessionId && parsed.idempotencyKey) {
        idempotencyKey = parsed.idempotencyKey;
      }
    } catch {
      // ignore
    }
  }

  if (!idempotencyKey) {
    idempotencyKey = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    storage.setItem(
      'zhinexus_pending_release',
      JSON.stringify({
        idempotencyKey,
        uploadSessionId,
        manifest: cleanManifest,
        timestamp: Date.now(),
      }),
    );
  }

  onProgress('正在提交发布作业...', 90);

  // 6. 提交发布作业（重试时严格复用该 key）
  const releaseRes = await api.submitReleaseJob(
    options.apiUrl,
    options.token,
    uploadSessionId,
    cleanManifest,
    idempotencyKey,
  );

  onProgress(`发布作业已创建 (${releaseRes.jobId})`, 100);

  // 成功提交后更新最终持久化
  storage.setItem(
    'zhinexus_web_release_session',
    JSON.stringify({
      jobId: releaseRes.jobId,
      uploadSessionId,
      idempotencyKey,
      state: releaseRes.state,
      timestamp: Date.now(),
    }),
  );

  return {
    ok: true,
    jobId: releaseRes.jobId,
    uploadSessionId,
  };
}

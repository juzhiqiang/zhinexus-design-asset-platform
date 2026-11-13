import { describe, expect, it, vi } from 'vitest';
import type { PackageRef, ReleaseManifestV1, VariantRef } from '@company/contracts';
import {
  computeBrowserSha256,
  sanitizeWebManifest,
  validateUploadFiles,
  executeWebUploadWorkflow,
  parseAndValidateImportedManifest,
  attachLocalFile,
  type WebUploadWorkflowStorage,
} from '../../apps/gallery/app/lib/uploads/manifest-form.js';
import {
  validateVariantScreenshots,
  createManualScreenshotRef,
} from '../../apps/gallery/app/lib/uploads/screenshot-validation.js';
import { pngBytes } from '../fixtures/t05-artifacts.js';

const ALL_SEVEN_COMPONENTS = [
  'line',
  'bar',
  'pie',
  'scatter',
  'trend-card',
  'ranking',
  'proportion',
] as const;

function createFourteenVariantManifest(): {
  manifest: ReleaseManifestV1;
  filesMap: Map<string, Uint8Array>;
} {
  const dummyTarballBytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03, 0x04]);
  const dummyTextBytes = new TextEncoder().encode('{}');
  const dummyShotBytes = pngBytes();

  const filesMap = new Map<string, Uint8Array>();
  const digestCache = new Map<string, string>();

  function addFile(path: string, bytes: Uint8Array) {
    filesMap.set(path, bytes);
    // 简易十六进制摘要生成
    let hash = 0;
    for (let i = 0; i < bytes.length; i++) hash = (hash * 31 + bytes[i]!) >>> 0;
    const sha = hash.toString(16).padStart(8, '0').repeat(8);
    digestCache.set(path, sha);
    return { path, sha256: sha, bytes: bytes.byteLength };
  }

  const packages: PackageRef[] = [
    {
      name: '@company/charts-core',
      version: '0.0.5',
      tarball: addFile('packages/charts-core-0.0.5.tgz', dummyTarballBytes),
      sourceDigest: '0000000000000000000000000000000000000000000000000000000000000001',
      dependencies: {},
      peerDependencies: {},
    },
    {
      name: '@company/charts-vue',
      version: '0.0.5',
      tarball: addFile('packages/charts-vue-0.0.5.tgz', dummyTarballBytes),
      sourceDigest: '0000000000000000000000000000000000000000000000000000000000000002',
      dependencies: { '@company/charts-core': '0.0.5' },
      peerDependencies: { vue: '3.5.45', echarts: '6.1.0' },
    },
    {
      name: '@company/charts-react',
      version: '0.0.5',
      tarball: addFile('packages/charts-react-0.0.5.tgz', dummyTarballBytes),
      sourceDigest: '0000000000000000000000000000000000000000000000000000000000000003',
      dependencies: { '@company/charts-core': '0.0.5' },
      peerDependencies: { react: '19.3.1', 'react-dom': '19.3.1', echarts: '6.1.0' },
    },
  ];

  const variants: VariantRef[] = [];
  for (const comp of ALL_SEVEN_COMPONENTS) {
    for (const fw of ['vue', 'react'] as const) {
      const variantId = `${comp}-${fw}`;
      const pkgName = fw === 'vue' ? '@company/charts-vue' : '@company/charts-react';
      const apiFile = addFile(`api/${variantId}.json`, dummyTextBytes);
      const docsFile = addFile(`docs/${variantId}.md`, dummyTextBytes);
      const previewHtml = addFile(`preview/${variantId}/index.html`, dummyTextBytes);
      const shotFile = addFile(`screenshots/${variantId}-default.png`, dummyShotBytes);

      variants.push({
        componentId: comp,
        variantId,
        framework: fw,
        packageName: pkgName,
        packageVersion: '0.0.5',
        exportPath: `./${comp}`,
        exportName: `${comp.charAt(0).toUpperCase()}${comp.slice(1)}Chart`,
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
          createManualScreenshotRef({
            id: `shot-${variantId}-default`,
            variantId,
            framework: fw,
            packageVersion: '0.0.5',
            packageSha256: filesMap.has(packages.find((p) => p.name === pkgName)!.tarball.path)
              ? digestCache.get(packages.find((p) => p.name === pkgName)!.tarball.path)!
              : '0000000000000000000000000000000000000000000000000000000000000000',
            exampleId: `example-${variantId}-default`,
            imagePath: shotFile.path,
            imageSha256: shotFile.sha256,
            imageBytes: shotFile.bytes,
            width: 800,
            height: 400,
          }),
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

describe('T08: 网页发布真实文件校验与逐实现必检', () => {
  it('验证覆盖 7 组件 14 实现的完整 Manifest 结构与逐实现截图合规', () => {
    const { manifest } = createFourteenVariantManifest();
    expect(manifest.packages).toHaveLength(3);
    expect(manifest.variants).toHaveLength(14);
    expect(manifest.channel).toBe('web');

    const result = validateVariantScreenshots(manifest.variants);
    expect(result.ok).toBe(true);
    expect(result.missingVariantIds).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
  });

  it('缺图阻断：当 14 实现中缺失任意变体截图时阻断提交并列出所有缺失项 (SCREENSHOT_REQUIRED)', () => {
    const { manifest } = createFourteenVariantManifest();
    // 移除 ranking-react 和 proportion-vue 的截图
    const rankingReact = manifest.variants.find((v) => v.variantId === 'ranking-react')!;
    const propVue = manifest.variants.find((v) => v.variantId === 'proportion-vue')!;
    rankingReact.screenshots = [];
    propVue.screenshots = [];

    const result = validateVariantScreenshots(manifest.variants);
    expect(result.ok).toBe(false);
    expect(result.missingVariantIds).toContain('ranking-react');
    expect(result.missingVariantIds).toContain('proportion-vue');
    expect(result.issues.some((i: { code: string }) => i.code === 'SCREENSHOT_REQUIRED')).toBe(true);
  });

  it('错框架阻断：若将 React 截图关联给 Vue 变体必须拦截 (SCREENSHOT_VARIANT_MISMATCH)', () => {
    const { manifest } = createFourteenVariantManifest();
    const lineVue = manifest.variants.find((v) => v.variantId === 'line-vue')!;
    // 篡改截图所属框架为 react
    lineVue.screenshots[0] = {
      ...lineVue.screenshots[0]!,
      framework: 'react',
    };

    const result = validateVariantScreenshots(manifest.variants);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i: { code: string }) => i.code === 'SCREENSHOT_VARIANT_MISMATCH')).toBe(true);
  });

  it('文件一致性校验：核对所有待上传文件的存在性、长度与 SHA-256 摘要', async () => {
    const { manifest, filesMap } = createFourteenVariantManifest();

    // 针对每个文件实际计算 Web Crypto SHA-256 并更新到 manifest
    for (const f of manifest.files) {
      const bytes = filesMap.get(f.path);
      expect(bytes).toBeDefined();
      const realSha = await computeBrowserSha256(bytes!);
      f.sha256 = realSha;
    }

    const checkResult = await validateUploadFiles(manifest, filesMap);
    expect(checkResult.ok).toBe(true);

    // 篡改其中一个文件的内容（保持长度相同，但内容修改以精确触发 DIGEST_MISMATCH）
    const firstFilePath = manifest.files[0]!.path;
    const originalBytes = filesMap.get(firstFilePath)!;
    const modifiedBytes = new Uint8Array(originalBytes);
    modifiedBytes[0] = modifiedBytes[0]! ^ 0xff; // 翻转一个字节
    filesMap.set(firstFilePath, modifiedBytes);

    const corruptedResult = await validateUploadFiles(manifest, filesMap);
    expect(corruptedResult.ok).toBe(false);
    expect(corruptedResult.issues[0]?.code).toBe('DIGEST_MISMATCH');
  });
});

describe('T08: 上传时序持久化、错误停止与幂等恢复', () => {
  it('时序持久化：严格在请求前持久化待上传草稿，返回后持久化 sessionId，发布前持久化固定幂等键', async () => {
    const { manifest, filesMap } = createFourteenVariantManifest();
    const calls: string[] = [];

    const mockStorageData = new Map<string, string>();
    const storage: WebUploadWorkflowStorage = {
      getItem: (k: string) => mockStorageData.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mockStorageData.set(k, v);
      },
      removeItem: (k: string) => {
        mockStorageData.delete(k);
      },
    };

    // 追踪调用时序
    const mockApi = {
      createUploadSession: vi.fn(async () => {
        calls.push('createUploadSession');
        // 断言在调用创建前，draft 已经被持久化
        expect(storage.getItem('zhinexus_upload_draft')).not.toBeNull();
        return {
          uploadSessionId: 'sess-001',
          files: manifest.files.map((f) => ({
            path: f.path,
            uploadUrl: `http://mock-storage/put/${f.path}`,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          })),
        };
      }),
      uploadFileBytes: vi.fn(async (_url, _bytes) => {
        calls.push('uploadFileBytes');
        // 断言在上传文件时，uploadSessionId 已经持久化
        expect(storage.getItem('zhinexus_active_session_id')).toBe('sess-001');
      }),
      completeUploadSession: vi.fn(async () => {
        calls.push('completeUploadSession');
      }),
      submitReleaseJob: vi.fn(async (_api, _token, _sessId, _manifest, idempotencyKey) => {
        calls.push('submitReleaseJob');
        // 断言在首次提交发布前，幂等键已经持久化保存
        const savedReleaseReq = JSON.parse(storage.getItem('zhinexus_pending_release') || '{}');
        expect(savedReleaseReq.idempotencyKey).toBe(idempotencyKey);
        return { jobId: 'job-001', state: 'PENDING' };
      }),
    };

    const result = await executeWebUploadWorkflow({
      apiUrl: 'http://127.0.0.1:3000',
      token: 'mock-token',
      manifest,
      filesMap,
      storage,
      api: mockApi,
    });

    expect(result.ok).toBe(true);
    expect(result.jobId).toBe('job-001');

    // 核对关键阶段顺序
    expect(calls[0]).toBe('createUploadSession');
    expect(calls[1]).toBe('uploadFileBytes');
    expect(calls[manifest.files.length + 1]).toBe('completeUploadSession');
    expect(calls[manifest.files.length + 2]).toBe('submitReleaseJob');
  });

  it('文件上传失败时立即停止，严禁吞错继续调用 complete 或 release', async () => {
    const { manifest, filesMap } = createFourteenVariantManifest();

    const mockApi = {
      createUploadSession: vi.fn(async () => ({
        uploadSessionId: 'sess-002',
        files: manifest.files.map((f) => ({
          path: f.path,
          uploadUrl: `http://mock-storage/put/${f.path}`,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        })),
      })),
      uploadFileBytes: vi.fn(async (url: string) => {
        if (url.includes(manifest.files[1]!.path)) {
          throw new Error('S3_UPLOAD_FAILED: 500 Connection Reset');
        }
      }),
      completeUploadSession: vi.fn(),
      submitReleaseJob: vi.fn(),
    };

    await expect(
      executeWebUploadWorkflow({
        apiUrl: 'http://127.0.0.1:3000',
        token: 'mock-token',
        manifest,
        filesMap,
        api: mockApi,
      }),
    ).rejects.toThrow(/S3_UPLOAD_FAILED/);

    // 核心安全约束：上传失败绝不继续 complete 或 release
    expect(mockApi.completeUploadSession).not.toHaveBeenCalled();
    expect(mockApi.submitReleaseJob).not.toHaveBeenCalled();
  });

  it('complete 核验失败时立即停止，严禁吞错继续发布', async () => {
    const { manifest, filesMap } = createFourteenVariantManifest();

    const mockApi = {
      createUploadSession: vi.fn(async () => ({
        uploadSessionId: 'sess-003',
        files: manifest.files.map((f) => ({
          path: f.path,
          uploadUrl: `http://mock-storage/put/${f.path}`,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        })),
      })),
      uploadFileBytes: vi.fn(),
      completeUploadSession: vi.fn(async () => {
        throw new Error('DIGEST_MISMATCH: 服务端校验产物哈希不一致');
      }),
      submitReleaseJob: vi.fn(),
    };

    await expect(
      executeWebUploadWorkflow({
        apiUrl: 'http://127.0.0.1:3000',
        token: 'mock-token',
        manifest,
        filesMap,
        api: mockApi,
      }),
    ).rejects.toThrow(/DIGEST_MISMATCH/);

    expect(mockApi.submitReleaseJob).not.toHaveBeenCalled();
  });

  it('网络中断或丢包重试时严格复用原持久化的幂等键，禁止更换新 key 重复占位', async () => {
    const { manifest, filesMap } = createFourteenVariantManifest();
    const mockStorageData = new Map<string, string>();
    const storage: WebUploadWorkflowStorage = {
      getItem: (k: string) => mockStorageData.get(k) ?? null,
      setItem: (k: string, v: string) => mockStorageData.set(k, v),
      removeItem: (k: string) => mockStorageData.delete(k),
    };

    let firstKey = '';
    const mockApi = {
      createUploadSession: vi.fn(async () => ({
        uploadSessionId: 'sess-004',
        files: manifest.files.map((f) => ({
          path: f.path,
          uploadUrl: `http://mock-storage/put/${f.path}`,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        })),
      })),
      uploadFileBytes: vi.fn(),
      completeUploadSession: vi.fn(),
      submitReleaseJob: vi
        .fn()
        .mockRejectedValueOnce(new Error('NETWORK_TIMEOUT: 丢包异常'))
        .mockResolvedValueOnce({ jobId: 'job-recovered', state: 'PENDING' }),
    };

    // 第一次尝试（由于网络原因失败）
    await expect(
      executeWebUploadWorkflow({
        apiUrl: 'http://127.0.0.1:3000',
        token: 'mock-token',
        manifest,
        filesMap,
        storage,
        api: mockApi,
      }),
    ).rejects.toThrow(/NETWORK_TIMEOUT/);

    firstKey = JSON.parse(storage.getItem('zhinexus_pending_release')!).idempotencyKey;
    expect(firstKey).toBeTruthy();

    // 第二次重试（模拟用户点击重试或页面刷新恢复）
    const retryResult = await executeWebUploadWorkflow({
      apiUrl: 'http://127.0.0.1:3000',
      token: 'mock-token',
      manifest,
      filesMap,
      storage,
      api: mockApi,
    });

    expect(retryResult.ok).toBe(true);
    expect(retryResult.jobId).toBe('job-recovered');
    // 验证第二次请求必须使用同一个持久化的 idempotencyKey
    expect(mockApi.submitReleaseJob).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      'sess-004',
      expect.anything(),
      firstKey,
    );
  });
});

describe('T08: 外部 Manifest 与本地文件导入、大小限制与分片契约', () => {
  it('支持导入外部合法 Manifest JSON 并自动清理不合规字段', () => {
    const { manifest } = createFourteenVariantManifest();
    const jsonStr = JSON.stringify({
      ...manifest,
      channel: 'cli', // 导入时将被强制标准化为 web
      reportId: 'rep-001', // 未在 web 声明的字段将被清洗
    });

    const parsed = parseAndValidateImportedManifest(jsonStr);
    expect(parsed.ok).toBe(true);
    expect(parsed.manifest).toBeDefined();
    expect(parsed.manifest!.channel).toBe('web');
    expect((parsed.manifest as any).reportId).toBeUndefined();
    expect(parsed.manifest!.variants).toHaveLength(14);
  });

  it('拒绝损坏或格式非法的外部 Manifest JSON', () => {
    const invalidJson = '{ bad json syntax ...';
    const parsed = parseAndValidateImportedManifest(invalidJson);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBeDefined();
  });

  it('支持导入并关联本地产物文件，正确计算 SHA-256 并同步到映射', async () => {
    const filesMap = new Map<string, Uint8Array>();
    const dummyBytes = new Uint8Array([1, 2, 3, 4, 5]);

    const attached = await attachLocalFile(filesMap, 'packages/custom.tgz', dummyBytes);
    expect(attached.path).toBe('packages/custom.tgz');
    expect(attached.bytes).toBe(5);
    expect(attached.sha256).toBe(await computeBrowserSha256(dummyBytes));
    expect(filesMap.get('packages/custom.tgz')).toEqual(dummyBytes);
  });

  it('超出共享大小限制时阻断：单张截图超 10MB、tarball 超 50MB 或总超 500MB', async () => {
    const { manifest, filesMap } = createFourteenVariantManifest();

    // 1. 模拟一张超限的大图 (11MB)
    const largeShotPath = manifest.variants[0]!.screenshots[0]!.image.path;
    const oversizedShotBytes = new Uint8Array(11 * 1024 * 1024);
    filesMap.set(largeShotPath, oversizedShotBytes);
    manifest.variants[0]!.screenshots[0]!.image.bytes = oversizedShotBytes.byteLength;
    const shotFileInList = manifest.files.find((f) => f.path === largeShotPath);
    if (shotFileInList) shotFileInList.bytes = oversizedShotBytes.byteLength;

    const res = await validateUploadFiles(manifest, filesMap);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i: { code: string }) => i.code === 'SIZE_LIMIT_EXCEEDED')).toBe(true);
  });

  it('分片上传支持：按契约对大文件切片上传，收集 ETag 并在 complete 时正确提交', async () => {
    const { manifest, filesMap } = createFourteenVariantManifest();

    // 模拟某 tarball 文件需要分两片上传
    const targetFile = manifest.files[0]!;
    const fileBytes = filesMap.get(targetFile.path)!;

    const mockApi = {
      createUploadSession: vi.fn(async () => ({
        uploadSessionId: 'sess-multipart-001',
        files: [
          {
            path: targetFile.path,
            multipart: {
              uploadId: 'mp-upload-001',
              parts: [
                { partNumber: 1, uploadUrl: 'http://mock-storage/part/1', bytes: 4 },
                { partNumber: 2, uploadUrl: 'http://mock-storage/part/2', bytes: fileBytes.byteLength - 4 },
              ],
            },
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
          ...manifest.files.slice(1).map((f) => ({
            path: f.path,
            uploadUrl: `http://mock-storage/put/${f.path}`,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          })),
        ],
      })),
      uploadFileBytes: vi.fn(async () => {}),
      uploadPartBytes: vi.fn(async (_url, _bytes) => ({ etag: 'mock-etag-abc' })),
      completeUploadSession: vi.fn(async () => {}),
      submitReleaseJob: vi.fn(async () => ({ jobId: 'job-mp-001', state: 'PENDING' })),
    };

    const result = await executeWebUploadWorkflow({
      apiUrl: 'http://127.0.0.1:3000',
      token: 'mock-token',
      manifest,
      filesMap,
      api: mockApi as any,
    });

    expect(result.ok).toBe(true);
    expect(result.jobId).toBe('job-mp-001');

    // 验证分片上传被调用 2 次
    expect(mockApi.uploadPartBytes).toHaveBeenCalledTimes(2);

    // 验证 completeUploadSession 收到了分片 parts 结构
    expect(mockApi.completeUploadSession).toHaveBeenCalledWith(
      'http://127.0.0.1:3000',
      'mock-token',
      'sess-multipart-001',
      [
        { path: targetFile.path, partNumber: 1, etag: 'mock-etag-abc' },
        { path: targetFile.path, partNumber: 2, etag: 'mock-etag-abc' },
      ],
    );
  });

  it('分片上传失败时立即停止，禁止向服务端提交 complete 或 release', async () => {
    const { manifest, filesMap } = createFourteenVariantManifest();
    const targetFile = manifest.files[0]!;

    const mockApi = {
      createUploadSession: vi.fn(async () => ({
        uploadSessionId: 'sess-multipart-fail',
        files: [
          {
            path: targetFile.path,
            multipart: {
              uploadId: 'mp-fail-001',
              parts: [
                { partNumber: 1, uploadUrl: 'http://mock-storage/part/1', bytes: 4 },
                { partNumber: 2, uploadUrl: 'http://mock-storage/part/2', bytes: 4 },
              ],
            },
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        ],
      })),
      uploadFileBytes: vi.fn(),
      uploadPartBytes: vi.fn(async (_url, _bytes) => {
        throw new Error('S3_MULTIPART_CHUNK_FAILED: 504 Gateway Timeout');
      }),
      completeUploadSession: vi.fn(),
      submitReleaseJob: vi.fn(),
    };

    await expect(
      executeWebUploadWorkflow({
        apiUrl: 'http://127.0.0.1:3000',
        token: 'mock-token',
        manifest,
        filesMap,
        api: mockApi as any,
      }),
    ).rejects.toThrow(/S3_MULTIPART_CHUNK_FAILED/);

    expect(mockApi.completeUploadSession).not.toHaveBeenCalled();
    expect(mockApi.submitReleaseJob).not.toHaveBeenCalled();
  });
});

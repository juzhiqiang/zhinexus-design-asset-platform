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
        exportName: `${comp
          .split('-')
          .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
          .join('')}Chart`,
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
      subject: 'alice',
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
        subject: 'alice',
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
        subject: 'alice',
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
    let sessionCounter = 0;
    const mockApi = {
      createUploadSession: vi.fn(async () => {
        sessionCounter++;
        return {
          uploadSessionId: `sess-004-call-${sessionCounter}`,
          files: manifest.files.map((f) => ({
            path: f.path,
            uploadUrl: `http://mock-storage/put/${f.path}`,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          })),
        };
      }),
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
        subject: 'alice',
        manifest,
        filesMap,
        storage,
        api: mockApi,
      }),
    ).rejects.toThrow(/NETWORK_TIMEOUT/);

    // 关键安全断言：首次异常后，未完成的 pending 与 active 会话必须完整保留供恢复
    expect(storage.getItem('zhinexus_pending_release')).not.toBeNull();
    expect(storage.getItem('zhinexus_active_session_id')).toBe('sess-004-call-1');
    expect(storage.getItem('zhinexus_active_session_plan')).not.toBeNull();

    firstKey = JSON.parse(storage.getItem('zhinexus_pending_release')!).idempotencyKey;
    expect(firstKey).toBeTruthy();

    // 第二次重试（模拟用户点击重试或页面刷新恢复）
    const retryResult = await executeWebUploadWorkflow({
      apiUrl: 'http://127.0.0.1:3000',
      token: 'mock-token',
      subject: 'alice',
      manifest,
      filesMap,
      storage,
      api: mockApi,
    });

    expect(retryResult.ok).toBe(true);
    expect(retryResult.jobId).toBe('job-recovered');
    // 关键断言：createUploadSession 仅被调用 1 次，复用了首个会话与 key
    expect(mockApi.createUploadSession).toHaveBeenCalledTimes(1);
    expect(mockApi.submitReleaseJob).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      'sess-004-call-1',
      expect.anything(),
      firstKey,
    );
  });
});

describe('T08: 外部 Manifest 与本地文件导入、大小限制与分片契约', () => {
  it('支持导入外部合法 Manifest JSON 并自动清理不合规字段', () => {
    const { manifest } = createFourteenVariantManifest();
    // 模拟合法的 CLI 清单：包含 local-automatic 截图及 reportId、passed 兼容性
    const cliManifest: ReleaseManifestV1 = {
      ...manifest,
      channel: 'cli',
      variants: manifest.variants.map((v) => ({
        ...v,
        screenshots: v.screenshots.map((s) => ({
          ...s,
          source: 'local-automatic' as const,
          reportId: 'rep-001',
        })),
        compatibility: [
          {
            framework: v.framework,
            frameworkVersion: v.framework === 'vue' ? '3.5.45' : '19.3.1',
            ...(v.framework === 'react' ? { reactDomVersion: '19.3.1' } : {}),
            echartsVersion: '6.1.0',
            status: 'passed' as const,
            reportId: 'rep-001',
            verifiedAt: new Date().toISOString(),
          },
        ],
      })),
    };
    const jsonStr = JSON.stringify(cliManifest);

    const parsed = parseAndValidateImportedManifest(jsonStr);
    expect(parsed.ok).toBe(true);
    expect(parsed.manifest).toBeDefined();
    expect(parsed.manifest!.channel).toBe('web');
    expect(parsed.manifest!.reports).toEqual([]);
    // 验证清洗效果：自动报告与 passed 状态被清洗
    expect(parsed.manifest!.variants[0]!.screenshots[0]!.source).toBe('manual-upload');
    expect(parsed.manifest!.variants[0]!.screenshots[0]!.environmentKey).toBe('unknown-manual');
    expect((parsed.manifest!.variants[0]!.screenshots[0] as any).reportId).toBeUndefined();
    expect(parsed.manifest!.variants[0]!.compatibility[0]!.status).toBe('candidate');
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
      subject: 'alice',
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
        subject: 'alice',
        manifest,
        filesMap,
        api: mockApi as any,
      }),
    ).rejects.toThrow(/S3_MULTIPART_CHUNK_FAILED/);

    expect(mockApi.completeUploadSession).not.toHaveBeenCalled();
    expect(mockApi.submitReleaseJob).not.toHaveBeenCalled();
  });

  it('导入已有清单时保持期望摘要，同名产物内容篡改或错误时 validateUploadFiles 严格阻断并报告 DIGEST_MISMATCH', async () => {
    const { manifest, filesMap } = createFourteenVariantManifest();
    const targetPackage = manifest.packages[0]!;
    const originalExpectedSha = targetPackage.tarball.sha256;

    // 篡改同名 tarball 字节内容
    const corruptedTarballBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33]);
    filesMap.set(targetPackage.tarball.path, corruptedTarballBytes);

    // 运行 validateUploadFiles 核验
    const result = await validateUploadFiles(manifest, filesMap);

    // 断言核验失败并准确包含 DIGEST_MISMATCH
    expect(result.ok).toBe(false);
    const digestIssue = result.issues.find(
      (issue) => issue.code === 'DIGEST_MISMATCH' && issue.path === targetPackage.tarball.path,
    );
    expect(digestIssue).toBeDefined();
    expect(digestIssue?.message).toContain('文件哈希不一致');

    // 关键安全断言：清单中期望的 tarball.sha256 严禁被篡改
    expect(targetPackage.tarball.sha256).toBe(originalExpectedSha);
  });

  describe('清单导入边界与非法 schema 拦截', () => {
    it('拒绝不支持的 schemaVersion (如 999)，严禁静默降为 1', () => {
      const invalidJson = JSON.stringify({
        schemaVersion: 999,
        channel: 'cli',
        packages: [],
        variants: [],
        reports: [],
        files: [],
      });

      const result = parseAndValidateImportedManifest(invalidJson);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/schemaVersion/i);
    });

    it('拒绝空 variants 变体清单，网页发布必须包含至少一个变体实现', () => {
      const invalidJson = JSON.stringify({
        schemaVersion: 1,
        channel: 'cli',
        packages: [
          {
            name: '@company/charts-core',
            version: '0.0.5',
            tarball: { path: 'p.tgz', sha256: '0'.repeat(64), bytes: 100 },
            sourceDigest: '1'.repeat(64),
            dependencies: {},
            peerDependencies: {},
          },
        ],
        variants: [],
        reports: [],
        files: [{ path: 'p.tgz', sha256: '0'.repeat(64), bytes: 100 }],
      });

      const result = parseAndValidateImportedManifest(invalidJson);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/variants/i);
    });

    it('拒绝空 packages 产物包清单', () => {
      const invalidJson = JSON.stringify({
        schemaVersion: 1,
        channel: 'cli',
        packages: [],
        variants: [
          {
            componentId: 'line',
            variantId: 'line-vue',
            framework: 'vue',
            packageName: '@company/charts-vue',
            packageVersion: '0.0.5',
            exportPath: './line',
            exportName: 'LineChart',
            api: { path: 'api.json', sha256: '0'.repeat(64), bytes: 10 },
            docs: { path: 'docs.md', sha256: '0'.repeat(64), bytes: 10 },
            examples: [],
            screenshots: [],
            compatibility: [],
          },
        ],
        reports: [],
        files: [],
      });

      const result = parseAndValidateImportedManifest(invalidJson);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/packages/i);
    });

    it('拒绝原 reports 非数组（如 reports: null）与 files 包含非法项（如 files: [null]）', () => {
      const { manifest } = createFourteenVariantManifest();

      // 1. reports: null
      const invalidReportsJson = JSON.stringify({
        ...manifest,
        reports: null,
      });
      const res1 = parseAndValidateImportedManifest(invalidReportsJson);
      expect(res1.ok).toBe(false);
      expect(res1.error).toMatch(/reports|结构校验失败/i);

      // 2. files: [null]
      const invalidFilesJson = JSON.stringify({
        ...manifest,
        files: [null],
      });
      const res2 = parseAndValidateImportedManifest(invalidFilesJson);
      expect(res2.ok).toBe(false);
      expect(res2.error).toMatch(/files|结构校验失败/i);
    });

    it('必须提供操作人 subject，严禁跨用户生成未授权恢复记录 (SUBJECT_REQUIRED)', async () => {
      const { manifest, filesMap } = createFourteenVariantManifest();
      await expect(
        executeWebUploadWorkflow({
          apiUrl: 'http://127.0.0.1:3000',
          token: 'token-1',
          subject: '', // 空 subject
          manifest,
          filesMap,
        }),
      ).rejects.toThrow(/SUBJECT_REQUIRED/);
    });
  });

  describe('会话绑定与成功后状态清理', () => {
    it('发布成功 (202) 后必须清理 pending_release 与 active_session_*，同一 storage 连续两次调用生成新会话', async () => {
      const { manifest, filesMap } = createFourteenVariantManifest();
      const storageMap = new Map<string, string>();
      const storage: WebUploadWorkflowStorage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storageMap.set(k, v);
        },
        removeItem: (k: string) => {
          storageMap.delete(k);
        },
      };

      let sessionCallCount = 0;
      const mockApi = {
        createUploadSession: vi.fn(async () => {
          sessionCallCount++;
          return {
            uploadSessionId: `sess-clean-00${sessionCallCount}`,
            files: manifest.files.map((f) => ({
              path: f.path,
              uploadUrl: `http://mock-storage/${f.path}`,
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
            })),
          };
        }),
        uploadFileBytes: vi.fn(async () => {}),
        completeUploadSession: vi.fn(async () => ({ ok: true })),
        submitReleaseJob: vi.fn(async (_url, _token, sessId, _mf, key) => ({
          jobId: `job-clean-${sessId}`,
          uploadSessionId: sessId,
          idempotencyKey: key,
          state: 'QUEUED',
        })),
      };

      // 首次提交
      const res1 = await executeWebUploadWorkflow({
        apiUrl: 'http://127.0.0.1:3000',
        token: 'token-1',
        subject: 'alice',
        manifest,
        filesMap,
        storage,
        api: mockApi as any,
      });

      expect(res1.ok).toBe(true);
      expect(res1.jobId).toBe('job-clean-sess-clean-001');

      // 核心断言：确认 202 后清 pending、active 与 draft，仅保留最终 job 供轮询
      expect(storage.getItem('zhinexus_upload_draft')).toBeNull();
      expect(storage.getItem('zhinexus_pending_release')).toBeNull();
      expect(storage.getItem('zhinexus_active_session_id')).toBeNull();
      expect(storage.getItem('zhinexus_active_session_plan')).toBeNull();
      expect(storage.getItem('zhinexus_web_release_session')).not.toBeNull();

      // 连续第二次提交（同一 storage）
      const res2 = await executeWebUploadWorkflow({
        apiUrl: 'http://127.0.0.1:3000',
        token: 'token-1',
        subject: 'alice',
        manifest,
        filesMap,
        storage,
        api: mockApi as any,
      });

      expect(res2.ok).toBe(true);
      expect(res2.jobId).toBe('job-clean-sess-clean-002');
      // 验证未复用已完成会话，createUploadSession 被调用了 2 次
      expect(mockApi.createUploadSession).toHaveBeenCalledTimes(2);
    });

    it('切换新清单（manifestDigest 不同）时，不得复用旧计划并强制重新创建上传会话', async () => {
      const { manifest: m1, filesMap } = createFourteenVariantManifest();
      const storageMap = new Map<string, string>();
      const storage: WebUploadWorkflowStorage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storageMap.set(k, v);
        },
        removeItem: (k: string) => {
          storageMap.delete(k);
        },
      };

      // 预置旧的 active_session_id 与旧计划
      storage.setItem('zhinexus_active_session_id', 'sess-old-001');
      storage.setItem(
        'zhinexus_active_session_plan',
        JSON.stringify({
          uploadSessionId: 'sess-old-001',
          manifestDigest: 'different_manifest_digest_99999999',
          apiUrl: 'http://127.0.0.1:3000',
          subject: 'alice',
          files: [],
          timestamp: Date.now(),
        }),
      );

      const mockApi = {
        createUploadSession: vi.fn(async () => ({
          uploadSessionId: 'sess-new-created',
          files: m1.files.map((f) => ({
            path: f.path,
            uploadUrl: `http://mock-storage/${f.path}`,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          })),
        })),
        uploadFileBytes: vi.fn(async () => {}),
        completeUploadSession: vi.fn(async () => ({ ok: true })),
        submitReleaseJob: vi.fn(async (_url, _token, sessId, _mf, key) => ({
          jobId: `job-${sessId}`,
          uploadSessionId: sessId,
          idempotencyKey: key,
          state: 'QUEUED',
        })),
      };

      const res = await executeWebUploadWorkflow({
        apiUrl: 'http://127.0.0.1:3000',
        token: 'token-1',
        subject: 'alice',
        manifest: m1,
        filesMap,
        storage,
        api: mockApi as any,
      });

      expect(res.ok).toBe(true);
      expect(res.uploadSessionId).toBe('sess-new-created');
      expect(mockApi.createUploadSession).toHaveBeenCalledTimes(1);
    });

    it('保持 digest 不变只改 API，必须新建会话；保持 digest 不变只改 subject，必须新建会话；三者相同才允许恢复', async () => {
      const { manifest, filesMap } = createFourteenVariantManifest();
      const storageMap = new Map<string, string>();
      const storage: WebUploadWorkflowStorage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storageMap.set(k, v);
        },
        removeItem: (k: string) => {
          storageMap.delete(k);
        },
      };

      const cleanManifest = sanitizeWebManifest(manifest);
      const { manifestDigest } = await import('@company/contracts');
      const correctDigest = await manifestDigest(cleanManifest);

      // 场景 A: 保持 digest 与 subject 不变，只改 API 地址 -> 强制新建会话
      storage.setItem('zhinexus_active_session_id', 'sess-base-001');
      storage.setItem(
        'zhinexus_active_session_plan',
        JSON.stringify({
          uploadSessionId: 'sess-base-001',
          manifestDigest: correctDigest,
          apiUrl: 'http://127.0.0.1:3000',
          subject: 'alice',
          files: manifest.files.map((f) => ({ path: f.path, uploadUrl: `http://mock/${f.path}`, expiresAt: new Date(Date.now() + 3600000).toISOString() })),
          timestamp: Date.now(),
        }),
      );

      let createdSessions: string[] = [];
      const mockApiA = {
        createUploadSession: vi.fn(async () => {
          const id = `sess-new-api-${Date.now()}`;
          createdSessions.push(id);
          return {
            uploadSessionId: id,
            files: manifest.files.map((f) => ({ path: f.path, uploadUrl: `http://mock/${f.path}`, expiresAt: new Date(Date.now() + 3600000).toISOString() })),
          };
        }),
        uploadFileBytes: vi.fn(),
        completeUploadSession: vi.fn(),
        submitReleaseJob: vi.fn(async (_u, _t, id, _m, k) => ({ jobId: `job-${id}`, uploadSessionId: id, idempotencyKey: k, state: 'QUEUED' })),
      };

      await executeWebUploadWorkflow({
        apiUrl: 'http://127.0.0.1:4000', // 改了 API 端口
        token: 'token-1',
        subject: 'alice',
        manifest,
        filesMap,
        storage,
        api: mockApiA as any,
      });
      expect(mockApiA.createUploadSession).toHaveBeenCalledTimes(1);

      // 场景 B: 保持 digest 与 apiUrl 不变，只改 subject -> 强制新建会话
      storage.setItem('zhinexus_active_session_id', 'sess-base-002');
      storage.setItem(
        'zhinexus_active_session_plan',
        JSON.stringify({
          uploadSessionId: 'sess-base-002',
          manifestDigest: correctDigest,
          apiUrl: 'http://127.0.0.1:3000',
          subject: 'alice',
          files: manifest.files.map((f) => ({ path: f.path, uploadUrl: `http://mock/${f.path}`, expiresAt: new Date(Date.now() + 3600000).toISOString() })),
          timestamp: Date.now(),
        }),
      );

      const mockApiB = {
        createUploadSession: vi.fn(async () => ({
          uploadSessionId: 'sess-new-subject-001',
          files: manifest.files.map((f) => ({ path: f.path, uploadUrl: `http://mock/${f.path}`, expiresAt: new Date(Date.now() + 3600000).toISOString() })),
        })),
        uploadFileBytes: vi.fn(),
        completeUploadSession: vi.fn(),
        submitReleaseJob: vi.fn(async (_u, _t, id, _m, k) => ({ jobId: `job-${id}`, uploadSessionId: id, idempotencyKey: k, state: 'QUEUED' })),
      };

      await executeWebUploadWorkflow({
        apiUrl: 'http://127.0.0.1:3000',
        token: 'token-2',
        subject: 'bob', // 改了 subject
        manifest,
        filesMap,
        storage,
        api: mockApiB as any,
      });
      expect(mockApiB.createUploadSession).toHaveBeenCalledTimes(1);

      // 场景 C: digest、apiUrl、subject 三者完全相同 -> 允许复用活跃会话
      storage.setItem('zhinexus_active_session_id', 'sess-base-003');
      storage.setItem(
        'zhinexus_active_session_plan',
        JSON.stringify({
          uploadSessionId: 'sess-base-003',
          manifestDigest: correctDigest,
          apiUrl: 'http://127.0.0.1:3000',
          subject: 'alice',
          files: manifest.files.map((f) => ({ path: f.path, uploadUrl: `http://mock/${f.path}`, expiresAt: new Date(Date.now() + 3600000).toISOString() })),
          timestamp: Date.now(),
        }),
      );

      const mockApiC = {
        createUploadSession: vi.fn(),
        uploadFileBytes: vi.fn(),
        completeUploadSession: vi.fn(),
        submitReleaseJob: vi.fn(async (_u, _t, id, _m, k) => ({ jobId: `job-${id}`, uploadSessionId: id, idempotencyKey: k, state: 'QUEUED' })),
      };

      const resC = await executeWebUploadWorkflow({
        apiUrl: 'http://127.0.0.1:3000',
        token: 'token-1',
        subject: 'alice', // 完全一致
        manifest,
        filesMap,
        storage,
        api: mockApiC as any,
      });
      expect(mockApiC.createUploadSession).not.toHaveBeenCalled();
      expect(resC.uploadSessionId).toBe('sess-base-003');
    });

    it('边界①：同 session 原 release 失败后，若 pending.manifestDigest 被篡改，普通提交必须 fail-closed 报错，严禁更换新 key 发送非幂等请求', async () => {
      const { manifest, filesMap } = createFourteenVariantManifest();
      const storageMap = new Map<string, string>();
      const storage: WebUploadWorkflowStorage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storageMap.set(k, v);
        },
        removeItem: (k: string) => {
          storageMap.delete(k);
        },
      };

      const cleanManifest = sanitizeWebManifest(manifest);
      const { manifestDigest } = await import('@company/contracts');
      const correctDigest = await manifestDigest(cleanManifest);

      const sessId = 'sess-tampered-001';
      // 预置活跃会话
      storage.setItem('zhinexus_active_session_id', sessId);
      storage.setItem(
        'zhinexus_active_session_plan',
        JSON.stringify({
          uploadSessionId: sessId,
          manifestDigest: correctDigest,
          apiUrl: 'http://127.0.0.1:3000',
          subject: 'alice',
          files: manifest.files.map((f) => ({ path: f.path, uploadUrl: `http://mock/${f.path}`, expiresAt: new Date(Date.now() + 3600000).toISOString() })),
          timestamp: Date.now(),
        }),
      );

      // 预置被恶意篡改 manifestDigest 的 pending 记录
      storage.setItem(
        'zhinexus_pending_release',
        JSON.stringify({
          idempotencyKey: 'original-key-1234',
          uploadSessionId: sessId,
          apiUrl: 'http://127.0.0.1:3000',
          subject: 'alice',
          manifest: cleanManifest,
          manifestDigest: 'tampered_fake_digest_0000000000000000000000000000000000000000000',
          timestamp: Date.now(),
        }),
      );

      const mockApi = {
        createUploadSession: vi.fn(),
        uploadFileBytes: vi.fn(),
        completeUploadSession: vi.fn(),
        submitReleaseJob: vi.fn(),
      };

      await expect(
        executeWebUploadWorkflow({
          apiUrl: 'http://127.0.0.1:3000',
          token: 'token-1',
          subject: 'alice',
          manifest,
          filesMap,
          storage,
          api: mockApi as any,
        }),
      ).rejects.toThrow(/CORRUPTED_PENDING_RELEASE|TAMPERED_PENDING_RELEASE/);

      // 关键安全断言：严禁向服务端再次发送任何 release 请求
      expect(mockApi.submitReleaseJob).not.toHaveBeenCalled();
    });

    it('边界②：在没有 pending 的上传阶段，若预签名 URL 已到期，安全新建 session；已有 pending 则绝不能因 URL 到期换 session/key', async () => {
      const { manifest, filesMap } = createFourteenVariantManifest();
      const storageMap = new Map<string, string>();
      const storage: WebUploadWorkflowStorage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storageMap.set(k, v);
        },
        removeItem: (k: string) => {
          storageMap.delete(k);
        },
      };

      const cleanManifest = sanitizeWebManifest(manifest);
      const { manifestDigest } = await import('@company/contracts');
      const correctDigest = await manifestDigest(cleanManifest);

      // 1. 无 pending 阶段：URL 过期 (1 小时前)，重试必须安全调用 createUploadSession 新建会话
      storage.setItem('zhinexus_active_session_id', 'sess-expired-old');
      storage.setItem(
        'zhinexus_active_session_plan',
        JSON.stringify({
          uploadSessionId: 'sess-expired-old',
          manifestDigest: correctDigest,
          apiUrl: 'http://127.0.0.1:3000',
          subject: 'alice',
          files: manifest.files.map((f) => ({
            path: f.path,
            uploadUrl: `http://mock/${f.path}`,
            expiresAt: new Date(Date.now() - 3600000).toISOString(), // 已过期
          })),
          timestamp: Date.now() - 3600000,
        }),
      );

      const mockApi1 = {
        createUploadSession: vi.fn(async () => ({
          uploadSessionId: 'sess-refreshed-new',
          files: manifest.files.map((f) => ({
            path: f.path,
            uploadUrl: `http://mock/${f.path}`,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          })),
        })),
        uploadFileBytes: vi.fn(),
        completeUploadSession: vi.fn(),
        submitReleaseJob: vi.fn(async (_u, _t, id, _m, k) => ({ jobId: `job-${id}`, uploadSessionId: id, idempotencyKey: k, state: 'QUEUED' })),
      };

      const res1 = await executeWebUploadWorkflow({
        apiUrl: 'http://127.0.0.1:3000',
        token: 'token-1',
        subject: 'alice',
        manifest,
        filesMap,
        storage,
        api: mockApi1 as any,
      });

      expect(mockApi1.createUploadSession).toHaveBeenCalledTimes(1);
      expect(res1.uploadSessionId).toBe('sess-refreshed-new');

      // 2. 已有 pending 阶段：即便 URL 字段标记过期，发布提交必须锁定原 session 与原 key，绝不能因 URL 过期更换 session
      storage.setItem('zhinexus_active_session_id', 'sess-locked-001');
      storage.setItem(
        'zhinexus_active_session_plan',
        JSON.stringify({
          uploadSessionId: 'sess-locked-001',
          manifestDigest: correctDigest,
          apiUrl: 'http://127.0.0.1:3000',
          subject: 'alice',
          files: manifest.files.map((f) => ({
            path: f.path,
            uploadUrl: `http://mock/${f.path}`,
            expiresAt: new Date(Date.now() - 3600000).toISOString(), // 过期
          })),
          timestamp: Date.now(),
        }),
      );
      storage.setItem(
        'zhinexus_pending_release',
        JSON.stringify({
          idempotencyKey: 'locked-key-999',
          uploadSessionId: 'sess-locked-001',
          apiUrl: 'http://127.0.0.1:3000',
          subject: 'alice',
          manifest: cleanManifest,
          manifestDigest: correctDigest,
          timestamp: Date.now(),
        }),
      );

      const mockApi2 = {
        createUploadSession: vi.fn(),
        uploadFileBytes: vi.fn(),
        completeUploadSession: vi.fn(),
        submitReleaseJob: vi.fn(async (_u, _t, id, _m, k) => ({ jobId: `job-${id}`, uploadSessionId: id, idempotencyKey: k, state: 'QUEUED' })),
      };

      const res2 = await executeWebUploadWorkflow({
        apiUrl: 'http://127.0.0.1:3000',
        token: 'token-1',
        subject: 'alice',
        manifest,
        filesMap,
        storage,
        api: mockApi2 as any,
      });

      expect(mockApi2.createUploadSession).not.toHaveBeenCalled();
      expect(res2.uploadSessionId).toBe('sess-locked-001');
      expect(mockApi2.submitReleaseJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'sess-locked-001',
        expect.anything(),
        'locked-key-999',
      );
    });

    it('同三元组/摘要的有效 pending 存在时，再次调用直接重放原 release，完全跳过 PUT 与 complete (零 PUT/complete)', async () => {
      const { manifest, filesMap } = createFourteenVariantManifest();
      const storageMap = new Map<string, string>();
      const storage: WebUploadWorkflowStorage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storageMap.set(k, v);
        },
        removeItem: (k: string) => {
          storageMap.delete(k);
        },
      };

      const cleanManifest = sanitizeWebManifest(manifest);
      const { manifestDigest } = await import('@company/contracts');
      const correctDigest = await manifestDigest(cleanManifest);

      const sessId = 'sess-direct-replay-001';
      const key = 'key-direct-replay-999';

      storage.setItem('zhinexus_active_session_id', sessId);
      storage.setItem(
        'zhinexus_pending_release',
        JSON.stringify({
          idempotencyKey: key,
          uploadSessionId: sessId,
          apiUrl: 'http://127.0.0.1:3000',
          subject: 'alice',
          manifest: cleanManifest,
          manifestDigest: correctDigest,
          timestamp: Date.now(),
        }),
      );

      const mockApi = {
        createUploadSession: vi.fn(),
        uploadFileBytes: vi.fn(),
        completeUploadSession: vi.fn(),
        submitReleaseJob: vi.fn(async () => ({
          jobId: 'job-direct-replay',
          uploadSessionId: sessId,
          idempotencyKey: key,
          state: 'QUEUED',
        })),
      };

      const res = await executeWebUploadWorkflow({
        apiUrl: 'http://127.0.0.1:3000',
        token: 'token-1',
        subject: 'alice',
        manifest,
        filesMap,
        storage,
        api: mockApi as any,
      });

      expect(res.ok).toBe(true);
      expect(res.jobId).toBe('job-direct-replay');
      // 核心断言：完全跳过创建会话、文件上传与完成核验
      expect(mockApi.createUploadSession).not.toHaveBeenCalled();
      expect(mockApi.uploadFileBytes).not.toHaveBeenCalled();
      expect(mockApi.completeUploadSession).not.toHaveBeenCalled();
      expect(mockApi.submitReleaseJob).toHaveBeenCalledTimes(1);
    });
  });
});

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PackageRef, ReleaseManifestV1, VariantRef } from '@company/contracts';
import { getStoredSession, saveSession, clearSession, type UserSession } from '../../lib/auth';
import {
  validateVariantScreenshots,
  createManualScreenshotRef,
  type ScreenshotValidationResult,
} from '../../lib/uploads/screenshot-validation';
import {
  sanitizeWebManifest,
  createEmptySevenComponentsDraft,
  createSevenComponentsManifest,
  validateUploadFiles,
  executeWebUploadWorkflow,
  computeBrowserSha256,
  fetchReleaseJob,
  parseAndValidateImportedManifest,
  attachLocalFile,
  submitReleaseJob,
} from '../../lib/uploads/manifest-form';

const LOCAL_STORAGE_WEB_RELEASE = 'zhinexus_web_release_session';
const LOCAL_STORAGE_PENDING_RELEASE = 'zhinexus_pending_release';
const LOCAL_STORAGE_ACTIVE_SESSION = 'zhinexus_active_session_id';

export default function WebUploadConsole() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [apiUrl, setApiUrl] = useState<string>('http://127.0.0.1:3000');
  
  // 初始化覆盖 7 组件 14 实现的干净草稿结构（初始无截图，必须由用户上传有效展示截图）
  const [initialData] = useState(() => createEmptySevenComponentsDraft('0.0.6'));
  const [manifest, setManifest] = useState<ReleaseManifestV1>(initialData.manifest);
  const [filesMap, setFilesMap] = useState<Map<string, Uint8Array>>(initialData.filesMap);

  const [validation, setValidation] = useState<ScreenshotValidationResult>({
    ok: false,
    missingVariantIds: [],
    issues: [],
  });
  const [fileIssues, setFileIssues] = useState<Array<{ code: string; path: string; message: string }>>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<any>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingResumeKey, setPendingResumeKey] = useState<string | null>(null);

  // 1. 初始化鉴权与断点恢复检测
  useEffect(() => {
    const s = getStoredSession();
    if (s) setSession(s);

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const queryApiUrl = params.get('apiUrl');
      if (queryApiUrl) {
        setApiUrl(queryApiUrl);
        localStorage.setItem('zhinexus_api_url', queryApiUrl);
      } else {
        const storedApiUrl = localStorage.getItem('zhinexus_api_url');
        if (storedApiUrl) setApiUrl(storedApiUrl);
      }

      // 检查是否有未完成的发布会话可恢复
      try {
        const savedPending = localStorage.getItem(LOCAL_STORAGE_PENDING_RELEASE);
        if (savedPending) {
          const parsed = JSON.parse(savedPending);
          if (parsed.idempotencyKey) {
            setPendingResumeKey(parsed.idempotencyKey);
          }
        }
        const savedJob = localStorage.getItem(LOCAL_STORAGE_WEB_RELEASE);
        if (savedJob) {
          const parsed = JSON.parse(savedJob);
          if (parsed.jobId) {
            setActiveJobId(parsed.jobId);
          }
        }
      } catch {
        // ignore
      }
    }
  }, []);

  // 2. 变体截图与文件完整性校验
  useEffect(() => {
    const res = validateVariantScreenshots(manifest.variants, manifest.packages);
    setValidation(res);

    validateUploadFiles(manifest, filesMap).then((fRes) => {
      setFileIssues(fRes.issues);
    });
  }, [manifest, filesMap]);

  // 3. 发布作业轮询
  useEffect(() => {
    if (!activeJobId || !session?.token) return;

    let timer: any;
    let cancelled = false;

    async function poll() {
      try {
        const data = await fetchReleaseJob(apiUrl, session!.token, activeJobId!);
        if (!cancelled) {
          setJobState(data);
          if (data.state === 'READY' || data.state === 'CONFLICT' || data.state === 'REJECTED') {
            setStatusMessage(`发布状态机完成: ${data.state}`);
            return;
          }
          timer = setTimeout(poll, 600);
        }
      } catch (err: any) {
        if (!cancelled) {
          setStatusMessage(`轮询状态中: ${err.message}`);
          timer = setTimeout(poll, 1000);
        }
      }
    }

    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeJobId, session, apiUrl]);

  // 登录处理
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    const saved = saveSession(tokenInput.trim());
    if (saved) {
      setSession(saved);
      setStatusMessage('');
    } else {
      setStatusMessage('Token 格式无效，无法解析身份');
    }
  };

  // 退出登录
  const handleLogout = () => {
    clearSession();
    setSession(null);
    setStatusMessage('');
  };

  // 单个变体上传真实展示截图
  const handleFileChange = async (variantId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const fileSha = await computeBrowserSha256(bytes);
    const shotPath = `screenshots/${variantId}-default.png`;

    const nextMap = new Map(filesMap);
    nextMap.set(shotPath, bytes);

    const updatedVariants = manifest.variants.map((v) => {
      if (v.variantId === variantId) {
        const pkgTarball = manifest.packages.find((p) => p.name === v.packageName)?.tarball;
        return {
          ...v,
          screenshots: [
            createManualScreenshotRef({
              id: `shot-${variantId}-default`,
              variantId: v.variantId,
              framework: v.framework,
              packageVersion: v.packageVersion,
              packageSha256: pkgTarball?.sha256 || '00',
              exampleId: `example-${variantId}-default`,
              imagePath: shotPath,
              imageSha256: fileSha,
              imageBytes: bytes.byteLength,
              width: 800,
              height: 400,
            }),
          ],
        };
      }
      return v;
    });

    const updatedFiles = [
      ...manifest.files.filter((f) => f.path !== shotPath),
      { path: shotPath, sha256: fileSha, bytes: bytes.byteLength },
    ];

    setFilesMap(nextMap);
    setManifest({
      ...manifest,
      variants: updatedVariants,
      files: updatedFiles,
    });
    setStatusMessage(`已为实现 ${variantId} 上传有效展示截图 (${bytes.byteLength} 字节)`);
  };

  // 批量关联本地展示截图（从所选多个文件中自动按 variantId 匹配）
  const handleBatchScreenshots = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const nextMap = new Map(filesMap);
    const updatedVariants = [...manifest.variants];
    const newFilesMap = new Map(manifest.files.map((f) => [f.path, f]));
    let matchedCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const fileSha = await computeBrowserSha256(bytes);
      const relativePath = ((file as any).webkitRelativePath || file.name).replace(/\\/g, '/');
      const fileName = relativePath.split('/').pop() || file.name;

      for (let j = 0; j < updatedVariants.length; j++) {
        const v = updatedVariants[j]!;
        const cleanName = fileName.replace(/\.(png|jpe?g)$/i, '').replace(/-default$/, '');
        if (cleanName === v.variantId || fileName.includes(v.variantId)) {
          const pkgTarball = manifest.packages.find((p) => p.name === v.packageName)?.tarball;
          const shotPath = `screenshots/${v.variantId}-default.png`;
          nextMap.set(shotPath, bytes);

          const shotRef = createManualScreenshotRef({
            id: `shot-${v.variantId}-default`,
            variantId: v.variantId,
            framework: v.framework,
            packageVersion: v.packageVersion,
            packageSha256: pkgTarball?.sha256 || '00',
            exampleId: `example-${v.variantId}-default`,
            imagePath: shotPath,
            imageSha256: fileSha,
            imageBytes: bytes.byteLength,
            width: 800,
            height: 400,
          });

          updatedVariants[j] = { ...v, screenshots: [shotRef] };
          newFilesMap.set(shotPath, { path: shotPath, sha256: fileSha, bytes: bytes.byteLength });
          matchedCount++;
          break;
        }
      }
    }

    setFilesMap(nextMap);
    setManifest({
      ...manifest,
      variants: updatedVariants,
      files: [...newFilesMap.values()],
    });
    setStatusMessage(`成功批量关联 ${matchedCount} 张有效展示截图并计算摘要`);
  };

  // 删除某变体的截图（真实用户操作）
  const handleRemoveScreenshot = (variantId: string) => {
    const shotPath = `screenshots/${variantId}-default.png`;
    const nextMap = new Map(filesMap);
    nextMap.delete(shotPath);

    const updatedVariants = manifest.variants.map((v) => {
      if (v.variantId === variantId) {
        return { ...v, screenshots: [] };
      }
      return v;
    });

    const updatedFiles = manifest.files.filter((f) => f.path !== shotPath);
    setFilesMap(nextMap);
    setManifest({
      ...manifest,
      variants: updatedVariants,
      files: updatedFiles,
    });
    setStatusMessage(`已移除实现 ${variantId} 的展示截图`);
  };

  // 导入外部 Manifest JSON 文件
  const handleImportManifest = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = parseAndValidateImportedManifest(text);
      if (res.ok && res.manifest) {
        setManifest(res.manifest);
        setStatusMessage(`成功导入外部 Manifest 清单 (${res.manifest.variants.length} 实现，${res.manifest.files.length} 文件)`);
      } else {
        setStatusMessage(`导入 Manifest 失败: ${res.error}`);
      }
    } catch (err: any) {
      setStatusMessage(`读取 Manifest 文件异常: ${err.message}`);
    }
  };

  // 导入本地预构建产物文件或目录（按实际路径映射，保持清单期望摘要不变，错字节由核验阻断）
  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    let importedCount = 0;
    const nextMap = new Map(filesMap);

    // 1. 将选择的文件保存到映射（支持相对路径与直接文件名，自动关联到 manifest.files）
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const relativePath = (file as any).webkitRelativePath || file.name;
      const normalizedPath = relativePath.replace(/\\/g, '/');

      // 提取去除顶层文件夹名的相对路径（例如 69443f97-.../preview/line-vue/index.html -> preview/line-vue/index.html）
      const slashIndex = normalizedPath.indexOf('/');
      const cleanPath = slashIndex !== -1 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;

      await attachLocalFile(nextMap, normalizedPath, bytes);

      // 路径匹配规则并关联到 manifest.files，但严禁改写 manifest 中期望的 bytes 与 sha256！
      for (let j = 0; j < manifest.files.length; j++) {
        const mf = manifest.files[j]!;
        if (
          mf.path === normalizedPath ||
          mf.path === cleanPath ||
          normalizedPath.endsWith('/' + mf.path) ||
          (file.name.endsWith('.tgz') && mf.path.endsWith('/' + file.name))
        ) {
          nextMap.set(mf.path, bytes);
        }
      }
      importedCount++;
    }

    setFilesMap(nextMap);
    // 核心安全约束：保持 manifest 原始期望值不变，由 validateUploadFiles 对真实字节进行尺寸与 SHA-256 核验与阻断
    setStatusMessage(`成功导入 ${importedCount} 个本地预构建产物文件并完成路径映射`);
  };

  // 恢复未完成的发布请求：直接重放原持久化的 manifest、uploadSessionId 与 idempotencyKey，绝不依赖可能为空的页面草稿状态
  const handleResumePendingRelease = async () => {
    if (!session?.token) return;
    const pendingReleaseStr = localStorage.getItem(LOCAL_STORAGE_PENDING_RELEASE);
    if (!pendingReleaseStr) {
      setStatusMessage('未找到可恢复的发布请求记录');
      setPendingResumeKey(null);
      return;
    }
    let pending: any;
    try {
      pending = JSON.parse(pendingReleaseStr);
    } catch {
      setStatusMessage('恢复记录损坏，无法解析');
      return;
    }

    if (!pending.uploadSessionId || !pending.idempotencyKey || !pending.manifest) {
      setStatusMessage('恢复记录不完整，缺少会话 ID、幂等键或清单');
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(`正在使用原幂等键 (${pending.idempotencyKey}) 恢复提交发布作业...`);

    try {
      const targetApiUrl = apiUrl.trim() || 'http://127.0.0.1:3000';
      const releaseRes = await submitReleaseJob(
        targetApiUrl,
        session.token,
        pending.uploadSessionId,
        pending.manifest,
        pending.idempotencyKey,
      );

      setActiveJobId(releaseRes.jobId);
      localStorage.setItem(
        LOCAL_STORAGE_WEB_RELEASE,
        JSON.stringify({
          jobId: releaseRes.jobId,
          uploadSessionId: pending.uploadSessionId,
          idempotencyKey: pending.idempotencyKey,
          state: releaseRes.state,
          timestamp: Date.now(),
        }),
      );
      localStorage.removeItem(LOCAL_STORAGE_PENDING_RELEASE);
      setPendingResumeKey(null);
      setStatusMessage(`恢复提交成功，作业已创建 (${releaseRes.jobId})，正在持续轮询状态机...`);
    } catch (err: any) {
      setStatusMessage(`恢复发布失败: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 提交发布流程：严格按照时序持久化并调用实际接口，绝不吞错
  const handleSubmitRelease = async () => {
    if (!validation.ok || fileIssues.length > 0 || !session?.token) return;

    setIsSubmitting(true);
    setStatusMessage('正在初始化真实文件上传流水线...');
    setUploadProgress(10);

    try {
      const targetApiUrl = apiUrl.trim() || 'http://127.0.0.1:3000';
      const result = await executeWebUploadWorkflow({
        apiUrl: targetApiUrl,
        token: session.token,
        manifest,
        filesMap,
        onProgress: (step, percent) => {
          setStatusMessage(step);
          setUploadProgress(percent);
        },
      });

      setActiveJobId(result.jobId);
      setPendingResumeKey(null);
      setStatusMessage(`作业已成功创建 (${result.jobId})，正在持续轮询状态机...`);
    } catch (err: any) {
      // 核心要求：上传或核验失败必须停止并报错，严禁吞错继续
      setStatusMessage(`发布失败: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 未登录状态展示（严格保持原有测试契约）
  if (!session) {
    return (
      <main>
        <p className="eyebrow">Zhinexus 工作区</p>
        <h1>登录后开放</h1>
        <p className="lead">身份与权限服务接入后，此处提供组件发布功能。请输入开发者发布凭证（OIDC Bearer Token）登录控制台：</p>

        <form onSubmit={handleLogin} className="auth-form" style={{ maxWidth: '480px', marginTop: '24px' }}>
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="token-input" style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
              开发者 Bearer Token (或测试凭证):
            </label>
            <input
              id="token-input"
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                fontFamily: 'monospace',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button type="submit" className="filter-btn active">
              凭证登录
            </button>
          </div>

          {statusMessage && (
            <p style={{ color: '#dc2626', fontSize: '13px', marginTop: '12px' }}>{statusMessage}</p>
          )}
        </form>
      </main>
    );
  }

  const canSubmit = validation.ok && fileIssues.length === 0 && !isSubmitting;

  return (
    <main>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <p className="eyebrow">Zhinexus 组件资产平台 · 发布控制台</p>
          <h1>资产发布工作区 (Manual Release)</h1>
          <p className="lead">
            当前登录身份：<strong>{session.subject}</strong> · 权限: <code>{session.roles.join(', ') || '未配置'}</code> · 渠道: <code>{session.channel}</code> · API 服务: <code id="active-api-url">{apiUrl}</code>
          </p>
        </div>
        <button type="button" className="filter-btn" onClick={handleLogout}>
          退出登录
        </button>
      </div>

      {/* 断点恢复卡片（当检测到上次未完成的发布会话时展示） */}
      {pendingResumeKey && (
        <div
          id="resume-session-card"
          className="resume-card"
          style={{
            padding: '16px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '8px',
            marginBottom: '24px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ color: '#1e40af', fontSize: '14px' }}>检测到未完成的发布请求</strong>
              <span style={{ marginLeft: '8px', fontSize: '12px', fontFamily: 'monospace', color: '#2563eb' }}>
                {pendingResumeKey}
              </span>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#4b5563' }}>
                系统已持久化原幂等键及上传会话，若上次网络中断可直接点击恢复提交，绝不更换 key 重复占位。
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="filter-btn active"
                style={{ fontSize: '12px', padding: '4px 12px' }}
                onClick={handleResumePendingRelease}
                disabled={isSubmitting}
              >
                恢复提交
              </button>
              <button
                type="button"
                className="filter-btn"
                style={{ fontSize: '12px', padding: '4px 12px' }}
                onClick={() => {
                  localStorage.removeItem(LOCAL_STORAGE_PENDING_RELEASE);
                  localStorage.removeItem(LOCAL_STORAGE_ACTIVE_SESSION);
                  setPendingResumeKey(null);
                }}
              >
                放弃草稿
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导入外部 Manifest 与本地预构建产物操作栏 */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
        <label className="filter-btn" style={{ cursor: 'pointer', padding: '6px 14px', fontSize: '13px' }}>
          📄 导入外部 Manifest 清单 (manifest.json)
          <input
            id="import-manifest-input"
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportManifest}
          />
        </label>
        <label className="filter-btn" style={{ cursor: 'pointer', padding: '6px 14px', fontSize: '13px' }}>
          📦 批量导入构建产物目录或文件 (.tgz / preview / docs / api)
          <input
            id="import-files-input"
            type="file"
            multiple
            {...({ webkitdirectory: '', directory: '' } as any)}
            style={{ display: 'none' }}
            onChange={handleImportFiles}
          />
        </label>
        <label className="filter-btn" style={{ cursor: 'pointer', padding: '6px 14px', fontSize: '13px' }}>
          🖼️ 批量关联本地截图目录或文件 (screenshots/*.png)
          <input
            id="import-screenshots-input"
            type="file"
            multiple
            {...({ webkitdirectory: '', directory: '' } as any)}
            accept="image/png,image/jpeg"
            style={{ display: 'none' }}
            onChange={handleBatchScreenshots}
          />
        </label>
      </div>

      {/* 逐实现截图关联必检区域（动态覆盖全部 7 组件 14 实现） */}
      <section className="spec-table-container" style={{ marginBottom: '32px' }} aria-label="逐实现截图关联检查">
        <div style={{ padding: '16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>逐实现截图关联与必检清单 (7 组件 14 实现)</h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
              每个待发布逻辑组件的每个框架实现（Vue / React）至少关联一张有效截图；文件大小与真实哈希严格匹配；来源强制固定为 manual-upload。
            </p>
          </div>
          <span className={`tag ${canSubmit ? 'tag-ready' : 'tag'}`} style={{ fontSize: '12px' }}>
            {canSubmit ? '全部 14 实现就绪' : `未就绪: 缺图 ${validation.missingVariantIds.length} 项 / 异常 ${validation.issues.length + fileIssues.length} 项`}
          </span>
        </div>

        {/* 缺图与错配报警区 (blocks_submit_when_any_variant_has_no_image) */}
        {(!validation.ok || fileIssues.length > 0) && (
          <div
            id="missing-screenshots-alert"
            className="blocker-alert"
            style={{
              padding: '16px',
              background: '#fef2f2',
              borderBottom: '1px solid #fecaca',
              color: '#991b1b',
              fontSize: '14px',
            }}
          >
            <strong>阻断发布：存在未关联有效截图的组件实现 (SCREENSHOT_REQUIRED / 框架错配):</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: '20px' }}>
              {validation.issues.map((issue, idx) => (
                <li key={`v-${idx}`} style={{ marginBottom: '4px' }}>
                  <strong>[{issue.code}]</strong> {issue.message}
                </li>
              ))}
              {fileIssues.map((issue, idx) => (
                <li key={`f-${idx}`} style={{ marginBottom: '4px' }}>
                  <strong>[{issue.code}]</strong> {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <table className="spec-table">
          <thead>
            <tr>
              <th style={{ width: '18%' }}>逻辑组件</th>
              <th style={{ width: '18%' }}>框架实现</th>
              <th style={{ width: '22%' }}>关联包与版本</th>
              <th style={{ width: '22%' }}>截图状态与摘要</th>
              <th style={{ width: '20%' }}>操作与替换</th>
            </tr>
          </thead>
          <tbody>
            {manifest.variants.map((v) => {
              const hasShot = v.screenshots && v.screenshots.length > 0;
              const shot = v.screenshots?.[0];
              return (
                <tr key={v.variantId} className="variant-shot-card">
                  <td>
                    <strong>{v.componentId}</strong> ({v.exportName})
                  </td>
                  <td>
                    <span className={`tag ${v.framework === 'vue' ? 'tag-framework-vue' : 'tag-framework-react'}`}>
                      {v.framework === 'vue' ? 'Vue 3' : 'React 19'}
                    </span>
                    <span style={{ marginLeft: '6px', fontSize: '12px', color: '#64748b' }}>{v.variantId}</span>
                  </td>
                  <td>
                    <span className="code-badge">{v.packageName}@{v.packageVersion}</span>
                  </td>
                  <td>
                    {hasShot && shot ? (
                      <div>
                        <div style={{ color: '#16a34a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                          <span>✓</span> 已关联 ({shot.source})
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', fontFamily: 'monospace' }}>
                          {shot.image.bytes} 字节 · {shot.image.sha256.slice(0, 8)}...
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: '#dc2626', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>✗</span> 缺少有效展示截图
                      </span>
                    )}
                  </td>
                  <td>
                    {hasShot && shot ? (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <button
                          type="button"
                          className="filter-btn"
                          data-remove-shot={v.variantId}
                          style={{ padding: '2px 8px', fontSize: '11px', color: '#dc2626' }}
                          onClick={() => handleRemoveScreenshot(v.variantId)}
                        >
                          删除截图
                        </button>
                        <label
                          className="filter-btn"
                          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
                        >
                          替换截图
                          <input
                            type="file"
                            accept="image/png,image/jpeg"
                            data-upload-shot={v.variantId}
                            style={{ display: 'none' }}
                            onChange={(e) => handleFileChange(v.variantId, e)}
                          />
                        </label>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <label
                          className="filter-btn active"
                          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
                        >
                          上传有效截图
                          <input
                            type="file"
                            accept="image/png,image/jpeg"
                            data-upload-shot={v.variantId}
                            style={{ display: 'none' }}
                            onChange={(e) => handleFileChange(v.variantId, e)}
                          />
                        </label>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* 提交操作区 */}
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '24px' }}>
        <button
          type="button"
          className={`filter-btn ${canSubmit ? 'active' : ''}`}
          style={{ padding: '10px 24px', fontSize: '14px', fontWeight: 600 }}
          disabled={!canSubmit}
          onClick={handleSubmitRelease}
        >
          {isSubmitting ? '正在执行上传流水线...' : '确认并提交发布'}
        </button>
        <div style={{ fontSize: '13px', color: '#64748b' }}>
          渠道: <code>web (manual-upload)</code> · 已装配文件: <strong>{filesMap.size}</strong> 项
        </div>
      </div>

      {/* 进度条展示 */}
      {uploadProgress !== null && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
            <span>上传与核验进度</span>
            <span>{uploadProgress}%</span>
          </div>
          <div style={{ width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#0284c7', transition: 'width 0.2s' }}></div>
          </div>
        </div>
      )}

      {/* 提示信息栏 */}
      {statusMessage && (
        <div
          id="upload-status-message"
          style={{ padding: '12px 16px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #cbd5e1', fontSize: '14px', marginBottom: '24px' }}
        >
          {statusMessage}
        </div>
      )}

      {/* 活跃作业轮询看板 */}
      {activeJobId && (
        <section className="spec-table-container" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '18px' }}>发布作业轮询状态机</h2>
            <Link href={`/jobs/${activeJobId}`} className="card-link">
              在新页面打开跟踪 →
            </Link>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <div className="status-card">
              <span className="label">当前作业编号</span>
              <span className="value" style={{ fontSize: '13px', fontFamily: 'monospace' }}>
                {activeJobId}
              </span>
            </div>
            <div className="status-card">
              <span className="label">状态机状态 (State)</span>
              <span className={`value ${jobState?.state === 'READY' ? 'ready' : ''}`}>
                {jobState?.state || 'POLLING...'}
              </span>
            </div>
            <div className="status-card">
              <span className="label">流水线阶段 (Stage)</span>
              <span className="value">{jobState?.stage || 'INITIALIZING'}</span>
            </div>
            <div className="status-card">
              <span className="label">重试次数</span>
              <span className="value">{jobState?.attempt ?? 0}</span>
            </div>
          </div>

          {jobState?.state === 'READY' && (
            <div style={{ padding: '16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', color: '#166534' }}>
              <strong>🎉 发布成功！</strong> 版本状态已原子写入 Ready。可前往组件画廊或通过注册表安装使用。
            </div>
          )}

          {jobState?.state === 'CONFLICT' && (
            <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#991b1b' }}>
              <strong>⚠️ 版本冲突 (CONFLICT):</strong> 该包版本已发布过不同内容，不可变性保证禁止覆盖。
            </div>
          )}

          {jobState?.state === 'REJECTED' && (
            <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#991b1b' }}>
              <strong>❌ 发布被拒绝 (REJECTED):</strong> 产物校验或依赖未通过平台合规检查。
            </div>
          )}
        </section>
      )}
    </main>
  );
}

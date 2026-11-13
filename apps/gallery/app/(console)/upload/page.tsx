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
  createSevenComponentsManifest,
  validateUploadFiles,
  executeWebUploadWorkflow,
  computeBrowserSha256,
  fetchReleaseJob,
  parseAndValidateImportedManifest,
  attachLocalFile,
} from '../../lib/uploads/manifest-form';

const LOCAL_STORAGE_WEB_RELEASE = 'zhinexus_web_release_session';
const LOCAL_STORAGE_PENDING_RELEASE = 'zhinexus_pending_release';
const LOCAL_STORAGE_ACTIVE_SESSION = 'zhinexus_active_session_id';

export default function WebUploadConsole() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  
  // 初始化 7 组件 14 实现的完整结构与内存文件
  const [initialData] = useState(() => createSevenComponentsManifest('0.0.5'));
  const [manifest, setManifest] = useState<ReleaseManifestV1>(initialData.manifest);
  const [filesMap, setFilesMap] = useState<Map<string, Uint8Array>>(initialData.filesMap);

  const [validation, setValidation] = useState<ScreenshotValidationResult>({
    ok: true,
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
      const urlToken = params.get('token');
      if (urlToken) {
        const saved = saveSession(urlToken);
        if (saved) setSession(saved);
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
        const data = await fetchReleaseJob('http://127.0.0.1:3000', session!.token, activeJobId!);
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
  }, [activeJobId, session]);

  // 登录处理
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    const s = saveSession(tokenInput.trim());
    if (s) {
      setSession(s);
      setStatusMessage('');
    } else {
      setStatusMessage('Token 格式无效，无法解析身份');
    }
  };

  // 退出登录
  const handleLogout = () => {
    clearSession();
    setSession(null);
  };

  // 删除某变体的截图（用于复现 blocks_submit_when_any_variant_has_no_image 测试用例）
  const handleRemoveScreenshot = (variantId: string) => {
    setManifest((prev) => {
      const nextVariants = prev.variants.map((v) => {
        if (v.variantId === variantId) {
          return { ...v, screenshots: [] };
        }
        return v;
      });
      return sanitizeWebManifest({ ...prev, variants: nextVariants });
    });
  };

  // 为某变体补齐默认有效截图
  const handleAddScreenshot = (variantId: string) => {
    setManifest((prev) => {
      const nextVariants = prev.variants.map((v) => {
        if (v.variantId === variantId) {
          const shotBytes = new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
            0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x72, 0xb6, 0x0d, 0x24, 0x00, 0x00, 0x00,
            0x15, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f,
            0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x00, 0x18, 0x05, 0x03, 0x01, 0x3d,
            0x5d, 0x3a, 0x89, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
            0x42, 0x60, 0x82,
          ]);
          const imagePath = `screenshots/${variantId}-default.png`;
          setFilesMap((fm) => new Map(fm).set(imagePath, shotBytes));

          return {
            ...v,
            screenshots: [
              createManualScreenshotRef({
                id: `shot-${variantId}-default`,
                variantId: v.variantId,
                framework: v.framework,
                packageVersion: v.packageVersion,
                packageSha256: v.packageName.includes('vue')
                  ? prev.packages.find((p) => p.name === '@company/charts-vue')?.tarball.sha256 || '00'
                  : prev.packages.find((p) => p.name === '@company/charts-react')?.tarball.sha256 || '00',
                exampleId: `example-${variantId}-default`,
                imagePath,
                imageSha256: '8c762ad0993a5cf6533d38f37b4c528f38fd0b6bf614984abd19ce2f6d8eab58',
                imageBytes: shotBytes.byteLength,
                width: 800,
                height: 400,
              }),
            ],
          };
        }
        return v;
      });
      return sanitizeWebManifest({ ...prev, variants: nextVariants });
    });
  };

  // 模拟将变体配给错误的框架截图以测试错配拒绝
  const handleMismatchScreenshot = (variantId: string) => {
    setManifest((prev) => {
      const nextVariants = prev.variants.map((v) => {
        if (v.variantId === variantId) {
          const wrongFramework = v.framework === 'vue' ? 'react' : 'vue';
          const imagePath = `screenshots/${variantId}-mismatched.png`;
          const dummyShotBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
          setFilesMap((fm) => new Map(fm).set(imagePath, dummyShotBytes));

          return {
            ...v,
            screenshots: [
              createManualScreenshotRef({
                id: `shot-${variantId}-mismatched`,
                variantId: v.variantId,
                framework: wrongFramework as any, // 故意错配框架
                packageVersion: v.packageVersion,
                packageSha256: '0000000000000000000000000000000000000000000000000000000000000000',
                exampleId: `example-${variantId}-default`,
                imagePath,
                imageSha256: '0000000000000000000000000000000000000000000000000000000000000000',
                imageBytes: dummyShotBytes.byteLength,
                width: 800,
                height: 400,
              }),
            ],
          };
        }
        return v;
      });
      return sanitizeWebManifest({ ...prev, variants: nextVariants });
    });
  };

  // 允许用户通过本地文件选择器选择真实图片
  const handleFileChange = async (variantId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const sha = await computeBrowserSha256(bytes);
    const imagePath = `screenshots/${variantId}-${Date.now()}.png`;

    setFilesMap((prev) => new Map(prev).set(imagePath, bytes));

    setManifest((prev) => {
      const nextVariants = prev.variants.map((v) => {
        if (v.variantId === variantId) {
          const pkgTarball = prev.packages.find((p) => p.name === v.packageName)?.tarball;
          return {
            ...v,
            screenshots: [
              createManualScreenshotRef({
                id: `shot-${variantId}-custom-${Date.now()}`,
                variantId: v.variantId,
                framework: v.framework,
                packageVersion: v.packageVersion,
                packageSha256: pkgTarball?.sha256 || '00',
                exampleId: `example-${variantId}-default`,
                imagePath,
                imageSha256: sha,
                imageBytes: bytes.byteLength,
                width: 800,
                height: 400,
              }),
            ],
          };
        }
        return v;
      });
      return sanitizeWebManifest({ ...prev, variants: nextVariants });
    });
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

  // 导入本地预构建产物文件并计算 SHA-256
  const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    let importedCount = 0;
    const nextMap = new Map(filesMap);

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      await attachLocalFile(nextMap, file.name, bytes);
      importedCount++;
    }

    setFilesMap(nextMap);
    setStatusMessage(`成功导入 ${importedCount} 个本地预构建产物文件并计算摘要`);
  };

  // 提交发布流程：严格按照时序持久化并调用实际接口，绝不吞错
  const handleSubmitRelease = async () => {
    if (!validation.ok || fileIssues.length > 0 || !session?.token) return;

    setIsSubmitting(true);
    setStatusMessage('正在初始化真实文件上传流水线...');
    setUploadProgress(10);

    try {
      const apiUrl = 'http://127.0.0.1:3000';
      const result = await executeWebUploadWorkflow({
        apiUrl,
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
              className="search-box"
              style={{ width: '100%' }}
              placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button type="submit" className="filter-btn active">
              进入控制台
            </button>
            <button
              type="button"
              className="filter-btn"
              onClick={() => {
                const mockHeader = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
                const mockPayload = btoa(
                  JSON.stringify({
                    sub: 'web-developer-alice',
                    roles: ['publisher', 'maintainer'],
                    azp: 'web',
                    client_id: 'web',
                    exp: Math.floor(Date.now() / 1000) + 3600,
                  }),
                );
                const mockToken = `${mockHeader}.${mockPayload}.testsignature`;
                const s = saveSession(mockToken);
                if (s) setSession(s);
              }}
            >
              一键模拟开发者登录
            </button>
          </div>

          {statusMessage && (
            <p style={{ color: '#dc2626', fontSize: '13px', marginTop: '12px' }}>{statusMessage}</p>
          )}
        </form>
      </main>
    );
  }

  // 已登录状态展示完整发布控制台
  const canSubmit = validation.ok && fileIssues.length === 0 && !isSubmitting;

  return (
    <main>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <p className="eyebrow">Zhinexus 组件资产平台 · 发布控制台</p>
          <h1>资产发布工作区 (Manual Release)</h1>
          <p className="lead">
            当前登录身份：<strong>{session.subject}</strong> · 权限: <code>{session.roles.join(', ') || '未配置'}</code> · 渠道: <code>{session.channel}</code>
          </p>
        </div>
        <button type="button" className="filter-btn" onClick={handleLogout}>
          退出登录
        </button>
      </div>

      {/* 断点恢复提示卡片 */}
      {pendingResumeKey && (
        <div style={{ padding: '16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>🔄 检测到未完成的发布请求：</strong>
              <span style={{ fontSize: '13px', color: '#1e40af', marginLeft: '8px', fontFamily: 'monospace' }}>
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
                onClick={handleSubmitRelease}
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
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportManifest}
          />
        </label>
        <label className="filter-btn" style={{ cursor: 'pointer', padding: '6px 14px', fontSize: '13px' }}>
          📦 导入本地预构建产物文件 (.tgz / 静态文件)
          <input
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleImportFiles}
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
            <strong>阻断发布：存在未关联有效截图或校验失败的组件实现 (SCREENSHOT_REQUIRED / 框架错配):</strong>
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
                        <span>✗</span> 缺少截图
                      </span>
                    )}
                  </td>
                  <td>
                    {hasShot ? (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="filter-btn"
                          data-remove-shot={v.variantId}
                          style={{ padding: '2px 8px', fontSize: '11px', color: '#dc2626' }}
                          onClick={() => handleRemoveScreenshot(v.variantId)}
                        >
                          删除截图
                        </button>
                        <button
                          type="button"
                          className="filter-btn"
                          style={{ padding: '2px 8px', fontSize: '11px' }}
                          onClick={() => handleMismatchScreenshot(v.variantId)}
                        >
                          模拟框架错配测试
                        </button>
                        <label
                          className="filter-btn"
                          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
                        >
                          替换图片
                          <input
                            type="file"
                            accept="image/png,image/jpeg"
                            style={{ display: 'none' }}
                            onChange={(e) => handleFileChange(v.variantId, e)}
                          />
                        </label>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          className="filter-btn active"
                          data-restore-shot={v.variantId}
                          style={{ padding: '2px 8px', fontSize: '11px' }}
                          onClick={() => handleAddScreenshot(v.variantId)}
                        >
                          补齐默认截图
                        </button>
                        <label
                          className="filter-btn"
                          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
                        >
                          上传文件
                          <input
                            type="file"
                            accept="image/png,image/jpeg"
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

      {/* 提交发布操作区 */}
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '32px' }}>
        <button
          type="button"
          id="submit-release-btn"
          className="filter-btn active"
          style={{ padding: '10px 24px', fontSize: '15px' }}
          disabled={!canSubmit}
          onClick={handleSubmitRelease}
        >
          {isSubmitting ? '真实产物发布中...' : '确认并提交发布'}
        </button>

        {!canSubmit && (
          <span style={{ color: '#dc2626', fontSize: '13px' }}>
            （部分实现缺少截图、存在框架错配或文件损坏，提交已被严格阻断禁用）
          </span>
        )}
      </div>

      {/* 进度与状态提示 */}
      {uploadProgress !== null && (
        <div style={{ marginBottom: '24px', background: '#ffffff', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
            <span>上传进度</span>
            <span>{uploadProgress}%</span>
          </div>
          <div style={{ width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#0284c7', transition: 'width 0.2s' }}></div>
          </div>
        </div>
      )}

      {statusMessage && (
        <div style={{ padding: '12px 16px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #cbd5e1', fontSize: '14px', marginBottom: '24px' }}>
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

          <div className="status-grid" style={{ marginBottom: '16px' }}>
            <div className="status-card">
              <span className="label">作业 ID (Job ID)</span>
              <span className="value" style={{ fontFamily: 'monospace', fontSize: '13px' }}>{activeJobId}</span>
            </div>
            <div className="status-card">
              <span className="label">状态 (State)</span>
              <span className={`value ${jobState?.state === 'READY' ? 'ready' : ''}`}>
                {jobState?.state ?? 'PENDING'}
              </span>
            </div>
            <div className="status-card">
              <span className="label">执行阶段 (Stage)</span>
              <span className="value">{jobState?.stage ?? 'INITIALIZING'}</span>
            </div>
            <div className="status-card">
              <span className="label">重试次数</span>
              <span className="value">{jobState?.attempt ?? 0}</span>
            </div>
          </div>

          {jobState?.state === 'READY' && (
            <div style={{ padding: '16px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', color: '#065f46' }}>
              <strong>发布成功！</strong> 版本状态已原子写入 Ready。可前往{' '}
              <Link href="/components" style={{ color: '#047857', textDecoration: 'underline' }}>
                组件画廊目录
              </Link>{' '}
              查看已发布的资产与隔离预览。
            </div>
          )}
        </section>
      )}
    </main>
  );
}

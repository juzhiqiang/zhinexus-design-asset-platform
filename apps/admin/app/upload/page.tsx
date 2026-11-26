'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { manifestDigest, type PackageRef, type PublishingOptionsResponse, type ReleaseManifestV1, type VariantRef } from '@company/contracts';
import { getStoredSession, loadCompanySession, platformApiOrigin, type UserSession } from '../lib/auth';
import { CategoryApiError, readPublishingOptions } from '../lib/categories-client';
import {
  validateVariantScreenshots,
  createManualScreenshotRef,
  type ScreenshotValidationResult,
} from '../lib/uploads/screenshot-validation';
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
  buildPublishingManifest,
} from '../lib/uploads/manifest-form';
import { ZnIcon } from '../lib/design/icons';
import { COMMAND_MOTIFS, ZnCommandMotif } from '../lib/design/motifs';

const LOCAL_STORAGE_WEB_RELEASE = 'zhinexus_web_release_session';
const LOCAL_STORAGE_PENDING_RELEASE = 'zhinexus_pending_release';
const LOCAL_STORAGE_ACTIVE_SESSION = 'zhinexus_active_session_id';

/** 画板 01 的 Command Motif（INGEST ORBIT / 01）。 */
const MOTIF = COMMAND_MOTIFS[0]!;

const EMPTY_WEB_MANIFEST: ReleaseManifestV1 = {
  schemaVersion: 1,
  channel: 'web',
  packages: [],
  variants: [],
  reports: [],
  files: [],
};

export default function WebUploadConsole() {
  const [session, setSession] = useState<UserSession | null>(() => getStoredSession());
  const [apiUrl, setApiUrl] = useState<string>(platformApiOrigin);

  // 默认空工作台：引导导入真实冻结产物清单与 tarball，演示草稿可手动一键加载
  const [manifest, setManifest] = useState<ReleaseManifestV1>(EMPTY_WEB_MANIFEST);
  const [filesMap, setFilesMap] = useState<Map<string, Uint8Array>>(() => new Map());
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
  const [publishingOptions, setPublishingOptions] = useState<PublishingOptionsResponse | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsRefresh, setOptionsRefresh] = useState(0);
  const optionsGeneration = useRef(0);
  const selection = useMemo(() => buildPublishingManifest(manifest, selectedVariantIds, publishingOptions?.categories ?? []), [manifest, selectedVariantIds, publishingOptions]);
  const validationManifest = selection.ok ? selection.value : manifest;

  const [validation, setValidation] = useState<ScreenshotValidationResult>({
    ok: false,
    missingVariantIds: [],
    issues: [],
  });
  const [fileIssues, setFileIssues] = useState<Array<{ code: string; path: string; message: string }>>([]);
  const [isValidatingFiles, setIsValidatingFiles] = useState(false);
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
    void loadCompanySession().then(value=>{if(value)setSession(value);});

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

      try {
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

  useEffect(() => {
    const generation = ++optionsGeneration.current;
    setPublishingOptions(null); setOptionsError('');
    setOptionsLoading(false);
    if (!session) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && generation === optionsGeneration.current;
    setOptionsLoading(true);
    void readPublishingOptions({ apiUrl, token: session.token, signal: controller.signal }).then(value => {
      if (current()) setPublishingOptions(value);
    }).catch(failure => {
      if (current()) setOptionsError(failure instanceof Error ? failure.message : '读取发布选项失败。');
    }).finally(() => { if (current()) setOptionsLoading(false); });
    return () => { controller.abort(); optionsGeneration.current++; };
  }, [apiUrl, session, optionsRefresh]);

  // 1.1 动态断点恢复资格核验：当 session.subject 或 apiUrl 变更时严格 fail-closed 检查
  useEffect(() => {
    if (!session?.subject) {
      setPendingResumeKey(null);
      return;
    }

    const currentApi = (apiUrl || localStorage.getItem('zhinexus_api_url') || 'http://127.0.0.1:3000').trim();

    try {
      const savedPending = localStorage.getItem(LOCAL_STORAGE_PENDING_RELEASE);
      if (!savedPending) {
        setPendingResumeKey(null);
        return;
      }

      const parsed = JSON.parse(savedPending);
      const hasRequiredFields =
        Boolean(parsed.idempotencyKey) &&
        Boolean(parsed.uploadSessionId) &&
        Boolean(parsed.apiUrl) &&
        Boolean(parsed.subject) &&
        Boolean(parsed.manifestDigest) &&
        Boolean(parsed.manifest);

      if (!hasRequiredFields) {
        setPendingResumeKey(null);
        return;
      }

      const apiMatches = parsed.apiUrl.trim() === currentApi;
      const subjectMatches = parsed.subject === session.subject;

      if (!apiMatches || !subjectMatches) {
        setPendingResumeKey(null);
        return;
      }

      // 重算 pending.manifest 摘要防篡改
      let cancelled = false;
      manifestDigest(parsed.manifest)
        .then((computedDigest) => {
          if (!cancelled) {
            if (computedDigest === parsed.manifestDigest) {
              setPendingResumeKey(parsed.idempotencyKey);
            } else {
              setPendingResumeKey(null);
            }
          }
        })
        .catch(() => {
          if (!cancelled) setPendingResumeKey(null);
        });

      return () => {
        cancelled = true;
      };
    } catch {
      setPendingResumeKey(null);
    }
  }, [session?.subject, apiUrl]);

  // 2. 变体截图与文件完整性校验（含代际取消保护与校验中提交禁用）
  useEffect(() => {
    const res = validateVariantScreenshots(validationManifest.variants, validationManifest.packages);
    setValidation(res);

    let cancelled = false;
    setIsValidatingFiles(true);

    validateUploadFiles(validationManifest, filesMap)
      .then((fRes) => {
        if (!cancelled) {
          setFileIssues(fRes.issues);
          setIsValidatingFiles(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFileIssues([
            {
              code: 'CHECKSUM_FAILED',
              path: 'files',
              message: `文件校验异常: ${err.message || '未知错误'}`,
            },
          ]);
          setIsValidatingFiles(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [validationManifest, filesMap]);

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

  // 加载 7 组件 14 实现演示草稿（用于演练与回归验证）
  const handleLoadDemoDraft = () => {
    const demo = createEmptySevenComponentsDraft('0.0.6');
    setManifest(demo.manifest);
    setFilesMap(demo.filesMap);
    setSelectedVariantIds(demo.manifest.variants.map((variant) => variant.variantId));
    setStatusMessage('已加载 7 组件 14 实现演示草稿，请为每个实现关联有效展示截图。');
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
        setSelectedVariantIds(res.manifest.variants.map(variant => variant.variantId));
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

    const hasRequiredFields =
      Boolean(pending.uploadSessionId) &&
      Boolean(pending.idempotencyKey) &&
      Boolean(pending.manifest) &&
      Boolean(pending.manifestDigest) &&
      Boolean(pending.apiUrl) &&
      Boolean(pending.subject);

    if (!hasRequiredFields) {
      setStatusMessage('恢复记录不完整，缺少必须的绑定字段，拒绝恢复重放');
      return;
    }

    const targetApiUrl = apiUrl.trim() || 'http://127.0.0.1:3000';
    if (pending.apiUrl.trim() !== targetApiUrl) {
      setStatusMessage(`恢复记录绑定的 API 地址 (${pending.apiUrl}) 与当前环境 (${targetApiUrl}) 不一致，禁止恢复重放`);
      return;
    }
    if (pending.subject !== session?.subject) {
      setStatusMessage(`恢复记录绑定的用户 (${pending.subject}) 与当前登录用户 (${session?.subject}) 不一致，禁止恢复重放`);
      return;
    }

    // 重算摘要防篡改
    const computedDigest = await manifestDigest(pending.manifest);
    if (computedDigest !== pending.manifestDigest) {
      setStatusMessage('恢复记录中的 Manifest 内容与期望摘要不一致（清单已被篡改），拒绝恢复重放');
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(`正在使用原幂等键 (${pending.idempotencyKey}) 恢复提交发布作业...`);

    try {
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
      // 成功恢复后彻底清理 pending、active 会话与草稿
      localStorage.removeItem(LOCAL_STORAGE_PENDING_RELEASE);
      localStorage.removeItem(LOCAL_STORAGE_ACTIVE_SESSION);
      localStorage.removeItem('zhinexus_active_session_plan');
      localStorage.removeItem('zhinexus_upload_draft');
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
    if (!session?.token || !session?.subject) return;

    setIsSubmitting(true);
    setStatusMessage('正在执行提交前最终快照完整性核验...');

    try {
      // Freeze selections from the current draft and recheck explicit categories against the real API.
      let categories = publishingOptions?.categories ?? [];
      if (manifest.variants.some(variant => selectedVariantIds.includes(variant.variantId) && variant.category !== undefined)) {
        const generation = optionsGeneration.current;
        let latestOptions: PublishingOptionsResponse;
        try {
          latestOptions = await readPublishingOptions({ apiUrl, token: session.token });
        } catch (failure) {
          if (generation !== optionsGeneration.current) return;
          if (failure instanceof CategoryApiError && [401, 403].includes(failure.status)) {
            optionsGeneration.current++;
            setPublishingOptions(null); setOptionsError(failure.message); setOptionsLoading(false);
          }
          throw failure;
        }
        if (generation !== optionsGeneration.current) return;
        setPublishingOptions(latestOptions);
        categories = latestOptions.categories;
      }
      const finalSelection = buildPublishingManifest(manifest, selectedVariantIds, categories);
      if (!finalSelection.ok) {
        setStatusMessage(`发布选择未通过: ${finalSelection.issues.map(issue => issue.message).join('；')}`);
        return;
      }
      const finalManifest = finalSelection.value;
      // 核心门禁：即使 UI 状态未显示异常，也必须对当前 manifest 与 filesMap 快照同步重跑真实校验
      const finalScreenshotRes = validateVariantScreenshots(finalManifest.variants, finalManifest.packages);
      if (!finalScreenshotRes.ok) {
        setValidation(finalScreenshotRes);
        setStatusMessage('提交前变体截图核验未通过，阻断发布');
        return;
      }

      const finalFileRes = await validateUploadFiles(finalManifest, filesMap);
      if (!finalFileRes.ok || finalFileRes.issues.length > 0) {
        setFileIssues(finalFileRes.issues);
        setStatusMessage(
          `提交前文件核验失败: 存在 ${finalFileRes.issues.length} 处哈希或尺寸异常 (${finalFileRes.issues[0]?.message})，阻断发布`,
        );
        return;
      }

      if (finalManifest.variants.length === 0 || finalManifest.files.length === 0) {
        setStatusMessage('发布清单变体或产物文件列表不能为空，阻断发布');
        return;
      }

      setStatusMessage('正在初始化真实文件上传流水线...');
      setUploadProgress(10);

      const targetApiUrl = apiUrl.trim() || 'http://127.0.0.1:3000';
      const result = await executeWebUploadWorkflow({
        apiUrl: targetApiUrl,
        token: session.token,
        manifest: finalManifest,
        filesMap,
        subject: session.subject,
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
      setStatusMessage(`发布失败: ${err?.message || String(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit =
    selection.ok &&
    validation.ok &&
    fileIssues.length === 0 &&
    manifest.variants.length > 0 &&
    manifest.files.length > 0 &&
    !isValidatingFiles &&
    !isSubmitting;

  return (
    <main>
      <div className="zn-page-header access-heading">
        <div className="zn-header-copy">
          <p className="eyebrow">02 / RELEASE MANIFEST</p>
          <h1>资产发布工作区 (Manual Release)</h1>
          <p className="lead">导入本地冻结产物清单与双框架截图，校验通过后创建不可变发布作业。</p>
          {session ? (
            <p className="lead">
              当前登录身份：<strong>{session.subject}</strong> · 权限: <code>{session.roles.join(', ') || '未配置'}</code> · 渠道: <code>{session.channel}</code> · API 服务: <code id="active-api-url">{apiUrl}</code>
            </p>
          ) : null}
        </div>
        <ZnCommandMotif motif={MOTIF} className="zn-motif" />
        <div className="zn-header-actions">
          <button type="button" className="filter-btn" disabled={isSubmitting} onClick={handleLoadDemoDraft}>
            加载 7 组件演示草稿
          </button>
        </div>
      </div>

      <div className="zn-metrics">
        <div className="zn-metric">
          <span className="zn-metric-rail" />
          <span className="zn-metric-copy">
            <span className="zn-metric-value">{filesMap.size}</span>
            <span className="zn-metric-label">已装配文件</span>
          </span>
        </div>
        <div className="zn-metric">
          <span className="zn-metric-rail" />
          <span className="zn-metric-copy">
            <span className="zn-metric-value">{manifest.variants.length - validation.missingVariantIds.length} / {manifest.variants.length}</span>
            <span className="zn-metric-label">有效截图</span>
          </span>
        </div>
        <div className="zn-metric">
          <span className="zn-metric-rail zn-metric-rail-gold" />
          <span className="zn-metric-copy">
            <span className="zn-metric-value">{validation.missingVariantIds.length}</span>
            <span className="zn-metric-label">待补充</span>
          </span>
        </div>
        <div className="zn-metric">
          <span className="zn-metric-rail" />
          <span className="zn-metric-copy">
            <span className="zn-metric-value zn-metric-value-sm">manual-upload</span>
            <span className="zn-metric-label">来源渠道</span>
          </span>
        </div>
      </div>

      <section className="catalog-toolbar" aria-label="发布实现与分类选择" style={{ display: 'block' }}>
        <h2 style={{ fontSize: 16 }}>选择实际框架实现与分类</h2>
        <p className="match-hint">只选择当前清单中已有的实现。框架由预构建产物、API 与截图确定；发布另一框架请导入它的真实产物。</p>
        <p className="match-note">同一冻结包的全部实现一起选择，保留 tarball 与导出的完整对应关系。</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="zn-row" style={{ gap: 8 }}>
            <span className="zn-field-label">待发布框架</span>
            <select className="zn-input" style={{ width: 170, minHeight: 34 }} disabled={isSubmitting} value={
            selectedVariantIds.length === manifest.variants.length ? 'all'
              : selectedVariantIds.length && manifest.variants.filter(variant => selectedVariantIds.includes(variant.variantId)).every(variant => variant.framework === 'vue') ? 'vue'
                : selectedVariantIds.length && manifest.variants.filter(variant => selectedVariantIds.includes(variant.variantId)).every(variant => variant.framework === 'react') ? 'react' : 'custom'
          } onChange={event => setSelectedVariantIds(manifest.variants.filter(variant => event.target.value === 'all' || variant.framework === event.target.value).map(variant => variant.variantId))}>
              <option value="all">全部现有实现</option>
              <option value="vue" disabled={!manifest.variants.some(variant => variant.framework === 'vue')}>仅 Vue 3</option>
              <option value="react" disabled={!manifest.variants.some(variant => variant.framework === 'react')}>仅 React 19</option>
              <option value="custom" disabled>逐实现选择</option>
            </select>
          </label>
          <button type="button" className="filter-btn" disabled={optionsLoading || isSubmitting} onClick={() => setOptionsRefresh(value => value + 1)}>刷新发布选项</button>
          <span role="status" className="zn-hint">{optionsLoading ? '正在读取发布选项…' : `已选择 ${selectedVariantIds.length} / ${manifest.variants.length} 个实现`}</span>
        </div>
        {optionsError && manifest.variants.length > 0 && <p className="field-error" role="alert">{optionsError} 分类选择暂不可用；旧清单未指定分类时继续兼容。</p>}
        {publishingOptions && <p className="match-note">当前发布授权：组件 {publishingOptions.components.map(item => item.componentId).join('、') || '无'} · 包 {publishingOptions.packages.join('、') || '无'}。最终权限由 API 校验。</p>}
        {publishingOptions?.components.filter(item => !publishingOptions.categories.some(category => category.id === item.category && category.enabled) && manifest.variants.some(variant => variant.componentId === item.componentId)).map(item => <p key={item.componentId} className="field-error">{item.componentId} 当前分类 {item.category} 未知或已停用</p>)}
        {manifest.variants.length > 0 && !selection.ok && <div id="publishing-selection-alert" className="match-errors" role="alert">阻断发布：{selection.issues.map(issue => issue.message).join('；')}</div>}
      </section>

      {/* 断点恢复卡片（当检测到上次未完成的发布会话时展示） */}
      {pendingResumeKey && (
        <div id="resume-session-card" className="resume-card">
          <div>
            <strong>检测到未完成的发布请求</strong>
            <span style={{ marginLeft: '8px', fontFamily: 'var(--zn-font-mono)', fontSize: '12px', color: 'var(--zn-accent)' }}>
              {pendingResumeKey}
            </span>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--zn-muted)' }}>
              系统已持久化原幂等键及上传会话，若上次网络中断可直接点击恢复提交，绝不更换 key 重复占位。
            </p>
          </div>
          <div className="zn-row">
            <button type="button" className="filter-btn active" onClick={handleResumePendingRelease} disabled={isSubmitting}>恢复提交</button>
            <button
              type="button"
              className="filter-btn"
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
      )}

      {/* 导入外部 Manifest 与本地预构建产物操作栏 */}
      <div className="zn-card zn-row" style={{ padding: '14px 18px' }}>
        <div className="zn-stack-sm" style={{ gap: 2 }}>
          <h2 className="zn-card-title">实现截图清单</h2>
          <p className="zn-card-subtitle">每个逻辑组件的 Vue / React 实现必须分别关联有效截图</p>
        </div>
        <div className="zn-row" style={{ marginLeft: 'auto' }}>
          <label className="filter-btn" style={{ cursor: 'pointer' }}>
            <ZnIcon name="upload" size={15} color="var(--zn-muted)" />导入 Manifest
            <input id="import-manifest-input" type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleImportManifest} />
          </label>
          <label className="filter-btn" style={{ cursor: 'pointer' }}>
            <ZnIcon name="package" size={15} color="var(--zn-muted)" />批量导入
            <input
              id="import-files-input"
              type="file"
              multiple
              {...({ webkitdirectory: '', directory: '' } as any)}
              style={{ display: 'none' }}
              onChange={handleImportFiles}
            />
          </label>
          <label className="filter-btn active" style={{ cursor: 'pointer' }}>
            <ZnIcon name="plus" size={15} color="var(--zn-on-primary)" />选择截图
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
      </div>

      {/* 逐实现截图关联必检区域（动态覆盖全部 7 组件 14 实现） */}
      <section className="spec-table-container" aria-label="逐实现截图关联检查">
        <div style={{ padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2>逐实现截图关联与必检清单 ({new Set(validationManifest.variants.map(variant => variant.componentId)).size} 组件 {validationManifest.variants.length} 实现)</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--zn-subtle)' }}>
              每个待发布逻辑组件的每个框架实现（Vue / React）至少关联一张有效截图；文件大小与真实哈希严格匹配；来源强制固定为 manual-upload。
            </p>
          </div>
          <span className={`tag ${canSubmit ? 'tag-ready' : 'tag'}`} style={{ fontSize: '12px' }}>
            {canSubmit ? `全部 ${validationManifest.variants.length} 实现就绪` : `未就绪: 缺图 ${validation.missingVariantIds.length} 项 / 异常 ${validation.issues.length + fileIssues.length} 项`}
          </span>
        </div>

        {/* 缺图与错配报警区 (仅在已导入清单后展示，空工作台保持克制) */}
        {manifest.variants.length > 0 && (!validation.ok || fileIssues.length > 0) && (
          <div id="missing-screenshots-alert" className="blocker-alert">
            <strong>阻断发布：存在未关联有效截图的组件实现 (SCREENSHOT_REQUIRED / 框架错配):</strong>
            <ul>
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

        <div style={{ overflowX: 'auto' }}>
          <table className="spec-table">
            <thead>
              <tr>
                <th>逻辑组件</th>
                <th>分类</th>
                <th>框架实现</th>
                <th>关联包与版本</th>
                <th>截图状态与摘要</th>
                <th>操作与替换</th>
              </tr>
            </thead>
            <tbody>
              {manifest.variants.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--zn-muted)' }}>
                    尚未导入冻结发布清单。请点击上方「导入 Manifest」与「批量导入」加载本地预构建产物，或点击右上角「加载 7 组件演示草稿」。
                  </td>
                </tr>
              )}
              {manifest.variants.map((v) => {
                const hasShot = v.screenshots && v.screenshots.length > 0;
                const shot = v.screenshots?.[0];
                return (
                  <tr key={v.variantId} className="variant-shot-card">
                    <td>
                      <label style={{ marginRight: '8px' }}>
                        <input
                          type="checkbox"
                          aria-label={`发布 ${v.variantId}`}
                          disabled={isSubmitting}
                          checked={selectedVariantIds.includes(v.variantId)}
                          onChange={event => {
                            const packageIds = manifest.variants.filter(variant => variant.packageName === v.packageName).map(variant => variant.variantId);
                            setSelectedVariantIds(current => event.target.checked ? [...new Set([...current, ...packageIds])] : current.filter(id => !packageIds.includes(id)));
                          }}
                        /> 发布
                      </label>
                      <strong>{v.componentId}</strong> ({v.exportName})
                    </td>
                    <td>
                      <select
                        aria-label={`${v.variantId} 分类`}
                        value={v.category ?? ''}
                        disabled={!publishingOptions || optionsLoading || isSubmitting}
                        style={{ maxWidth: 180 }}
                        onChange={event => {
                          const category = event.target.value;
                          setManifest(current => ({
                            ...current,
                            variants: current.variants.map(variant => {
                              if (variant.componentId !== v.componentId) return variant;
                              const updated = { ...variant };
                              if (category) updated.category = category;
                              else delete updated.category;
                              return updated;
                            }),
                          }));
                        }}
                      >
                        <option value="">未指定（旧清单兼容）</option>
                        {v.category && !publishingOptions?.categories.some(category => category.id === v.category) && <option value={v.category} disabled>{v.category}（未知或已停用）</option>}
                        {publishingOptions?.categories.map(category => <option key={category.id} value={category.id} disabled={!category.enabled}>{category.name} · {category.id}{category.enabled ? '' : '（已停用）'}</option>)}
                      </select>
                    </td>
                    <td>
                      <span className={`tag ${v.framework === 'vue' ? 'tag-framework-vue' : 'tag-framework-react'}`}>
                        {v.framework === 'vue' ? 'Vue 3' : 'React 19'}
                      </span>
                      <span style={{ marginLeft: '6px', fontSize: '12px', color: 'var(--zn-subtle)' }}>{v.variantId}</span>
                    </td>
                    <td>
                      <span className="code-badge">{v.packageName}@{v.packageVersion}</span>
                    </td>
                    <td>
                      {hasShot && shot ? (
                        <div>
                          <div style={{ color: 'var(--zn-success)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                            <ZnIcon name="check" size={13} color="var(--zn-success)" /> 已关联 ({shot.source})
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--zn-subtle)', marginTop: '2px', fontFamily: 'var(--zn-font-mono)' }}>
                            {shot.image.bytes} 字节 · {shot.image.sha256.slice(0, 8)}...
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--zn-danger)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <ZnIcon name="triangle-alert" size={13} color="var(--zn-danger)" /> 缺少有效展示截图
                        </span>
                      )}
                    </td>
                    <td>
                      {hasShot && shot ? (
                        <div className="zn-row" style={{ gap: 6 }}>
                          <button
                            type="button"
                            className="filter-btn"
                            data-remove-shot={v.variantId}
                            style={{ color: 'var(--zn-danger)' }}
                            onClick={() => handleRemoveScreenshot(v.variantId)}
                          >
                            删除截图
                          </button>
                          <label className="filter-btn" style={{ cursor: 'pointer' }}>
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
                        <label className="filter-btn active" style={{ cursor: 'pointer' }}>
                          上传有效截图
                          <input
                            type="file"
                            accept="image/png,image/jpeg"
                            data-upload-shot={v.variantId}
                            style={{ display: 'none' }}
                            onChange={(e) => handleFileChange(v.variantId, e)}
                          />
                        </label>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 发布前检查结论与提交操作区 */}
      <div className="zn-notice zn-notice-block" style={validation.ok && fileIssues.length === 0 ? { background: 'var(--zn-success-soft)', borderLeftColor: 'var(--zn-success)', color: 'var(--zn-success)' } : undefined}>
        <ZnIcon name={validation.ok && fileIssues.length === 0 ? 'circle-check-big' : 'triangle-alert'} size={17} color="var(--zn-warning)" className="zn-notice-icon" />
        <div className="zn-stack-sm" style={{ gap: 2, flex: '1 1 auto' }}>
          <strong style={{ fontFamily: 'var(--zn-font-mono)', fontSize: 12 }}>
            {validation.ok && fileIssues.length === 0 ? '发布前检查已通过' : '发布前检查未通过'}
          </strong>
          <span style={{ fontSize: 11 }}>
            {manifest.variants.length === 0
              ? '请先导入冻结的 Manifest 清单与预构建产物文件。'
              : validation.ok && fileIssues.length === 0
                ? `全部 ${validationManifest.variants.length} 个实现均已关联有效截图，可以创建不可变发布作业。`
                : `请补充${validation.missingVariantIds.map(id => manifest.variants.find(v => v.variantId === id)?.componentId).filter(Boolean).join('、') || '缺失'}的截图，然后重新运行校验。`}
          </span>
        </div>
        <button
          type="button"
          className={canSubmit ? 'filter-btn active' : 'filter-btn'}
          style={{ padding: '10px 24px', fontSize: '14px', fontWeight: 600 }}
          disabled={!canSubmit}
          onClick={handleSubmitRelease}
        >
          {isSubmitting ? '正在执行上传流水线...' : '确认并提交发布'}
        </button>
      </div>

      <div className="zn-row" style={{ fontSize: '12px', color: 'var(--zn-subtle)' }}>
        <span>渠道: <code>web (manual-upload)</code> · 已装配文件: <strong>{filesMap.size}</strong> 项</span>
      </div>

      {/* 进度条展示 */}
      {uploadProgress !== null && (
        <div className="zn-progress" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
          <span className="zn-progress-value" style={{ width: `${uploadProgress}%` }} />
        </div>
      )}

      {/* 提示信息栏 */}
      {statusMessage && (
        <div
          id="upload-status-message"
          className="access-message"
        >
          {statusMessage}
        </div>
      )}

      {/* 活跃作业轮询看板 */}
      {activeJobId && (
        <section className="spec-table-container" style={{ padding: '20px' }}>
          <div className="zn-row zn-row-between" style={{ marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '18px' }}>发布作业轮询状态机</h2>
            <Link href={`/jobs/${activeJobId}`} className="filter-btn">
              在新页面打开跟踪 →
            </Link>
          </div>

          <div className="status-grid" style={{ marginBottom: '20px' }}>
            <div className="status-card">
              <span className="label">当前作业编号</span>
              <span className="value" style={{ fontSize: '13px', fontFamily: 'var(--zn-font-mono)' }}>
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
            <div className="access-message" style={{ marginBottom: 12 }}>
              <strong>发布成功！</strong> 版本状态已原子写入 Ready。可前往组件画廊或通过注册表安装使用。
            </div>
          )}

          {jobState?.state === 'CONFLICT' && (
            <div className="access-error" style={{ marginBottom: 12 }}>
              <strong>版本冲突 (CONFLICT):</strong> 该包版本已发布过不同内容，不可变性保证禁止覆盖。
            </div>
          )}

          {jobState?.state === 'REJECTED' && (
            <div className="access-error" style={{ marginBottom: 12 }}>
              <strong>发布被拒绝 (REJECTED):</strong> 产物校验或依赖未通过平台合规检查。
            </div>
          )}
        </section>
      )}
    </main>
  );
}

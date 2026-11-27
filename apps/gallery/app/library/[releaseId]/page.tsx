'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ApiMessages, PublicVariantSummary } from '@company/contracts';
import { clearSession, companyLoginUrl, loadCompanySession, type UserSession } from '../../lib/auth';
import { getDisplayEnhancement } from '../../lib/catalog';
import type { MeasuredCompatibility } from '../../lib/echarts-compatibility';
import {
  fetchMyComponents,
  fetchMyVariantArtifactText,
  fetchMyVariantCompatibility,
  fetchMyVariantRelease,
  fetchMyVariantReports,
  type LibraryResult,
} from '../../lib/library-client';
import type { ComponentVariantMeta } from '../../lib/types';
import { ComponentPreview } from '../../(public)/components/[slug]/ComponentPreview';
import { EchartsCompatibility, type CompatibilityLoadState } from '../../(public)/components/[slug]/EchartsCompatibility';

type DetailPayload = {
  release: ApiMessages['variantReleaseResponse'];
  reports: ApiMessages['variantReportsResponse']['reports'];
  docsText: string | null;
  siblings: PublicVariantSummary[];
  compatibility: CompatibilityLoadState<MeasuredCompatibility>;
};

type ViewState =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden' }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: DetailPayload };

function firstDeniedStatus(
  results: Array<LibraryResult<unknown>>,
): 'unauthenticated' | 'forbidden' | 'not_found' | null {
  for (const res of results) {
    if (res.status === 'unauthenticated') return 'unauthenticated';
  }
  for (const res of results) {
    if (res.status === 'forbidden') return 'forbidden';
  }
  for (const res of results) {
    if (res.status === 'not_found') return 'not_found';
  }
  return null;
}

export default function LibraryReleaseDetailPage({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}) {
  const { releaseId } = use(params);
  const [activeReleaseId, setActiveReleaseId] = useState(releaseId);
  const [session, setSession] = useState<UserSession | null>(null);
  const [view, setView] = useState<ViewState>({ kind: 'loading' });
  const [previewRevision, setPreviewRevision] = useState(0);

  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setActiveReleaseId(releaseId);
  }, [releaseId]);

  const clearPrivateData = useCallback((next: ViewState, clearAuth = false) => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (clearAuth) {
      setSession(null);
    }
    setView(next);
  }, []);

  const loadRelease = useCallback(async (targetReleaseId: string) => {
    const gen = ++generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // 重检或切换版本开始即刻清空旧 ready 数据与预览 iframe，防止切换账号/权限期间残留旧资产
    setView({ kind: 'loading' });

    const currentSession = await loadCompanySession();
    if (gen !== generationRef.current || controller.signal.aborted) return;

    if (!currentSession) {
      setSession(null);
      setView({ kind: 'unauthenticated' });
      return;
    }

    setSession(currentSession);
    const releaseResult = await fetchMyVariantRelease(targetReleaseId, currentSession, { signal: controller.signal });
    if (gen !== generationRef.current || controller.signal.aborted) return;

    if (releaseResult.status === 'unauthenticated') {
      clearSession();
      clearPrivateData({ kind: 'unauthenticated' }, true);
      return;
    }
    if (releaseResult.status === 'forbidden') {
      clearPrivateData({ kind: 'forbidden' });
      return;
    }
    if (releaseResult.status === 'not_found') {
      clearPrivateData({ kind: 'not_found' });
      return;
    }
    if (releaseResult.status !== 'ok') {
      clearPrivateData({ kind: 'error', message: releaseResult.message });
      return;
    }

    const release = releaseResult.data;
    const [reportsRes, docsRes, siblingsRes, compatRes] = await Promise.all([
      fetchMyVariantReports(targetReleaseId, currentSession, { signal: controller.signal }),
      fetchMyVariantArtifactText(targetReleaseId, release.variant.docs.path, currentSession, { signal: controller.signal }),
      fetchMyComponents(currentSession, { query: release.variant.componentId, signal: controller.signal }),
      fetchMyVariantCompatibility(targetReleaseId, release, currentSession, { signal: controller.signal }),
    ]);
    if (gen !== generationRef.current || controller.signal.aborted) return;

    // 真实 API 用 404 隐藏撤权；任意受保护子请求返回 401/403/404 必须立即清空详情、文档与 iframe
    const denied = firstDeniedStatus([reportsRes, docsRes, siblingsRes, compatRes]);
    if (denied === 'unauthenticated') {
      clearSession();
      clearPrivateData({ kind: 'unauthenticated' }, true);
      return;
    }
    if (denied === 'forbidden') {
      clearPrivateData({ kind: 'forbidden' });
      return;
    }
    if (denied === 'not_found') {
      clearPrivateData({ kind: 'not_found' });
      return;
    }

    const siblings = siblingsRes.status === 'ok'
      ? siblingsRes.data.items
          .filter((item) => item.componentId === release.variant.componentId)
          .flatMap((item) => item.variants)
      : [];

    const compatibility: CompatibilityLoadState<MeasuredCompatibility> = compatRes.status === 'ok'
      ? {
          status: 'loaded',
          value: {
            kind: 'published',
            variantReleaseId: release.variantReleaseId,
            packageName: release.package.name,
            packageVersion: release.package.version,
            records: compatRes.data.items,
          },
        }
      : { status: 'error' };

    setView({
      kind: 'ready',
      data: {
        release,
        reports: reportsRes.status === 'ok' ? reportsRes.data.reports : [],
        docsText: docsRes.status === 'ok' ? docsRes.data : null,
        siblings,
        compatibility,
      },
    });
  }, [clearPrivateData]);

  useEffect(() => {
    void loadRelease(activeReleaseId);
    const onFocus = () => {
      void loadRelease(activeReleaseId);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadRelease(activeReleaseId);
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      generationRef.current += 1;
      abortRef.current?.abort();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [activeReleaseId, loadRelease]);

  const handleLogout = () => {
    clearSession();
    clearPrivateData({ kind: 'unauthenticated' }, true);
  };

  if (view.kind === 'loading') {
    return (
      <main>
        <section className="empty-state" role="status" data-testid="library-detail-loading">
          <h2>正在校验授权并加载组件详情…</h2>
          <p>内部资产详情仅在客户端校验权限后读取。</p>
        </section>
      </main>
    );
  }

  if (view.kind === 'unauthenticated') {
    return (
      <main>
        <section className="empty-state" data-testid="library-detail-unauthenticated">
          <h2>登录后查看已授权组件详情</h2>
          <p>请先使用公司账号登录以访问受保护的组件详情与隔离预览。</p>
          <a href={companyLoginUrl} className="filter-btn active" style={{ display: 'inline-block', textDecoration: 'none' }}>
            使用公司账号登录
          </a>
        </section>
      </main>
    );
  }

  if (view.kind === 'forbidden') {
    return (
      <main>
        <section className="empty-state" role="alert" data-testid="library-detail-forbidden">
          <h2>无权访问该组件版本</h2>
          <p>您没有此组件的读取权限，或权限已被撤销。页面数据与预览已清空。</p>
          <Link href="/library" className="filter-btn">返回我的资产库</Link>
        </section>
      </main>
    );
  }

  if (view.kind === 'not_found') {
    return (
      <main>
        <section className="empty-state" data-testid="library-detail-not-found">
          <h2>未找到该组件版本</h2>
          <p>目标发布版本不存在、无权限或已被撤销。页面数据与预览已清空。</p>
          <Link href="/library" className="filter-btn">返回我的资产库</Link>
        </section>
      </main>
    );
  }

  if (view.kind === 'error') {
    return (
      <main>
        <section className="empty-state" role="alert">
          <h2>加载失败</h2>
          <p>{view.message}</p>
          <button type="button" className="filter-btn" onClick={() => void loadRelease(activeReleaseId)}>
            重新加载
          </button>
        </section>
      </main>
    );
  }

  const { release, reports, docsText, siblings, compatibility } = view.data;
  const display = getDisplayEnhancement(release.variant.componentId);
  const frameworkName = release.variant.framework === 'react' ? 'React 19' : 'Vue 3';
  const cleanSubpath = release.variant.exportPath.replace(/^\.\//, '');
  const importSpecifier = cleanSubpath && cleanSubpath !== '.'
    ? `${release.package.name}/${cleanSubpath}`
    : release.package.name;

  const variantMeta: ComponentVariantMeta = {
    variantReleaseId: release.variantReleaseId,
    variantId: release.variant.variantId,
    framework: release.variant.framework,
    frameworkName,
    packageName: release.package.name,
    packageVersion: release.package.version,
    exportName: release.variant.exportName,
    exportPath: release.variant.exportPath,
    importCode: `import { ${release.variant.exportName} } from '${importSpecifier}';`,
    installCommand: `pnpm add ${release.package.name}@${release.package.version}`,
    availability: release.availability,
    reportSource: release.reportSource,
    baselineStatus: release.baselineStatus,
    indexStatus: release.indexStatus,
    props: display?.props ?? [],
    events: display?.events[release.variant.framework] ?? [],
  };

  return (
    <main data-testid="library-detail">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <nav className="breadcrumb" aria-label="Breadcrumb" style={{ marginBottom: 0 }}>
          <Link href="/library">我的资产库</Link>
          <span>/</span>
          <span>{display?.chineseName ?? release.variant.componentId}</span>
        </nav>

        {session && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="tag" data-testid="library-subject">{session.subject}</span>
            <button type="button" className="filter-btn" onClick={handleLogout}>
              退出登录
            </button>
          </div>
        )}
      </div>

      <header className="detail-header">
        <p className="eyebrow">{display?.category ?? '内部组件资产'} · {release.variant.exportName}</p>
        <h1>{display?.chineseName ?? release.variant.componentId} ({release.variant.exportName})</h1>
        <p className="lead">{display?.description ?? `已授权组件实现 ${release.variant.variantId}`}</p>
      </header>

      {siblings.length > 0 && (
        <div className="framework-switch-bar" role="tablist" aria-label="组件框架实现切换">
          {siblings.map((sibling) => (
            <button
              key={sibling.variantReleaseId}
              type="button"
              role="tab"
              aria-selected={sibling.variantReleaseId === release.variantReleaseId}
              className={`framework-tab ${sibling.variantReleaseId === release.variantReleaseId ? 'active' : ''}`}
              onClick={() => setActiveReleaseId(sibling.variantReleaseId)}
            >
              <span>{sibling.framework === 'react' ? 'React 19' : 'Vue 3'} 实现</span>
              <span className={`tag ${sibling.framework === 'vue' ? 'tag-framework-vue' : 'tag-framework-react'}`}>
                v{sibling.packageVersion}
              </span>
            </button>
          ))}
        </div>
      )}

      <section className="status-grid" aria-label="资产就绪与合规状态">
        <div className="status-card">
          <span className="label">可用状态 (Availability)</span>
          <span className={`value ${release.availability === 'Ready' ? 'ready' : ''}`}>
            {release.availability === 'Ready' && <span className="live-indicator"></span>}
            {release.availability}
          </span>
        </div>

        <div className="status-card">
          <span className="label">检查报告来源 (Source)</span>
          <span className="value automatic">{release.reportSource}</span>
        </div>

        <div className="status-card">
          <span className="label">视觉基线 (Baseline)</span>
          <span className="value accepted">{release.baselineStatus}</span>
        </div>

        <div className="status-card">
          <span className="label">检索索引 (Index)</span>
          <span className="value">{release.indexStatus}</span>
        </div>

        <div className="status-card">
          <span className="label">发布包版本 (Version)</span>
          <span className="value" style={{ fontFamily: 'monospace' }}>
            {release.package.name}@{release.package.version}
          </span>
        </div>
      </section>

      <ComponentPreview
        key={`${release.variant.componentId}:${release.variantReleaseId}:${previewRevision}`}
        componentId={release.variant.componentId}
        componentName={release.variant.exportName}
        variant={variantMeta}
        refresh={() => setPreviewRevision((rev) => rev + 1)}
        access="authenticated"
      />

      <section className="code-section" aria-label="快速引入代码">
        <div className="code-header">精确版本依赖安装</div>
        <div className="code-line" style={{ color: '#38bdf8', marginBottom: '12px' }}>
          $ {variantMeta.installCommand}
        </div>
        <div className="code-header">ESM 模块导入</div>
        <div className="code-line" style={{ color: '#a7f3d0' }}>
          {variantMeta.importCode}
        </div>
      </section>

      <EchartsCompatibility
        componentId={release.variant.componentId}
        framework={release.variant.framework}
        measured={compatibility}
      />

      <section className="spec-table-container" aria-label="检查报告">
        <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <h2 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>检查报告 ({reports.length})</h2>
        </div>
        <div style={{ padding: '16px', fontSize: '13px', color: '#475569' }}>
          {reports.length === 0 ? (
            <p style={{ margin: 0 }}>当前版本暂无关联检查报告。</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              {reports.map((report) => (
                <li key={report.id}>
                  报告 {report.id} · 示例 {report.exampleId} · 基线结果 {report.baselineResult} · 生成时间：{report.createdAt}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {docsText && (
        <section className="spec-table-container" aria-label="组件文档产物">
          <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <h2 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>组件文档 ({release.variant.docs.path})</h2>
          </div>
          <pre style={{ margin: 0, padding: '16px', fontSize: '13px', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
            {docsText}
          </pre>
        </section>
      )}
    </main>
  );
}

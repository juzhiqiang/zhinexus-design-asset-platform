'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type {
  ApiMessages,
  CheckReportV1,
  ComponentApiV1,
  ComponentCategory,
  ComponentReleaseHistoryItem,
} from '@company/contracts';
import {
  acceptVisualBaseline,
  AssetApiError,
  deprecateVariantRelease,
  getVariantCompatibility,
  getVariantComponentApi,
  getVariantDocsText,
  getVariantReleaseDetail,
  getVariantReports,
  getVariantScreenshotBlobUrl,
  listMyComponents,
  parseProbeEvidenceInput,
  requestAdminPreviewGrant,
  submitVariantCompatibility,
  type CompatibilityItem,
} from '../lib/assets-client';
import {
  listComponentCategories,
  readComponentReleaseHistory,
  readPublishingOptions,
  updateComponentVisibility,
} from '../lib/categories-client';
import { getStoredSession, platformApiOrigin } from '../lib/auth';
import { ZnIcon } from '../lib/design/icons';
import { COMMAND_MOTIFS, ZnCommandMotif } from '../lib/design/motifs';
import { ServiceUnavailableState } from '../lib/design/ServiceUnavailableState';

const MOTIF = COMMAND_MOTIFS[0]!;

type ComponentItem = ApiMessages['componentsResponse']['items'][number];
type VariantDetail = ApiMessages['variantReleaseResponse'];
type InspectorTab = 'overview' | 'preview' | 'docs' | 'reports';

const REPORT_SOURCE_LABEL: Record<VariantDetail['reportSource'], string> = {
  'local-automatic': '本地自动校验 (local-automatic)',
  'manual-upload': '网页手动上传 (manual-upload)',
  none: '无检查报告',
};

const BASELINE_LABEL: Record<VariantDetail['baselineStatus'], string> = {
  accepted: '已确认基线',
  unconfirmed: '待确认',
  incompatible: '不兼容',
};

const INDEX_LABEL: Record<VariantDetail['indexStatus'], string> = {
  indexed: '已索引',
  pending: '待索引',
  failed: '索引失败',
};

function AssetQuerySync({ onQuery }: { onQuery: (q: string) => void }) {
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  useEffect(() => {
    if (q) onQuery(q);
  }, [q, onQuery]);
  return null;
}

export default function AssetsPage() {
  const [items, setItems] = useState<ComponentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [query, setQuery] = useState('');
  const [framework, setFramework] = useState<'all' | 'vue' | 'react'>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState<ComponentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VariantDetail | null>(null);
  const [compat, setCompat] = useState<CompatibilityItem[]>([]);
  const [reports, setReports] = useState<CheckReportV1[]>([]);
  const [docsText, setDocsText] = useState<string | null>(null);
  const [componentApi, setComponentApi] = useState<ComponentApiV1 | null>(null);
  const [historyItems, setHistoryItems] = useState<ComponentReleaseHistoryItem[]>([]);
  const [shotUrls, setShotUrls] = useState<Record<string, string>>({});
  const shotUrlsRef = useRef<string[]>([]);

  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('overview');
  const [detailLoading, setDetailLoading] = useState(false);

  // 沙箱在线预览状态
  const [previewGrant, setPreviewGrant] = useState<{ url: string; isolation: 'domain' | 'ip-port' } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // 运维写操作状态
  const [deprecateReason, setDeprecateReason] = useState('');
  const [baselineShotId, setBaselineShotId] = useState('');
  const [baselineReason, setBaselineReason] = useState('');
  const [visibilityReason, setVisibilityReason] = useState('');
  const [probeJsonText, setProbeJsonText] = useState('');
  const [probeReason, setProbeReason] = useState('');
  const [copiedDigest, setCopiedDigest] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const revokeShotUrls = useCallback(() => {
    for (const u of shotUrlsRef.current) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        // ignore
      }
    }
    shotUrlsRef.current = [];
    setShotUrls({});
  }, []);

  useEffect(() => () => revokeShotUrls(), [revokeShotUrls]);

  // 加载可用分类列表供筛选使用（优先读取发布选项，管理员回退完整分类列表）
  useEffect(() => {
    const session = getStoredSession();
    if (!session) return;
    const controller = new AbortController();
    const conn = { apiUrl: platformApiOrigin, token: session.token, signal: controller.signal };
    void readPublishingOptions(conn)
      .then((opts) => setCategories(opts.categories))
      .catch(() =>
        listComponentCategories(conn)
          .then((list) => setCategories(list.items.filter((c) => c.enabled)))
          .catch(() => {}),
      );
    return () => controller.abort();
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listMyComponents({
        query: query.trim() || undefined,
        framework: framework === 'all' ? undefined : framework,
        category: categoryFilter || undefined,
        page,
        pageSize,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError({
        status: err instanceof AssetApiError ? err.status : undefined,
        message: err instanceof Error ? err.message : '读取组件资产失败。',
      });
    } finally {
      setLoading(false);
    }
  }, [framework, categoryFilter, page, pageSize, query]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(
    async (releaseId: string, preserveNotice = false) => {
      setSelectedId(releaseId);
      setDetailLoading(true);
      setPreviewGrant(null);
      setPreviewError(null);
      revokeShotUrls();
      if (!preserveNotice) setActionNotice(null);
      setActionError(null);
      try {
        const [rel, comp, rep] = await Promise.all([
          getVariantReleaseDetail(releaseId),
          getVariantCompatibility(releaseId).catch(() => ({ variantReleaseId: releaseId, items: [] })),
          getVariantReports(releaseId).catch(() => [] as CheckReportV1[]),
        ]);
        setDetail(rel);
        setCompat(comp.items);
        setReports(rep);
        const firstAuto = rel.variant.screenshots.find((s) => s.source === 'local-automatic');
        setBaselineShotId(firstAuto?.id ?? '');

        const session = getStoredSession();
        const [docs, apiSpec, history] = await Promise.all([
          rel.variant.docs?.path ? getVariantDocsText(releaseId, rel.variant.docs.path).catch(() => null) : Promise.resolve(null),
          rel.variant.api?.path ? getVariantComponentApi(releaseId, rel.variant.api.path).catch(() => null) : Promise.resolve(null),
          session
            ? readComponentReleaseHistory({ apiUrl: platformApiOrigin, token: session.token }, rel.variant.componentId)
                .then((h) => h.items)
                .catch(() => [] as ComponentReleaseHistoryItem[])
            : Promise.resolve([] as ComponentReleaseHistoryItem[]),
        ]);
        setDocsText(docs);
        setComponentApi(apiSpec);
        setHistoryItems(history);
      } catch (err) {
        setDetail(null);
        setCompat([]);
        setReports([]);
        setDocsText(null);
        setComponentApi(null);
        setHistoryItems([]);
        setActionError(err instanceof Error ? err.message : '读取版本详情失败。');
      } finally {
        setDetailLoading(false);
      }
    },
    [revokeShotUrls],
  );

  // 切换到「预览与截图」分区时按需加载受保护截图 Blob
  useEffect(() => {
    if (inspectorTab !== 'preview' || !detail) return;
    const shots = detail.variant.screenshots ?? [];
    if (!shots.length) return;
    const controller = new AbortController();
    let active = true;
    void Promise.all(
      shots.map(async (shot) => {
        if (!shot.image?.path) return null;
        try {
          const url = await getVariantScreenshotBlobUrl(detail.variantReleaseId, shot.image.path, controller.signal);
          return [shot.id, url] as const;
        } catch {
          return null;
        }
      }),
    ).then((pairs) => {
      if (!active) {
        for (const pair of pairs) if (pair) URL.revokeObjectURL(pair[1]);
        return;
      }
      const next: Record<string, string> = {};
      for (const pair of pairs) {
        if (pair) {
          next[pair[0]] = pair[1];
          shotUrlsRef.current.push(pair[1]);
        }
      }
      setShotUrls(next);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [inspectorTab, detail]);

  const flatVariants = useMemo(
    () =>
      items.flatMap((comp) =>
        comp.variants.map((variant) => ({
          componentId: comp.componentId,
          ...variant,
        })),
      ),
    [items],
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const metrics = useMemo(() => {
    const vueCount = flatVariants.filter((v) => v.framework === 'vue').length;
    const reactCount = flatVariants.filter((v) => v.framework === 'react').length;
    return { components: total, variants: flatVariants.length, vueCount, reactCount };
  }, [flatVariants, total]);

  const autoShots = detail?.variant.screenshots.filter((s) => s.source === 'local-automatic') ?? [];
  const selectedBaselineShot = autoShots.find((s) => s.id === baselineShotId) ?? autoShots[0];
  const existingBaselineHead = useMemo(() => {
    if (!detail?.baselineHeads?.length || !selectedBaselineShot) return undefined;
    return detail.baselineHeads.find(
      (h) => h.exampleId === selectedBaselineShot.exampleId && h.environmentKey === selectedBaselineShot.environmentKey,
    );
  }, [detail?.baselineHeads, selectedBaselineShot]);

  const handleRequestPreview = async () => {
    if (!detail) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const grant = await requestAdminPreviewGrant(detail.variantReleaseId);
      setPreviewGrant(grant);
    } catch (err) {
      setPreviewGrant(null);
      setPreviewError(err instanceof Error ? err.message : '申请短期预览授权失败。');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCopySha = async () => {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(detail.package.tarball.sha256);
      setCopiedDigest(true);
      setTimeout(() => setCopiedDigest(false), 1800);
    } catch {
      setActionNotice(`完整 SHA-256：${detail.package.tarball.sha256}`);
    }
  };

  const handleVisibilityToggle = async (event: React.FormEvent) => {
    event.preventDefault();
    const session = getStoredSession();
    if (!detail || !session || !visibilityReason.trim()) return;
    const nextPublic = !detail.isPublic;
    setMutating(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await updateComponentVisibility(
        { apiUrl: platformApiOrigin, token: session.token },
        detail.variant.componentId,
        { isPublic: nextPublic, reason: visibilityReason.trim() },
      );
      setVisibilityReason('');
      setActionNotice(nextPublic ? '组件已设为公开（画廊公开目录可见）。' : '组件已收回为内部私有（仅受授权账号可读）。');
      await loadDetail(detail.variantReleaseId, true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '切换组件可见性失败。');
    } finally {
      setMutating(false);
    }
  };

  const handleDeprecate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail || !deprecateReason.trim()) return;
    setMutating(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await deprecateVariantRelease(detail.variantReleaseId, deprecateReason);
      setDeprecateReason('');
      setActionNotice('该版本已标记为废弃（DEPRECATED），已发布产物保持不可变。');
      await loadDetail(detail.variantReleaseId, true);
      await loadList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '废弃版本失败。');
    } finally {
      setMutating(false);
    }
  };

  const handleBaseline = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail || !selectedBaselineShot || !baselineReason.trim()) return;
    setMutating(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await acceptVisualBaseline({
        variantId: detail.variant.variantId,
        exampleId: selectedBaselineShot.exampleId,
        environmentKey: selectedBaselineShot.environmentKey,
        screenshotId: selectedBaselineShot.id,
        reason: baselineReason.trim(),
        ...(existingBaselineHead ? { expectedRevision: existingBaselineHead.revisionId } : {}),
      });
      setBaselineReason('');
      setActionNotice(
        existingBaselineHead
          ? `视觉基线已更新至新修订 ${res.revisionId}。`
          : `视觉基线已确认（修订 ${res.revisionId}）。`,
      );
      await loadDetail(detail.variantReleaseId, true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '确认视觉基线失败。');
    } finally {
      setMutating(false);
    }
  };

  const handleProbeFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setProbeJsonText(text);
  };

  const handleSubmitCompatibility = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail || !probeJsonText.trim() || !probeReason.trim()) return;
    const parsed = parseProbeEvidenceInput(probeJsonText);
    if (!parsed.ok) {
      setActionError(parsed.message);
      return;
    }
    setMutating(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const created = await submitVariantCompatibility(detail.variantReleaseId, {
        packageSha256: detail.package.tarball.sha256,
        reason: probeReason.trim(),
        candidate: parsed.candidate,
        evidence: parsed.evidence,
      });
      setProbeJsonText('');
      setProbeReason('');
      setActionNotice(`ECharts ${created.echartsVersion} 兼容实测证据已验收登记（${created.compatibilityId}）。`);
      await loadDetail(detail.variantReleaseId, true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '登记兼容实测证据失败。');
    } finally {
      setMutating(false);
    }
  };

  const syncQueryFromUrl = useCallback((q: string) => {
    setQuery(q);
    setPage(1);
  }, []);

  const categoryText = detail?.variant.category ?? historyItems.length > 0 ? (detail?.variant.category ?? 'uncategorized') : 'uncategorized';

  return (
    <main>
      <Suspense fallback={null}>
        <AssetQuerySync onQuery={syncQueryFromUrl} />
      </Suspense>

      <div className="zn-page-header access-heading">
        <div className="zn-header-copy">
          <p className="eyebrow">01 / ASSET REGISTRY</p>
          <h1>资产管理</h1>
          <p className="lead">查看授权范围内已发布的组件与双框架实现，执行沙箱预览、材料审查、可见性切换、视觉基线更新、兼容证据登记与版本废弃。</p>
        </div>
        <ZnCommandMotif motif={MOTIF} className="zn-motif" />
        <div className="zn-header-actions">
          <Link href="/upload" className="filter-btn active">
            <ZnIcon name="upload" size={15} color="var(--zn-on-primary)" />
            上传新版本
          </Link>
          <button type="button" className="filter-btn" disabled={loading} onClick={() => void loadList()}>
            <ZnIcon name="refresh-cw" size={15} color="var(--zn-muted)" />
            刷新列表
          </button>
        </div>
      </div>

      {error ? (
        <ServiceUnavailableState status={error.status} message={error.message} onRetry={() => void loadList()} />
      ) : (
        <>
          <div className="zn-metrics">
            <div className="zn-metric">
              <span className="zn-metric-rail" />
              <span className="zn-metric-copy">
                <span className="zn-metric-label">组件总数</span>
                <span className="zn-metric-value">{metrics.components}</span>
                <span className="zn-hint">逻辑组件</span>
              </span>
            </div>
            <div className="zn-metric">
              <span className="zn-metric-rail" />
              <span className="zn-metric-copy">
                <span className="zn-metric-label">当前页实现数</span>
                <span className="zn-metric-value">{metrics.variants}</span>
                <span className="zn-hint">双框架独立建模</span>
              </span>
            </div>
            <div className="zn-metric">
              <span className="zn-metric-rail" />
              <span className="zn-metric-copy">
                <span className="zn-metric-label">Vue 3 实现</span>
                <span className="zn-metric-value">{metrics.vueCount}</span>
                <span className="zn-hint">Ready 状态</span>
              </span>
            </div>
            <div className="zn-metric">
              <span className="zn-metric-rail zn-metric-rail-gold" />
              <span className="zn-metric-copy">
                <span className="zn-metric-label">React 19 实现</span>
                <span className="zn-metric-value">{metrics.reactCount}</span>
                <span className="zn-hint">Ready 状态</span>
              </span>
            </div>
          </div>

          <div className="zn-grid-2">
            <section className="zn-card" aria-label="组件资产列表">
              <div className="zn-card-head">
                <div>
                  <h2 className="zn-card-title">已发布组件与实现</h2>
                  <p className="zn-card-subtitle">选择任意实现查看详细元数据、历史版本、隔离预览与运维操作</p>
                </div>
                <div className="zn-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <span className="zn-quick-search" style={{ width: 185 }}>
                    <ZnIcon name="search" size={14} color="var(--zn-subtle)" className="zn-quick-search-icon" />
                    <input
                      className="zn-quick-search-input"
                      type="search"
                      value={query}
                      placeholder="搜索组件 ID 或导出名"
                      aria-label="搜索组件 ID 或导出名"
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setPage(1);
                      }}
                    />
                  </span>
                  <select
                    className="zn-input"
                    style={{ width: 120, height: 34 }}
                    value={framework}
                    aria-label="框架筛选"
                    onChange={(e) => {
                      setFramework(e.target.value as 'all' | 'vue' | 'react');
                      setPage(1);
                    }}
                  >
                    <option value="all">全部框架</option>
                    <option value="vue">Vue 3</option>
                    <option value="react">React 19</option>
                  </select>
                  <select
                    className="zn-input"
                    style={{ width: 135, height: 34 }}
                    value={categoryFilter}
                    aria-label="分类筛选"
                    onChange={(e) => {
                      setCategoryFilter(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">全部分类</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name} ({cat.id})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="zn-table-scroll">
                <table className="zn-table">
                  <thead>
                    <tr>
                      <th>组件 ID</th>
                      <th>框架</th>
                      <th>NPM 包与版本</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flatVariants.map((row) => (
                      <tr key={row.variantReleaseId} data-selected={selectedId === row.variantReleaseId ? 'true' : undefined}>
                        <td className="zn-table-cell-strong zn-table-cell-mono">{row.componentId}</td>
                        <td>
                          <span className={`zn-badge ${row.framework === 'vue' ? 'zn-badge-success' : 'zn-badge-accent'}`}>
                            <span className="zn-badge-dot" />
                            {row.framework.toUpperCase()}
                          </span>
                        </td>
                        <td className="zn-table-cell-mono">
                          {row.packageName}@{row.packageVersion}
                        </td>
                        <td>
                          <button
                            type="button"
                            className={selectedId === row.variantReleaseId ? 'filter-btn active' : 'filter-btn'}
                            onClick={() => void loadDetail(row.variantReleaseId)}
                          >
                            管理
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!flatVariants.length && (
                      <tr>
                        <td colSpan={4}>
                          {loading ? '正在读取组件资产…' : '当前筛选条件下暂无已发布组件。可前往「上传发布」提交首批组件包。'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <nav className="zn-pagination" aria-label="资产列表分页">
                <span className="zn-hint">
                  共 {total} 个逻辑组件 · 第 {page} / {totalPages} 页
                </span>
                <div className="zn-row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="zn-btn"
                    disabled={loading || page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    className="zn-btn"
                    disabled={loading || page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    下一页
                  </button>
                </div>
              </nav>
            </section>

            <section className="zn-card-raised" aria-label="版本详情与维护">
              {!selectedId ? (
                <div className="zn-stack-sm">
                  <h2 className="zn-card-title">实现版本详情</h2>
                  <p className="access-hint">在左侧选择任意组件实现，即可查看包摘要、可信度分栏（Ready / 检查来源 / 视觉基线 / 索引状态）、在线沙箱预览、文档契约与历史版本，并执行可见性切换、基线更新或版本废弃。</p>
                </div>
              ) : detailLoading ? (
                <p className="access-hint">正在读取版本详情…</p>
              ) : !detail ? (
                <p className="access-error" role="alert">{actionError || '无法读取该版本详情。'}</p>
              ) : (
                <div className="zn-stack">
                  <div className="zn-card-head" style={{ marginBottom: 0 }}>
                    <div>
                      <div className="zn-row" style={{ gap: 8 }}>
                        <h2 className="zn-card-title">{detail.variant.componentId}</h2>
                        {detail.isPublic !== undefined && (
                          <span className={`zn-badge ${detail.isPublic ? 'zn-badge-success' : 'zn-badge-warning'}`}>
                            <span className="zn-badge-dot" />
                            {detail.isPublic ? '画廊公开' : '内部私有'}
                          </span>
                        )}
                      </div>
                      <p className="zn-card-subtitle">
                        {detail.variant.variantId} · {detail.package.name}@{detail.package.version}
                      </p>
                    </div>
                    <span className={`zn-badge ${detail.availability === 'Ready' ? 'zn-badge-success' : 'zn-badge-danger'}`}>
                      <span className="zn-badge-dot" />
                      {detail.availability}
                    </span>
                  </div>

                  {historyItems.length > 0 && (
                    <label className="zn-field">
                      <span className="zn-hint">切换历史 / 已废弃版本（共 {historyItems.length} 条记录）</span>
                      <select
                        className="zn-input zn-input-mono"
                        value={detail.variantReleaseId}
                        aria-label="切换组件实现版本"
                        onChange={(e) => void loadDetail(e.target.value)}
                      >
                        {historyItems.map((h) => (
                          <option key={h.variantReleaseId} value={h.variantReleaseId}>
                            [{h.framework.toUpperCase()}] {h.packageName}@{h.packageVersion} — {h.availability}
                            {h.deprecatedReason ? `（${h.deprecatedReason}）` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {actionError ? <p className="access-error" role="alert">{actionError}</p> : null}
                  {actionNotice ? <p className="access-message" role="status">{actionNotice}</p> : null}

                  <div className="zn-tabs" role="tablist" aria-label="资产详情分区">
                    {(
                      [
                        ['overview', '概览与运维'],
                        ['preview', '预览与截图'],
                        ['docs', '文档与契约'],
                        ['reports', '报告与兼容'],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        id={`asset-tab-${key}`}
                        type="button"
                        role="tab"
                        className="zn-tab"
                        aria-selected={inspectorTab === key}
                        onClick={() => setInspectorTab(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* 面板 1：概览与运维 */}
                  <div role="tabpanel" aria-labelledby="asset-tab-overview" hidden={inspectorTab !== 'overview'}>
                    <div className="zn-stack">
                      <div className="zn-detail-kv">
                        <div className="zn-detail-kv-item">
                          <span className="zn-detail-kv-label">可用状态（包与预览可达）</span>
                          <span className="zn-detail-kv-value">
                            {detail.availability}
                            {detail.deprecatedReason ? `（原因：${detail.deprecatedReason}）` : ''}
                          </span>
                        </div>
                        <div className="zn-detail-kv-item">
                          <span className="zn-detail-kv-label">检查报告来源</span>
                          <span className="zn-detail-kv-value">{REPORT_SOURCE_LABEL[detail.reportSource]}</span>
                        </div>
                        <div className="zn-detail-kv-item">
                          <span className="zn-detail-kv-label">视觉基线确认</span>
                          <span className="zn-detail-kv-value">{BASELINE_LABEL[detail.baselineStatus]}</span>
                        </div>
                        <div className="zn-detail-kv-item">
                          <span className="zn-detail-kv-label">检索索引状态</span>
                          <span className="zn-detail-kv-value">{INDEX_LABEL[detail.indexStatus]}</span>
                        </div>
                        <div className="zn-detail-kv-item">
                          <span className="zn-detail-kv-label">导出名 / 分类</span>
                          <span className="zn-detail-kv-value">{detail.variant.exportName} · {categoryText}</span>
                        </div>
                        <div className="zn-detail-kv-item">
                          <span className="zn-detail-kv-label">Tarball SHA-256（{detail.package.tarball.bytes} 字节）</span>
                          <span className="zn-detail-kv-value zn-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                            <code style={{ wordBreak: 'break-all', fontSize: 11 }}>{detail.package.tarball.sha256}</code>
                            <button type="button" className="zn-btn" onClick={() => void handleCopySha()}>
                              {copiedDigest ? '已复制' : '复制摘要'}
                            </button>
                          </span>
                        </div>
                      </div>

                      {detail.isPublic !== undefined && (
                        <form className="zn-stack-sm" onSubmit={handleVisibilityToggle}>
                          <h3 className="zn-field-label">
                            组件可见性（当前：{detail.isPublic ? '公开画廊可见' : '内部私有，仅授权账号可读'}）
                          </h3>
                          <div className="zn-field-row">
                            <label className="zn-field">
                              <span className="zn-hint">变更审计理由</span>
                              <input
                                className="zn-input"
                                value={visibilityReason}
                                placeholder={detail.isPublic ? '例如：收回内部评估' : '例如：已完成合规与视觉验收，对外公开'}
                                required
                                onChange={(e) => setVisibilityReason(e.target.value)}
                              />
                            </label>
                          </div>
                          <button type="submit" className="filter-btn" disabled={mutating || !visibilityReason.trim()}>
                            {detail.isPublic ? '收回为内部私有' : '设为公开画廊可见'}
                          </button>
                        </form>
                      )}

                      {autoShots.length > 0 && (
                        <form className="zn-stack-sm" onSubmit={handleBaseline}>
                          <h3 className="zn-field-label">
                            {existingBaselineHead
                              ? `更新视觉基线（当前修订 ${existingBaselineHead.revisionId.slice(0, 8)}…）`
                              : '确认视觉基线（仅限 local-automatic 截图）'}
                          </h3>
                          <div className="zn-field-row">
                            <label className="zn-field">
                              <span className="zn-hint">选择候选截图</span>
                              <select className="zn-input" value={baselineShotId} onChange={(e) => setBaselineShotId(e.target.value)}>
                                {autoShots.map((shot) => (
                                  <option key={shot.id} value={shot.id}>
                                    {shot.exampleId} ({shot.id})
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="zn-field">
                              <span className="zn-hint">确认理由</span>
                              <input
                                className="zn-input"
                                value={baselineReason}
                                placeholder="例如：首版基线确认通过 / 样式调整更新基线"
                                required
                                onChange={(e) => setBaselineReason(e.target.value)}
                              />
                            </label>
                          </div>
                          <button type="submit" className="filter-btn" disabled={mutating || !baselineReason.trim()}>
                            {existingBaselineHead ? '更新视觉基线' : '确认视觉基线'}
                          </button>
                        </form>
                      )}

                      {detail.availability === 'Ready' && (
                        <form className="zn-stack-sm" onSubmit={handleDeprecate}>
                          <h3 className="zn-field-label">废弃此版本（不可变，不删除历史包）</h3>
                          <div className="zn-field-row">
                            <label className="zn-field">
                              <span className="zn-hint">废弃原因</span>
                              <input
                                className="zn-input"
                                value={deprecateReason}
                                placeholder="例如：已被新版本替代"
                                required
                                onChange={(e) => setDeprecateReason(e.target.value)}
                              />
                            </label>
                          </div>
                          <button type="submit" className="zn-btn zn-btn-danger" disabled={mutating || !deprecateReason.trim()}>
                            废弃此版本
                          </button>
                        </form>
                      )}
                    </div>
                  </div>

                  {/* 面板 2：预览与截图 */}
                  <div role="tabpanel" aria-labelledby="asset-tab-preview" hidden={inspectorTab !== 'preview'}>
                    <div className="zn-stack">
                      <div className="zn-stack-sm">
                        <div className="zn-row zn-row-between">
                          <div>
                            <h3 className="zn-field-label">隔离沙箱在线预览</h3>
                            <p className="zn-hint">通过短期 preview-grant 在独立源沙箱（仅 allow-scripts）内只读渲染，不共享管理端凭证。</p>
                          </div>
                          <button
                            type="button"
                            className="filter-btn active"
                            disabled={previewLoading || detail.availability !== 'Ready'}
                            onClick={() => void handleRequestPreview()}
                          >
                            {previewLoading ? '正在申请授权…' : previewGrant ? '刷新预览授权' : '启动沙箱预览'}
                          </button>
                        </div>
                        {previewError ? <p className="access-error" role="alert">{previewError}</p> : null}
                        {previewGrant ? (
                          <div>
                            <p className="zn-hint" style={{ marginBottom: 6 }}>
                              隔离模式：<code>{previewGrant.isolation}</code>
                            </p>
                            <iframe
                              title={`${detail.variant.variantId} 隔离预览`}
                              className="zn-preview-frame"
                              sandbox="allow-scripts"
                              referrerPolicy="no-referrer"
                              src={previewGrant.url}
                            />
                          </div>
                        ) : (
                          <p className="zn-hint">
                            {detail.availability === 'Ready'
                              ? '点击「启动沙箱预览」按当前身份申请一次性短期预览票据。'
                              : '已废弃版本不再签发新的在线预览授权。'}
                          </p>
                        )}
                      </div>

                      <div className="zn-stack-sm">
                        <h3 className="zn-field-label">已归档展示截图（{detail.variant.screenshots.length}）</h3>
                        {detail.variant.screenshots.length > 0 ? (
                          <div className="zn-shot-grid">
                            {detail.variant.screenshots.map((shot) => (
                              <div className="zn-shot-card" key={shot.id}>
                                {shotUrls[shot.id] ? (
                                  <img
                                    className="zn-shot-img"
                                    src={shotUrls[shot.id]}
                                    alt={`${shot.variantId} ${shot.exampleId}`}
                                  />
                                ) : (
                                  <span className="zn-hint">正在读取受保护截图图像…</span>
                                )}
                                <div className="zn-hint">
                                  <strong>{shot.exampleId}</strong> · <code>{shot.source}</code>
                                </div>
                                <div className="zn-hint">
                                  <code>{shot.image.sha256.slice(0, 14)}…</code> · {shot.image.bytes} B
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="zn-hint">该实现暂无展示截图记录。</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 面板 3：文档与契约 */}
                  <div role="tabpanel" aria-labelledby="asset-tab-docs" hidden={inspectorTab !== 'docs'}>
                    <div className="zn-stack">
                      <div className="zn-stack-sm">
                        <h3 className="zn-field-label">快速安装与 ESM 导入</h3>
                        <pre className="zn-code-block">
                          {`pnpm add ${detail.package.name}@${detail.package.version}\nimport { ${detail.variant.exportName} } from '${
                            detail.variant.exportPath === '.'
                              ? detail.package.name
                              : `${detail.package.name}/${detail.variant.exportPath.replace(/^\.\//, '')}`
                          }';`}
                        </pre>
                      </div>

                      <div className="zn-stack-sm">
                        <h3 className="zn-field-label">组件 API 参数与事件契约（{detail.variant.api.path}）</h3>
                        {componentApi ? (
                          <div className="zn-stack-sm">
                            <span className="zn-hint">
                              属性（{componentApi.props.length}）· 事件（{componentApi.events.length}）
                              {componentApi.styleExport ? ` · 样式导出 ${componentApi.styleExport}` : ''}
                            </span>
                            {componentApi.props.length > 0 && (
                              <div className="zn-table-scroll">
                                <table className="zn-table">
                                  <thead>
                                    <tr>
                                      <th>属性名</th>
                                      <th>类型</th>
                                      <th>必填</th>
                                      <th>Schema / 编辑器提示</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {componentApi.props.map((prop) => (
                                      <tr key={prop.name}>
                                        <td className="zn-table-cell-mono zn-table-cell-strong">{prop.name}</td>
                                        <td className="zn-table-cell-mono">{prop.type}</td>
                                        <td>{prop.required ? '是' : '否'}</td>
                                        <td className="zn-table-cell-mono">
                                          {prop.schema ? JSON.stringify(prop.schema) : prop.editor ? JSON.stringify(prop.editor) : '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {componentApi.events.length > 0 && (
                              <div className="zn-checks">
                                {componentApi.events.map((ev) => (
                                  <div className="zn-check" key={ev.name}>
                                    <span className="zn-check-label">
                                      事件 <code>{ev.name}</code>
                                    </span>
                                    <span className="zn-hint">
                                      载荷：<code>{ev.payload}</code>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="zn-hint">未能读取或解析组件 API 描述文件。</p>
                        )}
                      </div>

                      <div className="zn-stack-sm">
                        <h3 className="zn-field-label">组件文档（{detail.variant.docs.path}）</h3>
                        {docsText ? (
                          <pre className="zn-code-block">{docsText}</pre>
                        ) : (
                          <p className="zn-hint">暂无可显示的文档正文。</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 面板 4：报告与兼容 */}
                  <div role="tabpanel" aria-labelledby="asset-tab-reports" hidden={inspectorTab !== 'reports'}>
                    <div className="zn-stack">
                      <div className="zn-stack-sm">
                        <h3 className="zn-field-label">本地自动检查报告（{reports.length}）</h3>
                        {reports.length > 0 ? (
                          <div className="zn-checks">
                            {reports.map((rep) => (
                              <div className="zn-check" key={rep.id}>
                                <span className="zn-check-group">
                                  <ZnIcon name="circle-check-big" size={14} color="var(--zn-success)" />
                                  <span className="zn-check-label">
                                    <code>{rep.id}</code> · 示例 <code>{rep.exampleId}</code> · {rep.environment.renderer} / {rep.environment.theme}
                                  </span>
                                </span>
                                <span className="zn-hint">
                                  基线：{rep.baselineResult} · 检查项 {rep.checks.filter((c) => c.status === 'passed').length}/{rep.checks.length} 通过
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="zn-hint">当前版本无本地自动检查报告（如网页手动上传渠道）。</p>
                        )}
                      </div>

                      <div>
                        <h3 className="zn-field-label" style={{ marginBottom: 8 }}>已验收 ECharts 兼容实测记录（{compat.length}）</h3>
                        {compat.length ? (
                          <div className="zn-checks">
                            {compat.map((item) => (
                              <div className="zn-check" key={item.compatibilityId}>
                                <span className="zn-check-group">
                                  <ZnIcon name="shield-check" size={14} color="var(--zn-success)" />
                                  <span className="zn-check-label">
                                    {item.framework} {item.frameworkVersion} · ECharts {item.echartsVersion}
                                  </span>
                                </span>
                                <span className="zn-check-status" style={{ color: 'var(--zn-success)' }}>{item.status}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="zn-hint">暂无额外登记的 ECharts 兼容实测证据。</p>
                        )}
                      </div>

                      {detail.availability === 'Ready' && (
                        <form className="zn-stack-sm" onSubmit={handleSubmitCompatibility}>
                          <div className="zn-row zn-row-between">
                            <h3 className="zn-field-label">登记 ECharts 兼容实测证据（a-t10-sdk-probe）</h3>
                            <label className="zn-btn" style={{ cursor: 'pointer' }}>
                              导入探测 JSON
                              <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleProbeFileImport} />
                            </label>
                          </div>
                          <label className="zn-field">
                            <span className="zn-hint">探测证据 JSON 内容（服务端将严格核验包摘要、双框架消费者与环境键，不执行代码）</span>
                            <textarea
                              className="zn-input zn-input-mono"
                              rows={4}
                              value={probeJsonText}
                              placeholder='粘贴 {"schemaVersion":1,"kind":"a-t10-sdk-probe",...}'
                              onChange={(e) => setProbeJsonText(e.target.value)}
                            />
                          </label>
                          <label className="zn-field">
                            <span className="zn-hint">验收说明</span>
                            <input
                              className="zn-input"
                              value={probeReason}
                              placeholder="例如：本地双框架 ECharts 6.1.0 实测通过"
                              required
                              onChange={(e) => setProbeReason(e.target.value)}
                            />
                          </label>
                          <button
                            type="submit"
                            className="filter-btn active"
                            disabled={mutating || !probeJsonText.trim() || !probeReason.trim()}
                          >
                            提交兼容实测证据
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ApiMessages } from '@company/contracts';
import {
  acceptVisualBaseline,
  AssetApiError,
  deprecateVariantRelease,
  getVariantCompatibility,
  getVariantReleaseDetail,
  listMyComponents,
  type CompatibilityItem,
} from '../lib/assets-client';
import { ZnIcon } from '../lib/design/icons';
import { COMMAND_MOTIFS, ZnCommandMotif } from '../lib/design/motifs';
import { ServiceUnavailableState } from '../lib/design/ServiceUnavailableState';

const MOTIF = COMMAND_MOTIFS[0]!;

type ComponentItem = ApiMessages['componentsResponse']['items'][number];
type VariantDetail = ApiMessages['variantReleaseResponse'];

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

export default function AssetsPage() {
  const [items, setItems] = useState<ComponentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [framework, setFramework] = useState<'all' | 'vue' | 'react'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VariantDetail | null>(null);
  const [compat, setCompat] = useState<CompatibilityItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [deprecateReason, setDeprecateReason] = useState('');
  const [baselineShotId, setBaselineShotId] = useState('');
  const [baselineReason, setBaselineReason] = useState('');
  const [mutating, setMutating] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listMyComponents({
        query: query.trim() || undefined,
        framework: framework === 'all' ? undefined : framework,
        page: 1,
        pageSize: 50,
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
  }, [framework, query]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(async (releaseId: string, preserveNotice = false) => {
    setSelectedId(releaseId);
    setDetailLoading(true);
    if (!preserveNotice) setActionNotice(null);
    setActionError(null);
    try {
      const [rel, comp] = await Promise.all([
        getVariantReleaseDetail(releaseId),
        getVariantCompatibility(releaseId).catch(() => ({ variantReleaseId: releaseId, items: [] })),
      ]);
      setDetail(rel);
      setCompat(comp.items);
      const firstAuto = rel.variant.screenshots.find((s) => s.source === 'local-automatic');
      setBaselineShotId(firstAuto?.id ?? '');
    } catch (err) {
      setDetail(null);
      setCompat([]);
      setActionError(err instanceof Error ? err.message : '读取版本详情失败。');
    } finally {
      setDetailLoading(false);
    }
  }, []);

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

  const metrics = useMemo(() => {
    const vueCount = flatVariants.filter((v) => v.framework === 'vue').length;
    const reactCount = flatVariants.filter((v) => v.framework === 'react').length;
    return { components: total, variants: flatVariants.length, vueCount, reactCount };
  }, [flatVariants, total]);

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
    if (!detail || !baselineShotId || !baselineReason.trim()) return;
    const shot = detail.variant.screenshots.find((s) => s.id === baselineShotId);
    if (!shot) return;
    setMutating(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await acceptVisualBaseline({
        variantId: detail.variant.variantId,
        exampleId: shot.exampleId,
        environmentKey: shot.environmentKey,
        screenshotId: shot.id,
        reason: baselineReason.trim(),
      });
      setBaselineReason('');
      setActionNotice(`视觉基线已确认（修订 ${res.revisionId}）。`);
      await loadDetail(detail.variantReleaseId, true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '确认视觉基线失败。');
    } finally {
      setMutating(false);
    }
  };

  const autoShots = detail?.variant.screenshots.filter((s) => s.source === 'local-automatic') ?? [];

  return (
    <main>
      <div className="zn-page-header access-heading">
        <div className="zn-header-copy">
          <p className="eyebrow">01 / ASSET REGISTRY</p>
          <h1>资产管理</h1>
          <p className="lead">查看授权范围内已发布的组件与双框架实现，核对可用状态、检查来源、视觉基线与 ECharts 兼容实测，执行版本废弃与基线确认。</p>
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
                <span className="zn-metric-label">最新实现数</span>
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
                  <p className="zn-card-subtitle">选择任意实现查看详细元数据、基线状态与运维操作</p>
                </div>
                <div className="zn-row">
                  <span className="zn-quick-search" style={{ width: 200 }}>
                    <ZnIcon name="search" size={14} color="var(--zn-subtle)" className="zn-quick-search-icon" />
                    <input
                      className="zn-quick-search-input"
                      type="search"
                      value={query}
                      placeholder="搜索组件 ID 或导出名"
                      aria-label="搜索组件 ID 或导出名"
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </span>
                  <select
                    className="zn-input"
                    style={{ width: 130, height: 34 }}
                    value={framework}
                    aria-label="框架筛选"
                    onChange={(e) => setFramework(e.target.value as 'all' | 'vue' | 'react')}
                  >
                    <option value="all">全部框架</option>
                    <option value="vue">Vue 3</option>
                    <option value="react">React 19</option>
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
            </section>

            <section className="zn-card-raised" aria-label="版本详情与维护">
              {!selectedId ? (
                <div className="zn-stack-sm">
                  <h2 className="zn-card-title">实现版本详情</h2>
                  <p className="access-hint">在左侧选择任意组件实现，即可查看包摘要、可信度分栏（Ready / 检查来源 / 视觉基线 / 索引状态）并执行废弃或基线确认。</p>
                </div>
              ) : detailLoading ? (
                <p className="access-hint">正在读取版本详情…</p>
              ) : !detail ? (
                <p className="access-error" role="alert">{actionError || '无法读取该版本详情。'}</p>
              ) : (
                <div className="zn-stack">
                  <div className="zn-card-head" style={{ marginBottom: 0 }}>
                    <div>
                      <h2 className="zn-card-title">{detail.variant.componentId}</h2>
                      <p className="zn-card-subtitle">
                        {detail.variant.variantId} · {detail.package.name}@{detail.package.version}
                      </p>
                    </div>
                    <span className={`zn-badge ${detail.availability === 'Ready' ? 'zn-badge-success' : 'zn-badge-danger'}`}>
                      <span className="zn-badge-dot" />
                      {detail.availability}
                    </span>
                  </div>

                  {actionError ? <p className="access-error" role="alert">{actionError}</p> : null}
                  {actionNotice ? <p className="access-message" role="status">{actionNotice}</p> : null}

                  {/* Ready 与可信度状态严格分栏 */}
                  <div className="zn-detail-kv">
                    <div className="zn-detail-kv-item">
                      <span className="zn-detail-kv-label">可用状态（包与预览可达）</span>
                      <span className="zn-detail-kv-value">{detail.availability}</span>
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
                      <span className="zn-detail-kv-value">{detail.variant.exportName} · {detail.variant.category}</span>
                    </div>
                    <div className="zn-detail-kv-item">
                      <span className="zn-detail-kv-label">Tarball SHA-256</span>
                      <span className="zn-detail-kv-value">{detail.package.tarball.sha256.slice(0, 16)}…</span>
                    </div>
                  </div>

                  <div>
                    <h3 className="zn-field-label" style={{ marginBottom: 8 }}>ECharts 兼容实测记录（{compat.length}）</h3>
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

                  {autoShots.length > 0 && (
                    <form className="zn-stack-sm" onSubmit={handleBaseline}>
                      <h3 className="zn-field-label">确认视觉基线（仅限 local-automatic 截图）</h3>
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
                            placeholder="例如：首版基线确认通过"
                            required
                            onChange={(e) => setBaselineReason(e.target.value)}
                          />
                        </label>
                      </div>
                      <button type="submit" className="filter-btn" disabled={mutating || !baselineReason.trim()}>
                        确认视觉基线
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
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}

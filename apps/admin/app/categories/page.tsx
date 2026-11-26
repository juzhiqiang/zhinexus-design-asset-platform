'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentCategory } from '@company/contracts';
import { getStoredSession, loadCompanySession, platformApiOrigin, type UserSession } from '../lib/auth';
import { CategoryApiError, createComponentCategory, listComponentCategories, updateComponentCategory } from '../lib/categories-client';
import { ZnIcon } from '../lib/design/icons';
import { COMMAND_MOTIFS, ZnCommandMotif } from '../lib/design/motifs';
import { ServiceUnavailableState } from '../lib/design/ServiceUnavailableState';

const MOTIF = COMMAND_MOTIFS[3]!;

export default function CategoriesConsole() {
  const [session, setSession] = useState<UserSession | null>(() => getStoredSession());
  const [apiUrl, setApiUrl] = useState(platformApiOrigin);
  const [items, setItems] = useState<ComponentCategory[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState({ id: '', name: '' });
  const [editing, setEditing] = useState<ComponentCategory | null>(null);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const scope = useRef<{ apiUrl: string; session: UserSession | null }>({ apiUrl: platformApiOrigin, session: getStoredSession() });

  const clearPrivateState = () => {
    requestGeneration.current++;
    setItems([]);
    setAllowed(false);
    setEditing(null);
    setDraft({ id: '', name: '' });
    setNotice(null);
    setError(null);
    setLoading(false);
    setMutating(false);
  };

  const changeSession = (value: UserSession | null) => {
    if (scope.current.session?.subject !== value?.subject || scope.current.session?.token !== value?.token) {
      clearPrivateState();
    }
    scope.current.session = value;
    setSession(value);
  };

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(window.location.search).get('apiUrl');
    if (query) {
      scope.current.apiUrl = query;
      setApiUrl(query);
    }
    changeSession(getStoredSession());
    void loadCompanySession().then((value) => {
      if (active && value) changeSession(value);
    });
    return () => {
      active = false;
      requestGeneration.current++;
    };
  }, []);

  useEffect(() => {
    setItems([]);
    setAllowed(false);
    setError(null);
    if (!session) return;
    const controller = new AbortController();
    const generation = requestGeneration.current;
    const current = () => !controller.signal.aborted && generation === requestGeneration.current;
    setLoading(true);
    void listComponentCategories({ apiUrl, token: session.token, signal: controller.signal })
      .then((value) => {
        if (!current()) return;
        setItems(value.items);
        setAllowed(true);
        setEditing((cur) => (cur ? value.items.find((item) => item.id === cur.id) ?? null : null));
      })
      .catch((failure) => {
        if (!current()) return;
        const status = failure instanceof CategoryApiError ? failure.status : undefined;
        if (status === 401 || status === 403) clearPrivateState();
        setError({ status, message: failure instanceof Error ? failure.message : '读取分类失败。' });
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => controller.abort();
  }, [apiUrl, session, refresh]);

  const metrics = useMemo(() => {
    const enabled = items.filter((i) => i.enabled).length;
    return { total: items.length, enabled, disabled: items.length - enabled };
  }, [items]);

  const busy = loading || mutating;

  const act = async (operation: () => Promise<ComponentCategory>, message: string) => {
    const generation = requestGeneration.current;
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await operation();
      if (generation !== requestGeneration.current) return false;
      setItems((current) =>
        current.some((item) => item.id === updated.id)
          ? current.map((item) => (item.id === updated.id ? updated : item))
          : [...current, updated],
      );
      setEditing((current) => (current?.id === updated.id ? updated : current));
      setNotice(message);
      return true;
    } catch (failure) {
      if (generation !== requestGeneration.current) return false;
      const status = failure instanceof CategoryApiError ? failure.status : undefined;
      if (status === 401 || status === 403) clearPrivateState();
      setError({ status, message: failure instanceof Error ? failure.message : '分类操作失败，请刷新后重试。' });
      return false;
    } finally {
      if (generation === requestGeneration.current) setMutating(false);
    }
  };

  const connection = { apiUrl, token: session?.token };

  return (
    <main>
      <div className="zn-page-header access-heading">
        <div className="zn-header-copy">
          <p className="eyebrow">04 / CATEGORY REGISTRY</p>
          <h1>组件分类</h1>
          <p className="lead">维护发布时使用的分类。分类 ID 创建后保持不变，重命名与启停使用当前修订，历史发布记录保持原样。</p>
          {session ? <p className="zn-hint">当前身份：{session.subject} · 管理权限由 API 实际校验</p> : null}
        </div>
        <ZnCommandMotif motif={MOTIF} className="zn-motif" />
        <div className="zn-header-actions">
          <button type="button" className="filter-btn" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
            <ZnIcon name="refresh-cw" size={15} color="var(--zn-muted)" />
            刷新列表
          </button>
        </div>
      </div>

      {error?.status === 503 ? (
        <ServiceUnavailableState status={503} message={error.message} onRetry={() => setRefresh((v) => v + 1)} />
      ) : (
        <>
          {error ? <p className="access-error" role="alert">{error.message}</p> : null}
          {notice ? <p className="access-message" role="status">{notice}</p> : null}

          <div className="zn-metrics">
            <div className="zn-metric">
              <span className="zn-metric-rail" />
              <span className="zn-metric-copy">
                <span className="zn-metric-label">分类总数</span>
                <span className="zn-metric-value">{metrics.total}</span>
                <span className="zn-hint">含停用分类</span>
              </span>
            </div>
            <div className="zn-metric">
              <span className="zn-metric-rail" />
              <span className="zn-metric-copy">
                <span className="zn-metric-label">启用中</span>
                <span className="zn-metric-value">{metrics.enabled}</span>
                <span className="zn-hint">发布可选</span>
              </span>
            </div>
            <div className="zn-metric">
              <span className="zn-metric-rail zn-metric-rail-gold" />
              <span className="zn-metric-copy">
                <span className="zn-metric-label">已停用</span>
                <span className="zn-metric-value">{metrics.disabled}</span>
                <span className="zn-hint">历史兼容保留</span>
              </span>
            </div>
          </div>

          <section className="zn-card" aria-label="创建分类">
            <div className="zn-card-head">
              <div>
                <h2 className="zn-card-title">创建分类</h2>
                <p className="zn-card-subtitle">ID 使用字母、数字、点、下划线或连字符，以字母或数字开头；名称最多 128 字符。</p>
              </div>
            </div>
            <form
              className="zn-field-row"
              style={{ alignItems: 'flex-end' }}
              onSubmit={(event) => {
                event.preventDefault();
                void act(
                  () => createComponentCategory(connection, { id: draft.id.trim(), name: draft.name.trim() }),
                  '分类已创建。',
                ).then((success) => {
                  if (success) setDraft({ id: '', name: '' });
                });
              }}
            >
              <label className="zn-field">
                <span className="zn-field-label">分类 ID</span>
                <input
                  className="zn-input zn-input-mono"
                  required
                  maxLength={128}
                  value={draft.id}
                  disabled={!allowed || busy}
                  placeholder="例如 charts"
                  onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                />
              </label>
              <label className="zn-field">
                <span className="zn-field-label">分类名称</span>
                <input
                  className="zn-input"
                  required
                  maxLength={128}
                  value={draft.name}
                  disabled={!allowed || busy}
                  placeholder="例如 基础图表"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <button
                type="submit"
                className="filter-btn active"
                style={{ height: 40 }}
                disabled={!allowed || busy || !draft.id.trim() || !draft.name.trim()}
              >
                创建分类
              </button>
            </form>
          </section>

          <section className="zn-card" aria-label="分类列表">
            <div className="zn-table-scroll">
              <table className="zn-table">
                <thead>
                  <tr>
                    <th>分类 ID</th>
                    <th>名称</th>
                    <th>状态</th>
                    <th>修订</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="zn-table-cell-strong zn-table-cell-mono">{item.id}</td>
                      <td>{item.name}</td>
                      <td>
                        <span className={`zn-badge ${item.enabled ? 'zn-badge-success' : 'zn-badge-warning'}`}>
                          <span className="zn-badge-dot" />
                          {item.enabled ? '已启用' : '已停用'}
                        </span>
                      </td>
                      <td className="zn-table-cell-mono">{item.revision}</td>
                      <td>
                        <div className="zn-row" style={{ gap: 8 }}>
                          <button
                            type="button"
                            className="filter-btn"
                            disabled={!allowed || busy}
                            onClick={() => {
                              setEditing(item);
                              setNotice(null);
                            }}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="filter-btn"
                            disabled={!allowed || busy}
                            onClick={() =>
                              void act(
                                () =>
                                  updateComponentCategory(connection, item.id, {
                                    name: item.name,
                                    enabled: !item.enabled,
                                    expectedRevision: item.revision,
                                  }),
                                item.enabled ? '分类已停用，不再提供新的发布选择。' : '分类已启用。',
                              )
                            }
                          >
                            {item.enabled ? '停用' : '启用'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!items.length && (
                    <tr>
                      <td colSpan={5}>
                        {loading ? '正在读取分类…' : allowed ? '暂无分类' : '尚未取得分类管理权限。'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {editing && allowed ? (
            <section className="zn-card-raised" aria-label="编辑分类">
              <div className="zn-card-head">
                <div>
                  <h2 className="zn-card-title">编辑分类 <code>{editing.id}</code></h2>
                  <p className="zn-card-subtitle">稳定 ID：{editing.id} · 当前修订：{editing.revision}</p>
                </div>
              </div>
              <form
                className="zn-field-row"
                style={{ alignItems: 'flex-end' }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void act(
                    () =>
                      updateComponentCategory(connection, editing.id, {
                        name: editing.name.trim(),
                        enabled: editing.enabled,
                        expectedRevision: editing.revision,
                      }),
                    '分类已保存。',
                  );
                }}
              >
                <label className="zn-field">
                  <span className="zn-field-label">编辑分类名称</span>
                  <input
                    className="zn-input"
                    required
                    maxLength={128}
                    value={editing.name}
                    disabled={busy}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  />
                </label>
                <button type="submit" className="filter-btn active" style={{ height: 40 }} disabled={busy || !editing.name.trim()}>
                  保存分类
                </button>
                <button type="button" className="filter-btn" style={{ height: 40 }} disabled={busy} onClick={() => setEditing(null)}>
                  取消编辑
                </button>
              </form>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

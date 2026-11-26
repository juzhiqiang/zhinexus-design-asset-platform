'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createManagedAccount,
  listManagedAccounts,
  managedAccountAudit,
  ManagedAccountApiError,
  mutateManagedAccount,
  readManagedAccount,
  setManagedAccountPassword,
  ACTION_LABELS,
  CREDENTIAL_LABELS,
  SYNC_LABELS,
  type ManagedAccountDraft,
} from '../lib/managed-accounts-client';
import { ZnIcon } from '../lib/design/icons';
import { COMMAND_MOTIFS, ZnCommandMotif } from '../lib/design/motifs';
import { ServiceUnavailableState } from '../lib/design/ServiceUnavailableState';
import type { ManagedAccountDetail, ManagedAccountRole } from '@company/contracts';

const emptyDraft: ManagedAccountDraft = { username: '', displayName: '', roles: ['reader'], componentGrants: [], packageGrants: [] };

const MOTIF = COMMAND_MOTIFS[4]!;

function initialsOf(username: string): string {
  const parts = username.split(/[-_.\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

function grantText(account: ManagedAccountDetail): string {
  return account.componentGrants
    .map(grant => `${grant.componentId}${grant.canPublish ? '（发布）' : ''}${grant.canMaintain ? '（维护）' : ''}`)
    .join('、') || '无';
}

export default function ManagedAccountsConsole() {
  const [accounts, setAccounts] = useState<ManagedAccountDetail[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<ManagedAccountDraft>(emptyDraft);
  const [password, setPassword] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [audit, setAudit] = useState<{ at: string; actor: string; action: string; username: string; result: string }[]>([]);

  const reload = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const list = await listManagedAccounts({
        ...(query.trim() ? { query: query.trim() } : {}),
        ...(statusFilter === 'all' ? {} : { enabled: statusFilter === 'enabled' }),
      });
      setAccounts(list.items as ManagedAccountDetail[]);
      if (selected) setAccounts(current => current.some(item => item.id === selected) ? current : [...current, ...(list.items as ManagedAccountDetail[])]);
    } catch (failure) {
      setError({
        status: failure instanceof ManagedAccountApiError ? failure.status : undefined,
        message: failure instanceof Error ? failure.message : '读取成员列表失败。',
      });
    }
    finally { setBusy(false); }
  }, [query, selected, statusFilter]);

  useEffect(() => { void reload(); }, [reload]);

  const current = accounts.find(item => item.id === selected);

  const metrics = useMemo(() => {
    const enabled = accounts.filter(item => item.enabled).length;
    const passwordPending = accounts.filter(item => item.credentialState === 'unset').length;
    const latest = accounts.reduce<string | null>((best, item) => (!best || item.updatedAt > best ? item.updatedAt : best), null);
    return {
      total: accounts.length,
      enabled,
      enabledRatio: accounts.length ? Math.round((enabled / accounts.length) * 1000) / 10 : 0,
      passwordPending,
      latestTime: latest ? new Date(latest).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—',
      latestDate: latest ? new Date(latest).toLocaleDateString('zh-CN') : '—',
    };
  }, [accounts]);

  const act = async (operation: () => Promise<ManagedAccountDetail>, message: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const updated = await operation();
      setAccounts(current => current.map(item => item.id === updated.id ? updated : item));
      setNotice(message);
      setPassword('');
      await reload();
    } catch (failure) {
      setError({
        status: failure instanceof ManagedAccountApiError ? failure.status : undefined,
        message: failure instanceof Error ? failure.message : '操作失败，请刷新后重试。',
      });
    }
    finally { setBusy(false); }
  };

  return (
    <main>
      <div className="access-heading zn-page-header">
        <div className="zn-header-copy">
          <p className="eyebrow">05 / IDENTITY LEDGER</p>
          <h1>成员与权限</h1>
          <p className="lead">管理成员身份、业务角色与资产授权，敏感操作均保留审计轨迹。</p>
        </div>
        <ZnCommandMotif motif={MOTIF} className="zn-motif" />
        <div className="zn-header-actions">
          <button className="filter-btn" disabled={busy} onClick={() => void reload()}><ZnIcon name="refresh-cw" size={15} color="var(--zn-muted)" />刷新列表</button>
        </div>
      </div>

      {error?.status === 503 || error?.status === 403 ? (
        <ServiceUnavailableState status={error.status} message={error.message} onRetry={() => void reload()} />
      ) : <>
        {error && <p className="access-error" role="alert">{error.message}</p>}
        {notice && <p className="access-message" role="status">{notice}</p>}

        <div className="zn-metrics">
          <div className="zn-metric">
            <span className="zn-metric-rail" />
            <span className="zn-metric-copy">
              <span className="zn-metric-label">成员账号</span>
              <span className="zn-metric-value">{metrics.total}</span>
              <span className="zn-hint">全部成员</span>
            </span>
          </div>
          <div className="zn-metric">
            <span className="zn-metric-rail" />
            <span className="zn-metric-copy">
              <span className="zn-metric-label">已启用</span>
              <span className="zn-metric-value">{metrics.enabled}</span>
              <span className="zn-hint">{metrics.enabledRatio}%</span>
            </span>
          </div>
          <div className="zn-metric">
            <span className="zn-metric-rail zn-metric-rail-gold" />
            <span className="zn-metric-copy">
              <span className="zn-metric-label">待首次改密</span>
              <span className="zn-metric-value">{metrics.passwordPending}</span>
              <span className="zn-hint">需处理</span>
            </span>
          </div>
          <div className="zn-metric">
            <span className="zn-metric-rail" />
            <span className="zn-metric-copy">
              <span className="zn-metric-label">最近同步</span>
              <span className="zn-metric-value">{metrics.latestTime}</span>
              <span className="zn-hint">{metrics.latestDate}</span>
            </span>
          </div>
        </div>

        <div className="zn-grid-2">
          <div className="zn-stack">
            <section className="zn-card" aria-label="成员身份目录">
              <div className="zn-card-head">
                <div>
                  <h2 className="zn-card-title">成员身份目录</h2>
                  <p className="zn-card-subtitle">选择成员后在右侧管理账号与权限</p>
                </div>
                <div className="zn-row">
                  <span className="zn-quick-search" style={{ width: 220 }}>
                    <ZnIcon name="search" size={14} color="var(--zn-subtle)" className="zn-quick-search-icon" />
                    <input
                      className="zn-quick-search-input"
                      type="search"
                      value={query}
                      placeholder="搜索用户名或显示名"
                      aria-label="搜索用户名或显示名"
                      onChange={event => setQuery(event.target.value)}
                    />
                  </span>
                  <select className="zn-input" style={{ width: 150, height: 34 }} value={statusFilter} aria-label="账号状态筛选" onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}>
                    <option value="all">全部状态</option>
                    <option value="enabled">仅启用</option>
                    <option value="disabled">仅停用</option>
                  </select>
                </div>
              </div>
              <div className="zn-table-scroll">
                <table className="zn-table" style={{ minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 150 }}>用户名</th>
                      <th style={{ width: 120 }}>显示名</th>
                      <th>角色</th>
                      <th style={{ width: 92 }}>状态</th>
                      <th style={{ width: 110 }}>密码</th>
                      <th style={{ width: 96 }}>同步</th>
                      <th style={{ width: 84 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map(account => (
                      <tr key={account.id}>
                        <td className="zn-table-cell-strong zn-table-cell-mono">{account.username}</td>
                        <td>{account.displayName}</td>
                        <td>{account.roles.join(', ')}</td>
                        <td>
                          <span className={`zn-badge ${account.enabled ? 'zn-badge-success' : 'zn-badge-danger'}`}>
                            <span className="zn-badge-dot" />
                            {account.administrator ? '部署管理员' : account.enabled ? '启用' : '停用'}
                          </span>
                        </td>
                        <td>
                          <span className={`zn-badge ${account.credentialState === 'set' ? 'zn-badge-success' : 'zn-badge-warning'}`}>
                            <span className="zn-badge-dot" />
                            {CREDENTIAL_LABELS[account.credentialState]}
                          </span>
                        </td>
                        <td>
                          <span className={`zn-badge ${account.syncState === 'synced' ? 'zn-badge-success' : 'zn-badge-warning'}`}>
                            <span className="zn-badge-dot" />
                            {SYNC_LABELS[account.syncState]}
                          </span>
                        </td>
                        <td>
                          <button className="filter-btn" disabled={busy} onClick={() => void readManagedAccount(account.id).then(account => setSelected(account.id)).catch(failure => setError({ status: failure instanceof ManagedAccountApiError ? failure.status : undefined, message: failure instanceof Error ? failure.message : '读取详情失败。' }))}>
                            详情<ZnIcon name="arrow-up-right" size={13} color="var(--zn-accent)" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!accounts.length && <tr><td colSpan={7}>{busy ? '正在读取…' : '暂无成员。'}</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="zn-card" aria-label="新成员登记">
              <div className="zn-card-head">
                <div>
                  <h2 className="zn-card-title">新成员登记</h2>
                  <p className="zn-card-subtitle">用户名创建后不可修改，按 ASCII 小写规范化。</p>
                </div>
              </div>
              <form className="zn-stack-sm" onSubmit={event => {
                event.preventDefault();
                void act(() => createManagedAccount(draft), '账号已创建，请为成员设置临时密码。').then(() => setDraft(emptyDraft));
              }}>
                <div className="zn-field-row">
                  <label className="zn-field">
                    <span className="zn-field-label">用户名</span>
                    <input className="zn-input" value={draft.username} autoComplete="off" onChange={event => setDraft({ ...draft, username: event.target.value })} />
                  </label>
                  <label className="zn-field">
                    <span className="zn-field-label">显示名</span>
                    <input className="zn-input" value={draft.displayName} onChange={event => setDraft({ ...draft, displayName: event.target.value })} />
                  </label>
                </div>
                <div className="zn-field">
                  <span className="zn-field-label">业务角色</span>
                  <div className="zn-row">
                    {(['reader', 'publisher', 'maintainer'] as ManagedAccountRole[]).map(role => {
                      const active = draft.roles.includes(role);
                      return (
                        <button
                          key={role}
                          type="button"
                          className={active ? 'filter-btn active' : 'filter-btn'}
                          aria-pressed={active}
                          onClick={() => setDraft({ ...draft, roles: active ? draft.roles.filter(item => item !== role) : [...draft.roles, role] })}
                        >
                          <ZnIcon name={active ? 'check' : 'circle'} size={13} color={active ? 'var(--zn-accent)' : 'var(--zn-subtle)'} />
                          {role}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="zn-field-row">
                  <label className="zn-field">
                    <span className="zn-field-label">组件授权（每行一个组件 ID，逗号分隔发布/维护）</span>
                    <textarea
                      className="zn-input zn-input-mono"
                      value={draft.componentGrants.map(grant => `${grant.componentId},${grant.canPublish ? 'publish' : ''}${grant.canMaintain ? ',maintain' : ''}`).join('\n')}
                      onChange={event => setDraft({ ...draft, componentGrants: event.target.value.split('\n').map(line => line.trim()).filter(Boolean).map(line => { const [componentId = '', ...flags] = line.split(','); return { componentId, canPublish: flags.includes('publish'), canMaintain: flags.includes('maintain') }; }) })}
                    />
                  </label>
                  <label className="zn-field">
                    <span className="zn-field-label">包授权（每行一个 npm 包名）</span>
                    <textarea
                      className="zn-input zn-input-mono"
                      value={draft.packageGrants.join('\n')}
                      onChange={event => setDraft({ ...draft, packageGrants: event.target.value.split('\n').map(line => line.trim()).filter(Boolean) })}
                    />
                  </label>
                </div>
                <div className="zn-row">
                  <button className="filter-btn active" type="submit" disabled={busy}><ZnIcon name="plus" size={15} color="var(--zn-on-primary)" />创建账号</button>
                </div>
              </form>
            </section>

            <section className="zn-card" aria-label="身份操作记录">
              <div className="zn-card-head">
                <h2 className="zn-card-title">身份操作记录</h2>
                <button className="filter-btn" disabled={busy} onClick={() => void managedAccountAudit().then(value => setAudit(value.items)).catch(() => setError({ message: '读取操作记录失败。' }))}>读取记录</button>
              </div>
              {audit.length ? (
                <div className="zn-checks">
                  {audit.map((entry, index) => (
                    <div className="zn-check" key={`${entry.at}-${index}`}>
                      <span className="zn-check-group">
                        <ZnIcon name="circle-check-big" size={16} color={entry.result === 'failed' ? 'var(--zn-danger)' : 'var(--zn-success)'} className="zn-check-icon" />
                        <span className="zn-event-time">{new Date(entry.at).toLocaleString('zh-CN')}</span>
                        <span className="zn-check-label">{ACTION_LABELS[entry.action as keyof typeof ACTION_LABELS] ?? entry.action} · {entry.username}</span>
                      </span>
                      <span className={`zn-badge ${entry.result === 'failed' ? 'zn-badge-danger' : 'zn-badge-success'}`}>
                        <span className="zn-badge-dot" />
                        {entry.result === 'failed' ? '失败' : '成功'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <p className="access-hint">尚未读取操作记录。</p>}
            </section>
          </div>

          <div className="zn-card-raised">
            {!current ? (
              <section className="zn-card" aria-label="成员详情">
                <h2 className="zn-card-title">成员详情</h2>
                <p className="access-hint">在左侧目录中选择一名成员，即可管理账号与权限。</p>
              </section>
            ) : (
              <section className="zn-card" aria-label="成员详情">
                <div className="zn-card-head">
                  <div>
                    <h2 className="zn-card-title">{current.username}</h2>
                    <p className="zn-card-subtitle">账号版本 {current.accountVersion} · 预期修订 {current.desiredRevision}</p>
                  </div>
                  <span className={`zn-badge ${current.enabled ? 'zn-badge-success' : 'zn-badge-danger'}`}>
                    <span className="zn-badge-dot" />
                    {current.enabled ? '启用' : '停用'}
                  </span>
                </div>
                <p className="access-hint">显示名、业务角色、组件与包权限、停用、恢复、重置临时密码与强制重新登录。并发旧版本提交会被拒绝。</p>
                <div className="zn-stack-sm" style={{ marginTop: 14 }}>
                  <label className="zn-field">
                    <span className="zn-field-label">显示名</span>
                    <input className="zn-input" value={current.displayName} onChange={event => setAccounts(list => list.map(item => item.id === current.id ? { ...item, displayName: event.target.value } : item))} />
                  </label>
                  <div className="zn-field">
                    <span className="zn-field-label">业务角色</span>
                    <div className="zn-row">
                      {(['reader', 'publisher', 'maintainer'] as ManagedAccountRole[]).map(role => {
                        const active = current.roles.includes(role);
                        return (
                          <button
                            key={role}
                            type="button"
                            className={active ? 'filter-btn active' : 'filter-btn'}
                            aria-pressed={active}
                            disabled={busy}
                            onClick={() => void act(() => mutateManagedAccount(current.id, 'update', { expectedRevision: current.desiredRevision, roles: active ? current.roles.filter(item => item !== role) : [...current.roles, role] }), '角色已更新。')}
                          >
                            <ZnIcon name={active ? 'check' : 'circle'} size={13} color={active ? 'var(--zn-accent)' : 'var(--zn-subtle)'} />
                            {role}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="zn-field">
                    <span className="zn-field-label">资产授权</span>
                    <div className="zn-check">
                      <span className="zn-check-group">
                        <ZnIcon name="boxes" size={14} color="var(--zn-muted)" className="zn-check-icon" />
                        <span className="zn-check-label">组件授权</span>
                      </span>
                      <span className="zn-check-status">{grantText(current)}</span>
                    </div>
                    <div className="zn-check">
                      <span className="zn-check-group">
                        <ZnIcon name="package" size={14} color="var(--zn-muted)" className="zn-check-icon" />
                        <span className="zn-check-label">包授权</span>
                      </span>
                      <span className="zn-check-status">{current.packageGrants.join('、') || '无'}</span>
                    </div>
                  </div>
                  <div className="zn-field">
                    <span className="zn-field-label">账号操作</span>
                    <div className="zn-stack-sm">
                      <button className="filter-btn" disabled={busy} onClick={() => void act(() => mutateManagedAccount(current.id, 'update', { expectedRevision: current.desiredRevision, displayName: current.displayName }), '显示名已更新。')}>保存显示名</button>
                      <div className="zn-row">
                        <button className="filter-btn" style={{ background: 'var(--zn-danger-soft)', borderColor: '#FFB1B541', color: 'var(--zn-danger)', flex: '1 1 140px' }} disabled={busy || !current.enabled} onClick={() => void act(() => mutateManagedAccount(current.id, 'disable', { expectedRevision: current.desiredRevision }), '账号已停用，已有凭据立即失效。')}>
                          <ZnIcon name="trash-2" size={15} color="var(--zn-danger)" />停用
                        </button>
                        <button className="filter-btn" style={{ flex: '1 1 140px' }} disabled={busy || current.enabled} onClick={() => void act(() => mutateManagedAccount(current.id, 'enable', { expectedRevision: current.desiredRevision }), '账号恢复请求已提交。')}>恢复</button>
                      </div>
                      <button className="filter-btn" disabled={busy} onClick={() => void act(() => mutateManagedAccount(current.id, 'force-logout', { expectedRevision: current.desiredRevision }), '已要求该成员重新登录。')}>强制重新登录</button>
                    </div>
                  </div>
                  <form className="zn-field" onSubmit={event => {
                    event.preventDefault();
                    void act(() => setManagedAccountPassword(current.id, current.desiredRevision, password), '临时密码已设置。').then(() => setPassword(''));
                  }}>
                    <span className="zn-field-label">临时密码</span>
                    <span className="zn-hint">至少 14 字符，仅在本次请求中传输，不保存、不显示。</span>
                    <input className="zn-input" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
                    <button className="filter-btn" type="submit" disabled={busy || password.length < 14}>设置临时密码</button>
                  </form>
                </div>
              </section>
            )}
          </div>
        </div>
      </>}
    </main>
  );
}

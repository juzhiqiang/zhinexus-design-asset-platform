'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ServiceUnavailableState } from '../lib/design/ServiceUnavailableState';
import { getStoredSession, platformApiOrigin } from '../lib/auth';
import { readPublishingOptions } from '../lib/categories-client';
import type {
  ManagedAccountComponentGrant,
  ManagedAccountDetail,
  ManagedAccountRole,
  ManagedAccountSummary,
} from '@company/contracts';

const ROLE_META: Record<ManagedAccountRole, { label: string; desc: string }> = {
  reader: { label: '只读成员', desc: '浏览与检索已授权组件与文档' },
  publisher: { label: '组件发布者', desc: '上传冻结产物并提交组件发布作业' },
  maintainer: { label: '资产维护者', desc: '确认视觉基线、废弃版本与维护作业' },
};

const ALL_ROLES: readonly ManagedAccountRole[] = ['reader', 'publisher', 'maintainer'];
const emptyDraft: ManagedAccountDraft = { username: '', displayName: '', roles: ['reader'], componentGrants: [], packageGrants: [] };

function initialsOf(name: string): string {
  const clean = name.trim();
  if (!clean) return 'ZN';
  if (/[\u4e00-\u9fa5]/.test(clean)) return clean.slice(-2);
  const parts = clean.split(/[-_.\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

function generateStrongPassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]!).join('');
}

function sameGrants(a: ManagedAccountComponentGrant[], b: ManagedAccountComponentGrant[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (g, i) =>
      g.componentId === b[i]!.componentId &&
      Boolean(g.canRead) === Boolean(b[i]!.canRead) &&
      g.canPublish === b[i]!.canPublish &&
      g.canMaintain === b[i]!.canMaintain,
  );
}

/** 结构化组件与包授权编辑器（支持只读 / 发布 / 维护三档权限及已知候选补全） */
function GrantsEditor({
  componentGrants,
  packageGrants,
  knownComponents = [],
  knownPackages = [],
  disabled,
  onChangeComponents,
  onChangePackages,
}: {
  componentGrants: ManagedAccountComponentGrant[];
  packageGrants: string[];
  knownComponents?: string[];
  knownPackages?: string[];
  disabled?: boolean;
  onChangeComponents: (next: ManagedAccountComponentGrant[]) => void;
  onChangePackages: (next: string[]) => void;
}) {
  const [newCompId, setNewCompId] = useState('');
  const [newCompRead, setNewCompRead] = useState(true);
  const [newCompPublish, setNewCompPublish] = useState(false);
  const [newCompMaintain, setNewCompMaintain] = useState(false);
  const [newPkg, setNewPkg] = useState('');

  const addComponent = () => {
    const id = newCompId.trim();
    if (!id || !(newCompRead || newCompPublish || newCompMaintain)) return;
    const nextGrant: ManagedAccountComponentGrant = {
      componentId: id,
      ...(newCompRead ? { canRead: true } : {}),
      canPublish: newCompPublish,
      canMaintain: newCompMaintain,
    };
    const existing = componentGrants.find((g) => g.componentId === id);
    if (existing) {
      onChangeComponents(componentGrants.map((g) => (g.componentId === id ? nextGrant : g)));
    } else {
      onChangeComponents([...componentGrants, nextGrant]);
    }
    setNewCompId('');
  };

  const addPackage = () => {
    const name = newPkg.trim();
    if (!name || packageGrants.includes(name)) return;
    onChangePackages([...packageGrants, name]);
    setNewPkg('');
  };

  return (
    <div className="zn-stack-sm" style={{ gap: 16 }}>
      <div className="zn-field">
        <span className="zn-field-label">组件授权（{componentGrants.length}）</span>
        {componentGrants.length > 0 ? (
          <div className="zn-grant-list">
            {componentGrants.map((grant) => (
              <div className="zn-grant-row" key={grant.componentId}>
                <span className="zn-table-cell-mono zn-table-cell-strong">{grant.componentId}</span>
                <div className="zn-row" style={{ gap: 6 }}>
                  <label className="zn-grant-check">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={Boolean(grant.canRead)}
                      onChange={(e) => {
                        const nextRead = e.target.checked;
                        if (!(nextRead || grant.canPublish || grant.canMaintain)) return;
                        onChangeComponents(
                          componentGrants.map((g) =>
                            g.componentId === grant.componentId
                              ? { componentId: g.componentId, ...(nextRead ? { canRead: true } : {}), canPublish: g.canPublish, canMaintain: g.canMaintain }
                              : g,
                          ),
                        );
                      }}
                    />
                    读取
                  </label>
                  <label className="zn-grant-check">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={grant.canPublish}
                      onChange={(e) => {
                        const nextPub = e.target.checked;
                        if (!(Boolean(grant.canRead) || nextPub || grant.canMaintain)) return;
                        onChangeComponents(
                          componentGrants.map((g) => (g.componentId === grant.componentId ? { ...g, canPublish: nextPub } : g)),
                        );
                      }}
                    />
                    发布
                  </label>
                  <label className="zn-grant-check">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={grant.canMaintain}
                      onChange={(e) => {
                        const nextMaint = e.target.checked;
                        if (!(Boolean(grant.canRead) || grant.canPublish || nextMaint)) return;
                        onChangeComponents(
                          componentGrants.map((g) => (g.componentId === grant.componentId ? { ...g, canMaintain: nextMaint } : g)),
                        );
                      }}
                    />
                    维护
                  </label>
                  <button
                    type="button"
                    className="zn-icon-btn"
                    aria-label={`移除组件 ${grant.componentId}`}
                    disabled={disabled}
                    onClick={() => onChangeComponents(componentGrants.filter((g) => g.componentId !== grant.componentId))}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="zn-hint">尚未分配组件级发布或维护权限。</p>
        )}
        <div className="zn-grant-add">
          <input
            className="zn-input zn-input-mono"
            style={{ minHeight: 34 }}
            list="zn-known-components"
            value={newCompId}
            disabled={disabled}
            placeholder="输入或选择组件 ID，如 line"
            aria-label="新增组件授权 ID"
            onChange={(e) => setNewCompId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addComponent();
              }
            }}
          />
          <datalist id="zn-known-components">
            {knownComponents.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          <label className="zn-grant-check">
            <input type="checkbox" disabled={disabled} checked={newCompRead} onChange={(e) => setNewCompRead(e.target.checked)} />
            读取
          </label>
          <label className="zn-grant-check">
            <input type="checkbox" disabled={disabled} checked={newCompPublish} onChange={(e) => setNewCompPublish(e.target.checked)} />
            发布
          </label>
          <label className="zn-grant-check">
            <input type="checkbox" disabled={disabled} checked={newCompMaintain} onChange={(e) => setNewCompMaintain(e.target.checked)} />
            维护
          </label>
          <button type="button" className="zn-btn" disabled={disabled || !newCompId.trim() || !(newCompRead || newCompPublish || newCompMaintain)} onClick={addComponent}>
            添加
          </button>
        </div>
      </div>

      <div className="zn-field">
        <span className="zn-field-label">NPM 包授权（{packageGrants.length}）</span>
        {packageGrants.length > 0 ? (
          <div className="zn-chip-list">
            {packageGrants.map((pkg) => (
              <span className="zn-chip" key={pkg}>
                <code>{pkg}</code>
                <button
                  type="button"
                  className="zn-chip-remove"
                  aria-label={`移除包 ${pkg}`}
                  disabled={disabled}
                  onClick={() => onChangePackages(packageGrants.filter((p) => p !== pkg))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="zn-hint">尚未分配 npm 包发布权限。</p>
        )}
        <div className="zn-grant-add">
          <input
            className="zn-input zn-input-mono"
            style={{ minHeight: 34 }}
            list="zn-known-packages"
            value={newPkg}
            disabled={disabled}
            placeholder="输入或选择包名，如 @company/charts-vue"
            aria-label="新增包授权名称"
            onChange={(e) => setNewPkg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addPackage();
              }
            }}
          />
          <datalist id="zn-known-packages">
            {knownPackages.map((pkg) => (
              <option key={pkg} value={pkg} />
            ))}
          </datalist>
          <button type="button" className="zn-btn" disabled={disabled || !newPkg.trim()} onClick={addPackage}>
            添加包
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ManagedAccountsConsole() {
  const [viewTab, setViewTab] = useState<'directory' | 'audit'>('directory');
  const [accounts, setAccounts] = useState<ManagedAccountSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<ManagedAccountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'permissions' | 'security'>('permissions');

  // 右侧编辑缓冲状态（先改后保存，避免每次点选角色都发请求）
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRoles, setEditRoles] = useState<ManagedAccountRole[]>([]);
  const [editComponents, setEditComponents] = useState<ManagedAccountComponentGrant[]>([]);
  const [editPackages, setEditPackages] = useState<string[]>([]);

  // 密码与安全操作状态
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);

  // 搜索防抖、状态筛选与服务端分页
  const [queryInput, setQueryInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [totalAccounts, setTotalAccounts] = useState(0);

  // 列表 / 操作状态
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 审计日志
  const [audit, setAudit] = useState<{ at: string; actor: string; action: string; username: string; result: string }[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // 新建成员原生 <dialog>
  const createDialogRef = useRef<HTMLDialogElement | null>(null);
  const [draft, setDraft] = useState<ManagedAccountDraft>(emptyDraft);
  const [createError, setCreateError] = useState<string | null>(null);
  const [knownComponents, setKnownComponents] = useState<string[]>([]);
  const [knownPackages, setKnownPackages] = useState<string[]>([]);

  useEffect(() => {
    const session = getStoredSession();
    if (!session) return;
    const controller = new AbortController();
    void readPublishingOptions({ apiUrl: platformApiOrigin, token: session.token, signal: controller.signal })
      .then((opts) => {
        setKnownComponents(opts.components.map((c) => c.componentId));
        setKnownPackages(opts.packages);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(queryInput.trim());
      setPage(1);
    }, 220);
    return () => clearTimeout(timer);
  }, [queryInput]);

  const hydrateEditor = useCallback((detail: ManagedAccountDetail) => {
    setSelectedDetail(detail);
    setEditDisplayName(detail.displayName);
    setEditRoles([...detail.roles]);
    setEditComponents(detail.componentGrants.map((g) => ({ ...g })));
    setEditPackages([...detail.packageGrants]);
    setConfirmDisable(false);
    setPassword('');
  }, []);

  const selectAccount = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setDetailLoading(true);
      setNotice(null);
      setConfirmDisable(false);
      try {
        const detail = await readManagedAccount(id);
        hydrateEditor(detail);
      } catch (failure) {
        setError({
          status: failure instanceof ManagedAccountApiError ? failure.status : undefined,
          message: failure instanceof Error ? failure.message : '读取成员详情失败。',
        });
      } finally {
        setDetailLoading(false);
      }
    },
    [hydrateEditor],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listManagedAccounts({
        ...(debouncedQuery ? { query: debouncedQuery } : {}),
        ...(statusFilter === 'all' ? {} : { enabled: statusFilter === 'enabled' }),
        page,
        pageSize,
      });
      setAccounts(list.items);
      setTotalAccounts(list.total);
    } catch (failure) {
      setError({
        status: failure instanceof ManagedAccountApiError ? failure.status : undefined,
        message: failure instanceof Error ? failure.message : '读取成员列表失败。',
      });
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, statusFilter, page, pageSize]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const value = await managedAccountAudit();
      setAudit(value.items);
    } catch (failure) {
      setError({
        status: failure instanceof ManagedAccountApiError ? failure.status : undefined,
        message: failure instanceof Error ? failure.message : '读取操作记录失败。',
      });
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewTab === 'audit') {
      void loadAudit();
    }
  }, [viewTab, loadAudit]);

  const totalPages = Math.max(1, Math.ceil(totalAccounts / pageSize));

  const metrics = useMemo(() => {
    const enabled = accounts.filter((item) => item.enabled).length;
    const passwordPending = accounts.filter((item) => item.credentialState === 'unset').length;
    const latest = accounts.reduce<string | null>((best, item) => (!best || item.updatedAt > best ? item.updatedAt : best), null);
    return {
      total: Math.max(totalAccounts, accounts.length),
      enabled,
      enabledRatio: accounts.length ? Math.round((enabled / accounts.length) * 100) : 0,
      passwordPending,
      latestTime: latest ? new Date(latest).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—',
      latestDate: latest ? new Date(latest).toLocaleDateString('zh-CN') : '暂无同步',
    };
  }, [accounts, totalAccounts]);

  const isDirty = useMemo(() => {
    if (!selectedDetail) return false;
    if (editDisplayName.trim() !== selectedDetail.displayName) return true;
    if (editRoles.length !== selectedDetail.roles.length || !editRoles.every((r) => selectedDetail.roles.includes(r))) return true;
    if (!sameGrants(editComponents, selectedDetail.componentGrants)) return true;
    if (editPackages.length !== selectedDetail.packageGrants.length || !editPackages.every((p, i) => p === selectedDetail.packageGrants[i])) return true;
    return false;
  }, [selectedDetail, editDisplayName, editRoles, editComponents, editPackages]);

  const runMutation = async (operation: () => Promise<ManagedAccountDetail>, message: string) => {
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await operation();
      hydrateEditor(updated);
      setAccounts((prev) =>
        prev.some((item) => item.id === updated.id)
          ? prev.map((item) => (item.id === updated.id ? updated : item))
          : [updated, ...prev],
      );
      setNotice(message);
      return updated;
    } catch (failure) {
      setError({
        status: failure instanceof ManagedAccountApiError ? failure.status : undefined,
        message: failure instanceof Error ? failure.message : '操作失败，请刷新后重试。',
      });
      return null;
    } finally {
      setMutating(false);
    }
  };

  const handleSavePermissions = async () => {
    if (!selectedDetail || !editDisplayName.trim() || editRoles.length === 0) return;
    await runMutation(
      () =>
        mutateManagedAccount(selectedDetail.id, 'update', {
          expectedRevision: selectedDetail.desiredRevision,
          displayName: editDisplayName.trim(),
          roles: editRoles,
          componentGrants: editComponents,
          packageGrants: editPackages,
        }),
      '成员资料与权限已保存。',
    );
  };

  const openCreateDialog = () => {
    setDraft(emptyDraft);
    setCreateError(null);
    createDialogRef.current?.showModal();
  };

  const closeCreateDialog = () => {
    createDialogRef.current?.close();
  };

  const handleCreateSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.username.trim() || !draft.displayName.trim() || draft.roles.length === 0) {
      setCreateError('请填写用户名、显示名，并至少选择一个业务角色。');
      return;
    }
    setMutating(true);
    setCreateError(null);
    try {
      const created = await createManagedAccount({
        ...draft,
        username: draft.username.trim(),
        displayName: draft.displayName.trim(),
      });
      closeCreateDialog();
      setSelectedId(created.id);
      hydrateEditor(created);
      setInspectorTab('security');
      setNotice(`成员 ${created.username} 已创建，请立即为其设置临时密码。`);
      await reload();
    } catch (failure) {
      setCreateError(failure instanceof Error ? failure.message : '创建账号失败，请检查填写内容。');
    } finally {
      setMutating(false);
    }
  };

  return (
    <main>
      <div className="zn-page-header access-heading">
        <div className="zn-header-copy">
          <p className="eyebrow">05 / IDENTITY LEDGER</p>
          <h1>成员与权限</h1>
          <p className="lead">统一管理成员角色、组件与包级授权、临时密码及会话安全，所有变更自动写入审计轨迹。</p>
        </div>
        <div className="zn-header-actions">
          <button type="button" className="zn-btn" disabled={loading || mutating} onClick={() => void reload()}>
            <ZnIcon name="refresh-cw" size={14} color="currentColor" />
            刷新列表
          </button>
          <button type="button" className="zn-btn zn-btn-primary" disabled={mutating} onClick={openCreateDialog}>
            <ZnIcon name="plus" size={15} color="currentColor" />
            新建成员
          </button>
        </div>
      </div>

      {error?.status === 503 || error?.status === 403 ? (
        <ServiceUnavailableState status={error.status} message={error.message} onRetry={() => void reload()} />
      ) : (
        <>
          {error ? <p className="access-error" role="alert">{error.message}</p> : null}
          {notice ? <p className="access-message" role="status">{notice}</p> : null}

          <div className="zn-metrics">
            <div className="zn-metric">
              <span className="zn-metric-copy">
                <span className="zn-metric-label">成员账号</span>
                <span className="zn-metric-value">{metrics.total}</span>
                <span className="zn-hint">当前目录总数</span>
              </span>
            </div>
            <div className="zn-metric">
              <span className="zn-metric-copy">
                <span className="zn-metric-label">已启用</span>
                <span className="zn-metric-value">{metrics.enabled}</span>
                <span className="zn-hint">占比 {metrics.enabledRatio}%</span>
              </span>
            </div>
            <div className="zn-metric">
              <span className="zn-metric-copy">
                <span className="zn-metric-label">待设置密码</span>
                <span className="zn-metric-value">{metrics.passwordPending}</span>
                <span className="zn-hint">{metrics.passwordPending > 0 ? '需设置临时密码激活' : '全部已就绪'}</span>
              </span>
            </div>
            <div className="zn-metric">
              <span className="zn-metric-copy">
                <span className="zn-metric-label">最近同步</span>
                <span className="zn-metric-value">{metrics.latestTime}</span>
                <span className="zn-hint">{metrics.latestDate}</span>
              </span>
            </div>
          </div>

          <div className="zn-tabs" role="tablist" aria-label="成员管理视图">
            <button
              type="button"
              role="tab"
              className="zn-tab"
              aria-selected={viewTab === 'directory'}
              onClick={() => setViewTab('directory')}
            >
              <ZnIcon name="users" size={14} color="currentColor" />
              成员目录
            </button>
            <button
              type="button"
              role="tab"
              className="zn-tab"
              aria-selected={viewTab === 'audit'}
              onClick={() => setViewTab('audit')}
            >
              <ZnIcon name="activity" size={14} color="currentColor" />
              操作审计
            </button>
          </div>

          {viewTab === 'directory' ? (
            <div className="zn-users-workspace">
              {/* 左侧：干净无横向溢出的成员列表 */}
              <section className="zn-card" aria-label="成员身份目录">
                <div className="zn-card-head">
                  <div>
                    <h2 className="zn-card-title">成员列表</h2>
                    <p className="zn-card-subtitle">点击任意成员即可在右侧配置角色、授权与安全策略</p>
                  </div>
                  <div className="zn-row" style={{ gap: 10 }}>
                    <span className="zn-quick-search" style={{ width: 210 }}>
                      <ZnIcon name="search" size={14} color="currentColor" className="zn-quick-search-icon" />
                      <input
                        className="zn-quick-search-input"
                        type="search"
                        value={queryInput}
                        placeholder="搜索用户名或显示名"
                        aria-label="搜索用户名或显示名"
                        onChange={(e) => setQueryInput(e.target.value)}
                      />
                    </span>
                    <div className="zn-tabs" role="group" aria-label="账号状态筛选">
                      {([['all', '全部'], ['enabled', '启用'], ['disabled', '停用']] as const).map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          className="zn-tab"
                          aria-selected={statusFilter === val}
                          onClick={() => {
                            setStatusFilter(val);
                            setPage(1);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {accounts.length > 0 ? (
                  <div className="zn-member-list" role="list">
                    {accounts.map((account) => {
                      const active = selectedId === account.id;
                      return (
                        <button
                          key={account.id}
                          type="button"
                          role="listitem"
                          className="zn-member-row"
                          data-selected={active ? 'true' : undefined}
                          onClick={() => void selectAccount(account.id)}
                        >
                          <div className="zn-member-identity">
                            <span className="zn-member-avatar" aria-hidden="true">
                              {initialsOf(account.displayName || account.username)}
                            </span>
                            <div className="zn-member-names">
                              <div className="zn-row" style={{ gap: 6 }}>
                                <span className="zn-member-display">{account.displayName}</span>
                                {account.administrator ? <span className="zn-badge zn-badge-accent">部署管理员</span> : null}
                              </div>
                              <span className="zn-member-username">@{account.username}</span>
                            </div>
                          </div>

                          <div className="zn-member-roles">
                            {account.roles.map((role) => (
                              <span key={role} className="zn-role-pill">
                                {ROLE_META[role]?.label ?? role}
                              </span>
                            ))}
                          </div>

                          <div className="zn-member-meta">
                            <span className={`zn-badge ${account.enabled ? 'zn-badge-success' : 'zn-badge-danger'}`}>
                              <span className="zn-badge-dot" />
                              {account.enabled ? '启用' : '停用'}
                            </span>
                            {account.credentialState !== 'set' ? (
                              <span className="zn-badge zn-badge-warning">{CREDENTIAL_LABELS[account.credentialState]}</span>
                            ) : account.syncState !== 'synced' ? (
                              <span className="zn-badge zn-badge-warning">{SYNC_LABELS[account.syncState]}</span>
                            ) : null}
                            <ZnIcon name="chevron-right" size={15} color="var(--ap-text-tertiary)" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="zn-empty-state">
                    <p className="zn-card-subtitle">{loading ? '正在加载成员目录…' : '暂无符合条件的成员账号'}</p>
                    {!loading ? (
                      <button type="button" className="zn-btn zn-btn-primary" onClick={openCreateDialog}>
                        <ZnIcon name="plus" size={14} color="currentColor" />
                        新建第一位成员
                      </button>
                    ) : null}
                  </div>
                )}

                <nav className="zn-pagination" aria-label="成员列表分页">
                  <span className="zn-hint">
                    共 {Math.max(totalAccounts, accounts.length)} 名成员 · 第 {page} / {totalPages} 页
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

              {/* 右侧：一体化成员检查器（不再双层嵌套卡片） */}
              <section className="zn-card zn-inspector" aria-label="成员详情">
                {!selectedId ? (
                  <div className="zn-empty-state">
                    <ZnIcon name="users" size={28} color="var(--ap-text-tertiary)" />
                    <h2 className="zn-card-title">选择一名成员</h2>
                    <p className="zn-card-subtitle">在左侧列表中点击任意成员，即可查看并编辑其角色、组件授权、包授权与账号安全设置。</p>
                  </div>
                ) : detailLoading ? (
                  <div className="zn-empty-state">
                    <p className="zn-card-subtitle">正在读取成员详情…</p>
                  </div>
                ) : !selectedDetail ? (
                  <div className="zn-empty-state">
                    <p className="zn-card-subtitle">无法加载成员详情，请重新选择。</p>
                  </div>
                ) : (
                  <div className="zn-stack">
                    <div className="zn-inspector-header">
                      <span className="zn-member-avatar zn-member-avatar-lg" aria-hidden="true">
                        {initialsOf(selectedDetail.displayName || selectedDetail.username)}
                      </span>
                      <div className="zn-inspector-title">
                        <div className="zn-row" style={{ gap: 8 }}>
                          <h2 className="zn-card-title">{selectedDetail.displayName}</h2>
                          <span className={`zn-badge ${selectedDetail.enabled ? 'zn-badge-success' : 'zn-badge-danger'}`}>
                            <span className="zn-badge-dot" />
                            {selectedDetail.enabled ? '启用' : '停用'}
                          </span>
                        </div>
                        <p className="zn-card-subtitle">
                          <code>@{selectedDetail.username}</code> · {CREDENTIAL_LABELS[selectedDetail.credentialState]} · {SYNC_LABELS[selectedDetail.syncState]}
                        </p>
                      </div>
                    </div>

                    <div className="zn-tabs" role="tablist" aria-label="成员配置分区">
                      <button
                        type="button"
                        role="tab"
                        className="zn-tab"
                        aria-selected={inspectorTab === 'permissions'}
                        onClick={() => setInspectorTab('permissions')}
                      >
                        角色与授权
                      </button>
                      <button
                        type="button"
                        role="tab"
                        className="zn-tab"
                        aria-selected={inspectorTab === 'security'}
                        onClick={() => setInspectorTab('security')}
                      >
                        密码与安全
                      </button>
                    </div>

                    {inspectorTab === 'permissions' ? (
                      <div className="zn-stack">
                        <label className="zn-field">
                          <span className="zn-field-label">显示名</span>
                          <input
                            className="zn-input"
                            value={editDisplayName}
                            disabled={mutating}
                            onChange={(e) => setEditDisplayName(e.target.value)}
                          />
                        </label>

                        <div className="zn-field">
                          <span className="zn-field-label">业务角色（可多选）</span>
                          <div className="zn-role-cards">
                            {ALL_ROLES.map((role) => {
                              const active = editRoles.includes(role);
                              return (
                                <button
                                  key={role}
                                  type="button"
                                  className="zn-role-card"
                                  aria-pressed={active}
                                  disabled={mutating}
                                  onClick={() =>
                                    setEditRoles((prev) =>
                                      prev.includes(role)
                                        ? prev.length > 1
                                          ? prev.filter((r) => r !== role)
                                          : prev
                                        : [...prev, role],
                                    )
                                  }
                                >
                                  <div className="zn-role-card-head">
                                    <span className="zn-role-card-title">{ROLE_META[role].label}</span>
                                    <span className="zn-role-card-check" aria-hidden="true">
                                      {active ? <ZnIcon name="check" size={12} color="#FFFFFF" /> : null}
                                    </span>
                                  </div>
                                  <span className="zn-role-card-desc">{ROLE_META[role].desc}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <GrantsEditor
                          componentGrants={editComponents}
                          packageGrants={editPackages}
                          knownComponents={knownComponents}
                          knownPackages={knownPackages}
                          disabled={mutating}
                          onChangeComponents={setEditComponents}
                          onChangePackages={setEditPackages}
                        />

                        <div className="zn-inspector-footer">
                          <span className="zn-hint">{isDirty ? '有未保存的修改' : `修订 #${selectedDetail.desiredRevision}`}</span>
                          <div className="zn-row" style={{ gap: 8 }}>
                            {isDirty ? (
                              <button
                                type="button"
                                className="zn-btn"
                                disabled={mutating}
                                onClick={() => hydrateEditor(selectedDetail)}
                              >
                                撤销
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="zn-btn zn-btn-primary"
                              disabled={mutating || !isDirty || !editDisplayName.trim()}
                              onClick={() => void handleSavePermissions()}
                            >
                              {mutating ? '正在保存…' : '保存更改'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="zn-stack">
                        {selectedDetail.administrator ? (
                          <p className="zn-notice" role="note">
                            <ZnIcon name="shield" size={16} color="currentColor" />
                            部署管理员账号的停用与口令重置受部署清单保护，无法在此停用。
                          </p>
                        ) : null}

                        {selectedDetail.credentialState === 'uncertain' ? (
                          <p className="access-error" role="alert">
                            上次密码重置的远端结果不确定（待运维核实），平台已保持本地拒绝并锁定并发改密。请先核实身份服务状态后再执行受控恢复。
                          </p>
                        ) : selectedDetail.syncState === 'failed' ? (
                          <p className="access-error" role="alert">
                            身份目录同步未完成（状态：同步失败），本地权限收紧已生效；请核查同名冲突或身份服务连通性。
                          </p>
                        ) : null}

                        <form
                          className="zn-security-box zn-stack-sm"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (password.length < 14 || selectedDetail.credentialState === 'uncertain') return;
                            void runMutation(
                              () => setManagedAccountPassword(selectedDetail.id, selectedDetail.desiredRevision, password),
                              '临时密码已设置，成员下次登录需立即更换。',
                            );
                          }}
                        >
                          <div className="zn-row zn-row-between">
                            <span className="zn-field-label">设置临时密码</span>
                            <button
                              type="button"
                              className="zn-link-btn"
                              disabled={mutating || selectedDetail.administrator || selectedDetail.credentialState === 'uncertain'}
                              onClick={() => {
                                setPassword(generateStrongPassword());
                                setShowPassword(true);
                              }}
                            >
                              自动生成 16 位强密码
                            </button>
                          </div>
                          <div className="zn-row" style={{ gap: 8 }}>
                            <input
                              className="zn-input zn-input-mono"
                              style={{ flex: 1 }}
                              type={showPassword ? 'text' : 'password'}
                              autoComplete="new-password"
                              placeholder="至少 14 个字符"
                              value={password}
                              disabled={mutating || selectedDetail.administrator || selectedDetail.credentialState === 'uncertain'}
                              onChange={(e) => setPassword(e.target.value)}
                            />
                            <button
                              type="button"
                              className="zn-btn"
                              onClick={() => setShowPassword((v) => !v)}
                            >
                              {showPassword ? '隐藏' : '显示'}
                            </button>
                          </div>
                          <div className="zn-row zn-row-between">
                            <span className="zn-hint">
                              当前长度：{password.length} / 14 字符 · 仅本次请求传输，不明文留存
                            </span>
                            <button
                              type="submit"
                              className="zn-btn zn-btn-primary"
                              disabled={mutating || selectedDetail.administrator || selectedDetail.credentialState === 'uncertain' || password.length < 14}
                            >
                              设置临时密码
                            </button>
                          </div>
                        </form>

                        <div className="zn-security-box zn-stack-sm">
                          <span className="zn-field-label">会话与生命周期控制</span>
                          <div className="zn-row zn-row-between">
                            <div>
                              <div className="zn-check-label">强制重新登录</div>
                              <div className="zn-hint">立即作废该成员当前的 Web / CLI 会话与预览授权</div>
                            </div>
                            <button
                              type="button"
                              className="zn-btn"
                              disabled={mutating || selectedDetail.administrator}
                              onClick={() =>
                                void runMutation(
                                  () => mutateManagedAccount(selectedDetail.id, 'force-logout', { expectedRevision: selectedDetail.desiredRevision }),
                                  '已强制该成员重新登录，原有会话已失效。',
                                )
                              }
                            >
                              强制下线
                            </button>
                          </div>

                          <div className="zn-row zn-row-between" style={{ paddingTop: 10, borderTop: '1px solid var(--ap-border)' }}>
                            <div>
                              <div className="zn-check-label">{selectedDetail.enabled ? '停用账号' : '恢复账号'}</div>
                              <div className="zn-hint">
                                {selectedDetail.enabled ? '停用后所有凭据立即失效，可随时恢复' : '恢复该成员的登录与已分配权限'}
                              </div>
                            </div>
                            {selectedDetail.enabled ? (
                              confirmDisable ? (
                                <div className="zn-row" style={{ gap: 6 }}>
                                  <button type="button" className="zn-btn" disabled={mutating} onClick={() => setConfirmDisable(false)}>
                                    取消
                                  </button>
                                  <button
                                    type="button"
                                    className="zn-btn zn-btn-danger"
                                    disabled={mutating || selectedDetail.administrator}
                                    onClick={() =>
                                      void runMutation(
                                        () => mutateManagedAccount(selectedDetail.id, 'disable', { expectedRevision: selectedDetail.desiredRevision }),
                                        '账号已停用，已有凭据立即失效。',
                                      )
                                    }
                                  >
                                    确认停用
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="zn-btn zn-btn-danger"
                                  disabled={mutating || selectedDetail.administrator}
                                  onClick={() => setConfirmDisable(true)}
                                >
                                  停用账号
                                </button>
                              )
                            ) : (
                              <button
                                type="button"
                                className="zn-btn zn-btn-primary"
                                disabled={mutating || selectedDetail.administrator}
                                onClick={() =>
                                  void runMutation(
                                    () => mutateManagedAccount(selectedDetail.id, 'enable', { expectedRevision: selectedDetail.desiredRevision }),
                                    '账号恢复请求已提交。',
                                  )
                                }
                              >
                                恢复账号
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <section className="zn-card" aria-label="身份操作记录">
              <div className="zn-card-head">
                <div>
                  <h2 className="zn-card-title">身份操作审计</h2>
                  <p className="zn-card-subtitle">展示最近的成员创建、权限变更、密码重置与启停记录</p>
                </div>
                <button type="button" className="zn-btn" disabled={auditLoading} onClick={() => void loadAudit()}>
                  <ZnIcon name="refresh-cw" size={14} color="currentColor" />
                  刷新记录
                </button>
              </div>
              {audit.length > 0 ? (
                <div className="zn-checks">
                  {audit.map((entry, index) => (
                    <div className="zn-check" key={`${entry.at}-${index}`}>
                      <span className="zn-check-group">
                        <ZnIcon
                          name="circle-check-big"
                          size={15}
                          color={entry.result === 'failed' ? 'var(--ap-danger)' : 'var(--ap-success)'}
                          className="zn-check-icon"
                        />
                        <span className="zn-check-label">
                          {ACTION_LABELS[entry.action as keyof typeof ACTION_LABELS] ?? entry.action} · <code>@{entry.username}</code>
                        </span>
                        <span className="zn-hint">由 {entry.actor}</span>
                      </span>
                      <div className="zn-row" style={{ gap: 10 }}>
                        <span className="zn-event-time">{new Date(entry.at).toLocaleString('zh-CN')}</span>
                        <span className={`zn-badge ${entry.result === 'failed' ? 'zn-badge-danger' : 'zn-badge-success'}`}>
                          <span className="zn-badge-dot" />
                          {entry.result === 'failed' ? '失败' : '成功'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="zn-hint">{auditLoading ? '正在读取操作记录…' : '暂无操作审计记录。'}</p>
              )}
            </section>
          )}
        </>
      )}

      {/* 原生 <dialog> Apple Sheet：新建成员 */}
      <dialog
        ref={createDialogRef}
        className="zn-dialog"
        aria-labelledby="create-member-title"
        {...({ closedby: 'any' } as Record<string, string>)}
      >
        <div className="zn-dialog-head">
          <div>
            <h1 id="create-member-title" className="zn-card-title">新建成员账号</h1>
            <p className="zn-card-subtitle">用户名创建后不可更改，按 ASCII 小写规范化</p>
          </div>
          <button type="button" className="zn-icon-btn" aria-label="关闭对话框" onClick={closeCreateDialog}>
            ×
          </button>
        </div>

        <form className="zn-stack" onSubmit={handleCreateSubmit}>
          {createError ? <p className="access-error" role="alert">{createError}</p> : null}

          <div className="zn-field-row">
            <label className="zn-field">
              <span className="zn-field-label">用户名</span>
              <input
                className="zn-input zn-input-mono"
                value={draft.username}
                autoComplete="off"
                autoFocus
                required
                placeholder="例如 zhang.san"
                onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              />
            </label>
            <label className="zn-field">
              <span className="zn-field-label">显示名</span>
              <input
                className="zn-input"
                value={draft.displayName}
                required
                placeholder="例如 张三"
                onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              />
            </label>
          </div>

          <div className="zn-field">
            <span className="zn-field-label">业务角色</span>
            <div className="zn-role-cards">
              {ALL_ROLES.map((role) => {
                const active = draft.roles.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    className="zn-role-card"
                    aria-pressed={active}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        roles: prev.roles.includes(role)
                          ? prev.roles.length > 1
                            ? prev.roles.filter((r) => r !== role)
                            : prev.roles
                          : [...prev.roles, role],
                      }))
                    }
                  >
                    <div className="zn-role-card-head">
                      <span className="zn-role-card-title">{ROLE_META[role].label}</span>
                      <span className="zn-role-card-check" aria-hidden="true">
                        {active ? <ZnIcon name="check" size={12} color="#FFFFFF" /> : null}
                      </span>
                    </div>
                    <span className="zn-role-card-desc">{ROLE_META[role].desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <GrantsEditor
            componentGrants={draft.componentGrants}
            packageGrants={draft.packageGrants}
            knownComponents={knownComponents}
            knownPackages={knownPackages}
            disabled={mutating}
            onChangeComponents={(next) => setDraft((prev) => ({ ...prev, componentGrants: next }))}
            onChangePackages={(next) => setDraft((prev) => ({ ...prev, packageGrants: next }))}
          />

          <div className="zn-dialog-actions">
            <button type="button" className="zn-btn" disabled={mutating} onClick={closeCreateDialog}>
              取消
            </button>
            <button type="submit" className="zn-btn zn-btn-primary" disabled={mutating}>
              {mutating ? '正在创建…' : '创建账号'}
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}

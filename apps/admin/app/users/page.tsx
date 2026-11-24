'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createManagedAccount,
  listManagedAccounts,
  managedAccountAudit,
  mutateManagedAccount,
  readManagedAccount,
  setManagedAccountPassword,
  ACTION_LABELS,
  CREDENTIAL_LABELS,
  SYNC_LABELS,
  type ManagedAccountDraft,
} from '../lib/managed-accounts-client';
import { companyLoginUrl, loadCompanySession, type UserSession } from '../lib/auth';
import type { ManagedAccountDetail, ManagedAccountRole } from '@company/contracts';

const emptyDraft: ManagedAccountDraft = { username: '', displayName: '', roles: ['reader'], componentGrants: [], packageGrants: [] };

export default function ManagedAccountsConsole() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [accounts, setAccounts] = useState<ManagedAccountDetail[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<ManagedAccountDraft>(emptyDraft);
  const [password, setPassword] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    } catch (failure) { setError(failure instanceof Error ? failure.message : '读取成员列表失败。'); }
    finally { setBusy(false); }
  }, [query, selected, statusFilter]);

  useEffect(() => { void loadCompanySession().then(setSession); }, []);
  useEffect(() => { void reload(); }, [reload]);

  const current = accounts.find(item => item.id === selected);

  const act = async (operation: () => Promise<ManagedAccountDetail>, message: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const updated = await operation();
      setAccounts(current => current.map(item => item.id === updated.id ? updated : item));
      setNotice(message);
      setPassword('');
      await reload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '操作失败，请刷新后重试。'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <section className="access-heading">
        <div>
          <p className="eyebrow">平台管理</p>
          <h1>用户与权限</h1>
          <p className="lead">创建成员、设置角色与资产权限、停用或恢复账号、重置临时密码并强制重新登录。</p>
        </div>
        <div>
          <a className="filter-btn" href={companyLoginUrl}>账号登录</a>
          <button className="filter-btn" disabled={busy} onClick={() => void reload()}>刷新列表</button>
        </div>
      </section>

      {!session && <section className="access-panel"><h2>管理员登录</h2><p>成员管理仅接受部署登记的平台管理员身份；业务角色不授予后台权限。</p><a className="filter-btn active" href={companyLoginUrl}>账号登录</a></section>}

      {session && <>
        {error && <p className="access-hint" role="alert">{error}</p>}
        {notice && <p className="access-hint" role="status">{notice}</p>}

        <section className="access-panel">
          <h2>创建成员</h2>
          <p className="access-hint">用户名按 ASCII 小写规范化，创建后不改名；3–64 位字母、数字、点、下划线或连字符，首位为字母或数字。</p>
          <form onSubmit={event => {
            event.preventDefault();
            void act(() => createManagedAccount(draft), '账号已创建，请为成员设置临时密码。').then(() => setDraft(emptyDraft));
          }}>
            <label>用户名<input value={draft.username} autoComplete="off" onChange={event => setDraft({ ...draft, username: event.target.value })} /></label>
            <label>显示名<input value={draft.displayName} onChange={event => setDraft({ ...draft, displayName: event.target.value })} /></label>
            <fieldset>
              <legend>角色</legend>
              {(['reader', 'publisher', 'maintainer'] as ManagedAccountRole[]).map(role => (
                <label key={role}><input type="checkbox" checked={draft.roles.includes(role)} onChange={event => setDraft({ ...draft, roles: event.target.checked ? [...draft.roles, role] : draft.roles.filter(item => item !== role) })} />{role}</label>
              ))}
            </fieldset>
            <label>组件授权（每行一个组件 ID，逗号分隔发布/维护）<textarea value={draft.componentGrants.map(grant => `${grant.componentId},${grant.canPublish ? 'publish' : ''}${grant.canMaintain ? ',maintain' : ''}`).join('\n')} onChange={event => setDraft({ ...draft, componentGrants: event.target.value.split('\n').map(line => line.trim()).filter(Boolean).map(line => { const [componentId = '', ...flags] = line.split(','); return { componentId, canPublish: flags.includes('publish'), canMaintain: flags.includes('maintain') }; }) })} /></label>
            <label>包授权（每行一个 npm 包名）<textarea value={draft.packageGrants.join('\n')} onChange={event => setDraft({ ...draft, packageGrants: event.target.value.split('\n').map(line => line.trim()).filter(Boolean) })} /></label>
            <button className="filter-btn" type="submit" disabled={busy}>创建账号</button>
          </form>
        </section>

        <section className="access-panel">
          <div className="access-title"><h2>成员列表</h2><span className="access-badge">共 {accounts.length} 个账号</span></div>
          <div className="access-title">
            <input placeholder="搜索用户名或显示名" value={query} onChange={event => setQuery(event.target.value)} />
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="all">全部状态</option>
              <option value="enabled">仅启用</option>
              <option value="disabled">仅停用</option>
            </select>
          </div>
          <table className="access-checks">
            <thead><tr><th>用户名</th><th>显示名</th><th>角色</th><th>状态</th><th>密码</th><th>同步</th><th>操作</th></tr></thead>
            <tbody>
              {accounts.map(account => (
                <tr key={account.id}>
                  <td><code>{account.username}</code></td>
                  <td>{account.displayName}</td>
                  <td>{account.roles.join(', ')}</td>
                  <td>{account.administrator ? '部署管理员' : account.enabled ? '启用' : '停用'}</td>
                  <td>{CREDENTIAL_LABELS[account.credentialState]}</td>
                  <td>{SYNC_LABELS[account.syncState]}</td>
                  <td><button className="filter-btn" disabled={busy} onClick={() => void readManagedAccount(account.id).then(account => setSelected(account.id)).catch(failure => setError(failure instanceof Error ? failure.message : '读取详情失败。'))}>详情</button></td>
                </tr>
              ))}
              {!accounts.length && <tr><td colSpan={7}>{busy ? '正在读取…' : '暂无成员。'}</td></tr>}
            </tbody>
          </table>
        </section>

        {current && <section className="access-panel">
          <div className="access-title"><h2>{current.username}</h2><span className="access-badge">账号版本 {current.accountVersion} · 预期修订 {current.desiredRevision}</span></div>
          <p className="access-hint">显示名、业务角色、组件与包权限、停用、恢复、重置临时密码与强制重新登录。并发旧版本提交会被拒绝。</p>
          <label>显示名<input value={current.displayName} onChange={event => setAccounts(list => list.map(item => item.id === current.id ? { ...item, displayName: event.target.value } : item))} /></label>
          <fieldset>
            <legend>业务角色</legend>
            {(['reader', 'publisher', 'maintainer'] as ManagedAccountRole[]).map(role => (
              <label key={role}><input type="checkbox" checked={current.roles.includes(role)} onChange={event => void act(() => mutateManagedAccount(current.id, 'update', { expectedRevision: current.desiredRevision, roles: event.target.checked ? [...current.roles, role] : current.roles.filter(item => item !== role) }), '角色已更新。')} />{role}</label>
            ))}
          </fieldset>
          <p>组件授权：{current.componentGrants.map(grant => `${grant.componentId}${grant.canPublish ? '(发布)' : ''}${grant.canMaintain ? '(维护)' : ''}`).join('、') || '无'}</p>
          <p>包授权：{current.packageGrants.join('、') || '无'}</p>
          <div className="access-title">
            <button className="filter-btn" disabled={busy} onClick={() => void act(() => mutateManagedAccount(current.id, 'update', { expectedRevision: current.desiredRevision, displayName: current.displayName }), '显示名已更新。')}>保存显示名</button>
            <button className="filter-btn" disabled={busy || !current.enabled} onClick={() => void act(() => mutateManagedAccount(current.id, 'disable', { expectedRevision: current.desiredRevision }), '账号已停用，已有凭据立即失效。')}>停用</button>
            <button className="filter-btn" disabled={busy || current.enabled} onClick={() => void act(() => mutateManagedAccount(current.id, 'enable', { expectedRevision: current.desiredRevision }), '账号恢复请求已提交。')}>恢复</button>
            <button className="filter-btn" disabled={busy} onClick={() => void act(() => mutateManagedAccount(current.id, 'force-logout', { expectedRevision: current.desiredRevision }), '已要求该成员重新登录。')}>强制重新登录</button>
          </div>
          <form onSubmit={event => {
            event.preventDefault();
            void act(() => setManagedAccountPassword(current.id, current.desiredRevision, password), '临时密码已设置。').then(() => setPassword(''));
          }}>
            <label>临时密码（至少 14 字符，仅在本次请求中传输，不保存、不显示）<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
            <button className="filter-btn" type="submit" disabled={busy || password.length < 14}>设置临时密码</button>
          </form>
        </section>}

        <section className="access-panel">
          <div className="access-title"><h2>操作记录</h2><button className="filter-btn" disabled={busy} onClick={() => void managedAccountAudit().then(value => setAudit(value.items)).catch(() => setError('读取操作记录失败。'))}>读取记录</button></div>
          <ul className="access-checks">
            {audit.map((entry, index) => (
              <li key={`${entry.at}-${index}`}><span>{new Date(entry.at).toLocaleString('zh-CN')} · {ACTION_LABELS[entry.action as keyof typeof ACTION_LABELS] ?? entry.action} · {entry.username}</span><span className={'access-check ' + entry.result}>{entry.result === 'failed' ? '失败' : '成功'}</span></li>
            ))}
            {!audit.length && <li><span>尚未读取操作记录。</span></li>}
          </ul>
        </section>
      </>}
    </>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import type { ComponentCategory } from '@company/contracts';
import { clearSession, companyLoginUrl, getStoredSession, loadCompanySession, platformApiOrigin, saveSession, type UserSession } from '../lib/auth';
import { CategoryApiError, createComponentCategory, listComponentCategories, updateComponentCategory } from '../lib/categories-client';

export default function CategoriesConsole() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [apiUrl, setApiUrl] = useState(platformApiOrigin);
  const [token, setToken] = useState('');
  const [items, setItems] = useState<ComponentCategory[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState({ id: '', name: '' });
  const [editing, setEditing] = useState<ComponentCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const scope = useRef<{ apiUrl: string; session: UserSession | null }>({ apiUrl: platformApiOrigin, session: null });

  const clearPrivateState = () => {
    requestGeneration.current++;
    setItems([]); setAllowed(false); setEditing(null); setDraft({ id: '', name: '' });
    setNotice(null); setError(null); setLoading(false); setMutating(false);
  };
  const changeSession = (value: UserSession | null) => {
    if (scope.current.session?.subject !== value?.subject || scope.current.session?.token !== value?.token) clearPrivateState();
    scope.current.session = value;
    setSession(value);
  };
  const changeApiUrl = (value: string) => {
    if (scope.current.apiUrl !== value) clearPrivateState();
    scope.current.apiUrl = value;
    setApiUrl(value);
  };

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(window.location.search).get('apiUrl');
    const stored = localStorage.getItem('zhinexus_api_url');
    if (query || stored) changeApiUrl(query || stored!);
    changeSession(getStoredSession());
    void loadCompanySession().then(value => { if (active && value) changeSession(value); });
    return () => { active = false; requestGeneration.current++; };
  }, []);
  useEffect(() => {
    setItems([]); setAllowed(false); setError(null);
    if (!session) return;
    const controller = new AbortController();
    const generation = requestGeneration.current;
    const current = () => !controller.signal.aborted && generation === requestGeneration.current;
    setLoading(true);
    void listComponentCategories({ apiUrl, token: session.token, signal: controller.signal }).then(value => {
      if (!current()) return;
      setItems(value.items); setAllowed(true);
      setEditing(current => current ? value.items.find(item => item.id === current.id) ?? null : null);
    }).catch(failure => {
      if (!current()) return;
      if (failure instanceof CategoryApiError && [401, 403].includes(failure.status)) clearPrivateState();
      setError(failure instanceof Error ? failure.message : '读取分类失败。');
    }).finally(() => { if (current()) setLoading(false); });
    return () => controller.abort();
  }, [apiUrl, session, refresh]);

  const busy = loading || mutating;
  const act = async (operation: () => Promise<ComponentCategory>, message: string) => {
    const generation = requestGeneration.current;
    setMutating(true); setError(null); setNotice(null);
    try {
      const updated = await operation();
      if (generation !== requestGeneration.current) return false;
      setItems(current => current.some(item => item.id === updated.id) ? current.map(item => item.id === updated.id ? updated : item) : [...current, updated]);
      setEditing(current => current?.id === updated.id ? updated : current);
      setNotice(message);
      return true;
    } catch (failure) {
      if (generation !== requestGeneration.current) return false;
      if (failure instanceof CategoryApiError && [401, 403].includes(failure.status)) clearPrivateState();
      setError(failure instanceof Error ? failure.message : '分类操作失败，请刷新后重试。');
      return false;
    } finally { if (generation === requestGeneration.current) setMutating(false); }
  };
  const connection = { apiUrl, token: session?.token };

  return <main>
    <p className="eyebrow">Zhinexus · 平台管理</p>
    <h1>组件分类</h1>
    <p className="lead">维护发布时使用的分类。分类 ID 创建后保持不变，重命名与启停使用当前修订，历史发布记录保持原样。</p>
    <div className="catalog-toolbar">
      <label htmlFor="categories-api">API 服务 <input id="categories-api" className="search-box" value={apiUrl} disabled={mutating} onChange={event => {
        changeApiUrl(event.target.value); localStorage.setItem('zhinexus_api_url', event.target.value);
      }} /></label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a className="filter-btn" href={companyLoginUrl}>账号登录</a>
        {session && <><button className="filter-btn" disabled={busy} onClick={() => setRefresh(value => value + 1)}>刷新列表</button>
          <button className="filter-btn" disabled={mutating} onClick={() => { clearSession(); changeSession(null); }}>退出登录</button></>}
      </div>
    </div>
    {error && <p className="match-errors" role="alert">{error}</p>}
    {notice && <p className="match-success" role="status">{notice}</p>}
    {!session ? <section className="catalog-toolbar" style={{ display: 'block' }}>
      <h2>管理员登录</h2><p>分类管理仅允许平台管理员；业务角色不授予管理权限。</p>
      <form onSubmit={event => {
        event.preventDefault(); const saved = saveSession(token.trim());
        if (saved) { changeSession(saved); setError(null); setToken(''); }
        else setError('Token 格式无效，无法解析身份。');
      }} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>开发者 Bearer Token <input className="search-box" type="password" value={token} autoComplete="off" onChange={event => setToken(event.target.value)} /></label>
        <button type="submit" className="filter-btn active" disabled={!token.trim()}>凭证登录</button>
      </form>
    </section> : <>
      <p className="eyebrow">当前身份：{session.subject} · 管理权限由 API 实际校验</p>
      <section className="catalog-toolbar" style={{ display: 'block' }} aria-label="创建分类">
        <h2>创建分类</h2>
        <form onSubmit={event => {
          event.preventDefault();
          void act(() => createComponentCategory(connection, { id: draft.id.trim(), name: draft.name.trim() }), '分类已创建。').then(success => { if (success) setDraft({ id: '', name: '' }); });
        }} style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'end' }}>
          <label>分类 ID <input className="search-box" required maxLength={128} value={draft.id} disabled={!allowed || busy} onChange={event => setDraft({ ...draft, id: event.target.value })} /></label>
          <label>分类名称 <input className="search-box" required maxLength={128} value={draft.name} disabled={!allowed || busy} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
          <button type="submit" className="filter-btn active" disabled={!allowed || busy || !draft.id.trim() || !draft.name.trim()}>创建分类</button>
        </form>
        <p className="match-note">ID 使用字母、数字、点、下划线或连字符，以字母或数字开头；名称最多 128 字符。</p>
      </section>
      <section className="spec-table-container" aria-label="分类列表" style={{ marginBottom: 24, overflowX: 'auto' }}>
        <table className="spec-table">
          <thead><tr><th>分类 ID</th><th>名称</th><th>状态</th><th>修订</th><th>操作</th></tr></thead>
          <tbody>{items.map(item => <tr key={item.id}>
            <td><code>{item.id}</code></td><td>{item.name}</td><td>{item.enabled ? '已启用' : '已停用'}</td><td>{item.revision}</td>
            <td style={{ display: 'flex', gap: 8 }}>
              <button className="filter-btn" disabled={!allowed || busy} onClick={() => { setEditing(item); setNotice(null); }}>编辑</button>
              <button className="filter-btn" disabled={!allowed || busy} onClick={() => void act(() => updateComponentCategory(connection, item.id, { name: item.name, enabled: !item.enabled, expectedRevision: item.revision }), item.enabled ? '分类已停用，不再提供新的发布选择。' : '分类已启用。')}>{item.enabled ? '停用' : '启用'}</button>
            </td>
          </tr>)}{!items.length && <tr><td colSpan={5}>{loading ? '正在读取分类…' : allowed ? '暂无分类' : '尚未取得分类管理权限。'}</td></tr>}</tbody>
        </table>
      </section>
      {editing && allowed && <section className="catalog-toolbar" style={{ display: 'block' }} aria-label="编辑分类">
        <h2>编辑分类 <code>{editing.id}</code></h2><p>稳定 ID：{editing.id} · 当前修订：{editing.revision}</p>
        <form onSubmit={event => {
          event.preventDefault(); void act(() => updateComponentCategory(connection, editing.id, { name: editing.name.trim(), enabled: editing.enabled, expectedRevision: editing.revision }), '分类已保存。');
        }} style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <label>编辑分类名称 <input className="search-box" required maxLength={128} value={editing.name} disabled={busy} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
          <button type="submit" className="filter-btn active" disabled={busy || !editing.name.trim()}>保存分类</button>
          <button type="button" className="filter-btn" disabled={busy} onClick={() => setEditing(null)}>取消编辑</button>
        </form>
      </section>}
    </>}
  </main>;
}

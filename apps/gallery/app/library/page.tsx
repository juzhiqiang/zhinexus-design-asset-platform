'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ApiMessages } from '@company/contracts';
import { clearSession, companyLoginUrl, loadCompanySession, type UserSession } from '../lib/auth';
import { getDisplayEnhancement } from '../lib/catalog';
import { fetchMyComponents } from '../lib/library-client';

type LibraryItem = ApiMessages['componentsResponse']['items'][number];

type ViewState =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: LibraryItem[] };

export default function MyLibraryPage() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [view, setView] = useState<ViewState>({ kind: 'loading' });
  const [selectedFramework, setSelectedFramework] = useState<'all' | 'vue' | 'react'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const clearPrivateData = useCallback((next: ViewState, clearAuth = false) => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (clearAuth) {
      setSession(null);
    }
    setView(next);
  }, []);

  const refreshLibrary = useCallback(async () => {
    const gen = ++generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // 重检开始立即清空旧账号/旧权限的 ready 数据，防止切换账号延迟期间继续展示旧资产
    setView({ kind: 'loading' });

    const currentSession = await loadCompanySession();
    if (gen !== generationRef.current || controller.signal.aborted) return;

    if (!currentSession) {
      setSession(null);
      setView({ kind: 'unauthenticated' });
      return;
    }

    setSession(currentSession);
    const result = await fetchMyComponents(currentSession, { signal: controller.signal });
    if (gen !== generationRef.current || controller.signal.aborted) return;

    if (result.status === 'unauthenticated') {
      clearSession();
      clearPrivateData({ kind: 'unauthenticated' }, true);
      return;
    }
    if (result.status === 'forbidden') {
      clearPrivateData({ kind: 'forbidden' });
      return;
    }
    if (result.status !== 'ok') {
      clearPrivateData({ kind: 'error', message: result.status === 'error' ? result.message : '无法加载已授权组件目录。' });
      return;
    }

    setView({ kind: 'ready', items: result.data.items });
  }, [clearPrivateData]);

  useEffect(() => {
    void refreshLibrary();
    const onFocus = () => {
      void refreshLibrary();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshLibrary();
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
  }, [refreshLibrary]);

  const handleLogout = () => {
    clearSession();
    clearPrivateData({ kind: 'unauthenticated' }, true);
  };

  const items = view.kind === 'ready' ? view.items : [];
  const filteredItems = items.filter((item) => {
    if (selectedFramework !== 'all' && !item.variants.some((v) => v.framework === selectedFramework)) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const display = getDisplayEnhancement(item.componentId);
      const hit =
        item.componentId.toLowerCase().includes(q) ||
        (display?.name.toLowerCase().includes(q) ?? false) ||
        (display?.chineseName.toLowerCase().includes(q) ?? false);
      if (!hit) return false;
    }
    return true;
  });

  return (
    <main>
      <header className="page-head-row">
        <div className="page-head-copy">
          <p className="eyebrow">内部授权资产 · PRIVATE LIBRARY</p>
          <h1>我的资产库</h1>
          <p className="lead">
            仅展示当前登录身份获准读取的组件资产；未登录、退出或权限撤销后立即清空页面数据。
          </p>
        </div>

        {session && (
          <div className="session-bar">
            <span className="tag" data-testid="library-subject">{session.subject}</span>
            <button type="button" className="filter-btn" onClick={() => void refreshLibrary()}>
              刷新权限与目录
            </button>
            <button type="button" className="filter-btn" onClick={handleLogout}>
              退出登录
            </button>
          </div>
        )}
      </header>

      {view.kind === 'loading' && (
        <section className="empty-state" role="status">
          <p className="empty-state__eyebrow">VERIFYING SESSION</p>
          <h2>正在校验登录状态与资产权限…</h2>
          <p>请稍候，私人资产目录仅在客户端即时读取。</p>
        </section>
      )}

      {view.kind === 'unauthenticated' && (
        <section className="empty-state" data-testid="library-unauthenticated">
          <p className="empty-state__eyebrow">OIDC AUTHENTICATION REQUIRED</p>
          <h2>登录后查看已授权资产</h2>
          <p>内部组件资产受身份与逐组件权限保护，请先使用公司账号登录。</p>
          <div className="empty-state-actions">
            <a href={companyLoginUrl} className="titanium-btn">
              使用公司账号登录
            </a>
          </div>
        </section>
      )}

      {view.kind === 'forbidden' && (
        <section className="empty-state" role="alert" data-testid="library-forbidden">
          <p className="empty-state__eyebrow">ACCESS DENIED · 403</p>
          <h2>暂无访问权限</h2>
          <p>当前账号未被授予内部组件目录读取权限，或权限已被撤销。</p>
        </section>
      )}

      {view.kind === 'error' && (
        <section className="empty-state" role="alert">
          <p className="empty-state__eyebrow">FETCH ERROR</p>
          <h2>目录读取失败</h2>
          <p>{view.message}</p>
        </section>
      )}

      {view.kind === 'ready' && (
        <>
          {items.length > 0 && (
            <div className="catalog-toolbar">
              <div className="framework-filters" role="tablist" aria-label="按框架筛选">
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedFramework === 'all'}
                  className={`filter-btn ${selectedFramework === 'all' ? 'active' : ''}`}
                  onClick={() => setSelectedFramework('all')}
                >
                  全部框架
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedFramework === 'vue'}
                  className={`filter-btn ${selectedFramework === 'vue' ? 'active' : ''}`}
                  onClick={() => setSelectedFramework('vue')}
                >
                  Vue 3
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedFramework === 'react'}
                  className={`filter-btn ${selectedFramework === 'react' ? 'active' : ''}`}
                  onClick={() => setSelectedFramework('react')}
                >
                  React 19
                </button>
              </div>

              <input
                type="search"
                className="search-box"
                placeholder="搜索已授权组件..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="搜索已授权组件"
              />
            </div>
          )}

          {filteredItems.length > 0 ? (
            <div className="components-grid" data-testid="library-grid">
              {filteredItems.map((item) => {
                const display = getDisplayEnhancement(item.componentId);
                const firstVariant = item.variants[0]!;
                return (
                  <article key={item.componentId} className="component-card">
                    <div className="card-header">
                      <div>
                        <h2 className="card-title">{display?.chineseName ?? item.componentId}</h2>
                        <div className="card-subtitle">
                          {display?.name ?? item.componentId} ({item.componentId})
                        </div>
                      </div>
                    </div>

                    <p className="card-desc">
                      {display?.description ?? `已授权内部组件资产 ${item.componentId}。`}
                    </p>

                    <div className="card-tags">
                      {display?.category && <span className="tag">{display.category}</span>}
                      {item.variants.map((v) => (
                        <Link
                          key={v.variantReleaseId}
                          href={`/library/${encodeURIComponent(v.variantReleaseId)}`}
                          className={`tag ${v.framework === 'vue' ? 'tag-framework-vue' : 'tag-framework-react'}`}
                        >
                          {v.framework === 'vue' ? 'Vue 3' : 'React 19'} · v{v.packageVersion}
                        </Link>
                      ))}
                    </div>

                    <div className="card-footer">
                      <span className="card-version">
                        {firstVariant.packageName}@{firstVariant.packageVersion}
                      </span>
                      <Link href={`/library/${encodeURIComponent(firstVariant.variantReleaseId)}`} className="card-link">
                        查看已授权详情与预览 →
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <section className="empty-state" data-testid="library-empty">
              <p className="empty-state__eyebrow">NO MATCHING ASSETS</p>
              <h2>暂无已授权的内部组件资产</h2>
              <p>当前账号已登录，但尚未分配可读取的内部组件资产，或筛选条件无匹配结果。</p>
            </section>
          )}
        </>
      )}
    </main>
  );
}

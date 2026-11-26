'use client';

/**
 * 管理端外壳：Apple macOS Sequoia / App Store Connect 风格侧栏与通透顶栏。
 *
 * 注意：这里渲染 `<div className="zn-content">` 而不是 `<main>`——各页面自己渲染
 * `<main>`，嵌套会产生多个 main 地标。
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ZnIcon } from './icons';
import { ADMIN_NAV_ITEMS, ADMIN_TOOL_ITEMS, resolveActiveNavKey, resolveTopbarPage } from './nav';
import { getStoredSession, loadCompanySession, logoutAndRedirect, platformApiOrigin } from '../auth';

const SEARCH_TARGET = '/match';
const THEME_KEY = 'zhinexus_admin_theme';
type ThemeMode = 'auto' | 'light' | 'dark';

function initialsOf(subject: string): string {
  const parts = subject.split(/[-_.\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return subject.slice(0, 2).toUpperCase();
}

function QuickSearch() {
  const router = useRouter();
  const [value, setValue] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById('zn-quick-search-input')?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <form
      className="zn-quick-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        router.push(query ? `${SEARCH_TARGET}?q=${encodeURIComponent(query)}` : SEARCH_TARGET);
      }}
    >
      <ZnIcon name="search" color="currentColor" size={14} className="zn-quick-search-icon" />
      <input
        id="zn-quick-search-input"
        className="zn-quick-search-input"
        type="search"
        value={value}
        placeholder="搜索资产或作业"
        aria-label="搜索资产或作业"
        onChange={(event) => setValue(event.target.value)}
      />
      <kbd>⌘K</kbd>
    </form>
  );
}

type LinkHealth = { status: 'checking' | 'online' | 'offline'; latencyMs: number | null };

export function ZnShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname() ?? '/assets';
  const router = useRouter();
  const isLoginPage = pathname === '/login';
  const activeKey = resolveActiveNavKey(pathname);
  const [subject, setSubject] = useState('');
  const [theme, setTheme] = useState<ThemeMode>('auto');
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'redirecting'>(() =>
    isLoginPage ? 'authenticated' : 'checking',
  );
  const [health, setHealth] = useState<LinkHealth>({ status: 'checking', latencyMs: null });

  useEffect(() => {
    const saved = (localStorage.getItem(THEME_KEY) as ThemeMode | null) ?? 'auto';
    if (saved === 'light' || saved === 'dark' || saved === 'auto') {
      setTheme(saved);
      document.documentElement.dataset.theme = saved;
    }
  }, []);

  const applyTheme = (next: ThemeMode) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (isLoginPage) {
      setAuthStatus('authenticated');
      return;
    }
    const stored = getStoredSession();
    if (stored) {
      setSubject(stored.subject);
      setAuthStatus('authenticated');
      return;
    }
    setAuthStatus('checking');
    let cancelled = false;
    void loadCompanySession().then((session) => {
      if (cancelled) return;
      if (session) {
        setSubject(session.subject);
        setAuthStatus('authenticated');
        return;
      }
      setSubject('');
      setAuthStatus('redirecting');
      const next = pathname && pathname.startsWith('/') && !pathname.startsWith('//') && pathname !== '/login'
        ? `?next=${encodeURIComponent(pathname)}`
        : '';
      router.replace(`/login${next}`);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoginPage, pathname, router]);

  useEffect(() => {
    if (isLoginPage || authStatus !== 'authenticated') return;
    let cancelled = false;
    const probe = async () => {
      const started = performance.now();
      try {
        const res = await fetch(`${platformApiOrigin}/healthz`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(4000),
        });
        if (cancelled) return;
        const elapsed = Math.max(1, Math.round(performance.now() - started));
        setHealth(res.ok ? { status: 'online', latencyMs: elapsed } : { status: 'offline', latencyMs: null });
      } catch {
        if (!cancelled) setHealth({ status: 'offline', latencyMs: null });
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, [isLoginPage, authStatus]);

  if (isLoginPage) {
    return (
      <div className="zn-login-shell">
        <div className="zn-login-content">{children}</div>
      </div>
    );
  }

  if (authStatus !== 'authenticated') {
    return (
      <div className="zn-login-shell">
        <div className="zn-login-content">
          <p className="zn-auth-checking">{authStatus === 'redirecting' ? '正在前往登录页…' : '正在核验登录状态…'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="zn-shell">
      <aside className="zn-sidebar" aria-label="管理侧栏">
        <div className="zn-brand">
          <span className="zn-brand-mark" aria-hidden="true">Z</span>
          <div className="zn-brand-copy">
            <span className="zn-brand-name">Zhinexus</span>
            <span className="zn-brand-sub">资产管理控制台</span>
          </div>
        </div>

        <p className="zn-workspace-label">工作台</p>
        <nav className="zn-nav" aria-label="控制台导航">
          {ADMIN_NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="zn-nav-item"
              aria-current={activeKey === item.key ? 'page' : undefined}
            >
              <ZnIcon name={item.icon} size={16} className="zn-nav-icon" color="currentColor" />
              <span>
                <span className="zn-nav-order">{item.order}</span>
                {item.label}
              </span>
            </Link>
          ))}
        </nav>

        <p className="zn-workspace-label" style={{ marginTop: 14 }}>工具</p>
        <nav className="zn-nav" aria-label="辅助工具">
          {ADMIN_TOOL_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="zn-nav-item"
              aria-current={activeKey === item.key ? 'page' : undefined}
            >
              <ZnIcon name={item.icon} size={15} className="zn-nav-icon" color="currentColor" />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="zn-sidebar-spacer" />

        <div className="zn-sidebar-footer">
          <div className="zn-theme-switch" role="group" aria-label="外观模式">
            {([['light', '浅色'], ['dark', '深色'], ['auto', '自动']] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className="zn-theme-option"
                aria-pressed={theme === mode}
                onClick={() => applyTheme(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="zn-link-pulse" data-health={health.status} title={`API: ${platformApiOrigin}`}>
            <span className="zn-link-status">
              <span className="zn-live-dot" />
              <span className="zn-link-label">
                {health.status === 'online' ? 'API ONLINE' : health.status === 'offline' ? 'API OFFLINE' : 'CHECKING'}
              </span>
            </span>
            <span className="zn-link-latency">
              {health.status === 'online' && health.latencyMs !== null ? `${health.latencyMs}ms` : health.status === 'offline' ? '离线' : '…'}
            </span>
          </div>
        </div>
      </aside>

      <div className="zn-body">
        <header className="zn-topbar">
          <div className="zn-topbar-context">
            <span className="zn-topbar-section">管理平台</span>
            <ZnIcon name="chevron-right" size={13} color="currentColor" className="zn-topbar-divider" />
            <span className="zn-topbar-page">{resolveTopbarPage(pathname)}</span>
          </div>
          <div className="zn-topbar-actions">
            <QuickSearch />
            <div className="zn-topbar-user">
              <span className="zn-avatar" title={subject || '未登录'} aria-hidden="true">
                {subject ? initialsOf(subject) : 'ZN'}
              </span>
              {subject ? <span className="zn-topbar-username">{subject}</span> : null}
              <button
                type="button"
                className="zn-btn zn-btn-logout"
                onClick={() => logoutAndRedirect(router)}
              >
                <ZnIcon name="log-out" size={13} color="currentColor" />
                退出登录
              </button>
            </div>
          </div>
        </header>
        <div className="zn-content">{children}</div>
      </div>
    </div>
  );
}
